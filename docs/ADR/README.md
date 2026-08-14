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
| [011](./ADR-011.md) | **Navigation is a first-class capability** — route line + turn-by-turn, amending 003 and 006 | Accepted — amended by [012](./ADR-012.md), [013](./ADR-013.md) | Off-route rerouting, spoken guidance, or destination search become their own decisions |
| [012](./ADR-012.md) | **Destination search ships**; maneuver cues are ambient, not eventful; the route line stays two-tone amber, amending 011 | Accepted — amended by [014](./ADR-014.md), [015](./ADR-015.md) | Off-route rerouting or spoken guidance become their own decisions; ambient-only maneuver cues prove insufficient in the field |
| [013](./ADR-013.md) | **A route can be fetched without being stored or broadcast** (`preview`), and alternatives are pre-commit only — the room still stores one route, amending 011 | Accepted | ORS quota pressure becomes real; a third feature wants a non-broadcast route fetch |
| [014](./ADR-014.md) | **Off-route rerouting is personal** — fetched by one rider, rendered on one device, never broadcast; the convoy's route is immutable to a wrong turn, amending 012 | Accepted | The personal route peels away from the group's road; false reroutes in cities prove common |
| [015](./ADR-015.md) | **Spoken guidance ships**, timed by distance to the maneuver rather than by detecting the corner — the position of the turn is already in the data, amending 012 | Accepted | LiveKit convoy voice ships and the two audio sources must be coordinated; riders report late cues |
| [016](./ADR-016.md) | **Anonymous sign-in is the default identity** — an account is an upgrade that preserves `sub`, never a gate on riding | Accepted | Riders lose data to reinstalls; the free tier's inactivity pause bites |
| [017](./ADR-017.md) | **`/ws` requires a verified Supabase JWT**, the rider id is the token's `sub`, and `?rider=` is removed — implementing what 008 specified and three docs wrongly described as existing | Accepted | The Supabase project uses asymmetric keys (JWKS, a third Go dependency); mid-ride revocation becomes a real threat |
| [018](./ADR-018.md) | **The rider's phone writes the durable ride record** — no Edge Function, and no shared convoy record; each rider's row is their own | Accepted | A consent model ships (shared records, a real `ride_participants` table); geospatial querying wants PostGIS |
| [019](./ADR-019.md) | **Return shows facts about one ride, never comparisons** — if a number needs a second ride to compute, it's a ranking; extends 009 from between-riders to between-your-own-rides | Accepted | Only if PRODUCT.md's No Gamification pillar is itself revised |
| [020](./ADR-020.md) | **Convoy voice is exempt from the corner rule** — the app never mutes, ducks or delays a co-rider; navigation speech yields by skipping, never delaying, amending 015's open audio-contention item | Accepted | The iOS port forces the lazy-connect question; battery measurement rules out continuous subscription |
| [021](./ADR-021.md) | **Location runs in a task that may execute with no React tree**; one GPS subscription replaces `watchPositionAsync`, and a killed process loses fixes rather than buffering them | Accepted | Task delivery proves laggier than `watchPositionAsync`; background JS timer throttling breaks reconnection |

**Note on 011's "Revisit when" cell:** it lists destination search as something that would "become
its own decision" — [012](./ADR-012.md) is that decision. The cell above is left exactly as
originally written, per the append-only rule; it is now only partly current, and this note is the
correction, not an edit to 011's row.

**Note on 017's ES256 fork:** ADR-017 §8 named the ES256-via-JWKS path as a fork to take if the
Supabase project uses asymmetric keys. That fork was taken; the implementation lives in
`backend/internal/auth/auth.go` and the server now requires `SUPABASE_URL` (not `SUPABASE_JWT_SECRET`).

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
