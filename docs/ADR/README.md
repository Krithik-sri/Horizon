# Architecture Decision Records

An ADR records **one decision, at the moment it was made** — the context, what we chose, what we
rejected, and what it costs us.

## Why we keep these

`docs/SYSTEM_DESIGN.md` describes the architecture we have. ADRs describe *why it isn't something else*.
That distinction matters when a new contributor asks "why not just use Mapbox?" — the answer should
be a link, not a conversation. It matters even more when the answer has expired: an ADR tells you
what would have to change for the decision to be revisited.

## Rules

1. **ADRs are append-only.** Never edit the Decision of an accepted ADR. If it changes, write a new
   ADR that supersedes it and cross-link both.
2. **Number sequentially**, never reuse a number: `ADR-007.md`, `ADR-008.md`, …
3. **One decision per record.** If you're writing "and also", split it.
4. **Write it before the code**, not after. An ADR justifying a merged PR is a postmortem.
5. **Status** is one of `Proposed`, `Accepted`, `Superseded by ADR-NNN`, or `Deprecated`.

## When a decision needs an ADR

Escalate to an ADR when the change:

- adds a third-party service or a backend dependency,
- changes the WebSocket protocol,
- moves a computation between client and server,
- changes the concurrency model,
- reverses a decision already recorded here.

Everything else goes straight to a branch. Most work does not need an ADR.

## Index

| # | Decision | Status | Revisit when |
|---|---|---|---|
| [001](./ADR-001.md) | **Go, not Node**, for the realtime server | Accepted | Never, realistically — but if the team shrinks to zero Go familiarity |
| [002](./ADR-002.md) | **WebSockets, not REST polling**, for live state | Accepted | Corporate proxies break long-lived sockets in practice |
| [003](./ADR-003.md) | **OpenFreeMap**, not Google Maps or Mapbox, for tiles | Accepted — amended by [011](./ADR-011.md) | OpenFreeMap degrades, or a budget appears |
| [004](./ADR-004.md) | **PWA first**, native app later | Superseded by [ADR-007](./ADR-007.md) | Background location becomes a requirement, not a nice-to-have |
| [005](./ADR-005.md) | **LiveKit** for voice, not custom WebRTC | Accepted | LiveKit's free tier changes, or usage outgrows it |
| [006](./ADR-006.md) | **Zero paid services** as a hard constraint | Accepted — amended by [011](./ADR-011.md) | The project stops being a hobby project |
| [007](./ADR-007.md) | **Native Android-first**; the PWA is cancelled | Accepted | The product walks back toward an install-free client |
| [008](./ADR-008.md) | **Two backends**: Go for ephemeral realtime, Supabase for durable state | Accepted | Supabase Realtime's throughput improves, or convoy state needs to be durable |
| [009](./ADR-009.md) | **No standings, no ranking** — the race indicator is removed | Accepted | Never — this follows directly from the No Gamification pillar |
| [010](./ADR-010.md) | **One hub lock and one broadcast sweep**, not one goroutine per room | Accepted | Concurrent live rides reach the hundreds — shard the lock per room |
| [011](./ADR-011.md) | **Navigation is a first-class capability** — route line + turn-by-turn, amending 003 and 006 | Accepted | Off-route rerouting, spoken guidance, or destination search become their own decisions |

## Retired task scheme

`cde311f` ("repo overhaul") deleted `docs/ROADMAP.md` and `docs/MASTER_TASKS.md`, which defined the
`HZ-n` task-id scheme and the `M1`–`M5` milestones. Several ADRs cite those ids in their Context,
Consequences, or Future Revisions sections. Per the append-only rule above, those records are not
being edited — the ids are historical and intentionally left dangling. `docs/SYSTEM_DESIGN.md` §11
(Phases 0–4) is now the only live roadmap.

## Template

````markdown
# ADR-00N: <Short decision, stated as a choice>

| | |
|---|---|
| **Status** | Proposed \| Accepted \| Superseded by ADR-NNN \| Deprecated |
| **Date** | YYYY-MM-DD |
| **Deciders** | <who> |
| **Supersedes** | — |

## Context

The situation that forced a decision. Constraints, requirements, what we knew at the time.
Facts, not conclusions.

## Decision

What we chose, stated plainly and in the active voice: "We use X."

## Alternatives Considered

One subsection per rejected option: what it was, what was attractive, why it lost.
An alternative with no upside was never a real alternative — say what was genuinely good about it.

## Consequences

What becomes true as a result. Positive and negative, both concrete.

## Trade-offs

What we knowingly gave up. The honest list — the one a critic would write.

## Future Revisions

The conditions under which this should be revisited, and what the migration would look like.
Be specific: "if X exceeds Y" beats "if requirements change".
````
