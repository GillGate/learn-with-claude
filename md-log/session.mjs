/**
 * The md-log session: everything that lives in the state folder.
 *
 *   <stateDir>/<sid>.json            session state (binding, lesson, backfills)
 *   <stateDir>/<sid>.events.jsonl    event journal of a bound session
 *   <stateDir>/current.json          pointer to the current session, for commands
 *   <stateDir>/.lock                 lock between hook processes
 *   <stateDir>/errors.log            diagnostics: the hook's stdout must not be touched
 *
 * Hooks are parallel processes, so the cycle "read state → write the note →
 * save state" runs under a lock.
 */

import fs from "node:fs";
import path from "node:path";

import { freshLesson } from "./lesson.mjs";

const LOCK_WAIT_MS = 1000;
const LOCK_STALE_MS = 5000;

function freshState(sessionId) {
	return {
		sessionId,
		notePath: null, // absolute path to the bound note
		armed: false, // auto-binding is armed, no note yet
		fallbackTopic: null, // `/learn` arguments: the note name if there is no marker
		queue: [], // lesson operations waiting for a note: since the learner's last remark
		lesson: freshLesson(), // lesson core state
		blocks: {}, // registry of the note's own blocks: id → exact text
		backfilled: [], // notes holding the lesson from the start (backfill, auto-binding); survives unbinding
		transcriptAt: null, // transcript byte up to which thinking prose has been read
	};
}

/** Whether the session writes: there is a note or the binding is armed. */
export function isActive(state) {
	return Boolean(state.notePath || state.armed);
}

/**
 * Binding to a note. The lesson in it continues from the `lesson` state (after
 * a backfill) or from scratch: the previous note's own blocks cannot be found in the new one.
 */
export function bind(state, notePath, lesson = freshLesson()) {
	state.notePath = notePath;
	state.armed = false;
	state.fallbackTopic = null;
	state.queue = [];
	state.lesson = lesson;
	state.blocks = {};
}

/** Unbinding: the session writes again only after a new binding. */
export function unbind(state) {
	Object.assign(state, freshState(state.sessionId), { backfilled: state.backfilled, transcriptAt: state.transcriptAt });
}

/** Whether this is the same file: on Windows path case is not significant. */
export function samePath(a, b) {
	if (!a || !b) return false;
	const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
	return norm(a) === norm(b);
}

/**
 * Whether the note holds the lesson from the start, after a backfill or
 * auto-binding; a repeated backfill would duplicate it (B11).
 */
export function wasBackfilled(state, notePath) {
	return state.backfilled.some((done) => samePath(done, notePath));
}

/** Remember a note in which the lesson is written from the start. */
export function markBackfilled(state, notePath) {
	if (!wasBackfilled(state, notePath)) state.backfilled = [...state.backfilled, notePath];
}

/** Synchronous pause: a hook is a short-lived process, there is nothing else to wait with. */
export function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

const fileKey = (sessionId) => String(sessionId).replace(/[^\w.-]/g, "_");

export function sessionStore(stateDir) {
	const ensureDir = () => fs.mkdirSync(stateDir, { recursive: true });
	const statePath = (sid) => path.join(stateDir, `${fileKey(sid)}.json`);
	const journalPath = (sid) => path.join(stateDir, `${fileKey(sid)}.events.jsonl`);
	const currentPath = path.join(stateDir, "current.json");
	const lockPath = path.join(stateDir, ".lock");

	/** A line in `errors.log`. Does not throw: there is nowhere to log to, and the lesson matters more. */
	function log(where, err) {
		try {
			ensureDir();
			const msg = err && err.stack ? err.stack : String(err);
			fs.appendFileSync(path.join(stateDir, "errors.log"), `[${new Date().toISOString()}] ${where}: ${msg}\n`, "utf8");
		} catch {
			// Stay silent.
		}
	}

	/**
	 * Mutex between hook processes. If the wait runs out, we work without the
	 * lock: losing a paragraph is worse than writing it with someone else's
	 * queue. But this does not pass silently: a line goes to `errors.log`.
	 */
	function withLock(fn) {
		ensureDir();
		const deadline = Date.now() + LOCK_WAIT_MS;
		let held = false;
		for (;;) {
			try {
				fs.mkdirSync(lockPath);
				held = true;
				break;
			} catch {
				try {
					// Abandoned lock: the process may not have lived to release it.
					if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
						fs.rmSync(lockPath, { recursive: true, force: true });
						continue;
					}
				} catch {
					continue; // the lock was released between attempts
				}
				if (Date.now() >= deadline) break;
				sleepSync(25);
			}
		}
		if (!held) log("lock", `lock not acquired within ${LOCK_WAIT_MS} ms — continuing without it`);
		try {
			return fn();
		} finally {
			if (held) fs.rmSync(lockPath, { recursive: true, force: true });
		}
	}

	function load(sessionId) {
		return { ...freshState(sessionId), ...(readJson(statePath(sessionId)) || {}), sessionId };
	}

	function save(state) {
		ensureDir();
		fs.writeFileSync(statePath(state.sessionId), JSON.stringify(state, null, 2), "utf8");
	}

	/** Pointer to the current session: commands have no payload, so they take the session from here. */
	function writeCurrent({ sessionId, transcriptPath, cwd }) {
		ensureDir();
		fs.writeFileSync(
			currentPath,
			JSON.stringify({ sessionId, transcriptPath, cwd, at: new Date().toISOString() }, null, 2),
			"utf8",
		);
	}

	function readCurrent() {
		const cur = readJson(currentPath);
		return cur && cur.sessionId ? cur : null;
	}

	/** The journal is append-only; only tests and replay read it. */
	function appendJournal(sessionId, entry) {
		ensureDir();
		fs.appendFileSync(journalPath(sessionId), `${JSON.stringify(entry)}\n`, "utf8");
	}

	return { log, withLock, load, save, writeCurrent, readCurrent, appendJournal };
}