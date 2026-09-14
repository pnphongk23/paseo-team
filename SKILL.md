---
name: paseo-team
description: Use when a user needs a lean Paseo team with one user-facing router, one technical outcome owner, optional bounded delegation, and risk-based independent review.
---

# Paseo Team

Paseo Team is a coordination aid, not a ceremony. Keep one outcome owner and delegate separable work by default.

```text
User ↔ Code Vương (user I/O, lease and event routing)
          ↕
General Lead (technical and outcome owner)
          ├─ Planning Lead* / Domain Lead* (bounded lead slice)
          │    ├─ Worker* (bounded execution slice)
          │    └─ Reviewer* (risk-selected logical candidate)
          ├─ Worker* (single direct packet or coupled residual)
          └─ Reviewer* (mission-level/cross-slice lens)
```

The mission must designate one user-facing Code Vương and exactly one General Lead. Titles and personas do not create additional authority.

## Routing, role contract and Paseo prerequisite

Routing is defined once, in the `brief:role-routing` block of [briefing-contracts.md](references/briefing-contracts.md) and expanded once in the [Lead Delegation Gate](references/role-contracts.md): before creating any Worker or Reviewer the General Lead runs that gate, and no child creates a Lead.

The builder-generated brief is the canonical behavioral contract for the role it names and is self-contained for the routine path: a role acts on its brief without pre-reading this skill or [`references/role-contracts.md`](references/role-contracts.md). Read that reference only to select or launch a role, to cross or escalate a boundary, to run a Supervisor Compliance audit, or when a brief names a rule it does not define.

Code Vương and General Lead/Tướng quân have an additional hard prerequisite: before routing or creating/prompting any agent, they MUST read the `/paseo` skill (`paseo/SKILL.md`) in full, call `list_profiles`, and read the notes of every returned Paseo profile. They must materialize the selected profile's combined `provider/model`, mode, thinking, feature, workspace, parent, label, and notification values exactly; they must not guess or use stale profile data. If the skill, profile notes, Paseo tools, or workspace identity is unavailable, stop with the applicable blocked state and do not fall back to direct work.

Direct work stays valid for coupled or very small slices. Do not impose a fixed total child count; stop when no independent slice remains. Do not create a channel, watchdog, Planning Reviewer, or extra Reviewer unless the routing rules select it. A Reviewer is selected for the smallest stable logical candidate required by the risk rubric, not automatically once per Worker.

## Workflow

- **Route** — Code Vương creates the one General Lead with `node assets/brief/brief.mjs`. An unambiguous user request needs no second approval turn; only a C3 decision goes back to the user.
- **Own and delegate** — the General Lead scopes the outcome and applies the routing rule above. Delegated slices get their Leads first, each with explicit scope, non-goals, write-set, acceptance, checks and handback; the General Lead keeps at most one residual/coupled slice and converges Lead handbacks instead of supervising every Worker.
- **Review when selected** — [review-scoring.md](references/review-scoring.md) owns the review trigger, budget, cycle rules and the pre-plan branch threshold. The owning Lead freezes the candidate and re-freezes after every mutation.
- **Handoff** — the General Lead reports changes, evidence, checks, uncertainty and next action. Code Vương verifies lifecycle/evidence presence and routes events; it does not inspect diffs or make technical judgments.

## Roles and boundaries

| Role | Owns | Must not do |
|---|---|---|
| **Code Vương** (`me`) | User I/O, mission lease, sentinel registration when needed, event routing and administrative handoff checks | Source edits, technical plans, architecture, code review, technical audit, polling or blocking waits |
| **General Lead** (`lead`) | One outcome: decomposition, technical decisions, implementation, optional delegation and convergence | Change user intent/scope without C3 escalation; claim unverified work is done |
| **Planning Lead** (`lead`, `lead-kind=planning`) | One mission planning/architecture slice; bounded decomposition, contracts, dependencies and plan handback to General Lead | Create delivery ownership, create another Lead, change the overall outcome, or implement outside the planning slice |
| **Domain Lead** (`lead`, `lead-kind=domain`) | One bounded domain stream under General Lead; implementation coordination, Worker handbacks and risk-selected slice review | Create another Lead, change the overall outcome, or cross its parent boundary |
| **Specialist Lead** (`lead`) | One explicit bounded slice under the General Lead; may be a Planning Lead or Domain Lead | Create another Lead, change the overall outcome, or cross its parent boundary |
| **Worker** (`peer`) | Only the explicit packet and write-set from its parent Lead | Invent architecture/ownership, contact Code Vương, or delegate further |
| **Reviewer** (`lead` review profile) | An independent lens over the exact stable candidate and its evidence | Edit files, spawn agents, expand scope, review every Worker by default, or give formal approval |

Vietnamese titles and persona names are labels only; they do not create extra authority or roles.

## Decision and evidence boundary

- Lead/Worker use the [decision ladder](references/decision-authority.md) for reversible choices inside their scope; do not ask upward merely for reassurance.
- Any unverified claim is `Unresolved` or `Pending-validation`. A test pass, review claim, exit code or handoff is not proof by itself.
- A review is a risk control, not a mandatory pipeline step for every tiny change. Use [review-scoring.md](references/review-scoring.md) to select it.

## Optional coordination

- **Team Channel**: open only for live multi-round exchange between two or more roles. A single Lead/Worker flow uses direct prompts and handback. See [channel-operations.md](references/channel-operations.md).
- **Sentinel/watchdog**: use for long-running or multi-round work where a lost notification would matter. It is not a reason to poll a healthy lane.
- **Supervisor compliance audit**: use only after a concrete routing/polling/evidence incident or an explicit user request. See [supervisor-compliance.md](references/supervisor-compliance.md).

## Reference routing

Read only the reference needed by the current branch (`references/role-contracts.md` is gated as described above):

- [role-contracts.md](references/role-contracts.md) — mandatory role boundaries, Paseo prerequisites, and authority rules.
- [briefing-contracts.md](references/briefing-contracts.md) — build or update a role brief.
- [decision-authority.md](references/decision-authority.md) — classify an escalation or avoid over-asking.
- [review-scoring.md](references/review-scoring.md) — decide and run an independent review.
- [channel-operations.md](references/channel-operations.md) — open or operate a Team Channel.
- [supervisor-compliance.md](references/supervisor-compliance.md) — audit a concrete Supervisor/Code Vương incident.
- [failure-handling.md](references/failure-handling.md) — recover from a failure or non-convergence.

Prompt construction must use `node assets/brief/brief.mjs`; do not hand-copy role rules. The generated brief is self-contained for its selected role and phase, with the skill path and mandatory role contract as ambiguity-only fallbacks.

## Failure rule

Stop and follow [failure-handling.md](references/failure-handling.md) when a role crosses its boundary, a lease is stale, a required tool is unavailable, a candidate changes during review, or work cannot converge. Never conceal the failure or mark the task complete.
