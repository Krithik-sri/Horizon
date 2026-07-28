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

Per [`docs/DEVELOPMENT_GUIDE.md` §4](../DEVELOPMENT_GUIDE.md#4-development-workflow), escalate to an
ADR when the change:

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
| [003](./ADR-003.md) | **OpenFreeMap**, not Google Maps or Mapbox, for tiles | Accepted | OpenFreeMap degrades, or a budget appears |
| [004](./ADR-004.md) | **PWA first**, native app later | Accepted | Background location becomes a requirement, not a nice-to-have |
| [005](./ADR-005.md) | **LiveKit** for voice, not custom WebRTC | Accepted | LiveKit's free tier changes, or usage outgrows it |
| [006](./ADR-006.md) | **Zero paid services** as a hard constraint | Accepted | The project stops being a hobby project |

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
