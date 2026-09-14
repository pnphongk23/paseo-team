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

Before creating Workers, the General Lead MUST run the Lead Delegation Gate. Use the direct path only for one specified packet, one coupled/small slice, or residual work where a Lead would add no coordination value. Create bounded Specialist Leads first when any of these is true: open planning/architecture/contracts requires its own decomposition (create one Planning Lead); work splits into two or more independent domains or worker streams (create Domain Lead(s)); a stream needs two or more Workers, multi-round coordination, or its own review loop; or direct fan-out would exceed two active Worker/Reviewer lanes. The Lead owning a delegated slice manages its Workers and any risk-selected review; the General Lead converges Lead handbacks instead of supervising every Worker directly. A normal/Domain Lead may implement, coordinate, create Workers, and select Reviewers inside its slice, but MUST NOT create a Lead.

## Mandatory role contract and Paseo prerequisite

Every role MUST read [`references/role-contracts.md`](references/role-contracts.md) in full before taking any action. This reference is mandatory and is not optional branch reading.

Code Vương and General Lead/Tướng quân have an additional hard prerequisite: before routing or creating/prompting any agent, they MUST read the `/paseo` skill (`paseo/SKILL.md`) in full, call `list_profiles`, and read the notes of every returned Paseo profile. They must materialize the selected profile's combined `provider/model`, mode, thinking, feature, workspace, parent, label, and notification values exactly; they must not guess or use stale profile data. If the skill, profile notes, Paseo tools, or workspace identity is unavailable, stop with the applicable blocked state and do not fall back to direct work.

There is exactly one General Lead for the outcome. It may create multiple bounded Specialist Leads, but there is at most one Planning Lead per mission and no duplicate Lead for the same slice. A Specialist Lead owns only its explicit domain: a Domain/normal Lead may create bounded Workers and risk-selected Reviewers inside that domain, while a Planning Lead owns the planning/reviewer loop unless explicitly assigned a separate delivery slice. No Specialist Lead may create another Lead or change the overall outcome. Do not impose a fixed total child count; stop when no independent slice remains. Direct work remains valid for coupled or very small slices. Do not create a channel, watchdog, Planning Reviewer, or extra Reviewer unless the routing rules below select it. A Reviewer is selected for the smallest stable logical candidate required by the risk rubric, not automatically once per Worker.

The canonical role-routing rule is the `brief:role-routing` block in [briefing-contracts.md](references/briefing-contracts.md): the General Lead runs the Lead Delegation Gate; open plan/architecture routes to one Planning Lead, multi-domain or multi-worker coordination routes to bounded Domain Lead(s), one already-specified implementation packet may route directly to a Worker, and otherwise the General Lead keeps the work.

## Default workflow

1. **Route** — Code Vương reads the mandatory role contract and Paseo prerequisite, then creates one General Lead with `node assets/brief/brief.mjs`. An unambiguous user request does not need a second approval turn. Ask the user only for a C3 decision.
2. **Scout and choose** — General Lead reads the mission lease, inspects the relevant workspace, and runs the Lead Delegation Gate before any Worker fan-out. Use the Pre-plan addendum only for genuinely open architecture/planning/contracts or `I ≥ 4` or `U ≥ 4`; an open plan that needs its own decomposition gets one Planning Lead, which owns the plan/reviewer loop instead of General Lead running a duplicate one.
3. **Execute** — On the delegated path, General Lead creates bounded Planning/Domain Lead(s) first, with explicit scope, non-goals, write-set, acceptance, checks and handback. A Planning Lead returns PLAN_FINAL; Domain Leads then own their in-slice Worker coordination and review selection. General Lead may keep one direct residual/coupled slice, but must not also directly supervise every Worker in a delegated slice. On the direct path, it may implement or assign one specified Worker packet. Domain/normal Leads may implement, coordinate, create Workers and select Reviewers inside their slice, but no child creates a Lead.
4. **Review when selected** — The Lead closest to the changed slice selects the smallest stable logical candidate that the risk rubric requires, normally after its Workers converge; do not create one Reviewer per Worker by default. General Lead adds a mission-level/cross-slice Reviewer only when the rubric requires it. Freeze the candidate, launch the budgeted read-only lens, resolve material findings, and re-freeze after every mutation. The rubric and cycle rules live only in [review-scoring.md](references/review-scoring.md).
5. **Handoff** — General Lead reports changes, evidence, checks, uncertainty and next action to Code Vương. Code Vương verifies lifecycle/evidence presence and routes events; it does not inspect diffs to make technical judgments.

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

Before any action, every role must read `references/role-contracts.md`. Then read only the additional reference needed by the current branch:

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
