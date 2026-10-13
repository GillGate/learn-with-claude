---
name: visualize
description: "Add a correct, minimal visual to a lesson — a diagram or geometric picture — that renders inline in the Obsidian log. Use when an idea is genuinely clearer as a picture: a dependency graph, system/flow, sequence, state machine, tree, comparison, or a spatial/geometric thing (coordinate geometry, number line, vectors, a plot, a physical layout). Outsources authoring+rendering to a maker subagent that verifies the image by looking at it, then you embed the returned file."
---

# Visualize

A picture earns its place only when it shows something words can't — shape, structure, direction, relationship, geometry. This skill produces ONE such picture, guarantees it is **correct** (the maker renders it and looks at it before returning), and drops it into the lesson so it renders inline in the Obsidian `md-log` file.

You are the **creative director**. You decide the exact idea and distill it to its fewest carrying elements. A **maker subagent** does the authoring, rendering, visual verification, and saving, then returns a filename. You embed that filename in your reply.

## When to visualize (and when not to)

This teaching system builds a **dependency graph in the learner's head** — axioms at the root, derived facts hanging off them. A visual is powerful exactly when it makes that structure (or a geometry) visible. Reach for one when:

- The idea is a **structure or relationship**: dependencies, a system with parts and arrows, a flow/pipeline, a sequence of exchanges, a state machine, a tree/hierarchy, a comparison, a containment (what's inside vs outside).
- The idea is **spatial or geometric**: coordinate geometry, a number line, vectors, a function's shape, a physical arrangement.

Do NOT visualize when prose or a single equation already carries it. A decorative diagram that just restates the sentence next to it adds noise and a chance to be wrong. When in doubt, don't — a missing visual is cheaper than a false one.

**And not every picture needs a maker.** Plain nodes-and-edges with short labels and no math is a ```mermaid``` fence you write by hand. Come here when the picture needs a *rendering* guarantee: a formula in a label, exact geometry, a layout to confirm by eye.

## Choose the maker

Two makers, discovered from `.claude/agents/`:

- **`mermaid-maker`** — structural/relational visuals: flowcharts, sequence/state/ER/class diagrams, trees, mindmaps, timelines. The default of the two.
- **`svg-maker`** — spatial/geometric visuals Mermaid can't lay out: exact coordinates, geometry figures, number lines, vectors, plots, custom shapes.

Rule of thumb: if it's *nodes-and-edges / relationships*, use mermaid-maker. If it's *positions-and-shapes / geometry*, use svg-maker.

## Brief the maker well: one idea, fewest elements

The most common failure is **cramming** — every extra label makes the picture harder to read AND harder to lay out correctly. Before briefing, prune to the fewest elements that carry the idea, and for each ask: *"if I delete this, is the idea still clear?"* If yes, delete it.

Give the maker the concept AND the concrete elements you want — not a vague topic, and not a long checklist.

- BAD: "make a diagram about how TCP works"
- GOOD: "graph TD: a node 'packet' at the top; arrows down to 'ordering' and 'retransmit on loss'; both arrows down into 'reliable stream'. No title. Show that reliability is built FROM packets, not alongside them."

Keep the idea intact but trust the maker to compose; if your brief lists more than ~5–7 elements, cut it first.

Write the brief in the language of the lesson — labels inside the picture are read by the learner, not by you.

Describe elements by role, never by color. The renderer owns the palette on a dark plate, so "white fill" or "black dots" cannot be done as asked — the maker has to deviate and explain. "An empty depletion layer" or "two dots on each bond" carries the same idea and survives the palette.

## Invoke

Dispatch the maker with the `Agent` tool, naming it in `subagent_type`:

```
Agent(subagent_type="mermaid-maker", description="Diagram <topic>", prompt="<your minimal, concrete brief>")
```
```
Agent(subagent_type="svg-maker", description="Draw <topic>", prompt="<your minimal, concrete brief>")
```

**The maker runs in the background, and silently.** Dispatch it and keep teaching; never tell the learner a picture is being made or is ready, and answer its completion notification with the single character `⏳` and nothing else (a turn can't be empty; md-log drops exactly this paragraph from the note). They meet only the finished embed.

The maker owns the whole authoring loop — it writes the source with `Write`/`Edit`, renders it to a PNG with the project's render script, **looks at the PNG with `Read` and iterates until it is correct and clean**, publishes it into the vault with a unique filename, and returns:

```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <imgDir>/viz-<slug>-<timestamp>.png
```

If it returns `RESULT: NONE`, it couldn't make a correct picture of the brief — simplify or rethink, or decide the visual isn't worth it. Never hand-author or fake a diagram yourself; correctness depends on the maker's render-and-inspect loop.

## Embed it in the lesson

Put the embed directly in your teaching reply, using Obsidian's wikilink embed with the returned **filename** (not the full path) and a display width:

```
![[viz-<slug>-<timestamp>.png|500]]
```

That's all. The `md-log` hooks mirror your reply text verbatim into the linked `.md`, and Obsidian resolves the embed by filename anywhere in the vault (the maker saves into the folder configured as `imgDir`, which is inside the vault) — so it renders inline in the lesson automatically. Width `|500` is a good default; use larger for dense diagrams. Introduce the visual in a sentence, then let it carry the idea — don't narrate every element back in prose.

## Why this is reliable

- The maker never returns a picture it hasn't **looked at**, so "renders fine but says something false" is caught before it reaches the learner.
- PNG embed means **what the maker verified is pixel-identical to what the learner sees** — no re-render drift.
- Unique filenames keep Obsidian's by-filename embed resolution unambiguous.

> The makers render through `.claude/scripts/render-viz.mjs` — a vendored Mermaid bundle plus installed Chrome, which rasterizes hand-written SVG the same way. You don't render anything yourself — you only brief the maker and embed the filename it returns.