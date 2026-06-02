# CityWithLifeGrok — Master Development Plan

**Version:** 1.0  
**Date:** Created for initial planning  
**Purpose:** This is the single source of truth for how we will build CityWithLifeGrok into something *amazing that really works*.  
**Core Reference Documents:**
- `references/simcity-claude-reference.md`
- `build-guides/city-with-life-build-prompts.md`

---

## 1. Executive Vision

### The Dream
We are not building another toy city simulator. We are building a **living, breathing digital ecosystem** where:

- Individual residents have routines, needs, and (eventually) personalities.
- Businesses are not just data structures — some of them will be **autonomous economic actors** making real decisions using Grok.
- The economy emerges from the interactions of hundreds of agents rather than being scripted from the top down.
- You can watch the city at 1000x speed and see meaningful macro patterns, then slow down and inspect why a specific business made a particular decision.

### Inspiration vs Our Ambition
The Wes Roth / Opus 4.8 demo was impressive because it was built in under an hour and still had surprising coherence. Our version will be slower to build, but dramatically higher quality in:

- Architectural integrity
- Depth of agent behavior (especially businesses)
- Observability and "God Mode" power
- Long-term extensibility
- Reliability and reproducibility

**Our north star:** A simulation that feels *alive* even when you leave it running in the background.

---

## 2. Definition of Success

A phase (or the whole project) is successful when:

- The simulation core is **correct and observable** before visuals are added.
- Every major system has **automated tests** where feasible + clear manual verification procedures.
- A new developer (or future us) can understand the architecture in under 30 minutes by reading docs + code.
- We can run the simulation for long periods (simulated weeks/months) without it falling apart or producing nonsensical economic results.
- We have **deep visibility** into what is happening (we can answer "why did X happen?" quickly).
- Adding a new major feature (e.g. housing, weather, government) does not require rewriting core systems.
- Phase 7 (Agentic Businesses) produces genuinely interesting, non-trivial decision-making that a human can understand and sometimes be surprised by.

---

## 3. Guiding Principles (Non-Negotiable)

These principles will be referenced constantly during development.

1. **Simulation Core is Sacred** — The simulation logic must be completely decoupled from rendering and UI. The core must be unit-testable in isolation.
2. **Time is the Fundamental Primitive** — Everything happens *in time*. The simulation clock drives almost all behavior.
3. **Systems Architecture** — Prefer many small, focused systems (TimeSystem, EconomySystem, TrafficSystem, etc.) over large monolithic classes.
4. **Observability First** — If we cannot easily inspect and understand what an entity is doing, we have not finished the feature.
5. **Serializable by Default** — Every piece of important state must be serializable for save/load from the beginning.
6. **Build in Layers, Not Features** — Get the thinnest possible vertical slice working, then deepen each layer.
7. **Test as We Go** — We will not accumulate untested simulation logic. Testing debt is more dangerous here than in most projects.
8. **Embrace Emergence** — We will create the *conditions* for interesting behavior rather than scripting every outcome.

---

## 4. Technology Stack Decision

**Final Recommendation: Option B (Vite + TypeScript + HTML5 Canvas)**

### Rationale

| Factor                        | Vite + TS + Canvas | Pure HTML/JS | React + Canvas |
|-------------------------------|--------------------|--------------|----------------|
| Development speed (early)     | Excellent          | Best         | Good           |
| Long-term maintainability     | Excellent          | Poor         | Very Good      |
| Type safety for complex state | Excellent          | None         | Excellent      |
| Performance for simulation    | Excellent          | Excellent    | Good           |
| Ease of testing core logic    | Excellent          | Good         | Good           |
| Future expansion (UI, tools)  | Very Good          | Poor         | Excellent      |

**Why not React early?**
React adds complexity and indirection when our primary challenge is getting the *simulation* right. We can add a thin React layer later for advanced tools if needed.

**Why TypeScript?**
Complex interdependent systems (time, economy, movement, decision-making) become extremely difficult to reason about without types once they grow beyond ~2000 lines.

**Canvas vs PixiJS**
Start with native Canvas + a small rendering abstraction layer. We can migrate to PixiJS later if we need better performance or features. Avoid premature optimization.

**Confirmed Stack (unless we explicitly change it later):**
- Vite 6+
- TypeScript (strict mode)
- Native Canvas for main view
- Vanilla DOM or very lightweight UI library for dashboard/controls (we'll decide during Phase 5)
- No heavy game engine

---

## 5. Overall Development Strategy

### Core Philosophy: Simulation-First + Vertical Slices

We will **never** build a large amount of simulation logic without being able to run and observe it.

**Preferred pattern per phase:**
1. Design the data model and system interfaces
2. Implement the simulation logic in isolation (with tests)
3. Add minimal but functional visualization to make it observable
4. Add deeper behavior / features
5. Add rich visualization and tools
6. Verify with long-running simulations + stress tests

### Testing Strategy (This is Critical)

Because the user explicitly said we will "build and test everything as we go" and "spare no expense on tokens":

- **Unit tests** for all pure simulation logic (TimeSystem, Economy calculations, Schedule logic, etc.)
- **Integration tests** for interactions between systems
- **Property-based / invariant tests** where possible (e.g., "total money in the system should only change in defined ways")
- **Long-running simulation tests** (run for 100+ simulated days and assert no explosions in numbers or contradictions)
- **Manual verification protocols** documented for every phase (what a human should watch for)
- **Reproducibility** — We should be able to seed the simulation and get identical results (critical for debugging)

We will maintain a `tests/` directory with clear organization from Phase 0 onward.

---

## 6. Detailed Phase Plans

### Phase 0: Project Setup & Architecture Foundation

**Status:** ✅ COMPLETE (as of 2026). Advanced far beyond initial scope. Phase A (Core Simulation Stabilization) now complete per updated-master-plan-v2-agency-takeover.md (Boot Stability + Canvas Liveliness + Economic/Behavioral Activity + Long-Running Stability APIs + Economic Robustness + Harness Restoration all delivered and verified). Full Businesses/Economy/Traffic/Movement + rich viz + God Mode + Phase 7 Crown Jewel harness + real GrokBusinessBrain + 200+ tests baseline live. Fleet at 6-8 agents; transitioning to Phase B (Foundation Hardening) + Crown activation on the now-solid core.

**Primary Goal:** Establish a professional, sustainable foundation that we will be happy to live with for a long time.

**Completion Notes:**
- All core "Must Have" items delivered.
- Strong testing culture established early (16 tests).
- Deterministic simulation foundation (seeded RNG + time system).
- Clean separation of simulation core from rendering.
- Save/load scaffolding in place.
- Developer experience (demo + debug tools) already functional.

**Detailed Scope**
- **Must Have:**
  - Proper Vite + TypeScript project initialized with strict settings ✅
  - Clean folder structure (see proposed structure below) ✅ (ongoing)
  - Core `Simulation` class with tick loop ✅
  - Full variable speed system (including 1000x and pause) ✅
  - Proper simulated time model (ticks → minutes → hours → days → weeks) ✅
  - `ARCHITECTURE.md` written and reviewed (started)
  - Basic test infrastructure (Vitest recommended) ✅
  - Minimal debug UI showing time + speed controls ✅
  - Save/Load scaffolding (even if just JSON export/import of state) ✅ (basic)
  - Seeded deterministic RNG ✅
  - EventBus for system communication ✅

- **Completed in Initial Phase 0 Work:**
  - SeededRNG with high-quality deterministic output
  - EventBus implementation
  - Basic serialization helpers
  - Comprehensive tests for TimeSystem + RNG + EventBus (16 tests total)
  - Logger utility added
  - Save/Load demo buttons wired in the UI (exercises the scaffolding)
  - Project README and improved documentation
  - Working interactive demo with seeded visual elements + basic save/load

- **Should Have:**
  - Seeded random number generator
  - Basic event bus / pub-sub for systems to communicate cleanly

- **Out of Scope:** Residents, economy, visuals beyond debug controls

**Proposed Folder Structure (starting point):**
```
src/
├── core/
│   ├── Simulation.ts
│   ├── TimeSystem.ts
│   └── types/
├── systems/
├── entities/
├── rendering/
├── ui/
├── utils/
├── tests/
└── main.ts
```

**Testing Strategy**
- Unit tests for TimeSystem (especially speed changes, time advancement, wrapping)
- Test that simulation can run for 10,000 ticks without errors
- Manual verification checklist for speed controls

**Definition of Done**
- `npm run dev` shows working time + speed controls
- `ARCHITECTURE.md` exists and has been reviewed together
- All core time logic has passing tests
- State is serializable

**Risks**
- Over-engineering the foundation → Mitigate by keeping Phase 0 deliberately thin

---

### Phase 1: Residents System

**Status:** In Progress — Good early progress (visuals + core mechanics live)

**Primary Goal:** Residents who live believable daily lives driven by time.

**Must Have**
- Resident entity with stable identity
- Schedule system (configurable daily/weekly routines)
- Location awareness (home, work, other) — basic
- Wage system + Friday payday ✅ (implemented and triggers automatically)
- Basic internal state (energy, money, etc.) — working
- Population spawning and management ✅
- Visual representation of real residents by activity ✅ (in demo)
- Strong inspector for any resident

**Testing Strategy (Important)**
- Unit tests for schedule advancement
- Invariant tests: "Every resident should have exactly one home and one workplace"
- Long simulation run: 30 simulated days — verify no residents get stuck, wages are paid correctly, etc.
- Manual: Watch 5–10 residents over a full simulated week

**Definition of Done**
- 40 residents can run for multiple simulated weeks without schedule or wage bugs
- Inspector exists and is genuinely useful for debugging

---

### Phase 2: World & Movement

**Primary Goal:** Residents actually travel between meaningful locations.

**Key Decisions to Make in This Phase**
- Grid vs zone-based vs named locations (recommend starting simple)
- How "travel time" works

**Testing Strategy**
- Movement should be deterministic given the same seed
- Stress test with high population

---

### Phase 3: Traffic & Roads

**Primary Goal:** Recreate (and ideally exceed) the traffic system from the reference video.

**Critical Details from Reference**
- Working traffic lights
- "Test mode" behavior (green if clear)
- Congestion emergence as vehicle count rises
- Trucks vs cars distinction

**Testing Strategy**
- Visual + statistical (count cars stopped at lights over time)
- Performance test at 200+ vehicles

---

### Phase 4: Businesses & Economy Foundation

**Status:** ✅ Core complete + heavily extended (BusinessSystem, EconomySystem, real wages, trade, P&L, inventory, hire/fire with effects, God Mode controls, canvas trade flows + profit indicators, unemployment/job search, 100+ day economic invariants). Wave 3 agents adding BusinessInspector + Brain scaffolding (Phase 7 prep) + housing rent flows.

**Primary Goal:** Create the economic engine that makes everything else meaningful.

**Must Have (High Bar)**
- Real double-entry style thinking for money flow (even if not full accounting)
- Proper inventory that cannot go negative without consequence
- Businesses that can fail (or at least lose money)
- Clear separation between "production", "sales", "labor costs"

**Testing Strategy (Very Important)**
- Economic invariants (total money should follow known rules)
- Long runs (100+ simulated days) looking for runaway inflation/deflation or dead economies
- Ability to dump full economic state for analysis

---

### Phase 5: Visualization (Town View + Dashboard)

**Primary Goal:** Make the simulation *watchable* and understandable.

**Philosophy:** Clarity > Beauty in early phases.

**Key Deliverables**
- Main canvas view with roads, buildings, agents, vehicles, traffic lights
- Dashboard with key numbers + speed controls
- Selection + inspection of entities

---

### Phase 6: Charts, Metrics & Economic Visibility

**Primary Goal:** Deliver the "wow, the economy is really running" feeling from the original demo.

**Must Have**
- Multiple live charts (we should decide which 5–7 are most valuable)
- Excellent 1000x performance (rendering should not slow down the simulation)
- Good "Simulation Guide" / explanation system

---

### Phase 7: Agentic Businesses (The Crown Jewel)

**Status (Wave 3 Launch)**: Scaffolding in progress via dedicated parallel agent (BusinessBrain interface + rule-based impl + decision logging + A/B test harness + toggle). Zero LLM yet — pure testable foundation per plan. Logging + narrow decision scopes ready for future Grok integration.

**Primary Goal:** This is the phase that separates CityWithLifeGrok from almost every other city/economy sim.

**Strategic Approach (This needs special care)**
- We will design a clean "BusinessBrain" interface
- Businesses will receive structured context (their financials, market conditions, employee situation)
- We will start with narrow decision scopes (pricing, production targets, hiring)
- Heavy investment in **decision logging** and explainability
- Begin with 2–3 businesses being agentic, rest rule-based for comparison

**Risks (High)**
- LLM decision quality and consistency
- Cost (token usage at scale)
- Hallucinations or economically destructive behavior

**Mitigation**
- Strong sandboxing of what decisions a business can actually make
- Excellent logging + replay capability
- Ability to easily disable agentic mode per business

**Testing Strategy**
- A/B testing (same starting conditions, one with agentic businesses, one without)
- Human review of decision traces

**Wave 3 Final Integration (2026-05-30)**: Complete crown jewel final multi-surface probe (`runCrownJewelFinalMultiSurfaceProbe` + alias + globalThis) + rich `[CROWN-JEWEL-FINAL-PROBE-ALL]` (all recent surfaces: synergy compounds, v3 stress, 60/90d persist, shadow heuristics, canvas sparks, God/BI provenance + post-hygiene note) + God Mode Crown Dashboard one-click wiring ("🚀 Run Crown Jewel Final Probe..." button + compact summary readout + Export) + 3 GodWiring tests now live. Ties every recent 8+ agent delivery into one delightful end-to-end probe (God Mode + harness). M3 crown jewel fully hardened and documented. (See ARCHITECTURE.md Phase 7 Crown Jewel section for full surface + run examples.)

---

### Phase 8: Persistence, God Mode & Foundation Hardening

**Primary Goal:** Make this a real, usable, long-term platform.

**Must Have**
- Robust save/load (including mid-simulation)
- Powerful God Mode tools (time manipulation, entity editing, event injection, scenario loading)
- Performance profiling and optimization pass
- Excellent documentation

---

## 7. Cross-Cutting Architecture Decisions

### Persistence Strategy
- Single source of truth: The `Simulation` state object must be the only thing that needs to be serialized.
- We will design a clean `SimulationSnapshot` interface early.

### LLM Integration Strategy (Critical for Phase 7+)
- All LLM calls must go through a well-defined abstraction layer (`AgentDecisionProvider`)
- We must be able to swap providers and mock them for testing
- Every LLM call must be logged with full context + response + timestamp
- Cost tracking from day one in Phase 7

### Performance Targets (Initial)
- 1000x speed should feel smooth on a modern laptop (target: 10,000+ ticks per real second when rendering is minimized)
- 200+ agents + 50+ vehicles should run comfortably at 60x–100x

---

## 8. Risk Register (Big Picture)

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Simulation complexity explodes | High | Very High | Strict layering + ruthless scope control per phase |
| Agentic businesses produce boring or broken behavior | Medium | High | Start very narrow + heavy investment in logging + evaluation |
| Performance becomes unacceptable at scale | Medium | High | Profile early, keep simulation core lean |
| Scope creep / "just one more feature" | Very High | High | This plan document + regular checkpoint reviews |
| Loss of motivation on long phases | Medium | Medium | Celebrate small visible wins + maintain clear "Definition of Done" |
| LLM costs become prohibitive | Medium | Medium | Strong caching, narrow decision scopes, local model options later |

---

## 9. Collaboration & Workflow Process

1. We review and agree on this plan (and any future revisions).
2. Before starting a new phase, we review the phase section together and may refine scope.
3. We are now using **parallel sub-agents** (via isolated worktrees) to accelerate independent work.
4. When working, the main agent + sub-agents follow the phases, write tests for significant logic, and document changes.
5. All sub-agent work is reviewed and merged by the main developer.
6. We maintain this plan + `AGENTS.md` as living coordination documents.

See `AGENTS.md` for current active agents and coordination rules.

**Token Philosophy:** We have shifted to an all-in autonomous multi-agent development model to dramatically accelerate the timeline while maintaining the quality standards defined in this plan. See AGENTS.md for current active agents.

---

## 10. Major Milestones

- **M0** — ✅ End of Phase 0: Professional foundation exists
- **M1** — End of Phase 1: Residents with schedules, wages, and basic daily life
- **M1** — End of Phase 4: First "economy is running" moment (rule-based businesses)
- **M2** — End of Phase 6: The simulation is genuinely impressive to watch (matches or exceeds the spirit of the Wes Roth demo)
- **M3** — End of Phase 7: First compelling agentic business behavior (the real differentiator)
- **M4** — End of Phase 8: Solid v1.0 foundation ready for expansion

---

## 11. Immediate Next Actions

1. **You review this plan** thoroughly (take your time).
2. We discuss and refine any sections (especially tech stack, phase ordering, and scope).
3. We make a formal decision on the tech stack.
4. We may create a v1.1 of this plan with any agreed changes.
5. We begin **Phase 0** using the prompt from the build guide (possibly refined).

---

## Final Note

This plan exists because you said the plan file is key to making something amazing. We will treat it as a living document. We will update it when we learn something important.

We are not in a rush. We are building something that deserves care.

**Ready when you are.**

*Document owned by the CityWithLifeGrok project*