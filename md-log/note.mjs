/**
 * Note: `noteEditor(text, registry)` — editing the note text with core
 * operations, and one file write for all operations of an event.
 *
 * One note change is one file write: Obsidian rereads the note on a filesystem
 * event and shows an intermediate state until the next one.
 *
 * "Own blocks". Only our own already-written content may be touched, and only
 * if it lies in the note verbatim. The registry of own blocks maps identifier →
 * exact text; it is kept in the session state between hooks. A block with an
 * anchor (`label`) is an answer block awaiting a verdict: an invisible comment
 * `<!-- md-log:a:<id> -->` stands before it in the file (ADR 0006). The anchor
 * finds the block even if identical text lies above or below; without an
 * anchor the block is searched from the end of the note — we have not yet
 * written a newer copy of the same text, so the last one is always ours.
 *
 * Operations (issued by the `lesson.mjs` core):
 *   {op: "append", text, id?, label?}     to the end of the note
 *   {op: "insertBefore", before, text}    above an own block; if absent, to the end
 *   {op: "replace", id, text, orElse?}    replace an own block; edited means a
 *                                         conflict, the block is left alone,
 *                                         `orElse` goes to the end
 *   {op: "remove", id}                    remove an own block; edited means a conflict
 *   {op: "unlabel", id}                   drop the anchor, keep the block
 */

import fs from "node:fs";
import path from "node:path";

const labelOf = (id) => `<!-- md-log:a:${id} -->`;

/** Blocks separated by a blank line, at the end of the text. */
function appendText(text, block) {
	const body = String(block).trim();
	if (!body) return text;
	const was = text.replace(/\s+$/, "");
	return `${was}${was.length ? "\n\n" : ""}${body}\n`;
}

export function noteEditor(text, registry = {}) {
	let out = text;
	const own = { ...registry };
	const conflicts = [];

	/** Where an own block lies in the text — `{at, end}` including the label — or `null`. */
	function locate(id) {
		const entry = own[id];
		if (!entry) return null;
		if (entry.label) {
			const label = labelOf(id);
			const at = out.indexOf(label);
			if (at === -1 || out.indexOf(label, at + label.length) !== -1) return null; // missing or duplicated
			const expected = `${label}\n${entry.text}`;
			if (out.slice(at, at + expected.length) !== expected) return null;
			const end = at + expected.length;
			// A prefix match is not enough: the student may have appended to the end of the last line.
			if (end < out.length && out[end] !== "\n") return null;
			return { at, end };
		}
		const at = out.lastIndexOf(entry.text);
		if (at === -1) return null;
		const end = at + entry.text.length;
		if ((at > 0 && out[at - 1] !== "\n") || (end < out.length && out[end] !== "\n")) return null;
		return { at, end };
	}

	// Operations refer to each other through `ops`: when they cannot find their
	// block, `insertBefore` and `replace` fall back to `append`.
	const ops = {
		append({ text: block, id, label }) {
			const body = String(block).trim();
			if (!body) return;
			out = appendText(out, label ? `${labelOf(id)}\n${body}` : body);
			if (id) own[id] = { text: body, label: Boolean(label) };
		},
		insertBefore({ before, text: block }) {
			const body = String(block).trim();
			if (!body) return;
			const hit = locate(before);
			if (!hit) return ops.append({ text: body });
			const head = out.slice(0, hit.at).replace(/\s+$/, "");
			out = `${head}${head.length ? "\n\n" : ""}${body}\n\n${out.slice(hit.at)}`;
		},
		replace({ id, text: block, orElse }) {
			const hit = locate(id);
			delete own[id];
			if (!hit) {
				conflicts.push(id);
				if (orElse) ops.append({ text: orElse });
				return;
			}
			out = out.slice(0, hit.at) + String(block).trim() + out.slice(hit.end);
		},
		remove({ id }) {
			const hit = locate(id);
			delete own[id];
			if (!hit) {
				conflicts.push(id);
				return;
			}
			let end = hit.end;
			while (end < out.length && (out[end] === "\n" || out[end] === "\r")) end++;
			out = out.slice(0, hit.at) + out.slice(end);
		},
		unlabel({ id }) {
			const entry = own[id];
			const hit = entry && entry.label ? locate(id) : null;
			delete own[id];
			if (hit) out = out.slice(0, hit.at) + out.slice(hit.at + labelOf(id).length + 1);
		},
	};

	return {
		apply(op) {
			const fn = op && ops[op.op];
			if (!fn) throw new Error(`unknown note operation: ${op && op.op}`);
			fn(op);
		},
		/** Forget own blocks that the core no longer references. */
		retain(ids) {
			for (const id of Object.keys(own)) if (!ids.includes(id)) delete own[id];
		},
		/** → `{text, registry, conflicts, changed}`. */
		commit() {
			return { text: out, registry: own, conflicts, changed: out !== text };
		},
	};
}

/**
 * A new note `<dir>/<name>.md` is empty: no heading, no date. Obsidian keeps
 * the date in the file properties, and an H1 would duplicate the name.
 * Same-named topics are told apart by a number: `Topic 2.md`. → absolute path.
 */
export function createNote(dir, name) {
	fs.mkdirSync(dir, { recursive: true });
	let file = path.join(dir, `${name}.md`);
	for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${name} ${n}.md`);
	fs.writeFileSync(file, "", "utf8");
	return file;
}

export function readNote(notePath) {
	return fs.existsSync(notePath) ? fs.readFileSync(notePath, "utf8") : "";
}

export function writeNote(notePath, text) {
	fs.writeFileSync(notePath, text, "utf8");
}