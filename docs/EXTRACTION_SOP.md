# Extraction SOP — the standard operating procedure for the agent team

This is the operating procedure for extracting devices from UK electrical documents.
It is the single source of truth: the prompts in `api/_lib/extraction/` and the
deterministic checks in `extractor-core.js` both implement it, and every rule here
exists because a real document broke without it.

**Read this before changing extraction.** Each rule names the failure it prevents.
A rule without a failure behind it is a guess, and guesses are what this file replaces.

## 0. What "no mistakes" actually means

Perfect extraction is not achievable by instruction alone. Every failure this project
has hit was one of three kinds, and only one of them is a prompt problem:

| Kind | Example from this project | Fixed by |
|---|---|---|
| The model read the page wrongly | a three-phase way returned as one device | prompt (§2) |
| The **input** was wrong before the model saw it | rotated sheet flattened into scrambled lines | code (§1) |
| The **output** was discarded after the model returned it | board header read correctly, then ignored | code (§3, §4) |

Most of the damage came from the second and third. So the procedure is:
**code establishes structure, the model reads content, code checks the result, and
anything unresolved goes to Review rather than being guessed.**

An extraction that admits a gap is correct. An extraction that silently fills one is not.

## 1. Read the page before asking anyone to interpret it

Structure is a fact to measure, never something to assume.

1. **Detect rotation from the text itself.** Every run carries its own transform.
   Group runs along the dominant text direction, not along the page's y axis.
   *Failure:* a real schedule set is rotated 270° on every run. Grouping by y merged
   different table rows, so a header arrived as one line of labels and another of
   values tens of lines apart, and no page could declare a board. Four consecutive
   fixes above this layer changed nothing because of it.

2. **Measure the line band; do not assume a page size.** On a table the gaps between
   text bands are bimodal — small within a row, large between rows. Place the
   boundary between the clusters. Where gaps are uniform (prose), infer nothing.
   *Failure:* a fixed 5-unit band is tuned for A4. On a large-format sheet one row's
   cells sit ~25 units apart against ~636 between rows, so every *cell* became its
   own line and no row could be parsed. Reading the geometry took the deterministic
   pass from 41 device rows to 161 on the same document.

3. **Never trust a single font encoding.** Subset fonts differ per document and per
   page. Use the library's ToUnicode decoding; never hand-roll a character offset.
   *Failure:* a harness assuming one offset produced fluent-looking nonsense from a
   second document and reported zero boards, which looked like a tool failure.

## 2. Board identity comes from the page, not from its rows

A board is declared once. Rows belong to it; they never define it.

4. **The header block is the authority.** Resolve the board before registering
   anything else on the page.
   *Failure:* row text was registered first, so a board's ways and phases each minted
   their own board — 344 boards against 187 devices, which is impossible on its face.

5. **A way number is not part of a board's name.** `154-DB-7-GCS-11` is way 154 of
   `DB-7-GCS-11`. Strip it; keep it as the way.

6. **A phase suffix is not part of a board's name.** `…-L1`, `…-L2`, `…-L3` are phases
   of one board, per BS 7671's separate circuit-number and phase-designation fields.
   Keeping them triples the board count.

7. **A trailing way number is not a board either.** `DB-1-GF-5` is way 5 of `DB-1-GF`.
   Only a board an actual page header declared may absorb others, and the tail must be
   purely a way number — `DB-1-GF-MECH` is a different board.
   *Failure:* the model returns one `board_ref` per row, so an 18-way board arrived as
   `DB-1-GF-1 … DB-1-GF-18` and registered as eighteen boards.

8. **A current rating is not a board.** `630A` became board `DB630A`.

9. **A board may be named by description.** `REFERENCE  110V AC DISTRIBUTION BOARD` is
   a real board with fourteen circuits. Accept the REFERENCE cell's value when nothing
   code-shaped resolves; codes win where both are present.
   *Failure:* unresolved, its devices sat unattributed — a bucket of homeless rows.

10. **An index or cover page declares nothing.** It lists `DB-1 … DB-7` in truncated
    form. A stub with no rows that uniquely prefixes one fuller reference folds into it;
    ambiguity is refused.

11. **A page that declares its own board is never a continuation.** Only a page with no
    header of its own inherits the previous board.
    *Failure:* every page of a rotated set failed to declare a board, so one board
    absorbed the whole document — 83 devices against an 18-way capacity of 54, while
    every board after it held none.

12. **A board whose name cannot be resolved keeps its devices to itself.**
    Unattributed is the correct outcome. Never donate rows to the neighbouring board:
    a visible gap is fixable, silently wrong attribution looks finished.

## 3. Rules for the extraction sub-agents

These are the instructions carried in every sub-agent request (`boardContract`).

13. **Return the board exactly as the header writes it**, once, for every row on the page.
14. **Never build a board reference out of a row.**
15. **Way and phase are separate fields** — `way: "5"`, `phase: "L2"`.
16. **A three-phase way is three devices**, one per phase. Collapsing it loses two in three.
17. **Every declared way gets a row, spares included.** An omission is indistinguishable
    from a miss, and completeness is what is being audited.
18. **Copy values as printed.** Leave a field null rather than infer it. Do not normalise
    or round.
19. **Device class follows protection, not the label.** A device with residual current
    protection is an RCBO whatever the drawing calls it (RCD + MCB combined, IEC 60617).
    An AFDD+RCBO is neither an AFDD nor an RCBO alone.
20. **Keep control equipment distinct** from protective-device totals — contactors, time
    clocks, photocells, relays, starters, meters belong to the same board but not to the
    same count.

## 4. Known dialects

Row format varies per vendor. Key on the **header block**, which is stable, and never on
row shape alone — keying on row shape is what made whole documents classify as `unknown`
and disabled every downstream rule.

| Dialect | Circuit ref | Notes |
|---|---|---|
| Way + phase | `11-L3` | Most common. Rating, device text, RCD, cable, CPC, type, name |
| Way / phase slash | `11/L3` | Syntegral. Curve and AFDD columns |
| Device-prefixed | `MCB/21` | 110V AC boards. Class stated in the ref; RCD column still promotes to RCBO |
| P-coded | `P1`–`P5`, `T1`–`T6` | BAM/EPO. Legend on the page defines the codes |
| Amtech charts | per-way In/Ir/Type | ~one board per page over 30+ pages |
| MCCB switchboard | Ref/Location/Size index | The **summary index is the expected board set** — reconcile against it |
| Consumer units | `Consumer Unit (…)` | Multiple variants per document; capturing only the first is a failure |
| LV schematic | feeder lines | Must yield the ACB, the F-referenced outgoing devices and feeder pillars |

**Spare blocks.** A board may list its live circuits then one merged row covering the
rest: `12-L1,L2,L3 - 18-L1,L2,L3 … SPARE`. Read it, in either form (inline, or endpoints
on the rows either side of the merged cell). *Failure:* unread, completeness reported
seven ways missing on a board the drawing fully describes — and a check that cries wolf
stops being read. **Guard:** an adjacent row carrying device data is a LIVE circuit, not
a spare boundary. Misreading it deletes a device silently.

**Multi-page boards.** One board's schedule may span pages — 18 ways over three pages is
one board of 54 phase-slots, not three fragments. Accumulate before judging completeness.

## 5. Checks code must perform, and the model must not

Deterministic, always, because arithmetic is not a matter of opinion.

21. **Capacity.** A board cannot hold more protective devices than ways × phases. An
    18-way three-phase board tops out at 54. *This is what caught the 83.*
22. **Completeness.** Declared ways versus captured ways, accumulated across every page
    the board occupies. Report the shortfall with the way numbers.
23. **"Not checkable" is not "complete."** A board that never declares a way count must
    say so. Silence is not proof, and a take-off implying verification it never performed
    is worse than one admitting the gap.
24. **The audit's own status is a fact to report.** How many pages the master reviewed,
    and how many findings it raised. An audit that was skipped must never look like one
    that passed.
25. **Which agent and which key did the work** belongs on screen. *Failure:* four of
    seven configured keys were unread by the code for weeks, and nothing said so.

## 6. The master's role

The master audits; it does not re-extract and it never edits a count.

26. It is **handed the computed way gaps**, never asked to count. Its job is to say
    whether each unaccounted way is genuinely blank or spare, against the source.
27. Its findings become **Review rows**, attributed to the page's board. Over-capture
    into Review beats a silent omission.
28. A finding is dropped when the extraction agents already filled that board+way slot,
    so an audit cannot duplicate work that was not missed.
29. **The master's findings must reach the user.** *Failure:* they were computed,
    returned by the server, and discarded by the client. The oversight layer the whole
    hierarchy exists for reached nobody, silently, while costing real API spend.

## 7. Escalation

- Conflict between documents → Review, never a silent choice.
- A model returns nothing for a page that carries an image → `image_no_extraction`,
  never `complete`.
- Provider errors that never reached an HTTP response (`timeout`, `network`) are
  transient and retried; a chain exhausted on malformed replies is not.
- Anything a rule here cannot decide → Review, with the source text attached.

## 8. Verifying a change to extraction

The discipline that was missing, and cost four rounds of "fixed" that changed nothing:

1. **Test against the shape the app really produces**, not a reconstruction. pdf.js emits
   one line per cell; text joined into tidy rows is a fiction the product never sees.
2. **Exercise the shipped path.** `tools/coverage/app-pipeline.cjs` mirrors the app; if a
   fix is verified only against the mirror, verify the mirror still matches the app.
3. **Put the exit gate last.** A gate mid-file let appended checks fail while the suite
   reported green — a test that cannot fail is worse than no test, because it is read as
   evidence.
4. **Measure counts against a real document** before and after. "Looks better" is not a
   result; `boards 344 → 8` and `devices 41 → 161` are.
5. **One rule, one place.** The same logic living in `extractor-core.js`, `index.html` and
   the coverage mirror is why a fix could look applied and do nothing. When you must
   duplicate, patch every copy in the same commit.

## Sources

Domain conventions cross-checked against BS 7671 (Reg 514.9.1 — the schedule requirement,
circuit number *and* phase designation, ways and phases declared per board) and IEC 60617
device symbols:

- [NAPIT — Circuit identification details](https://professional-electrician.com/technical/circuit-identification-details-why-information-is-key-napit/)
- [IET — BS 7671:2018 model forms](https://electrical.theiet.org/media/2218/bs_7671_2018-model_forms-all.pdf)
- [Distribution board symbols — MCB, RCD, RCBO, SPD (BS EN 60617)](https://www.elec-mate.com/guides/electrical-distribution-symbols)

Fixture expectations live in `tools/coverage/ground-truth.json`; the documents themselves
stay out of the repository.
