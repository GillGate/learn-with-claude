/**
 * The md-log entry point: `handle(mode, payload, {root, config})`.
 *
 *   payload → fromHook → events → reduce → operations → NoteEditor → one write
 *                                  ↘ journal
 *
 * Entry discipline: never throws, diagnostics go only to `errors.log`, an
 * unfamiliar payload is skipped. Returns what the process prints to stdout: text
 * for the user for the `link` / `unlink` commands, the output guard's denial
 * decision for `question` (from where it goes to the model); otherwise an empty
 * string.
 */

import fs from "node:fs";
import path from "node:path";

import { KIT_VERSION } from "../lib/kit.mjs";
import { fromHook, fromTranscript, guardDeny, HOOK_MODES, parseJsonl, tailEvents } from "./events.mjs";
import { noteName } from "./format.mjs";
import { decide, denyOutput, slateDenies } from "./guard.mjs";
import { freshLesson, reduce, referencedBlocks } from "./lesson.mjs";
import { createNote, noteEditor, readNote, writeNote } from "./note.mjs";
import { bind, isActive, markBackfilled, samePath, sessionStore, sleepSync, unbind, wasBackfilled } from "./session.mjs";

// A current-session pointer older than this means `/md-log` may have picked up
// someone else's session: the command has no payload, and there is no `session_id` in the Bash environment.
const CURRENT_STALE_MS = 20_000;

// The order of `MessageDisplay` and `PreToolUse` is not documented: the last
// lead-in delta may arrive later than the question (in the `4689e440-…` journal, by 8 ms). The guard,
// not seeing text, waits this long for it, rereading the state, and only then denies.
const GUARD_WAIT_MS = 300;
const GUARD_POLL_MS = 25;

const policyOf = (config) => ({ dedupeQuestions: config.dedupeQuestions, autolink: config.autolink });

/** The `/learn` arguments if the remark is that command; otherwise `null`. */
const learnArgs = (event) =>
	event.type === "user" && event.command && event.command.name === "learn" ? event.command.args || "" : null;

/**
 * An event → session state and note operations. Does not touch the disk.
 * → `true` if the lesson produced output that needs a note (not a lone remark).
 *
 * Without a note the core still runs while auto-binding is enabled: the topic
 * marker is looked for in the accumulated message buffer, and the buffer is core
 * state. Its operations wait in the queue; for an unarmed session the queue
 * starts over with each learner remark — the note, if one appears, starts from it.
 */
function apply(state, event, config, ops, log) {
	if (!isActive(state) && event.type === "user") {
		state.lesson = freshLesson();
		state.queue = [];
		// First trigger: `/learn` arms the binding, the arguments are the fallback name.
		if (config.autolink && learnArgs(event) !== null) {
			state.armed = true;
			state.fallbackTopic = learnArgs(event);
		}
	}
	if (!isActive(state) && !config.autolink) return false;
	const next = reduce(state.lesson, event, policyOf(config));
	state.lesson = next.state;
	if (state.notePath) {
		ops.push(...next.ops);
		log.push(...next.log);
		return false;
	}
	// Second trigger: the topic marker — the `learn` skill fired without the command.
	if (!state.armed && next.state.topic) state.armed = true;
	state.queue.push(...next.ops);
	if (!state.armed) return false;
	log.push(...next.log);
	return event.type !== "user" && next.ops.length > 0;
}

/**
 * The auto-binding note is born with the first piece of the lesson: by then the
 * model has already named the topic with a marker. The queue goes into it.
 */
function createFromQueue(store, state, config, ops, mode) {
	if (!state.lesson.topic) store.log(mode, "topic marker not found — note named from the prompt text");
	const queued = state.queue;
	const notePath = createNote(config.notesDir, noteName(state.lesson.topic || state.fallbackTopic));
	bind(state, notePath, state.lesson);
	// The lesson in it is from the start, as after a backfill: returning to it via
	// `link` must not append it again (B11).
	markBackfilled(state, notePath);
	ops.push(...queued);
}

/** The operations of all the hook's events — in one note write. */
function commit(state, ops, log) {
	if (!ops.length) return;
	const editor = noteEditor(readNote(state.notePath), state.blocks);
	for (const op of ops) editor.apply(op);
	editor.retain(referencedBlocks(state.lesson));
	const result = editor.commit();
	state.blocks = result.registry;
	for (const id of result.conflicts) log(`own block ${id} not found verbatim — the learner edited the note, block left alone`);
	if (result.changed) writeNote(state.notePath, result.text);
}

/** The events of one hook, under an already held lock. */
function ingest(store, sessionId, { mode, events: hookEvents, raw, config, journal, transcriptPath }) {
	const state = store.load(sessionId);
	const was = JSON.stringify(state);
	// The transcript tail comes before the hook's events: it was written earlier than they were.
	const events = [...takeTail(state, transcriptPath, mode, config), ...hookEvents];
	const ops = [];
	const log = [];
	// The journal comes before applying: the event the core broke on is needed most.
	// A session armed by the event itself (`/learn`) is journaled by the repeat check.
	let journaled = false;
	const record = () => {
		if (!journal || journaled || !isActive(state)) return;
		const entry = { at: new Date().toISOString(), mode, events };
		if (config.rawPayload) entry.raw = raw;
		store.appendJournal(sessionId, entry);
		journaled = true;
	};
	record();
	let due = false;
	for (const event of events) due = apply(state, event, config, ops, log) || due;
	record();
	if (due && !state.notePath && state.armed) createFromQueue(store, state, config, ops, mode);

	for (const line of log) store.log(mode, line);
	if (state.notePath) commit(state, ops, (line) => store.log(mode, line));
	if (JSON.stringify(state) !== was) store.save(state);
}

/**
 * The output guard: what the question lacks (`"slate"` — "I don't know" not
 * last), or `null`. It looks at the lesson state together with the transcript
 * tail not yet taken — `ingest` of this same hook will take it. Outside a lesson
 * it does not check. Its own error means letting the call through, not denying it.
 */
function guardMissing(store, state, transcriptPath, questions) {
	if (!isActive(state)) return null;
	try {
		let lesson = state.lesson;
		for (const event of peekTail(state, transcriptPath)) lesson = reduce(lesson, event).state;
		if (slateDenies(lesson.guard, questions, lesson.labels)) return "slate";
		const what = decide(lesson.guard);
		// After a resume the lead-in was already in the earlier context; a debrief after an answer is always needed.
		return what === "lead-in" && lesson.resumed ? null : what;
	} catch (err) {
		store.log("question", err);
		return null;
	}
}

/**
 * `PreToolUse(AskUserQuestion)`: the guard's decision and the question event. A
 * denied question is journaled as a `guard-deny` event instead of `question`, so
 * replay will not write it into the note. Waiting for late text happens without
 * the lock: otherwise the delta hook could not bring it. → the hook's stdout.
 */
function askQuestion(store, sessionId, payload, ctx) {
	const deadline = Date.now() + GUARD_WAIT_MS;
	for (;;) {
		const out = store.withLock(() => {
			const questions = payload && payload.tool_input && payload.tool_input.questions;
			const what = guardMissing(store, store.load(sessionId), ctx.transcriptPath, questions);
			// The option order does not depend on late text — nothing to wait for.
			if (what && what !== "slate" && Date.now() < deadline) return null;
			const events = what ? [guardDeny(payload, what)] : fromHook("question", payload);
			ingest(store, sessionId, { ...ctx, mode: "question", events, raw: payload, journal: true });
			return what ? denyOutput(what) : "";
		});
		if (out !== null) return out;
		sleepSync(GUARD_POLL_MS);
	}
}

function readTranscript(transcriptPath) {
	if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
	return parseJsonl(fs.readFileSync(transcriptPath, "utf8"));
}

/** Transcript size in bytes; no file means 0. */
function transcriptSize(transcriptPath) {
	try {
		return fs.statSync(transcriptPath).size;
	} catch {
		return 0;
	}
}

/**
 * Whole transcript lines from byte `from` → `{records, end}`. An unfinished last
 * line is left for next time. If the file got shorter, there is nothing to read.
 */
function readTail(transcriptPath, from) {
	const size = transcriptSize(transcriptPath);
	if (from >= size) return { records: [], end: Math.min(from, size) };
	const buf = Buffer.alloc(size - from);
	const fd = fs.openSync(transcriptPath, "r");
	try {
		fs.readSync(fd, buf, 0, buf.length, from);
	} finally {
		fs.closeSync(fd);
	}
	const last = buf.lastIndexOf(0x0a);
	if (last < 0) return { records: [], end: from };
	return { records: parseJsonl(buf.subarray(0, last).toString("utf8")), end: from + last + 1 };
}

/**
 * Events from transcript records that appeared since the previous hook
 * (`tailEvents`): thinking prose (ADR 0017) and text evidence for the guard.
 * Deltas come too often to read the file on each, so they are skipped: the
 * nearest other hook picks up the tail. Advances the read position. A session's
 * first read only remembers the end of the file: the past is the backfill's job.
 * Resume and compaction do not reset the position: prose printed before them has
 * not been taken yet.
 */
function takeTail(state, transcriptPath, mode, config) {
	if (!transcriptPath || mode === "message") return [];
	if (state.transcriptAt === null) {
		state.transcriptAt = transcriptSize(transcriptPath);
		return [];
	}
	if (!isActive(state) && !config.autolink) return [];
	const tail = readTail(transcriptPath, state.transcriptAt);
	state.transcriptAt = tail.end;
	return tailEvents(tail.records);
}

/** The transcript tail the next hook will take, without advancing the read position. */
function peekTail(state, transcriptPath) {
	if (!transcriptPath || state.transcriptAt === null) return [];
	return tailEvents(readTail(transcriptPath, state.transcriptAt).records);
}

/**
 * The session's past from the transcript, through the same core as live writing:
 * `fromTranscript` → `reduce`. → `{lesson, ops, learn}`: the lesson state from
 * which live writing will continue, the note operations and the `/learn` arguments.
 */
function pastLesson(transcriptPath, config) {
	let events = fromTranscript(readTranscript(transcriptPath));
	// The turn of the `/md-log` command itself is already running live: text the transcript
	// managed to record will also arrive as a delta — the backfill ends at the call.
	const call = events.findLastIndex((e) => e.type === "user" && e.command && e.command.name === "md-log");
	if (call !== -1) events = events.slice(0, call + 1);
	// The end of what was recorded counts as the end of a turn: the tail of the last message is emitted.
	events.push({ type: "stop", lastMessage: "" });
	let lesson = freshLesson();
	const ops = [];
	let learn = null;
	for (const event of events) {
		if (learn === null) learn = learnArgs(event);
		const next = reduce(lesson, event, policyOf(config));
		lesson = next.state;
		ops.push(...next.ops);
	}
	return { lesson, ops, learn };
}

/**
 * A command reply line for the learner. The kit version is in every one, in a
 * refusal too: a stale copy of the kit in the vault is what most often fails.
 */
const reply = (text, tail = "") => `md-log: ${text} (kit ${KIT_VERSION}).${tail}\n`;

function link(store, root, config, args) {
	const cur = store.readCurrent();
	if (!cur) return reply("session unknown — restart Claude Code so the SessionStart hook fires");
	const arg = String(args || "").trim();
	let notePath = null;
	if (arg) {
		notePath = path.resolve(root, arg);
		// The file must exist: a typo in the path must not scatter empty notes
		// across the vault.
		if (!fs.existsSync(notePath) || !fs.statSync(notePath).isFile()) return reply(`no such file — ${notePath}`);
	}
	const state = store.load(cur.sessionId);
	if (notePath && samePath(notePath, state.notePath)) return reply(`note already bound — ${state.notePath}`);

	const past = pastLesson(cur.transcriptPath, config);
	if (!notePath) notePath = createNote(config.notesDir, noteName(past.lesson.topic || past.learn));
	// Backfill happens once per note: a repeat would duplicate the lesson (B11).
	const backfill = !wasBackfilled(state, notePath);
	if (backfill) {
		bind(state, notePath, past.lesson);
		commit(state, past.ops, (line) => store.log("link", line));
		markBackfilled(state, notePath);
	} else {
		// The registry of written messages stays: the fallback write on `Stop` must not bring
		// back into the note a message that is already in it.
		bind(state, notePath, { ...freshLesson(), written: past.lesson.written });
	}
	// The transcript's past is already in the lesson: live writing reads only what is new.
	state.transcriptAt = transcriptSize(cur.transcriptPath);
	store.save(state);

	const done = backfill ? ", lesson written in from the start" : "";
	// One line: service output stays out of the note only as a whole paragraph.
	return reply(`note bound — ${notePath}${done}`, staleWarning(cur));
}

/** A warning if the current-session pointer is stale; otherwise empty. */
function staleWarning(cur) {
	const age = Date.now() - Date.parse(cur.at);
	if (age <= CURRENT_STALE_MS) return "";
	const ago = Number.isNaN(age) ? "time unknown" : `${Math.round(age / 1000)} s`;
	return ` Warning: the current-session record is stale (${ago}) — if several terminals are open, check that this session is the one writing to the note.`;
}

function unlink(store) {
	const cur = store.readCurrent();
	if (!cur) return reply("session unknown");
	const state = store.load(cur.sessionId);
	if (!isActive(state)) return reply("note not bound");
	const was = state.notePath || "(note not created yet)";
	unbind(state);
	store.save(state);
	return reply(`unbound — ${was}`);
}

function reportConfig(store, config) {
	for (const problem of config.problems || []) store.log("config", problem);
}

export function handle(mode, payload, { root, config }) {
	const store = sessionStore(config.stateDir);
	try {
		if (mode === "link" || mode === "unlink") {
			reportConfig(store, config);
			return store.withLock(() =>
				mode === "link" ? link(store, root, config, payload && payload.args) : unlink(store),
			);
		}
		if (!HOOK_MODES.includes(mode)) {
			store.log("handle", `unknown mode: ${mode}`);
			return "";
		}
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
		const sessionId = typeof payload.session_id === "string" && payload.session_id ? payload.session_id : null;
		if (!sessionId) return "";

		const transcriptPath = typeof payload.transcript_path === "string" && payload.transcript_path ? payload.transcript_path : null;
		if (mode === "question") return askQuestion(store, sessionId, payload, { config, transcriptPath });
		store.withLock(() => {
			if (mode === "session-start") {
				store.log("session-start", `kit ${KIT_VERSION}, session ${sessionId}`);
				reportConfig(store, config);
			}
			if (mode === "session-start" || mode === "prompt") {
				store.writeCurrent({ sessionId, transcriptPath, cwd: root });
			}
			ingest(store, sessionId, { mode, events: fromHook(mode, payload), raw: payload, config, journal: true, transcriptPath });
		});
	} catch (err) {
		store.log(mode || "handle", err);
	}
	return "";
}

/**
 * Journal replay: `{mode, events}` entries go through the same path as live
 * hooks, but without a payload and without writing to the journal. For tests and investigations.
 */
export function replay(entries, { config, sessionId }) {
	const store = sessionStore(config.stateDir);
	store.withLock(() => {
		for (const entry of entries) {
			ingest(store, sessionId, { mode: entry.mode, events: entry.events || [], raw: null, config, journal: false });
		}
	});
}