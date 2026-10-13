# learn-with-claude

A teaching system for Claude Code. Instead of answering, the agent **teaches**: it asks questions to find where your knowledge ends, agrees a lesson plan with you, then walks through it step by step, checking understanding along the way. The lesson is mirrored as it happens into a markdown note you can read in Obsidian, with math, diagrams and colour-coded answer blocks.

This is a port of [amosblomqvist/learn](https://github.com/amosblomqvist/learn) ([video](https://www.youtube.com/watch?v=kzcI5F4tGiU)) from the [pi](https://github.com/earendil-works/pi) agent to Claude Code. The teaching principles are the original author's.

## How a lesson works

Two principles drive every lesson:

- **Unconditional truths first.** A lesson starts from what can be accepted as-is, with no caveats. Everything else is built on top in explicit steps.
- **"How could I have figured this out myself?"** No fact appears out of nowhere; every step is motivated. The goal is understanding, not memorisation.

A lesson always runs in three phases:

1. **Probe**: questions locate the edge of your knowledge, what you know for sure and where that stops.
2. **Plan**: a prose plan plus a dependency map. The lesson does not start until you approve it.
3. **Teach**: the map is walked one node at a time: motivate, explain, connect to what you already know, check with a question.

Questions with a right answer use Claude Code's built-in `AskUserQuestion` picker: three plausible options plus "I don't know". Wrong options are built from real misconceptions, so your pick shows what needs fixing. After each answer comes a debrief: verdict, correct answer, reasoning. Facts are verified with web search before the lesson rather than recalled from memory.

## What ends up in Obsidian

A set of Claude Code hooks writes the session into a note as it goes: your messages, the lesson prose, questions, answers and debriefs.

- Student turns, Claude turns, questions and answers are rendered as Obsidian callouts (`quote`, `abstract`, `question`, `example`).
- The answer block is coloured by verdict: green for correct, red for wrong, yellow for "I don't know".
- LaTeX and mermaid are rendered by Obsidian itself.
- When an idea is clearer as a picture, the `visualize` skill delegates it to a maker subagent. `mermaid-maker` handles structural diagrams (graphs, flows, sequences, state machines, trees, ER, timelines); `svg-maker` handles spatial and geometric ones (coordinate geometry, number lines, vectors, plots). The agent renders the image to PNG, looks at it, iterates until it is correct, saves it into the image folder and returns the filename to embed.

## What's in it

- `skills/learn/` — the teaching process: probe, plan, teach
- `skills/visualize/` — adds a correct, minimal diagram to a lesson when an idea is clearer as a picture
- `agents/` — `researcher`, `svg-maker`, `mermaid-maker`: the subagents the system delegates to
- `commands/` — `/md-log` and `/md-unlog`
- `md-log/` — hooks that mirror the session into a markdown note
- `hooks/` — auto-allows the visual render command, so diagrams don't trigger a permission prompt
- `scripts/` — headless-browser renderer for Mermaid and SVG
- `lib/` — shared constants and config loading
- `md-log.config.json`, `settings.json` — configuration and hook wiring

## Requirements

- **Claude Code** and **Node.js** on `PATH` (checked on v24.16.0). There are no dependencies; `npm install` is not needed.
- **Obsidian**. The notes folder must be inside the vault.
- **Google Chrome**, only for visuals. Edge or any Chromium-based browser works: set `VIZ_CHROME` to its executable path. Without a browser everything works except visuals.

## Installation

1. This repo **is** a `.claude` directory. From the root of the folder you will launch Claude Code from, clone it as `.claude`:

   ```bash
   git clone GillGate/learn-with-claude .claude
   ```

2. Set the folders in `.claude/md-log.config.json`:

   ```json
   { "notesDir": "notes", "imgDir": "img", "autolink": true, "dedupeQuestions": false }
   ```

   | Key | Default | Meaning |
   |---|---|---|
   | `notesDir` | `notes` | Where notes are written |
   | `imgDir` | `img` | Where rendered visuals are saved |
   | `stateDir` | `.md-log` | Where session bindings are stored |
   | `autolink` | `true` | Bind a note automatically on `/learn`; `false` disables it |
   | `dedupeQuestions` | `false` | Drop a duplicate question re-asked after a session resume |

   Both `notesDir` and `imgDir` must be inside the Obsidian vault; use absolute paths if the vault lives apart from the code. A missing config file means defaults; a broken one means defaults plus a line in the error log. The config path can be overridden with an environment variable.
3. Add the working folders that appear in the project root to `.gitignore`: `.md-log/` (binding state) and `.viz-temp/` (visual drafts).

## Commands

| Command | What it does |
|---|---|
| `/learn <topic>` | Start a lesson; the note is bound automatically |
| `/md-log` | Create a note and bind it to the session |
| `/md-log path/to/file.md` | Bind an existing note and write the whole session into it from the start |
| `/md-unlog` | Unbind the note; the note itself is left as it is |

The `learn` skill can also trigger without the command, from an ordinary "explain how … works".

## Differences from pi

The teaching philosophy is unchanged. The machinery around it is reworked for Claude Code.

- **The note.** In pi, an extension inside the agent process writes it. Here separate hook processes write it from Claude Code's hook payloads, so the model is never in the loop: no tokens go to logging, and the note doesn't depend on the model remembering to write it. A note is bound automatically on `/learn` (in pi only a manual `/md-log <file>` binds one), backfill replays the whole session, and an output guard rejects a lesson question that has no text before it, no debrief after a graded answer, or an "I don't know" option that isn't last.
- **Visuals.** Lightweight and self-contained. Rendering uses a bundled Mermaid and headless Chrome: no `npm install`, no `mermaid-cli`, no `rsvg-convert`, and the only external dependency is a Chrome-based browser. Makers work with plain `Write`/`Edit`, a render script through `Bash`, and `Read` to look at the PNG. A permission hook auto-allows only the render command, and SVG is rendered inside Chrome's sandbox, which also lets a maker compute geometry with a `<script>` in the SVG. Simple graphs are written by the teacher directly as a mermaid block, with no subagent round-trip. Visuals are marked while planning and drawn all at once after the plan is approved, before the first teaching step.
- **Lesson skill.** `teach` is renamed `learn`; the principles are untouched. New rules from real lessons: narrowing a question must not answer it, so the discarded part is never worked out loud. Debriefs while probing stay to a sentence or two, so later probes still measure what the learner walked in with. A wrong pick is named, not just marked: the misconception behind it is said aloud. The dependency map's node labels start with their id, since the rendered diagram shows only labels.
- **Questions.** pi has its own `quiz` tool that grades the answer and shows ✓/✗ instantly. Here questions go through Claude Code's built-in `AskUserQuestion`, and the verdict and explanation come as a message after the answer. The tool does not bind the correct answer to an option, shuffle options, or keep a custom "Other" answer alongside the choice, so the skill handles these by instruction. Questions have at most three real options plus "I don't know". The debrief layout lives in its own file, `skills/learn/debrief-format.md`, so it can be edited without touching the main skill.
- **Models.** The lesson is pinned to `claude-opus-5`; pi did not pin one. Newer versions (`claude-opus-5-5`) tend to put debriefs and lead-ins into their reasoning instead of the reply, so that text never reaches the note. This is a potential bug, and pinning avoids it. The researcher and the makers run on `haiku`.