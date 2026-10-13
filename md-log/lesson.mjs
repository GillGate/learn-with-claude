/**
 * Lesson: the pure core of md-log: `reduce(state, event, policy) → {state, ops, log}`.
 *
 * All lesson rules live here: slicing prose, the question relay, recoloring
 * by verdict, removing duplicates, the fallback write on `Stop`. The core does
 * not touch the disk: it issues operations on the note (`note.mjs`) and lines
 * for `errors.log`. Events come from the `events.mjs` adapter.
 *
 * State:
 *   msg      the teacher message currently being printed: `{id, buf, text, opened,
 *            next, early}`. `buf` is the tail not yet sent to the note; `text` is
 *            the whole message, for the registry of written ones; `opened` means
 *            the "CLAUDE" header is already written; `next` is the number of the
 *            expected delta, `early` the deltas that arrived ahead of their turn,
 *            `seen` the numbers already taken
 *   pending  a question waiting for the prose above it to end (relay, ADR 0005)
 *   open     a written question hanging on screen unanswered: prose that arrives
 *            as a delta while it hangs goes above it
 *   last     the last written question without an answer, for removing duplicates
 *   answer   an answer block with an anchor, awaiting a verdict (ADR 0006): `{id, lines, key}`,
 *            `key` is the options and the student's choice for building the colored block (ADR 0020)
 *   written  registry of written messages: fingerprints of their text
 *   topic    the topic from the marker
 *   labels   note labels from the labels marker (ADR 0021); `null` means English
 *   unlabeled student turns written before the labels marker: `{id, text}` — their
 *            header is rewritten when the labels arrive
 *   seq      counter of identifiers for own blocks
 *   guard    what has been printed since the student's last input, for the output
 *            guard (`guard.mjs`)
 *   resumed  the session was resumed and no assistant text has appeared since: the
 *            guard does not demand a lead-in the model already printed before the resume
 */

import { createHash } from "node:crypto";

import { lessonMarkers } from "./events.mjs";
import {
	afterInput,
	asked,
	denied,
	denyLog,
	freshGuard,
	FUSE,
	fused,
	heard,
	inputWritten,
	isGraded,
	opensFirst,
	slateDenied,
	wrote,
} from "./guard.mjs";
import {
	answerKey,
	answerLines,
	assistantBlock,
	balanced,
	closeUnbalanced,
	coloredAnswerBlock,
	neutralAnswerBlock,
	parseLabels,
	questionBlock,
	questionKey,
	relabelWhy,
	userBlock,
	verdictBlock,
	verdictOf,
} from "./format.mjs";

// The registry of written messages only needs to remember recent ones: `Stop`
// brings the last message of the turn, and a turn without text brings the last
// of the previous ones.
const WRITTEN_MAX = 20;

// The start of a topic or labels marker with no end: its second half is still on the way.
const OPEN_MARKER_RE = /<!--\s*(?:topic|labels)(?![\s\S]*-->)/i;

// There is usually one turn before the labels marker: `/learn …`. More means a lesson without a marker.
const UNLABELED_MAX = 3;

export function freshLesson() {
	return {
		seq: 0,
		msg: null,
		pending: null,
		open: null,
		last: null,
		answer: null,
		written: [],
		topic: null,
		labels: null,
		unlabeled: [],
		guard: freshGuard(),
		resumed: false,
	};
}

/**
 * A teacher message that has started printing. `isFirst` means the first one
 * after student input or a guard denial: the guard checks its text for a debrief.
 */
function newMessage(id, isFirst = false) {
	return { id, buf: "", text: "", opened: false, next: 0, early: {}, seen: [], isFirst, why: false };
}

/** Own blocks the state still references; the note may forget the rest. */
export function referencedBlocks(state) {
	return [
		state.open,
		state.last && state.last.id,
		state.answer && state.answer.id,
		...(state.unlabeled || []).map((u) => u.id),
	].filter(Boolean);
}

/** Message fingerprint: whitespace and lesson markers do not affect the comparison. */
function fingerprint(text) {
	const body = lessonMarkers(String(text)).text.replace(/\s+/g, "");
	return body ? createHash("sha1").update(body).digest("hex").slice(0, 16) : null;
}

export function reduce(state, event, policy = {}) {
	const s = structuredClone({ ...freshLesson(), ...state });
	if (s.msg) s.msg = { ...newMessage(s.msg.id), ...s.msg };
	const ops = [];
	const log = [];
	const nextId = (prefix) => `${prefix}${++s.seq}`;

	/** No debrief will come for the answer block: drop the anchor, the block stays neutral. */
	function dropAnswer() {
		if (!s.answer) return;
		ops.push({ op: "unlabel", id: s.answer.id });
		s.answer = null;
	}

	/** Prose into the note: while a question hangs on screen, nothing can appear below it. */
	function prose(text) {
		if (s.open) ops.push({ op: "insertBefore", before: s.open, text });
		else ops.push({ op: "append", text });
	}

	/**
	 * A chunk of prose. The first chunk of a message is special: it opens the
	 * "CLAUDE" block, or turns out to be a debrief and recolors the answer block.
	 */
	function emitProse(chunk) {
		const body = chunk.trim();
		if (!body) return;
		if (s.msg.opened) {
			// The first chunk after the debrief head starts with "Why".
			if (s.msg.why) {
				s.msg.why = false;
				return prose(relabelWhy(body, s.labels));
			}
			return prose(body);
		}
		s.msg.opened = true;

		const verdict = verdictOf(body);
		// A debrief is proof that the question was answered (in words, bypassing
		// the widget): a same-named question after it no longer replaces it.
		if (verdict) s.last = null;

		if (s.answer && verdict) {
			const { id, lines, key } = s.answer;
			s.answer = null;
			// If the student edited the answer block, it is left alone and the debrief
			// head goes as a separate colored block: nothing is lost.
			ops.push({
				op: "replace",
				id,
				text: coloredAnswerBlock(verdict, lines, key, s.labels),
				orElse: verdictBlock(verdict, key, s.labels),
			});
			if (verdict.rest) prose(relabelWhy(verdict.rest, s.labels));
			else s.msg.why = true;
			return;
		}
		// No debrief will come (the question is ungraded).
		dropAnswer();
		prose(assistantBlock(body));
	}

	/**
	 * Sends to the note everything that has formed whole paragraphs; `force`
	 * sends everything. Cutting is allowed only at a blank line outside a fence
	 * and a formula.
	 */
	function flushBuffer(force) {
		const m = s.msg;
		if (!m || !m.buf) return;
		// The marker is searched for in the accumulated buffer: a delta may have
		// brought half of it. An unclosed comment start holds the buffer until the next delta.
		const found = lessonMarkers(m.buf);
		m.buf = found.text;
		if (found.topic && !s.topic) s.topic = found.topic;
		if (found.labels !== null && !s.labels) takeLabels(found.labels);
		let cut = -1;
		let resume = -1;
		const re = /\n[ \t]*\n/g;
		for (let hit; (hit = re.exec(m.buf)); ) {
			const candidate = m.buf.slice(0, hit.index);
			if (!balanced(candidate) || OPEN_MARKER_RE.test(candidate)) continue;
			cut = hit.index;
			resume = hit.index + hit[0].length;
		}
		if (force) cut = resume = m.buf.length;
		if (cut < 0) return;
		let chunk = m.buf.slice(0, cut);
		m.buf = m.buf.slice(resume);
		if (force && !balanced(chunk)) {
			chunk = closeUnbalanced(chunk);
			log.push("unclosed code fence/formula on a forced write — closed automatically");
		}
		emitProse(chunk);
	}

	/**
	 * Lesson labels from the marker. Student turns written before it get a
	 * header in the lesson labels.
	 */
	function takeLabels(body) {
		const { labels, unknown } = parseLabels(body);
		if (unknown.length) log.push(`labels marker: keys not in the template — ${unknown.join(", ")}`);
		if (!labels) {
			log.push("labels marker without key=translation pairs — labels stay English");
			return;
		}
		s.labels = labels;
		for (const u of s.unlabeled) ops.push({ op: "replace", id: u.id, text: userBlock(u.text, labels) });
		s.unlabeled = [];
	}

	/** Delta text goes into the message buffer. */
	function extend(text, index) {
		s.msg.buf += text || "";
		s.msg.text += text || "";
		s.guard = heard(s.guard, text || "", s.msg.isFirst);
		if (index !== null) {
			s.msg.next = Math.max(s.msg.next, index + 1);
			s.msg.seen.push(index);
		}
	}

	/** A delta in its turn; `final` closes the message. */
	function take(text, final, index) {
		extend(text, index);
		flushBuffer(false);
		if (final) settle({ close: true });
	}

	/**
	 * Deltas that did not get their missing predecessor go in order of number:
	 * the message is ending, there is nothing more to wait for. `final` is not
	 * needed — the message is being handed over whole anyway.
	 */
	function drainEarly() {
		const m = s.msg;
		if (!m) return;
		for (const index of Object.keys(m.early).map(Number).sort((a, b) => a - b)) extend(m.early[index].text, index);
		m.early = {};
	}

	function remember(text) {
		const print = fingerprint(text);
		if (print && !s.written.includes(print)) s.written = [...s.written, print].slice(-WRITTEN_MAX);
	}

	/**
	 * The single relay rule: first all the prose of the message, then the pending
	 * question. `close` means the message has ended and the next prose opens a
	 * new block; without it (widget on screen) a late delta continues the same
	 * block. `question: false` means the pending question keeps waiting: more
	 * prose will follow this one.
	 */
	function settle({ close, question = true }) {
		drainEarly();
		flushBuffer(true);
		if (s.msg) remember(s.msg.text);
		if (close) s.msg = null;
		if (question) writePending();
	}

	/**
	 * The question into the note. If the previous question hangs in it unanswered
	 * under the same header (this happens after a session resume) and the policy
	 * is on, the old copy is removed: the answer belongs to the last one.
	 */
	function writePending() {
		const q = s.pending;
		if (!q) return;
		s.pending = null;
		const text = questionBlock(q.questions, s.labels);
		if (!text) return;
		if (!s.labels) log.push("labels marker not found — question and answer labels stay English");
		// A question follows the answer, not a debrief: there is nothing to recolor.
		dropAnswer();
		const key = questionKey(q.questions);
		if (policy.dedupeQuestions && key && s.last && s.last.key === key) ops.push({ op: "remove", id: s.last.id });
		const id = nextId("q");
		ops.push({ op: "append", id, text });
		s.last = key ? { key, id } : null;
		s.open = id;
	}

	switch (event && event.type) {
		case "session-start":
			if (event.source === "resume") s.resumed = true;
			break;

		case "user":
			// A new turn: the tail of the previous message and the pending question go above the turn.
			settle({ close: true });
			s.open = null;
			s.guard = afterInput(false);
			if (!event.text) break;
			if (s.labels) {
				ops.push({ op: "append", text: userBlock(event.text, s.labels) });
				break;
			}
			// No labels yet: the labels marker will rewrite the header.
			{
				const id = nextId("u");
				ops.push({ op: "append", id, text: userBlock(event.text) });
				s.unlabeled = [...s.unlabeled, { id, text: event.text }].slice(-UNLABELED_MAX);
			}
			break;

		case "delta": {
			const id = event.messageId || null;
			if (s.msg && s.msg.id && id && s.msg.id !== id) settle({ close: true });
			if (String(event.text || "").trim()) s.resumed = false;
			if (!s.msg) s.msg = newMessage(id, opensFirst(s.guard));
			s.msg.id = s.msg.id || id;
			// A delta ahead of its turn waits for its predecessors; one already
			// taken is not written again. Without a number, arrival order applies.
			const index = Number.isInteger(event.index) ? event.index : null;
			if (index !== null && (s.msg.seen.includes(index) || s.msg.early[index])) break;
			if (index !== null && index > s.msg.next) {
				s.msg.early[index] = { text: event.text || "", final: Boolean(event.final) };
				break;
			}
			take(event.text, event.final, index);
			while (s.msg && s.msg.early[s.msg.next]) {
				const early = s.msg.early[s.msg.next];
				delete s.msg.early[s.msg.next];
				take(early.text, early.final, s.msg.next);
			}
			break;
		}

		case "thinking": {
			// Thinking prose arrives as one whole message — it has no deltas. The same
			// block is not read twice (the read position in the transcript), while
			// identical text in different turns is a legitimate repeat: "✓ Correct." twice.
			// The registry of written messages keeps the `Stop` fallback write away from it.
			if (!String(event.text || "").trim()) break;
			// The pending question stays below: this prose is its lead-in. While a
			// question hangs, the prose goes above it by itself.
			settle({ close: true, question: false });
			s.msg = { ...newMessage(event.messageId || null), buf: event.text, text: event.text };
			settle({ close: true, question: false });
			break;
		}

		case "question":
			// The question passed the guard; if it lacked text, the fuse let it through.
			if (fused(s.guard)) log.push(`output guard: ${FUSE} consecutive rejections — question let through by the fuse`);
			s.guard = asked(s.guard);
			s.resumed = false;
			if (!isGraded(event.questions, s.labels)) log.push("question without \"I don't know\" as the last option — treated as ungraded");
			// The question cannot be written now: the last prose delta above it may
			// arrive later than this event. The previous pending question is handed
			// over — otherwise it would be lost.
			if (s.pending) settle({ close: false });
			s.pending = { questions: Array.isArray(event.questions) ? event.questions : [] };
			break;

		case "written":
			// A transcript text block is only a witness for the guard: the text reaches
			// the note as a delta.
			s.guard = wrote(s.guard, event.messageId, String(event.text || ""));
			if (String(event.text || "").trim()) s.resumed = false;
			break;

		case "input-written":
			s.guard = inputWritten(s.guard);
			break;

		case "guard-deny":
			// Option order: the same question will come again, the message and the
			// "first after a denial" stay as they were.
			if (event.missing === "slate") {
				s.guard = slateDenied(s.guard);
				log.push(denyLog(event.missing));
				break;
			}
			// The guard rejected the question: the student will not see it, and it does
			// not go into the note. The open message is closed — the next one will be
			// the first after the denial.
			settle({ close: true, question: false });
			s.guard = denied(s.guard);
			log.push(denyLog(event.missing));
			break;

		case "widget":
			// The widget is on screen: there will be no more lead-in. The message is not closed.
			if (!s.pending) break;
			if (s.msg && s.msg.buf.trim()) log.push("question not written by a `final` delta — written on the wait for input");
			settle({ close: false });
			break;

		case "answer": {
			// The relay's last safety net: prose and question come before the answer.
			settle({ close: true });
			s.open = null;
			s.guard = afterInput(Boolean(event.answers) && isGraded(event.questions, s.labels));
			if (!event.answers) break;
			s.last = null; // the question was answered — it is history
			dropAnswer();
			const lines = answerLines(event.questions, event.answers, s.labels);
			const id = event.toolUseId || nextId("a");
			ops.push({ op: "append", id, label: true, text: neutralAnswerBlock(lines, s.labels) });
			s.answer = { id, lines, key: answerKey(event.questions, event.answers) };
			break;
		}

		case "stop": {
			// A message without `final`: the hooks of one turn run in parallel, and the
			// last delta may arrive later than `Stop` (on interruption `Stop` does not
			// arrive at all). Its prose is already coming as deltas — the fallback
			// write is not needed, and the message stays open so the tail continues
			// the same block.
			if (s.msg) {
				settle({ close: false });
				break;
			}
			settle({ close: true });
			// Fallback write: the message did not come as deltas. It is written only
			// if it is not in the registry of written messages.
			const text = String(event.lastMessage || "");
			const print = fingerprint(text);
			if (!print || s.written.includes(print)) break;
			log.push("prose did not arrive as deltas — written from last_assistant_message");
			s.msg = { ...newMessage(null), buf: text, text };
			settle({ close: true });
			break;
		}

		default:
			break;
	}

	return { state: s, ops, log };
}