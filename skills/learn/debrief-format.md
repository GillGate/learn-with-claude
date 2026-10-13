# The debrief layout

How a graded-answer debrief is laid out on screen. `SKILL.md` decides *when* a debrief is printed and *what* it has to say; this file decides only what it looks like. Edit it freely — the teaching doesn't depend on it.

Three things in here are a real contract, not taste: the Obsidian log reads the **first character** of the message to colour the answer block, splits the debrief at the **first blank line** to decide what goes inside that block, and reads the **option number** of the correct answer from the lines above it. Change those and the log stops working.

## The template

After every graded answer, print this — compactly, no preamble:

```
✗ Verdict: Incorrect                ← ✓ Correct / ✗ Incorrect / ? Didn't know
Your answer: 1. <label> — <what that option claims>
$$ <the formula that option amounts to, if it has one> $$
Correct answer: 2. <label> — <what it claims>    ← omit both lines when they got it right
$$ <its formula, if it has one> $$
                                    ← blank line here, always
Why: <why the correct answer is correct — and, when they missed,
      name the specific misconception behind the option they chose>
```

## Rules

**The verdict glyph must be the very first character of the message** — `✓`, `✗`, or `?`, nothing before it, not even a space or a word. The log that mirrors the session to Obsidian reads that character to colour the answer block green, red, or yellow; a glyph anywhere else means no colour. `?` is a third kind, not a failure: "I don't know" is never marked ✗. The log then **cuts the glyph out of the block's title**, because Obsidian draws the matching icon itself — so put the glyph only on this first line, not on the answer lines below it.

**The labels are output, not markers — translate them.** `Verdict:`, `Your answer:`, `Correct answer:` and `Why:` are written in English here only because this file is; the debrief the learner reads is part of the session and goes in the session's language, labels and all. (The note's own labels come from the labels marker in `SKILL.md`, not from here: the log rewrites the answer block and the `Why:` label itself.) The glyph is the exception — `✓`, `✗` and `?` are never translated or replaced, because that character is what the log reads.

**Name the correct answer by its option number** — `2. <label>`, as in the template — and put no other option numbers above the blank line besides the learner's own. The log builds its answer block itself — verdict, the learner's answer, the correct option — and takes only that number from you.

**Keep the blank line before `Why:`.** The log splits the debrief there: everything above it goes inside the coloured answer block, everything from `Why:` on stays plain text — which is where display math, mermaid and image embeds actually render. So above the blank line put only the verdict head — the lines shown in the template, each one short, display math on a line of its own — and all the reasoning below it. Inside the block, `$$…$$` written on a single line does render; multi-line `$$` fences and mermaid do not, so those belong below.

**Print the debrief as response text, not inside thinking.** The log reads only the reply: a debrief left in thinking colours nothing and never reaches the note.

**Do not wrap the debrief in a code fence.** The fence above is the template's own formatting, not part of the output. Fenced text stops LaTeX from rendering and hides the glyph behind the ``` line.