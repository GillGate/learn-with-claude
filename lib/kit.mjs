/**
 * Kit constants — the one place that records how `.claude/` is laid out and
 * where working data lives. Shared by md-log and visuals.
 *
 * Path literals in command texts, agents and `settings.json` are not covered
 * by this module.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Kit version. Bumped by hand on every change to the kit: it shows in
 * `errors.log` when the kit copy in the vault has fallen behind the repository.
 */
export const KIT_VERSION = "2.2.0";

/** Kit folder (`.claude/`) — absolute path and name. */
export const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KIT_DIR_NAME = ".claude";

/** Kit config and the environment variable that overrides it. */
export const CONFIG_FILE = path.join(KIT_DIR, "md-log.config.json");
export const CONFIG_ENV = "MD_LOG_CONFIG";

/** Visual render script — path from the session folder, as agents write it. */
export const RENDER_SCRIPT = `${KIT_DIR_NAME}/scripts/render-viz.mjs`;

/** Working data lives in the session folder (ADR 0007). */
export const STATE_DIR = ".md-log";
export const WORK_DIR = ".viz-temp";

/** Default note and image directories — relative to the session folder. */
export const NOTES_DIR = "notes";
export const IMG_DIR = "img";

/** Visual source extensions: one per kind. */
export const VIZ_EXT = Object.freeze({ mermaid: ".mmd", svg: ".svg" });