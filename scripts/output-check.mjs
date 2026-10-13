#!/usr/bin/env node
/**
 * Checks the output rule against a session transcript: did the lesson print
 * lead-ins and debriefs as response text (ADR 0017, addendum).
 *
 *   node .claude/scripts/output-check.mjs <transcript.jsonl>
 *
 * The transcript goes through the same path as the backfill (`fromTranscript` →
 * `reduce`), and every `AskUserQuestion` call after the learner's input is
 * measured by the guard's rule: was there text before it, and, after the answer
 * to a graded question, a debrief with a glyph. Prose inside reasoning does not
 * count as text.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { fromTranscript, parseJsonl } from "../md-log/events.mjs";
import { inspect } from "../md-log/guard.mjs";
import { freshLesson, reduce } from "../md-log/lesson.mjs";

/**
 * Transcript records → `{calls, text, debriefs}`: one row per call
 * (`{header, text, graded, debrief}`) and `{ok, of}` totals for the text before
 * a question and for the debriefs after graded answers. `labels` seeds the lesson
 * labels for a transcript recorded before the labels marker existed: without
 * them only the English "I don't know" option counts as graded.
 */
export function checkTranscript(records, { labels = null } = {}) {
	let lesson = { ...freshLesson(), labels };
	let input = false;
	const calls = [];
	for (const event of fromTranscript(records)) {
		if (event.type === "user" || event.type === "answer") input = true;
		if (event.type === "question" && input) {
			const seen = inspect(lesson.guard);
			const header = (event.questions || []).map((q) => (q && q.header) || "?").join(" + ");
			calls.push({ header, text: seen.text, graded: seen.graded, debrief: seen.graded ? seen.debrief : null });
		}
		lesson = reduce(lesson, event).state;
	}
	const after = calls.filter((c) => c.graded);
	return {
		calls,
		text: { ok: calls.filter((c) => c.text).length, of: calls.length },
		debriefs: { ok: after.filter((c) => c.debrief).length, of: after.length },
	};
}

const share = ({ ok, of }) => (of ? `${ok}/${of} (${Math.round((100 * ok) / of)} %)` : "—");
const mark = (value) => (value === null ? "—" : value ? "yes" : "no");

function main() {
	const file = process.argv[2];
	if (!file) {
		process.stderr.write("usage: node .claude/scripts/output-check.mjs <transcript.jsonl>\n");
		process.exit(2);
	}
	const report = checkTranscript(parseJsonl(fs.readFileSync(file, "utf8")));
	report.calls.forEach((c, i) => {
		process.stdout.write(`${String(i + 1).padStart(3)}. ${c.header.padEnd(14)} text: ${mark(c.text).padEnd(3)} debrief: ${mark(c.debrief)}\n`);
	});
	process.stdout.write(`\ntext before the question:          ${share(report.text)}\n`);
	process.stdout.write(`debrief after a graded answer:     ${share(report.debriefs)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();