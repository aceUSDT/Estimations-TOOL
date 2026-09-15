# Production recovery from 45b3f61

[CONFIRMED BY USER] The owner identified production commit `45b3f61` as the continuation point and authorised local fixes. Deployment, external account/dashboard changes, customer-document uploads, migrations and deletion remain outside this work.

## Baseline and preserved work

[VERIFIED IN CURRENT PROJECT] The production HTML, extractor core, report core, review core and schematic topology core returned HTTP 200 from Vercel and exactly matched their Git blobs at `45b3f610bf436bb87cf44e987ab34f731840d137`. GitHub reports successful Vercel deployment checks for that commit. These checks identify the sampled public assets, not private provider configuration or an independently exposed deployment SHA.

[VERIFIED IN CURRENT PROJECT] GitHub main is five commits ahead of `45b3f61`, but the resulting file tree is identical. Those intervening commits added and removed unrelated BTC/ClickHouse material. The continuation baseline remains the owner-specified Estimation Tool tree; the historical report is not rewritten.

[VERIFIED IN CURRENT PROJECT] Work is isolated on `fix/production-review-safety` in `production-recovery-20260915`. The original repo, its untracked artifacts/output/tmp material, fable-review and the earlier capability-review recovery commits are preserved. Existing installed dependencies are reused through a new checkout-owned junction. No application count, reconciliation algorithm, document storage format or extraction source fixture is changed.

## Work packages and acceptance criteria

| ID | Problem and resulting behaviour | Acceptance |
|---|---|---|
| PROD-002 | Editing any field previously suppressed unresolved electrical flags. Approval, analysis health, diagnostics and export now retain those flags, including for AI-assisted/manual rows and saved rows whose cached health says complete. | No-change and description-only saves cannot approve unresolved flags; an actual correction to the flagged field can proceed; excluded/rejected rows retain their exclusion semantics. |
| PROD-003 | Row approval previously converted incomplete extraction and cross-document/geometry conflicts into export advice. Normal export now blocks those health reasons. | All 16 previously advisory failure conditions block issue; a board-capacity qualification cannot waive them. Standalone missing-feed advice and matching accepted-as-printed capacity decisions retain their existing behaviour. |
| PROD-004 | Corrections could introduce invalid numeric values without setting parser flags; zero-area or malformed source boxes could satisfy the calibrated-geometry guard. Values are now checked before mutation and again during approval/health/export. Source boxes require four finite numeric coordinates, nonnegative position and positive dimensions. | Invalid numeric edits leave the row and evidence unchanged. Restored invalid values remain blocked. Malformed/zero-area geometry cannot clear a page geometry blocker; a valid calibrated source box remains usable. |

The existing supported electrical domains are retained: sensitivity 10/30/100/300/500 mA and breaking capacity 3–150 kA, matching spatial-schedule-core.js. A present current rating must be finite and greater than zero. Missing optional fields are not replaced with invented values. Unresolved source flags remain blocking even when their normalised numeric value falls inside the domain.

## Exact files

- index.html: approval predicates, diagnostic counts, pre-mutation numeric validation, correction-flag clearing and source-box validation.
- extractor-core.js: shared value validation, conflict-aware health and current-evidence export blockers.
- tools/coverage/test-analysis-health.mjs: edited-row, stale-health, value, geometry and export-reason regressions.
- tools/coverage/verify-viewer-linked-review.mjs: actual no-change/description-only saves, relevant-field corrections and invalid input rejection.
- tools/coverage/verify-report-workflow.mjs: actual blocked export buttons and successful qualified CSV/XLSX after the synthetic missing-page blocker is resolved.
- This corrections register.

## Corrections register

| ID | Label | Observation and treatment |
|---|---|---|
| PROD-CORR-001 | [VERIFIED IN CURRENT PROJECT] | The initial HTTPS reader failed certificate-chain verification. Using Node's system CA store succeeded without disabling certificate validation. Initial local-byte hash mismatches were Windows CRLF; all five deployed assets matched the committed Git bytes exactly. |
| PROD-CORR-002 | [VERIFIED IN CURRENT PROJECT] | The original 29-command gate passed. New regressions produced 14 failures against unchanged product code, including complete health and allowed export for unresolved edited rows. The old pass was incomplete acceptance evidence. |
| PROD-CORR-003 | [CONTRADICTORY] | Existing unit/browser tests allowed SCHEDULE_PAGE_UNPARSED after row approval. This conflicts with the owner's current incomplete-extraction rule. The current tests now require a blocker; historical test/report claims remain unchanged. |
| PROD-CORR-004 | [VERIFIED IN CURRENT PROJECT] | The first new browser fixture inherited a single-pole source from a different row, so reconciliation corrected its synthetic TP value before the explicit correction assertion. The fixture now supplies matching printed TP evidence. The failed log is retained; the subsequent browser run passed. |
| PROD-CORR-005 | [VERIFIED IN CURRENT PROJECT] | Direct reproductions accepted zero/negative current, unsupported sensitivity/capacity and malformed boxes. PROD-004 adds value/box checks without relaxing the parser's existing domains or changing extraction counts. |
| PROD-CORR-006 | [HISTORICAL] | The completed handover and producer-run tests remain historical. New local evidence does not recreate missing original logs or certify a customer corpus. |
| PROD-CORR-007 | [UNVERIFIED] | Production remains at the sampled baseline until an authorised release. Fresh installation, representative private-document acceptance, native installers and provider/dashboard configuration are not certified by this work. |

## Evidence and rollback

Evidence is local under `outputs/GPT6-production-recovery-2026-09-15-baseline/` and `outputs/GPT6-production-recovery-2026-09-15-PROD-002/`. The second directory retains its first package name and contains the evidence for PROD-002 through PROD-004. Raw failing and passing logs are preserved. Final manifests identify the exact tested state; only completed passing runs count as acceptance evidence.

Rollback point: `45b3f610bf436bb87cf44e987ab34f731840d137`. Revert only the production-review-safety change commit(s); do not delete evidence, move the original repo or reset the independent capability-review work.

[INFERRED] Follow-on work should validate these safeguards against owner-approved representative local documents and separately reconcile the earlier capability-review branch with the production continuation. Neither branch should be treated as already integrated or deployed.
