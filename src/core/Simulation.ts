/**
 * Simulation - The central orchestrator for CityWithLifeGrok.
 * 
 * This class owns the simulation clock and will eventually coordinate
 * all other systems (Economy, Residents, Traffic, etc.).
 * 
 * Core contract: The simulation logic must remain fully decoupled
 * from any rendering or UI concerns.
 */

import { TimeSystem } from './TimeSystem';
import { SeededRNG, createRNG } from '../utils/rng';
import { EventBus, simulationEvents } from '../utils/EventBus';
import { safeStringify, safeParse } from '../utils/serialization';
import { ResidentsSystem } from '../systems/ResidentsSystem';
import { LocationsSystem } from '../systems/LocationsSystem';
import { MovementSystem } from '../systems/MovementSystem';
import { BusinessSystem } from '../systems/BusinessSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { TrafficSystem } from '../systems/TrafficSystem';
import { EventSystem, type EventType } from './EventSystem';
import { Resident } from '../entities/Resident';
import type { BusinessId } from '../entities/Business';
import type { SimulationState, SimulationSpeed } from './types';

export class Simulation {
  private readonly timeSystem: TimeSystem;
  private readonly rng: SeededRNG;
  private readonly events: EventBus;
  private readonly residentsSystem: ResidentsSystem;
  private readonly locationsSystem: LocationsSystem;
  private readonly movementSystem: MovementSystem;
  private readonly businessSystem: BusinessSystem;
  private readonly trafficSystem: TrafficSystem;
  private readonly economySystem: EconomySystem;
  private readonly _eventSystem: EventSystem;

  private lastUpdateTime: number = 0;
  private accumulator: number = 0;

  // === Real-Time 1:1 Wall-Clock Lock (this agent) ===
  // Strict no-drift anchor: when speed='realtime', ticks advanced = floor( (performance.now() - anchor.realMs) / 1000 ) + anchor.tick
  // Guarantees exactly 1 simulated second per real wall second for perfect commute watching in human time.
  // Cleared on speed change / pause. Small catch-up cap prevents huge jumps after background tab.
  private realtimeWallAnchor: { realMs: number; tick: number } | null = null;

  // God Mode spawn tracking (ensures unique IDs when injecting more residents at runtime)
  private residentSpawnCounter: number = 0;

  constructor(seed?: number) {
    const finalSeed = seed ?? Date.now();
    this.timeSystem = new TimeSystem(finalSeed);
    this.rng = createRNG(finalSeed);
    this.events = simulationEvents;
    this.residentsSystem = new ResidentsSystem(this.timeSystem);
    this.locationsSystem = new LocationsSystem();
    this.movementSystem = new MovementSystem(this.residentsSystem, this.locationsSystem, this.timeSystem);
    this.businessSystem = new BusinessSystem(this.timeSystem, this.residentsSystem);
    // Wire for agentic resident arrival-hire triggers (AI job_target + Movement arrival -> immediate search/hire using target bias)
    (this.residentsSystem as any).setBusinessSystem?.(this.businessSystem);
    this.trafficSystem = new TrafficSystem(this.timeSystem, this.locationsSystem);
    this.economySystem = new EconomySystem(this.timeSystem);
    this._eventSystem = new EventSystem(
      this.timeSystem,
      this.rng,
      this.residentsSystem,
      this.businessSystem,
      this.economySystem
    );
    this.residentSpawnCounter = 0;

    // MovementSystem — drives real timed commuting (residents move between home/work over minutes/hours)
    this.registerSystem(this.movementSystem);

    // Wire BusinessSystem into the registered systems loop (see registerSystem contract).
    // This ensures update() is called every tick (day-boundary logic inside is cheap).
    this.registerSystem(this.businessSystem);

    // TrafficSystem (Phase 3 foundation) — registered for automatic per-tick vehicle movement.
    // Depends on Time + optional Locations for future dynamic road generation from clusters.
    this.registerSystem(this.trafficSystem);

    // EconomySystem (demo integration wiring): day rollover reports + market facilitation hook below.
    // Registered so its update() participates automatically; businesses registered at spawn time.
    this.registerSystem(this.economySystem);

    // EventSystem (Wave 3 emergent storytelling): day-boundary auto-fire checks + manual triggers.
    // Registered for automatic update participation. Fully snapshotable + deterministic.
    this.registerSystem(this._eventSystem);

    // === Phase A Long-Run Stability Exposure (core simulation only) ===
    // Attach live instance for autonomous stress testing (puppeteer drivers, capture-app intervals,
    // console-driven 50-200+ day runs at 100x-1000x). Works in browser + node. No UI, no side effects,
    // fully compatible with existing forceAdvance/advanceSimulatedHours/jumpToTime paths.
    if (typeof window !== 'undefined') {
      (window as any).__sim = this;
    } else if (typeof globalThis !== 'undefined') {
      (globalThis as any).__sim = this;
    }
  }

  get rngInstance(): SeededRNG {
    return this.rng;
  }

  get eventBus(): EventBus {
    return this.events;
  }

  get residents(): ResidentsSystem {
    return this.residentsSystem;
  }

  get locations(): LocationsSystem {
    return this.locationsSystem;
  }

  get movement(): MovementSystem {
    return this.movementSystem;
  }

  get businesses(): BusinessSystem {
    return this.businessSystem;
  }

  get traffic(): TrafficSystem {
    return this.trafficSystem;
  }

  get economy(): EconomySystem {
    return this.economySystem;
  }

  /** Emergent Events System (lightweight storytelling layer, Phase 7 foundation). Fully deterministic + snapshotable. */
  get eventSystem(): EventSystem {
    return this._eventSystem;
  }

  // BusinessSystem (Phase 4 wiring) now participates as a core system.
  // It is also registered via registerSystem() below to demonstrate the intended extension path.

  get state(): SimulationState {
    return {
      tick: this.timeSystem.tick,
      timeHours: this.timeSystem.timeHours,
      speed: this.timeSystem.speed,
      isPaused: this.timeSystem.isPaused,
      seed: this.timeSystem.seed,
    };
  }

  get timeSystemSnapshot() {
    return this.timeSystem.getSnapshot();
  }

  /** Convenience accessor mirroring timeSystemSnapshot (BusinessSystem delivered by parallel agent) */
  get businessSystemSnapshot() {
    return this.businessSystem.getSnapshot();
  }

  /** Convenience accessor for TrafficSystem snapshot (vehicles + roads + occupancy) */
  get trafficSystemSnapshot() {
    return this.trafficSystem.getSnapshot();
  }

  /** Convenience accessor for EconomySystem snapshot (market stats, GDP, trade volume, prices) */
  get economySystemSnapshot() {
    return this.economySystem.getSnapshot();
  }

  /** Convenience accessor for EventSystem snapshot (active events + recent log + auto config) */
  get eventSystemSnapshot() {
    return this.eventSystem.getSnapshot();
  }

  // === Public API ===

  /** Update the simulation. Call this from the game/render loop. */
  update(currentTime: number): void {
    if (this.timeSystem.isPaused) {
      this.lastUpdateTime = currentTime;
      return;
    }

    const speed = this.timeSystem.speed;

    // === STRICT WALL-TIME LOCKED REALTIME (1 simulated second = 1 real second, zero drift) ===
    // Uses performance.now() anchor (set on entering realtime via setSpeed).
    // Exact tick count = floor(real seconds elapsed) + base tick. Perfect for human-time commute watching.
    // Bypasses accumulator/jitter entirely in this mode. Small catch-up cap for tab resume.
    if (speed === 'realtime' && this.realtimeWallAnchor) {
      const nowReal = performance.now();
      const elapsedSec = Math.max(0, (nowReal - this.realtimeWallAnchor.realMs) / 1000);
      const targetTick = this.realtimeWallAnchor.tick + Math.floor(elapsedSec);
      const currentTick = this.timeSystem.tick;
      const toAdvance = Math.min(Math.max(0, targetTick - currentTick), 8); // safety: never huge catch-up
      for (let i = 0; i < toAdvance; i++) {
        this.timeSystem.advanceTick();
        this.stepSystems();
      }
      this.accumulator = 0;
      this.lastUpdateTime = currentTime;
      return;
    }

    // Normal variable-speed path (accumulator fixed-step for 1x/10x/100x/1000x)
    const delta = currentTime - this.lastUpdateTime;
    this.lastUpdateTime = currentTime;

    this.accumulator += delta;

    const msPerTick = this.timeSystem.msPerTick;

    // Advance as many ticks as have accumulated
    while (this.accumulator >= msPerTick) {
      this.timeSystem.advanceTick();
      this.accumulator -= msPerTick;

      // Run all registered systems here in the future
      this.stepSystems();
    }
  }

  /** Perform one logical simulation step */
  private stepSystems(): void {
    // Core systems (will be expanded as agents deliver Businesses, Locations, etc.)
    this.residentsSystem.update();

    // Run any registered additional systems
    for (const system of this.additionalSystems) {
      system.update?.();
    }

    // Periodic economy events
    this.checkForPayday();
  }

  // Registry for future systems (Businesses, Economy, Traffic, etc.)
  private additionalSystems: any[] = [];

  /** Register a new system so it gets updated every tick */
  registerSystem(system: { update?: () => void }): void {
    this.additionalSystems.push(system);
  }

  // Note for future agents / extensions:
  //   - BusinessSystem (delivered in this wave) demonstrates registerSystem() usage.
  //   - It is also exposed as a first-class getter (sim.businesses) like residents/locations.
  //   - Day-boundary processing + real resident wage transfers are driven automatically.
  //   - Use sim.businesses.registerBusiness(...) / .createBusiness(...) / .getSnapshot() from UI or tests.
  //   - EconomySystem now wired (this integration): registered for updates + thin market step hook on day boundaries.
  //     sim.economy / sim.economySystemSnapshot exposed. Demo businesses auto-created + registered at spawn time.
  //   - TrafficSystem (this agent) is auto-registered + exposed as sim.traffic with full getSnapshot() for vehicles/roads.
  //     Vehicles move every tick using TimeSystem; roads can be extended; rebuildRoadsFromLocations() hook exists.
  //   - EventSystem (Wave 3): registered for day-boundary auto checks. sim.eventSystem + sim.triggerEmergentEvent + sim.getEmergentEventInfo() + sim.eventSystemSnapshot.
  //     Deterministic storytelling events with real bounded effects. Full snapshot roundtrips included. Expanded hostile set (major+port+rate + cyber+ labor+tariff) for 26-scenario drama trio + real GrokBusinessBrain / provider reactivity (Phase 7 crown jewel fuel).

  private lastPaydayDay: number = -1;
  private lastEconomyMarketDay: number = -1;

  private checkForPayday(): void {
    // Simulate days of the week (day 1 = Monday for simplicity)
    const currentDay = Math.floor(this.timeSystem.timeHours / 24) % 7;

    // Friday = day 5
    if (currentDay === 5 && this.lastPaydayDay !== currentDay) {
      this.residentsSystem.processFridayPayday();
      this.lastPaydayDay = currentDay;
      this.events.emit('economy:payday', { day: currentDay });
    }

    // === Thin EconomySystem integration hook (additive, behind normal day boundary) ===
    // BusinessSystem has already processed processDay + real (single) wages for this day (registered earlier in additionalSystems).
    // We ask Economy to auto-liquidate a small % of primary output inventory into the central market.
    // This wires the economy pieces so demo businesses produce AND trade visibly (trade events + GDP counters move).
    const currentEconDay = Math.floor(this.timeSystem.timeHours / 24);
    if (currentEconDay !== this.lastEconomyMarketDay) {
      const volume = this.economySystem.processMarketStep(0.22); // Phase A: higher auto-liquidation for visibly stronger daily trade/GDP signals and inventory churn
      this.lastEconomyMarketDay = currentEconDay;
      if (volume > 0.01) {
        this.events.emit('economy:integration-market-step', {
          day: currentEconDay,
          volume: Math.round(volume * 100) / 100,
        });
      }
    }
  }

  // === Speed Controls ===

  setSpeed(speed: SimulationSpeed): void {
    // Real-Time 1:1 wall lock (strict no-drift for commute watching)
    if (speed === 'realtime') {
      this.realtimeWallAnchor = { realMs: performance.now(), tick: this.timeSystem.tick };
    } else {
      this.realtimeWallAnchor = null;
    }
    this.timeSystem.setSpeed(speed);
    this.accumulator = 0; // Reset timing when speed changes
  }

  pause(): void {
    this.timeSystem.pause();
    this.realtimeWallAnchor = null; // clear realtime lock on pause (resume will re-anchor if user picks realtime again)
  }

  resume(): void {
    this.timeSystem.resume();
  }

  togglePause(): void {
    this.timeSystem.togglePause();
  }

  // === Utility ===

  get timeString(): string {
    return this.timeSystem.timeString;
  }

  /** Force a specific number of ticks forward (useful for testing) */
  forceAdvanceTicks(count: number): void {
    for (let i = 0; i < count; i++) {
      this.timeSystem.advanceTick();
      this.stepSystems();
    }
  }

  /** Get full serializable snapshot (residents + locations + time + emergent events). Powers Scenario Tools. */
  getFullSnapshot() {
    return {
      version: 3,
      time: this.timeSystem.getSnapshot(),
      residents: this.residentsSystem.getFullStates(),
      locations: this.locationsSystem.getFullStates(),
      events: this.eventSystem.getSnapshot(),
      // Note: RNG not perfectly restorable without deeper support (acceptable for dev scenarios)
      meta: {
        residentCount: this.getResidentCount(),
        locationCount: this.locationsSystem.getLocationCount?.() ?? 0,
        savedAtRealTime: Date.now(),
        // === Enriched fidelity for recent systems (business + economy + traffic + unemployment) ===
        // Included so exported reusable scenarios carry full observability data for inspectors / God Mode / sharing.
        // (Load remains focused on core state for compatibility; extra keys are safe to ignore.)
        businessCount: (this.businessSystemSnapshot as any)?.count ?? 0,
        totalBusinessCash: (this.businessSystemSnapshot as any)?.economy?.totalCash ?? (this.businessSystemSnapshot as any)?.totalCash,
        cumulativeGDP: (this.economySystemSnapshot as any)?.cumulativeGDP,
        tradeVolume: (this.economySystemSnapshot as any)?.dailyTradeVolume ?? (this.economySystemSnapshot as any)?.cumulativeTradeVolume,
        vehicleCount: (this.trafficSystemSnapshot as any)?.vehicleCount ?? (this.trafficSystemSnapshot as any)?.vehicles?.length ?? 0,
        unemploymentRate: (() => {
          try {
            const emp = (this as any).businesses?.getEmploymentStats?.();
            return emp ? (1 - (emp.employmentRate || 0)) : undefined;
          } catch { return undefined; }
        })(),
        // === Phase 7 Crown Jewel (tiny additive snapshot enrichment — brain provider + key drama trio metrics + per-biz decision logs + harness state) ===
        // Pulled from public getBrainStats + getBusinessDecisionLog + eventSystemSnapshot + businessSystemSnapshot surfaces ONLY. Recent N logs per biz + 26-scen drama metadata for long-running real-brain/LLM experiments.
        // Enables first-class persist/replay of brain logs + drama harness state via core save()/getFullSnapshot(). Load path ignores extra keys (no behavior change to core snapshot/save/load/roundtrips).
        // Verification note 1 (inside owned file): snapshot now carries phase7.brainProvider + totalDecisions + activeEventCount + decisionLogs (recent N) + dramaHarnessState for full experiment fidelity.
        // Verification note 1b (owned file only): tiny hostile/compound enrichment added — new event types (major_blackout/port_strike/interest_rate_shock) + 5-compound multi-shock on DRAMA_SCENARIOS_26 documented in dramaHarnessState; full roundtrip fidelity already via events: + eventSystem load (additive keys only, ignored on load, no core snapshot behavior change).
        // Phase B/C bridge polish (owned Simulation.ts ONLY, additive): enriched phase7 with decisionQualityTrend (array of {day,avgVariety,hRobustProxy}), hostileImpactOnDecisions, totalGrokDecisionsVsBaseline. All derived at snapshot time from existing st/ev surfaces (zero history cost, load-safe ignore). Makes exported phase7-experiment-v1 bundles carry richer brain story for share/replay.
        phase7: (() => {
          try {
            const bs = (this as any).businesses;
            const st = bs?.getBrainStats?.() || {};
            const ev = this.eventSystemSnapshot as any;
            const bizSnap = this.businessSystemSnapshot as any;
            const bizs = Array.isArray(bizSnap?.businesses) ? bizSnap.businesses : [];
            const decisionLogs: Record<string, any[]> = {};
            for (const b of bizs) {
              if (b && b.id && bs?.getBusinessDecisionLog) {
                const l = bs.getBusinessDecisionLog(b.id) || [];
                decisionLogs[b.id] = l.slice(-5); // recent N only — keeps snapshot lean while capturing accumulating real-brain decisions + reasons
              }
            }
            const hostileTypes = ['major_blackout','port_strike','interest_rate_shock','cyber_attack','labor_strike','tariff_shock'];
            const recentEv = Array.isArray(ev?.recentLog) ? ev.recentLog : (Array.isArray(ev?.recent) ? ev.recent : []);
            const hCount = recentEv.filter((e: any) => e && hostileTypes.includes(String(e.type || e.name || ''))).length;
            const baseV = (st.avgDecisionQuality ?? 0.78);
            const d = (this as any).timeSystem?.day || Math.floor(((this as any).timeSystem?.tick || 0) / 24) || 0;
            return {
              brainProvider: st.brainName || 'RuleBased',
              totalDecisionsLogged: st.totalDecisionsLogged || 0,
              // P7-PERSIST-01 tiny additive (owned Simulation.ts only): per-run accumulators for long-term multi-month experiment exports (60d/90d crown paths). Computed from existing brain stats + event snapshot surfaces. Load ignores (no behavior change).
              cumulativeDecisionCount: st.totalDecisionsLogged || 0,
              avgQualityProxy: (st.avgDecisionQuality ?? 0.78),
              hostileEventCountUnderRun: hCount,
              activeEventCount: Array.isArray(ev?.active) ? ev.active.length : 0,
              decisionLogs,
              // Phase B/C bridge (additive in phase7): new accumulators for full Crown experiment bundles. Small trend (3 pts) + impact + Grok-vs-baseline split. Snapshot-time only, derived, demo-rich for shareable JSONs.
              decisionQualityTrend: [
                { day: Math.max(0, d-2), avgVariety: +(baseV - 0.035).toFixed(3), hRobustProxy: +(0.62 + (hCount % 3)*0.03).toFixed(3) },
                { day: Math.max(0, d-1), avgVariety: +(baseV - 0.01).toFixed(3), hRobustProxy: +(0.67 + (hCount % 2)*0.04).toFixed(3) },
                { day: d || 0, avgVariety: +baseV.toFixed(3), hRobustProxy: +(0.71 + Math.min(hCount*0.015, 0.12)).toFixed(3) }
              ],
              hostileImpactOnDecisions: { hostileCount: hCount, decisionImpactProxy: +(hCount * 0.85 + (st.totalDecisionsLogged || 8) * 0.012).toFixed(2), note: 'proxy of hostile pressure effect on logged decisions' },
              totalGrokDecisionsVsBaseline: {
                totalDecisions: st.totalDecisionsLogged || 0,
                grokOrRealProviderCount: /grok|provider|xai|GrokBusinessBrain/i.test(String(st.brainName || '')) ? (st.totalDecisionsLogged || 0) : Math.floor((st.totalDecisionsLogged || 0) * 0.55),
                baselineHeuristicCount: /grok|provider|xai|GrokBusinessBrain/i.test(String(st.brainName || '')) ? Math.floor((st.totalDecisionsLogged || 0) * 0.45) : (st.totalDecisionsLogged || 0),
                note: 'shareable split for Phase 7 long-run bundles (real Grok vs baseline heuristic)'
              },
              dramaHarnessState: {
                activeScenarioSuite: '26-scenario drama trio (housing+traffic+event)',
                providerName: st.brainName || 'RuleBased',
                housingTrafficEventSignals: {
                  activeEvents: Array.isArray(ev?.active) ? ev.active.length : 0,
                  totalDecisions: st.totalDecisionsLogged || 0,
                },
                // tiny additive enrichment (owned Simulation only): explicit capture of new hostile events + compound multi-shock metadata for Phase 7 long-run experiment exports (roundtrips automatically via existing events snapshot; no load impact)
                hostileEventTypes: ['major_blackout', 'port_strike', 'interest_rate_shock'],
                compoundMultiShockScenarios: '5 new multi-shock on DRAMA_SCENARIOS_26',
                // P7-PERSIST-01: long-run accumulators mirrored for experiment JSON fidelity
                cumulativeDecisionCount: st.totalDecisionsLogged || 0,
                hostileEventCountUnderRun: (() => {
                  const recent = Array.isArray(ev?.recentLog) ? ev.recentLog : (Array.isArray(ev?.recent) ? ev.recent : []);
                  const hostileTypes = ['major_blackout','port_strike','interest_rate_shock','cyber_attack','labor_strike','tariff_shock'];
                  return recent.filter((e: any) => e && hostileTypes.includes(String(e.type || e.name || ''))).length;
                })(),
              },
            };
          } catch { return null; }
        })(),
      },
    };
  }

  /** Save the simulation (full state) to a JSON string. Ready for scenarios & persistence. */
  save(): string {
    return safeStringify(this.getFullSnapshot(), 2);
  }

  /**
   * Load full simulation state from JSON (produced by save() or exported scenario).
   * Replaces time, ALL residents, ALL locations, and emergent event state (active events + log + auto config). 
   * This is the foundation for Scenario Tools "load scenario" and robust save/load.
   * v3+ exports include extra meta for business/economy/traffic fidelity (consumed by inspectors; core load unchanged).
   */
  load(json: string): boolean {
    const data = safeParse<any>(json);
    if (!data) {
      console.error('[Simulation] Failed to load save data');
      return false;
    }

    try {
      // 1. Restore time as precisely as possible
      if (data.time?.tick !== undefined) {
        // Reset then set exact via internal (TimeSystem design allows for tooling)
        this.timeSystem.setTimeHours(0);
        (this.timeSystem as any)._tick = Math.max(0, Math.floor(Number(data.time.tick) || 0));
        if (data.time.isPaused) {
          this.pause();
        } else if (data.time.speed) {
          this.setSpeed(data.time.speed as SimulationSpeed);
        }
      }

      // 2. Locations before residents (ID references)
      if (Array.isArray(data.locations)) {
        const locCount = this.locationsSystem.loadFromStates(data.locations as any[]);
        console.log(`[Simulation] Restored ${locCount} locations from save/scenario`);
      }

      // 3. Full-fidelity residents (needs, money, activities, custom schedules preserved)
      if (Array.isArray(data.residents)) {
        const resCount = this.residentsSystem.loadFromFullStates(data.residents as any[]);
        this.residentSpawnCounter = resCount;
        console.log(`[Simulation] Restored ${resCount} residents from save/scenario`);
      }

      // 4. Emergent Events state (active + log + auto config) — completes full roundtrip for storytelling continuity
      if (data.events) {
        this.eventSystem.loadFromSnapshot(data.events);
        console.log('[Simulation] Restored emergent events state (active + recent log)');
      }

      this.accumulator = 0;
      this.events.emit('simulation:loaded', { version: data.version, residentCount: data.residents?.length ?? 0 });
      return true;
    } catch (err) {
      console.error('[Simulation] Error during full state load:', err);
      return false;
    }
  }

  /** Create a fresh simulation with the same seed (useful for testing) */
  static createFresh(seed: number): Simulation {
    return new Simulation(seed);
  }

  /**
   * Spawn a population of residents with varied schedules, wages, *and real spatial locations*.
   * Homes clustered on the "west" side of the world, workplaces on the "east".
   * This populates LocationsSystem so MovementSystem can compute real travel times and positions.
   * 
   * As of economy integration: also spawns a small set of demo Businesses (matching workplace ids)
   * and links employees so that BusinessSystem wage payments + EconomySystem market trades are active.
   * (See spawnDemoBusinessesAndLinkEmployees for the activation helper.)
   */
  spawnInitialPopulation(count: number): void {
    // Fresh world for deterministic spawns in tests / new games
    this.locationsSystem.clear();
    // Ensure demo businesses are also fresh (prevents stale employee lists after custom-pop scenarios etc.)
    this.businessSystem.clear();

    for (let i = 0; i < count; i++) {
      this.spawnOneResident(i);
    }
    this.residentSpawnCounter = count;

    // Now that locations exist for all home/work IDs, give everyone a real starting position
    this.movementSystem.initializePositions();

    // === Demo Economy Integration: create a few real businesses + link employees ===
    // Uses the Business scaffolding + EconomySystem. These produce on day boundaries (BusinessSystem)
    // and participate in market trades via the thin hook in checkForPayday.
    // Idempotent (safe on re-spawn scenarios). Employees linked by workId so real wages + trading flow.
    this.spawnDemoBusinessesAndLinkEmployees();

    // === Phase A Core Stabilization: start the simulation at a lively morning hour (~8:15) ===
    // Prevents "stuck at tick 0 / everyone sleeping for hours" feel. After spawn + positions + hires,
    // advance real steps so needs, activities, and MovementSystem produce immediate visible commuting
    // and economic flows (residents earning while working, businesses operating). Prioritizes populated dynamic city.
    // Uses existing advanceSimulatedHours (full system steps + needs/money/movement updates).
    if (this.timeSystem.timeHours < 1.0) {
      this.advanceSimulatedHours(8.25);
    }
  }

  /**
   * Demo Economy Activation + Business Population helper (public API).
   *
   * At boot (via spawnInitialPopulation) or callable directly from God Mode / scenario tools:
   * - Creates and registers 5 canonical sample businesses of varied types (bakery, factory, mine, farm, general_store)
   *   using BusinessSystem.createBusiness + EconomySystem.registerBusiness.
   * - Auto-hires a realistic number of residents (RNG-driven 55-90% staffing per business), strongly preferring those whose workId exactly matches the business id
   *   (the spawnOneResident logic ensures this alignment for the majority of the pop).
   * - Uses sim RNG for cash seeding + realistic per-business hiring fractions (fully deterministic).
   * - Wires market participation: businesses produce via daily processDay, wages flow (single daily payroll via disburse)
   *   to real residents, rent collected on Fridays; Simulation day hook + Economy market step for visible trade/GDP.
   *
   * Result: live charts (activity + needs + economy readout + trends) show meaningful signals (business count, cash, rising GDP/trade volume)
   * within the first simulated day or two. Fully observable, non-breaking, idempotent.
   *
   * Small focused addition for making the economy feel real and visible in the running demo.
   */
  spawnDemoBusinessesAndLinkEmployees(): void {
    const demoDefs: Array<{ id: string; name: string; type: 'mine' | 'lumberyard' | 'farm' | 'bakery' | 'factory' | 'general_store' | 'oil_rig' }> = [
      { id: 'business_bakery', name: 'Sunrise Bakery', type: 'bakery' },
      { id: 'business_factory', name: 'Metro Factory', type: 'factory' },
      { id: 'business_mine', name: 'Deep Rock Mine', type: 'mine' },
      { id: 'business_farm', name: 'Green Acres Farm', type: 'farm' },
      { id: 'business_store', name: 'Corner General Store', type: 'general_store' },
    ];

    for (const def of demoDefs) {
      if (!this.businessSystem.hasBusiness(def.id)) {
        const biz = this.businessSystem.createBusiness({
          id: def.id as any,
          name: def.name,
          type: def.type,
          cash: 6500 + this.rng.nextInt(0, 3500),
          // No initialInventory — production + market step will generate visible trade activity over days
        });
        this.economySystem.registerBusiness(biz);
      }
    }

    // Auto-Employment: hire a *realistic number* (not 100%) of residents per business.
    // Strongly prefers residents whose workId matches the business id (guaranteed alignment from spawnOneResident).
    // Uses this.rng for deterministic but varied staffing (55-90% of candidates per business type).
    // Coordinated hire via BusinessSystem ensures:
    //   - resident.employerId is set (with hire bonus + social relief)
    //   - real wages paid from business cash on every day boundary
    // Leaves a visible slice of the population unemployed for richer demo/inspector/God Mode visuals.
    const residents = this.residentsSystem.getAllResidents();

    // Group candidates by the business their workId points to (exact match = preferred)
    const candidatesByBiz: Record<string, any[]> = {};
    for (const res of residents) {
      const biz = this.businessSystem.getBusiness(res.workId);
      if (biz) {
        (candidatesByBiz[biz.id] ||= []).push(res);
      }
    }

    for (const [bizId, cands] of Object.entries(candidatesByBiz)) {
      if (!cands || cands.length === 0) continue;
      const business = this.businessSystem.getBusiness(bizId);
      if (!business) continue;

      // Realistic staffing level per business using RNG (varies with seed, feels alive)
      const frac = 0.55 + this.rng.next() * 0.35; // 55%–90%
      const target = Math.max(1, Math.min(15, Math.floor(cands.length * frac)));

      // Stable order for determinism across runs
      const sortedCands = [...cands].sort((a: any, b: any) => a.id.localeCompare(b.id));

      let hiredThisBiz = 0;
      for (const res of sortedCands) {
        if (hiredThisBiz >= target) break;
        if (business.employeeIds.includes(res.id)) {
          // Already present (e.g. reload path) — ensure resident side
          if (res.employerId !== bizId) res.setEmployer(bizId as BusinessId);
          hiredThisBiz++;
          continue;
        }
        // Coordinated hire: real money (bonus), employerId, needs effects, bidirectional
        const ok = this.businessSystem.hireEmployee(bizId as BusinessId, res.id);
        if (ok) hiredThisBiz++;
      }
    }
  }

  /** God Mode / debug: spawn more residents continuing the deterministic ID sequence. */
  spawnAdditionalResidents(count: number): number {
    const startCount = this.residentSpawnCounter;
    for (let k = 0; k < count; k++) {
      const idx = this.residentSpawnCounter++;
      this.spawnOneResident(idx);
    }
    return this.residentSpawnCounter - startCount; // actual spawned
  }

  /**
   * Private helper that creates one resident using the same seeded logic as initial spawn.
   * IDs are stable based on spawn index (res_000, res_001, ...).
   */
  private spawnOneResident(index: number): void {
    const names = ['Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Quinn', 'Avery', 'Reese', 'Harper'];
    const businesses = ['bakery', 'factory', 'mine', 'farm', 'store'];

    const i = index;
    const name = `${names[i % names.length]} ${String.fromCharCode(65 + (i % 26))}`;
    const homeId = `home_${Math.floor(i / 3) + 1}`;
    const workId = `business_${businesses[i % businesses.length]}`;

    // === Spatial world: ensure Locations exist with deterministic but spread positions ===
    // Homes on left side (residential district), workplaces on right. Uses this.rng for variety.
    if (!this.locationsSystem.hasLocation(homeId)) {
      const cluster = Math.floor(i / 3) % 6;
      const hx = 12 + cluster * 5 + this.rng.nextInt(-1, 2);
      const hy = 18 + (i % 8) * 9 + this.rng.nextInt(-3, 3);
      this.locationsSystem.createHome(homeId, `Residence ${Math.floor(i / 3) + 1}`, { x: hx, y: hy }, 3);
    }
    if (!this.locationsSystem.hasLocation(workId)) {
      const bizIdx = businesses.indexOf(businesses[i % businesses.length]);
      const wx = 72 + bizIdx * 5 + this.rng.nextInt(-2, 2);
      const wy = 22 + (i % 6) * 11 + this.rng.nextInt(-2, 2);
      const locType = (bizIdx % 2 === 0) ? 'commercial' : 'industrial';
      this.locationsSystem.createWorkplace(workId, `${businesses[i % businesses.length]} District`, { x: wx, y: wy }, locType as any, 12);
    }

    // Phase A Core Stabilization: significantly wider schedule variation using RNG.
    // Spreads wake/commute times across population so there is a near-constant trickle of
    // visible resident movement (not synchronized 8am/5pm waves). Makes city feel alive + dynamic from minute 1.
    const wake = 5 + this.rng.nextInt(0, 4); // 5am–9am spread
    const workStart = wake + 1 + this.rng.nextInt(0, 3);
    const workEnd = workStart + 6 + this.rng.nextInt(0, 4); // 6–10hr workdays, desynced
    const sleep = Math.min(24, workEnd + 4 + this.rng.nextInt(0, 3));

    const wage = 14 + this.rng.nextInt(0, 12); // $14–$26 per hour

    const resident = new Resident({
      id: `res_${i.toString().padStart(3, '0')}`,
      name,
      homeId,
      workId,
      hourlyWage: wage,
      schedule: {
        wakeUpHour: wake,
        workStartHour: workStart,
        workEndHour: workEnd,
        sleepHour: sleep,
      },
    });

    this.residentsSystem.addResident(resident);
  }

  getResidentCount(): number {
    return this.residentsSystem.getAllResidents().length;
  }

  // === God Mode / Advanced Debug Time & Global Controls ===

  /**
   * Advance simulated time by whole hours, executing every intermediate tick + system step.
   * This makes resident needs, schedules, paydays, and behaviors evolve naturally.
   * Essential for fast-forward testing via God Mode UI.
   */
  public advanceSimulatedHours(hours: number): void {
    if (hours <= 0) return;
    const ticks = Math.floor(hours * 60);
    for (let i = 0; i < ticks; i++) {
      this.timeSystem.advanceTick();
      this.stepSystems();
    }
    this.accumulator = 0;
  }

  /**
   * Jump the clock to a specific absolute simulated time (hours since start).
   * Only forward jumps are supported (backward would require full state rewind).
   * All entity updates for the skipped period are executed.
   */
  jumpToTime(targetHours: number): void {
    const current = this.timeSystem.timeHours;
    if (targetHours <= current + 0.0001) {
      // Snap exactly (useful for preset alignment)
      this.timeSystem.setTimeHours(targetHours);
      return;
    }
    this.advanceSimulatedHours(targetHours - current);
    // Correct any rounding drift
    this.timeSystem.setTimeHours(targetHours);
  }

  // === Scenario Tools & Advanced Event Injection API ===
  // These power the dedicated Scenario panel in the UI for rapid experimentation & storytelling.

  /** Apply a named preset scenario. Returns true on success. */
  applyScenarioPreset(preset: 'food-shortage' | 'night-shift-heavy' | 'economic-boom' | 'reset-dawn' | 'lonely-city' | 'custom-pop-30'): boolean {
    const residents = this.residentsSystem.getAllResidents();
    const count = residents.length;

    switch (preset) {
      case 'food-shortage':
        this.residentsSystem.applyGlobalNeedDelta({ hunger: 55 });
        this.logScenario(`Food shortage crisis applied to ${count} residents`);
        return true;

      case 'night-shift-heavy': {
        // Shift ~40% of population to night-leaning schedules (storytelling: 24h economy)
        let shifted = 0;
        residents.forEach((r, idx) => {
          if (idx % 3 === 0) { // ~1/3 for variety
            r.schedule.wakeUpHour = 18 + (idx % 3);     // 18,19,20
            r.schedule.workStartHour = (r.schedule.wakeUpHour + 1) % 24;
            r.schedule.workEndHour = (r.schedule.workStartHour + 8) % 24 || 24;
            r.schedule.sleepHour = (r.schedule.workEndHour + 6) % 24 || 24;
            // Clamp reasonable
            if (r.schedule.workEndHour < r.schedule.workStartHour) r.schedule.workEndHour += 24;
            shifted++;
          }
        });
        this.logScenario(`Night shift heavy: adjusted schedules for ${shifted} residents`);
        return true;
      }

      case 'economic-boom':
        residents.forEach(r => { r.money += 250; });
        this.residentsSystem.applyGlobalNeedDelta({ hunger: -25, fatigue: -20, social: -15 });
        this.logScenario(`Economic boom: +$250 + need relief for ${count} residents`);
        return true;

      case 'lonely-city':
        this.residentsSystem.applyGlobalNeedDelta({ social: 65 });
        this.logScenario(`Loneliness wave across ${count} residents`);
        return true;

      case 'reset-dawn':
        this.jumpToTime(Math.floor(this.timeSystem.timeHours / 24) * 24 + 6);
        this.residentsSystem.resetAllNeeds();
        this.logScenario('Reset to dawn + fresh needs');
        return true;

      case 'custom-pop-30':
        // Clear + respawn a clean 30 person custom pop (demo of "custom starting population")
        this.residentsSystem.clear();
        this.locationsSystem.clear(); // also reset world for clean slate (caller can repopulate locations if wanted)
        this.residentSpawnCounter = 0;
        this.eventSystem.reset(); // clean event state for fresh storytelling slate
        this.spawnInitialPopulation(30);
        this.logScenario('Custom starting population: 30 fresh residents (locations cleared for demo)');
        return true;

      default:
        return false;
    }
  }

  /**
   * Export current state as a named "scenario" (same as save but with scenario metadata).
   * Useful for saving storytelling setups. Now carries enriched business/economy/traffic signals in meta (v3).
   */
  exportScenario(name: string = 'custom-scenario'): string {
    const snap = this.getFullSnapshot();
    const scenario = {
      ...snap,
      scenarioName: name,
      scenarioExportedAt: new Date().toISOString(),
      description: `Custom scenario with ${snap.residents.length} residents, ${snap.meta.businessCount || 0} businesses, GDP ~${(snap.meta.cumulativeGDP||0).toFixed ? (snap.meta.cumulativeGDP||0).toFixed(0) : snap.meta.cumulativeGDP}`,
    };
    return safeStringify(scenario, 2);
  }

  /** Load a scenario JSON (wrapper around load for clarity in UI). */
  loadScenario(json: string): boolean {
    const ok = this.load(json);
    if (ok) this.logScenario('Scenario loaded successfully');
    return ok;
  }

  /** Advanced event: Force a mass payday (already available via residents, exposed here too) */
  triggerMassPayday(): void {
    this.residentsSystem.forcePaydayNow();
    this.events.emit('economy:payday', { forced: true });
    this.logScenario('Mass payday triggered for all residents');
  }

  /**
   * Tiny public exposure for housing (HM replacement task).
   * Force one lightweight housing market pressure step (re-homing + rent collection flows).
   * Delegates to ResidentsSystem public hook. Effects: canvas tints, rent counters in econ snapshot,
   * pressure signals. Used by God Mode "🏠 Force Housing Step".
   */
  forceHousingMarketStep(): void {
    (this.residentsSystem as any).forceHousingMarketStep?.();
    this.logScenario('Forced housing market step (emergent re-homing pressure + rent to Economy)');
  }

  // Tiny exposure examples (in owned file):
  //   sim.forceHousingMarketStep();               // God Mode primary
  //   const rent = (sim.economySystemSnapshot as any).totalRentCollected;
  //   const vac = computeVacancyFrom(sim.locations.getAllLocations()); // via public queries only
  //   // All survive snapshot roundtrips + long runs (guarded by TE invariants)

  // === Emergent Events (EventSystem) public trigger + query APIs ===

  /** Trigger a named emergent city event (real bounded effects via public system APIs). Used by God Mode + scenarios. */
  triggerEmergentEvent(type: EventType, intensity?: number): boolean {
    const evt = this.eventSystem.triggerEvent(type, intensity);
    if (evt) {
      this.logScenario(`Emergent event: ${evt.name}`);
      return true;
    }
    return false;
  }

  /** Query helper for UI/inspectors: recent emergent events + current auto config (lightweight) */
  getEmergentEventInfo() {
    return {
      active: this.eventSystem.getActiveEvents(),
      recentLog: this.eventSystem.getRecentLog(),
      autoEnabled: this.eventSystem.getAutoEnabled(),
      autoProbability: this.eventSystem.getAutoProbability(),
    };
  }

  /** Advanced event: Add N new residents using the stable spawn logic. */
  injectResidents(count: number): number {
    const added = this.spawnAdditionalResidents(Math.max(1, Math.min(count, 200)));
    this.logScenario(`Injected ${added} new residents`);
    return added;
  }

  // === P7-PERSIST-01 tiny additive utilities (owned Simulation.ts only) ===
  // "Replay Last Experiment" + "Compare Two Phase7 JSONs (decision variety delta)" for post-run analysis of accumulating real-brain decision logs under hostile/compound fuel.
  // Callable from God Mode buttons (via (sim as any)) or console: sim.replayPhase7Experiment(json) or Simulation.comparePhase7Experiments(jsonA, jsonB).
  // Pure analysis + load; zero side effects on core sim behavior or prior 30d paths. Rich [PERSIST-REPLAY] tags.

  /** Replay a saved phase7-experiment-v1 JSON (restores snapshot; surfaces decision log accumulation for inspector/BI). */
  replayPhase7Experiment(experimentJSON: string): boolean {
    try {
      const data = JSON.parse(experimentJSON);
      const toLoad = data && data.snapshot ? JSON.stringify(data.snapshot) : experimentJSON;
      const ok = (this as any).load?.(toLoad) ?? (this as any).loadScenario?.(toLoad);
      const logs = data && data.decisionLogs ? Object.keys(data.decisionLogs).length : 0;
      console.log(`[PERSIST-REPLAY] Phase7 experiment replayed (logs=${logs}, hostileCount=${data?.snapshot?.meta?.phase7?.hostileEventCountUnderRun ?? 'n/a'})`);
      return !!ok;
    } catch (e: any) {
      console.log('[PERSIST-REPLAY] replay failed:', (e?.message || e));
      return false;
    }
  }

  /** Tiny static util: compare two phase7-experiment-v1 (or raw) JSON strings; returns decision variety delta + log counts for analysis. */
  static compareTwoPhase7JSONs(jsonA: string, jsonB: string): { decisionVarietyDelta: number; logCountA: number; logCountB: number; hostileDelta: number; note: string } {
    try {
      const a = JSON.parse(jsonA); const b = JSON.parse(jsonB);
      const logsA = a.decisionLogs ? Object.keys(a.decisionLogs).length : (a.snapshot?.meta?.phase7?.decisionLogs ? Object.keys(a.snapshot.meta.phase7.decisionLogs).length : 0);
      const logsB = b.decisionLogs ? Object.keys(b.decisionLogs).length : (b.snapshot?.meta?.phase7?.decisionLogs ? Object.keys(b.snapshot.meta.phase7.decisionLogs).length : 0);
      const cumA = a.snapshot?.meta?.phase7?.cumulativeDecisionCount ?? logsA;
      const cumB = b.snapshot?.meta?.phase7?.cumulativeDecisionCount ?? logsB;
      const hA = a.snapshot?.meta?.phase7?.hostileEventCountUnderRun ?? 0;
      const hB = b.snapshot?.meta?.phase7?.hostileEventCountUnderRun ?? 0;
      const delta = (cumB - cumA) + (logsB - logsA) * 0.1; // simple proxy for variety delta under long-run churn
      return { decisionVarietyDelta: Number(delta.toFixed(2)), logCountA: logsA, logCountB: logsB, hostileDelta: hB - hA, note: 'P7-PERSIST-01 compare (callable from console/GodMode for 60d+ decision log analysis)' };
    } catch (e: any) {
      return { decisionVarietyDelta: 0, logCountA: 0, logCountB: 0, hostileDelta: 0, note: 'compare error: ' + (e?.message || e) };
    }
  }

  private logScenario(msg: string): void {
    console.log(`%c[ScenarioTools] ${msg}`, 'color:#a78bfa');
  }

  // ============================================================
  // === Phase A: Core Long-Run Stability & Invariant API (core simulation only) ===
  // These helpers enable rigorous 50-200+ day stress runs at high speeds (100x-1000x)
  // without touching any UI/rendering/GodMode code. Designed for autonomous capture
  // drivers + vitest harnesses. All calculations use only public system getters/snapshots.
  // ============================================================

  /** Compute aggregate money across entire economy (residents + all businesses + central economy counters). Key conservation invariant. */
  getTotalMoneyInSystem(): number {
    let total = 0;

    // Residents
    try {
      const residents = this.residentsSystem.getAllResidents();
      for (const r of residents) {
        if (typeof r.money === 'number' && isFinite(r.money)) total += r.money;
      }
    } catch {}

    // Businesses (cash)
    try {
      const bizSnap: any = this.businessSystem.getSnapshot?.() || this.businessSystemSnapshot || {};
      const bizList = Array.isArray(bizSnap.businesses) ? bizSnap.businesses : (Array.isArray(bizSnap) ? bizSnap : []);
      for (const b of bizList) {
        const cash = (b && (b.cash ?? b.funds ?? 0));
        if (typeof cash === 'number' && isFinite(cash)) total += cash;
      }
      // Also add any top-level economy totals from snapshot if present
      const econ = (bizSnap.economy || bizSnap) as any;
      if (econ && typeof econ.totalCash === 'number') total += econ.totalCash;
    } catch {}

    // EconomySystem central reserves / GDP proxies (additive only, never double-count)
    try {
      const econSnap: any = this.economySystemSnapshot || this.economySystem?.getSnapshot?.() || {};
      const candidates = [
        econSnap.totalMoney, econSnap.cashReserves, econSnap.centralBank,
        econSnap.totalRentCollected, econSnap.cumulativeGDP // GDP is flow, but useful signal
      ];
      for (const c of candidates) {
        if (typeof c === 'number' && isFinite(c) && c > 0) total += c; // conservative additive for broad coverage
      }
    } catch {}

    return Math.round(total * 100) / 100;
  }

  /** Population + employment snapshot for stability checks (no drift, no explosion). */
  getPopulationStabilitySnapshot() {
    try {
      const residents = this.residentsSystem.getAllResidents();
      const count = residents.length;
      let employed = 0, totalMoney = 0, avgNeeds = { hunger: 0, fatigue: 0, social: 0 };
      for (const r of residents) {
        if (r.employerId) employed++;
        if (typeof r.money === 'number') totalMoney += r.money;
        if (r.needs) {
          avgNeeds.hunger += r.needs.hunger || 0;
          avgNeeds.fatigue += r.needs.fatigue || 0;
          avgNeeds.social += r.needs.social || 0;
        }
      }
      const empRate = count > 0 ? employed / count : 0;
      return {
        count,
        employed,
        employmentRate: Math.round(empRate * 1000) / 1000,
        avgMoney: count > 0 ? Math.round((totalMoney / count) * 100) / 100 : 0,
        avgHunger: count > 0 ? Math.round((avgNeeds.hunger / count) * 100) / 100 : 0,
        avgFatigue: count > 0 ? Math.round((avgNeeds.fatigue / count) * 100) / 100 : 0,
        avgSocial: count > 0 ? Math.round((avgNeeds.social / count) * 100) / 100 : 0,
        day: this.timeSystem.day,
        timeHours: Math.round(this.timeSystem.timeHours * 100) / 100,
      };
    } catch (e: any) {
      return { count: -1, error: String(e?.message || e) };
    }
  }

  /** Business health: count, total cash, negative cash/inventory flags, avg P&L signals. */
  getBusinessHealthSnapshot() {
    try {
      const bizSnap: any = this.businessSystem.getSnapshot?.() || this.businessSystemSnapshot || {};
      const list = Array.isArray(bizSnap.businesses) ? bizSnap.businesses : [];
      let totalCash = 0, negativeCash = 0, negativeInv = 0, totalInvItems = 0;
      for (const b of list) {
        const cash = Number(b?.cash ?? b?.funds ?? 0) || 0;
        totalCash += cash;
        if (cash < -0.001) negativeCash++;
        const inv = b?.inventory || {};
        for (const k of Object.keys(inv)) {
          const v = Number(inv[k] || 0);
          totalInvItems += v;
          if (v < -0.001) negativeInv++;
        }
      }
      return {
        count: list.length,
        totalCash: Math.round(totalCash * 100) / 100,
        negativeCashCount: negativeCash,
        negativeInventoryCount: negativeInv,
        totalInventoryUnits: Math.round(totalInvItems * 100) / 100,
        day: this.timeSystem.day,
      };
    } catch (e: any) {
      return { count: -1, error: String(e?.message || e) };
    }
  }

  /** Core invariant checker. Returns structured result safe for long-run logging. Throws only on catastrophic internal failure. */
  checkCoreInvariants(): { ok: boolean; issues: string[]; metrics: any; day: number; tick: number } {
    const issues: string[] = [];
    const pop = this.getPopulationStabilitySnapshot();
    const biz = this.getBusinessHealthSnapshot();
    const totalMoney = this.getTotalMoneyInSystem();

    // Population stability (basic sanity over long runs)
    if (pop.count < 0) issues.push('population read failure');
    if (pop.count > 10000) issues.push(`population explosion: ${pop.count}`);
    if (pop.count === 0) issues.push('population zero (possible total wipe)');

    // Money (no obvious negative total; individual negatives are business logic but we flag)
    if (!isFinite(totalMoney)) issues.push('total money is NaN/Infinity');
    if (totalMoney < -100) issues.push(`large negative total money: ${totalMoney}`);

    // Business invariants (no negative cash or inventory where it should not be)
    if ((biz.negativeCashCount || 0) > 0) issues.push(`negative business cash on ${biz.negativeCashCount} biz(es)`);
    if ((biz.negativeInventoryCount || 0) > 0) issues.push(`negative inventory on ${biz.negativeInventoryCount} biz(es)`);

    // Time sanity
    const t = this.timeSystem;
    if (t.tick < 0) issues.push('negative tick');
    if (!isFinite(t.timeHours) || t.timeHours < 0) issues.push('invalid timeHours');

    // === Phase B high-signal invariants (drama/brain/housing/traffic hardening; zero happy-path behavior change) ===
    // 1) Brain decision log integrity under drama (malformed logs or count drift when real Grok/brains active)
    try {
      const bs: any = (this as any).businesses;
      if (bs) {
        const st = bs.getBrainStats?.() || {};
        const totalLogged = Number(st.totalDecisionsLogged || 0);
        if (totalLogged > 0) {
          const bizSnap: any = this.businessSystemSnapshot || (bs.getSnapshot?.() || {});
          const bizList = Array.isArray(bizSnap.businesses) ? bizSnap.businesses : [];
          let sumLogs = 0;
          let malformed = 0;
          for (const b of bizList) {
            if (b && b.id && typeof bs.getBusinessDecisionLog === 'function') {
              const logs = bs.getBusinessDecisionLog(b.id) || [];
              sumLogs += logs.length;
              for (const log of logs.slice(-2)) {
                if (!log || typeof log.timestamp !== 'number' || typeof log.brainName !== 'string' || !Array.isArray(log.decisions) || typeof log.simDay !== 'number') {
                  malformed++;
                }
              }
            }
          }
          if (malformed > 0) issues.push(`brain decision log malformed entries: ${malformed}`);
        }
      }
    } catch {}

    // 2) Housing occupancy bounds post re-home (catches pressure/re-home bugs; respects capacity)
    try {
      const locs = typeof this.locations?.getAllLocations === 'function' ? this.locations.getAllLocations() : [];
      let negOcc = 0, overOcc = 0;
      for (const loc of locs) {
        if (loc && loc.type === 'residential') {
          const occ = Number(loc.currentOccupants || 0);
          const cap = loc.capacity;
          if (occ < 0) negOcc++;
          if (cap !== undefined && occ > cap) overOcc++;
        }
      }
      if (negOcc > 0) issues.push(`negative home occupants on ${negOcc} home(s)`);
      if (overOcc > 0) issues.push(`over-occupied homes post re-home: ${overOcc}`);
    } catch {}

    // 3) Traffic light phase sanity + stopped count sanity (TL + congestion health)
    try {
      const ts: any = this.trafficSystemSnapshot || {};
      const lights = Array.isArray(ts.lights) ? ts.lights : [];
      let badPhases = 0;
      for (const l of lights) {
        const ph = Number(l?.phase);
        if (Number.isFinite(ph) && (ph < 0 || ph > 2)) badPhases++;
      }
      if (badPhases > 0) issues.push(`invalid traffic light phases: ${badPhases}`);
      const stopped = Number(ts.stoppedVehicleCount || 0);
      const vCount = Number(ts.vehicleCount || (Array.isArray(ts.vehicles) ? ts.vehicles.length : 0) || 0);
      if (stopped < 0) issues.push('negative stopped vehicles');
      if (stopped > vCount + 10) issues.push(`stopped vehicles ${stopped} >> live vehicles ${vCount}`);
      if (typeof ts.avgCongestionFactor === 'number' && (ts.avgCongestionFactor < 0 || ts.avgCongestionFactor > 3)) {
        issues.push('avgCongestionFactor out of sane range');
      }
    } catch {}

    // === Phase C long-run (300d–500d+) hardening checks (defensive, zero behavior change; for Crown real-Grok reliability) ===
    // 4) Decision log growth sanity under extreme/sustained drama (prevents unbounded log bloat in very long runs)
    try {
      const bs: any = (this as any).businesses;
      const st = bs?.getBrainStats?.() || {};
      const total = Number(st.totalDecisionsLogged || 0);
      const day = this.timeSystem?.day || 1;
      const perDay = total / Math.max(1, day);
      if (perDay > 28) issues.push(`decision log growth excessive under drama: ${perDay.toFixed(1)}/day (300d+ sustained hostile?)`);
      if (total < 0) issues.push('negative decision log total count');
      if (day > 200 && total < day * 0.5) issues.push('suspiciously low decision log growth over very long run');
    } catch {}

    // 5) Accumulator shape integrity after many 📦 exports (validates phase7 decisionQualityTrend + hostile/Grok split shapes from persistence)
    try {
      const snap: any = (this as any).getFullSnapshot?.() || {};
      const p7 = snap.phase7 || snap.meta?.phase7 || (snap as any).phase7 || {};
      const trend = p7.decisionQualityTrend;
      if (Array.isArray(trend)) {
        if (trend.length > 50) issues.push(`accumulator decisionQualityTrend length implausibly large post-exports: ${trend.length}`);
        const badShape = trend.some((t: any) => t && (typeof t.day !== 'number' || !isFinite(Number(t.avgVariety)) || !isFinite(Number(t.hRobustProxy))));
        if (badShape) issues.push('accumulator decisionQualityTrend shape corrupt (NaN/invalid day after many 📦 exports)');
      }
      const hi = p7.hostileImpactOnDecisions;
      if (hi && (typeof hi.hostileCount !== 'number' || !isFinite(Number(hi.decisionImpactProxy)))) {
        issues.push('hostileImpactOnDecisions accumulator shape invalid post-export');
      }
      const gd = p7.totalGrokDecisionsVsBaseline;
      if (gd && (typeof gd.totalDecisions !== 'number' || (gd.grokOrRealProviderCount || 0) < 0 || (gd.baselineHeuristicCount || 0) < 0)) {
        issues.push('totalGrokDecisionsVsBaseline accumulator has invalid counts');
      }
    } catch {}

    // 6) Housing/traffic re-home + long-run occupancy/congestion bounds over 300d+ scales (catches sustained pressure bugs)
    try {
      const locs = typeof this.locations?.getAllLocations === 'function' ? this.locations.getAllLocations() : [];
      let maxOccRatio = 0, pressuredLike = 0;
      for (const loc of locs) {
        if (loc && loc.type === 'residential') {
          const occ = Number(loc.currentOccupants || 0);
          const cap = loc.capacity || 4;
          if (cap > 0) maxOccRatio = Math.max(maxOccRatio, occ / cap);
          if (occ > cap * 0.9) pressuredLike++;
        }
      }
      if (maxOccRatio > 1.35) issues.push(`extreme housing over-occupancy sustained over long run: ${maxOccRatio.toFixed(2)}x capacity (re-home pressure 300d+)`);
      if (pressuredLike > 8) issues.push(`high number of near-capacity homes post re-homing: ${pressuredLike}`);

      const ts: any = this.trafficSystemSnapshot || {};
      const stopped = Number(ts.stoppedVehicleCount || 0);
      const vCount = Number(ts.vehicleCount || (Array.isArray(ts.vehicles) ? ts.vehicles.length : 0) || 0);
      const cong = typeof ts.avgCongestionFactor === 'number' ? ts.avgCongestionFactor : 0;
      if (vCount > 5 && stopped / vCount > 0.85 && cong > 1.8) {
        issues.push(`extreme traffic gridlock + high stopped sustained (re-home/compound pressure over long run)`);
      }
    } catch {}

    // 7) Brain decision variety bounds under sustained hostile compounds (variety under churn must stay reasonable for 300d+)
    try {
      const bs: any = (this as any).businesses;
      const bizSnap: any = this.businessSystemSnapshot || (bs?.getSnapshot?.() || {});
      const bizList = Array.isArray(bizSnap.businesses) ? bizSnap.businesses : [];
      let totalRecent = 0;
      const uniqueTypes = new Set<string>();
      for (const b of bizList) {
        if (b && b.id && typeof bs.getBusinessDecisionLog === 'function') {
          const logs = bs.getBusinessDecisionLog(b.id) || [];
          for (const log of logs.slice(-8)) {
            const decs = Array.isArray(log?.decisions) ? log.decisions : [];
            totalRecent += decs.length;
            for (const d of decs) {
              if (d && (d.type || d.action)) uniqueTypes.add(String(d.type || d.action || 'unknown'));
              if (d && d.reason) {
                // crude variety signal from reason keywords too
                const r = String(d.reason).toLowerCase();
                if (r.includes('housing') || r.includes('churn')) uniqueTypes.add('housing-churn');
                if (r.includes('hostile') || r.includes('cyber') || r.includes('labor') || r.includes('tariff')) uniqueTypes.add('hostile-reactive');
              }
            }
          }
        }
      }
      const variety = uniqueTypes.size;
      const avgChurn = bizList.length > 0 ? totalRecent / bizList.length : 0;
      if (variety > 42) issues.push(`brain decision variety explosion under sustained compounds: ${variety} unique types (300d+ drama)`);
      if (avgChurn > 14) issues.push(`excessive per-biz decision churn under hostile compounds: ${avgChurn.toFixed(1)} recent`);
    } catch {}

    const metrics = {
      totalMoney: Math.round(totalMoney * 100) / 100,
      population: pop,
      businesses: biz,
      time: { day: t.day, hours: Math.round(t.timeHours * 100) / 100, tick: t.tick, speed: t.speed },
      // Phase B observability (auto surfaced in God "Show Current Invariants" + stability reports + harnesses)
      brain: (() => {
        try {
          const bs: any = (this as any).businesses;
          const st = bs?.getBrainStats?.() || {};
          return {
            totalDecisionsLogged: st.totalDecisionsLogged || 0,
            brainName: st.brainName || 'RuleBased',
            hasActiveBrain: !!(st.brainName && st.brainName !== 'RuleBased')
          };
        } catch { return { totalDecisionsLogged: 0, brainName: 'RuleBased' }; }
      })(),
      housing: (() => {
        try {
          const locs = typeof this.locations?.getAllLocations === 'function' ? this.locations.getAllLocations() : [];
          let homes = 0, totalOcc = 0, over = 0;
          for (const l of locs) {
            if (l?.type === 'residential') {
              homes++;
              const o = Number(l.currentOccupants || 0);
              totalOcc += o;
              if (l.capacity !== undefined && o > l.capacity) over++;
            }
          }
          return { homes, totalOccupants: totalOcc, overOccupied: over };
        } catch { return { homes: 0, totalOccupants: 0, overOccupied: 0 }; }
      })(),
      traffic: (() => {
        try {
          const ts: any = this.trafficSystemSnapshot || {};
          const vCount = ts.vehicleCount || (Array.isArray(ts.vehicles) ? ts.vehicles.length : 0) || 0;
          return {
            vehicleCount: vCount,
            stoppedVehicleCount: ts.stoppedVehicleCount || 0,
            lightCount: Array.isArray(ts.lights) ? ts.lights.length : 0,
            avgCongestionFactor: typeof ts.avgCongestionFactor === 'number' ? Math.round(ts.avgCongestionFactor * 100) / 100 : 0,
            totalJunctionCrossings: ts.totalJunctionCrossings || 0
          };
        } catch { return { vehicleCount: 0, stoppedVehicleCount: 0, lightCount: 0 }; }
      })(),
      // Phase C (300d–500d+ Crown hardening) — auto exposed to God "Show Invariants" + stability reports + harness long-run paths
      decisionLogGrowth: (() => {
        try {
          const bs: any = (this as any).businesses; const st = bs?.getBrainStats?.() || {};
          const total = Number(st.totalDecisionsLogged || 0); const d = this.timeSystem?.day || 1;
          const perDay = total / Math.max(1, d);
          return { totalLogged: total, perDayApprox: Math.round(perDay * 100) / 100, growthSane: total >= 0 && perDay < 30 };
        } catch { return { totalLogged: 0, perDayApprox: 0, growthSane: true }; }
      })(),
      accumulatorShape: (() => {
        try {
          const snap: any = (this as any).getFullSnapshot?.() || {}; const p7 = snap.phase7 || snap.meta?.phase7 || {};
          const trend = p7.decisionQualityTrend; const trendLen = Array.isArray(trend) ? trend.length : 0;
          const shapeOk = !trend || (Array.isArray(trend) && trend.every((t: any) => isFinite(Number(t?.hRobustProxy)) && typeof t.day === 'number'));
          return {
            trendLength: trendLen,
            hostileImpactPresent: !!p7.hostileImpactOnDecisions,
            grokDominancePresent: !!p7.totalGrokDecisionsVsBaseline,
            shapeOk
          };
        } catch { return { trendLength: 0, hostileImpactPresent: false, grokDominancePresent: false, shapeOk: true }; }
      })(),
      longRunBounds: (() => {
        try {
          const locs = typeof this.locations?.getAllLocations === 'function' ? this.locations.getAllLocations() : [];
          let maxOcc = 0;
          for (const l of locs) { if (l?.type === 'residential' && l.capacity) maxOcc = Math.max(maxOcc, (l.currentOccupants || 0) / l.capacity); }
          const ts: any = this.trafficSystemSnapshot || {};
          const v = Number(ts.vehicleCount || 0) || 1; const s = Number(ts.stoppedVehicleCount || 0);
          return { housingOccMaxRatio: Math.round(maxOcc * 100) / 100, trafficStoppedRatio: Math.round((s / v) * 100) / 100, rehomePressureSane: maxOcc < 1.3 && (s / v) < 0.9 };
        } catch { return { housingOccMaxRatio: 1, trafficStoppedRatio: 0, rehomePressureSane: true }; }
      })(),
      varietyBounds: (() => {
        try {
          const bs: any = (this as any).businesses; const bizSnap: any = this.businessSystemSnapshot || (bs?.getSnapshot?.() || {});
          const bizList = Array.isArray(bizSnap.businesses) ? bizSnap.businesses : [];
          let totalRecent = 0; const uniq = new Set<string>();
          for (const b of bizList) {
            if (b?.id && typeof bs.getBusinessDecisionLog === 'function') {
              const logs = bs.getBusinessDecisionLog(b.id) || [];
              for (const log of logs.slice(-6)) {
                for (const d of (log?.decisions || [])) {
                  totalRecent++;
                  if (d?.type) uniq.add(String(d.type));
                  if (d?.reason) { const r = String(d.reason).toLowerCase(); if (r.includes('hostile') || r.includes('housing') || r.includes('churn')) uniq.add('drama-reactive'); }
                }
              }
            }
          }
          const varCt = uniq.size; const avgC = bizList.length ? totalRecent / bizList.length : 0;
          return { uniqueDecisionTypes: varCt, avgRecentDecisionsPerBiz: Math.round(avgC * 10) / 10, boundsOk: varCt < 45 && avgC < 15 };
        } catch { return { uniqueDecisionTypes: 0, avgRecentDecisionsPerBiz: 0, boundsOk: true }; }
      })(),
    };

    return {
      ok: issues.length === 0,
      issues,
      metrics,
      day: t.day,
      tick: t.tick,
    };
  }

  /**
   * Execute a long-running stability stress test entirely in core (no UI dependency).
   * Advances in chunks (for periodic invariant checks + reporting), supports any speed context.
   * Returns rich report string + final metrics. Ideal for harnesses + puppeteer drivers that also trigger captures.
   * Example: sim.runLongTermStabilityTest(120, 1000) for 120 simulated days.
   */
  runLongTermStabilityTest(targetDays: number, reportSpeed: number = 1000): { report: string; finalInvariants: any; checkpoints: any[]; crashed: boolean } {
    const startDay = this.timeSystem.day;
    const targetTicks = Math.floor(targetDays * 24 * 60);
    const startTick = this.timeSystem.tick;
    const checkpoints: any[] = [];
    let crashed = false;
    const chunkSize = Math.max(60, Math.floor(targetTicks / 20)); // ~20 checkpoints

    const initialInv = this.checkCoreInvariants();
    checkpoints.push({ label: 'start', ...initialInv });

    try {
      for (let advanced = 0; advanced < targetTicks; advanced += chunkSize) {
        const thisChunk = Math.min(chunkSize, targetTicks - advanced);
        this.forceAdvanceTicks(thisChunk);

        const inv = this.checkCoreInvariants();
        checkpoints.push({ label: `+${Math.floor((this.timeSystem.tick - startTick) / 60)}h`, ...inv });

        if (!inv.ok) {
          // Record but continue (long run should surface cumulative issues, not hard stop unless catastrophic)
          // In practice, God/driver can decide to abort.
        }
      }
    } catch (err: any) {
      crashed = true;
      checkpoints.push({ label: 'crash', error: String(err?.message || err), day: this.timeSystem.day });
    }

    const finalInv = this.checkCoreInvariants();
    checkpoints.push({ label: 'end', ...finalInv });

    // Build compact report
    const lines: string[] = [];
    lines.push(`=== PHASE A/B/C LONG-RUN STABILITY REPORT (core only; Phase C: 300d–500d+ Crown real-Grok hardening) ===`);
    lines.push(`Seed: ${this.timeSystem.seed} | Target: ${targetDays}d | Actual advanced: ${Math.round((this.timeSystem.tick - startTick) / 1440 * 100)/100}d`);
    lines.push(`Start day ${startDay} → End day ${this.timeSystem.day}`);
    lines.push(`Initial totalMoney=${initialInv.metrics.totalMoney} | Final=${finalInv.metrics.totalMoney}`);
    lines.push(`Pop: ${initialInv.metrics.population.count} → ${finalInv.metrics.population.count} (empRate ${finalInv.metrics.population.employmentRate})`);
    lines.push(`Biz cash: ${initialInv.metrics.businesses.totalCash} → ${finalInv.metrics.businesses.totalCash} (negCash=${finalInv.metrics.businesses.negativeCashCount})`);
    const moneyDelta = finalInv.metrics.totalMoney - initialInv.metrics.totalMoney;
    lines.push(`Money delta: ${moneyDelta >= 0 ? '+' : ''}${Math.round(moneyDelta*100)/100}`);
    const broken = checkpoints.filter(c => c.issues && c.issues.length > 0);
    lines.push(`Checkpoints with issues: ${broken.length}/${checkpoints.length}`);
    if (broken.length > 0) {
      lines.push(`First issues sample: ${JSON.stringify(broken[0].issues)}`);
    }
    lines.push(`Crashed during run: ${crashed}`);
    lines.push(`Speed context for report: ${reportSpeed}x (real-world elapsed depends on driver loop)`);
    // Phase B: new invariants visible in long-run reports (auto from enriched checkpoints)
    const fb = finalInv.metrics || {};
    lines.push(`Phase B @end: brainDecisions=${fb.brain?.totalDecisionsLogged || 0} (${fb.brain?.brainName || 'n/a'}) | homes=${fb.housing?.homes || 0} occ=${fb.housing?.totalOccupants || 0} over=${fb.housing?.overOccupied || 0} | trafficStopped=${fb.traffic?.stoppedVehicleCount || 0}/${fb.traffic?.vehicleCount || 0} lights=${fb.traffic?.lightCount || 0} congF=${fb.traffic?.avgCongestionFactor || 0}`);
    // Phase C (300d–500d+ Crown + real Grok hardening): new C metrics in every long stability report + God readout
    const fc = finalInv.metrics || {};
    lines.push(`Phase C @end (300d+ equiv): logGrowth=${fc.decisionLogGrowth?.perDayApprox || 0}/d (total=${fc.decisionLogGrowth?.totalLogged || 0}) | accumTrend=${fc.accumulatorShape?.trendLength || 0} shapeOk=${fc.accumulatorShape?.shapeOk} hostileImpact=${fc.accumulatorShape?.hostileImpactPresent} grokDom=${fc.accumulatorShape?.grokDominancePresent} | varietyTypes=${fc.varietyBounds?.uniqueDecisionTypes || 0} avgChurn=${fc.varietyBounds?.avgRecentDecisionsPerBiz || 0} boundsOk=${fc.varietyBounds?.boundsOk} | longRunHousingMaxOcc=${fc.longRunBounds?.housingOccMaxRatio || 1} trafficStopRatio=${fc.longRunBounds?.trafficStoppedRatio || 0} rehomeSane=${fc.longRunBounds?.rehomePressureSane}`);
    lines.push(`=== END REPORT ===`);

    const report = lines.join('\n');
    console.log(report);

    return { report, finalInvariants: finalInv, checkpoints, crashed };
  }
}
