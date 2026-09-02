# Design plan — how the improvement actually happens

`DESIGN_BRIEF.md` states the target. This states the route, the order, and how
each step is verified. Written to be executed in slices, because of one
constraint that governs everything below.

## The constraint

`index.html` is **335 KB of working application**. The CSS is entangled with a
pipeline whose behaviour was measured document by document over this project's
history, and this session alone found six checks that passed for the wrong
reason. A wholesale restyle would silently break extraction nobody would notice
until a quote went out wrong.

So: **no phase rewrites screens.** Every phase is mechanical, reversible, and
verified by `npm test` plus the ratchet. Design quality arrives by subtraction —
removing one-off values — not by adding a new stylesheet on top.

---

## Phase 0 — Stop the decay · **DONE**

`tools/coverage/test-design-tokens.mjs`, in the suite.

Budgets are set at **today's measured counts**, not at aspirations, because a
check that is red on day one is a check people learn to ignore — the exact
mistake §2.5 of `PROJECT_HISTORY.md` records, where ten false alarms trained the
estimator to skip the eleventh, which was real.

| | now | budget | target |
|---|---|---|---|
| font sizes | 20 | 20 | 8 |
| border radii | 11 | 11 | 4 |
| padding steps | 22 | 22 | 8 |
| half-pixel sizes | 6 | 6 | 0 |
| bare transitions (no curve) | 3 | 3 | 0 |

Budgets may only go **down**. Verified: adding one careless
`font-size:15.5px;border-radius:13px;padding:17px;transition:.3s` trips five.

## Phase 1 — Foundation: one scale for each dimension

Define the tokens in `:root` first, change nothing else, ship. Then replace
values in waves, lowering a budget with each wave.

- **Type** — 7 steps, one ratio, tabular figures. Replace the 20 with them,
  starting by rounding away the 6 half-pixels (mechanical, no design judgement).
- **Space** — a 4px base. 22 values → 8.
- **Radius** — 4 values. 11 → 4.
- **Elevation** — 3 tiers with meaning (raised / overlay / sticky), or borders
  only. The single 5%-opacity shadow currently used everywhere is decoration.
- **Motion** — 2 durations, 1 curve, wrapped in `prefers-reduced-motion`.
- **Colour roles** — resolve the two competing primaries. `--brand` (#009ee2)
  becomes identity-only; `--blue` (#1668e3) becomes the single action colour.
  Add the semantic layer the app actually needs: surface, surface-raised,
  border, border-strong, and one token per review state.

*Verify:* ratchet budgets drop; `npm test` green; the app renders unchanged
except where a value moved to the nearest scale step.

## Phase 2 — The free wins

Low risk, disproportionate effect on perceived quality. None of these can break a
layout.

1. **Focus rings.** Currently **zero** `:focus-visible` rules. This is both an
   accessibility failure and the clearest signal of an unfinished interface. One
   rule, applied globally, then refined.
2. **Easing curves.** Three transitions have no curve at all. Linear motion is
   the cheapest-feeling detail in any interface; a curve is a one-line fix.
3. **Tabular numerals.** `font-variant-numeric: tabular-nums` on every table,
   badge and count. This product is way numbers and ratings — a column that
   shifts when 9 becomes 10 destroys the scan. Highest ratio of perceived
   craft to effort in the whole plan.
4. **`prefers-reduced-motion`.** Currently absent.

## Phase 3 — The dense surfaces

**Boards & Devices** and **Review** are where the product is judged.

- Row rules: one hairline for separators, a second stronger rule *only* for
  structural boundaries. Never a border on every cell.
- Alignment: ratings right, identifiers left, never centre a number.
- Density per surface — Boards runs tight (32–36px rows); Review runs loose,
  because each item demands a decision.
- Provenance made visible: every value carries document, page, source text and
  confidence. Surfacing that on hover is the product's actual differentiator and
  it is currently invisible.

## Phase 4 — The honest-failure surfaces

This tool's promise is that it says plainly when it could not read something.
*"16 of 19 pages could not be read"* must look as considered as a successful
take-off — it is the screen that earns trust, and it is currently an afterthought.

Covers: the processing dock (runs for minutes; must be legible across a desk),
empty states, unread pages, way conflicts, unclassified devices.

## Phase 5 — The artefacts that leave the building

**Most redesigns stop at the app. This one must not.**

- **The exported workbook is the artefact a supplier sees**, and it carries the
  business's reputation further than the UI ever will. It needs the same type
  scale, alignment and restraint: tabular figures, a real header hierarchy, one
  accent, and the "n of m ways not accounted for" notes reading as considered
  qualifications rather than warnings bolted on.
- **The store/landing page** — first impression, and currently the weakest link
  for a paid product.
- **The desktop install** — icon, installer chrome, first-run empty state.

## Phase 6 — Perceived performance

Speed is a design property. A 32-page document takes minutes to read; the dock
should make progress legible and specific ("page 7 of 19 · DB-K"), never a
spinner. Skeletons over spinners; never block the whole screen for a per-page
operation.

---

## What not to do

- Do not add a CSS framework or a second stylesheet over the top. Two systems is
  worse than one bad one.
- Do not restyle a screen before the tokens exist — the values will be re-chosen
  locally and the count goes back up.
- Do not raise a budget. If a change needs a new value, it needs a token.
- Do not touch the extraction code while doing design work. Separate commits,
  separate verification.

## Order of value, if only some of this gets done

1. Phase 2 — a day's work, and it removes most of the "unfinished" signal.
2. Phase 1 type + space — the root cause of "vibe coded".
3. Phase 5 workbook — the artefact that reaches the customer's customer.

Everything else is refinement on top of those three.
