# CityWithLifeGrok

A living, autonomous city and economy simulation built with Grok.

Inspired by (but going far beyond) the impressive ~1-hour "SimCityClaude" demo created by Wes Roth using Claude Opus 4.8 Ultra Code.

## Vision

Build a simulation where:
- Residents live real daily lives with schedules and needs
- Businesses operate with real profit/loss, inventory, and employees
- Some businesses are **agentic** — making autonomous economic decisions using Grok
- The economy emerges from the interactions of many agents
- You have powerful tools to observe, influence, and understand what is happening

## Current Status

**Phase 0 — Foundation** (In Progress)

- ✅ Vite + TypeScript + Vitest project setup
- ✅ Robust `TimeSystem` with 1x / 10x / 100x / 1000x speed + pause
- ✅ Seeded, deterministic RNG (critical for testing & debugging)
- ✅ EventBus for clean system communication
- ✅ Basic serialization / save scaffolding
- ✅ Clean architecture with strong separation of simulation vs rendering
- ✅ Tests passing

## Getting Started

```bash
npm install
npm run dev
```

Use the speed buttons or keyboard shortcuts:
- `Space` — Pause / Resume
- `1` — 1x speed
- `2` — 10x speed
- `3` — 100x speed
- `4` — 1000x speed

## Project Philosophy

- Simulation logic is **sacred** — it must be testable in isolation
- Time drives everything
- Observability is a first-class feature ("God Mode" tools)
- We build in layers and test as we go
- We embrace emergence over scripting

See `plans/city-with-life-development-plan.md` for the full roadmap.

## Key Documents

- `plans/city-with-life-development-plan.md` — Master development plan
- `build-guides/city-with-life-build-prompts.md` — Phased build prompts
- `references/simcity-claude-reference.md` — Inspiration from Wes Roth's demo
- `ARCHITECTURE.md` — Current architecture decisions

## Development

```bash
npm run dev          # Start development server
npm run test:run     # Run all tests (includes aggressive 100-320+ pop stress + performance benchmarks; watch console for reports)
npm run build        # Production build
```

## Long-term Goals

- Rich resident simulation (needs, personality, goals)
- Full economic simulation with resources and trade
- Working traffic system with traffic lights
- **Agentic businesses** powered by Grok making real decisions
- Powerful inspection and intervention tools
- Long-term persistence and emergent storytelling

---

Built with care. Not in a rush.
