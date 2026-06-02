/**
 * ResidentsSystem
 * 
 * Manages the population of residents.
 * This will become one of the core systems in the simulation.
 */

import { Resident, type ResidentId, type ResidentFullState } from '../entities/Resident';
import type { TimeSystem } from '../core/TimeSystem';
import type { LocationsSystem } from './LocationsSystem';
import type { LocationId } from '../entities/Location';
import { simulationEvents } from '../utils/EventBus';
import type { IResidentDecisionMaker, ResidentContext, ResidentDecision } from './residents/ResidentBrain';

export class ResidentsSystem {
  private residents: Map<ResidentId, Resident> = new Map();

  /** Optional for housing market features (rent calc + reassignment queries). Passed optionally to preserve all existing call sites. */
  private locationsSystem?: LocationsSystem;

  /** Optional cross-wire to BusinessSystem for agentic hire triggers on arrival at jobHuntTarget (enables "I chose this job, I arrived, I got hired" realism loop). */
  private businessSystem?: any;

  /** Day tracking for periodic lightweight housing pressure checks (reassignments) */
  private lastHousingDay: number = -1;

  /** Shared event bus for cross-system flows (e.g. rent collection events consumed by EconomySystem) */
  private readonly events = simulationEvents;

  constructor(private timeSystem: TimeSystem, locationsSystem?: LocationsSystem) {
    this.locationsSystem = locationsSystem;
  }

  /** Cross-wire from Simulation after both systems exist (non-breaking for tests that construct directly). */
  setBusinessSystem(bs: any): void {
    this.businessSystem = bs;
  }

  addResident(resident: Resident): void {
    this.residents.set(resident.id, resident);
  }

  getResident(id: ResidentId): Resident | undefined {
    return this.residents.get(id);
  }

  getAllResidents(): Resident[] {
    return Array.from(this.residents.values());
  }

  /**
   * Returns residents under explicit AI / external brain control or with active agentic targets/decisions.
   * Detects via public brain getter, job/home hunt targets, conserve state, recorded decision log, or __isGrokAgent tag.
   * Used by GodMode "AI Citizens / Top Agents" visibility + inspector badges so users can watch voluntary AI choices play out in real time (e.g. a controlled resident climbing ranks via targeted job/home/conserve strategies).
   * Realism note: these are the "agents at the top" — their self-directed decisions (not forced) let us observe emergent wealth stratification from informed market participation.
   */
  getAIControlledResidents(): Resident[] {
    return this.getAllResidents().filter((r: any) => {
      const hasBrain = !!r.getBrain?.();
      const hasTarget = !!r.jobHuntTargetId || !!r.preferredHomeTargetId;
      const conserving = !!r.conserveUntilTick;
      const hasDecisions = (r.getResidentDecisionLog?.()?.length ?? 0) > 0;
      const tagged = !!(r as any).__isGrokAgent;
      return hasBrain || hasTarget || conserving || hasDecisions || tagged;
    });
  }

  /** Main update loop - called by Simulation every tick */
  update(): void {
    const hour = this.timeSystem.hourOfDay;
    const minute = this.timeSystem.minuteOfHour;

    const tick = this.timeSystem.tick;
    for (const resident of this.residents.values()) {
      resident.update(hour, minute, tick);
      // Note: unemployment clock + long-term effects (duration, social/fatigue creep for viz + job-search bias + behavior)
      // are now fully self-managed inside Resident.update() for encapsulation. Direct calls to updateUnemploymentClock()
      // remain available for unit tests and manual God Mode steps.
    }

    // === Housing market step (lightweight, day-boundary only) ===
    // Emergent pressure from unemployment + low money causes some residents to seek cheaper/available homes.
    // Uses only public LocationsSystem queries + safe mutations on Resident.homeId / currentLocationId.
    const currentDay = Math.floor(this.timeSystem.timeHours / 24);
    if (currentDay !== this.lastHousingDay) {
      this.lastHousingDay = currentDay;
      this.processHousingMarketStep();
    }
  }

  /** Returns a snapshot of all residents for UI / debugging */
  getSnapshot() {
    return this.getAllResidents().map(r => r.getSnapshot());
  }

  /** Basic population stats (expanded with needs averages for Phase 1 observability) */
  getStats() {
    const list = this.getAllResidents();
    if (list.length === 0) {
      return { total: 0, averageMoney: 0, averageHunger: 0, averageFatigue: 0, averageSocial: 0 };
    }
    const avg = (key: 'hunger' | 'fatigue' | 'social') =>
      list.reduce((sum, r) => sum + r.needs[key], 0) / list.length;

    return {
      total: list.length,
      averageMoney: list.reduce((sum, r) => sum + r.money, 0) / list.length,
      averageHunger: avg('hunger'),
      averageFatigue: avg('fatigue'),
      averageSocial: avg('social'),
    };
  }

  /**
   * Friday "payday" boundary hook (Phase A hardened for money conservation).
   * NO longer distributes weekly wages here (daily payroll is now the single source of truth via
   * BusinessSystem.disburseRealWages + explicit resident hourlyWage transfers; removes prior
   * triple-income paths that caused runaway money supply).
   * 
   * ONLY performs housing rent collection (after any other daily flows) using Locations pricing.
   * Never drives resident money negative. Emits 'economy:rent-collected' for EconomySystem tracking.
   * Still triggered on Fridays (and via forcePaydayNow for God Mode).
   */
  processFridayPayday(): void {
    // Housing rent collection (HM layer) — uses Locations for per-home rent pricing.
    // Runs on "payday" calendar boundary so residents have had daily wages available.
    // Critical: never-negative deductions (pay what they can afford).
    let totalRent = 0;
    let payers = 0;
    if (this.locationsSystem) {
      for (const resident of this.residents.values()) {
        const home = this.locationsSystem.getLocation(resident.homeId);
        if (!home || !home.isResidential()) continue;
        const rent = this.locationsSystem.getMonthlyRent(resident.homeId);
        if (rent <= 0) continue;
        // Pay what they can; never go negative (critical invariant)
        const pay = Math.min(rent, Math.max(0, resident.money));
        if (pay > 0) {
          resident.money -= pay;
          totalRent += pay;
          payers++;
          (resident as any).lastRentPaid = pay;
          // CIM: real rent burn from home choice directly reduces netWealth (voluntary home_target to lower pressure saves)
          if (typeof (resident as any).recordRentPaid === 'function') {
            (resident as any).recordRentPaid(pay);
          }
          // Visible per-player for AI brains / rig / SUMMARY (realism: "I paid rent today, net effect on my capital")
          console.log(`[RENT PAID] ${resident.name} paid $${pay.toFixed(2)} for home (effective market pressure applied; money now $${resident.money.toFixed(2)})`);
        }
      }
    }

    if (totalRent > 0) {
      this.events.emit('economy:rent-collected', {
        amount: Math.round(totalRent * 100) / 100,
        payers,
      });
    }
  }

  // === God Mode / Debug Global Actions (for Event Injector & inspector tooling) ===

  /** Immediately trigger payday for the entire population (ignores calendar). */
  forcePaydayNow(): void {
    this.processFridayPayday();
  }

  /**
   * Apply additive deltas to needs across ALL residents (clamped 0-100).
   * Deltas can be positive (spikes) or negative (relief). 
   * Also syncs legacy energy field.
   */
  applyGlobalNeedDelta(deltas: { hunger?: number; fatigue?: number; social?: number }): void {
    for (const r of this.residents.values()) {
      if (deltas.hunger !== undefined) {
        r.needs.hunger = Math.max(0, Math.min(100, r.needs.hunger + deltas.hunger));
      }
      if (deltas.fatigue !== undefined) {
        r.needs.fatigue = Math.max(0, Math.min(100, r.needs.fatigue + deltas.fatigue));
      }
      if (deltas.social !== undefined) {
        r.needs.social = Math.max(0, Math.min(100, r.needs.social + deltas.social));
      }
      // keep legacy energy in sync for inspector compat
      r.energy = Math.max(0, Math.min(100, 100 - r.needs.fatigue));
    }
  }

  /** Quick spike presets for the Event Injector */
  triggerHungerCrisis(): void {
    this.applyGlobalNeedDelta({ hunger: 60 });
  }

  triggerMassExhaustion(): void {
    this.applyGlobalNeedDelta({ fatigue: 75 });
  }

  triggerLonelinessWave(): void {
    this.applyGlobalNeedDelta({ social: 70 });
  }

  /** Restore sane baseline needs for everyone (great for resetting experiments) */
  resetAllNeeds(): void {
    for (const r of this.residents.values()) {
      r.needs.hunger = 8;
      r.needs.fatigue = 12;
      r.needs.social = 18;
      r.energy = 100 - r.needs.fatigue;
    }
  }

  // === Full State Restore (for Scenario Tools + Simulation load) ===

  /** Remove every resident. Used before loading a full scenario state. */
  clear(): void {
    this.residents.clear();
    this.lastHousingDay = -1;
  }

  /**
   * Replace the entire population from an array of full states (from toJSON).
   * This enables perfect round-trip of custom populations and saved scenarios.
   */
  loadFromFullStates(states: ResidentFullState[]): number {
    this.clear();
    let loaded = 0;
    for (const state of states) {
      try {
        const r = Resident.fromJSON(state);
        this.addResident(r);
        loaded++;
      } catch (e) {
        console.warn('[ResidentsSystem] Skipped invalid resident in loadFromFullStates:', e);
      }
    }
    return loaded;
  }

  /** Get array of complete serializable states for every resident (scenario / save) */
  getFullStates(): ResidentFullState[] {
    return this.getAllResidents().map(r => r.toJSON());
  }

  // === Employment helpers (symmetry with BusinessSystem for queries from resident side) ===

  /** Residents who currently report an employerId (set via BusinessSystem coordination). */
  getEmployedResidents(): import('../entities/Resident').Resident[] {
    return this.getAllResidents().filter(r => r.employerId !== null);
  }

  getUnemployedResidents(): import('../entities/Resident').Resident[] {
    return this.getAllResidents().filter(r => r.employerId === null);
  }

  /** Simple aggregate for dashboards / validation (avoids cross-system dependency in some tests). */
  getEmploymentCounts(): { employed: number; unemployed: number; rate: number } {
    const list = this.getAllResidents();
    const employed = list.filter(r => r.employerId !== null).length;
    const unemployed = list.length - employed;
    return {
      employed,
      unemployed,
      rate: list.length > 0 ? Math.round((employed / list.length) * 1000) / 1000 : 0,
    };
  }

  // === Housing Market (HM) reassignment logic (lightweight emergent pressure only) ===

  /**
   * Core housing pressure step. Called on day boundaries from update().
   * High-unemployment or low-money residents attempt to move to cheaper / vacant homes.
   * - Never strands residents (always keeps a valid homeId).
   * - Uses ONLY public LocationsSystem APIs for queries + rent.
   * - Churn is deliberately capped (max ~4 moves/day in Phase A) for visible re-homing dynamics while preserving long-term stability.
   * - Updates both Resident fields and Location.currentOccupants for snapshot/viz consistency.
   * Phase A Core Stabilization: higher visible housing churn + rent pressure creates more resident relocation activity and money flows (rent collected on paydays).
   */
  private processHousingMarketStep(): void {
    if (!this.locationsSystem) return;

    const residentsList = this.getAllResidents();
    if (residentsList.length === 0) return;

    // Authoritative occupancy derived from residents (single source of truth)
    const occupancy: Record<string, number> = {};
    for (const r of residentsList) {
      occupancy[r.homeId] = (occupancy[r.homeId] ?? 0) + 1;
    }

    // Sync counts onto Location entities (for renderer tints, inspector, snapshots)
    for (const [hid, cnt] of Object.entries(occupancy)) {
      const loc = this.locationsSystem.getLocation(hid);
      if (loc) loc.currentOccupants = cnt;
    }

    // Identify pressured residents (unemp duration or struggling to afford current rent)
    const pressured: Resident[] = [];
    for (const r of residentsList) {
      const unempHrs = (r.unemploymentDurationTicks || 0) / 60;
      const curRent = this.locationsSystem.getMonthlyRent(r.homeId);
      const lowCash = r.money < Math.max(5, curRent * 0.55);
      const longUnemp = r.employerId === null && unempHrs > 6; // Phase A: earlier pressure for more dynamic re-homing activity
      if (longUnemp || lowCash) {
        pressured.push(r);
      }
    }
    if (pressured.length === 0) return;

    // Get affordable vacant options, cheapest first
    const options = this.locationsSystem.findAffordableVacantHomes(occupancy, 200);
    if (options.length === 0) return;

    // Phase A Core Stabilization: higher cap (up to 4) for visibly active housing market re-homing.
    // Residents moving homes more often makes the city feel alive (occupancy shifts, occasional commute cancels, rent dynamics).
    const maxRehomes = Math.min(4, pressured.length);
    let rehomedCount = 0;

    for (let i = 0; i < pressured.length && rehomedCount < maxRehomes; i++) {
      const res = pressured[i];
      const oldId = res.homeId;
      const curRent = this.locationsSystem.getMonthlyRent(oldId);

      // Pick first meaningfully different + cheaper (or comparable) vacant option.
      // For agentic residents (AI-driven "free market" housing choice): strongly prefer their preferredHomeTargetId if viable.
      // This advances SimCity world realism (voluntary moves based on personal econ calc) and free markets (resident demand directly influences which homes get occupied, pressuring rents/availability organically).
      let target: import('../entities/Location').Location | undefined;
      const pref = res.preferredHomeTargetId;
      if (pref) {
        const prefLoc = options.find((c: any) => c.id === pref);
        if (prefLoc) {
          const occNow = occupancy[pref] ?? 0;
          const cap = prefLoc.capacity ?? 999;
          if (occNow < cap) {
            const prefRent = this.locationsSystem.getMonthlyRent(pref);
            if (prefRent <= curRent * 1.2) {  // allow slight premium for preferred
              target = prefLoc;
            }
          }
        }
      }
      if (!target) {
        for (const cand of options) {
          if (cand.id === oldId) continue;
          const occNow = occupancy[cand.id] ?? 0;
          const cap = cand.capacity ?? 999;
          if (occNow >= cap) continue;
          const candRent = this.locationsSystem.getMonthlyRent(cand.id);
          if (candRent <= curRent * 1.15) {
            target = cand;
            break;
          }
        }
      }
      if (!target) continue;

      // Perform safe reassignment
      occupancy[oldId] = Math.max(0, (occupancy[oldId] ?? 1) - 1);
      occupancy[target.id] = (occupancy[target.id] ?? 0) + 1;

      const oldLoc = this.locationsSystem.getLocation(oldId);
      if (oldLoc) oldLoc.currentOccupants = Math.max(0, (oldLoc.currentOccupants || 1) - 1);

      res.homeId = target.id;
      target.currentOccupants = (target.currentOccupants || 0) + 1;

      // CIM: home savings proxy for netWealth (voluntary low-pressure move via home_target or pressure rehome = real "asset" uplift)
      const newRent = this.locationsSystem.getMonthlyRent(target.id);
      const savings = Math.max(0, curRent - newRent);
      if (savings > 0 && typeof (res as any).recordHomeSavingsDelta === 'function') {
        (res as any).recordHomeSavingsDelta(savings * 3); // multi-month proxy flavor for long-run Crown stories
      }

      // If docked at (or heading to) the old home, snap to new to avoid stranding / visual orphaning
      if (res.currentLocationId === oldId) {
        res.currentLocationId = target.id;
      }
      if (res.commuteTargetId === oldId) {
        res.cancelCommute();
      }

      rehomedCount++;
    }
  }

  /** Public hook for God Mode / tests / manual trigger of housing churn. */
  forceHousingMarketStep(): void {
    this.processHousingMarketStep();
  }

  /**
   * For agentic residents (AI-driven job choice): When an AI resident arrives at their jobHuntTarget location,
   * immediately attempt to get hired there if it's a viable workplace/business.
   * This advances city sim realism (you go to the job you chose, you get considered) and free markets
   * (labor supply from agent choices meets business demand; no central assignment).
   * Uses existing hire paths for consistency.
   */
  attemptAgentHireAtCurrentLocation(residentId: ResidentId): boolean {
    const resident = this.residents.get(residentId);
    if (!resident || !resident.jobHuntTargetId || resident.currentLocationId !== resident.jobHuntTargetId) {
      return false;
    }
    const targetId = resident.jobHuntTargetId as any;

    // Normalize targetId via BusinessSystem resolver before any hire/employer checks/sets.
    // This supports cases where jobHuntTargetId is a physical workplace LocationId (from ctx) rather than exact BusinessId.
    // (Movement still treats jobHuntTargetId as a valid location target; spawn alignment ensures loc ids resolve to biz ids that double as locs.)
    let effectiveTarget: any = targetId;
    if (this.businessSystem && typeof this.businessSystem.getBusinessForJobTarget === 'function') {
      const resolved = this.businessSystem.getBusinessForJobTarget(targetId);
      if (resolved) effectiveTarget = resolved;
    }

    // If already at the target biz, nothing to do
    if (resident.employerId === effectiveTarget) {
      resident.jobHuntTargetId = null;
      return true;
    }

    // Real job SWITCH support for agentic residents: if I am employed elsewhere and arrived at my chosen better target, fire old + hire new.
    // This + wage uplift in Business gives "I chose, I commuted the real road, I arrived, I switched to higher value job" loop.
    // Free markets: agents reallocate their labor to higher-paying opportunities; city employment map changes.
    if (this.businessSystem) {
      const bs = this.businessSystem;
      // Fire current if any
      if (resident.employerId && typeof bs.fireEmployee === 'function') {
        try { bs.fireEmployee(resident.employerId, resident.id); } catch {}
      }
      // Hire to target (the search bias path also works but this is immediate on arrival for the chooser)
      if (typeof bs.hireEmployee === 'function') {
        const ok = bs.hireEmployee(effectiveTarget, resident.id);
        if (ok) {
          // Uplift will also be applied inside run/search path, but ensure here too for direct switch
          const prev = resident.hourlyWage || 12;
          resident.hourlyWage = Math.max(prev, 18 + (String(effectiveTarget).length % 6));
          resident.jobHuntTargetId = null;
          return true;
        }
      }
      // Fallback to search (will hit the agentic target bias + uplift we added)
      if (typeof bs.runBasicJobSearch === 'function') {
        const result = bs.runBasicJobSearch();
        return !!(result && result.hires > 0);
      }
    }
    return false;
  }

  // === Agentic Residents / AI Citizens support (new 2026-06-01 initiative) ===
  // See plans/agentic-residents-ai-citizens-plan.md
  // These two public methods are the core "external AI can drive a resident" contract for testing
  // and future real LLM brains.

  /**
   * Build a rich, self-contained context for an AI / external brain to reason about this resident.
   * Includes personal state, available options (jobs/homes), city signals, and drama.
   * Safe to call from God Mode, harnesses, or direct console testing.
   */
  getResidentContextForAI(residentId: ResidentId): ResidentContext | null {
    const resident = this.residents.get(residentId);
    if (!resident || !this.locationsSystem) return null;

    const snap = resident.getSnapshot() as any; // includes the extended fields

    // Build available options using existing Locations queries + basic Business info if wired
    const workplaces = this.locationsSystem.getWorkplaces ? this.locationsSystem.getWorkplaces() : [];
    const availableWorkplaces = workplaces.slice(0, 6).map((loc: any) => {
      let wpId = loc.id;
      // Prefer business ids (when resolver finds a match) so that AI job_target decisions emit reliable keys for hire/arrival/uplift.
      // Loc ids are kept when no business association (orchestrator note: or keep locs but document). Spawn alignment means most resolve to same string anyway.
      // This + resolver in BusinessSystem makes "choose from ctx -> set jobHuntTargetId -> commute -> arrive -> real hire + wage uplift" robust.
      if (this.businessSystem && typeof this.businessSystem.getBusinessForJobTarget === 'function') {
        const resolved = this.businessSystem.getBusinessForJobTarget(loc.id);
        if (resolved) wpId = resolved;
      }
      return {
        id: wpId,
        name: loc.name || loc.id,
        distance: (this.locationsSystem as any).distanceBetween ? (this.locationsSystem as any).distanceBetween(resident.currentLocationId, loc.id) : 0,
        estimatedWage: (resident as any).hourlyWage ?? 12,
      };
    });

    const homes = this.locationsSystem.getLocationsByType ? this.locationsSystem.getLocationsByType('residential') : [];
    const occupancyProxy: Record<string, number> = {};
    // Rough occupancy from current residents (good enough for AI context)
    for (const r of this.residents.values()) {
      occupancyProxy[r.homeId] = (occupancyProxy[r.homeId] ?? 0) + 1;
    }
    const availableHomes = homes.slice(0, 6).map((loc: any) => ({
      id: loc.id,
      distance: (this.locationsSystem as any).distanceBetween ? (this.locationsSystem as any).distanceBetween(resident.currentLocationId, loc.id) : 0,
      rent: (this.locationsSystem as any).getMonthlyRent ? (this.locationsSystem as any).getMonthlyRent(loc.id) : 30,
      capacity: loc.capacity ?? 4,
      currentOccupants: occupancyProxy[loc.id] ?? 0,
    }));

    const pop = this.residents.size;
    const employed = Array.from(this.residents.values()).filter(r => r.employerId).length;
    const unempRate = pop > 0 ? (pop - employed) / pop : 0;

    // Build rich context for AI / external drivers (see agentic-residents plan)
    const context: ResidentContext = {
      id: resident.id,
      name: resident.name,
      simHour: this.timeSystem.hourOfDay,
      simDay: Math.floor(this.timeSystem.timeHours / 24),
      needs: { ...(snap.needs || (resident as any).needs) },
      money: snap.money ?? resident.money,
      energy: snap.energy ?? (resident as any).energy ?? 50,
      unemploymentHours: Math.round((((resident as any).unemploymentDurationTicks || 0) / 60) * 10) / 10,
      isEmployed: !!resident.employerId,
      currentActivity: resident.currentActivity,
      homeId: resident.homeId,
      workId: resident.workId,
      currentLocationId: resident.currentLocationId,
      position: { ...(snap.position || (resident as any).position || { x: 0, y: 0 }) },
      recentActivities: [resident.currentActivity],
      currentHourlyWage: resident.hourlyWage,
      // Rough proxy for time to payday (Fridays in original, but now daily payroll - use day % for demo)
      timeToNextPaydayHours: (24 - (Math.floor(this.timeSystem.timeHours) % 24)) || 24,

      // === Wage scaling observability for AI agents (play harness + future brains) ===
      // dailyEarningsPotential + projected make the effect of [WEALTH SWITCH SUCCESS] from job_target
      // immediately visible + actionable. After switch to higher hourlyWage, these numbers rise and
      // future disburseRealWages (BusinessSystem) will transfer larger amounts -> compounding money.
      // Free markets + realism: choosing higher-value job now produces demonstrably higher ongoing payroll.
      dailyEarningsPotential: (resident.hourlyWage || 12) * 8,
      projectedNextPaydayAmount: ((resident.hourlyWage || 12) * 8) * Math.max(1, Math.min(3, ((24 - (Math.floor(this.timeSystem.timeHours) % 24)) || 24) / 8)),
      recentEarningsDelta: (snap as any).recentEarningsDelta ?? ((snap.money ?? resident.money) - ((snap as any).prevMoney || (snap.money ?? resident.money))),
      availableWorkplaces: availableWorkplaces.map((w: any, idx: number) => ({
        ...w,
        estimatedWage: Math.max(8, resident.hourlyWage + (idx % 6 - 2.5) * 4.2 + (idx % 3 - 1) * 1.5 + (idx === 0 ? 2.5 : 0)),  // enhanced spread + bias to first options so AI decision surfaces (play rig) reliably see + fire job_target on higher estWage/dailyPotential under contention
        isMyCurrent: w.id === resident.workId,
      })),
      availableHomes: availableHomes.map((h: any) => {
        // Use effective market rent (with occupancy pressure) for AI-visible price signals + % calc.
        // This makes home_target decisions react to real free-market dynamics (cheaper vacant homes vs premium hot ones).
        const baseRent = (this.locationsSystem as any).getMonthlyRent ? (this.locationsSystem as any).getMonthlyRent(h.id) : h.rent || 30;
        const marketRent = (this.locationsSystem as any).getEffectiveMonthlyRent ? (this.locationsSystem as any).getEffectiveMonthlyRent(h.id) : baseRent;
        const pressure = (this.locationsSystem as any).getHousingMarketPressure ? (this.locationsSystem as any).getHousingMarketPressure(h.id) : 0;
        const pct = resident.money > 0 ? Math.round((marketRent / resident.money) * 100) / 100 : 1;
        return {
          ...h,
          rent: baseRent, // keep base for compatibility
          marketRent,     // dynamic free-market price (what AI should primarily consider for value)
          pressure,       // 0-1 occupancy pressure signal
          monthlyRentAsPercentOfMyMoney: pct, // now reflects live market price signal
        };
      }),
      cityStats: {
        population: pop,
        unemploymentRate: Math.round(unempRate * 100) / 100,
      },
      activeHostileEvents: [],
      // Short-term memory wiring (task): last 5-8 from resident's decisionLog (ring capped in Resident); recentMoneyTrend from earnings delta proxy.
      // Memory enables GrokResidentBrain (stub+provider) to do better voluntary multi-turn: penalize repeats on neg delta, boost wins follow-on, drama seq react.
      // Decisions remain high-level only (flags); no change to physics/commute/hire/price/rent (still free market via value signals in ctx).
      recentDecisions: ((resident as any).getResidentDecisionLog?.() || []).slice(-8).map((entry: any) => ({
        turn: entry.simDay ?? Math.floor(this.timeSystem.timeHours / 24),
        type: entry.decision?.type,
        targetId: entry.decision?.targetId ? String(entry.decision.targetId) : undefined,
        reason: entry.decision?.reason || '',
        moneyAfter: undefined, // optional; captured post-apply money would require log struct change (kept out of scope)
      })),
      recentMoneyTrend: (snap as any).recentEarningsDelta ?? (((snap.money ?? resident.money) - ((snap as any).prevMoney || (snap.money ?? resident.money) * 0.92)) || 0),
      // Real-world brainstorm signals (additive): rent visibility (already deducted Fridays), transport for time save, interview for boss talks.
      // Enables AI decisions to be informed + produce real effects (shorter commutes, rent-aware home plays, wage negotiation).
      currentHomeRent: this.locationsSystem ? (this.locationsSystem as any).getEffectiveMonthlyRent?.(resident.homeId) ?? (this.locationsSystem as any).getMonthlyRent?.(resident.homeId) ?? 0 : 0,
      lastRentPaid: (snap as any).lastRentPaid ?? (resident as any).lastRentPaid ?? 0,
      hasPersonalTransport: !!(snap as any).hasPersonalTransport || !!(resident as any).hasPersonalTransport,
      interviewTargetId: (snap as any).interviewTargetId ?? (resident as any).interviewTargetId ?? null,
      // CIM net wealth exposure in AI citizen ctx (for brain optimization + rig SUCCESS on high net / riches+lowBurn)
      netWealth: (snap as any).netWealth ?? (typeof (resident as any).getNetWealth === 'function' ? (resident as any).getNetWealth() : 0),
      lifetimeNet: (snap as any).lifetimeNet ?? (typeof (resident as any).getLifetimeNet === 'function' ? (resident as any).getLifetimeNet() : 0),
      // Fuller first-class vehicle/transport signals (additive): own flag+value, market price for available cars, est that reflects current ownership (AI sees real benefit of acquire),
      // small ongoing parking/fuel cost proxy in ctx (realism signal for future voluntary decisions without auto-draining money here).
      ownsVehicle: !!(snap as any).ownsVehicle || !!(resident as any).ownsVehicle || !!(snap as any).hasPersonalTransport || !!(resident as any).hasPersonalTransport,
      vehicleValue: Math.round(((snap as any).vehicleValue ?? (resident as any).vehicleValue ?? 0) * 100) / 100,
      availableTransportPrice: (this.locationsSystem as any)?.getAvailableCarMarketPrice?.(resident.id?.length || 0) ?? 250,
      estimatedDailyTransportCost: 1.4, // parking/fuel ongoing cost signal (AI-visible realism for "owning has maintenance price" in decisions)
      // Rough commute time est for current work (dist/speed default); now factors owned transport for accurate AI weighing (shorter est if owns -> buy decision makes sense for farther high-wage).
      estimatedCommuteMinutesToWork: (this.locationsSystem as any)?.distanceBetween && (this.locationsSystem as any)?.estimateTravelTimeMinutes
        ? (() => {
            const base = (this.locationsSystem as any).estimateTravelTimeMinutes( (this.locationsSystem as any).distanceBetween(resident.currentLocationId, resident.workId) );
            const hasT = !!(snap as any).hasPersonalTransport || !!(resident as any).hasPersonalTransport || !!(snap as any).ownsVehicle || !!(resident as any).ownsVehicle;
            return hasT ? Math.max(3, Math.ceil(base * 0.62)) : base;
          })()
        : 15,

      // === CIM food/grocery market (additive): price signal + relief for 'purchase_food' voluntary decision in brains/rig ===
      // Simple variance from Locations helper (drama/seed modulated); AI reads currentHunger + price vs dailyPotential.
      // Self-check: voluntary buy -> money sink + stronger relief (5-8) + buffer (sustained activity/earnings).
      currentHunger: (snap.needs?.hunger ?? (resident as any).needs?.hunger ?? 0),
      lastFoodSpend: (snap as any).lastFoodSpend ?? (resident as any).lastFoodSpend ?? 0,
      foodPriceSignal: (() => {
        const info = (this.locationsSystem as any)?.getFoodMarketInfo ? (this.locationsSystem as any).getFoodMarketInfo((resident.id?.length || 0), 0) : null;
        return info ? info.availableFoodPrice : 4.5;
      })(),
      foodReliefPotential: (() => {
        const info = (this.locationsSystem as any)?.getFoodMarketInfo ? (this.locationsSystem as any).getFoodMarketInfo((resident.id?.length || 0), 0) : null;
        return info ? info.foodReliefPotential : 6.5;
      })(),
    };

    return context;
  }

  /**
   * Apply a high-level decision from an AI brain (or human tester) in a safe, validated way.
   * The physical systems (Movement, arrival handling, work shifts, rent) still execute normally.
   * Returns true if the decision was applied.
   */
  applyResidentDecision(residentId: ResidentId, decision: ResidentDecision): boolean {
    const resident = this.residents.get(residentId);
    if (!resident) return false;

    const day = Math.floor(this.timeSystem.timeHours / 24);
    const tick = this.timeSystem.tick;

    try {
      if (decision.type === 'activity' && decision.activity) {
        // Direct activity override (for testing / strong AI intent). Respect commute guard.
        if (resident.commuteTargetId) {
          // Let the commute finish; the AI can influence the *next* decision point.
          return false;
        }
        (resident as any).currentActivity = decision.activity;
        if (decision.durationTicks) {
          // Light support for timed override (future: could set a temp override flag)
        }
        resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
        return true;
      }

      if (decision.type === 'job_target' && decision.targetId) {
        // Normalize via resolver to a real business id (if possible) *before setting*.
        // This + resolver ensures jobHuntTargetId is a hireable key for attempt/runBasicJobSearch + arrival switch + uplift,
        // even if the decision came from a LocationId in availableWorkplaces.
        let targetToUse: any = decision.targetId;
        if (this.businessSystem && typeof this.businessSystem.getBusinessForJobTarget === 'function') {
          const resolved = this.businessSystem.getBusinessForJobTarget(decision.targetId);
          if (resolved) targetToUse = resolved;
        }
        // Real job switching support: set the target so Movement and job search respect it.
        resident.jobHuntTargetId = targetToUse as any;  // now a BusinessId (or original loc id if unresolvable); works as commute loc due to id alignment in spawn
        if (!resident.commuteTargetId) {
          // Encourage movement toward it on next update
          (resident as any).currentActivity = 'commuting_to_work';
        }
        // Note: immediate hire is opportunistic (if businessSystem accessible); the enhanced runBasicJobSearch will strongly prefer the target anyway.
        // For full agent agency, on next job search tick or arrival, the preference + boosted chance will get the AI resident hired at the chosen place.
        // This + Movement bias gives real "I choose this job and pursue it" realism.
        resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
        return true;
      }

      if (decision.type === 'home_target' && decision.targetId) {
        // For city sim world realism + free markets: AI resident chooses home based on economic signals (rent % in ctx).
        // Set preferred so HM step respects voluntary choice; market "clears" via resident moves affecting occupancy/rent pressure.
        resident.preferredHomeTargetId = decision.targetId as LocationId;
        resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
        return true;
      }

      // consumption / social can be no-ops for v0 or drive small money/need deltas directly
      if (decision.type === 'consumption' && resident.money > 1) {
        const spend = Math.min(2, resident.money * 0.1);
        resident.money = Math.max(0, resident.money - spend);
        resident.needs.hunger = Math.max(0, resident.needs.hunger - 4);
        resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
        return true;
      }

      if (decision.type === 'purchase_food') {
        // Dynamic food market: real voluntary spend using price signal from ctx/Locations.
        // Stronger relief than passive at_home (5-8 vs 0.9) + tiny fatigue bonus + satisfied buffer (slows hunger creep in Resident).
        // Self-check: AI reads foodPriceSignal + currentHunger + reliefPot + dailyPotential in ctx -> decide -> money sink + relief + sustained activity/earnings.
        const info = (this.locationsSystem as any)?.getFoodMarketInfo ? (this.locationsSystem as any).getFoodMarketInfo((resident.id?.length || 0), 0) : null;
        const basePrice = info ? info.availableFoodPrice : 4.5;
        const hunger = resident.needs.hunger || 0;
        // Spend scaled by urgency (capped)
        const spend = Math.min(resident.money, Math.max(basePrice * 0.85, Math.min(basePrice * 2.1, resident.money * 0.07 + (hunger > 65 ? 1.8 : 0))));
        resident.money = Math.max(0, resident.money - spend);
        const relief = Math.max(5.0, Math.min(8.2, (hunger / 13) + ((info ? info.foodReliefPotential : 6.5) - 1)));
        resident.needs.hunger = Math.max(0, resident.needs.hunger - relief);
        // tiny fatigue bonus (satisfied)
        resident.needs.fatigue = Math.max(0, resident.needs.fatigue - 1.3);
        resident.lastFoodSpend = spend;
        // buffer slows next creep -> physical schedule effect (less early leave from work, more sustained activity)
        (resident as any).foodSatisfiedUntil = tick + 95;
        resident.recordConsumptionSpend?.(spend);
        resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
        return true;
      }

      if (decision.type === 'conserve') {
        // Give AI spending agency: reduce burn for wealth building (pairs with richer ctx for smart timing).
        resident.conserveUntilTick = tick + (decision.durationTicks || 120);  // default ~2 hours
        resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
        return true;
      }

      if (decision.type === 'acquire_transport') {
        // Fuller vehicle (additive): use Locations market price signal for "available car".
        // Voluntary buy -> money sink + owns flag + value set -> Movement applies shorter real commute durations (physical effect on roads) + unlocks farther high-wage earnings w/o as much time/fatigue.
        // Market reallocation of fast transport value.
        const price = (this.locationsSystem as any)?.getAvailableCarMarketPrice?.(resident.id?.length || 0) ?? (220 + ((resident.id.length % 5) * 15));
        if (resident.money >= price) {
          resident.money -= price;
          resident.ownsVehicle = true;
          resident.vehicleValue = price;
          (resident as any).hasPersonalTransport = true;
          (resident as any).lastTransportCost = price;
          // CIM: transport asset proxy uplift for netWealth (voluntary acquire -> real time/earnings ROI in future commutes + ctx signals)
          if (typeof (resident as any).recordTransportAssetAcquired === 'function') {
            (resident as any).recordTransportAssetAcquired(price * 0.6); // proxy value for net (not full cost, effective asset)
          }
          resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
          return true;
        }
        return false;
      }

      // Support voluntary future sell (additive): produces real commute duration increase on roads + recoups value (market reallocation).
      // Sell returns ~65% value to money; clears flag so Movement reverts to baseline speed.
      if (decision.type === 'sell_transport' || decision.type === 'sell_vehicle') {
        const has = resident.ownsVehicle || !!(resident as any).hasPersonalTransport;
        if (has) {
          const resale = Math.max(70, Math.floor(((resident.vehicleValue || (resident as any).lastTransportCost || 220) * 0.65)));
          resident.money += resale;
          resident.ownsVehicle = false;
          resident.vehicleValue = 0;
          (resident as any).hasPersonalTransport = false;
          resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
          return true;
        }
        return false;
      }

      if (decision.type === 'interview') {
        // Brainstorm: talk to boss at current (or target) for better job/pay. Voluntary social choice at location.
        // Physics later in Business (small uplift chance based on state). Here just set intent flag (like job target).
        const tgt = decision.targetId || resident.workId || resident.currentLocationId;
        (resident as any).interviewTargetId = tgt;
        resident.recordResidentDecision?.({ timestamp: Date.now(), simDay: day, decision });
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /** God Mode / test helper to attach a brain to a specific resident. */
  setResidentBrain(residentId: ResidentId, brain: IResidentDecisionMaker | undefined): boolean {
    const r = this.residents.get(residentId);
    if (!r) return false;
    r.setBrain?.(brain);
    return true;
  }
}
