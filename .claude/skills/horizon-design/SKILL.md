---
name: horizon-design
description: Use when building any rider-facing UI in Horizon — creating a screen or component, choosing color, typography, or spacing, adding a notification or alert, animating anything, or working within the Departure, Motion, or Return registers. Applies Horizon's design rules on attention, interruption, and register discipline before code is written.
---

# Horizon Design Rules

Horizon is a premium native motorcycle companion, not a navigation app or a dashboard. The
rider's attention is sacred — nothing built here competes with the road. These are the rules
too long for `CLAUDE.md` but mandatory whenever UI is built. They are judgment calls, not token
values — for concrete colors, type scale, spacing, and motion timings see
[`docs/DESIGN.md`](../../../docs/DESIGN.md); for the full product vision see
[`docs/PRODUCT.md`](../../../docs/PRODUCT.md). Everything below is sourced from `PRODUCT.md` —
if a rule here seems to conflict with it, `PRODUCT.md` wins.

## 1. The three registers

Every screen belongs to one of three states of mind — not pages, states:

- **Departure** — the rider is preparing. Feeling: calm, confident, ready. The app answers one
  question only: "am I ready to ride?"
- **Motion** — the rider is moving. The app goes almost invisible. Only essential information
  appears; the road gets almost all attention. **This is the strictest register — design for it
  first, then relax for the other two.**
- **Return** — the ride is over. The app becomes reflective: photos, memories, statistics,
  journal, stories. Everything intentionally withheld during Motion becomes available here.

Typography, density, animation, and interaction all change with the register. Before building a
screen, know which register it lives in — a component that's correct in Return can be wrong, even
unsafe, in Motion.

## 2. The Attention Ladder

Escalate gradually — never jump straight to a loud channel:

```
Ambient → Peripheral → Haptic → Audio → Visual → Interrupt
```

Visual is not the default; reach for it only after ambient/peripheral/haptic/audio have been
ruled insufficient. **Interrupt is reserved for safety-critical situations only** — never for a
message, a summary, or anything that can wait.

## 3. Silence Budget

Attention is finite. The rider should almost never be interrupted. **Any new feature that wants
to interrupt the rider must replace another interruption** — it does not get to add to the total.
Safety events are exempt from the budget entirely.

## 4. Never Interrupt a Corner

No non-safety information may be delivered while the rider is turning, leaning, braking, or
otherwise mid-maneuver. This overrides every other principle in this document, including the
Attention Ladder and register rules — if there's a conflict, this wins.

## 5. Two typographic voices

- **Operational** — humanist grotesque. Riding information. Cool, precise, objective. Used in
  Departure and Motion.
- **Reflective** — serif. Journal, archive, stories, memories. **Return only.**

**The serif never appears during Motion.** If a component might render in Motion, it must not
touch the Reflective voice.

## 6. Color communicates meaning, never decoration

Dark-first, matte surfaces: deep black, charcoal, soft neutral surfaces, restrained amber, minimal
accent colors. No gradients, no neon, no glow. A color choice must be justifiable as meaning
("this amber means low fuel"), never as "it looks nice here."

## 7. Motion explains, never entertains

Animation should reduce cognitive load, not add to it. If an animation exists only because it
looks impressive, remove it. Every animation must be answerable with "what does this help the
rider understand?" — if there's no answer, it doesn't ship.

## 8. No gamification

No badges, streaks, XP, levels, counts, or rankings. No notification badges. This is not a taste
preference — it's a rejection of dopamine mechanics that would compete with the road for
attention. Non-urgent content doesn't get a lighter version of gamification either; it gets
deferred (see below).

## 9. Deferred Delivery

Messages, summaries, insights, photos, and analytics all wait until the ride ends or the rider
stops — they surface naturally in Return, never pushed mid-ride. If content isn't urgent and
isn't safety-related, the default is to hold it, not to find a quiet way to show it now.

## 10. Checklist — run this against any component you just built

- [ ] Which register (Departure / Motion / Return) does this belong to? Does its behavior change
      correctly across the other two, or does it wrongly assume one register everywhere?
- [ ] If this can appear during Motion: is it reduced to essential information only, and free of
      the Reflective (serif) voice?
- [ ] Does this ever interrupt the rider? If so, is it safety-critical — and if not, what existing
      interruption does it replace?
- [ ] Could this fire while the rider is turning, leaning, or braking? If so, it must not.
- [ ] Is every color used doing so to communicate something, not to decorate?
- [ ] Does every animation explain something the rider needs, rather than perform?
- [ ] Any badges, streaks, counts, or rankings snuck in? Remove them.
- [ ] Is non-urgent content deferred to Return instead of surfaced live?
