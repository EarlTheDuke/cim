# CityWithLifeGrok — Build Prompt Guide

**Goal:** Build our own high-quality version of the "SimCityClaude" autonomous town/economy simulation from Wes Roth's Opus 4.8 Ultra Code demo — but built properly by Grok from the ground up, with better architecture, deeper agentic behavior, and long-term extensibility.

**Reference Document:** `references/simcity-claude-reference.md` (read this first)

---

## How to Use This Guide

This file contains a phased series of prompts designed for iterative development with Grok Build.

**Recommended workflow:**
1. We first review this file together and decide on tech stack + overall architecture.
2. We agree on a development plan (which phases, order, scope per phase).
3. You paste the relevant phase prompt(s) to me when you're ready to start that phase.
4. We work the phase to completion (including tests/visual verification).
5. We move to the next phase.

Each phase prompt is self-contained enough that you can copy it directly (after updating the "Current State" section).

---

## Project Vision & Differentiators

**Inspiration:** Wes Roth's ~1-hour Ultra Code demo (40 residents, businesses with P&L/inventory/employees, working traffic lights, resource economy, GDP charts, 1000x speed control).

**Our Version (CityWithLifeGrok) should be:**

- More architecturally sound (not a one-hour vibe-coded prototype)
- True **agentic businesses** from relatively early on (businesses actually run by Grok making decisions)
- Richer resident simulation (needs, personality, goals, not just schedules)
- Excellent observability ("God Mode" tools to inspect any resident/business)
- Clean modular systems (easy to add new mechanics later)
- Persistent and resumable
- Visually clear + information-rich
- Built for long-term evolution (this is the foundation for a bigger project)

**Core Fantasy:** A living city where you can zoom out and watch an economy run itself, or zoom in and watch individual residents and businesses make real decisions.

---

## Recommended Tech Approach (Discussion Point)

We should decide this together before starting Phase 0.

**Option A (Fastest visual feedback):** Single-file or minimal HTML + Canvas + vanilla JS/TS  
**Option B (Recommended for quality):** Vite + TypeScript + Canvas (or PixiJS)  
**Option C (Maximum power):** Vite + React + TypeScript + Canvas/WebGL

**Strong recommendation from Grok:** Start with **Option B** (Vite + TypeScript + HTML Canvas).  
Reasons:
- Excellent balance of development speed and maintainability
- Strong typing helps with complex simulation state
- Easy to later extract systems into proper modules
- No heavy framework overhead for a simulation

We can add a lightweight UI library later only for the dashboard if needed.

---

## Development Principles (Apply to Every Phase)

- **Time is first-class.** The simulation should be driven by a clean tick/step system that can run at variable speeds.
- **Systems over objects.** Prefer a systems architecture (e.g., TimeSystem, MovementSystem, EconomySystem, BusinessSystem) over giant God classes.
- **Simulation state must be serializable.** Plan for save/load from day one.
- **Separation of concerns:** Simulation core must be completely independent from rendering/UI.
- **Determinism where possible** (or at least reproducible with seeds).
- **Make it observable.** Every important entity should be easily inspectable.
- **Build in layers.** Get something visible and running as early as possible, then deepen.

---

## Build Phases

### Phase 0: Project Setup & Architecture Foundation

**Goal:** Create a clean, professional project skeleton with the core simulation loop running (even if empty) and clear architecture decisions documented.

**Key Deliverables:**
- Initialized Vite + TypeScript project (or chosen stack)
- Clear folder structure (core/, systems/, entities/, rendering/, ui/, types/, etc.)
- A working `Simulation` class / engine with a basic game loop
- Time system that supports variable speed (including 1000x)
- Basic "step" / "tick" architecture
- A simple debug panel showing current simulation time and speed
- Architecture decision document (in the repo)

**Suggested Prompt (copy when ready):**

```
You are Grok Build helping me create CityWithLifeGrok.

Reference document: references/simcity-claude-reference.md

We are starting Phase 0: Project Setup & Architecture Foundation.

Current state: Fresh project folder.

Task:
1. Recommend final tech stack (I'm leaning toward Vite + TypeScript + Canvas) and get confirmation.
2. Initialize the project properly.
3. Create a clean, professional folder structure optimized for long-term simulation development.
4. Implement a core Simulation engine with:
   - A configurable tick/step loop
   - Support for variable simulation speed (1x, 10x, 100x, 1000x, pause)
   - Proper time tracking (simulated hours/days/weeks)
5. Build a minimal but clean debug UI that shows current simulation time and speed controls.
6. Document the high-level architecture in a ARCHITECTURE.md file (systems approach, separation of simulation vs rendering, entity design, etc.).
7. Make sure the simulation core is fully decoupled from rendering.

Do not build residents, businesses, or visuals yet. Just the foundation.

Ask me any clarifying questions about architecture preferences before writing significant code.
```

**Success Criteria:**
- I can run the project and see a working time system + speed controls
- Architecture doc exists and makes sense
- Code is clean and well-organized

---

### Phase 1: Residents System (Schedules & Basic Life)

**Goal:** Implement autonomous residents who follow daily schedules, go to work, and have basic state (hunger/energy/mood or similar simple needs).

**Key Deliverables:**
- Resident entity definition
- Daily schedule system (wake, work, return home, sleep, etc.)
- Hourly wage + Friday payday mechanics
- Basic need system (even if simple)
- Population manager that can spawn/maintain ~40 residents
- Ability to inspect individual residents

**Suggested Prompt:**

```
Reference: references/simcity-claude-reference.md (especially the Residents section)

We are now doing Phase 1: Residents System.

Current state: We have a working simulation core from Phase 0 with time and speed controls.

Build:
- A clean Resident type/entity
- A schedule system so residents follow realistic daily routines based on simulation time
- Basic "go to work" behavior (they should leave home and arrive at a workplace location)
- Hourly wage accrual + weekly payday (every simulated Friday)
- A simple needs/motivation layer (e.g. energy, hunger, or money need) that begins to influence behavior
- A PopulationManager or ResidentsSystem
- Inspector panel (or console commands) to view any resident's current state, schedule, location, money, etc.

Keep rendering minimal for now (simple dots or colored rectangles on a grid is fine). Focus on the simulation logic being correct and observable.

Prioritize clean architecture so this system can later be extended with personality, goals, and LLM-driven decisions.
```

---

### Phase 2: World, Locations & Basic Movement

**Goal:** Give residents actual places to go and a basic movement system.

**Key Deliverables:**
- Simple world map / grid or zone system (homes, workplaces, commercial areas)
- Pathfinding or simple movement between locations
- Residents actually travel to work and back
- Basic "at location" state

**Suggested Prompt:**

```
We are in Phase 2: World, Locations & Basic Movement.

Current state: Residents exist with schedules and wage logic, but they don't actually move yet.

Implement:
- A simple spatial model (grid, zones, or named locations is acceptable for now)
- Home and Work locations for residents
- A MovementSystem that moves residents between locations over simulated time
- Update resident schedules to include travel time
- Visual representation of movement (even crude)

Do not build roads/traffic lights yet — that comes in Phase 3.
Focus on making the daily "leave home → travel → work → travel home" loop feel real.
```

---

### Phase 3: Traffic System & Roads (with Traffic Lights)

**Goal:** Implement a proper traffic system with roads and working traffic lights, as seen in the reference demo.

**Key Deliverables:**
- Road network definition
- Vehicle entities (cars + trucks)
- Traffic light logic (with the test mode behavior described in the reference)
- Congestion behavior as vehicle count increases
- Integration with resident movement (residents use cars or walk?)

**Suggested Prompt:**

```
Reference: references/simcity-claude-reference.md — Traffic System section is critical.

Phase 3: Traffic System & Roads.

Current state: We have residents moving between locations, but no real traffic model.

Build a traffic system that includes:
- A road network (can start simple)
- Individual vehicles (start with ~20 cars + some trucks)
- Working traffic lights at intersections
- The "test mode" behavior where lights turn green if the intersection is clear
- Realistic stopping and congestion behavior
- Vehicles should feel like they belong to the economy (some are personal, some are freight)

Keep performance in mind. Make the traffic system a first-class simulation system.
```

---

### Phase 4: Businesses & Economy Foundation

**Goal:** Create independent businesses with P&L, inventory, employees, and basic economic activity (the heart of the original demo).

**Key Deliverables:**
- Business entity with P&L, inventory, employees
- Hiring from resident population
- Resource production / trading (ore, lumber, crops, oil, etc.)
- Wage payments from businesses to employees
- Basic economic flow that creates visible GDP movement

**Suggested Prompt:**

```
Reference: references/simcity-claude-reference.md — Businesses, Economy & Resources sections.

Phase 4: Businesses & Economy Foundation.

Current state: We have residents and some movement/traffic. No economy yet.

Create:
- A Business type with its own:
  - Profit & Loss tracking
  - Inventory system
  - Employees (linked to residents)
  - Operating costs and revenue
- At least 4–6 different business types or instances
- Resource categories (ore, lumber, crops, oil, etc.) that businesses produce, consume, or trade
- Money flowing from businesses → residents (wages) and between businesses
- A basic EconomySystem that tracks high-level metrics (GDP, total money in circulation, etc.)

At this stage businesses can follow simple rule-based behavior. True agentic behavior comes later.
```

---

### Phase 5: Visualization — Town View + Dashboard

**Goal:** Make the simulation visually understandable and satisfying to watch.

**Key Deliverables:**
- Main town/city view (Canvas) showing residents, vehicles, buildings, roads, traffic lights
- Separate dashboard panel with key economic numbers
- Basic camera controls (pan/zoom) or at least clear overview
- Visual differentiation between different entity types

**Suggested Prompt:**

```
Phase 5: Visualization Layer.

Current state: Strong simulation logic exists. Visuals are minimal or non-existent.

Build a proper dual-view interface:
1. Main Town View (Canvas) showing:
   - Roads and intersections
   - Buildings / business locations
   - Resident and vehicle movement
   - Traffic light states
2. Dashboard / Control panel showing:
   - Current simulation time + speed controls (reuse/enhance from Phase 0)
   - Key economic metrics
   - Population summary
   - Selected entity inspector

Prioritize clarity and information density over beauty at this stage. The goal is to be able to watch the simulation and understand what's happening.
```

---

### Phase 6: Charts, GDP, Speed Controls & Economic Visibility

**Goal:** Deliver the rich economic visualization that made the original demo impressive (charts, GDP, resource flows, etc.).

**Key Deliverables:**
- Multiple live-updating charts (pricing, production, inventory, money flow, GDP)
- Full speed control implementation (including 1000x)
- "Full guide" / simulation explanation panel (or tooltip system)
- Strong economic observability

**Suggested Prompt:**

```
Reference: references/simcity-claude-reference.md — Macro Tracking & Visualization + Simulation Controls sections.

Phase 6: Charts, Metrics & Economic Visibility.

Current state: We have a basic dashboard from Phase 5.

Add rich economic visualization:
- Live charts for the key metrics mentioned in the reference (pricing of goods, production, freight, inventory levels, money paid out, GDP)
- Make sure simulation speed controls are excellent (including very high speeds like 1000x)
- Add a "Simulation Guide" or help system that explains the current rules
- Improve the inspector so you can deeply examine any business's financials and any resident's situation

At the end of this phase, the simulation should feel like a real living economy that you can observe at multiple scales and speeds.
```

---

### Phase 7: Agentic Layer — LLM-Powered Businesses (The Big Differentiator)

**Goal:** Move beyond rule-based businesses to businesses that are actually run by Grok making decisions (the "step two" Wes mentioned wanting to do next).

**Key Deliverables:**
- Architecture for giving businesses access to LLM decision-making
- Basic decision loop for businesses (what to produce, pricing, hiring/firing, inventory strategy, etc.)
- Logging of business decisions and reasoning
- Ability to watch businesses behave differently from each other

**Suggested Prompt:**

```
This is the most important differentiator for our project.

Reference: references/simcity-claude-reference.md — "Planned / Discussed Future Extensions" and the section about adding LLM functionality to businesses.

Phase 7: Agentic Businesses.

Current state: Businesses exist with rule-based logic and full economic tracking.

Now introduce real agentic behavior:

- Design and implement a clean interface for businesses to make decisions using Grok (or other models later)
- Define the information a business "sees" (its own P&L, inventory, market prices, employee situation, etc.)
- Create decision categories (pricing, production targets, hiring, buying/selling resources, etc.)
- Implement a decision-making loop (can be periodic, e.g. every simulated day or when certain thresholds are hit)
- Add excellent logging so we can see *why* a business made a decision
- Start with 2–3 businesses being agentic while others remain rule-based for comparison

This phase will likely require careful prompt engineering and tool use design. Treat it as a major milestone.
```

---

### Phase 8: Persistence, Polish, God Tools & Emergent Behavior

**Goal:** Make the project production-ready as a foundation and add the final polish and observability features.

**Key Deliverables:**
- Save / Load system (full simulation state)
- Advanced God Mode tools (pause individual entities, inject events, edit values, etc.)
- Performance optimization if needed
- Better resident personality / goal systems (optional but powerful)
- Documentation and example scenarios
- A compelling "hello world" demo state

**Suggested Prompt:**

```
Phase 8: Persistence, Polish & God Mode.

Current state: We have a strong living simulation with agentic businesses.

Finalize the project as a solid foundation:

- Implement full save/load of the entire simulation state
- Build powerful "God Mode" / debugging tools (ability to inspect and influence anything)
- Add any missing polish from the original reference (full guide, nice speed controls, etc.)
- Create 1–2 interesting starting scenarios or "maps"
- Document how to extend the simulation with new systems
- Optional but encouraged: Give residents more personality and goal-driven behavior (even simple versions)

Make sure the project feels like something we can build on for months or years.
```

---

## Additional Prompt Templates

### Architecture Review Prompt (use anytime)

```
Review the current architecture of CityWithLifeGrok against the principles in build-guides/city-with-life-build-prompts.md.

Highlight any violations of separation of concerns, simulation/rendering coupling, or maintainability issues. Suggest concrete refactors.
```

### Feature Addition Prompt Template

```
We want to add [new feature, e.g. "crime", "housing market", "weather", "government"] to CityWithLifeGrok.

Current phase: [X]

Read the relevant parts of build-guides/city-with-life-build-prompts.md and references/simcity-claude-reference.md.

Propose where this feature should live architecturally and give me a phased implementation plan before writing code.
```

---

## Next Steps After This Document

Once you're happy with this file:

1. We should have a short discussion about tech stack (Phase 0).
2. I will help you create a concrete **development plan** (which phases in what order, estimated complexity, any parallel work).
3. We can then begin Phase 0.

---

**Document Status:** Ready for review and planning.

*Created for CityWithLifeGrok — Grok Build*