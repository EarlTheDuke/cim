/**
 * Resident Entity
 * 
 * Represents a single person living in the city.
 * This is the core data model for Phase 1.
 *
 * === NEEDS SYSTEM (Phase 1 expansion) ===
 * Design notes (see task requirements):
 * - 3 needs added for starters (hunger, fatigue [evolving energy], social).
 *   Extensible: easy to add e.g. hygiene, moneyStress later as 4th+.
 * - Needs are 0-100 numeric values (high = more urgent/negative for hunger/fatigue/social).
 * - Rates are per-tick (60 ticks = 1 simulated hour). Tuned for noticeable daily impact:
 *     hunger  ~ +7.2 / hour baseline  => significant after 10-14h
 *     fatigue ~ builds 7-13 /h awake/work, recovers ~15/h while sleeping
 *     social  ~ slow loneliness creep, relieved at home
 * - All needs clamped [0,100].
 * - Behavior influence: needs can OVERRIDE the pure time-based schedule.
 *   Examples implemented:
 *     * High fatigue near/after work end => sleep early.
 *     * High hunger during work hours => leave/skip work, go 'at_home' and "eat".
 *     * High social (lonely) in morning window => linger 'at_home'.
 *   This is intentionally simple rule-based priority injection, not full utility AI yet.
 *   Future layers (Phase 1+): personality multipliers, location effects, decision logging.
 * - Energy evolved: now derived from fatigue (energy = 100 - fatigue).
 *   Public `energy` retained for snapshot/inspector compat + existing tests.
 *   All mutation logic moved to `needs.fatigue`.
 * - Snapshot includes full `needs` (inspector friendly) + legacy energy.
 * - Employment: Residents now carry `employerId` (BusinessId | null) + isEmployed()/setEmployer() for bidirectional
 *   linkage with Business entities (coordinated via BusinessSystem). Includes simple hire/fire side effects on needs.
 * - Unemployment model (lightweight): `unemploymentDurationTicks` (self-managed in update + helper), auto social/fatigue pressure
 *   for long-term unemp, daytime schedule flexibility for job-search feel, exposed in snapshots/inspector. Basic job search
 *   behavior + hiring bias lives in BusinessSystem.runBasicJobSearch (duration-weighted prob, workId preference, soft caps).
 * - No new Activity types; no external dependencies (food stock etc). Eating is simulated
 *   via passive reduction when at_home + hungry (placeholder until homes/economy link).
 * - ResidentsSystem / Simulation unchanged in contract; only Resident internals + tests updated.
 * - Kept deliberately non-overengineered per Phase 1 scope.
 */

import type { LocationId, Position } from './Location';
import type { BusinessId } from './Business';
import type { IResidentDecisionMaker, ResidentDecision } from '../systems/residents/ResidentBrain';

export type ResidentId = string;

export type Activity = 
  | 'sleeping'
  | 'at_home'
  | 'commuting_to_work'
  | 'working'
  | 'commuting_home'
  | 'at_work'   // legacy alias, prefer 'working'
  | 'idle';

export interface DailySchedule {
  wakeUpHour: number;     // e.g. 7
  workStartHour: number;  // e.g. 9
  workEndHour: number;    // e.g. 17
  sleepHour: number;      // e.g. 23
}

export interface ResidentState {
  id: ResidentId;
  name: string;

  // Economy
  money: number;
  hourlyWage: number;

  // Employment (deeper Business-Resident integration)
  // employerId links to a Business when employed; null / absent means unemployed.
  // Maintained via BusinessSystem.hireEmployee / fireEmployee for bidirectional consistency.
  employerId: BusinessId | null;

  // Unemployment tracking (lightweight for viz + behavioral effects)
  // Duration in ticks (1 tick ~1 sim minute). Self-managed inside update() + public updateUnemploymentClock() helper (for tests/God Mode).
  // 0 when employed (reset via setEmployer). Powers inspector, charts, long-term social/hunger pressure, job search behavior + hiring bias in BusinessSystem.
  unemploymentDurationTicks?: number;

  // Location & Movement (Phase 2+)
  homeId: LocationId;
  workId: LocationId;
  currentLocationId: LocationId;
  position: Position;

  // Movement internals (observable for save/load + inspectors)
  commuteTargetId?: LocationId | null;

  // Schedule & State
  schedule: DailySchedule;
  currentActivity: Activity;

  // Needs system (expanded in Phase 1)
  // All 0-100. Higher values generally mean more pressing/negative state.
  needs: {
    hunger: number;   // 0=sated ... 100=starving
    fatigue: number;  // 0=rested ... 100=exhausted (drives legacy energy)
    social: number;   // 0=fulfilled ... 100=lonely/isolated
  };

  // Legacy: kept for inspector + test compatibility during energy -> needs.fatigue evolution.
  // Prefer using snapshot.needs.fatigue in new code. energy ≈ 100 - fatigue.
  energy: number;   // 0-100 (derived)
}

/**
 * Complete serializable state for a Resident (used by Scenario Tools + full save/load).
 * Includes every mutable field so we can perfectly reconstruct simulation state.
 * Kept in sync with the evolved ResidentState + Movement + Business integration fields.
 */
export interface ResidentFullState {
  id: ResidentId;
  name: string;
  money: number;
  hourlyWage: number;
  employerId?: string | null; // Business integration
  unemploymentDurationTicks?: number; // 0 when employed; tracks continuous joblessness for viz + effects
  homeId: LocationId;
  workId: LocationId;
  currentLocationId: LocationId;
  position: Position;
  commuteTargetId?: LocationId | null;
  schedule: DailySchedule;
  currentActivity: Activity;
  needs: { hunger: number; fatigue: number; social: number };
  energy: number;
  // Internal movement timing for perfect commute restore in scenarios
  commuteStartTick?: number;
  commuteDurationTicks?: number;
  // Agentic AI citizen fields (job/home targets + spending control for free-market life choices)
  jobHuntTargetId?: LocationId | null;
  preferredHomeTargetId?: LocationId | null;
  // Brainstorm real-world: transport ownership for commute time savings (voluntary buy -> shorter real durations -> schedule/earnings effects)
  hasPersonalTransport?: boolean;
  // Fuller first-class vehicle/transport (additive): own flag + value for market/sell/reallocation + dynamic Movement effects.
  ownsVehicle?: boolean;
  vehicleValue?: number;
  // Interview target for "talk to boss" to get better pay (voluntary social choice -> possible uplift)
  interviewTargetId?: LocationId | null;
  // Visibility for rent (already deducted on Fridays; now per-player last paid for ctx + logs)
  lastRentPaid?: number;
  conserveUntilTick?: number | null;

  // === CIM: Net Wealth / Effective Wealth Tracking (richer "win" conditions for AI citizens)
  // Cumulative earned wages - rents paid - food/transport/general spends + asset proxies
  // (transport value for time/earnings ROI; home "savings" from low-pressure/cheaper moves).
  // Voluntary choices (job_target for higher wage, home_target for rent relief, acquire_transport, conserve)
  // directly drive real + / - via the record* calls at actual money flows. Free markets (signals in ctx)
  // make the plays meaningful. Exposed as netWealth / lifetimeNet in snapshots + ResidentContext.
  cumulativeWagesEarned?: number;
  cumulativeRentsPaid?: number;
  cumulativeConsumptionSpend?: number;
  transportAssetProxy?: number;
  homeSavingsProxy?: number;

  // CIM food/grocery (additive for purchase_food decision + buffer)
  lastFoodSpend?: number;
  foodSatisfiedUntil?: number;
}

export class Resident {
  public readonly id: ResidentId;
  public name: string;

  public money: number;
  public hourlyWage: number;

  // Employment linkage (bidirectional with Business.employeeIds via BusinessSystem)
  public employerId: BusinessId | null = null;

  // Agentic: preferred job target from AI decisions (for real job switching / hunting)
  public jobHuntTargetId: LocationId | null = null;

  // Agentic: preferred home target from AI decisions (for realistic housing market choices).
  public preferredHomeTargetId: LocationId | null = null;

  // Agentic: temp flag for 'conserve' decision to reduce spending for wealth (realism: residents can choose to save).
  public conserveUntilTick: number | null = null;
  // Real-world brainstorm incremental (additive): transport for commute time save, interview for boss talks, rent visibility.
  public hasPersonalTransport: boolean = false;
  public interviewTargetId: LocationId | null = null;
  public lastRentPaid: number = 0;

  // Fuller first-class vehicle/transport ownership (additive for real-world fidelity CIM).
  // buy/sell/own + value enables: money sink on acquire, dynamic shorter commutes in Movement, market price signals,
  // voluntary sell for reallocation, time-saved earnings opportunity (farther high-wage jobs feasible w/o fatigue).
  // Legacy hasPersonalTransport kept in sync for compat (ctx, snapshots, Movement).
  public ownsVehicle: boolean = false;
  public vehicleValue: number = 0;

  /** Continuous ticks unemployed (reset on hire via setEmployer / clock). Public for inspector/charts/systems + direct test/God Mode stepping. */
  public unemploymentDurationTicks: number = 0;

  public homeId: LocationId;
  public workId: LocationId;
  public currentLocationId: LocationId;

  public schedule: DailySchedule;
  public currentActivity: Activity = 'sleeping';

  // Needs (public for easy inspection / God Mode tools)
  public needs = {
    hunger: 0,
    fatigue: 0,
    social: 25, // start partially satisfied
  };

  // CIM food purchase (additive): last spend for ctx/inspector, satisfied buffer slows hunger creep after voluntary buy (sustained activity effect)
  public lastFoodSpend: number = 0;
  public foodSatisfiedUntil: number = 0;

  // Legacy energy (derived from fatigue for compat; see class docs)
  public energy: number = 100;

  // === Movement (basic Phase 2) ===
  /** Current world position. Updated by MovementSystem during commutes. Snapped to location when docked. */
  public position: Position = { x: 0, y: 0 };

  /** Target location ID when actively commuting (null when at a destination). Managed by MovementSystem. */
  public commuteTargetId: LocationId | null = null;

  /** Tick at which current commute began (internal to movement timing). */
  private commuteStartTick: number = 0;

  /** Planned duration in ticks for current commute (internal to movement timing). */
  private commuteDurationTicks: number = 0;

  /** Tick when this resident's current work shift should end.
   *  Set when they arrive at work. Prevents them from immediately heading home due to clock-based schedule. */
  private workShiftEndTick: number | null = null;

  constructor(params: {
    id: ResidentId;
    name: string;
    homeId: LocationId;
    workId: LocationId;
    hourlyWage: number;
    schedule?: Partial<DailySchedule>;
  }) {
    this.id = params.id;
    this.name = params.name;
    this.homeId = params.homeId;
    this.workId = params.workId;
    this.currentLocationId = params.homeId;
    this.hourlyWage = params.hourlyWage;
    this.money = 0;
    this.position = { x: 0, y: 0 };

    // Default reasonable schedule
    this.schedule = {
      wakeUpHour: 7,
      workStartHour: 9,
      workEndHour: 17,
      sleepHour: 23,
      ...params.schedule,
    };
  }

  // === Needs rates (per tick; 60 ticks = 1 hour). Tuned for daily relevance. ===
  // Phase A Core Stabilization: modestly higher rates + consumption for more visible need-driven behavior
  // (more overrides -> varied activities/commutes) and small economic spending flows.
  private static readonly HUNGER_RATE = 0.135;         // ~8.1 / hour baseline (slightly faster pressure)
  private static readonly FATIGUE_WORK_RATE = 0.24;   // ~14.4 / hour while working (tiring)
  private static readonly FATIGUE_AWAKE_RATE = 0.11;  // ~6.6 / hour general awake time
  private static readonly FATIGUE_SLEEP_RECOVERY = 0.26; // ~15.6 / hour while sleeping
  private static readonly SOCIAL_LONELINESS_RATE = 0.009; // slow creep
  private static readonly SOCIAL_HOME_RELIEF = 0.13;  // relief when at home (evenings/family)

  // Thresholds for need-driven overrides (simple but effective)
  // Phase A: lowered for more frequent need-driven trips and behavior (more visible home<->work movement,
  // early leaves, etc.) while still feeling purposeful. Prioritizes dynamic populated feel.
  private static readonly HUNGER_URGENT = 55;
  private static readonly FATIGUE_EXHAUSTED = 70;
  private static readonly SOCIAL_LONELY = 62;

  // === Unemployment model (lightweight, for viz + job search behavior + long-term effects) ===
  private static readonly LONG_UNEMP_SOCIAL_TICKS = 600;   // ~10 sim hours: start morale creep
  private static readonly VERY_LONG_UNEMP_TICKS = 2400;    // ~40 sim hours: stronger economic stress proxy

  /** Called every simulation tick by the ResidentsSystem */
  update(hourOfDay: number, minute: number, tick: number = 0): void {
    const currentHour = hourOfDay + minute / 60;

    // 0. Unemployment clock, long-term effects (self-managed for encapsulation; powers viz + behavior)
    //    Called before needs/activity so duration is fresh for overrides and stress.
    this.updateUnemploymentClockAndEffects();

    // 1. Advance needs every tick (time + activity modifiers)
    this.advanceNeeds(currentHour, tick);

    // 2. Compute baseline activity from schedule (original simple logic)
    let activity: Activity = this.getScheduledActivity(currentHour);

    // 3. Apply need-based overrides / influences (this is the key behavior change)
    activity = this.applyNeedOverrides(activity, currentHour);

    // 4. IMPORTANT FIX: While actively commuting, never let the schedule/need logic
    //    overwrite the commuting state.
    if (this.commuteTargetId) {
      const isToWork = this.commuteTargetId === this.workId;
      activity = isToWork ? 'commuting_to_work' : 'commuting_home';
    }

    // 5. Work shift persistence (realistic behavior):
    //    Once someone arrives at work, they stay for their scheduled shift (adjusted for actual
    //    arrival time) instead of ping-ponging home the moment the clock says "workEndHour".
    //    This is the core fix for "they arrive at work and immediately head home".
    if (this.currentLocationId === this.workId &&
        this.employerId !== null &&
        this.workShiftEndTick &&
        tick < this.workShiftEndTick) {
      activity = 'working';
    }

    // 6. Commit activity
    this.currentActivity = activity;

    // Phase A Core Stabilization + agentic: small awake consumption/spending so money circulates.
    // AI 'conserve' decision (from wealth-max play) reduces this burn to let agents build capital.
    // This gives spending control as a real lever (pairs with job/home targets for free-market strategy).
    const isSleepingForSpend = currentHour >= this.schedule.sleepHour || currentHour < this.schedule.wakeUpHour;
    if (!isSleepingForSpend && this.money > 0.1) {
      let spendMultiplier = 1.0;
      if (this.conserveUntilTick && tick < this.conserveUntilTick) {
        spendMultiplier = 0.2;  // AI conserve decision: greatly reduce spending to build wealth (agency + realism).
      }
      const spendRate = this.employerId ? 0.035 : 0.018; // slightly higher spend if earning
      const spend = Math.min(spendRate, this.money * 0.002) * spendMultiplier;
      this.money = Math.max(0, this.money - spend);
      this.recordConsumptionSpend(spend);  // CIM: track for netWealth (voluntary conserve reduces this burn)
    }

    // 7. Apply side effects of the *final* activity (money accrual etc.)
    // NOTE (Phase A robustness): Per-minute wage accrual removed to eliminate double/triple income with
    // explicit daily payroll in BusinessSystem.disburseRealWages (single source of truth for wages).
    // Activity still drives visible 'working' state for movement/commute viz + needs.
    // Unemployed do not earn (correct behavior preserved).

    // 8. Keep legacy energy in sync (derived from fatigue)
    this.energy = Math.max(0, Math.min(100, 100 - this.needs.fatigue));
  }

  /** Advance all needs with time-of-day and activity aware rates. */
  private advanceNeeds(currentHour: number, currentTick?: number): void {
    const isSleeping = currentHour >= this.schedule.sleepHour || currentHour < this.schedule.wakeUpHour;
    const isWorking = currentHour >= this.schedule.workStartHour && currentHour < this.schedule.workEndHour;
    const isEveningHomeTime = currentHour >= this.schedule.workEndHour && currentHour < this.schedule.sleepHour;

    // Hunger: always increases (biological). No real "eating" yet — simulated via overrides below.
    // If recent purchase_food, satisfied buffer (set in apply) slows creep -> less overrides, more sustained work time (real schedule effect).
    let hungerCreep = Resident.HUNGER_RATE;
    if (this.foodSatisfiedUntil > 0 && currentTick !== undefined && currentTick < this.foodSatisfiedUntil) {
      hungerCreep *= 0.18; // buffer strongly damps creep (additive physical fidelity)
    }
    this.needs.hunger = Math.min(100, this.needs.hunger + hungerCreep);

    // Fatigue: strongly activity dependent (purely time + schedule driven for predictability)
    if (isSleeping) {
      this.needs.fatigue = Math.max(0, this.needs.fatigue - Resident.FATIGUE_SLEEP_RECOVERY);
    } else if (isWorking) {
      this.needs.fatigue = Math.min(100, this.needs.fatigue + Resident.FATIGUE_WORK_RATE);
    } else {
      this.needs.fatigue = Math.min(100, this.needs.fatigue + Resident.FATIGUE_AWAKE_RATE);
    }

    // Social: slow loneliness creep; meaningful relief during evening home time
    if (isEveningHomeTime) {
      this.needs.social = Math.max(0, this.needs.social - Resident.SOCIAL_HOME_RELIEF);
    } else {
      this.needs.social = Math.min(100, this.needs.social + Resident.SOCIAL_LONELINESS_RATE);
    }

    // === Unemployment effects (lightweight behavioral/economic consequences) ===
    // Long-term joblessness adds extra social pressure (stress, isolation) + slight schedule flexibility.
    // Duration tracked in ticks; effects scale gently after hours/days of unemployment.
    if (this.employerId === null) {
      const durH = (this.unemploymentDurationTicks || 0) / 60;
      if (durH > 4) {
        // After ~4 hours: extra social creep (job search frustration / stigma)
        const extraCreep = 0.012 * Math.min(3, durH / 8); // ramps modestly
        this.needs.social = Math.min(100, this.needs.social + extraCreep);
      }
      if (durH > 18) {
        // Day+ unemployed: stronger pressure + mild extra fatigue (discouragement)
        this.needs.social = Math.min(100, this.needs.social + 0.025);
        this.needs.fatigue = Math.min(100, this.needs.fatigue + 0.008);
      }
    }

    // Clamp all (defensive)
    this.needs.hunger = Math.max(0, Math.min(100, this.needs.hunger));
    this.needs.fatigue = Math.max(0, Math.min(100, this.needs.fatigue));
    this.needs.social = Math.max(0, Math.min(100, this.needs.social));
  }

  /**
   * Self-contained unemployment duration tracking + light long-term effects.
   * - Increments while employerId === null (resets to 0 when employed via setEmployer or here).
   * - Applies slow social (and later hunger) creep for prolonged joblessness — visible in inspector/charts.
   * - Called every tick from update().
   */
  private updateUnemploymentClockAndEffects(): void {
    if (this.employerId !== null) {
      if (this.unemploymentDurationTicks !== 0) this.unemploymentDurationTicks = 0;
      return;
    }
    const prev = this.unemploymentDurationTicks || 0;
    this.unemploymentDurationTicks = prev + 1;

    const dur = this.unemploymentDurationTicks;
    if (dur > Resident.LONG_UNEMP_SOCIAL_TICKS) {
      // Loneliness / morale pressure from joblessness
      this.needs.social = Math.min(100, this.needs.social + 0.012);
    }
    if (dur > Resident.VERY_LONG_UNEMP_TICKS) {
      // Stronger proxy for economic hardship (reduced ability to meet basic needs)
      this.needs.social = Math.min(100, this.needs.social + 0.01);
      this.needs.hunger = Math.min(100, this.needs.hunger + 0.006);
    }
  }

  /** Original time-based schedule logic extracted (baseline before needs). */
  private getScheduledActivity(currentHour: number): Activity {
    if (currentHour >= this.schedule.sleepHour || currentHour < this.schedule.wakeUpHour) {
      return 'sleeping';
    }
    if (currentHour >= this.schedule.wakeUpHour && currentHour < this.schedule.workStartHour) {
      return 'at_home';
    }
    if (currentHour >= this.schedule.workStartHour && currentHour < this.schedule.workEndHour) {
      return 'working';
    }
    if (currentHour >= this.schedule.workEndHour && currentHour < this.schedule.sleepHour) {
      return 'at_home';
    }
    return 'idle';
  }

  /**
   * Need-driven behavior overrides.
   * Needs take priority over strict schedule in meaningful (but simple) ways.
   * This fulfills the requirement that "needs start to influence or override the simple schedule".
   */
  private applyNeedOverrides(baseActivity: Activity, currentHour: number): Activity {
    let activity = baseActivity;

    // Priority 1: Extreme fatigue -> sleep early (even before official sleepHour)
    if (this.needs.fatigue > Resident.FATIGUE_EXHAUSTED &&
        currentHour >= this.schedule.workEndHour - 1.5) {
      activity = 'sleeping';
    }

    // Priority 2: High hunger during work -> skip/leave work early to "eat" at home
    // When at_home and hungry, simulate passive eating (reduces need) + small money spend for visible economic outflow.
    // Stronger reduction on state change to prevent rapid "flashing" between working <-> at_home around the threshold.
    if (this.needs.hunger > Resident.HUNGER_URGENT) {
      if (activity === 'working') {
        activity = 'at_home'; // go home early / skip work
        this.needs.hunger = Math.max(0, this.needs.hunger - 3.8); // strong enough to stop visible flashing in realtime (takes ~25-30 real seconds to recover)
      } else if (activity === 'at_home') {
        // Eat when home and hungry (placeholder until inventory/economy) + tiny spend for economic activity signal
        this.needs.hunger = Math.max(0, this.needs.hunger - 0.9);
        if (this.money > 0.5) {
          const spend = Math.min(0.8, this.money * 0.03); // small daily consumption spend when satisfying hunger
          this.money -= spend;
          this.recordConsumptionSpend(spend);  // CIM net tracking (food spend from need override)
        }
      }
    }

    // Priority 3: Very lonely in the morning window -> stay home a bit longer (social need)
    // Stronger relief to avoid chatter around the threshold.
    if (this.needs.social > Resident.SOCIAL_LONELY &&
        currentHour >= this.schedule.wakeUpHour &&
        currentHour < this.schedule.workStartHour + 0.75) {
      activity = 'at_home';
      this.needs.social = Math.max(0, this.needs.social - 6);
    }

    // === Long-term unemployed schedule flexibility (job search / discouragement behavior) ===
    // After many hours unemployed, during core "work window" they are more likely to linger at home
    // (looking for work, resting from stress, or reduced routine). Gives visible differentiation vs employed.
    if (this.employerId === null) {
      const durH = (this.unemploymentDurationTicks || 0) / 60;
      if (durH > 6 &&
          currentHour >= this.schedule.workStartHour + 0.5 &&
          currentHour < this.schedule.workEndHour - 1.0) {
        // Higher social pressure or just long unemp -> more home/idle time instead of "working"
        if (this.needs.social > 35 || durH > 20) {
          activity = 'at_home';
        }
      }
    }

    return activity;
  }

  /** Receive money (now used only for one-time effects like hire bonuses/severance; weekly lump removed in Phase A for wage unification). */
  receivePayday(amount: number): void {
    this.money += amount;
  }

  // === Employment integration (Business-Resident linkage) ===
  /** Returns true if this resident currently has an employerId set. */
  isEmployed(): boolean {
    return this.employerId !== null;
  }

  /** Returns the current employer BusinessId (or null). */
  getEmployerId(): BusinessId | null {
    return this.employerId;
  }

  /**
   * Advance (or reset) the unemployment duration clock by 1 tick.
   * Public helper primarily for direct unit tests + God Mode manual steps.
   * In the live simulation, Resident.update() fully owns clock advancement + long-term effects (social/hunger creep).
   * Lightweight; side effects (needs pressure) applied inside the private updateUnemploymentClockAndEffects path.
   */
  updateUnemploymentClock(): void {
    if (this.employerId === null) {
      this.unemploymentDurationTicks = (this.unemploymentDurationTicks || 0) + 1;
    } else {
      this.unemploymentDurationTicks = 0;
    }
  }

  /**
   * Set or clear employment linkage.
   * Called by BusinessSystem during coordinated hire/fire to keep resident + business in sync.
   * Includes simple observable side-effects for depth:
   *   - Newly hired: slight social relief (job security).
   *   - Fired (to null): social stress bump (job loss impact on wellbeing).
   * These are lightweight hooks; future layers (personality, agentic decisions, EconomySystem) can expand.
   * Money effects (bonus/severance) are applied by the caller (BusinessSystem) which has business cash context.
   */
  setEmployer(employerId: BusinessId | null): void {
    const wasEmployed = this.employerId !== null;
    const newId = employerId || null;

    if (newId === this.employerId) return; // no change

    this.employerId = newId;

    if (newId && !wasEmployed) {
      // Hired: modest social relief
      this.needs.social = Math.max(0, this.needs.social - 8);
      this.unemploymentDurationTicks = 0; // reset joblessness clock
    } else if (!newId && wasEmployed) {
      // Fired: job loss stress
      this.needs.social = Math.min(100, this.needs.social + 12);
      // unemployment clock will start accumulating on next system tick
    }

    // Keep derived energy in sync
    this.energy = Math.max(0, Math.min(100, 100 - this.needs.fatigue));
  }

  // === Movement helpers (called primarily by MovementSystem) ===

  /**
   * Begin (or restart) a timed commute toward targetId.
   * Sets commuting activity and internal timing fields.
   */
  beginCommute(targetId: LocationId, durationTicks: number, startTick: number): void {
    if (targetId === this.currentLocationId) {
      this.arrive();
      return;
    }
    this.commuteTargetId = targetId;
    this.commuteStartTick = startTick;
    this.commuteDurationTicks = Math.max(1, Math.floor(durationTicks));
    this.currentActivity = targetId === this.workId ? 'commuting_to_work' : 'commuting_home';
  }

  /**
   * Current [0,1] progress through active commute (0 if none).
   * Uses the provided currentTick for calculation (MovementSystem supplies authoritative tick).
   */
  getCommuteProgress(currentTick: number): number {
    if (!this.commuteTargetId || this.commuteDurationTicks <= 0) return 0;
    const elapsed = currentTick - this.commuteStartTick;
    return Math.min(1, Math.max(0, elapsed / this.commuteDurationTicks));
  }

  /**
   * Finalize arrival: snap currentLocationId, clear commute state, set final docked activity.
   * Idempotent and safe to call multiple times.
   */
  arrive(): void {
    if (this.commuteTargetId) {
      this.currentLocationId = this.commuteTargetId;
      this.commuteTargetId = null;
      this.commuteDurationTicks = 0;
      const isWork = this.currentLocationId === this.workId;
      this.currentActivity = isWork ? 'working' : 'at_home';

      if (isWork && this.employerId !== null) {
        // Shift end will be set by MovementSystem with proper schedule-aware timing
      } else {
        // Arrived home (or unemployed) → clear any active work shift
        this.workShiftEndTick = null;
      }
    }
  }

  /** Cancel any in-flight commute (useful for future teleport / god-mode actions). */
  cancelCommute(): void {
    this.commuteTargetId = null;
    this.commuteDurationTicks = 0;
  }

  /** Set when this resident's current work shift ends (in simulation ticks).
   *  Called by MovementSystem upon arrival at work. */
  setWorkShiftEnd(endTick: number): void {
    this.workShiftEndTick = endTick;
  }

  // === Phase 0 Agentic Residents (AI Citizens) support ===
  // Mirrors Business brain attachment for swappable rule-based or real LLM control.
  // When no brain is set, behavior is 100% identical to pre-AI rule-based logic.
  private brain?: IResidentDecisionMaker;
  private residentDecisionLog: Array<{ timestamp: number; simDay: number; decision: ResidentDecision }> = [];

  // === CIM Net Wealth tracking (additive; driven by real voluntary flows in Residents/Business + Resident spend)
  // Self-check: only incremented at actual deduct/uplift sites (wage credit, rent pay, consumption, rehome delta, acquire_transport).
  public cumulativeWagesEarned = 0;
  public cumulativeRentsPaid = 0;
  public cumulativeConsumptionSpend = 0;
  public transportAssetProxy = 0;
  public homeSavingsProxy = 0;

  /** Attach or clear a decision maker for this resident. */
  setBrain(brain: IResidentDecisionMaker | undefined): void {
    this.brain = brain;
  }

  getBrain(): IResidentDecisionMaker | undefined {
    return this.brain;
  }

  /** Record a decision (called by the system after a brain proposes and we apply). */
  recordResidentDecision(entry: { timestamp: number; simDay: number; decision: ResidentDecision }): void {
    this.residentDecisionLog.push(entry);
    if (this.residentDecisionLog.length > 32) this.residentDecisionLog.shift();
  }

  /** Recent decisions for inspector / God / traces. */
  getResidentDecisionLog() {
    return [...this.residentDecisionLog];
  }

  // === CIM Net Wealth / Effective Wealth (richer win conditions for AI citizen rig + brains)
  // All record* are called at the actual money flow or voluntary choice sites so net reflects
  // real strategy (higher wage jobs, cheaper homes via pressure signals, conserve, transport ROI).
  recordWageEarned(amount: number): void { if (amount > 0) this.cumulativeWagesEarned += amount; }
  recordRentPaid(amount: number): void { if (amount > 0) this.cumulativeRentsPaid += amount; }
  recordConsumptionSpend(amount: number): void { if (amount > 0) this.cumulativeConsumptionSpend += amount; }
  recordTransportAssetAcquired(value: number = 120): void { if (value > 0) this.transportAssetProxy += value; }
  recordHomeSavingsDelta(savings: number): void { if (savings > 0) this.homeSavingsProxy += savings; }

  /** Net wealth = cum wages - rents - consumption + transport asset proxy + home savings proxy (from voluntary plays). */
  getNetWealth(): number {
    return Math.round((this.cumulativeWagesEarned - this.cumulativeRentsPaid - this.cumulativeConsumptionSpend + this.transportAssetProxy + this.homeSavingsProxy) * 100) / 100;
  }
  /** Alias per task spec (lifetimeNet). */
  getLifetimeNet(): number { return this.getNetWealth(); }

  // === Public accessors for Richer Movement + Traffic data in Inspector & Charts ===
  /** Tick at which current commute began. Exposed for inspector / god tools (read-only view). */
  public getCommuteStartTick(): number {
    return this.commuteStartTick;
  }

  /** Planned duration (ticks) for current commute. Exposed for inspector / god tools. */
  public getCommuteDurationTicks(): number {
    return this.commuteDurationTicks;
  }

  /** Convenience wrapper: compute progress [0,1] at the supplied authoritative tick (from TimeSystem via UI). */
  public getCommuteProgressAt(currentTick: number): number {
    return this.getCommuteProgress(currentTick);
  }

  getSnapshot() {
    return {
      id: this.id,
      name: this.name,
      money: Math.round(this.money * 100) / 100,
      activity: this.currentActivity,
      energy: Math.round(this.energy),
      location: this.currentLocationId,
      // Employment (deeper integration)
      employerId: this.employerId,
      isEmployed: this.isEmployed(),
      unemploymentDurationHours: Math.round(((this.unemploymentDurationTicks || 0) / 60) * 10) / 10,
      jobHuntTargetId: this.jobHuntTargetId,
      preferredHomeTargetId: this.preferredHomeTargetId,
      conserveUntilTick: this.conserveUntilTick,
      hasPersonalTransport: !!this.hasPersonalTransport,
      interviewTargetId: this.interviewTargetId,
      lastRentPaid: this.lastRentPaid,
      // Movement (Phase 2) - live interpolated position during commutes
      position: {
        x: Math.round((this.position?.x ?? 0) * 100) / 100,
        y: Math.round((this.position?.y ?? 0) * 100) / 100,
      },
      // Needs are now first-class for inspection and debugging
      needs: {
        hunger: Math.round(this.needs.hunger),
        fatigue: Math.round(this.needs.fatigue),
        social: Math.round(this.needs.social),
      },
      lastFoodSpend: Math.round((this.lastFoodSpend || 0) * 100) / 100,
      foodSatisfiedUntil: this.foodSatisfiedUntil || 0,
      // Agentic brain (Phase 0 of resident AI initiative)
      brainName: this.brain?.name,
      recentDecisionCount: this.residentDecisionLog.length,
      // CIM net wealth (effective lifetime wealth from voluntary market plays)
      netWealth: this.getNetWealth(),
      lifetimeNet: this.getLifetimeNet(),
    };
  }

  /**
   * Returns the COMPLETE serializable state (all mutable + identity fields).
   * Used by Scenario Tools for save / export / round-trippable scenarios.
   */
  toJSON(): ResidentFullState {
    return {
      id: this.id,
      name: this.name,
      money: Math.round(this.money * 100) / 100,
      hourlyWage: this.hourlyWage,
      homeId: this.homeId,
      workId: this.workId,
      currentLocationId: this.currentLocationId,
      position: { x: this.position?.x ?? 0, y: this.position?.y ?? 0 },
      commuteTargetId: this.commuteTargetId,
      schedule: { ...this.schedule },
      currentActivity: this.currentActivity,
      // Employment for full scenario/save fidelity
      employerId: this.employerId,
      unemploymentDurationTicks: this.unemploymentDurationTicks ?? 0,
      jobHuntTargetId: this.jobHuntTargetId,
      preferredHomeTargetId: this.preferredHomeTargetId,
      conserveUntilTick: this.conserveUntilTick,
      hasPersonalTransport: !!this.hasPersonalTransport,
      // Fuller vehicle (additive first-class)
      ownsVehicle: !!this.ownsVehicle,
      vehicleValue: Math.round((this.vehicleValue || 0) * 100) / 100,
      interviewTargetId: this.interviewTargetId,
      lastRentPaid: this.lastRentPaid,
      needs: {
        hunger: Math.round(this.needs.hunger * 100) / 100,
        fatigue: Math.round(this.needs.fatigue * 100) / 100,
        social: Math.round(this.needs.social * 100) / 100,
      },
      energy: Math.round(this.energy),
      // CIM net wealth persistence (for 30/60/90d+ Crown long-runs + replay of AI citizen wealth stories)
      cumulativeWagesEarned: this.cumulativeWagesEarned,
      cumulativeRentsPaid: this.cumulativeRentsPaid,
      cumulativeConsumptionSpend: this.cumulativeConsumptionSpend,
      transportAssetProxy: this.transportAssetProxy,
      homeSavingsProxy: this.homeSavingsProxy,
      // food purchase state (for snapshot roundtrips + ctx)
      lastFoodSpend: Math.round((this.lastFoodSpend || 0) * 100) / 100,
      foodSatisfiedUntil: this.foodSatisfiedUntil || 0,
    };
  }

  /**
   * Re-hydrate / create a fully restored Resident from a saved full state.
   * This is the key enabler for Scenario loading and perfect simulation state restore.
   * All fields including current activity, exact needs, and money are restored.
   */
  static fromJSON(data: ResidentFullState): Resident {
    if (!data || !data.id) {
      throw new Error('Invalid resident data passed to Resident.fromJSON');
    }

    const resident = new Resident({
      id: data.id,
      name: data.name,
      homeId: data.homeId,
      workId: data.workId,
      hourlyWage: data.hourlyWage ?? 15,
      schedule: data.schedule,
    });

    // Restore mutable runtime state (bypass normal construction + update)
    resident.money = data.money ?? 0;
    resident.currentLocationId = data.currentLocationId || data.homeId;
    resident.currentActivity = data.currentActivity || 'at_home';

    // Employment restore (critical for inspector, charts, and scenario continuity)
    resident.employerId = (data as any).employerId ?? null;
    resident.unemploymentDurationTicks = (data as any).unemploymentDurationTicks ?? 0;
    resident.jobHuntTargetId = (data as any).jobHuntTargetId ?? null;
    resident.preferredHomeTargetId = (data as any).preferredHomeTargetId ?? null;
    resident.conserveUntilTick = (data as any).conserveUntilTick ?? null;
    resident.hasPersonalTransport = !!(data as any).hasPersonalTransport;
    // Fuller vehicle restore (additive)
    resident.ownsVehicle = !!(data as any).ownsVehicle || !!(data as any).hasPersonalTransport;
    resident.vehicleValue = (data as any).vehicleValue ?? ((data as any).lastTransportCost || 0);
    resident.interviewTargetId = (data as any).interviewTargetId ?? null;
    resident.lastRentPaid = (data as any).lastRentPaid;

    // CIM net wealth restore for long-run Crown + AI citizen replay fidelity
    resident.cumulativeWagesEarned = (data as any).cumulativeWagesEarned ?? 0;
    resident.cumulativeRentsPaid = (data as any).cumulativeRentsPaid ?? 0;
    resident.cumulativeConsumptionSpend = (data as any).cumulativeConsumptionSpend ?? 0;
    resident.transportAssetProxy = (data as any).transportAssetProxy ?? 0;
    resident.homeSavingsProxy = (data as any).homeSavingsProxy ?? 0;
    // food buffer restore (additive for persistence of purchase effects)
    resident.lastFoodSpend = (data as any).lastFoodSpend ?? 0;
    resident.foodSatisfiedUntil = (data as any).foodSatisfiedUntil ?? 0;

    // Movement state restore
    if (data.position) {
      resident.position = { x: data.position.x ?? 0, y: data.position.y ?? 0 };
    }
    resident.commuteTargetId = data.commuteTargetId ?? null;
    if (data.commuteStartTick !== undefined) (resident as any).commuteStartTick = data.commuteStartTick;
    if (data.commuteDurationTicks !== undefined) (resident as any).commuteDurationTicks = data.commuteDurationTicks;

    if (data.needs) {
      resident.needs.hunger = Math.max(0, Math.min(100, data.needs.hunger ?? 10));
      resident.needs.fatigue = Math.max(0, Math.min(100, data.needs.fatigue ?? 10));
      resident.needs.social = Math.max(0, Math.min(100, data.needs.social ?? 20));
    }
    resident.energy = Math.max(0, Math.min(100, data.energy ?? (100 - resident.needs.fatigue)));

    return resident;
  }
}
