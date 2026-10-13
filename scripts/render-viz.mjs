#!/usr/bin/env node
/**
 * render-viz — the only way to turn a visual source into a PNG. A thin
 * command-line entry point; the render itself is `render.mjs` alongside.
 *
 *   node .claude/scripts/render-viz.mjs <file.mmd|file.svg> [--save <slug>]
 *
 * Without `--save` — a preview: the PNG is placed next to the source and the
 * path is printed to stdout. With `--save` — publication to the image directory
 * (`imgDir` of the shared config, `lib/config.mjs`) as
 * `viz-<slug>-<timestamp>.png`. The session folder is the process working
 * directory: the maker calls the renderer from the session root; the
 * permission hook lets no other form through.
 *
 * Exit codes: 0 — PNG ready, 1 — render or environment error, 2 — invalid
 * arguments.
 */

import fs from "node:fs";
import path from "node:path";

import { resolveConfig } from "../lib/config.mjs";
import { RENDER_SCRIPT, VIZ_EXT } from "../lib/kit.mjs";
import { findChrome, kindOf, render } from "./render.mjs";

const EXTS = Object.values(VIZ_EXT);

function usage(message) {
	process.stderr.write(
		`${message}\n\nusage: node ${RENDER_SCRIPT} <${EXTS.map((ext) => `file${ext}`).join("|")}> [--save <slug>]\n`,
	);
	process.exit(2);
}

function die(message) {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

function parseArgs(argv) {
	let input = null;
	let save = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--save") {
			save = argv[++i];
			if (!save) usage("`--save` needs a slug.");
		} else if (arg.startsWith("--")) {
			usage(`Unknown option: ${arg}`);
		} else if (input === null) {
			input = arg;
		} else {
			usage("Only one source file at a time.");
		}
	}
	if (!input) usage("No source file given.");
	return { input, save };
}

/** The published name is the author's: uniqueness keeps same-named attachments apart. */
function publishedName(slug) {
	const clean =
		String(slug)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "viz";
	return `viz-${clean}-${Date.now()}.png`;
}

const { input, save } = parseArgs(process.argv.slice(2));
const root = process.cwd();
const sourcePath = path.resolve(root, input);
if (!fs.existsSync(sourcePath)) die(`No such file: ${sourcePath}`);
const kind = kindOf(sourcePath);
if (!kind) usage(`Unsupported extension "${path.extname(sourcePath).toLowerCase()}" — use ${EXTS.join(" or ")}.`);
const source = fs.readFileSync(sourcePath, "utf8");
if (!source.trim()) die(`The source file is empty: ${sourcePath}`);
// No browser is an environment cause, not a render one: printed without `Render failed:`.
try {
	findChrome();
} catch (error) {
	die(error.message);
}

const stem = path.join(path.dirname(sourcePath), path.basename(sourcePath, path.extname(sourcePath)));
// The preview lands next to the source, in the maker's working directory: it
// has permissions there, and only `--save` still reaches the Obsidian vault.
const png = save ? path.join(resolveConfig({ root }).imgDir, publishedName(save)) : `${stem}-preview.png`;

try {
	const { sidecar, metrics, log } = await render(source, kind, { png, sidecar: `${stem}-expanded.svg` });
	const lines = [];
	if (save) lines.push(`filename: ${path.basename(png)}`);
	lines.push(`path: ${png}`);
	if (sidecar) lines.push(`expanded: ${sidecar}`);
	// Measured size and label count are cheap insurance against a silently
	// empty frame: if this line disagrees with what the maker sees with its
	// own eyes, the render lied.
	lines.push(`${metrics.width}×${metrics.height}, ${metrics.texts} text node${metrics.texts === 1 ? "" : "s"}`);
	// The image script's `console.log`: counting stays inside the renderer,
	// only what was printed comes out.
	for (const entry of log) lines.push(`log: ${entry}`);
	process.stdout.write(`${lines.join("\n")}\n`);
} catch (error) {
	die(`Render failed: ${error?.message || error}`);
}