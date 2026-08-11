# Codex kickoff prompt  ·  v2

Paste this as the first message of the session, with `electrical-doc-reading/`
present in the repo. Everything below the line is the prompt.

Changed in v2: incorporates the August 2026 defect review — traps T-28 to T-35,
the review-workflow and report requirements in `10`, and a re-sequenced plan
that puts coherence gates before dialect work.

---

You are working on the extraction engine of an electrical estimating tool. It
ingests UK electrical design documents — distribution board schedules, LV
schematics, MCCB schedules, consumer unit charts, board specification forms —
and produces a device take-off that becomes a priced quote. The user is a
practising electrical estimator; wrong quantities cost real money, and a
confidently wrong number is worse than a flagged gap.

A version of this tool is already deployed and is producing wrong output. The
reference material tells you exactly how, with evidence.

## Read this first, in this order

`electrical-doc-reading/` is engineering reference material derived from a
149-file, 3,308-page corpus of the user's real working documents, plus two
rounds of defect review against the deployed tool. Read it before writing code:

1. `README.md` — orientation and the non-negotiables
2. `00-core-reading-model.md` — the five-phase pipeline. This is the spine.
3. `05-trap-catalogue.md` — 35 failure modes, each with corpus evidence
4. `09-visual-examples.md` — nine annotated figures; open the images
5. `06-output-contract.md` — the normalised data model
6. `08-acceptance-tests.md` — what "working" means
7. `10-review-and-reports.md` — review workflow and report layout

Then use as lookup: `01-field-lexicon.md`, `02-device-rules.md`,
`03-dialect-profiles.md`, `04-schematics.md`, `07-quote-rules.md`, and
`corpus-inventory.csv` for what is actually in the corpus.

## Non-negotiables

Each corresponds to a defect that has already reached production:

1. **Never derive a field from a regex over a flattened row.** Recover column
   geometry, bind every word to a column band by x-overlap, then interpret.
   Phases 1–3 complete before phase 4 begins.
2. **Never default a device class.** Derive it, and record how, as
   `class_basis`. `class_basis == UNRESOLVED` blocks pricing.
3. **Never default a document type.** A document that doesn't classify is
   `unknown`, flagged, and excluded — not assumed to be a schedule. (T-32)
4. **Never resolve a legend code from a global table.** Legends are
   per-document; five of eight cable-type letters mean different cables in
   different documents in this corpus. (T-09)
5. **Never silently price a placeholder.** `TBC`, `??`, `GUESS`, `TBA`, `-` in a
   numeric column → `null` plus a flag.
6. **Never emit `Unclear` or `Not specified` into a report.** Unresolved is a
   flagged line with a source crop, never a word in a description. (T-35)
7. **Never treat a merged or spanned cell as absent data.** Inherit it.
8. **Every emitted value carries provenance** — file, page, bounding box.
9. **Handle page rotation before banding.** (T-27)
10. **One list.** The viewer overlay and the approval panel are two views of the
    same records, keyed on the same id. They must not be able to disagree. (`10`)

When geometry is genuinely ambiguous, the correct output is a flag, not a guess.

## Four things the deployed tool gets wrong that are easy to miss

Read the full catalogue, but these are the ones most likely to be reintroduced:

- **Note labels.** A header note `(#5) Circuit wired via contactors to mushroom
  push button emergency stop…` governs every row tagged `(#5)` in its
  description. Those contactors and EPOs exist nowhere else on the sheet. The
  note block can be anywhere on the page. (T-28)
- **Phase cells that span.** A single row reading `L1-L3` in the Phase column is
  a three-phase circuit, not a single-phase one. Parse the phase cell as a set.
  (T-29)
- **Way identifiers that aren't numbers.** Split boards number ways `L7, L8, P1,
  P2` — and `L1` in the Way column is not `L1` in the Phase column. (T-31)
- **Out-of-scope assemblies.** MSDB panels, and any board with 4+ fuse outgoing
  ways, are excluded from the take-off entirely. (T-34)

## How to work

- **Flag, don't guess.** Every uncertainty becomes a typed flag from the
  vocabulary in `06`, surfaced with its source crop.
- **Don't special-case documents.** If a file won't parse, the fix is a better
  rule or a new dialect adapter over the shared geometry pipeline — never an
  `if filename ==` branch. If you can't generalise, add a fixture, flag the
  document, and say so.
- **Don't edit the reference docs.** Append contradictions and new findings to
  `electrical-doc-reading/FINDINGS.md` with file and page as evidence.
- **Ask when the domain is unclear.** The user knows this material far better
  than either of us. A question is cheap; a wrong assumption baked into the
  parser is not.
- **Report what you couldn't do.** End each session with what's failing, what's
  flagged, and what you had to assume.

## On "loop until it's right"

The brief asks for an extraction process that keeps working until everything is
correct with no errors. Build the achievable half of that and be explicit about
the other half:

**Build:** coherence gates that detect impossibility and refuse to emit;
bounded, logged retry with a *different* strategy when a gate fails
(ruling-lines → whitespace projection → OCR); cross-document reconciliation as
an independent check; escalation of anything unresolved to a flagged line.

**Do not build, and do not claim:** a loop that certifies its own correctness.
If the grid is wrong, every check computed from that grid is wrong too, and a
self-assessing loop reports success. Loop to detect incoherence, never to
certify correctness. See the last section of `10-review-and-reports.md`.

## First task

Do not start with the UI, the reports, aggregation, or pricing.

1. **Write the Tier 1 regression tests from `08-acceptance-tests.md` (T-01
   through T-04) and confirm they FAIL against the current extractor.** These
   reproduce defects the user found in production. If they pass on day one, the
   harness is wired to the wrong code path — stop and fix that before anything
   else.
2. **Add coherence gates as failing tests too:** `devices ≥ boards`, ways
   populated + spare ≤ ways total, every board has a feed edge or an `orphaned`
   flag. The reported case — 29 boards, 18 devices — must fail the build. (T-33)
3. Build the geometry pipeline from `00` — acquire, rule, bind — as a layer with
   no domain knowledge in it. Phase 3's output is a plain cell grid.
4. Make T-01 and T-02 pass.
5. Implement the flagging and provenance contract from `06`, then invariants
   INV-1, INV-2, INV-3.
6. Document classification (T-32) with a recorded confidence margin.
7. Then dialect adapters, in corpus-frequency order: BES and Trimble (10 files
   each), then ElectricalOM, Quinnross, OCSC, BAM composite.

**Stop and report after step 2**, before building anything, so we can confirm
the tests are pointed at the right code and the gates fail on the right cases.

## Workstream boundary

The review page, viewer, colour coding, approve-all, and report layouts in `10`
are a **separate workstream**. Do not interleave them with the extraction work.
Fixing the reports will not fix the take-off, and a well-laid-out report of
wrong numbers is worse than an ugly one, because it looks finished.

The one exception, because it is a data-model bug rather than a UI change: the
viewer overlay and approval list must be unified onto one record set. Do that in
the extraction workstream, as part of the output contract.

## One thing worth knowing up front

The blank-plate rule in `07-quote-rules.md` (`modules_available − modules_used`)
reconciles exactly against all six boards in the user's issued quote. Implement
it as a hard assertion that fails loudly, not a best-effort estimate. It is one
of the few places in this domain with a provably correct answer, and it is worth
protecting.
