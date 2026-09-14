# Review Scoring — Risk-Based Independent Review

Use this file only to decide whether a technical Reviewer is worth the coordination cost and how large that review should be. The Lead owns the scoring; Code Vương checks only that the administrative record exists.

## 1. Decide whether review is needed

An independent review is **required** when any of these is true:

- `I ≥ 3` (shared behavior, public contract, persistence, auth, payment, deploy or release);
- `U ≥ 3` (unresolved behavior/contract, weak acceptance or difficult rollback);
- `S ≥ 2` (three or more files/modules or a cross-module change);
- the user explicitly requests review, or the work is security/migration/release sensitive.

For a small isolated change with `S ≤ 1`, `I ≤ 2`, `U ≤ 1` and strong focused checks, Lead verification is sufficient; do not create a Reviewer ceremonially.

Planning branch: use the Pre-plan addendum only for genuinely open architecture/planning/contracts, or `I ≥ 4`, or `U ≥ 4`. Open planning gets exactly one Planning Lead (reuse an existing one; never duplicate the same planning scope), and that Lead owns the plan/reviewer loop instead of the General Lead running a duplicate one.

## 2. Score the task

Score the whole logical task, not each commit. Recalculate from the actual candidate diff before launch.

**Surface (S), 0–5**

- `0` one small file · `1` one or two files · `2` 3–5 files/module · `3` 6–10 files or cross-module · `4` 11–20 files/multi-package · `5` broad cross-cutting, generated/configured or >20 files.

**Impact (I), 0–5**

- `0` formatting/docs · `1` isolated local behavior · `2` bounded feature/module · `3` shared behavior/public contract · `4` persistence/auth/payment/deploy/release · `5` security, destructive migration, data loss or authorization boundary.

**Uncertainty (U), 0–5**

- `0` clear requirement, strong checks, easy revert · `1` minor unknowns · `2` partial coverage/coupling · `3` unresolved behavior/contract · `4` unclear acceptance or rollback · `5` unclear intent, no reliable check or irreversible action.

## 3. Set the review budget

Let `R = S + I + U`. Use the smallest budget that answers independent questions:

| R | Default reviewers | Lens |
|---|---:|---|
| `≤3` | 1 | correctness/evidence |
| `4–8` | 1 | correctness/evidence |
| `9–12` | 2 | correctness/evidence + architecture/risk |
| `13–15` | 3 | separate risk/security/specialist lenses |

Overrides: `I ≥ 4` requires at least 2; `I = 5` plus `U ≥ 4` or an irreversible action requires 3. If no reviewer has a distinct question, do not open another lane. A planning reviewer is part of the pre-plan branch, not an extra technical-review lens.

## 4. Review procedure

When review is selected:

1. Lead freezes the candidate surface and records one immutable identity (commit, diff hash or worktree snapshot).
2. Launch fresh reviewers with explicit `owns`, `excludes` and `evidence`. Reviewers are read-only and receive only the task contract, frozen candidate, raw diff/artifacts and checks—not the implementer's verdict or proposed fix.
3. Reviewers report `CLEAR`, `CHANGES_REQUIRED` or `BLOCKED`, with findings ordered `BLOCKER → REQUIRED → NIT → FUTURE`.
4. Lead resolves `BLOCKER`/`REQUIRED`. Any mutation invalidates the identity and requires a fresh review of the changed surface; reviewers never edit files.
5. Allow at most two review cycles. Repeated blockers or scope growth is `BLOCKED_NON_CONVERGING`; use the decision ladder for the next reversible choice.

Commit discipline is a delivery detail owned here: one logical task has one final consolidated commit after review, when the repository workflow requires commits. Do not rewrite a candidate while its review is open.

## 5. Handoff record

Lead reports `S`, `I`, `U`, `R`, review decision/trigger, candidate identity, reviewer IDs/workspaces/lenses/verdicts, findings and checks. Code Vương verifies only lifecycle, identity/evidence presence and agent state; it does not recalculate technical impact or accept a bare test-pass/review claim.

Anti-duplicate proof: Reviewer reads the owner's evidence and reruns a check only when a concrete doubt remains. Do not repeat validation as ceremony.
