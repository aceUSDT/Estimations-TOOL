# Design brief — Estimation Tools

A prompt for Claude Design. Written from an audit of the live app, not from
impressions.

---

## What the audit found

These are measured from `index.html`, and together they are why the app reads as
generated rather than designed.

| symptom | measured | what a designed system has |
|---|---|---|
| type sizes | **20 distinct**, incl. 10.5 / 11.5 / 12.5 / 13.5 / 14.5px and a stray 3.2px | 6–8 steps on one ratio |
| radii | **11 distinct** (2,3,4,5,6,7,8,9,11,12,14px) | 3–4 |
| padding | **22 distinct**, nearly every integer 2–16px | one 4px-based scale |
| elevation | **1 shadow**, `0 1px 2px rgba(22,32,46,.05)` | 3–5 tiers, or none by choice |
| typeface | **`"Segoe UI"` first** — the Windows system font | a chosen face |
| focus rings | **0 `:focus-visible` rules** | every interactive element |
| motion | **0 `prefers-reduced-motion`**; transitions are bare `.12s` / `.22s` with **no easing curve** | tokenised duration + curve |
| primaries | **two blues** — `--brand:#009ee2` and `--blue:#1668e3` | one, with a defined role |

Half-pixel type steps and 22 padding values are the fingerprint: every value was
decided at the moment it was needed, none in relation to the others. That is what
people are seeing when they say "vibe coded". It is not the colours.

## The product this has to look like

Not a SaaS landing page. It is a **precision instrument for UK electrical
estimators** — people who read BS 7671 schedules and price 400A MCCBs, and who
will not trust a tool that looks playful. Someone's commercial bid depends on
whether they believe the number on the screen.

Reference points: Stripe Dashboard's data density, Linear's restraint, and the
conventions of technical drafting the users already read all day — ruled tables,
consistent line weights, monospaced figures, generous margins around dense data.

The product's own subject matter is the design language. Use it.

---

# THE PROMPT

Paste everything below into Claude Design.

---

You are designing **Estimation Tools**, a desktop-and-browser application that
reads UK electrical documents — schematics, distribution-board schedules,
specifications — and produces a verifiable device take-off an estimator sends to
a supplier for pricing.

The users are professional electrical estimators. They are not impressed by
gradients. They are impressed by a tool that shows them 200 rows of circuit data
without a single moment of doubt about which board a row belongs to. Design for
credibility under scrutiny, not for a screenshot.

## The problem to solve

The current build has 20 type sizes, 11 corner radii, 22 padding values, one
barely-visible shadow, Segoe UI, no focus rings, no easing curves, and two
competing blues. Every value was chosen locally. Nothing relates to anything
else. Replace all of it with one system.

## Deliverables

Artboards at 1440×900 (desktop) and 390×844 (mobile) for:

1. **Project home** — project cards, empty state, the "new project" affordance
2. **Documents** — upload, ingestion queue, per-file status
3. **Processing** — the live dock while pages are read (this runs for minutes; it
   must be legible at a glance from across a desk)
4. **Boards & Devices** — the dense one. Board list → device rows, with counts
5. **Review** — the queue of flagged items: unread pages, way conflicts,
   unclassified devices, low-confidence rows
6. **Reports** — the quotation preview before export
7. **Viewer** — source PDF beside extracted rows, with a highlighted region
8. Plus a **system sheet**: tokens, type scale, states, and every component
   in all its states

## Non-negotiable micro-detail

Get these right and designers will notice; get them wrong and nothing else
matters.

**Numerals.** This entire product is numbers — way 7, 32A, 30mA, 2.5mm². Every
figure in a table, badge, count or rating must use `font-variant-numeric:
tabular-nums`. Column alignment must not shift when 9 becomes 10. Ratings right-
align; identifiers left-align; never centre a number.

**Type.** One scale, 6–7 steps, on a single ratio. Nothing between steps, ever.
No half-pixels. Choose a face with real tabular figures and a distinguishable
1/l/I and 0/O — an estimator misreading `l` for `1` is a costed error. Inter,
IBM Plex Sans, or Söhne-like. Pair with a mono for source text and codes.

**Spacing.** One 4px base. 4/8/12/16/24/32/48/64. Every gap in the UI is one of
those. Density is a *choice per surface*: Boards & Devices runs tight (row height
32–36px), Review runs loose because each item demands a decision.

**Line weight.** Table rules are the hardest thing here and where most tools
fail. Use one hairline (1px at a single low-contrast token) for row separators,
and reserve a second, stronger rule *only* for structural boundaries — the header
row, a board grouping. Never a border on every cell. The eye should follow rows
without effort.

**Elevation.** Prefer borders to shadows for a tool this dense. If you use
shadows, define exactly three tiers and use them for *meaning* — raised = 
interactive, overlay = modal, sticky = pinned header. A 5%-opacity shadow on
everything is decoration, not hierarchy.

**Focus.** Every interactive element gets a visible `:focus-visible` ring, 2px,
offset 2px, in a colour that passes 3:1 against both the element and its
background. Keyboard users must be able to drive the entire Review queue. This is
currently absent and it is the single clearest signal of an unfinished interface.

**Motion.** Two durations (120ms for state, 220ms for entry) and one curve
(`cubic-bezier(.2,0,0,1)`). Nothing linear — linear motion is the cheapest-
feeling detail in any interface. Wrap all of it in `prefers-reduced-motion`.

**One primary.** Pick a single action colour and give the brand colour a
different, non-competing job (identity only — wordmark, empty states). Two blues
of similar value reads as an accident.

**Semantic colour with a job.** This app has real states that must be instantly
distinguishable *and* survive colour-blindness: needs review, conflict, unread,
spare way, unclassified device, confirmed. Never rely on hue alone — pair every
state with an icon or a weight change. Keep saturated colour rare enough that it
means something when it appears.

**Empty and failure states are primary screens, not afterthoughts.** This tool's
core promise is that it says plainly when a document could not be read. "16 of 19
pages could not be read" must look as considered as a successful take-off. Design
the honest-failure state properly.

**Data integrity cues.** Every extracted value carries a document, page, source
text and confidence. Show provenance without clutter — a value the estimator can
hover or click to see the source line it came from, page cited. This is the
product's actual differentiator; make it visible.

## Explicitly avoid

Gradient hero text. Glassmorphism. Purple-to-blue anything. Emoji as icons.
Rounded-2xl on everything. Cards with drop shadows floating on a grey page.
Decorative illustration. Any of the 2024-25 AI-app house style — this must look
like a professional instrument, not a landing page for one.

## Success test

A senior product designer should be able to open the Boards & Devices screen,
scan 40 rows, and tell you without hesitating: which board each row belongs to,
which values are uncertain, and what to do next. If they notice the design at
all, it should be the restraint.

---

*Generated from an audit of `index.html` at the current HEAD. Numbers in the
table above are reproducible with the greps in the session that produced this.*
