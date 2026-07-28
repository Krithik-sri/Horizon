# Documentation

Every Horizon document lives in this folder. Only two files stay at the repo root:
[`README.md`](../README.md), the entry point, and [`CLAUDE.md`](../CLAUDE.md), the working
rules — both are read by tooling from the root and cannot move.

Each document answers exactly one question. If your change doesn't fit one of these, it
probably belongs in an ADR.

| Document | Answers | Update it when |
|----------|---------|----------------|
| [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) | Why is the architecture like this? | A decision changes. Not a place for setup steps or code. |
| [`ADR/`](./ADR/) | Why isn't it something else? | A decision is made — one record per decision, never edited in place. |
| [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) | What does the system look like today? | A review is re-run. Subordinate to `docs/SYSTEM_DESIGN.md` on intent. |
| [`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md) | How do we build? Principles, workflow, standards. | The engineering process changes. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How do I set up and submit a change? | Contribution mechanics change. **Start here if you're new.** |
| [`SETUP_BACKEND.md`](./SETUP_BACKEND.md) | How do I run the Go server? | Backend setup steps change. |
| [`SETUP_WEB.md`](./SETUP_WEB.md) | How do I run the PWA — the v1 client? | Web setup steps change. |
| [`SETUP_MOBILE.md`](./SETUP_MOBILE.md) | How do I run the Expo app (Phase 4)? | Mobile setup steps change. |
| [`PROJECT_BOARD.md`](./PROJECT_BOARD.md) | What should I work on? Sprint, backlog, debt, known bugs. | Any task changes status. |
| [`MASTER_TASKS.md`](./MASTER_TASKS.md) | What is the full task breakdown? | Tasks are added or re-prioritised. Supersedes the board's task lists. |
| [`ROADMAP.md`](./ROADMAP.md) | Where is this going? Milestones, risks, success criteria. | Milestone scope or timing changes. |

## Referring to these files

Markdown links are relative — siblings as `./NAME.md`, ADRs as `./ADR/ADR-00N.md`, and the two
root files as `../README.md` / `../CLAUDE.md`. Prose mentions in backticks are repo-root-relative
(`docs/SETUP_BACKEND.md`), the same convention as `web/src/types.ts`, so a path means the same
thing wherever it's quoted.
