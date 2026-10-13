#!/usr/bin/env node
/**
 * viz-allow — a `PreToolUse` hook on Bash: lets the makers' render commands
 * through without a permission prompt. A thin entry point; the rule itself is
 * `viz-allow-rule.mjs`.
 *
 * The hook **only allows**. No match — it stays silent and exits with zero, and
 * the normal permission flow takes over: the user is asked, just as they would
 * be without the hook. The hook never denies: it must not be able to break a
 * session. Any exception is also a silent exit with zero.
 */

import fs from "node:fs";

import { allowed } from "./viz-allow-rule.mjs";

try {
	const payload = JSON.parse(fs.readFileSync(0, "utf8"));
	if (payload?.tool_name === "Bash" && allowed(payload?.tool_input?.command, payload?.cwd)) {
		process.stdout.write(
			JSON.stringify({
				hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
			}),
		);
	}
} catch {
	// Stay silent: with no hook decision, the normal permission flow continues.
}
process.exit(0);