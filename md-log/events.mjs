/**
 * Adapters: `fromHook(mode, payload)` and `fromTranscript(records)` (backfill) →
 * normalized lesson events.
 *
 * The raw payload goes no further than the adapter: the core, the journal and
 * the tests see only events. Slash-command parsing, the filter for the
 * environment's service messages and topic marker recognition live here and
 * nowhere else. The core looks for the marker in the accumulated message buffer,
 * using a function from here: one delta may carry only half of it.
 *
 *   session-start → {type: "session-start", source}
 *   prompt        → {type: "user", text, command}      learner's remark
 *   message       → {type: "delta", messageId, index, text, final}   prose delta
 *   question      → {type: "question", toolUseId, questions}
 *   waiting       → {type: "widget", toolUseId}        question widget on screen
 *   answer        → {type: "answer", toolUseId, questions, answers}
 *   stop          → {type: "stop", lastMessage}        end of turn
 *   (transcript)  → {type: "thinking", messageId, text} thinking prose
 *                 → {type: "written", messageId, text}  text block (guard)
 *                 → {type: "input-written"}             learner input (guard)
 *   (guard)       → {type: "guard-deny", toolUseId, missing}  question denied
 *
 * Thinking prose is text the model printed in a `thinking` block: the terminal
 * shows it as ordinary text, but no hook delivers it, so it is taken from the
 * transcript, both live and in a backfill (ADR 0017). An empty block is hidden
 * reasoning, which is not on screen.
 *
 * Service content does not get into event text: an environment notification
 * remark yields no event at all, a service line or a `/md-log` call yields a
 * remark with empty text (a new turn has started all the same), and a service
 * prose paragraph is cut out.
 */

export const HOOK_MODES = Object.freeze([
	"session-start",
	"prompt",
	"message",
	"question",
	"waiting",
	"answer",
	"stop",
]);

const str = (value) => (typeof value === "string" ? value : "");
const list = (value) => (Array.isArray(value) ? value : []);

// The topic marker that `learn` prints as the first line of the first message.
const TOPIC_MARKER_RE = /<!--\s*topic\s*:\s*([^>]*?)\s*-->/i;

// The labels marker: `learn` translates the note's labels into the lesson language (ADR 0021).
const LABELS_MARKER_RE = /<!--\s*labels\s*:\s*([^>]*?)\s*-->/i;

/**
 * Lesson markers in text → `{topic, labels, text}`: the topic (or `null`), the
 * body of the labels marker (or `null`) and the text without either marker. The
 * note does not need the markers under any circumstances.
 */
export function lessonMarkers(text) {
	let out = text;
	let topic = null;
	let labels = null;
	const t = TOPIC_MARKER_RE.exec(out);
	if (t) {
		topic = t[1].trim() || null;
		out = out.replace(TOPIC_MARKER_RE, "").replace(/^[ \t]*\n/, "");
	}
	const l = LABELS_MARKER_RE.exec(out);
	if (l) {
		labels = l[1];
		out = out.replace(LABELS_MARKER_RE, "").replace(/^[ \t]*\n/, "");
	}
	return { topic, labels, text: out };
}

// Service lines of the environment: md-log command output, the interruption
// mark, the empty-turn stub, "⏳" — the model's silent reply to a maker
// notification (the `visualize` skill). Matching is against a whole paragraph,
// not a substring: a lesson that mentions an interruption in words must not
// cut itself out.
const SYSTEM_NOISE = [
	/^md-(?:un)?log:[^\n]*$/,
	/^\[Request interrupted by user[^\]]*\]$/,
	/^No response requested\.$/,
	/^⏳$/,
	/^Background agent .+ was stopped by the user\.$/,
];

const isNoise = (text) => {
	const body = text.trim();
	return body.length > 0 && SYSTEM_NOISE.some((re) => re.test(body));
};

/** Text without service paragraphs; separators between the remaining ones are kept as they were. */
function dropNoise(text) {
	const parts = text.split(/(\n[ \t]*\n)/);
	let out = "";
	for (let i = 0; i < parts.length; i += 2) {
		if (!isNoise(parts[i])) out += parts[i] + (parts[i + 1] || "");
	}
	return out;
}

// Remarks the environment delivers through the same event as the learner's words.
const NOTICE_RE = /<task-notification>|<local-command-caveat>/;
const SYSTEM_TAGS_RE = /<(system-reminder|local-command-stdout)>[\s\S]*?<\/\1>/g;

// md-log's own commands: the call is not the learner's words.
const OWN_COMMANDS = new Set(["md-log", "md-unlog"]);

/**
 * A remark is a command in two forms. The expanded one uses the `<command-name>`
 * and `<command-args>` tags, as the environment writes a slash command. The typed
 * one is `/` plus a name followed by a space or end of line: `/usr/bin …` is not
 * a command, since a second `/` follows the name, and the remark stays text as is.
 */
export function parseCommand(text) {
	const tagged = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text);
	if (tagged) {
		const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text);
		return { name: tagged[1], args: args ? args[1].trim() : "" };
	}
	const m = /^\s*\/([A-Za-z][\w:-]*)(?:\s+([\s\S]*))?$/.exec(text);
	if (!m) return null;
	return { name: m[1], args: (m[2] || "").trim() };
}

/** Unknown mode — `null`; known mode but no event — an empty list. */
export function fromHook(mode, payload) {
	const p = payload || {};
	switch (mode) {
		case "session-start":
			return [{ type: "session-start", source: str(p.source) || null }];
		case "prompt": {
			const raw = str(p.prompt) || str(p.user_input);
			if (NOTICE_RE.test(raw)) return [];
			const command = parseCommand(raw);
			let text = raw.replace(SYSTEM_TAGS_RE, "").trim();
			// The expanded command form is written the way it is typed.
			if (command && raw.includes("<command-name>")) text = `/${command.name}${command.args ? ` ${command.args}` : ""}`;
			if ((command && OWN_COMMANDS.has(command.name)) || isNoise(text)) text = "";
			return [{ type: "user", text, command }];
		}
		case "message":
			return [
				{
					type: "delta",
					messageId: str(p.message_id) || null,
					// Delta number within the message, from zero (probe of 24.09.2026).
					index: Number.isInteger(p.index) && p.index >= 0 ? p.index : null,
					text: dropNoise(str(p.delta)),
					final: p.final === true,
				},
			];
		case "question":
			return [
				{
					type: "question",
					toolUseId: str(p.tool_use_id) || null,
					questions: list(p.tool_input && p.tool_input.questions),
				},
			];
		case "waiting":
			// The matcher in settings has already narrowed the event to `AskUserQuestion`, but our own
			// check is cheaper than trusting the matcher.
			if (p.tool_name && p.tool_name !== "AskUserQuestion") return [];
			return [{ type: "widget", toolUseId: str(p.tool_use_id) || null }];
		case "answer": {
			const result = p.tool_response || p.tool_input || {};
			return [
				{
					type: "answer",
					toolUseId: str(p.tool_use_id) || null,
					questions: list(result.questions),
					answers: result.answers && typeof result.answers === "object" ? result.answers : null,
				},
			];
		}
		case "stop":
			return [{ type: "stop", lastMessage: dropNoise(str(p.last_assistant_message)) }];
		default:
			return null;
	}
}

/**
 * The output guard's denial event: it is journaled instead of `question`, so
 * replay does not write the denied question into the note. `missing` is what was
 * lacking (`guard.mjs`).
 */
export function guardDeny(payload, missing) {
	return { type: "guard-deny", toolUseId: str(payload && payload.tool_use_id) || null, missing };
}

/** JSONL records; a broken line, most often an unfinished tail, is skipped. */
export function parseJsonl(text) {
	const records = [];
	for (const line of String(text).split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			records.push(JSON.parse(line));
		} catch {
			// Skip it.
		}
	}
	return records;
}

/** A transcript block → a thinking prose event, or `null`. */
function thinkingEvent(rec, block) {
	if (!block || block.type !== "thinking" || typeof block.thinking !== "string") return null;
	const text = dropNoise(block.thinking);
	if (!text.trim()) return null;
	return { type: "thinking", messageId: str(rec.message && rec.message.id) || null, text };
}

/** Assistant records that go into the lesson: not subagents and not service ones. */
const isLessonAssistant = (rec) => rec && typeof rec === "object" && rec.type === "assistant" && !rec.isSidechain && !rec.isMeta;

/**
 * New transcript records → events for live writing, in record order:
 *
 *   reasoning block with text   → `thinking`: it is in no payload
 *   text block                  → `{type: "written", messageId, text}`: the second
 *                                 witness for the output guard — the text has been
 *                                 printed even if the delta is still on its way. It
 *                                 does not go into the note: it arrives there as a delta
 *   learner remark or answer    → `{type: "input-written"}`: text written before
 *                                 it will not be a witness for a question after it
 *
 * Everything else live writing takes from the hook payloads. Record parsing is
 * the same `fromTranscript` that the backfill uses.
 */
export function tailEvents(records) {
	const events = [];
	for (const event of fromTranscript(records)) {
		if (event.type === "thinking") events.push(event);
		else if (event.type === "delta") events.push({ type: "written", messageId: event.messageId, text: event.text });
		else if (event.type === "user" || event.type === "answer") events.push({ type: "input-written" });
	}
	return events;
}

/** Remark text from a transcript record: a string or text blocks. */
function userText(content) {
	if (typeof content === "string") return content;
	return list(content)
		.filter((c) => c && c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");
}

/**
 * Transcript adapter: the session's JSONL records → the same events the hooks
 * give, in the order the hooks would have arrived live. Only the backfill reads
 * the transcript (ADR 0004). Each record is parsed by the same `fromHook` as a
 * live payload:
 *
 *   learner remark             → as `prompt`
 *   assistant text block       → as `message`; blocks of one message are one
 *                                message, joined by a blank line
 *   non-empty reasoning block  → `thinking`, as in live writing
 *   `AskUserQuestion` call     → `question`, then `widget`: the widget on screen
 *   its result with answers    → as `answer`
 *
 * Skipped: subagent records (`isSidechain`), `isMeta`, results of other tools
 * and anything unfamiliar.
 */
export function fromTranscript(records) {
	const events = [];
	let textOf = null; // the message whose text block was last
	for (const rec of list(records)) {
		if (!rec || typeof rec !== "object" || rec.isSidechain || rec.isMeta) continue;
		const content = rec.message && rec.message.content;

		if (rec.type === "user") {
			const result = list(content).find((c) => c && c.type === "tool_result");
			if (result) {
				const r = rec.toolUseResult;
				if (r && typeof r === "object" && r.answers) {
					events.push(...fromHook("answer", { tool_use_id: result.tool_use_id, tool_response: r }));
				}
				continue;
			}
			const raw = userText(content);
			if (!raw) continue;
			events.push(...fromHook("prompt", { prompt: raw }));
			textOf = null;
			continue;
		}

		if (!isLessonAssistant(rec)) continue;
		const messageId = str(rec.message && rec.message.id) || null;
		for (const block of list(content)) {
			if (!block || typeof block !== "object") continue;
			const thinking = thinkingEvent(rec, block);
			if (thinking) {
				events.push(thinking);
				textOf = null;
			} else if (block.type === "text" && typeof block.text === "string") {
				const sep = textOf !== null && textOf === messageId ? "\n\n" : "";
				events.push(...fromHook("message", { message_id: messageId, delta: sep + block.text }));
				textOf = messageId;
			} else if (block.type === "tool_use" && block.name === "AskUserQuestion") {
				events.push(...fromHook("question", { tool_use_id: block.id, tool_input: block.input }));
				events.push(...fromHook("waiting", { tool_name: "AskUserQuestion" }));
			}
		}
	}
	return events;
}