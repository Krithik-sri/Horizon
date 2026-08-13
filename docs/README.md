# Documentation

Every Horizon document lives in this folder. Only two files stay at the repo root:
[`README.md`](../README.md), the entry point, and [`CLAUDE.md`](../CLAUDE.md), the working
rules — both are read by tooling from the root and cannot move.

Each document answers exactly one question. If your change doesn't fit one of these, it
probably belongs in an ADR.

| Document | Answers | Update it when |
|----------|---------|----------------|
| [`PRODUCT.md`](./PRODUCT.md) | What is Horizon, and why does it exist? | The product vision or philosophy changes. **Outranks every technical doc below** — when a technical choice disagrees with it, this document wins or the disagreement becomes an ADR. |
| [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) | Why is the architecture like this? | A decision changes. Not a place for setup steps or code. |
| [`DESIGN.md`](./DESIGN.md) | What do things look like — colors, type, spacing, motion? | A design token or system rule changes. |
| [`ADR/`](./ADR/) | Why isn't it something else? | A decision is made — one record per decision, never edited in place. |
| [`SETUP.md`](./SETUP.md) | How do I run the Expo app? | App setup steps change. |
| [`SETUP_BACKEND.md`](./SETUP_BACKEND.md) | How do I run the Go server? | Backend setup steps change. |
| [`FINISHING.md`](./FINISHING.md) | How do I take the code-complete app to two phones on a real road? | A feature milestone's exit condition or verification steps change. |

## Referring to these files

Markdown links are relative — siblings as `./NAME.md`, ADRs as `./ADR/ADR-00N.md`, and the two
root files as `../README.md` / `../CLAUDE.md`. Prose mentions in backticks are repo-root-relative
(`docs/SETUP_BACKEND.md`), the same convention as `backend/internal/hub/room.go`, so a path
means the same thing wherever it's quoted.
