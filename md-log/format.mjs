/**
 * Note block format: pure functions, no disk access. Carried over from the
 * former hook almost verbatim (`legacy/claude/hooks/md-log.mjs`).
 *
 * The body of any block sits outside the quote: the callout header is a
 * separate line, and the text follows as a plain paragraph. Inside `> ` a
 * multiline `$$…$$`, a mermaid fence and image embeds would not render.
 */

// The debrief head moves into the colored block whole, but only while it still
// looks like a head: the model may have forgotten the blank line before "Why",
// and then the whole lesson would end up in the quote, display `$$…$$` included.
const HEAD_MAX_LINES = 8;
const HEAD_MAX_CHARS = 600;

// The verdict glyph is the first character of a debrief. The session language
// is arbitrary; the glyph does not depend on it. The main ones are ✓ ✗ ?, the
// rest are accepted defensively.
const VERDICT_TYPES = {
	"✓": "success",
	"✔": "success",
	"☑": "success",
	"✗": "failure",
	"✘": "failure",
	"❌": "failure",
	"×": "failure",
	"?": "question",
	"？": "question",
};

// The same glyph set, for cutting it out of the colored block title: Obsidian
// draws the callout icon itself, and a glyph in the title would duplicate it
// ("✗ ✗ …").
const VERDICT_GLYPH_RE = new RegExp(
	`^\\s*(?:${Object.keys(VERDICT_TYPES)
		.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|")})\\s*`,
);

// Windows device names: a file `Aux.md` cannot be created, nor `con.txt.md` —
// the part of the name before the first dot counts, case-insensitively.
const RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/**
 * Note name: the topic as it is, in human-readable text with spaces. Only the
 * forbidden is stripped: characters not allowed in Windows file names and in
 * Obsidian links (`#^[]|`), plus a trailing dot or space, which Windows will
 * not keep. A Windows device name gets `_` (B12).
 */
export function noteName(topic) {
	const name =
		String(topic || "")
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 60)
			.replace(/[.\s]+$/, "") || "learn";
	const dot = name.indexOf(".");
	const base = dot === -1 ? name : name.slice(0, dot);
	return RESERVED_NAME_RE.test(base.trim()) ? `${base}_${name.slice(base.length)}` : name;
}

function quote(text) {
	return text
		.split("\n")
		.map((line) => (line.length ? `> ${line}` : ">"))
		.join("\n");
}

/**
 * Note labels. The base is the English labels of the debrief template; the
 * translation into the lesson language comes in the marker
 * `<!-- labels: Question=… | … -->` (ADR 0021). The marker key is the English
 * label, the value is the translation. A translation that did not arrive stays
 * English. "CLAUDE" is a name, not a label: it is not translated.
 */
export const BASE_LABELS = Object.freeze({
	question: "Question",
	answer: "Answer",
	own: "Own answer",
	you: "You",
	verdict: "Verdict",
	correct: "Correct",
	incorrect: "Incorrect",
	dontKnow: "Didn't know",
	yours: "Your answer",
	right: "Correct answer",
	why: "Why",
});

const LABEL_KEYS = Object.fromEntries(
	Object.entries(BASE_LABELS).map(([key, name]) => [name.toLowerCase().replace(/[’']/g, "'"), key]),
);

/**
 * Labels marker body → `{labels, unknown}`: the full set (missing ones are
 * English) and the keys that are not in the template. Pairs are separated by
 * `|`, key and translation by `=`. No pairs at all — `labels: null`.
 */
export function parseLabels(body) {
	const labels = { ...BASE_LABELS };
	const unknown = [];
	let found = 0;
	for (const pair of String(body || "").split("|")) {
		const eq = pair.indexOf("=");
		if (eq === -1) continue;
		const name = pair.slice(0, eq).trim().toLowerCase().replace(/[’']/g, "'");
		const value = pair.slice(eq + 1).replace(/\s+/g, " ").trim();
		if (!name || !value) continue;
		const key = LABEL_KEYS[name];
		if (!key) {
			unknown.push(pair.slice(0, eq).trim());
			continue;
		}
		labels[key] = value;
		found++;
	}
	return { labels: found ? labels : null, unknown };
}

const labelsOr = (L) => L || BASE_LABELS;

/** Student turn: the callout header, the text under it verbatim. */
export function userBlock(text, L) {
	return `> [!quote] ${labelsOr(L).you.toLocaleUpperCase()}\n\n${text}`;
}

/** Note line label: bold, colon inside — `**Your answer:** …`. */
const tag = (label) => `**${label}:**`;

// The "Why" label at the start of the prose under a debrief: the model writes
// it sometimes in the lesson language, sometimes as "Why:" from the template,
// with markup or without. The bold lesson label is put in its place.
function whyPattern(L) {
	const names = [BASE_LABELS.why, labelsOr(L).why].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`^(\\s*)(?:\\*\\*|__)?(?:${names.join("|")})(?:\\*\\*|__)?\\s*:(?:\\*\\*|__)?[ \\t]*`, "iu");
}

/** Prose under a debrief with the "Why" label in the lesson language. */
export function relabelWhy(text, L) {
	return String(text).replace(whyPattern(L), (_, pre) => `${pre}${tag(labelsOr(L).why)} `);
}

/** First chunk of a teacher message; the following chunks go without a header. */
export function assistantBlock(text) {
	return `> [!abstract] CLAUDE\n\n${text}`;
}

/** Only label and description are read from an option; everything else is ignored. */
function optionLines(options) {
	return options.map((o, i) => {
		const label = o && typeof o.label === "string" ? o.label : "";
		const desc = o && typeof o.description === "string" ? o.description.trim() : "";
		return desc ? `${i + 1}. **${label}** — ${desc}` : `${i + 1}. **${label}**`;
	});
}

/**
 * Question key for matching repeats is the **header** (`header`), not the text:
 * after a session resume the model rephrases the whole question, and exactly
 * the header matches. Case, whitespace and markup are normalized. No header
 * means no key, and there is nothing to remove.
 */
export function questionKey(questions) {
	const parts = [];
	for (const q of Array.isArray(questions) ? questions : []) {
		if (!q || typeof q !== "object") continue;
		parts.push(
			String(q.header || "")
				.replace(/[`*_~]/g, "")
				.replace(/\s+/g, " ")
				.trim()
				.toLowerCase(),
		);
	}
	const key = parts.join("\u0000");
	return key.replace(/\u0000/g, "") ? key : null;
}

/** An `AskUserQuestion` call → one block: a callout per question. */
export function questionBlock(questions, L) {
	const list = Array.isArray(questions) ? questions : [];
	const blocks = [];
	list.forEach((q, idx) => {
		if (!q || typeof q !== "object") return;
		const header = typeof q.header === "string" && q.header.trim() ? ` — ${q.header.trim()}` : "";
		const num = list.length > 1 ? ` ${idx + 1}` : "";
		const body = [String(q.question || "")];
		const options = Array.isArray(q.options) ? q.options : [];
		if (options.length) body.push("", ...optionLines(options));
		blocks.push(`> [!question] ${labelsOr(L).question}${num}${header}\n${quote(body.join("\n"))}`);
	});
	return blocks.join("\n\n");
}

/**
 * Answer lines. The answer arrives as a label string, the key is the full
 * question text. Free text ("Own answer") is recognized in exactly one way: the
 * value matches none of the labels.
 *
 * Lines follow the order of the question's options, not the order in which the
 * student ticked them, like `sortAnswers` in `.pi/extensions/quiz.ts`.
 */
export function answerLines(questions, answers, L) {
	const own = labelsOr(L).own;
	const lines = [];
	const list = Array.isArray(questions) ? questions : [];
	for (const q of list) {
		if (!q || typeof q !== "object") continue;
		const picks = picksOf(q, answers);
		const prefix = list.length > 1 && q.header ? `${String(q.header).trim()}: ` : "";
		for (const r of picks) {
			lines.push(r.idx === -1 ? `${prefix}${tag(own)} ${r.text}` : `${prefix}${r.idx + 1}. ${r.text}`);
		}
	}
	if (!lines.length) lines.push("—");
	return lines;
}

/**
 * The student's choice in one question: `{text, idx}`, `idx` is the zero-based
 * option number, or -1 for an own answer. Free text has no number of its own —
 * it goes last.
 */
function picksOf(q, answers) {
	const raw = answers ? answers[String(q.question || "")] : undefined;
	if (raw === undefined || raw === null) return [];
	const labels = optionsOf(q).map((o) => o.label);
	const picks = Array.isArray(raw) ? raw.map(String) : [String(raw)];

	let resolved = picks.map((p) => ({ text: p, idx: labels.indexOf(p) }));
	// multiSelect may arrive as one comma-separated string.
	if (resolved.length === 1 && resolved[0].idx === -1) {
		const parts = resolved[0].text.split(", ");
		if (parts.length > 1 && parts.every((p) => labels.indexOf(p) !== -1)) {
			resolved = parts.map((p) => ({ text: p, idx: labels.indexOf(p) }));
		}
	}
	const rank = (r) => (r.idx === -1 ? Number.MAX_SAFE_INTEGER : r.idx);
	return resolved.slice().sort((a, b) => rank(a) - rank(b));
}

function optionsOf(q) {
	return (Array.isArray(q.options) ? q.options : []).map((o) => ({
		label: o && typeof o.label === "string" ? o.label : "",
		description: o && typeof o.description === "string" ? o.description.trim() : "",
	}));
}

/**
 * What the recoloring needs to build the block itself: the question's options
 * and the student's choice. Only for a call with one question: a call has one
 * debrief, and which correct answer belongs to which question cannot be told
 * from the head. For several questions — `null`, and the block goes with the
 * model's head.
 */
export function answerKey(questions, answers) {
	const list = (Array.isArray(questions) ? questions : []).filter((q) => q && typeof q === "object");
	if (list.length !== 1) return null;
	const picks = picksOf(list[0], answers);
	return picks.length ? { options: optionsOf(list[0]), picks } : null;
}

/** Answer block before the verdict: the verdict does not exist yet, so no color. */
export function neutralAnswerBlock(lines, L) {
	return `> [!example] ${labelsOr(L).answer}\n${quote(lines.join("\n"))}`;
}

/**
 * The line opens a multiline block: a code fence or a display formula.
 * A single-line `$$ … $$` does not count as an opening — it renders in a callout.
 */
function opensFence(line) {
	if (line.startsWith("```")) return true;
	return line.startsWith("$$") && !(line.length > 3 && line.endsWith("$$"));
}

/**
 * A chunk can be appended to the note only if it does not break a multiline
 * block: an unclosed code fence or display formula would break Obsidian's
 * rendering until the next delta.
 */
export function balanced(text) {
	const fences = (text.match(/^[ \t]*```/gm) || []).length;
	const math = (text.match(/\$\$/g) || []).length;
	return fences % 2 === 0 && math % 2 === 0;
}

/**
 * Closes an unclosed code fence and formula at the end of a chunk — only for a
 * forced flush (Stop, a student turn, a guard denial): there will be no next
 * delta to close them, and an unclosed fence would glue all the text after it
 * into one code block up to the next stray ` ``` ` in the note.
 */
export function closeUnbalanced(text) {
	if (balanced(text)) return text;
	const fences = (text.match(/^[ \t]*```/gm) || []).length;
	const math = (text.match(/\$\$/g) || []).length;
	let out = text.endsWith("\n") ? text : `${text}\n`;
	if (math % 2 !== 0) out += "$$\n";
	if (fences % 2 !== 0) out += "```\n";
	return out;
}

/**
 * Debrief → `{type, head, rest}`, or `null` if the first character is not a
 * glyph. `head` is the first paragraph (up to the first blank line): the
 * verdict, the student's answer, the correct answer. It moves into the colored
 * block. `rest` is "Why" and onward: outside the quote, where display `$$…$$`,
 * mermaid and embeds stay alive.
 *
 * The split is structural, not lexical: the session runs in the student's language.
 */
export function verdictOf(text) {
	const lines = String(text).split("\n");
	const first = lines[0].trim();
	const type = VERDICT_TYPES[first.slice(0, 1)] || VERDICT_TYPES[first.slice(0, 2)];
	if (!type) return null;

	let end = lines.length;
	for (let i = 1; i < lines.length; i++) {
		const l = lines[i].trim();
		// A blank line is the normal head boundary. An opening fence is the
		// emergency one: the model forgot the blank line, and inside a quote the
		// fence would not render anyway.
		if (!l || opensFence(l)) {
			end = i;
			break;
		}
	}
	let head = lines.slice(0, end).map((l) => l.trim());
	// Size fuse: the head is the verdict and answers, not the lesson.
	if (head.length > HEAD_MAX_LINES || head.join("\n").length > HEAD_MAX_CHARS) head = [first];
	const rest = lines.slice(head.length).join("\n").trim();
	return { type, head, rest };
}

/**
 * Colored block title is the first line of the debrief without the leading
 * glyph. If the line was just a glyph, the next one is taken so the title does
 * not stay empty.
 */
function verdictHead(verdict) {
	const head = verdict.head.slice();
	let title = (head.shift() || "").replace(VERDICT_GLYPH_RE, "").replace(/\s+/g, " ").trim();
	if (!title) title = (head.shift() || "").replace(/\s+/g, " ").trim();
	return { title, lines: head.filter((l) => l.length) };
}

function coloredBlock(type, title, body) {
	return body.length ? `> [!${type}] ${title}\n${quote(body.join("\n"))}` : `> [!${type}] ${title}`;
}


/** Colored block title: "<Verdict>: <Correct|Incorrect|Didn't know>" in the lesson labels. */
function verdictTitle(type, L) {
	const l = labelsOr(L);
	const word = { success: l.correct, failure: l.incorrect, question: l.dontKnow }[type];
	return `${l.verdict}: ${word}`;
}

/**
 * Colored answer block. The title is the verdict by glyph, in the lesson labels.
 *
 * With an answer key (`answerKey`) the hook builds the body too: "Your answer" /
 * "Answer" from the student's choice, "Correct answer" is the question option
 * the debrief head pointed to (ADR 0020). All that is needed from the model is
 * the glyph and the number of the correct option: it translates and abbreviates
 * the labels as it pleases.
 *
 * Without a key (several questions in a call) or without a correct answer in
 * the head, the body is the model's head. Answer lines that are not in the head
 * stay in the body — recoloring never erases what the student answered.
 */
export function coloredAnswerBlock(verdict, lines, key, L) {
	const title = verdictTitle(verdict.type, L);
	const built = key && builtBody(verdict, key, L);
	if (built) return coloredBlock(verdict.type, title, built);

	const { title: first, lines: headRest } = verdictHead(verdict);
	// A bare verdict line ("Incorrect", "Verdict: Incorrect") would repeat the title.
	const lead = first && first.split(/\s+/).length > 3 ? [first] : [];
	if (key) return coloredBlock(verdict.type, title, [...yourAnswer(verdict, key, new Map(), L), ...lead, ...headRest]);
	const known = [first, ...headRest].join("\n");
	const kept = (lines || []).filter((line) => {
		const core = line
			.replace(/^[^:.]*:(?:\*\*)?\s*/, "")
			.replace(/^\d+\.\s*/, "")
			.replace(/\s+/g, " ")
			.trim();
		return core.length > 0 && !known.includes(core);
	});
	return coloredBlock(verdict.type, title, [...lead, ...headRest, ...kept]);
}

/** Debrief as a separate colored block, when the answer block cannot be recolored. */
export function verdictBlock(verdict, key, L) {
	return coloredAnswerBlock(verdict, [], key, L);
}

// Reference to an option by number: "2. …", "(2.)". Not "1.5" and not "v2.".
const OPTION_NUMBER_RE = /(?<![\p{L}\d.,])(\d+)\.(?=\s|$)/gu;

/** Numbers of the options the line points to, in order; with no numbers, by option text. */
function refsOf(line, options) {
	const refs = [];
	for (const m of line.matchAll(OPTION_NUMBER_RE)) {
		const idx = Number(m[1]) - 1;
		if (idx >= 0 && idx < options.length) refs.push(idx);
	}
	if (refs.length) return refs;
	// Longer labels first: "Yes" must not be found inside "Yes, but…".
	return options
		.map((o, idx) => ({ label: o.label, idx }))
		.filter((o) => o.label && line.includes(o.label))
		.sort((a, b) => b.label.length - a.label.length)
		.map((o) => o.idx);
}

const isInlineMath = (line) => line.length > 4 && line.startsWith("$$") && line.endsWith("$$");

/**
 * Single-line formulas of the head → the option they belong to: by the
 * template, a formula stands on the line below its answer.
 */
function formulasOf(head, options) {
	const byIdx = new Map();
	let ref = -1;
	for (const line of head) {
		if (isInlineMath(line)) {
			if (ref !== -1 && !byIdx.has(ref)) byIdx.set(ref, line);
			continue;
		}
		ref = refsOf(line, options)[0] ?? -1;
	}
	return byIdx;
}

function optionText(key, idx) {
	const o = key.options[idx];
	return o.description ? `${idx + 1}. ${o.label} — ${o.description}` : `${idx + 1}. ${o.label}`;
}

/**
 * "Your answer" lines. "I don't know" (the last option of a graded question)
 * has none: the verdict title already says it.
 */
function yourAnswer(verdict, key, formulas, L) {
	const out = [];
	for (const p of key.picks) {
		if (verdict.type === "question" && p.idx === key.options.length - 1) continue;
		out.push(`${tag(labelsOr(L).yours)} ${p.idx === -1 ? p.text : `${p.idx + 1}. ${p.text}`}`);
		if (formulas.has(p.idx)) out.push(formulas.get(p.idx));
	}
	return out;
}

/** The body built by the hook, or `null` if the head did not name the correct answer. */
function builtBody(verdict, key, L) {
	const l = labelsOr(L);
	const head = verdict.head.slice();
	head[0] = (head[0] || "").replace(VERDICT_GLYPH_RE, "");
	const formulas = formulasOf(head, key.options);

	// Correct: the correct answer is the student's choice.
	if (verdict.type === "success") {
		return key.picks.flatMap((p) => {
			if (p.idx === -1) return [`${tag(l.answer)} ${p.text}`];
			const line = `${tag(l.answer)} ${optionText(key, p.idx)}`;
			return formulas.has(p.idx) ? [line, formulas.get(p.idx)] : [line];
		});
	}

	const mine = new Set(key.picks.map((p) => p.idx));
	const correct = head.flatMap((line) => refsOf(line, key.options)).find((idx) => !mine.has(idx));
	if (correct === undefined) return null;
	const body = [...yourAnswer(verdict, key, formulas, L), `${tag(l.right)} ${optionText(key, correct)}`];
	if (formulas.has(correct)) body.push(formulas.get(correct));
	return body;
}
