/**
 * Rule of the `viz-allow` hook: `allowed(command, cwd)` — lets makers run
 * exactly three command forms, and nothing else.
 *
 *   node .claude/scripts/render-viz.mjs .viz-temp/<name>.mmd|.svg
 *   node .claude/scripts/render-viz.mjs .viz-temp/<name>.mmd|.svg --save <slug>
 *   mkdir -p .viz-temp
 *
 * The script, working folder and extensions come from the kit constants
 * (`lib/kit.mjs`) — the same ones the renderer uses. Why a hook rather than a
 * Bash rule, and where the `mkdir` concession comes from — ADR 0014.
 *
 * Command parsing is conservative by construction:
 *   - the command is split on all shell separators, and **every** part must
 *     match — otherwise `render-viz … && rm -rf …` would pass as a whole;
 *   - the pattern is anchored at both ends and allows a narrow set of
 *     characters, so substitutions (`$(…)`, quotes, redirections) do not match
 *     and fall through to the normal permission prompt;
 *   - `..` in a path is rejected separately: the pattern alone would let it by.
 *
 * The one concession is a leading `cd <session root>`: the model prepends it on
 * its own, and it grants no rights. Every Bash call already starts in the
 * session `cwd`, so this `cd` is a no-op; a `cd` anywhere else the rule does
 * not let through, otherwise the relative path in the pattern would stop
 * meaning anything.
 */

import path from "node:path";

import { RENDER_SCRIPT, VIZ_EXT, WORK_DIR } from "../lib/kit.mjs";

/** A path literal as a pattern: special characters escaped, `/` also accepts `\`. */
function pathPattern(literal) {
	return literal
		.split("/")
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("[\\\\/]");
}

const EXTS = Object.values(VIZ_EXT)
	.map((ext) => ext.slice(1))
	.join("|");

const RENDER = new RegExp(
	`^node\\s+${pathPattern(RENDER_SCRIPT)}\\s+${pathPattern(WORK_DIR)}[\\\\/][A-Za-z0-9_.-]+\\.(?:${EXTS})(?:\\s+--save\\s+[A-Za-z0-9_-]+)?$`,
);

const MKDIR = new RegExp(`^mkdir\\s+-p\\s+${pathPattern(WORK_DIR)}[\\\\/]?$`);

// Shell separators that Claude Code treats as a subcommand boundary.
// Longer ones first, otherwise `&&` would be parsed as two `&`.
const SEPARATORS = /&&|\|\||\|&|[;|&\n]/;

const CD = /^cd\s+(?:"([^"]*)"|'([^']*)'|([^\s"']+))$/;

/** A Git Bash path (`/d/WebDev/…`) converted to a form `path` understands on Windows. */
function toNative(raw) {
	const msys = /^\/([A-Za-z])(\/.*)?$/.exec(raw);
	return msys ? `${msys[1]}:${msys[2] || "/"}` : raw;
}

function samePath(a, b) {
	const one = path.resolve(toNative(a));
	const two = path.resolve(toNative(b));
	return process.platform === "win32" ? one.toLowerCase() === two.toLowerCase() : one === two;
}

/** Whether the Bash command `command`, run in the session folder `cwd`, is allowed. */
export function allowed(command, cwd) {
	if (typeof command !== "string") return false;
	const parts = command.split(SEPARATORS).map((part) => part.trim());
	// A leading `cd` to the session root is a no-op: strip it and judge the rest.
	const cd = CD.exec(parts[0]);
	const target = cd && (cd[1] ?? cd[2] ?? cd[3]);
	if (parts.length > 1 && target && typeof cwd === "string" && samePath(target, cwd)) parts.shift();
	return parts.every((one) => one !== "" && !one.includes("..") && (RENDER.test(one) || MKDIR.test(one)));
}