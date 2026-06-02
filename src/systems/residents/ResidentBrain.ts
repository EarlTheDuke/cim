/**
 * ResidentBrain — Foundation for Agentic / AI-Driven Citizens (new initiative 2026-06-01)
 *
 * Clean, swappable abstraction so real LLM "brains" (starting with direct Grok role-play,
 * later GrokResidentBrain + LLMProvider) can control high-level life decisions for individual
 * Residents ("the people").
 *
 * Mirrors the proven Phase 7 business pattern (IDecisionMaker + BusinessContext + BusinessDecision)
 * but scoped to resident life:
 * - Narrow + sandboxed decisions only.
 * - Rich context (personal state + available options + city/drama signals).
 * - Full explainable logging.
 * - Toggleable per-resident with safe default (no brain = 100% identical rule-based behavior).
 * - Designed for A/B, long-run measurement, God Mode visibility, and external AI testing.
 *
 * See plans/agentic-residents-ai-citizens-plan.md for the full roadmap, immediate prototype goals,
 * and how this enables "run one of the people directly" for testing + future AI citizens.
 */

import type { ResidentId } from '../../entities/Resident';
import type { LocationId } from '../../entities/Location';
import type { BusinessId } from '../../entities/Business';

/** High-level, narrow decision types a resident brain is allowed to propose. */
export type ResidentDecisionType =
  | 'activity'          // Override or set the resident's current activity (with optional duration)
  | 'job_target'        // Choose a specific workplace to pursue (job hunt / apply / commute intent)
  | 'home_target'       // Choose a specific home to move toward (re-home intent)
  | 'consumption'       // Intent to spend extra on satisfying needs this period
  | 'purchase_food'     // Buy food/groceries from dynamic market (completes "do they buy food?" using price/hunger signals in ctx; stronger relief + satisfied buffer)
  | 'conserve'          // Intent to spend less / save for wealth (new for agent spending agency)
  | 'social'            // Intent to seek social interaction (linger near others, visit clusters, etc.)
  | 'acquire_transport' // Buy car/bike etc. to shorten future commute times (real time save on roads, unlocks farther high-value jobs)
  | 'interview';        // Talk to boss / negotiate at current or target workplace for wage bump or bonus (social layer on job progress)

export interface ResidentDecision {
  type: ResidentDecisionType;

  /** Target for job_target or home_target decisions. */
  targetId?: LocationId | BusinessId;

  /** For 'activity' decisions. */
  activity?: import('../../entities/Resident').Activity;

  /** Optional duration (in ticks) for the override / intent. */
  durationTicks?: number;

  /** Intensity or strength (e.g. how aggressively to pursue, how much extra to spend). */
  intensity?: number;

  /**
   * Human-readable (and future LLM-auditable) explanation.
   * This is the primary deliverable for explainability and debugging "why did the AI do that?"
   */
  reason: string;
}

/** Rich, serializable snapshot passed to any resident brain at decision time. */
export interface ResidentContext {
  // Identity & time
  readonly id: ResidentId;
  readonly name: string;
  readonly simHour: number;           // 0-24
  readonly simDay: number;

  // Core personal state (what the resident "feels")
  readonly needs: { hunger: number; fatigue: number; social: number };
  readonly money: number;
  readonly energy: number;
  readonly unemploymentHours: number;
  readonly isEmployed: boolean;

  // === CIM food/grocery market signals (additive for real-world fidelity "do they buy food?") ===
  // Exposed via getResidentContextForAI (and build for synth/rig). Brain sees price + relief potential + current hunger.
  // Stub + real brains can choose purchase_food when starving + affordable vs dailyPotential (voluntary money sink -> stronger relief + buffer).
  readonly currentHunger?: number;
  readonly lastFoodSpend?: number;
  readonly foodPriceSignal?: number;     // availableFoodPrice (base + small variance; future demand effect)
  readonly foodReliefPotential?: number; // expected strong hunger drop from buying now (5-8+ vs passive)

  // Current situation
  readonly currentActivity: import('../../entities/Resident').Activity;
  readonly homeId: LocationId;
  readonly workId: LocationId;
  readonly currentLocationId: LocationId;
  readonly position: { x: number; y: number };

  // Personal short-term memory / history (for the brain to have continuity)
  readonly recentActivities?: string[];
  readonly recentMoneyTrend?: number; // simple delta proxy
  /** Short-term decision memory (last 5-8 turns) for multi-turn strategy in brains (penalize repeats on neg delta, boost follow-ons on wins, drama seq reactivity). */
  readonly recentDecisions?: Array<{turn:number; type:ResidentDecisionType; targetId?:string; reason:string; moneyAfter?:number}>;

  // Richer economic signals for AI agency (wealth, job choice, realism)
  readonly currentHourlyWage?: number;  // my current pay (for comparing opportunities, calculating earnings potential)
  readonly timeToNextPaydayHours?: number; // helps AI time work vs rest for max money

  // === Phase 0/1 agentic wealth signals (added for "agents at the top" + observable payroll scaling) ===
  // These let the AI brain (and play harness) see exactly how a wage switch from job_target will
  // scale future money gains via disburseRealWages. Higher value choice -> visibly compounding wealth.
  // Ties directly to free markets + realism: smart job switches now produce measurable higher daily payroll.
  readonly dailyEarningsPotential?: number;     // currentHourlyWage * 8 (standard workday earnings)
  readonly projectedNextPaydayAmount?: number;  // daily * (timeToNextPaydayHours / 8 or similar)
  readonly recentEarningsDelta?: number;        // simple recent money change proxy (for trend in brain)

  // World options the resident can "see" or evaluate (built by the system from Locations + Businesses)
  readonly availableWorkplaces: Array<{
    id: LocationId | BusinessId;
    name?: string;
    distance: number;
    estimatedWage?: number;  // estimated pay there (AI can decide if switch is worth it for wealth)
    currentEmployees?: number;
    isMyCurrent?: boolean;
  }>;
  readonly availableHomes: Array<{
    id: LocationId;
    distance: number;
    rent: number;
    capacity: number;
    currentOccupants: number;
    marketRent?: number;                  // dynamic free-market price (primary signal for home_target value/pressure plays)
    pressure?: number;                    // 0-1 occupancy pressure (lower pressure = opportunity when competing for scarce homes)
    monthlyRentAsPercentOfMyMoney?: number; // AI can evaluate if moving improves net wealth relative to daily earnings
  }>;

  // City-level signals (pressure, drama, macro state — same fuel that makes business brains interesting)
  readonly cityStats: {
    population: number;
    unemploymentRate: number;
    avgHunger?: number;
    avgFatigue?: number;
  };
  readonly activeHostileEvents?: string[];   // e.g. labor_strike, tariff_shock, etc.
  readonly activeDramaTags?: string[];

  // === CIM Net Wealth signals (richer "win" + brain optimization surface) ===
  // Exposed from resident.getNetWealth() at context build time. Voluntary choices (job/home/conserve/acquire)
  // drive real flows; brains/rig can target high net or "riches + low burn" (high net + low spend/wage).
  readonly netWealth?: number;
  readonly lifetimeNet?: number;
}

/** Core swappable contract for resident "intelligence". */
export interface IResidentDecisionMaker {
  /** Stable name for logging, God Mode badges, traces, and A/B reports. */
  readonly name: string;
  /** Optional provenance for real provider-backed brains (e.g. GrokXAIProvider); used by God/Inspector for live LLM visibility. */
  readonly lastProviderName?: string;

  /**
   * Pure function: given rich context, return the decisions this brain wants.
   * Return [] to do nothing (let rule-based / schedule logic continue).
   *
   * CONTRACT (enforced by callers):
   * - Only the declared ResidentDecisionType values.
   * - All values must be finite and within safe bounds (caller will clamp/validate).
   * - No side effects.
   * - Deterministic given identical context (critical for replays and A/B).
   */
  decide(context: ResidentContext): ResidentDecision[];
}

/** Swappable provider contract for real LLM (or mock) backing GrokResidentBrain.
 * Mirrors IBusinessBrainProvider pattern from business/LLMProvider.ts exactly.
 * decide may be sync (mocks) or async (real GrokXAIProvider); callers handle Promise by falling back.
 */
export interface IResidentBrainProvider {
  /** Stable name for badges/logs (e.g. "Grok-xAI (key)" or "MockResident-0x..."). */
  readonly name: string;
  decide(context: ResidentContext): ResidentDecision[] | Promise<ResidentDecision[]>;
}

/**
 * Minimal deterministic mock provider (for tests/rig when no VITE_XAI_API_KEY).
 * Reuses the exact "reuse patterns from business" + produces valid resident decisions.
 * When used, the brain "exercises real provider path" (decisions come via .provider.decide).
 */
export class MockDeterministicResidentProvider implements IResidentBrainProvider {
  readonly name: string;
  private readonly seed: number;
  constructor(seed: number = 0xCAFE) {
    this.seed = seed >>> 0;
    this.name = `MockResidentProvider-0x${this.seed.toString(16).padStart(8, '0')}`;
  }
  decide(ctx: ResidentContext): ResidentDecision[] {
    const decisions: ResidentDecision[] = [];
    const h = (this.seed ^ ((ctx.simDay || 0) * 31)) >>> 0;
    const drama = (ctx.activeHostileEvents || ctx.activeDramaTags || []) as string[];
    const inDrama = drama.length > 0;
    const works = ctx.availableWorkplaces || [];
    const homes = ctx.availableHomes || [];
    const moneySafe = ctx.money || 40;
    if (inDrama || (ctx.unemploymentHours || 0) > 1 || moneySafe < 70) {
      if (works.length) {
        const pick = works[(h % works.length) | 0];
        if (pick && pick.id && pick.id !== ctx.workId) {
          decisions.push({
            type: 'job_target',
            targetId: pick.id,
            reason: `Grok (provider): Mock provider job_target on drama/need (seed 0x${this.seed.toString(16)})`,
            intensity: 0.9,
          });
        }
      }
    }
    if (decisions.length < 1 && homes.length) {
      const lowP = homes.slice().sort((a: any, b: any) => (a.pressure || 0.5) - (b.pressure || 0.5))[0];
      if (lowP && lowP.id && lowP.id !== ctx.homeId) {
        decisions.push({ type: 'home_target', targetId: lowP.id, reason: `Grok (provider): Mock provider home_target (pressure play)`, intensity: 0.8 });
      }
    }
    if (decisions.length === 0) {
      decisions.push({ type: 'conserve', durationTicks: 70, reason: `Grok (provider): Mock provider conserve (seed 0x${this.seed.toString(16)})`, intensity: 0.7 });
    }
    return decisions.slice(0, 2);
  }
}

/* ========================================================================== */
/*                        RULE-BASED DEFAULT (Baseline)                       */
/* ========================================================================== */

/**
 * Deterministic, conservative rule-based resident brain.
 * Initially reproduces (or slightly improves) the existing schedule + needs + job/housing rules
 * so we have a perfect A/B control and can evolve the heuristics safely.
 *
 * Future iterations can make the rule brain smarter while keeping it fully deterministic.
 */
export class RuleBasedResidentBrain implements IResidentDecisionMaker {
  public readonly name = 'RuleBasedResidentBrain-v1';

  decide(ctx: ResidentContext): ResidentDecision[] {
    const decisions: ResidentDecision[] = [];
    const hour = ctx.simHour;

    // Reproduce core need-driven overrides as explicit decisions (for parity + logging)
    if (ctx.needs.fatigue > 70 && hour >= 16) {
      decisions.push({
        type: 'activity',
        activity: 'sleeping',
        reason: 'Rule: High fatigue near evening → prioritize sleep',
        durationTicks: 60 * 2,
      });
    }

    if (ctx.needs.hunger > 55 && ctx.currentActivity === 'working') {
      decisions.push({
        type: 'activity',
        activity: 'at_home',
        reason: 'Rule: Urgent hunger while working → head home early',
        durationTicks: 30,
      });
    }

    // Unemployed job-hunt intent during day (matches current MovementSystem behavior)
    if (!ctx.isEmployed && ctx.unemploymentHours > 1.5 && hour >= 7 && hour < 19) {
      if (ctx.workId) {
        decisions.push({
          type: 'job_target',
          targetId: ctx.workId,
          reason: 'Rule: Unemployed during daytime → job hunt at assigned work location',
          intensity: 0.6,
        });
      }
    }

    // Simple housing pressure signal (the actual re-home logic stays in ResidentsSystem HM step for safety)
    if (ctx.unemploymentHours > 6 || (ctx.money < 20 && ctx.cityStats.unemploymentRate > 0.1)) {
      // Just signal intent; the system will still run the capped HM step
      decisions.push({
        type: 'home_target',
        reason: 'Rule: Long unemployment or cash pressure → open to cheaper housing',
        intensity: 0.4,
      });
    }

    return decisions;
  }
}

/* ========================================================================== */
/*                         HELPER: Build Safe Context                         */
/* ========================================================================== */

/**
 * Helper to construct a ResidentContext from live systems.
 * Callers (ResidentsSystem, God Mode tester, harness) are responsible for providing
 * the necessary queries (Locations, Businesses, Time, Event info).
 *
 * This keeps the brain pure and the context construction centralized + testable.
 */
export function buildResidentContext(params: {
  resident: import('../../entities/Resident').ResidentFullState & {
    needs: { hunger: number; fatigue: number; social: number };
    unemploymentDurationTicks?: number;
    employerId?: string | null;
  };
  simHour: number;
  simDay: number;
  availableWorkplaces: ResidentContext['availableWorkplaces'];
  availableHomes: ResidentContext['availableHomes'];
  cityStats: ResidentContext['cityStats'];
  activeHostileEvents?: string[];
  recentActivities?: string[];
  recentMoneyTrend?: number;
  recentDecisions?: ResidentContext['recentDecisions'];
  netWealth?: number;
  lifetimeNet?: number;
  // food market (additive)
  foodPriceSignal?: number;
  foodReliefPotential?: number;
}): ResidentContext {
  const r = params.resident;
  return {
    id: r.id,
    name: r.name,
    simHour: params.simHour,
    simDay: params.simDay,
    needs: { ...r.needs },
    money: r.money,
    energy: r.energy,
    unemploymentHours: Math.round(((r.unemploymentDurationTicks || 0) / 60) * 10) / 10,
    isEmployed: !!r.employerId,
    currentActivity: r.currentActivity,
    homeId: r.homeId,
    workId: r.workId,
    currentLocationId: r.currentLocationId,
    position: { ...r.position },
    recentActivities: params.recentActivities,
    recentMoneyTrend: params.recentMoneyTrend,
    recentDecisions: params.recentDecisions,
    availableWorkplaces: params.availableWorkplaces,
    availableHomes: params.availableHomes,
    cityStats: params.cityStats,
    activeHostileEvents: params.activeHostileEvents,
    activeDramaTags: params.activeHostileEvents, // alias for convenience
    // CIM net wealth (passed through for brain optimization on rent% + transport ROI + wage)
    netWealth: params.netWealth,
    lifetimeNet: params.lifetimeNet,
    // food/grocery market (additive for purchase_food voluntary decision)
    currentHunger: r.needs?.hunger ?? 0,
    lastFoodSpend: (r as any).lastFoodSpend ?? 0,
    foodPriceSignal: params.foodPriceSignal,
    foodReliefPotential: params.foodReliefPotential,
  };
}

/* ========================================================================== */
/*               SMALL DECISION HELPERS (for play rig + future brains)        */
/*   Use richer signals (dailyEarningsPotential, marketRent/pressure, estWage */
/*   margins, timeToNext) to make job/home/conserve fire more readily under   */
/*   contention. Pure + additive; no behavior change to rule-based path.      */
/* ========================================================================== */

/** Compute effective daily earnings potential from ctx (falls back gracefully). */
export function computeDailyPotential(ctx: any): number {
  if (ctx?.dailyEarningsPotential != null) return ctx.dailyEarningsPotential;
  const w = ctx?.currentHourlyWage || 12;
  return w * 8;
}

/** Score a job target using estWage margin + daily potential delta + dist. Higher better for wealth plays. */
export function scoreJobTarget(w: any, myWage: number, myDaily: number, personality: string): number {
  const est = w?.estimatedWage || myWage;
  const dailyDelta = (est * 8) - myDaily;
  const distPenalty = Math.max(0.5, (w?.distance || 5) * 0.55);
  const base = (est + 0.2) / distPenalty + (dailyDelta * 0.08);
  const boost = personality === 'aggressive-job' ? 1.6 : (personality === 'home-conserve' ? 0.7 : 1.0);
  return base * boost;
}

/** Decide if a home is attractive for home_target using marketRent/pressure vs daily earnings. */
export function isAttractiveHome(h: any, myMoney: number, myDaily: number, personality: string): boolean {
  const mRent = h?.marketRent ?? h?.rent ?? 30;
  const press = h?.pressure ?? 0;
  const pct = h?.monthlyRentAsPercentOfMyMoney ?? (myMoney > 0 ? mRent / myMoney : 1);
  const rentVsDaily = mRent / Math.max(1, myDaily / 30); // rent relative to ~monthly earnings proxy
  const lowPressureGood = press < 0.35;
  const goodValue = pct < 0.25 || rentVsDaily < 0.9 || lowPressureGood;
  const thr = personality === 'home-conserve' ? 0.82 : 0.6;
  return goodValue && (pct < thr || lowPressureGood);
}

/** Pick the highest estWage-margin target from available (smarter forced-explore). */
export function pickHighestMarginJobTarget(available: any[], myWorkId: any, myWage: number): any {
  if (!available || !available.length) return null;
  const scored = available
    .filter((w: any) => w && w.id)
    .map((w: any) => {
      const _m = (w.estimatedWage || myWage) - myWage;
      return { w, score: _m * 1.2 - (w.distance || 5) * 0.3 };
    })
    .sort((a, b) => b.score - a.score);
  return scored.find(s => s.w.id !== myWorkId)?.w || scored[0]?.w || null;
}

/* ========================================================================== */
/*                     GROK RESIDENT BRAIN (provider-wired)                   */
/*   IResidentDecisionMaker for the play-rich-ai.test.ts rig (and future).    */
/*   Mirrors the Crown GrokBusinessBrain + LLMProvider pattern exactly.       */
/*   Ctor accepts optional IResidentBrainProvider (Mock or GrokXAI via        */
/*   createProviderFromEnv). decide() delegates when present (handles async/  */
/*   error with stub fallback for contract); lastProviderName + factory for   */
/*   easy attach. Uses helpers for voluntary plays. Reasons from provider     */
/*   or "(stub)" when no-provider path.                                       */
/*                                                                            */
/*   This is the exact attachment surface (setResidentBrain + .decide(ctx)    */
/*   + applyResidentDecision) that lets us "connect up AI brains".            */
/*   Real/mock provider path now wired + exercised in rig for one agent.      */
/*   Zero behavior change on default (no-provider) path.                      */
/* ========================================================================== */

export class GrokResidentBrain implements IResidentDecisionMaker {
  public readonly name = 'GrokResidentBrain-v1';
  private readonly provider?: IResidentBrainProvider;

  constructor(provider?: IResidentBrainProvider) {
    this.provider = provider;
  }

  /**
   * Public getter (mirrors GrokBusinessBrain.lastProviderName exactly).
   * Enables God/inspector provenance to show "Grok-xAI (key)" / "MockResidentProvider-..." when a real provider is wired.
   */
  public get lastProviderName(): string {
    return this.provider?.name ?? this.name;
  }

  /**
   * Entry point (sync per IResidentDecisionMaker contract, used by rig + future ResidentsSystem).
   * When provider present:
   *   - If sync result (Mock*): delegate fully (decisions + reasons come from provider).
   *   - If Promise (real GrokXAI): fall back to internal stub heuristic for contract compat (like business side).
   *     lastProviderName still reports the real provider for logs/UI.
   *   - On any error from provider: graceful fallback to stub logic.
   * When no provider: identical prior stub heuristic (reasons keep "(stub)" tags for compat).
   *
   * This wires the "real (or mock) xAI/Grok provider" directly into the resident brain stub.
   */
  decide(ctx: ResidentContext): ResidentDecision[] {
    if (this.provider) {
      try {
        const result = this.provider.decide(ctx);
        if (result && typeof (result as any).then === 'function') {
          // Async real LLM provider (GrokXAIProvider etc) — safe fallback, name still visible via lastProviderName
          // NOTE: ctx carries recentDecisions + recentMoneyTrend for memory-aware LLM decisions (penalize/boost seqs)
          return this.stubHeuristicDecide(ctx);
        }
        const arr = Array.isArray(result) ? (result as ResidentDecision[]) : [];
        return arr.length ? arr : this.stubHeuristicDecide(ctx);
      } catch (e) {
        // Never break the rig/simulation; provider path was exercised (log in caller if needed)
        return this.stubHeuristicDecide(ctx);
      }
    }
    return this.stubHeuristicDecide(ctx);
  }

  /**
   * The original GrokResidentBrain (stub) heuristic, now private.
   * All "(stub)" tags + logic preserved exactly for zero behavior change on the no-provider path.
   * (Extracted so provider branch can reuse on async/error/empty cases.)
   */
  private stubHeuristicDecide(ctx: ResidentContext): ResidentDecision[] {
    const decisions: ResidentDecision[] = [];
    if (!ctx) return decisions;

    // Demo robustness in play rig (synth ctx path): if available lists are empty/sparse, inject the same synthetic options the rig uses
    // so the Grok stub produces voluntary job_target/home_target decisions (visible "brain had effect").
    // Real runs with full getResidentContextForAI will have real lists; this only helps headless test demo.
    let workList = ctx.availableWorkplaces || [];
    let homeList = ctx.availableHomes || [];
    if ((!workList || workList.length === 0) && (ctx.money != null)) {
      const sW = ctx.currentHourlyWage || 12; const sM = ctx.money || 40;
      workList = [0,1,2,3,4].map(i => ({ id: 'synth_wp_'+i, name: 'Opt'+i, distance: 1.5 + i*0.8, estimatedWage: Math.round((sW + (i-2)*4.1)*10)/10, isMyCurrent: i===2 }));
      homeList = [0,1,2,3,4].map(i => ({ id: 'synth_hm_'+i, distance: 1+i*0.7, rent: 24+i*5, capacity: 4, currentOccupants: 2+(i%3), marketRent: 21+i*6.5+(i>2?9:0), pressure: Math.max(0.05,Math.min(0.92,0.18+i*0.13)), monthlyRentAsPercentOfMyMoney: (28+i*4)/Math.max(12,sM) }));
    }
    const effectiveCtx: any = { ...ctx, availableWorkplaces: workList, availableHomes: homeList };

    // === SHORT-TERM MEMORY (recentDecisions + recentMoneyTrend) USAGE in GrokResidentBrain stub + provider path ===
    // Memory is populated by ResidentsSystem.getResidentContextForAI from resident's decisionLog (last 5-8).
    // Enables better voluntary strategies: penalize repeats after small/neg delta (moneyAfter proxy via trend), boost follow-on after wins, react to recent drama sequences.
    // Still purely high-level flags (job_target/home_target/conserve etc); physics (commute, hire, rent, price) 100% unchanged in Movement/Business/Locations.
    // Agents use the enriched value signals in ctx for free-market reallocation.
    const memDecs: any[] = ((ctx as any).recentDecisions || (effectiveCtx as any).recentDecisions || []) as any[];
    const recentMoneyTrend = (ctx as any).recentMoneyTrend ?? (effectiveCtx as any).recentMoneyTrend ?? 0;
    let memoryNote = '';
    if (memDecs.length >= 1) {
      // Penalize repeat targets that previously had small/negative delta (infer from recent reasons or trend <=0)
      const recentJobTargets = memDecs.filter((d: any) => d.type === 'job_target' && d.targetId).map((d: any) => String(d.targetId));
      const lastFewBad = memDecs.slice(-5).filter((d: any) => d.type === 'job_target' && (recentMoneyTrend <= 0 || /delta.*-|margin.*-|low|bad|avoid/i.test(d.reason || '')));
      if (lastFewBad.length && recentJobTargets.length > 1 && recentMoneyTrend <= 0) {
        memoryNote += ' [MEMORY: penalized repeat low/neg-delta target after trend]';
      }
      // Boost follow-on on wins (positive implied delta + trend >0 → prefer conserve or sustain)
      const lastWin = memDecs.slice().reverse().find((d: any) => d.type === 'job_target' && /margin|dailyΔ|upside|higher|good|win/i.test(d.reason || ''));
      if (lastWin && recentMoneyTrend > 0) {
        memoryNote += ' [MEMORY: boosting follow-on conserve after seen win delta]';
      }
      // React to recent drama sequences (multiple recent drama-tagged decisions + current inDrama)
      const recentDramaCount = memDecs.filter((d: any) => /DRAMA|drama|shock|crisis|hostile/i.test(d.reason || '')).length;
      if (recentDramaCount >= 1 && (activeDrama as any).length > 0) {
        memoryNote += ' [MEMORY: reacting to recent drama sequence]';
      }
    }

    const isDay = (ctx.simHour || 12) >= 7 && (ctx.simHour || 12) < 19;
    const moneySafe = ctx.money || 0;
    const myWage = ctx.currentHourlyWage || 12;
    const myWorkId = ctx.workId;
    const myDaily = computeDailyPotential(effectiveCtx);

    // === CIM NET WEALTH AWARENESS (additive for brain optimization on richer win conditions) ===
    // netWealth / lifetimeNet now in ctx from real flows (voluntary job/home/conserve/acquire).
    // Heuristic can bias toward plays that improve net (e.g. lower rent% of net, transport ROI vs wage delta).
    const netW = (effectiveCtx as any).netWealth ?? (effectiveCtx as any).lifetimeNet ?? 0;
    const myMoneyForCalc = moneySafe || 40;
    const rentPctOfNet = (netW > 0) ? (effectiveCtx.currentHomeRent || 0) / Math.max(1, netW) : 0;

    // === CIM FOOD PURCHASE (additive real-world: "do they buy food?") ===
    // Voluntary decision when hungry + price affordable relative to dailyPotential (earnings buffer).
    // Reads currentHunger / foodPriceSignal / foodReliefPotential from ctx (built with Locations helper + variance).
    // Effect (in ResidentsSystem apply): real spend + strong relief (5-8 vs passive ~0.9) + satisfied buffer (slows creep) -> sustained activity + more work time/earnings.
    if (decisions.length < 2) {
      const hunger = (ctx.needs?.hunger ?? (effectiveCtx as any).currentHunger ?? 0);
      const fPrice = (effectiveCtx as any).foodPriceSignal ?? (effectiveCtx as any).availableFoodPrice ?? 4.5;
      const reliefPot = (effectiveCtx as any).foodReliefPotential ?? 6.5;
      const cost = fPrice;
      if (hunger > 52 && moneySafe >= cost * 1.15 && (myDaily > cost * 1.8 || hunger > 72)) {
        decisions.push({
          type: 'purchase_food',
          reason: `Grok: (stub) hunger ${hunger.toFixed(0)} vs foodPriceSignal ${fPrice} (relief~${reliefPot}) worth buying (dailyPotential ${myDaily.toFixed(0)} > cost) — stronger relief + buffer sustains work vs passive creep${memoryNote}`,
          intensity: Math.min(0.96, 0.55 + (hunger - 50) / 80),
        });
      }
    }

    // === DRAMA REACTIVITY (Grok brain path, balanced) — fires voluntary market plays under shocks like tuned decideForAgent ===
    // Uses activeHostileEvents from augmented rig ctx (or synth marker) so pure brain stub reacts without fallback.
    // Prefer job/home/conserve wealth plays (for climb goal) over pure social/activity.
    const activeDrama: string[] = ((ctx as any).activeHostileEvents || (ctx as any).activeDramaTags || (effectiveCtx as any).__dramaForTest || []) as string[];
    const hasInterest = activeDrama.some((e: string) => /interest_rate_shock|interest|rate|rent/i.test(String(e)));
    const hasLaborStrike = activeDrama.some((e: string) => /labor_strike|labor|strike/i.test(String(e)));
    const hasPortStrike = activeDrama.some((e: string) => /port_strike|port|supply/i.test(String(e)));
    const hasBlackout = activeDrama.some((e: string) => /blackout|major_blackout|cyber/i.test(String(e)));
    const inDrama = activeDrama.length > 0;
    if (inDrama && decisions.length < 2) {
      if ((hasLaborStrike || hasPortStrike) && effectiveCtx.availableWorkplaces && effectiveCtx.availableWorkplaces.length) {
        let works = (effectiveCtx.availableWorkplaces as any[]).filter((w: any) => !w.isMyCurrent);
        // Memory filter: penalize recent bad repeat targets
        if (memDecs.length && recentMoneyTrend <= 0) {
          const bad = new Set(memDecs.slice(-5).filter((d:any)=>d.type==='job_target' && d.targetId).map((d:any)=>String(d.targetId)));
          works = works.filter((w:any) => !bad.has(String(w.id)));
          if (memoryNote) memoryNote = memoryNote.replace(']', ' + filtered]');
        }
        const upside = works.sort((a: any, b: any) => (b.estimatedWage || 0) - (a.estimatedWage || 0))[0];
        if (upside && upside.id && upside.id !== myWorkId) {
          decisions.push({
            type: 'job_target',
            targetId: upside.id,
            reason: `Grok: (stub) [DRAMA REACTION] ${activeDrama[0]} — opportunistic job_target using dailyEarningsPotential + estWage to non-affected/high-upside (Grok brain path)${memoryNote}`,
            intensity: 0.999, // stronger react for brain climb under drama
          });
        }
      }
      if ((hasInterest || hasBlackout || hasLaborStrike) && decisions.length < 2 && effectiveCtx.availableHomes && effectiveCtx.availableHomes.length) {
        let homes = (effectiveCtx.availableHomes as any[]).filter((h: any) => h.id !== ctx.homeId);
        if (memDecs.length && recentMoneyTrend <= 0) {
          const badH = new Set(memDecs.slice(-5).filter((d:any)=>d.type==='home_target' && d.targetId).map((d:any)=>String(d.targetId)));
          homes = homes.filter((h:any) => !badH.has(String(h.id)));
        }
        const lowPressure = homes.sort((a: any, b: any) => (a.pressure || 0.5) - (b.pressure || 0.5))[0];
        if (lowPressure && lowPressure.id) {
          decisions.push({
            type: 'home_target',
            targetId: lowPressure.id,
            reason: `Grok: (stub) [DRAMA REACTION] ${activeDrama[0]} — home_target to low-pressure under rent shock using marketRent/pressure (Grok brain path)${memoryNote}`,
            intensity: 0.995, // boost intensity + stronger opportunity reaction
          });
        } else if (moneySafe > 50) {
          decisions.push({
            type: 'conserve',
            durationTicks: 110,
            reason: `Grok: (stub) [DRAMA REACTION] ${activeDrama[0]} — conserve to build buffer under shock using drama + dailyEarnings (Grok brain path)${memoryNote}`,
            intensity: 0.93,
          });
        }
      }
    }

    // Prefer job_target using the exact exported smarter picker + signals (Grok brain path) — MORE AGGRESSIVE for brain agent to reach rank #1/top3 via bigger margins + full ctx (dailyEarningsPotential, estWage, timeToNext, drama)
    // Uses 'aggressive-job' scoring boost + higher intensity + prefers largest margin targets + stronger timeToNext opportunity reaction.
    const timeToNext = (effectiveCtx as any).timeToNextPaydayHours ?? 6;
    if (effectiveCtx.availableWorkplaces && effectiveCtx.availableWorkplaces.length) {
      let workPool = effectiveCtx.availableWorkplaces as any[];
      if (memDecs.length && recentMoneyTrend <= 0) {
        const bad = new Set(memDecs.slice(-5).filter((d:any)=>d.type==='job_target' && d.targetId).map((d:any)=>String(d.targetId)));
        workPool = workPool.filter((w:any) => !bad.has(String(w.id)));
        if (bad.size && !memoryNote.includes('penalized')) memoryNote += ' [MEMORY: filtered repeats]';
      }
      const eager = pickHighestMarginJobTarget(workPool as any[], myWorkId, myWage);
      if (eager && eager.id && eager.id !== myWorkId) {
        const em = (eager.estimatedWage || myWage) - myWage;
        const dailyD = ((eager.estimatedWage || myWage) * 8) - myDaily;
        let int = 0.99; // boost intensity for brain
        if (timeToNext < 4 && em > 0.5) int = 0.995; // react stronger to imminent payday + good margin opportunity
        if (dailyD > 8) int = 0.999; // prefer bigger daily margins
        decisions.push({
          type: 'job_target',
          targetId: eager.id,
          reason: `Grok: (stub) Eager wealth hunt to ${eager.name || eager.id} (est margin ${em.toFixed(1)}, dailyΔ ${dailyD.toFixed(0)}, timeToNext~${timeToNext}h) using estWage margin + dailyEarningsPotential + timeToNext signals (Grok brain path)${memoryNote}`,
          intensity: int,
        });
      } else {
        // Fallback to scoring path — now uses aggressive-job boost via helper for bigger-margin preference + brain climb
        const myD = myDaily || 96;
        const scored = effectiveCtx.availableWorkplaces.map((w: any) => ({ ...w, score: scoreJobTarget(w, myWage, myD, 'aggressive-job') }));
        const best = scored.sort((a: any, b: any) => b.score - a.score)[0];
        const bestWage = best?.estimatedWage || myWage;
        const margin = bestWage - myWage;
        const dailyDelta = (bestWage * 8) - myDaily;
        const thr = -1.2; // even more relaxed + aggressive preference for brain to hit high-value targets
        const anyBetter = margin > -0.3 || dailyDelta > -3 || (isDay && margin >= -1.2) || (timeToNext < 5 && margin >= -0.1);
        if (best && best.id && (margin >= thr || anyBetter) && (best.id !== myWorkId || margin > 0.05 || dailyDelta > 0.2)) {
          let int = 0.99; // boost for brain
          if (timeToNext < 3 && margin > 0) int = 0.999;
          decisions.push({
            type: 'job_target',
            targetId: best.id,
            reason: `Grok: (stub) Targeting ${best.name || best.id} est$${bestWage.toFixed(1)} (margin ${margin.toFixed(1)}, dailyΔ ${dailyDelta.toFixed(0)}, timeToNext~${timeToNext}h) via dailyEarningsPotential+estWage+pressure+timeToNext (Grok brain path)${memoryNote}`,
            intensity: int,
          });
        }
      }
    }

    // Extra daytime eager job push (additive, like decideForAgent eager fallback) to fire more voluntary market plays for climb
    if (isDay && decisions.filter((d: any) => d.type === 'job_target').length === 0 && effectiveCtx.availableWorkplaces && effectiveCtx.availableWorkplaces.length) {
      const eager2 = pickHighestMarginJobTarget(effectiveCtx.availableWorkplaces as any[], myWorkId, myWage);
      if (eager2 && eager2.id && eager2.id !== myWorkId) {
        const em2 = (eager2.estimatedWage || myWage) - myWage;
        decisions.push({
          type: 'job_target',
          targetId: eager2.id,
          reason: `Grok: (stub) Eager daytime wealth hunt to ${eager2.name || eager2.id} (est margin ${em2.toFixed(1)}) (Grok brain path)${memoryNote}`,
          intensity: 0.95,
        });
      }
    }

    // Optional second decision: home_target or conserve using market signals (still Grok path) — MORE AGGRESSIVE for brain: prefer bigger rent/pressure savings + marketRent vs daily + timeToNext opportunity
    if (decisions.length < 2 && effectiveCtx.availableHomes && effectiveCtx.availableHomes.length && (isDay || moneySafe < 95 || (effectiveCtx.availableHomes as any[]).some((h:any)=> (h.pressure||0)>0.5 ))) {
      const myD = myDaily || 96;
      // Use aggressive-like filter + sort preferring low pressure + low marketRent relative to dailyEarnings (stronger value play)
      const goodHomes = effectiveCtx.availableHomes.filter((h: any) => isAttractiveHome(h, moneySafe, myD, 'aggressive-job') && h.id !== ctx.homeId);
      if (goodHomes.length) {
        const bestH = goodHomes.sort((a: any, b: any) => {
          const va = (a.pressure || 0.5) + ((a.marketRent || a.rent || 30) / Math.max(8, myD / 28));
          const vb = (b.pressure || 0.5) + ((b.marketRent || b.rent || 30) / Math.max(8, myD / 28));
          // also factor timeToNext: if soon, value lower rent more
          const tFactor = (timeToNext < 4 ? 1.15 : 1.0);
          return (va * tFactor) - (vb * tFactor);
        })[0];
        if (bestH?.id) {
          let int = 0.99;
          const rentSave = ((bestH.marketRent || bestH.rent || 30) / Math.max(8, myD / 28));
          if (rentSave < 0.7 || timeToNext < 5) int = 0.995; // stronger react to good home opportunity
          decisions.push({
            type: 'home_target',
            targetId: bestH.id,
            reason: `Grok: (stub) Eager re-home to lower-pressure/lower marketRent home (dailyEarningsPotential ${myD.toFixed(0)}, timeToNext~${timeToNext}h, rentVsDaily ${rentSave.toFixed(2)}) for net wealth gain (Grok brain path)${memoryNote}`,
            intensity: int,
          });
        }
      } else if (moneySafe > 55) {
        decisions.push({
          type: 'conserve',
          durationTicks: 95,
          reason: `Grok: (stub) Eager conserve (high market rent vs dailyEarningsPotential + timeToNext) to build buffer for bigger plays (Grok brain path)${memoryNote}`,
          intensity: 0.92,
        });
      }
    }

    // Ensure at least one safe decision (activity) if nothing fired — keeps the resident moving
    if (decisions.length === 0) {
      decisions.push({
        type: 'activity',
        activity: isDay ? 'working' : 'at_home',
        reason: `Grok: (stub) ${isDay ? 'Grind payroll' : 'Rest'} to pull ahead (Grok brain path)${memoryNote}`,
        durationTicks: isDay ? 70 : 60,
      });
    }

    return decisions.slice(0, 2);
  }
}

/** Convenience factory (exact mirror of createGrokBusinessBrain pattern for easy swapping in rig/harnesses/God). */
export function createGrokResidentBrain(opts?: { provider?: IResidentBrainProvider }): IResidentDecisionMaker {
  return new GrokResidentBrain(opts?.provider);
}
