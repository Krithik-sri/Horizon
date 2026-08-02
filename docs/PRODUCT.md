# Project Horizon — Product Context & Vision

**Version 1.0** · This document is the product's source of truth. Architecture decisions cite it;
it does not cite them. When a technical choice and this document disagree, this document wins or
the disagreement gets recorded as an ADR.

---

## What is Horizon?

Horizon is a premium mobile companion for motorcycle riders.

It navigates. It keeps a convoy together. It helps plan a ride, and it remembers one.

But it is built on a different premise from the maps you already have: a rider does not ride to
arrive. Navigation apps optimize destinations. Horizon optimizes the ride — and getting you there
is simply part of that.

It is designed to become an invisible co-rider that quietly supports the rider without demanding
attention.

---

## The Core Philosophy

A rider does not ride because they want to reach somewhere.

A rider rides because they enjoy riding.

That changes everything.

Every decision inside Horizon begins with one question:

> **"Does this help someone enjoy, understand, or safely experience the ride?"**

If not — it does not belong.

---

## Product Position

Horizon still gets you there — it just doesn't stop at that.

| | |
|---|---|
| Google Maps | "I'll help you arrive." |
| Apple Maps | "I'll help you navigate." |
| Waze | "I'll help you avoid traffic." |
| **Horizon** | **"I'll make the ride itself better."** |

---

## Vision

To become the operating system for motorcycle experiences.

Not by replacing motorcycles. Not by replacing maps. But by becoming the digital companion riders
naturally open before every ride.

---

## Product Pillars

Everything Horizon builds must support these principles.

### Respect

The rider's attention is sacred. Nothing competes with the road. No unnecessary notifications. No
manipulation. No engagement tricks. Respect wins every design decision.

### Presence

Technology should disappear. The rider should experience the road, not the interface. The
application should quietly assist rather than constantly demand interaction.

### Confidence

Every piece of information must increase confidence. Never create uncertainty. Never exaggerate.
Never distract. **If information cannot be trusted, it should not be shown.**

### Exploration

Encourage discovery. Not through gamification, but through curiosity. The destination is
important. The journey matters more.

---

## Product Identity

Horizon is not futuristic. It is timeless.

It should still feel elegant ten years from now. Avoid trends. Avoid visual noise. Avoid
unnecessary decoration.

---

## Emotional Experience

Every ride moves through three emotional states.

### Departure

The rider prepares. The feeling should be **calm, confident, ready.**

The application answers only one question: *"Am I ready to ride?"*

### Motion

The rider is moving. The application becomes almost invisible.

Only essential information appears. The road receives almost all attention.

### Return

The ride is over. The application becomes reflective.

Photos. Memories. Statistics. Journal. Stories.

Everything that was intentionally hidden during riding becomes available afterwards.

---

## The Three Registers

Every screen belongs to one of three contexts: **Departure**, **Motion**, **Return**.

These are not pages. They are states of mind.

Typography, animation, density, interaction, and information all change according to the register.

**Motion is the strictest.**

---

## Horizon's Design Principles

Minimal. Calm. Purposeful. Confident. Premium. Intentional. Human.

Every pixel must earn its place.

---

## The Horizon Line

Every layout should have a visual horizon. This is a compositional principle, not a decorative
line.

It separates:

- **Ahead** — future information
- **Now** — current riding
- **Held** — deferred information

---

## Silence Budget

The rider should almost never be interrupted. There is a strict limit on unnecessary
interruptions. Safety-related events are exempt.

**Any new feature that wants to interrupt the rider must replace another interruption.**

Attention is treated as a finite resource.

---

## Attention Ladder

Information should escalate gradually.

```
Ambient → Peripheral → Haptic → Audio → Visual → Interrupt
```

Interruptions are reserved for safety-critical situations. Visual information is not the default.

---

## Deferred Delivery

Everything that is not urgent waits: messages, achievements, summaries, insights, photos, ride
analytics.

These appear naturally when the ride ends or the rider stops.

No badges. No notification counts. No dopamine mechanics.

---

## Never Interrupt a Corner

The application must never deliver non-safety information while the rider is turning, leaning,
braking, or performing complex riding actions.

**Respect overrides every other principle.**

---

## No Gamification

Horizon intentionally excludes: badges, achievements, daily streaks, leaderboards, XP, levels,
artificial rewards.

**The ride itself is the reward.**

---

## Design Language

Dark-first. Matte surfaces. Restrained color palette. Minimal motion. Large typography. Generous
spacing. Purposeful hierarchy. Premium materials. No visual clutter.

### Typography — two voices

**Operational Voice** — humanist grotesque. Used for riding information. Cool, precise, objective.

**Reflective Voice** — serif. Used only after riding: journal, archive, stories, memories.

**The serif never appears during Motion.**

### Color Philosophy

Color communicates meaning, never decoration.

Primary palette: deep matte black, charcoal, soft neutral surfaces, restrained amber, minimal
accent colors.

No vibrant gradients. No glowing cyberpunk effects. No neon.

### Motion

Motion explains. It never entertains.

Animation should reduce cognitive load, not increase it.

If an animation exists only because it looks impressive — remove it.

---

## Motorcycle Philosophy

The motorcycle is the emotional anchor. Not the product. Not decoration.

It quietly reminds the rider why Horizon exists. The interface should never become a motorcycle
showroom.

---

## User Experience

The rider should feel **prepared** before departure, **focused** while riding, **reflective** after
returning.

Everything should reinforce these emotional transitions.

---

## Technical Direction

Platform: React Native, Expo, TypeScript. Target: native Android, native iOS.

The application should feel completely native. Not like a website inside a mobile shell.

### Frontend Stack

React Native · Expo · Expo Router · TypeScript · React Native Reanimated · React Native Gesture
Handler · React Native Skia · React Native SVG · Unistyles · Zustand · TanStack Query · Lucide
Icons.

**No UI component libraries.** Every component should be custom-built for Horizon.

### Backend Direction

Supabase · PostgreSQL · Supabase Auth · Supabase Storage · Supabase Realtime · REST APIs.

Feature-first architecture. Domain-driven thinking.

> **Two deviations from this section are recorded as ADRs**, because they conflict with constraints
> that are upstream of the stack:
> - **Maps:** MapLibre + OpenFreeMap, not Mapbox — Mapbox requires a credit card
>   ([`ADR-006`](./ADR/ADR-006.md), [`ADR-003`](./ADR/ADR-003.md)).
> - **Realtime:** live convoy positions run through a Go WebSocket server, not Supabase Realtime;
>   Supabase owns durable state only ([`ADR-008`](./ADR/ADR-008.md)).

---

## Performance Goals

60 FPS · fast startup · battery efficient · minimal re-renders · native gestures · smooth
animations.

**Performance is considered part of the design.**

---

## Long-Term Vision

**Today:** navigation, convoy, and ride planning — a premium riding companion.

**Tomorrow:** a complete ecosystem — ride planning, ride memories, convoy experiences, smart helmet
integration, wearables, vehicle integrations, community.

Everything built around one principle: helping riders enjoy riding.

---

## What Horizon Is Not

Not a motorcycle marketplace. Not a social media platform. Not a fitness app. Not another
dashboard. Not a notification machine. Not a gamified experience. Not a concept project.

---

## Final Philosophy

Technology should disappear. The rider should remember the road, not the application.

If someone finishes a ride and says:

> *"I barely noticed Horizon was there."*

Then Horizon has succeeded.
