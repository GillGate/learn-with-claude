/**
 * Visual render core: `render(source, kind, options)` — source → PNG.
 * Importing it has no side effects; the command-line entry point is
 * `render-viz.mjs` alongside.
 *
 * Inside — headless Chrome and a vendored mermaid bundle (`vendor/`). Both
 * formats go through one page, `vendor/harness.html`: for `mermaid` it calls
 * `mermaid.render`, for `svg` it inserts the source and runs the `<script>`
 * embedded in it — so the maker computes geometry in the browser sandbox, not
 * on the user's machine; Node itself only reads the source. One mechanism for
 * both formats means the backend can be swapped without touching the makers'
 * contract — which is why makers call only the render script, never Chrome or
 * mermaid directly.
 *
 * Two decisions dictated by measurements on this machine:
 *
 *   1. The screenshot is taken **per element**, via CDP (`DOM.getBoxModel` →
 *      `Page.captureScreenshot` with `clip`), not per window. Some diagrams
 *      yield a viewBox with a negative origin and no `height` — a window
 *      screenshot crops them off-target and produces a valid PNG with no
 *      content.
 *   2. Every call gets its **own** `--user-data-dir`. With a shared profile,
 *      two parallel makers kill each other (2 failures out of 3 on the stand).
 *
 * On a render error no PNG is created at all: the maker must not receive a
 * screenshot of an error message and mistake it for the picture.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { VIZ_EXT } from "../lib/kit.mjs";

const HARNESS = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor", "harness.html");

const RENDER_TIMEOUT_MS = 45_000;
const CHROME_START_TIMEOUT_MS = 30_000;
// Cap per PNG side: at deviceScaleFactor 2 a large diagram would otherwise
// grow into a screenshot that is pointless both to show and to store.
const MAX_PX = 4000;

/** A source error, not an environment one: the source did not render, fix it. */
export class RenderError extends Error {}

/** Visual kind by file extension — `mermaid`, `svg` or `null`. */
export function kindOf(file) {
	const ext = path.extname(file).toLowerCase();
	return Object.keys(VIZ_EXT).find((kind) => VIZ_EXT[kind] === ext) ?? null;
}

// ------------------------------------------------------------- source check

/**
 * The author's repertoire for `mermaid-maker` (docs/features/visuals.md). A
 * diagram whose type is not listed here gets cropped unpredictably or breaks
 * the palette — better to refuse before Chrome than to hand back a surprise.
 */
const MERMAID_REPERTOIRE = ["graph", "sequenceDiagram", "stateDiagram-v2", "erDiagram", "classDiagram", "mindmap", "timeline"];

/** A color is allowed only this way — the renderer owns the palette, not the source. */
const SVG_ALLOWED_COLORS = new Set(["currentcolor", "none"]);
const SVG_COLOR_PROPS = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];
const SVG_COLOR_RE = new RegExp(
	`\\b(${SVG_COLOR_PROPS.join("|")})\\s*[:=]\\s*(?:"([^"]*)"|'([^']*)'|([^;"'\\s>]+))`,
	"gi",
);
/** `fill`/`stroke` may reference a `<linearGradient>`/`<pattern>` of the same SVG — that is a pointer, not a color; the gradient itself is colored by its own `stop-color`. */
const URL_REF_RE = /^url\(#[^)]+\)$/i;

/**
 * Known silent mermaid failures and explicit color in SVG (ADR 0023) — checked
 * before Chrome starts. A violation throws `RenderError` with a `line N: …`
 * message; the source is not fixed up.
 */
function checkSource(source, kind) {
	const lines = source.split("\n");
	if (kind === "mermaid") checkMermaidSource(lines);
	else if (kind === "svg") checkSvgSource(lines);
}

/**
 * Index of the line holding the diagram type: skips blank lines, a leading
 * YAML frontmatter block (`---` … `---`) and `%%…` directive lines — the
 * diagram type need not be the first line of the file.
 */
function mermaidTypeLineIndex(lines) {
	let i = 0;
	while (i < lines.length && lines[i].trim() === "") i++;
	if (i < lines.length && lines[i].trim() === "---") {
		let end = i + 1;
		while (end < lines.length && lines[end].trim() !== "---") end++;
		if (end < lines.length) i = end + 1;
	}
	while (i < lines.length && (lines[i].trim() === "" || lines[i].trim().startsWith("%%"))) i++;
	return i < lines.length ? i : -1;
}

function checkMermaidSource(lines) {
	const typeIndex = mermaidTypeLineIndex(lines);
	if (typeIndex !== -1) {
		const first = lines[typeIndex].trim();
		const inRepertoire = MERMAID_REPERTOIRE.some((type) => first === type || first.startsWith(`${type} `));
		if (!inRepertoire) {
			throw new RenderError(`line ${typeIndex + 1}: unsupported diagram type — supported: ${MERMAID_REPERTOIRE.join(", ")}`);
		}
	}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*(classDef|style|linkStyle)(?=\s|$)/.test(line)) {
			throw new RenderError(`line ${i + 1}: colors are owned by the renderer — remove classDef/style/linkStyle`);
		}
		if (/fa:fa-/.test(line)) {
			throw new RenderError(`line ${i + 1}: FontAwesome icons (fa:fa-…) are not supported — they vanish silently`);
		}
		if (/<br(?=[\s/>])/i.test(line)) {
			throw new RenderError(`line ${i + 1}: <br> is dropped, not honoured — let the label wrap on its own, or shorten it`);
		}
		if (/[^\s&;]\s+\$\$/.test(line)) {
			throw new RenderError(`line ${i + 1}: a plain space before $$ in a label is swallowed — use &nbsp; instead`);
		}
	}
}

function checkSvgSource(lines) {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		SVG_COLOR_RE.lastIndex = 0;
		let match;
		while ((match = SVG_COLOR_RE.exec(line))) {
			const prop = match[1].toLowerCase();
			const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
			if (value === "" || SVG_ALLOWED_COLORS.has(value.toLowerCase())) continue;
			// `fill`/`stroke` may reference a `<linearGradient>`/`<pattern>` of the same file — that is a reference, not a color.
			if ((prop === "fill" || prop === "stroke") && URL_REF_RE.test(value)) continue;
			throw new RenderError(
				`line ${i + 1}: explicit color "${value}" — the renderer owns the palette; use a palette class or currentColor`,
			);
		}
	}
}

// ----------------------------------------------------------------------- Chrome

function chromeCandidates() {
	const pf = process.env.PROGRAMFILES || "C:\\Program Files";
	const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
	const local = process.env.LOCALAPPDATA || "";
	const list = [
		path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
		path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
		local && path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
		path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
		path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
		// Non-Windows: the same build of the script works there too, if Chrome is present.
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
	];
	return list.filter(Boolean);
}

/** Path to Chrome: `VIZ_CHROME`, otherwise the first candidate found. Throws if none is found. */
export function findChrome() {
	const override = process.env.VIZ_CHROME;
	if (override) {
		if (!fs.existsSync(override)) throw new Error(`VIZ_CHROME points at a missing file: ${override}`);
		return override;
	}
	for (const candidate of chromeCandidates()) if (fs.existsSync(candidate)) return candidate;
	throw new Error(
		"No Chrome or Edge found. Install Google Chrome, or point VIZ_CHROME at a Chromium-based browser executable.",
	);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome writes the CDP port to `DevToolsActivePort` inside the profile. */
async function waitForPort(profileDir, child) {
	const file = path.join(profileDir, "DevToolsActivePort");
	const deadline = Date.now() + CHROME_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`Chrome exited early with code ${child.exitCode}.`);
		try {
			const [port] = fs.readFileSync(file, "utf8").split("\n");
			if (port && port.trim()) return Number(port.trim());
		} catch {
			// The file is not there yet — keep waiting.
		}
		await sleep(60);
	}
	throw new Error("Chrome did not open a debugging port in time.");
}

async function pageTarget(port) {
	const deadline = Date.now() + CHROME_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/list`);
			const targets = await res.json();
			const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
			if (page) return page.webSocketDebuggerUrl;
		} catch {
			// The endpoint is not up yet.
		}
		await sleep(60);
	}
	throw new Error("Chrome exposed no page target.");
}

/** A minimal CDP client on top of Node's built-in WebSocket. */
async function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", () => reject(new Error("Could not open the CDP socket.")), { once: true });
	});
	let nextId = 1;
	const pending = new Map();
	ws.addEventListener("message", (event) => {
		let msg;
		try {
			msg = JSON.parse(event.data);
		} catch {
			return;
		}
		const waiter = msg.id && pending.get(msg.id);
		if (!waiter) return;
		pending.delete(msg.id);
		if (msg.error) waiter.reject(new Error(`${msg.error.message} (${waiter.method})`));
		else waiter.resolve(msg.result);
	});
	ws.addEventListener("close", () => {
		for (const waiter of pending.values()) waiter.reject(new Error("CDP socket closed."));
		pending.clear();
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject, method });
			ws.send(JSON.stringify({ id, method, params }));
		});
	return { send, close: () => ws.close() };
}

// ------------------------------------------------------------------- the render itself

/**
 * Renders `source` of kind `kind` (`mermaid` | `svg`) to a PNG at `options.png`.
 * If a source with a script completed itself in the browser, the finished
 * markup is written to `options.sidecar` (when given).
 *
 * → `{png, sidecar, metrics: {width, height, texts}, log}`; `sidecar` is `null`
 * if none was written. A source error is a `RenderError`, an environment error
 * is a plain `Error`; in both cases no PNG is created.
 */
export async function render(source, kind, options) {
	if (!Object.hasOwn(VIZ_EXT, kind)) throw new Error(`Unsupported kind "${kind}".`);
	if (typeof source !== "string" || !source.trim()) throw new RenderError("the source is empty");
	const png = options?.png;
	if (!png) throw new Error("render() needs options.png.");
	checkSource(source, kind);

	const status = await runChrome(source, kind, png);

	// A source with a script completes itself only in the browser: what sits on
	// disk is a program, and the coordinates appear only in the render. The
	// sidecar is what the maker must read before publishing.
	let sidecar = null;
	if (options.sidecar && status.emitted && /<script[\s>]/i.test(source)) {
		sidecar = options.sidecar;
		fs.writeFileSync(sidecar, `${status.emitted}\n`);
	}
	return { png, sidecar, metrics: status.metrics, log: Array.isArray(status.log) ? status.log : [] };
}

async function runChrome(source, kind, pngPath) {
	const chrome = findChrome();
	const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "viz-chrome-"));
	const child = spawn(
		chrome,
		[
			"--headless=new",
			`--user-data-dir=${profileDir}`,
			"--remote-debugging-port=0",
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-extensions",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
			"--window-size=1800,1400",
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "ignore"], windowsHide: true },
	);

	let cdp = null;
	try {
		const port = await waitForPort(profileDir, child);
		cdp = await connect(await pageTarget(port));

		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		await cdp.send("DOM.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1800,
			height: 1400,
			deviceScaleFactor: 1,
			mobile: false,
		});
		// Without this Chrome puts an opaque white canvas under the screenshot,
		// and the page's transparency never reaches the PNG.
		await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
			color: { r: 0, g: 0, b: 0, a: 0 },
		});

		const url = `${pathToFileURL(HARNESS).href}#${encodeURIComponent(JSON.stringify({ kind, source }))}`;
		await cdp.send("Page.navigate", { url });

		const status = await waitForRender(cdp);
		if (status.state !== "ok") throw new RenderError(status.error || "the source did not render");

		const clip = await elementClip(cdp);
		const scale = Math.max(1, Math.min(2, MAX_PX / clip.width, MAX_PX / clip.height));
		const shot = await cdp.send("Page.captureScreenshot", {
			format: "png",
			clip: { ...clip, scale },
			captureBeyondViewport: true,
		});
		fs.mkdirSync(path.dirname(pngPath), { recursive: true });
		fs.writeFileSync(pngPath, Buffer.from(shot.data, "base64"));
		return status;
	} finally {
		try {
			cdp?.close();
		} catch {
			// The socket may already have closed along with the browser.
		}
		child.kill();
		// Chrome does not release the profile instantly — hence the retries.
		try {
			fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
		} catch {
			// Leftovers in the temp directory are harmless; the render is already done.
		}
	}
}

async function waitForRender(cdp) {
	const deadline = Date.now() + RENDER_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const { result } = await cdp.send("Runtime.evaluate", {
				expression: "window.__viz && window.__viz.state !== 'pending' ? JSON.stringify(window.__viz) : ''",
				returnByValue: true,
			});
			if (result?.value) return JSON.parse(result.value);
		} catch {
			// The execution context changes on navigation — just try again.
		}
		await sleep(80);
	}
	throw new Error("The page did not finish rendering in time.");
}

/**
 * The content rectangle, from the box of the `#out` element. Capturing the
 * element rather than the window is the only thing that saves diagrams with a
 * negative viewBox.
 */
async function elementClip(cdp) {
	const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
	const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#out" });
	if (!nodeId) throw new Error("The harness lost its output element.");
	const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
	const [x1, y1, x2, , , y3] = model.border;
	return { x: x1, y: y1, width: x2 - x1, height: y3 - y1 };
}