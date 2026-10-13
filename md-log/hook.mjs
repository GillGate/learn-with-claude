#!/usr/bin/env node
/**
 * The md-log hook process and its binding commands (`/md-log`, `/md-unlog`).
 *
 *   node .claude/md-log/hook.mjs <mode>          hook: payload on stdin
 *   node .claude/md-log/hook.mjs link <path>     command: output goes to the user
 *   node .claude/md-log/hook.mjs unlink
 *
 * The config path is overridden by the `MD_LOG_CONFIG` variable (see `lib/kit.mjs`).
 * Always exits 0. A hook's stdout is empty, except for an output guard denial in
 * `question`: JSON with `permissionDecision: "deny"`, whose reason the model reads.
 */

import fs from "node:fs";

import { resolveConfig } from "../lib/config.mjs";
import { handle } from "./handle.mjs";

function readPayload() {
	try {
		return JSON.parse(fs.readFileSync(0, "utf8"));
	} catch {
		return null;
	}
}

function main() {
	const mode = process.argv[2] || "";
	if (mode === "link" || mode === "unlink") {
		// Commands have no stdin or payload: the session folder is the process working directory.
		const root = process.cwd();
		const out = handle(mode, { args: process.argv.slice(3).join(" ") }, { root, config: resolveConfig({ root }) });
		process.stdout.write(out);
		return;
	}
	const payload = readPayload();
	const root = payload && typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
	process.stdout.write(handle(mode, payload, { root, config: resolveConfig({ root }) }));
}

try {
	main();
} catch {
	// `handle` writes to errors.log itself; only what broke before it gets here,
	// and then there is nowhere to write.
}
process.exit(0);