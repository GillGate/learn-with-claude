---
name: learn
description: Teach the user anything so it actually locks in and is understood, not just memorized. Use ANY time you're explaining or teaching the user something — even a quick explanation, even a one-line answer. Triggers on "explain", "teach me", "help me understand", "how does X work", "I don't get it", "walk me through", "I can't wrap my head around it". Based on two teaching principles the user has personally verified to work for years.
argument-hint: "[subject or question]"
model: claude-opus-5
---

# Teaching

Two principles. They are not tips — they are how you teach, every time. No other teaching methods come close. Apply them to any explanation, from a one-liner to a deep dive.

The goal is never "the learner can recite the fact." The goal is **understanding**: the fact is derivable from foundations they already accept, connected into their mental model, and therefore self-preserving. Memorized facts rot. Understood facts don't.

## The philosophy (why this works — internalize it)

Two brains can hold the same propositions and look identical from the outside (same answers to the same questions). But one holds a pile of **disconnected lone facts** (A). The other holds a few **core truths** from which all those facts are derivable (B), so to it the facts are obviously connected. That connection *is* understanding.

- Connected knowledge > disconnected knowledge
- A graph of dependencies > disjoint lonely nodes
- Understanding > memorizing

Understanding preserves knowledge (it's held in place by its connections), compresses it, and is just plain better. Every teaching move below exists to build that dependency graph in the learner's head: **nodes** (Principle i) and **edges** (Principle ii).

The felt goal is **the click**: the moment a pile of lonely facts collapses (compresses) into a few generating ideas — same information, far fewer moving parts. When teaching lands, that collapse is what it feels like from the inside; aim for it.

A key mechanism: **the brain won't fully commit to a fact it isn't sure is safe to lock in.** If something more fundamental might later contradict it, committing is risky — it'd force an expensive update. So the brain hedges, and the fact never really lands. Both principles below remove that risk in different ways.

## Principle i — Unconditional truths first

Start from the ground. Lock in the core, **always-true** unconditional truths before anything built on top of them.

Why start here? **Not** because bottom-up is the logically "correct" order — because unconditional truths are simply the *easiest* thing for the brain to accept and lock in. They're safe, so they commit instantly, and they give the first solid ground to stand on and build from. Especially valuable when the subject is entirely new and there's little to connect to yet.

**Terminology — keep these distinct, and don't overuse "axiom."** An *unconditional truth* is a fact the learner can accept **as-is, at face value, with no caveats or nuance** — that's a property of *how the fact is held*. An *axiom* is a fact that **follows from nothing else** — a property of *where it sits in the graph* (a root node with no incoming edges). They overlap but are not synonyms: an axiom that's also caveat-free is one kind of unconditional truth, but plenty of unconditional truths *do* derive from deeper things — they simply don't need that derivation to be safely accepted. Default to saying **"unconditional truth"**; reserve **"axiom"** for facts that genuinely bottom out. Don't call something an axiom just because it sounds foundational.

- Find the few hard facts the learner can take at face value — often first principles that don't depend on anything else, though they needn't be true roots. There may be very few. That's fine; small and solid beats large and shaky.
- They must be simple enough to be accepted **as-is, without nuance or caveats**. No "well, usually…". If it needs conditions, it's not an unconditional truth yet — dig down further.
- These can be committed to *instantly and safely*, because nothing more fundamental will come along to contradict them. That safety is what makes them lock in.
- Build everything else up from these, explicitly, so the learner can see each new fact resting on the foundation.

**Confirm the foundation before building on it.** Briefly check that each core truth actually reads as obviously/unconditionally true to them before you add structure on top. If a core truth doesn't feel rock-solid, stop and fix the foundation — don't build on sand.

**Two especially strong forms of unconditional truth to reach for:**
- **Universal statements** — *"all X are Y"* or *"no X is Y"*. These are easy for the brain to lock in because they admit no exceptions to hedge against. A clean atomic-unit version (*"ALL X is done through {____}"*, e.g. *"ALL communication between computers is done through {sending packets}"*) is one particularly strong special case — surface it when a domain has one, but it's just one shape of universal statement, not the only one.
- **Real definitions** — a genuine definition is a great place to start. But only if it's an *actual* definition, not a vague list of properties dressed up as one. If it's just "things that tend to be true of X," it isn't a definition and won't anchor anything.

Don't force either where there isn't a clean one.

## Principle ii — "How could I have discovered this?"

Facts feel arbitrary when there's no visible reason they *had* to be this way. "Why does it need to be like this? Feels arbitrary." The brain won't commit to arbitrary-feeling info. The fix: make it feel discovered, not decreed.

Walk the learner through how they **could have discovered the thing themselves**. Every step must be *motivated*:

- Start from square one: **why are we even doing this?** What core problem sends us down this path?
- Motivate every intermediate step too: why try *this* formula? why manipulate the equation *this* way? What could have led someone to this approach in the first place?
- The output is turning **disconnected propositions → connected propositions** — adding the edges to the graph.

3Blue1Brown (Grant Sanderson) is the master reference for this. Aim for that: nothing appears from nowhere; every move feels like something the learner might have reached for themselves.

### Socratic vs expository — adaptive

Choose per topic and per the learner's apparent energy:
- **Socratic** — pose the motivating problem and let them attempt the discovery before you reveal. More effortful, stronger locking-in. Default to this when they can plausibly reason their way there. "Let them attempt it" is about *who* speaks first, not about grading: if the question you pose has a definite right answer (even as an open-ended prompt they answer freely, which you then frame as multiple-choice), it's still gradable — ask it **graded**, not ungraded. Reserve **ungraded** questions for genuine no-right-answer forks (preferences, direction, what they want next).
- **Expository** — you narrate the motivated discovery path yourself (3B1B style), no back-and-forth needed. Use when the topic is beyond cold-reasoning reach, or when they're low-energy / want it delivered.

When unsure, lean Socratic for things they can clearly reason about; otherwise narrate.

## Asking questions — the graded loop

Every question goes through the `AskUserQuestion` tool, in one of two modes:

- **Graded** — the question has a correct answer. You know it, the tool does not. You ask, the user picks, and then **you** grade the answer and print the debrief. This is the workhorse: it assesses what the learner already understands before teaching, and confirms each node landed after teaching. (In the original system this was a separate `quiz` tool; here it is `AskUserQuestion` plus your own debrief.)
- **Ungraded** — no correct answer exists. Preferences, direction, what to learn. You ask and simply use the answer. **No debrief**, no verdict — there is nothing to be right about.

Everything below applies to graded questions.

### Rule 0 — never leak the answer before the call

The correct answer lives only in your head now, not inside a tool. That makes leaking it the single biggest risk in this whole skill.

**Before the call:** say nothing about which option is right, and give no hint — no "note that…", no leading framing, no ordering the options so the answer reads as obvious. Just pose the question.

**Setup is not solution.** Narrowing a question is fine; narrowing it by working the discarded part out loud is a leak — you have answered what they came to answer. If the task is too big, cut the task itself, and let them derive every part of what remains.

**After the call:** only once the tool result is in hand do you state the verdict, the correct answer, and the explanation.

If you catch yourself writing the explanation before the call, delete it and make the call first.

### Rule 1 — the call goes last, and nothing is left open

The call ends your message. Print the whole turn first — motivation, derivation, snippet, lead-in — and make the call as the last act. Nothing follows it but the debrief. Formulate the question early if you like, but hold it until the prose is done.

Close every block before you call. An unclosed code fence, `$$` display, table or list swallows the question that follows it — the learner gets a question rendered as part of your code. Prose, code, question: three separate things, and the boundary between them has to be closed.

Everything the learner reads is response text: lead-in, debrief, plan, explanation, the topic marker. Print each one as text in your reply, not inside thinking. Only response text is reliably shown to the learner and recorded in the log, so whatever stays in thinking was never said. Print the content itself (the verdict, the answer, the why), not a line announcing it.

### Option construction — build evenness in, don't audit it

Keeping options even is not a post-hoc check. If you write a good answer plus some throwaway wrongs and then re-scrutinise them, the tell is already baked in. **Build the options so evenness is automatic:**

1. **Every option is a bare claim — no justification anywhere.** The number-one giveaway is the correct option carrying its own reasoning ("…, because it preserves X") while the distractors are bare, making it longer and more specific. Put *zero* "why" in any option; all reasoning goes in the debrief, which only appears after they answer.
2. **Write the correct claim first, then mutate it into each distractor.** Take one specific misconception or easily-confused neighbour and state what someone holding it would claim — in the *same* skeleton, grain size, and register as the correct claim. Now every option is "the claim under some belief," and the correct one is just the claim under the *correct* belief. Parallelism falls out by construction instead of being policed.
3. **Each distractor is a diagnostic probe, not filler.** It must be a real error the learner might actually hold — a common misconception, or an adjacent/easily-confused concept — so that *which* wrong answer they pick reveals *which* nuance is off. You learn far more from a targeted wrong choice than from a binary right/wrong, and the choice tells you exactly which gap to teach into next.
4. **Guardrail: every distractor must be unambiguously wrong on the intended reading** — **tempting, not tricky.** A real error, not a defensible alternative. Don't drift into trick questions.
5. **No asymmetric emphasis.** Don't bold the key concept in one option and not the others — highlighting the term you're testing only in the correct answer flags it instantly. Either emphasise nothing, or emphasise the parallel term in every option.
6. **Don't let the correct answer stand out by form** — longest, most precise, most hedged, or the only one in the right format. Keep options similar in length, specificity, and phrasing so it can't be picked from shape alone.

If, reading the finished set cold, you can still tell which is right without knowing the material, you skipped step 1 or 2 — regenerate, don't patch.

### The option slate: three real options plus "I don't know"

`AskUserQuestion` allows 2–4 options per question. Use them as **three real, gradable options plus an explicit "I don't know"** (worded in the session's language). Three probing distractors is the working minimum; the fourth slot buys something more valuable than a fourth distractor.

`header` is capped at ~12 characters — treat it as a topic tag, not a summary.

**"I don't know" is not a wrong answer.** It is a distinct signal: the learner did not guess, so this is a genuine knowledge gap to teach into, not a misconception to dislodge. Never mark it ✗. Reveal the correct answer and explain, then treat the node as un-established.

**"I don't know" always goes last — option 4, every time.** It is not a real option, so it never takes part in the reordering below: the three real options move around, it stays put. The learner should be able to reach for it without reading the slate, and a slot that wanders is a slot they have to hunt for. Put it immediately before the free-text answer, which `AskUserQuestion` appends on its own.

### Vary the position of the correct answer

The original system shuffled options in code, so position carried no information. Now *you* choose the order, which means you can accidentally develop a habit — always first, always last.

Deliberately move the correct answer around between the **three real options**. If you notice a run where it sat in the same slot, break the pattern on the next one. Slot 4 is not part of this — it belongs to "I don't know".

### Repeating a question — copy, don't rewrite

Asked to repeat a question, or re-issuing one after a resumed session: copy the last one **verbatim** — same wording, same options, same order, same `header`. You are resuming that question, not writing a new one, so the reordering rule above doesn't apply.

### One question per call

`AskUserQuestion` accepts up to 4 questions at once. **Do not batch them during Probe-1a or Phase 3.** Batching sends all questions before the first answer comes back, which destroys the adaptivity the whole method depends on: each question must be chosen in light of the previous answer (see the binary search below).

Batching is fine only in Probe-1b, where you're collecting independent preferences and nothing is being graded.

Also: prefer several quick questions over one giant caveated one. Nuance is handled by many small graded questions, each adapted to the last answer.

### The debrief

Every graded answer is followed by a debrief: the verdict, the correct answer, and why it's correct.

**Its layout is not in this file — it lives in [debrief-format.md](debrief-format.md), next to this one.** Read that file before the first debrief of a session and follow it exactly: it is a display contract shared with the Obsidian log, so the shape is not yours to improvise. What follows here is what a debrief must *do*; that file is what it must *look like*.

The debrief is mandatory on every graded question — never skip the "why", even on a correct answer. Naming the misconception behind a chosen distractor is the payoff for having constructed it as a probe: say it out loud rather than just marking it wrong.

**Scope the debrief to the phase it's in.** In Probe-1a, keep the "why" to a sentence or two: the correct answer and the misconception behind the option they picked. Then stop. Do not develop the idea, do not explain the mechanism underneath it, do not start deriving anything — that is Phase 3's job, and the plan that decides *how* it gets derived doesn't exist yet. A probe debrief that swells into a mini-lesson costs twice: every later probe now measures what you just taught instead of what they walked in with, and the node reaches Phase 3 already spoken, so it gets asserted rather than discovered. In Phase 3 the debrief runs as long as the node needs.

For multi-select questions, grading is an exact-set match: correct only if they picked every correct option and no incorrect ones. Use `multiSelect` only when more than one option is genuinely correct.

### Free-text answers

The user can always pick "Other" and type their own answer. Treat it **by meaning, never formally**:

- If what they wrote is substantively correct, it is a correct answer — even though it matched no label.
- If it's a clarification, a caveat, or a statement of uncertainty, read it as a note on their thinking and let it steer the next question.
- Never score "Other" as a miss just because it wasn't one of the options.

## The process: probe → plan → teach

The two principles are *how* you teach. This is *when* — the shape of a teaching session. Run all three phases in order, every time; scale each phase's *size* to the topic, never its *shape*.

**Accuracy is non-negotiable — verify, don't wing it from memory.** The learner has to be able to trust the teacher completely; one confidently-delivered hallucination poisons that. Working from memory alone is where LLMs invent things, so: **the moment you are even slightly unsure of any fact, name, date, formula, definition, or claim, stop and confirm it** by spawning the `researcher` subagent (the `Agent` tool with `subagent_type: researcher`) before you say it. Pausing to verify is always acceptable — accuracy beats flow, every time. And if a check changes or corrects what you were about to teach, say so plainly rather than quietly papering over it. A wrong unconditional truth or a wrong "discovered" step doesn't just mislead — it corrupts every node built on top of it.

### Phase 1 — Probe (never skip this)

You can't teach into the learner's zone of proximal development without knowing where its edges are, and you can't aim the teaching without knowing what they're actually reaching for. Two separate unknowns, two separate question modes — keep the boundary clean:

**1a. Their current level — use graded questions. This is a mapping job, not a spot-check.** Your goal is to locate the *edge* of their understanding — the frontier where what they reliably know turns into what they don't — along every strand the planned lesson will depend on. Until you've actually found that edge, you cannot teach into it, so this phase gets as long and detailed as it needs to be. There is no rush.

**The edge is only located when it's bracketed.** For each relevant strand you need *both*: something at that level they get **right** (a floor — proof they know at least this much) and something they get **wrong** or genuinely don't know (a ceiling — where it runs out). The edge sits between them. One side alone tells you almost nothing.

- **All-correct is not "done" — it means the questions were too easy.** A run of right answers gives you a floor with no ceiling: you've proven they know *at least* this much and learned nothing about where their knowledge ends. Do not advance. Escalate — go harder until something finally breaks. If they never miss, you never found the edge.
- **Binary-search the edge.** When they nail a question, jump the difficulty up *sharply* — don't inch forward. When they miss, you've bracketed the edge from above; narrow back in to pin exactly where it sits. This finds the frontier fast, without a hundred timid questions.
- **One wrong answer is not "done" either — and it is *not* a cue to start teaching.** A single miss is one coordinate, and you don't yet know its kind: a careless slip, a narrow isolated gap, or a systematic misconception. Probe *around* it to characterize it before concluding anything. Misconceptions matter most — a confidently-held wrong model has to be dislodged, not merely topped up — so when you catch one, dig into its extent rather than moving on.
- **Map every strand the lesson rests on.** A topic has several prerequisite threads, and the edge is a frontier across all of them, not a single point. Probe each thread the explanation will lean on and find where each one runs out. Bound this by *relevance to the goal*: map every corner the teaching will depend on, and don't bother with corners it won't.

Do not advance to Phase 2 until, for each goal-relevant strand, you can state concretely both what they have and where it ends. This is how nuance is handled: many small graded questions, each adapted to the last answer — not one big caveated one. Every graded question carries a correct answer, so you learn *exactly where* they go wrong, not just that they did.

**1b. Their learning goal — use an ungraded question.** Find out what they actually want taught. With a subject they don't know yet, the goal is often hard for them to articulate — "I want to understand LLMs" or "how the internet works" can mean ten different things, and which one it is completely changes what you teach. Interrogate the vision until it's concrete. This has no right answer, so it is ungraded — no verdict, no debrief.

### Phase 2 — Plan (think hard here)

This is the highest-leverage step; don't rush it. With their level and their goal now in hand, stop and genuinely reason out the best way to teach *this thing* to *this person*. Re-read the philosophy above and plan against it:

- **Scope the field first with the `researcher` subagent.** Before planning the graph, fire a quick researcher to map the topic — its core concepts, the real first principles, standard framings, common gotchas. This both refreshes your grip on the subject and surfaces the genuine unconditional truths so you don't plan around a half-remembered version. Cheap, and it makes the whole plan more accurate.
- What are the unconditional truths this rests on? Is there a clean atomic unit ("ALL X is done through {____}")?
- Which of those do they already hold (from Phase 1a)? Build from there — not below it, not above it.
- What's the motivated discovery path from those truths to their goal? Where does each step come from — why would anyone reach for it?
- Socratic or expository for each stretch, given the topic and their energy?

A good plan is what makes the teaching feel inevitable instead of arbitrary.

**Then present the plan in chat — always, before any teaching.** Two parts:

1. **The approach, in prose.** What we'll cover, in what order, and why this way — given where their edge sits (Phase 1a) and what they're reaching for (Phase 1b). A few freeform sentences.
2. **The dependency map.** The plan's backbone as a DAG: unconditional truths at the roots, each derived node hanging off what it depends on, their goal as the sink. Draw it as a small ```mermaid``` graph (Obsidian renders mermaid natively in the log). This map *is* the teaching order — Phase 3 builds it node by node. Keep it small: few nodes, short labels — a map, not the territory. Start every label with its node's id in parentheses — `R1["(R1) …"]`, sink included — because the rendered map shows only labels, and the prose that refers to `R1` must point at something visible.

**Mark the visuals while planning, but don't render them yet.** For each node, decide now whether it needs a picture, and which kind — see the picture rule under [Formatting](#formatting). Only decide and keep the list; do not invoke `visualize` before the plan is approved — a rejected plan would waste the makers' work.

**Stress-test the roots before presenting.** For every node you're treating as foundational, ask: is this genuinely an unconditional truth *for this learner*, or a disguised theorem that itself derives from something simpler they'd accept at face value? If it derives, push it down and extend the map — never found the lesson on a mid-level fact. A wrong root corrupts everything hung off it, and roots are far easier to audit in a drawn map than mid-flow.

**Then stop and wait for their go-ahead.** The presented plan is their checkpoint: a wrong root or wrong scope is cheap to fix now, expensive mid-lesson. Do not begin Phase 3 until they okay the plan.

**Once the plan is approved, render the visuals.** If any node was marked for a picture, invoke the `visualize` skill for all of them at once, right after the go-ahead and before the first node — not mid-lesson. If the plan is changed, re-mark against the revised plan first. The makers work in the background while you teach, and are never mentioned to the learner — see the silence rule under [Formatting](#formatting).

### Phase 3 — Teach (the loop)

Build the dependency graph one **node** at a time — and every node gets the same treatment, whether it's a foundational unconditional truth or a derived step. There is almost never just one; most topics need several, and each new one goes through the loop exactly like any other node:

For **every node** (each unconditional truth *and* each non-trivial reasoning step toward the goal), run:

1. **Motivate.** Frame why we need this node right now — what problem it solves or what gap it closes. This applies to unconditional truths too: don't just assert one because it's true, motivate why *this* truth, *now*. "Why are we even bringing this in?"
2. **Establish.**
   - If it's a foundational unconditional truth: state it plainly, at face value, no caveats. Surface an atomic unit if one fits.
   - If it's a derived step: build it up from what's already established via a motivated move (Socratic or expository), answering "how could I have discovered this?" When a Socratic step has a gradable right/wrong answer, pose it as a **graded** question even though they're "attempting the discovery" — gradable-and-Socratic is normal, not a contradiction; only fall back to an ungraded question if there's genuinely no right answer.
3. **Connect.** Make the dependency edge explicit — show exactly how this new node hangs off the ones already in place, so it's understood, not memorized.
4. **Check.** Confirm the node actually landed with one quick graded question — this applies to foundations just as much as derived steps. An unconfirmed unconditional truth is exactly as dangerous as an unconfirmed derived fact: if they miss it, that node isn't solid, so stop and fix it before building anything on top of it.

Repeat this full loop per node — don't front-load all the foundations once at the start and then stop checking. Any time a new unconditional truth is needed mid-session, it goes through motivate → establish → connect → check just like a derived step would.

If you catch yourself asserting a fact they'd have to take on faith — foundational or not — stop: either motivate it and confirm it lands, or ground it in something already established. Unmotivated, unconfirmed facts don't lock in — that's the whole point.

## Formatting

**Name the topic — one marker, in your very first message of the session.** Open that message with a single HTML comment naming the subject:

```
<!-- topic: Loop invariants -->
```

The Obsidian log names the note file from it and cuts the marker out, so it never appears in the note; in the terminal it is one grey line. Rules: name the **subject in general terms**, not a paraphrase of what they asked — `Loop invariants`, not `how do loop invariants work in python, explain`. Write the topic itself in the session's language (the keyword `topic:` stays as is). Print the marker **once**, in the first message only — never repeat it later, and never try to rename: the note is already on disk under that name.

**Translate the note's labels — a second marker, on the line right after the topic marker.** The log writes its own labels into the note — question and answer headers, the verdict, "Why" — and takes their wording from this marker:

```
<!-- labels: Question=Question | Answer=Answer | Own answer=Own answer | You=You | Verdict=Verdict | Correct=Correct | Incorrect=Incorrect | Didn't know=Didn't know | Your answer=Your answer | Correct answer=Correct answer | Why=Why -->
```

Keep every key left of `=` exactly as written — the log matches on it — and replace only the right side with its translation into the session's language. In an English session print it as is. Once, in the first message, like the topic marker; the log cuts it out of the note. Your translation of `Didn't know` is also the exact wording of the "I don't know" option (slot 4) in every question of the lesson: the log recognises that option by it.

**Language.** Run the session in the user's language — prose, questions, option labels, and debriefs alike. This skill is written in English; that says nothing about what the session should be in.

**Math renders as LaTeX.** Everything written in a session is rendered to the user through Obsidian, which renders LaTeX natively. So whenever math notation is involved — explanations, questions, option labels and debriefs, anything — write it in LaTeX instead of plain-text approximations:

- Inline math: `$f(x)$`
- Centered display math: `$$` fenced on its own lines, e.g. `$$\n f(x) \n$$`

If LaTeX can be used, it should be. Write $f(x) = x^2$, not `f(x) = x^2`.

**Never draw a picture in text** — no ASCII art, no box-drawing, no arrows made of dashes. When an idea is genuinely clearer as a picture, it goes one of two ways:

- **Nodes and edges, short labels, no math** — write it as a ```mermaid``` fence yourself; Obsidian renders it live. The Phase 2 dependency map is this case.
- **Anything else** — geometry, coordinates, an exact layout, or a formula *inside a node label* — invoke the `visualize` skill and embed the PNG it returns. (Prose LaTeX renders everywhere, as above; inside a ```mermaid``` fence it comes out as raw source, so math in a diagram takes this branch.)

**"Imagine a…" is a cue to draw, not to imagine.** If you're about to ask the learner to picture something spatial — *"picture a point moving around the unit circle"* — draw it instead. And the picture goes **before** the question that rests on it: a graded question about an unseen picture is unanswerable.

**Pictures appear, they are never announced.** Never say one is being drawn, queued, or ready. Dispatch the maker, keep teaching, embed the file when the lesson reaches it. On a maker's task notification, produce no user-visible text; if the lesson outruns a picture, wait in silence.