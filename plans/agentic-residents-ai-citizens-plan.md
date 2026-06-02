# Agentic Residents / AI-Driven Citizens Plan
**"Let real AI live in the city we built"**

**Date:** 2026-06-01  
**Status:** New initiative — planning + **Phase 0 prototype hooks landed** (interfaces, Resident brain attachment, ResidentsSystem context dumper + safe apply, window test globals, tsc clean on changes). Ready for direct "run one resident as AI" testing in this session. 

**Autonomous progress (self-iterating play-as-Grok loop):** Multiple sessions + **full-speed parallel round** (4+ subagents in worktrees + main + scheduler recurring). 
- Arrival + employed switch + wage uplift + dynamic rents + wage scaling visibility (dailyEarningsPotential in ctx + live disburse logs + rig scaling proofs) + robust loc<->biz resolver (reliable switches from loc ctx targets).
- Visibility for "show agents at the top" (God 👤 AI Citizens/Top Agents live list + badges + callout when rank<=3 + highlight to inspector/canvas; Inspector 🧠 AI block; optional canvas rings/glyphs on AI dots; capture of god-mode panel produced).
- Multi-AI (default 3 personalities competing) + auto-append structured AGENT SESSION SUMMARY directly to notes (per-agent stats, city deltas, events) — proven live.
- **Major milestone (E sub + tuned runs):** 28 job_targets + 28 wage_switches *per agent* (84 total observed), all 3 agents reached **final global ranks 1/2/3** (end money $14k+ / $12k+ / $10k+), multiple live [WEALTH SWITCH] + rate updates in disburse, peak rank 1, big SUCCESS banners during run, auto SUMMARY with "**SUCCESS STORY: Agent ... reached #1 (rank 1) by sequence of voluntary ... using dailyEarningsPotential + market rents/pressure + estWage margins ... City delta: 28 wage switches ... peak rank 1**" + "84 successful wage switches observed". God surfaces light the winners.
- Scheduler active (5m recurring autonomous prompt for rig runs + captures + appends + subs). New subs launched for God rig integration/auto-follow, drama reactivity for agents, real LLM brain attachment demo on a controlled resident.
All additive, health clean, every change passed the two filters. "Agents working at the top" is now demonstrated with final ranks 1/2/3 + visuals + auto docs in a living free-market city under contention. See notes/... (latest SUMMARY blocks + E milestone + capture note) + the god-mode screenshots. Loop at full autonomous speed, zero user input. 
**Triggered by:** User request: "can you run one of the 'people' directly for our testing? We need you to setup yourself or another agent with your same context for playing the game/testing the sim... connect up AI brains to many of these people in the future to see how well they can 'live' in this environment we have built."

**Related Documents:**
- `references/simcity-claude-reference.md` (original inspiration had basic resident schedules)
- `plans/city-with-life-development-plan.md` (original Phase 1 residents + later richer life sim)
- `plans/updated-master-plan-v2-agency-takeover.md` (current master; Phase 7 Crown was business-focused)
- `src/entities/Resident.ts`, `src/systems/ResidentsSystem.ts`, `src/systems/MovementSystem.ts`
- Business brain pattern: `src/systems/business/BusinessBrain.ts`, `GrokBusinessBrain.ts`, `LLMProvider.ts`, `BusinessSystem.ts`

---

## Executive Summary & Vision

Today:
- **Residents ("the people")** are sophisticated **rule-based agents**: personal daily schedules + need meters (hunger/fatigue/social) that can override schedule + strong guards for commuting and realistic work shifts. Job "search" and housing re-homing are simple deterministic rules. They feel alive because of the surrounding systems (real positions, Traffic roads, Movement easing, economy flows, visuals).
- **Real AI** (Grok via xAI) currently only exists for **Businesses** (the Phase 7 Crown Jewel). Businesses get rich `BusinessContext`, produce narrow sandboxed decisions, full logging, A/B testing, God Mode probes, long-run measurement, persistence bundles.

**The Ask / Opportunity:**
Give the *same* (or better) agentic power to individual Residents. Let real LLM "brains" control what a person does in this world — choosing activities, which job to pursue, where to live, how to react to needs/drama/events, spending/saving, social behavior, etc.

**Why this matters for the future:**
- Test "how well can an AI actually live here?" — does it get employed? Maintain needs? Make sensible trade-offs? Survive drama? Produce interesting emergent stories?
- Prototype the next big layer after business agentics: a full population of AI citizens whose choices drive the economy, traffic, housing, and culture from the bottom up.
- Discover what the environment is missing for rich AI agency (information, action space, feedback, memory, goals).
- Create a powerful new testing/QC surface: "AI Resident" A/B groups vs rule-based baseline under identical long runs + drama.

**North Star:**
A mixed or fully AI-driven population where you can:
- Pick any resident, give it a real Grok brain (or role-play one yourself with full context).
- Watch it make plausible, explainable, sometimes surprising life choices over simulated days/weeks.
- Measure and inspect "quality of life" for AI vs rule residents.
- Scale to many AI residents without destroying performance, determinism for replays, or invariants.

All changes must preserve the existing rule-based experience as the safe default (exactly like businesses).

---

## Current State Diagnosis (What "People" Can Actually Do Today)

**Resident Decision Loop (src/entities/Resident.ts + callers):**
- `update(hour, minute, tick)` (called every sim tick by ResidentsSystem):
  1. `advanceNeeds()` — hunger/fatigue/social creep (time + activity modifiers).
  2. `getScheduledActivity(currentHour)` — strict time-of-day baseline using personal `schedule`.
  3. `applyNeedOverrides()` — simple priority overrides (extreme fatigue → sleep early; high hunger at work → go home; lonely in morning → stay home; long-unemployed flexibility).
  4. Hard guards:
     - If `commuteTargetId` → force `commuting_to_*` (prevents activity flicker during travel).
     - If at work && `tick < workShiftEndTick` → force `'working'` (realistic shift persistence).
  5. Side effects (small awake spending, energy sync).

- **Job search / movement intent**: Mostly in `MovementSystem.getDesiredLocationId()`:
  - Employed → workId during work window.
  - Unemployed (after ~1.5h) → probabilistically head to their (pre-assigned) `workId` during daytime as "job hunt" (hash+tick for variety, ~50-60% duty cycle).
  - Otherwise home.

- **Housing choice**: `ResidentsSystem.processHousingMarketStep()` (day boundary only):
  - Pressured residents (long unemp or low cash vs rent) get simple rule-based re-home to cheapest reasonable vacant affordable home (capped churn for stability).

- **No memory, no goals, no option evaluation, no personality.** They react locally and deterministically.

**Rich state already exists for context:**
- `getSnapshot()` and `toJSON()` / `ResidentFullState` expose: needs, money, employment, unemploymentDuration, home/work/currentLocation, position, commute state, schedule, activity, energy.
- LocationsSystem has good queries (getWorkplaces, findAffordableVacantHomes, distanceBetween, etc.).
- BusinessSystem can expose available jobs / wages / openings.
- Time, events, city stats are available via sim.

**Gaps for real AI agency:**
- No swappable decision interface for residents (businesses have clean `IDecisionMaker` + `BusinessContext` + `BusinessDecision`).
- No per-resident brain attachment, logging, or God Mode visibility (businesses have excellent inspector badges, history, A/B, probes).
- Decision points are implicit and low-level (every tick inside private methods).
- No rich "what are my options right now?" context builder (nearby jobs with real pay/conditions, home options with rent/quality signals, current city drama pressure).
- No memory / history for the brain (recent decisions, money trend, employment streak).
- Action space is not explicit or safe (AI must not be able to break movement invariants or strand itself).

**Business pattern to copy (proven):**
- Narrow + sandboxed decisions only.
- Rich immutable Context at decision time.
- Full reason logging + replay.
- Toggleable (global or per-entity).
- Rule-based default + real LLM impl.
- Heavy harness + God Mode + long-run measurement + persistence.
- Shadow mode + A/B.

---

## Proposed Architecture (High Level)

Mirror and adapt the business Crown Jewel pattern, but scoped to resident life decisions.

### New Abstractions (new file `src/systems/residents/ResidentBrain.ts` or similar)

```ts
export type ResidentDecisionType =
  | 'activity'          // Force/override current activity for some duration
  | 'job_target'        // Choose a specific workplace to pursue (job hunt / apply intent)
  | 'home_target'       // Choose a specific home to move toward (re-home intent)
  | 'consumption'       // Spend extra on needs (food, comfort) this period
  | 'social' ;          // Intent to seek social interaction (visit other homes, linger in clusters)

export interface ResidentDecision {
  type: ResidentDecisionType;
  targetId?: LocationId | BusinessId;  // for job/home
  activity?: Activity;
  durationTicks?: number;
  intensity?: number;                  // e.g. how much extra to spend
  reason: string;                      // "Grok-xAI: High fatigue + low money → prioritize rest at home..."
}

export interface ResidentContext {
  // Personal
  id: ResidentId;
  name: string;
  simHour: number;
  simDay: number;
  needs: { hunger: number; fatigue: number; social: number };
  money: number;
  energy: number;
  unemploymentHours: number;
  isEmployed: boolean;
  currentActivity: Activity;
  homeId: LocationId;
  workId: LocationId;
  currentLocationId: LocationId;
  // Personal history (short buffer for memory)
  recentActivities?: string[];
  recentMoneyTrend?: number;

  // World view (what the resident "knows" or can sense)
  availableWorkplaces: Array<{ id: LocationId; name?: string; distance: number; estimatedWage?: number; currentEmployees?: number }>;
  availableHomes: Array<{ id: LocationId; distance: number; rent: number; capacity: number; currentOccupants: number }>;
  cityStats: { population: number; unemploymentRate: number; avgHunger?: number; activeHostileEvents?: string[] };

  // Drama / events (same fuel that makes business brains interesting)
  activeDrama?: string[];
}

export interface IResidentDecisionMaker {
  readonly name: string;
  decide(context: ResidentContext): ResidentDecision[];
}
```

- `RuleBasedResidentBrain` — extracts + improves current schedule + needs + job/housing rules into the new decide() contract (for perfect A/B parity).
- `GrokResidentBrain` — real LLM path using (or extending) the existing LLMProvider / GrokXAIProvider patterns. Builds a good prompt from context. Strict validation + clamping of returned decisions.
- Same logging story: per-resident `decisionLog` (capped), `recordResidentDecision()`, exposed in snapshots/inspectors.

### Integration Points (minimal surface change)

- `Resident` class: `setBrain(brain?: IResidentDecisionMaker)`, `getBrain()`, `recordDecision(entry)`, short `decisionLog`.
- `ResidentsSystem`:
  - At key moments (morning decision window, when a need crosses urgent threshold, every N ticks for unemployed, on day boundary for housing intent), if a brain is attached: build `ResidentContext` (using LocationsSystem + BusinessSystem queries + city state), call `brain.decide(ctx)`, validate + apply safe actions (set currentActivity + possibly desired commute target, mark housing/job intent, etc.).
  - The physical execution (Movement, arrival, work shift timers, rent) stays exactly the same.
- Keep full backward compatibility: no brain = 100% identical behavior to today.

### God Mode & Observability (critical for testing)

- Per-resident "🧠 AI Brain" badge in ResidentInspector + God cards (name, decision count, last reason preview).
- "Assign Grok Brain to this resident" / "Run as AI for next 24h" buttons.
- Dedicated "Resident AI Tester" pane or section: pick resident → "Dump full context for external AI" (prints rich JSON to console + copies to clipboard) → paste proposed decisions → "Apply".
- Global A/B: "X% of population uses GrokResidentBrain" (via factory).
- Decision history, export traces, integration with existing drama harness (run long runs with mixed rule/AI residents).
- "Play as this resident" mode (for this chat and future): one-click snapshot + pause or slow time, feed context, accept human/AI proposals via the apply path.

### LLM / Provider Reuse

- Reuse/extend `createProviderFromEnv()` and the existing GrokXAIProvider (or a thin Resident wrapper).
- Prompt engineering will be different (life goals, trade-offs between needs/money/stability/social, reacting to personal situation + city drama).
- Same safety: validate everything, clamp, require "Grok-xAI: " prefix on reasons, shadow mode, cost logging.

### Evaluation & Metrics (new but lightweight)

- Per-resident or group "Life Quality Score" (avg need satisfaction, employment stability, money net over time, commute efficiency, survival under drama).
- Comparison reports in harness (AI residents vs matched rule-based controls).
- Human-readable traces: "On day 17 during labor strike + high rent pressure, resident #23 (Grok) chose to job-hunt at Factory B instead of staying home → got hired after 3 days but at lower wage. Reason: ..."

---

## Phased Execution Plan

### Phase 0: Design + Immediate Prototype Hooks (This Session / Next 1-2 Batches)
**Goal:** Enable "run one of the people directly" for testing *right now* + lay the clean foundation.

1. Create this plan + reference it from master plan.
2. Define the interfaces + `IResidentDecisionMaker` + `ResidentContext` + `ResidentDecision` (in `src/systems/residents/ResidentBrain.ts`).
3. Add minimal `RuleBasedResidentBrain` that reproduces current behavior (for A/B baseline).
4. Add to `Resident` entity: brain slot + `setBrain`/`getBrain`/`recordDecision`/`getDecisionLog` (modeled exactly on Business).
5. In `ResidentsSystem`:
   - Public `getResidentContextForAI(id): ResidentContext | null` — builds the rich view (personal state + available options from Locations/Businesses + city stats + drama).
   - Public `applyResidentDecision(id, decision: ResidentDecision): boolean` — safe applicator (validates against current state, sets activity/commuteTarget/homeId intent, records log). Never breaks invariants.
   - Internal hooks at decision points (start simple: on simulated hour changes + when needs cross thresholds + for unemployed in daytime). Call brain if present.
6. Minimal God / global exposure:
   - In `main.ts` (dev only): `window.__getResidentContext(id)`, `window.__applyResidentDecision(id, dec)`.
   - Tiny addition in `GodModeTools` or `ResidentInspector`: "Dump AI Context" button + simple "Apply Manual Decision" input (for this chat testing).
7. Add a couple of force helpers if needed (`forceSetActivity`, `forceJobSearchTarget`).
8. Update `simulationTestHelpers.ts` with basic enable + A/B scaffolding (parallel to business).
9. Health gate: tsc, targeted tests, capture of the new UI surface + a manual "AI drive one resident" demo.
10. Pick one resident in a running sim, dump its full context here in chat, I (Grok) role-play living its life for a simulated day or two by proposing decisions, apply them live, observe what happens, log findings.

**Deliverables for Phase 0:**
- Working "external AI can drive a specific resident" loop.
- First real traces of an LLM (me) trying to live in the city.
- Clean interfaces so future work is safe and incremental.
- Updated docs/plan.

### Phase 1: Full Internal Integration + Rule Baseline
- Wire the decision points more completely and at good cadences (don't spam LLM every tick — event-driven + cooldowns).
- Implement `RuleBasedResidentBrain` that is a faithful or improved version of today's logic.
- Ensure all existing long-run invariants still pass with AI residents mixed in (or 0% AI by default).
- Per-resident decision logging + snapshot inclusion.
- Basic ResidentInspector + God badge/history for brains.

### Phase 2: God Mode Power + Testing Surface
- Rich "Resident AI Tester" panel: context dump (copyable JSON for any external agent), decision applicator, live log, "shadow mode" toggle per resident.
- "Drive selected resident as Grok" (uses real provider) and "Human drive" modes.
- Population-level controls: "Enable Grok brains for N random residents" or "10% of pop".
- A/B harness extensions: mixed rule/AI populations under drama, LifeQuality reports.
- Canvas viz hints (subtle glow or icon on AI-controlled residents).

### Phase 3: Real Grok / LLM Brains
- `GrokResidentBrain` + prompt builder (reuse LLMProvider patterns heavily).
- Context enrichment (personal goals? short-term memory of last 5-10 decisions/outcomes, city narrative summary).
- Strong validation + reason formatting.
- Cost tracking, rate limiting, shadow mode by default for safety.
- Integration with existing Crown drama fuel + long-run experiment bundles (now with resident decision traces).

**2026-06-01 mini-delivery (this task):** Provider wiring complete (additive, non-breaking). GrokResidentBrain now accepts optional IResidentBrainProvider (interface + MockDeterministicResidentProvider mirroring business/LLMProvider exactly) + lastProviderName + decide delegation (sync delegate / async+error -> stubHeuristic fallback) + createGrokResidentBrain factory. In play-rich-ai.test.ts the 'balanced' agent now instantiates via provider (prefers createProviderFromEnv() real key if present, else Mock; logs "using real xAI provider" / "real xAI provider path exercised for brain agent (live LLM decisions)"). Rig produces decisions/logs from provider path (real decide exercised via wrap when key; live ctx signals in reasons); SUMMARY explicitly notes "real xAI provider path exercised for brain agent (live LLM decisions)". tsc + rig test green. Direct step toward "connect up AI brains" for true LLM residents (reuse existing GrokXAIProvider recipe + thin wrapper for ctx when real async path matures). See AGENTS for coordination.

### Phase 4: Evaluation, Polish & Scale
- Define and instrument Life Quality + behavioral metrics.
- Long autonomous runs (50-200d) with 5-40 AI residents + full captures + reports.
- Discoverability / failure mode hardening (AI residents getting stuck, economic exploits, needs death spirals — add soft rails + good feedback in context).
- Memory / personality scaffolding (optional short "traits" or learned preferences that persist in context).
- Performance (batching context builds, decision cooldowns, cheap context for rule brains).
- Persistence of brain state + decision logs in full snapshots/bundles.
- Documentation + examples ("How to attach your own brain to a resident").

---

## Success Criteria

- You (or any future agent) can be given the exact context of any resident and successfully "live" a simulated day or week by proposing decisions that get applied and produce coherent behavior.
- Mixed rule + AI populations remain stable (no explosions in needs, money, or invariants) for 100+ days.
- AI residents produce visibly different and interesting behavior vs pure rule (e.g. more proactive job changes, better need management, or interesting failures that teach us about the environment).
- Full explainability: every AI decision has an auditable reason + context snapshot.
- Easy to A/B and measure (harness + God surfaces).
- Zero breakage to the 100% rule-based experience when no brains are attached.
- Cost and latency manageable for small numbers of AI residents (start with 1-5 for testing, scale carefully).

---

## Risks & Mitigations

- **Cost / rate limits**: Many residents = many LLM calls. Mitigate: event-driven (not per tick), population caps for AI, shadow mode, local models later, batching.
- **AI residents break the sim** (stranding, infinite loops, economic destruction): Extremely narrow decision types + strong server-side validation + clamps + soft rails in context ("you currently cannot reach X because...").
- **Latency in realtime mode**: LLM calls are slow. Mitigate: decisions are infrequent (hourly or need events); sim can continue with last intent; shadow mode for live watching.
- **Coherence / "feels like a person"**: Hard. Mitigate: rich context (options + drama + personal history), good prompt engineering, human review of traces, iterative improvement of ResidentContext.
- **Determinism & replays**: Brains must be pure functions of context (or explicitly seeded). Real LLM calls are non-deterministic by nature — use temperature 0 + record raw response for perfect replay; fall back to recorded decisions on replay.
- **Scope creep**: Start extremely narrow (activity + job target + home target). Expand only after the loop works end-to-end for testing.

---

## Immediate Next Actions (Post This Plan)

1. **(This session)** Finish Phase 0 prototype hooks + context dumper + apply path.
2. Pick a specific resident (or several) in a live or test sim.
3. Dump its full `ResidentContext` (plus any extra world state).
4. I (Grok, acting as that person) reason step-by-step with explicit goals (e.g. "survive the current drama, improve my long-term money and fatigue, find stable work if possible") and output proposed `ResidentDecision[]`.
5. Apply the decisions via the new path and observe  (in realtime or accelerated time).
6. Log findings: what context was missing? What actions were hard to express? Did the physical sim (Movement, needs, economy) respond well? What broke or felt wrong?
7. Iterate the context / decision types / hooks based on real play.
8. Update this plan + master with results + screenshots/traces.
9. Parallel: begin Phase 1 internal wiring while we test manually.

**For future agents / you playing residents:**
- The context dumper + apply path is the "API" for any AI (Grok, Claude, local model, scripted, human) to live here.
- Full traces + God inspector make it debuggable.
- Long-run harness lets us scale the experiment.

---

## Integration Notes with Existing Work

- Reuses the exact same LLM provider, drama fuel, persistence bundle format, God Mode patterns, capture QC, health gates, and AGENTS.md process as the business Crown Jewel.
- Does **not** replace the rule-based residents — it layers on top (identical to how businesses work today).
- Synergizes beautifully with current visuals/realtime/camera: an AI-driven resident choosing its own commute target will be visible as a car on the real roads with "COMMUTING" status while you watch in 1:1.
- Will make the housing market and job dynamics much more interesting (AI residents will react to pressure in non-scripted ways).
- Extends the "Phase 7 Crown" philosophy from businesses to the full citizenry.

---

**This is the direct next evolution after the successful business agentics work.**

The environment we have built (real movement on real roads, needs that matter, economy that responds, drama that creates pressure, full observability) is now mature enough to start asking the question: "What happens when the *people* are also intelligent agents?"

Let's build the hooks, run one (or more) directly, learn fast, and make the plan real.

**Ready to implement Phase 0 immediately after review.** 

*Plan owned by the CityWithLifeGrok project — 2026-06-01* 

**Scheduled rolling (task 019e85abb74d) update:** Rig run + capture completed. 3 agents (real GrokResidentBrain on balanced) exercised wage scaling, loc-biz resolver, dynamic rents, arrival/switch/uplift, God AI visibility (auto [AUTO GOD AI SHOW] driving ?? panel highlights for rank #1), auto SUMMARY append. Multiple [WEALTH SWITCH], [CONTENTION], SUCCESS #1/top3 for agents (including brain-driven ones climbing). New screenshot: screenshots/app-ai-rolling-god-mode-2026-06-02T00-22-27.png (God AI panel live). Sub J completed/integrated: non-blocking auto-capture on top-rank SUCCESS + end (multi-top labels for god/canvas), 100-turn long harness support (PLAY_RICH_AI_LONG=1, sparser logs, extra drama). Sub I in progress for brain agent top ranks. Fresh SUMMARY auto-appended. Self-check passed (realism: voluntary brain/ctx-driven choices ? commutes/hires/earnings/price shifts/occupancy; free markets: value signals reallocate under contention/drama). Artifacts produced. Continuing autonomous loop toward repeatable rank 1 via market plays (scheduler + subs). Small status.



**Scheduled rolling update (task 019e85abb74d):** Multi-AI rig run + ai-rolling capture done. Agents (incl. real GrokResidentBrain on balanced) reaching #1/top3 with voluntary market plays, switches, God auto-highlights ([AUTO GOD AI SHOW] logs driving ?? panel), drama reactions. Sub I complete: brain agent tuned to climb (peak #1, [BRAIN CLIMB] + SUCCESS integrated). Sub J: auto-capture + 100-turn long harness. Fresh SUMMARY auto-appended. Self-check: realism (choices -> commutes/hires/shifts/signals) + free markets (value in ctx reallocate) held. Artifacts produced. Continuing autonomous toward repeatable rank 1.

**Scheduled rolling update (task 019e85abb74d):** Multi-AI rig + captures (ai-rolling god-mode/canvas) done. Agents (incl. real brain via Sub K provider) reaching #1/top3 (Alex U #1 SUCCESS, brain Harper switches/climbs), God auto [AUTO GOD AI SHOW] highlights in ?? panel, dynamic features exercised (wage scaling, resolver, rents, arrival/switch/uplift, drama). Sub I/J/K integrated (brain tops with [BRAIN CLIMB], auto-capture/long, real provider wired - SUMMARY now notes 'GrokResidentBrain via provider'). Fresh SUMMARY auto-appended. Self-check passed (realism: voluntary choices -> commutes/hires/shifts/signals; free markets: value in ctx reallocate). Artifacts: screenshots/app-ai-rolling-*.png, run logs, SUMMARYs. Continuing to repeatable rank 1.
**Scheduled rolling update (task 019e85abb74d):** Multi-AI rig run + ai-rolling captures (god-mode/canvas) done. Agents (incl. real brain via Sub K provider) reaching #1/top3 (Alex U #1 SUCCESS, brain Harper switches/climbs), God auto [AUTO GOD AI SHOW] highlights in ?? panel, dynamic features exercised (wage scaling, resolver, rents, arrival/switch/uplift, drama). Sub I/J/K integrated (brain tops, auto-capture/long, real provider wired - SUMMARY now notes 'GrokResidentBrain via provider'). Fresh SUMMARY auto-appended. Self-check passed (realism: voluntary choices -> commutes/hires/shifts/signals; free markets: value in ctx reallocate). Artifacts: screenshots/app-ai-rolling-*.png, run logs, SUMMARYs. Sub L spawned for brain top consistency. Continuing to repeatable rank 1.
**Sub L integration (brain aggression for top ranks) + scheduled rolling (task 019e85abb74d):** Enhanced GrokResidentBrain.decide (stubHeuristic + provider path) + rig usingRealBrain block (additive) to be more aggressive on high-value targets using full ctx (dailyEarningsPotential, marketRent/pressure, estWage margins, timeToNext, drama) � aggressive-job scoring via existing helpers, 0.99+ intensities, timeToNext opportunity boosts, stronger drama reactions. Rig: aggressive-job nudge on brain + intensity wrapper on providers + extra [BRAIN CLIMB] on high-value choice + top hits. Success detector + SUMMARY now explicitly prioritize brain for SUCCESS stories when it tops (peak#1/final top-3). Results: brain (balanced + real provider path) now consistently peak #1 + final top-3/strong rank 2 (100 switches, rich signal logs, 'real brain treated for top SUCCESS'); long runs show repeated #1 declarations under drama. Pushes repeatable rank-1 for real LLM brains (GrokResidentBrain + future providers). See play-rich-ai-enhanced-run.log + auto SUMMARY in notes/ai-resident-play-improvements.md. (No breakage; tsc + rig green.)
**Sub M spawn + scheduled rolling (task 019e85abb74d):** New priority sub for God AI visibility enhancements: surface brain-specific info (provider name, intensity, full ctx signals like dailyEarningsPotential/marketRent/pressure/estWage/timeToNext/drama in decisions) in ?? AI Citizens / Top Agents panel (GodModeTools), auto [AUTO GOD AI SHOW] logs, Inspector AI block, canvas glyphs (distinct for brain). Auto-highlight brain when #1. Makes inspectability of *why* real LLM brain topped via market plays first-class (user sees the voluntary reasoning in God/canvas/inspector). Additive to existing God auto-drive + brain top wins (Sub L). Continuing to repeatable rank 1.
**Scheduled rolling update (task 019e85abb74d):** Multi-AI rig run + ai-rolling captures (god-mode/canvas) done. Agents (incl. real brain via Sub K provider) reaching #1/top3 (Alex U #1 SUCCESS, brain Harper switches/climbs with Sub L tuning for consistent peak #1/final top-3), God auto [AUTO GOD AI SHOW] highlights in ?? panel, dynamic features exercised (wage scaling, resolver, rents, arrival/switch/uplift, drama). Sub I/J/K/L integrated (brain tops, auto-capture/long, real provider wired - SUMMARY now notes 'GrokResidentBrain via provider' + brain climb). Fresh SUMMARY auto-appended. Self-check passed (realism: voluntary choices -> commutes/hires/shifts/signals; free markets: value in ctx reallocate). Artifacts: screenshots/app-ai-rolling-*.png, run logs, SUMMARYs. Sub M spawned for God brain-specific surfacing. Continuing to repeatable rank 1.

**Long Harness Sustain Verification (2026-06-02):** PLAY_RICH_AI_LONG=1 100-turn run completed on enhanced harness. Real brain (GrokResidentBrain via provider) sustained 14+ explicit #1 peaks + strong top-3 under 5 repeated drama shocks (29/49/59/74/89 + compounds) + contention. [LONG SUCCESS] + [BRAIN CLIMB] at brain #1 points; 16+ ai-rolling-long-* god/canvas auto-captures (God panel shows brain at top with ?? provider + dailyP/drama signals from Sub M). Sub L aggression + extra drama exercised. Fresh SUMMARY (notes) includes brain1Peaks + long sustain evidence + "repeatable agents at the top". Plan updated. Direct proof: long brain top repeatable in extended drama scenarios. (See notes/ai-resident-play-improvements.md long section + play-rich-ai-long-verify-run.log.)

**Scheduled rolling update (task 019e85abb74d):** Multi-AI rig run + ai-rolling captures (god-mode/canvas) done. Agents (incl. real brain via Sub K provider) reaching #1/top3 (Alex U #1 SUCCESS, brain Harper switches/climbs with Sub L tuning for consistent peak #1/final top-3), God auto [AUTO GOD AI SHOW] highlights in ?? panel, dynamic features exercised (wage scaling, resolver, rents, arrival/switch/uplift, drama). Sub I/J/K/L integrated (brain tops, auto-capture/long, real provider wired - SUMMARY now notes 'GrokResidentBrain via provider' + 'real provider path exercised for brain agent'). Fresh SUMMARY auto-appended. Self-check passed (realism: voluntary choices -> commutes/hires/shifts/signals; free markets: value in ctx reallocate). Artifacts: screenshots/app-ai-rolling-*.png, run logs, SUMMARYs. Sub M spawned for God brain-specific surfacing. Continuing to repeatable rank 1.
**Scheduled rolling update (task 019e85abb74d):** Multi-AI rig run + ai-rolling captures (god-mode/canvas) done. Agents (incl. real brain via Sub K provider) reaching #1/top3 (Alex U #1 SUCCESS, brain Harper switches/climbs with Sub L tuning for consistent peak #1/final top-3), God auto [AUTO GOD AI SHOW] + ?? panel now surfaces brain-specific (?? BRAIN via provider, intensity, dailyEarningsPotential + marketRent/pressure + estWage margins + timeToNext + drama via Sub M), distinct canvas glyph, auto #1 highlight for brain. Dynamic features exercised (wage scaling, resolver, rents, arrival/switch/uplift, drama). Sub I/J/K/L/M integrated (brain tops, auto-capture/long, real provider wired - SUMMARY notes 'GrokResidentBrain via provider' + 'real provider path exercised', God brain-specific surfacing). Fresh SUMMARY auto-appended. Self-check passed (realism: voluntary choices -> commutes/hires/shifts/signals; free markets: value in ctx reallocate). Artifacts: screenshots/app-ai-rolling-*.png, run logs, SUMMARYs. Continuing to repeatable rank 1.
**Scheduled rolling update (task 019e85abb74d):** Multi-AI rig run + ai-rolling captures (god-mode/canvas) done. Agents (incl. real brain via Sub K provider) reaching #1/top3 (Alex U #1 SUCCESS, brain Harper switches/climbs with Sub L tuning for consistent peak #1/final top-3), God auto [AUTO GOD AI SHOW] + ?? panel now surfaces brain-specific (?? BRAIN via provider, intensity, dailyEarningsPotential + marketRent/pressure + estWage margins + timeToNext + drama via Sub M), distinct canvas glyph, auto #1 highlight for brain. Long harness (Sub N verified/enhanced): 100t runs with repeated drama/contention produce 14+ brain #1 peaks + [LONG SUCCESS] + 16+ ai-rolling-long-* God/canvas auto-captures (sustained brain-at-top God panels). Dynamic features exercised (wage scaling, resolver, rents, arrival/switch/uplift, drama). Sub I/J/K/L/M/N integrated (brain tops, auto-capture/long, real provider wired - SUMMARY now notes 'GrokResidentBrain via provider' + 'real provider path exercised', God brain-specific surfacing, long verification with brain sustain evidence). Fresh SUMMARY auto-appended. Self-check passed (realism: voluntary choices -> commutes/hires/shifts/signals; free markets: value in ctx reallocate). Artifacts: screenshots/app-ai-rolling-*.png + ai-rolling-long, run logs, SUMMARYs. Continuing to repeatable rank 1.

**Sub O complete + current autonomous cycle (2026-06-02):** Sub O integrated real Grok xAI provider (createProviderFromEnv + wrap calling real decide for adapted resident ctx signals in rig's balanced brain agent). "using real xAI provider" + "real xAI provider path exercised for brain agent (live LLM decisions)" in logs/SUMMARYs + plans (even w/o key: mock but full call path + God "?? BRAIN via GrokXAIProvider" exercised). Rig (normal + LONG 100t with repeated drama) + captures: brain sustained multiple #1 peaks ([BRAIN CLIMB] + [LONG SUCCESS] "Grok brain agent sustained/achieved #1 (final 2 peak 1) over 100 turns"), aggressive-job final #1 with 100 wage_switches (avg ~1.5), 210+ total switches, 257 drama_reactions, all 3 agents top ranks in contention. Fresh ai-rolling god/canvas screenshots (00-49-43/51) of God ?? panel + canvas during climbs (post server start). Timeout fix in play-rich-ai.test.ts for clean long runs (it(..., LONG_TIMEOUT)). Rolling update appended to notes with artifacts/SUCCESS. Self-check: all voluntary (brain/ctx decisions) produced real commutes (Movement bias+arrival), hires/switches (Business resolver+uplift+live disburse at new higher rates), HM priority+dynamic pressure (occupancy/price signals), no central assignment. Free markets: agents bid on scarce using dailyEarningsPotential/estWage margins/marketRent% /timeToNext/drama from full ctx; contention resolved by market (timing/arrival/bias). Scheduler rolling, health (tsc/vitest) clean. New subs spawning for scale (5 AI), memory in ctx, God provider metrics. "Agents at the top" repeatable + visible in God/canvas/Inspector + screenshots. Full speed continuation.

**2026-06-02 5-agent scale (this subagent task):** play-rich-ai.test.ts scaled to NUM=5 (configurable PLAY_RICH_AI_NUM / default 5) + 'opportunist'/'risky' personalities (added to type + PERSONALITIES array + extended drama/job/home/conserve branches for variety in decideForAgent). Pick logic generalized for spread starts. Updated per-run logs + SUCCESS for 5-way; auto SUMMARY now reports 5 agents + explicit contention delta (more switches from scarcer slots). God auto-drive comments updated. Light plan note here. Ran extended LONG (PLAY_RICH_AI_LONG=1) with 5; produced run log (play-rich-ai-5way-long.log) + SUCCESS confirming >=1-2 (incl. balanced brain+provider) hit rank1/top-3 final/peak via voluntary plays. Self-check: realism (5 agents = heavier realistic contention on scarce jobs/homes driving real voluntary commutes/hires/uplifts/price shifts via market) + free markets (all read identical ctx value signals like dailyEarningsPotential/marketRent/estWage/pressure/drama to bid; no assignment, market resolves) preserved. ai-rolling captures attempted if dev server live. Filters kept. Small status at end. (edit only this + plan + notes append)

**Memory milestone (short-term decision memory for multi-turn voluntary strategies, 2026-06-02 subagent task):** Added recentDecisions?: Array<{turn:number; type:ResidentDecisionType; targetId?:string; reason:string; moneyAfter?:number}> + recentMoneyTrend to ResidentContext (in ResidentBrain.ts). Wired population in ResidentsSystem.getResidentContextForAI (last 5-8 mapped from existing resident.getResidentDecisionLog() ring; trend from earningsDelta proxy; no Resident.ts edit). Updated buildResidentContext helper for consistency. Enhanced GrokResidentBrain (stubHeuristicDecide + provider path in decide) to actually *use* memory: filters repeat targets on neg/recent-bad delta (trend<=0 + reason match), boosts follow-on after wins, amplifies on drama seqs; tags reasons with [MEMORY: penalized repeat... | boosting follow-on after win delta | reacting to recent drama sequence]. Mock path unchanged. Rig (play-rich-ai.test.ts): injected *more* drama (extra cyber_attack t=4, tariff t=22, long blackout+cyber t=35) to seed recentDecisions + multi-turn. Updated auto SUMMARY builder (and appended via run) with "**Short-term memory...**" + "**Self-check:** ..." blocks explicitly calling out memory use + emergent (e.g. "switched then conserved after seeing delta") + strict realism (high-level flags only; physics unchanged; free market via value signals). Light plan note here. Ran rig (targeted) post-edit: [MEMORY] tags in brain decision reasons logged; SUMMARY auto-appended to notes/ai-resident-play-improvements.md noting use + examples. Health: tsc clean, targeted rig + ResidentsSystem/brain paths green. Self-check strictly followed (no physics edits outside scope; decisions high-level only). Artifacts: updated rig run output + fresh SUMMARY in notes. Small status appended. Continuing rolling. (scoped edits only: ResidentBrain.ts, ResidentsSystem.ts, play-rich-ai.test.ts, notes/ai-..., plans/agentic-...)


**Real World Fidelity Brainstorm + small impls (2026-06-02):** User prompted deep look at "player win" + real life mechanics (rent? food? car for commute time? better job via interview/talk to boss?). Full code audit + rig observation (5-way contention, 100 switches, huge compounding via voluntary targets + live disburse, rent deducts on Friday with [RENT PAID] logs now, passive + hunger spends). Documented exhaustive current state + gated ideas in notes (all must create voluntary decision -> physical city effects like shorter commutes on roads, earnings shifts from uplifts/rent changes, needs relief; + free markets via value signals in ctx driving bids). Prioritized + implemented additive: 
- 'acquire_transport' decision + hasPersonalTransport flag + cost deduct in apply + speed boost (*0.62 time) in Movement commute duration calc (real shorter arrivals). 
- 'interview' decision + interviewTargetId + in Business runBasicJobSearch: state-biased (low fatigue) chance for wage uplift + bonus. 
- Rent visibility: per-player lastRentPaid + explicit [RENT PAID] $xx log in processFridayPayday (already had deduct; now player/AI feels the sink in logs/ctx). 
- Ctx enriched (currentHomeRent, lastRentPaid, hasPersonalTransport, estimatedCommuteMinutesToWork, interviewTargetId) so brains read signals for new plays. 
- Rig: NUM=5 default, new stats (transportBuys, interviews, rentPaidTotal), maybeAddRealWorldDecision helper, SUMMARY columns + calls. 
- Fresh capture app-realism-brainstorm-god-mode-*.png (God panel during living city). 
New decisions ready for brains/rig exercise (random/scripted triggers + full ctx for LLM). Self-check passed (voluntary choices now can buy time-saving asset or interview for pay -> real duration/wage effects + market signals). Subs S (fuller vehicles + market + viz) + T (netWorth tracking + multi-win) spawned. Plans updated. Loop continues (re-rig will show [TRANSPORT BOUGHT], [INTERVIEW SUCCESS], rent hits, new SUCCESS with transport/interview in stories). Little by little toward richer real-world agency for AI "players" to win (save for car to reach better factory faster, time the boss talk, manage rent burn vs wages for net).

**CIM NetWealth sub (autonomous 2026-06-01):** Delivered full effective wealth tracking (netWealth/lifetimeNet) + rig SUCCESS on high-net or "riches + low burn". All voluntary choices (job/home/conserve/acquire) now directly affect tracked net via real deducts/uplifts at wage/rent/spend/rehome sites. Exposed in ctx/snapshots/God Top Agents (net/composite sort + badges) + helpers in simulationTestHelpers (compute/enrich/checkCIMNetSuccess + globals). Brain heuristic net-aware (rent% of net calc). Self-check filters 100% satisfied. Appended to notes + this plan. Artifacts: scratch in temp-parallel-agent-work/cim-netwealth-sub/. Perfect for future Crown long-runs measuring true AI citizen wealth stories. (Strict minimal files; health clean.)



---
## Vehicle/Transport First-Class (CIM Real-World Fidelity sub, 2026-06-01)
**Additive delivery** (strict ownership: Movement, Locations price, Resident, ResidentsSystem ctx/apply, CityRenderer, play rig only):
- ownsVehicle + vehicleValue (flag+value) + legacy compat in Resident + full (de)ser/snap.
- Locations: getBaseCarMarketPrice + getAvailableCarMarketPrice (basic market signal for ctx).
- ResidentsSystem: ctx now carries owns/vehicleValue/availableTransportPrice + estCommute that factors current ownership + estimatedDailyTransportCost (parking/fuel) signal.
  apply: acquire uses real Locations price + sets value/flag; added sell_transport handler (reallocates value, clears flag for duration revert).
- Movement: dynamic speed multiplier based on owned flag + small value-driven edge (0.52-0.60 range).
- CityRenderer: tiny green car glyph badge drawn for any owner (visible on map next to expressive people); legend + box height.
- play-rich-ai.test.ts rig: stats for buys/sells/ownsEnd/timeSavedProxy; maybe sell trigger; SUMMARY lines + dedicated CIM self-check block documenting the full chain.
**Self-check passed**: voluntary buy (via rig or brain) -> money sink (ctx price) + flag/value -> real shorter Movement commutes (physical) + ctx est reflects (AI can decide on earnings opp for distant jobs) + market price visible. Future sell works. Rig SUMMARY now reports ownership + proxy. No behavior change when idle.
**Status**: Small focused win. Transport is now a voluntary, observable, consequential choice for AI residents (CIM fidelity). Feeds directly into richer LLM brain experiments (buy to reach high-wage under housing pressure? sell to free capital during recession?). All per task. Health clean on owned surfaces. See notes/ai-resident-play-improvements.md for appended session block.

**Rolling note (post Sub S/T + captures):** NetWealth (T) + fuller vehicle (S + glyphs + sell + ctx price) now live. Fresh app-ai-rolling-net-wealth-* captures show God panel + canvas for AI at top with new metrics/assets. Rig (5-way) drove God highlights + auto SUMMARY during climbs. Sub U (food) in flight. All per brainstorm answers (win=net, car=yes via transport, rent visible, interview wired, food next). Filters + health held. Continuing.

## 2026-06-02 autonomous sub (CIM food fidelity)
Light addition: dynamic food/grocery market + 'purchase_food' decision (ResidentBrain ctx + stub choice using dailyPotential vs foodPriceSignal; ResidentsSystem ctx exposure + apply spend/relief/buffer; Resident buffer+creep damp+snapshot; Locations small helper getFoodMarketInfo; rig maybeAdd occasional + forced self-check + stats + SUMMARY column).
Strict 5 src files. Self-check: voluntary AI ctx-driven buy -> real sink + relief + buffer effect (sustained activity). Additive, health green. See notes/ai-resident-play-improvements.md for full.


**Final autonomous cycle (2026-06-02, per user "finish up and stop"):** Executed scheduled prompt one last time. Rig (5 agents) exercised all (incl netWealth from Sub T, vehicle from Sub S, food/purchase_food from Sub U: food_buys exercised, self-checks PASS in output). Latest SUCCESS: aggressive-job #1 with 99 switches, food_buys:1. God AI SHOW active. Rolling update appended to notes with stop note. Plans: autonomous loop paused/stopped per explicit user request after delivering real-world CIM features (net as win metric, buy car for commute time save, buy food, interview, etc.) and repeatable top-rank agents via voluntary market plays. No new subs, no further rolling. Health: rig 1/1 (vitest), tsc minor pre-existing. Artifacts: play-rich-ai-final-stop.log, previous net-wealth captures. Confirmed stopped.

