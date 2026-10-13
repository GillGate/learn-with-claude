/**
 * Output guard, the pure part: what has been printed since the learner's last
 * input and whether that is enough to ask a lesson question (ADR 0017, addendum).
 *
 * The state lives in the lesson (`lesson.guard`) and is changed only by the
 * `reduce` core, so replaying the journal yields the same state as live:
 *   graded   the last input was an answer to a graded question
 *   said     all delta text since the last input
 *   firstText  text of the first message since the last input or denial (`null` —
 *              there is no message)
 *   written  the same for the second witness, the transcript text blocks:
 *            `{said, firstId, firstText}`
 *   denials  consecutive denials with no learner input between them
 *   slateDenials  consecutive denials for "I don't know" not being last: counted
 *            separately so as not to touch "the first message after a denial"
 *
 * Text is `MessageDisplay` deltas or transcript text blocks. There are two
 * witnesses because the order of deltas and `PreToolUse` is not documented: a
 * delta may arrive late, or a transcript block may, and vice versa. Thinking
 * prose and the fallback write on `Stop` do not count as text. The decision is
 * made by `handle` on `PreToolUse`: here is only the rule, with no waiting and
 * no disk.
 */

import { lessonMarkers } from "./events.mjs";
import { verdictOf } from "./format.mjs";

// Consecutive denials after which the question is let through: the guard must not lock up the lesson.
export const FUSE = 2;

const normalize = (text) =>
	String(text || "")
		.trim()
		.toLowerCase()
		.replace(/’/g, "'")
		.replace(/\.$/, "");

/**
 * The wordings of the last option of a graded question: English "I don't know"
 * and the lesson's translation of "Didn't know" from the labels marker (ADR 0021),
 * so any lesson language works. Case and a trailing period do not matter.
 */
const dontKnowWords = (labels) => new Set(["i don't know", ...(labels && labels.dontKnow ? [normalize(labels.dontKnow)] : [])]);

export function freshGuard() {
	return { graded: false, said: "", firstText: null, written: freshWritten(), denials: 0, slateDenials: 0 };
}

function freshWritten() {
	return { said: "", firstId: null, firstText: null };
}

const label = (option) => normalize(option && option.label);

/** Whether the call is graded: at least one question has "I don't know" as its last option. */
export function isGraded(questions, labels = null) {
	const words = dontKnowWords(labels);
	return (Array.isArray(questions) ? questions : []).some((q) => {
		const options = q && Array.isArray(q.options) ? q.options : [];
		return options.length > 0 && words.has(label(options[options.length - 1]));
	});
}

/**
 * Whether the option order is broken: some question has "I don't know" but not
 * as the last option (skill rule: always fourth). A question without "I don't
 * know" is legitimately ungraded, so the order is not at fault.
 */
export function misplacedDontKnow(questions, labels = null) {
	const words = dontKnowWords(labels);
	return (Array.isArray(questions) ? questions : []).some((q) => {
		const options = q && Array.isArray(q.options) ? q.options : [];
		const at = options.findIndex((o) => words.has(label(o)));
		return at !== -1 && at !== options.length - 1;
	});
}

/** Learner input: a remark (`graded` false) or an answer to a question. */
export function afterInput(graded) {
	return { ...freshGuard(), graded };
}

/** Whether the first message is starting now: no text has come since the input or denial. */
export function opensFirst(guard) {
	return guard.firstText === null;
}

/** A text delta; `isFirst` — it belongs to the first message after the input or denial. */
export function heard(guard, text, isFirst) {
	return {
		...guard,
		said: guard.said + text,
		firstText: isFirst ? (guard.firstText || "") + text : guard.firstText,
	};
}

/**
 * A text block from the transcript. The first message is the first by
 * `message.id` after the input or denial; its blocks are concatenated.
 */
export function wrote(guard, messageId, text) {
	const w = guard.written || freshWritten();
	const id = messageId || "";
	const first = w.firstId === null || w.firstId === id;
	return {
		...guard,
		written: {
			said: w.said + text,
			firstId: w.firstId === null ? id : w.firstId,
			firstText: first ? (w.firstText || "") + text : w.firstText,
		},
	};
}

/** Learner input in the transcript: what was written before it does not count as a witness. */
export function inputWritten(guard) {
	return { ...guard, written: freshWritten() };
}

/**
 * A denial. The next message becomes the first again: otherwise the debrief
 * the model prints because of the denial would never pass.
 */
export function denied(guard) {
	const w = guard.written || freshWritten();
	return { ...guard, firstText: null, written: { ...w, firstId: null, firstText: null }, denials: guard.denials + 1 };
}

/** The question passed the guard: the denial count starts over. */
export function asked(guard) {
	return { ...guard, denials: 0, slateDenials: 0 };
}

/**
 * A denial over the option order. It does not touch the lead-in or the debrief:
 * the same question will come again, so "the first message after a denial"
 * must not be reset.
 */
export function slateDenied(guard) {
	return { ...guard, slateDenials: (guard.slateDenials || 0) + 1 };
}

/** Decision on the option order: deny until the fuse trips. */
export function slateDenies(guard = freshGuard(), questions, labels = null) {
	return misplacedDontKnow(questions, labels) && (guard.slateDenials || 0) < FUSE;
}

const body = (text) => lessonMarkers(String(text || "")).text.trim();

/** A debrief: the verdict glyph as the first character and a non-empty part after a blank line. */
function isDebrief(text) {
	const verdict = verdictOf(body(text));
	return Boolean(verdict && verdict.rest);
}

/**
 * What has been printed since the last input → `{text, graded, debrief}`: whether
 * there is text, whether the input was an answer to a graded question, whether
 * the text started with a debrief.
 */
export function inspect(guard = freshGuard()) {
	const w = guard.written || freshWritten();
	return {
		text: Boolean(body(guard.said) || body(w.said)),
		graded: guard.graded,
		debrief: isDebrief(guard.firstText) || isDebrief(w.firstText),
	};
}

/** What the question lacks: `"lead-in"`, `"debrief"` or `null`. */
export function missing(guard = freshGuard()) {
	const seen = inspect(guard);
	// After a graded answer a debrief is required: emptiness also counts as lacking it.
	if (seen.graded) return seen.debrief ? null : "debrief";
	return seen.text ? null : "lead-in";
}

/** Whether the fuse lets the question through: it lacks text, but there are already `FUSE` denials. */
export function fused(guard = freshGuard()) {
	return guard.denials >= FUSE && missing(guard) !== null;
}

/** Decision on the question: what is lacking, or `null` — let it through (including by the fuse). */
export function decide(guard = freshGuard()) {
	return fused(guard) ? null : missing(guard);
}

const REASONS = {
	"lead-in":
		"Question not shown: no response text has been printed since the learner's last input. " +
		"Print the lead-in to this question as response text, not inside thinking, then call AskUserQuestion again with the same question.",
	debrief:
		"Question not shown: the learner just answered a graded question, and the first message after an answer is the debrief. " +
		"Print the debrief itself as response text, not inside thinking, laid out per debrief-format.md: " +
		"the verdict glyph (✓, ✗ or ?) as the very first character, the verdict head, a blank line, then the Why part. " +
		"Then call AskUserQuestion again with the same question.",
	slate:
		"Question not shown: \"I don't know\" is not the last option. It always goes last, as option 4, every time; " +
		"it never takes part in shuffling the position of the correct answer. " +
		"Call AskUserQuestion again with the same question and the same wording, with the three real options in slots 1–3 and \"I don't know\" in slot 4. " +
		"Do not print anything before the call.",
};

/** Hook stdout line: a denial of the call with a reason for the model. */
export function denyOutput(what) {
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: REASONS[what],
		},
	})}\n`;
}

/** The `errors.log` line about a denial. */
export function denyLog(what) {
	if (what === "slate") return "output guard: question rejected — \"I don't know\" is not the last option";
	return what === "debrief"
		? "output guard: question rejected — no debrief after the answer to a graded question"
		: "output guard: question rejected — no text printed after the learner's input";
}