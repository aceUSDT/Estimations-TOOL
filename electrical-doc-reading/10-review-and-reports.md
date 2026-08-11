# 10 — Review Workflow and Reports

Everything downstream of extraction: how the operator checks the work, and what
comes out at the end. Sourced from the August 2026 defect review of the deployed
tool.

Keep this separate from the extraction workstream. Fixing the reports will not
fix the take-off, and a well-laid-out report of wrong numbers is worse than an
ugly one, because it looks finished.

---

## The review page

### One list, not two

The single largest source of confusion in the current build: the rows rendered
over the document and the approval list in the side panel are **separate data
sets**. The same circuit appears in both, disagrees between them, and the counts
don't reconcile. Clicking a line in the viewer shows the correct device; the
same line in the approval list shows something else.

**There is one list.** The viewer overlay and the approval panel are two views
of the same records, keyed on the same id. If they can disagree, they will, and
the operator has no way to know which one is lying.

This also explains the reported symptom that some lines have a highlight box and
others are only clickable — two renderers over two sources.

### Line identity

Every reviewable line states **which way it refers to**, in the form the source
document uses: `DB-G9 · Way 3 · L1-L3`. Not a row index, not an internal id.
The operator is reconciling against a printed schedule; the identifier has to
match what they are looking at.

### Colour

Two separate colour dimensions, currently conflated into one confusing scheme:

| Dimension | Encodes | Applies |
|---|---|---|
| **State** | needs approval · approved · corrected | before and during review |
| **Device type** | MCB · RCBO · RCCB · MCCB · AFDD · SPD · isolator · spare | after approval |

State must be unmistakable at a glance — an operator scanning a board should see
instantly what is left to do. Only once a line is approved does it take its
device-type colour. Never encode both in the same channel.

### Approve all

Per board, one action approves every remaining line on that board. This is the
single highest-value interaction in the page: most boards are correct, and
forcing a click per line makes the reviewer stop reading.

Keep a per-line undo, and record who approved what and when — approval is the
audit trail that makes the quote defensible.

### Never label a stated device as a spare

A clearly marked RCBO was reported as a spare way. A row with a device class,
rating and description in it is not a spare, whatever else failed. Spare status
is asserted only when the device columns are genuinely empty or the description
says `SPARE`, and a conflict between the two is a flag, not a decision.

---

## The viewer

The reference point is Adobe Reader. Specifically:

- **True full screen.** The document uses the entire monitor. Currently it is
  boxed inside the app chrome.
- **Collapsible side panel**, with free-resize — not two fixed widths.
- **Collapsible page-preview rail** (top-left thumbnails), same behaviour.
- Continuous scroll, page fit / width fit, zoom to a selection, and keyboard
  paging.

The operator will spend more time on this page than any other in the product.
It is worth building against the Adobe interaction model rather than inventing
one.

---

## Reports

**Board Take-Off and Device Take-Off only.** Everything else currently emitted
(Device Detail, Review Required, Assumptions and Qualifications, Extraction
Audit) belongs in the app, not the deliverable. Keep the audit data — surface it
in the review page, not in the report the estimator sends out.

### Device Take-Off — transpose it

Current layout: devices down the rows, boards across the columns, one row per
occurrence, so the same device appears on six lines.

Required layout:

- **Device specification as the column headers** — one column per distinct
  device, with rating, poles, curve, breaking capacity, RCD, AFDD in the header
- **Boards down the rows**
- **Quantities in the cells**
- **One column per distinct device.** Group on the full spec key from
  `07-quote-rules.md`: `(class, rating, curve, poles, neutral, rcd_ma, rcd_type,
  breaking_ka, afdd)`. Identical devices never occupy two columns.

This is a procurement view: the estimator reads down a column to get the total
count of one product, and across a row to get everything one board needs.

### Board Take-Off — reorder

The specification columns are the ones that get read. They come first, in this
order:

```
Circuit Description · Quantity · Current Rating (A) · Pole Configuration ·
Tripping Curve · Trip Unit · Breaking Capacity · RCD Protection ·
AFDD Protection · Circuit / Way
```

Then supporting columns — Protection Standard, Source Pages, Review Status.

Grouped by board, with a per-board device count, then by device class within the
board.

### No prose placeholders in either report

`Not specified`, `Unclear`, `10A Unclear MCB` must not appear. Pole
configuration and description are resolvable from the schedule for effectively
every device in this corpus — if they arrive unresolved, the binding failed
upstream (see T-35, T-29). Anything genuinely unresolvable is a flagged line
with a source crop in the review page, and it does not reach the report as text.

---

## What "keep working until it's right" can and cannot mean

The brief asks for an extraction process that loops, finds its own faults, and
keeps working until everything is correct with no errors.

**What is achievable, and should be built:**

- **Coherence gates** that detect impossibility and refuse to emit — 29 boards
  with 18 devices is provably wrong without knowing the right answer (T-33).
- **Retry with a different strategy.** If ruling-line banding yields a grid that
  fails its gates, retry with whitespace projection; if the text layer yields
  too few rows, retry via OCR. Bounded, ordered, logged.
- **Cross-document reconciliation** as an independent check — the schematic and
  the schedule are two views of the same system, and disagreement is signal
  (T-30).
- **Escalation.** What cannot be resolved becomes a flagged line in the review
  page with its source crop.

**What is not achievable, and must not be promised:**

A loop cannot verify its own correctness against a document it misread. If the
grid is wrong, every check computed from that grid is also wrong, and a
self-assessing loop will report success. That is a worse failure than an obvious
one, because it removes the operator's reason to look.

So: loop to detect *incoherence*, not to certify *correctness*. The tool's job
is to be right where it can be, and unmistakably loud where it cannot. The
estimator's judgement is the last check, and the product should be built to make
that check fast rather than to make it unnecessary.
