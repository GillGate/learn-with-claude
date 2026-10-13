/**
 * Kit config. Shared by md-log and visuals.
 *
 * All directories are resolved from a single folder — the session folder
 * (ADR 0007): for the hook that is `cwd` from the payload, for commands and the
 * renderer — the process working directory. The config file path can be
 * overridden by an environment variable — that is how the tests work.
 */

import fs from "node:fs";
import path from "node:path";

import { CONFIG_ENV, CONFIG_FILE, IMG_DIR, NOTES_DIR, STATE_DIR } from "./kit.mjs";

function dirOf(root, value, fallback) {
	const dir = typeof value === "string" && value.trim() ? value.trim() : fallback;
	return path.resolve(root, dir);
}

/**
 * → `{configPath, notesDir, imgDir, stateDir, autolink, dedupeQuestions,
 * rawPayload, problems}`. Directories are absolute. Never throws: no file —
 * defaults; broken file — the same defaults plus a line in `problems`, which the
 * caller writes to its own error log.
 */
export function resolveConfig({ root, env = process.env }) {
	const override = env && typeof env[CONFIG_ENV] === "string" && env[CONFIG_ENV].trim();
	const configPath = override ? path.resolve(root, override) : CONFIG_FILE;
	const problems = [];

	let raw = {};
	if (fs.existsSync(configPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
			else problems.push(`config is not an object — using defaults: ${configPath}`);
		} catch (err) {
			problems.push(`config is unreadable — using defaults: ${configPath}: ${err.message}`);
		}
	}

	return {
		configPath,
		notesDir: dirOf(root, raw.notesDir, NOTES_DIR),
		imgDir: dirOf(root, raw.imgDir, IMG_DIR),
		stateDir: dirOf(root, raw.stateDir, STATE_DIR),
		autolink: raw.autolink !== false,
		// The only policy that removes anything from the note — so it is
		// enabled explicitly, not by default.
		dedupeQuestions: raw.dedupeQuestions === true,
		// Raw payload in the log is for probing, not for every lesson.
		rawPayload: raw.rawPayload === true,
		problems,
	};
}