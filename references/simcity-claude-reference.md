# SimCityClaude Reference
## Wes Roth's Opus 4.8 "Ultra Code" Town & Economy Simulation Demo

**Source Video:** [Claude Opus 4.8 Is Too Smart… and TOO HONEST](https://www.youtube.com/watch?v=F_6go08nHv4) by Wes Roth (May 2026)  
**Build Time:** Under 1 hour of work using Claude Opus 4.8 in "Ultra Code" mode  
**Purpose of this document:** Extracted reference of the simulation's design, features, and mechanics to serve as a high-quality starting point / inspiration for the CityWithLifeGrok project.

---

## Overview

Wes Roth used Anthropic's newly released **Claude Opus 4.8** with the **Ultra Code** (ultracode) effort setting in Claude Code to build a complete, running, autonomous town/economy simulation in a single extended session.

The result is a **SimCity-style agent-based simulation** featuring:
- Dozens of individual residents living daily lives
- A functioning traffic system
- Multiple independent businesses
- A full economy with resource trading, wages, and GDP tracking
- Real-time visualization and adjustable time controls

Wes repeatedly called the coherence and completeness achieved in under an hour "pretty dang impressive."

The demo was specifically intended to showcase the new **dynamic workflows** and **Ultra Code** capabilities (orchestrating many parallel sub-agents + reviewer agents with high autonomy and "honesty"/self-correction).

---

## Core Simulation Components

### Residents (≈40)
- Autonomous agents that follow **time-of-day schedules**
- They go to work at appropriate times
- Earn **hourly wages**
- Receive pay **every Friday**
- Live out daily routines within the simulated town

### Vehicles
- **20 cars**
- Multiple **trucks**
- Used for both personal movement and freight/logistics tied to the economy

### Traffic System
- Working **traffic lights** at intersections
- Cars obey the lights and stop appropriately
- Test mode behavior: lights turn green automatically if no other cars are nearby (for easier testing)
- Designed so that as car count increases, **realistic congestion and backups** emerge
- Road network implied (SimCity-style map view)

### Businesses (Multiple)
Each business operates as an independent economic actor with:
- Its own **Profit & Loss (P&L) sheet**
- **Inventory** tracking
- **Employees** (drawn from the resident population)
- Revenue and expense tracking
- Participation in resource trading

### Economy & Resources
- **Traded goods/resources** include:
  - Ore
  - Lumber
  - Crops
  - Oil
  - (Presumably others)
- Money circulates through wages, business transactions, and trade
- During generation, Claude proactively asked Wes: *"Do you want a closed economy, or money circulating?"* (showing deep holistic understanding of the requirements)
- Full economic activity tracking

### Macro Tracking & Visualization
- **GDP** tracking
- Charts for:
  - Pricing of goods
  - Production rates
  - Freight movement
  - Inventory levels across businesses
  - Money being paid out
- "Full guide" explaining how the simulation works (built into the UI)

---

## Simulation Controls & Features

- **Variable speed control**
  - Real-time / slow motion for observation
  - Up to **1000x** acceleration to watch long-term economic behavior quickly
- Live updating dashboard / charts (separate from the main town view)
- The entire system runs coherently with many interdependent systems (time → resident behavior → work → wages → business revenue → inventory → resource trading → etc.)

---

## Technical Characteristics Highlighted

- **High holistic coherence**: The model successfully integrated many complex, interdependent systems (agent schedules, economy rules, traffic physics, UI, data visualization) without major contradictions or broken pieces.
- **Rapid development via agentic workflows**: Built using Opus 4.8's new ability to spawn parallel sub-agents, have reviewer agents critique work, and iterate with high reliability.
- **"Too honest" behavior benefit**: Fewer unremarked bugs or overconfident claims during generation (relevant because complex simulations are full of hidden edge cases).
- **Extensibility designed in**: Wes explicitly discusses the next step — attaching actual **LLM agents** to run individual businesses so they can make decisions, compete, and evolve the economy autonomously.

---

## Planned / Discussed Future Extensions (from the video)

1. **LLM-driven businesses** — Give each business its own large language model "manager" that tries to out-compete the others.
2. **More complex traffic** — Full congestion effects once car count grows.
3. **Deeper economic modeling** — More resource types, supply chains, pricing dynamics.
4. **Resident needs and life simulation** — Beyond just work/wages (housing, consumption, etc.).

---

## Relevance to CityWithLifeGrok Project

This demo is an **excellent high-level target** and reference for what a compelling "living city" simulation looks like:

### Strong Elements to Replicate / Improve Upon
- **Time-driven resident behavior** (schedules, hourly wages, weekly pay)
- **Independent business entities** with real P&L and inventory
- **Integrated traffic system** (not just decoration)
- **Visible macro economy** (GDP, charts, resource flows) alongside micro agents
- **Speed controls** for both observation and long-term simulation
- **Clear visual + data views** (town map + economic dashboard)
- **Built-in explanation/guide**

### Opportunities for CityWithLifeGrok
- Use Grok's capabilities (instead of Claude) to generate and evolve the simulation
- Add true **agentic businesses** driven by models from the start (the "step two" Wes mentioned)
- Implement more sophisticated resident AI (goals, needs, personalities, decision-making)
- Better persistence and long-running simulation state
- Multiplayer or observer tools
- More emergent storytelling from the interactions

### Key Lesson from the Demo
The most impressive part was not any single feature — it was the **coherent integration** of many systems at once. Prioritize clean architecture that lets economy, movement, time, and agent behavior all influence each other naturally.

---

## Sources & Further Reading

- Primary Video: https://www.youtube.com/watch?v=F_6go08nHv4 (watch the first ~5-7 minutes for the full demo walkthrough)
- Wes Roth's Newsletter (detailed context on Ultra Code & dynamic workflows): https://natural20.beehiiv.com/p/claude-opus-4-8-is-here-and-anthropic-is-turning-claude-code-into-an-ai-engineering-team
- Wes Roth tweet about the build: https://x.com/WesRoth/status/2060092784506482868
- Related coverage and Japanese deep analysis: https://note.com/light_squid9820/n/nc7e02feaefd4

---

## Quick-Start Prompt Inspiration (for future replication)

A strong starting prompt style (inferred from the demo):

> "Build a complete browser-based SimCity-style autonomous town simulation with ~40 residents who follow daily schedules and go to work, 20 cars + trucks with a working traffic light system, and multiple businesses each having real P&L, inventory, and employees. Include resource trading (ore, lumber, crops, oil), GDP tracking, charts, adjustable simulation speed up to 1000x, and a full in-app guide. Make the whole economy run coherently with money circulation."

Add "Use ultra code / dynamic workflows" style instructions when using advanced coding interfaces.

---

*Document compiled for CityWithLifeGrok project — May 2026*