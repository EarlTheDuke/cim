/**
 * BusinessSystem
 * 
 * Thin orchestration layer for Business entities.
 * Wires the rule-based Business foundation (from Phase 4 scaffolding agent)
 * into the living simulation alongside ResidentsSystem and LocationsSystem.
 * 
 * === RESPONSIBILITIES (thin vertical slice) ===
 * - Own a collection of Business instances (Map by id)
 * - Register businesses (idempotent-with-warn, bulk support)
 * - On simulated day boundaries: call processDay() on every business
 *   (detected via TimeSystem.day changes inside update())
 * - Handle actual employee wage payments by looking up Residents:
 *     • For each employee of a business, resolve via ResidentsSystem
 *     • Transfer real wages: business.cash -= (resident.hourlyWage * 8hrs), resident.money += same
 *     • This creates the first real money flow linkage between businesses and residents
 *     • Uses resident's actual hourlyWage (not the business's internal estimate)
 *     • Allows business cash to go negative (consistent with Business entity design)
 * - Deeper employment integration: bidirectional hire/fire (hireEmployee/fireEmployee) that syncs
 *     Business.employeeIds <-> Resident.employerId, with money side-effects (bonus/severance) + needs hooks.
 *     Exposes getEmploymentStats(), getEmploymentStatus(), getEmployerForResident() for inspectors/charts.
 * - Unemployment visualization + basic job search: runBasicJobSearch() (called from update) gives unemployed residents
 *     a chance at matching workId businesses (duration-biased prob, soft caps). Feeds richer EmploymentStats (incl. avg duration).
 *     Powers inspector badges, live chart unemployment trends, and behavioral effects on residents.
 * - Rich query surface: getBusinessesByType, getBusinessesByEmployee, getTotalEconomyStats, getEmploymentStats, etc.
 * - Fully observable: getSnapshot() returns inspector-friendly data + economy aggregates
 * - Serializable-ready: getSerializableState() exposes toJSON() payloads for future save/load
 * - Implements { update(): void } contract so it can be used with Simulation.registerSystem()
 * 
 * === NON-RESPONSIBILITIES (deliberately out of scope for thin slice) ===
 * - No automatic population of businesses (Simulation.spawn or future factory decides)
 * - No modification of Business wagePerEmployeePerDay or other tunables
 * - No per-tick business micro-behavior (processDay is daily granularity by design)
 * - No bankruptcy, market pricing, input recipes, or full EconomySystem reconciliation yet
 * - Friday "payday" now only triggers rent collection (Phase A: wages unified into daily disburseRealWages for conservation; no more dual/triple wage paths)
 * 
 * === DESIGN ALIGNMENT ===
 * - Mirrors ResidentsSystem + LocationsSystem patterns exactly (ctor deps, register*, get*, getSnapshot, clear)
 * - No rendering / DOM / UI concerns (Simulation Core is Sacred)
 * - Deterministic when TimeSystem + RNG are seeded
 * - Easy for future AgentBrainSystem (Phase 7) to read context via snapshots/queries
 * - Phase 7 delivered: clean optional BusinessBrain hook (pre-processDay), global enable/disable, decision logging,
 *   narrow sandboxed decisions (pricing/production/hiring target), full A/B isolation, zero behavior change when off.
 * - Prepares total money flow invariants for long-running validation tests
 * 
 * References:
 * - src/entities/Business.ts (processDay, P&L, employeeIds as ResidentId only, getSnapshot/toJSON)
 * - src/systems/ResidentsSystem.ts (lookup + money mutation patterns)
 * - src/core/Simulation.ts (registerSystem contract + day-boundary payday precedent)
 * - plans/city-with-life-development-plan.md (Phase 4 economy foundation)
 * - ARCHITECTURE.md (BusinessSystem slot)
 */

import { Business, type BusinessId, type BusinessType, type BusinessSnapshot } from '../entities/Business';
import type { TimeSystem } from '../core/TimeSystem';
import { ResidentsSystem } from './ResidentsSystem';
import type { ResidentId } from '../entities/Resident';
import {
  type IDecisionMaker,
  type DecisionLogEntry,
  type BusinessContext,
  type BusinessDecision,
  createRuleBasedBrain,
  buildBusinessContext,
  clampDecisionDelta,
} from './business/BusinessBrain';

export interface EconomyStats {
  count: number;
  totalCash: number;
  totalRevenue: number;
  totalExpenses: number;
  totalProfit: number;
  totalEmployees: number;
  averageCash: number;
}

/** Employment aggregates for inspector, charts, and God Mode (real resident linkage). */
export interface EmploymentStats {
  totalEmployed: number;
  totalUnemployed: number;
  employmentRate: number; // 0-1
  businessesWithEmployees: number;
  averageEmployeesPerBusiness: number;
  // Unemployment model extensions (visualization + behavior)
  averageUnemploymentDurationHours?: number; // mean continuous joblessness among the unemployed
}

/** Result of a basic job search pass (for observability in God Mode, tests, inspector/charts extensions). */
export interface JobSearchResult {
  hires: number;                 // actual coordinated hires performed this step (0..MAX_HIRES_PER_STEP)
  candidatesConsidered: number;  // total unemployed residents evaluated (0 if none)
}

export interface BusinessSystemSnapshot {
  count: number;
  lastProcessedDay: number;
  businesses: BusinessSnapshot[];
  economy: EconomyStats;
  employment: EmploymentStats; // deeper Business-Resident integration data
}

export interface BusinessSystemSerializableState {
  lastProcessedDay: number;
  businesses: any[]; // Business.toJSON() payloads
}

export class BusinessSystem {
  private readonly businesses: Map<BusinessId, Business> = new Map();
  private lastProcessedDay: number;

  // Cache for targetId (loc or biz) -> resolved BusinessId (populated by resolveTargetToBusiness on hits; lightweight, survives for session)
  private readonly targetCache: Map<string, BusinessId> = new Map();

  // === Phase 7 BusinessBrain scaffolding (toggleable, zero-cost when disabled) ===
  private brainEnabled: boolean = false;
  private brain: IDecisionMaker | null = null;
  private totalDecisionsLogged: number = 0;

  /**
   * @param timeSystem - Required to detect day boundaries for processDay calls
   * @param residentsSystem - Required to lookup employees and perform real wage transfers
   */
  constructor(
    private readonly timeSystem: TimeSystem,
    private readonly residentsSystem: ResidentsSystem
  ) {
    // Start synced to current day so the very first update() does not spuriously process
    // (day changes are what trigger processDay + real wage disbursements).
    this.lastProcessedDay = this.timeSystem.day;
  }

  // === Registration ===

  /** Register a single business. Warns (but allows) if id already exists with different instance. */
  registerBusiness(business: Business): void {
    const existing = this.businesses.get(business.id);
    if (existing && existing !== business) {
      console.warn(`[BusinessSystem] Overwriting business with id "${business.id}"`);
    }
    this.businesses.set(business.id, business);
  }

  /** Bulk register convenience helper. */
  registerBusinesses(businesses: Business[]): void {
    for (const b of businesses) {
      this.registerBusiness(b);
    }
  }

  /**
   * Create + register a new Business in one call (ergonomic factory, mirrors LocationsSystem.create*).
   * All constructor params for Business are accepted.
   */
  createBusiness(params: {
    id: BusinessId;
    name: string;
    type: BusinessType;
    cash?: number;
    operatingCostPerDay?: number;
    baseProductionPerDay?: number;
    wagePerEmployeePerDay?: number;
    baseSellPrice?: number;
    initialInventory?: Record<string, number>;
  }): Business {
    const business = new Business(params);
    this.registerBusiness(business);
    return business;
  }

  // === Lookups & Queries ===

  getBusiness(id: BusinessId): Business | undefined {
    return this.businesses.get(id);
  }

  hasBusiness(id: BusinessId): boolean {
    return this.businesses.has(id);
  }

  getAllBusinesses(): Business[] {
    return Array.from(this.businesses.values());
  }

  getBusinessCount(): number {
    return this.businesses.size;
  }

  /** Filter businesses by their BusinessType (e.g. 'mine', 'bakery'). */
  getBusinessesByType(type: BusinessType): Business[] {
    return this.getAllBusinesses().filter(b => b.type === type);
  }

  /**
   * Find all businesses that currently list this resident as an employee.
   * Useful for inspector / "where does this person work?" queries.
   */
  getBusinessesByEmployee(residentId: ResidentId): Business[] {
    return this.getAllBusinesses().filter(b => b.employeeIds.includes(residentId));
  }

  // === Robust Loc <-> Business resolution for agentic job targets (Phase C / AI citizens) ===

  /**
   * Public resolver: given a jobHuntTargetId (frequently a LocationId / workplace loc from ResidentContext.availableWorkplaces),
   * returns the matching BusinessId if resolvable, else null. Safe no-op if no mapping.
   * Used by ResidentsSystem (attemptAgentHire + job_target apply) and internally by runBasicJobSearch.
   */
  public getBusinessForJobTarget(targetId: string): BusinessId | null {
    const b = this.resolveTargetToBusiness(targetId);
    return b ? b.id : null;
  }

  /**
   * Robust private resolver so jobHuntTargetId (often a workplace LocationId from ctx availableWorkplaces)
   * reliably maps to a hireable Business for AI job_target / arrival switch / uplift.
   * Direct hit (spawn alignment: loc workId === business.id) is common/fast path.
   * Falls back to loose name/id match, resident workId->employer association, or roomy "premium" pick.
   * Simple cache for repeated targets (e.g. during a commute).
   * This enables reliable AI free-market job choice -> real employment outcome even when targets are physical workplace locs.
   */
  private resolveTargetToBusiness(targetId: string): Business | null {
    if (!targetId) return null;
    // Cache hit (valid as long as no removal of that biz; rare)
    const cached = this.targetCache.get(targetId);
    if (cached && this.businesses.has(cached as any)) {
      return this.businesses.get(cached as any)!;
    }

    // Direct id match (fast path; spawnOneResident + createBusiness use identical 'business_xxx' strings for work locs and bizs)
    if (this.businesses.has(targetId as any)) {
      const hit = this.businesses.get(targetId as any)!;
      this.targetCache.set(targetId, hit.id);
      return hit;
    }

    const tNorm = targetId.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Loose match on business id or name (handles "District" loc names vs biz names, prefix variations, etc.)
    const loose = this.getAllBusinesses().find(b => {
      const bid = (b.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const bnm = (b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return bid.includes(tNorm) || tNorm.includes(bid) || bnm.includes(tNorm) || tNorm.includes(bnm);
    });
    if (loose) {
      this.targetCache.set(targetId, loose.id);
      return loose;
    }

    // "by recent employee workId match": scan residents whose assigned workId (a loc) points at this target; prefer their current employer
    try {
      const resSys: any = this.residentsSystem;
      const allRes: any[] = resSys && resSys.getAllResidents ? resSys.getAllResidents() : [];
      for (const r of allRes) {
        if (r && (r.workId === targetId || (r as any).workId === targetId)) {
          if (r.employerId && this.businesses.has(r.employerId as any)) {
            const empBiz = this.businesses.get(r.employerId as any)!;
            this.targetCache.set(targetId, empBiz.id);
            return empBiz;
          }
          const nat = this.getBusiness(r.workId as any);
          if (nat) {
            this.targetCache.set(targetId, nat.id);
            return nat;
          }
        }
      }
    } catch { /* defensive, no throw in hot path */ }

    // Any with room (soft <12) , prefer "premium" (more cash for stability, or least staffed for opportunity signal)
    const roomy = this.getAllBusinesses().filter(b =>
      (!b.employeeIds || b.employeeIds.length < 12) && b.getEmployeeCount() < 14
    );
    if (roomy.length > 0) {
      roomy.sort((a, b) => (b.cash - a.cash) || (a.getEmployeeCount() - b.getEmployeeCount()));
      const pick = roomy[0];
      this.targetCache.set(targetId, pick.id);
      return pick;
    }

    // Last resort: first registered biz (better than nothing for demo)
    const any = this.getAllBusinesses()[0] || null;
    if (any) this.targetCache.set(targetId, any.id);
    return any;
  }

  // === Employment Coordination (Deeper Business-Resident Integration) ===

  /**
   * Coordinated hire that keeps BOTH sides in sync:
   * - Adds to business.employeeIds
   * - Sets resident.employerId (with hire side-effects on needs)
   * - Optional small hiring bonus paid from business cash to resident (real money flow)
   * Returns true on success. Idempotent if already employed here.
   * Extensible for future: agentic businesses can decide bonus amounts or reject hires.
   */
  hireEmployee(businessId: BusinessId, residentId: ResidentId): boolean {
    const business = this.businesses.get(businessId);
    if (!business) return false;

    const resident = this.residentsSystem.getResident(residentId);
    if (!resident) return false;

    // Already employed here?
    if (business.employeeIds.includes(residentId)) {
      // Ensure resident side is consistent (repair if needed)
      if (resident.employerId !== businessId) {
        resident.setEmployer(businessId);
      }
      return true;
    }

    const hired = business.hireEmployee(residentId);
    if (!hired) return false;

    // Apply resident-side linkage + effects
    resident.setEmployer(businessId);

    // Simple hiring bonus (half-day wage) — real money movement, funded by business if possible
    const bonus = Math.max(0, Math.floor(resident.hourlyWage * 4 * 100) / 100);
    if (bonus > 0 && business.cash >= bonus) {
      business.cash -= bonus;
      resident.money += bonus;
    }

    return true;
  }

  /**
   * Coordinated fire: removes from business list + clears resident employer + applies effects.
   * Pays modest severance (1 day wage) if business can afford it.
   * Triggers social stress on the resident via setEmployer(null).
   * Returns true if the employee was actually removed.
   */
  fireEmployee(businessId: BusinessId, residentId: ResidentId): boolean {
    const business = this.businesses.get(businessId);
    if (!business) return false;

    const resident = this.residentsSystem.getResident(residentId);

    const fired = business.fireEmployee(residentId);
    if (!fired) return false;

    // Severance (real money transfer) if affordable
    if (resident) {
      const severance = Math.max(0, Math.floor(resident.hourlyWage * 8 * 100) / 100);
      if (severance > 0 && business.cash >= severance) {
        business.cash -= severance;
        resident.money += severance;
      }

      // Clear linkage (triggers social stress hook inside Resident)
      if (resident.employerId === businessId) {
        resident.setEmployer(null);
      }
    }

    return true;
  }

  /**
   * Lookup the primary employer Business for a resident (first match).
   * With normal usage of hire/fire, at most one will match.
   */
  getEmployerForResident(residentId: ResidentId): Business | undefined {
    return this.getAllBusinesses().find(b => b.employeeIds.includes(residentId));
  }

  /**
   * Snapshot-friendly employment status for a single resident.
   * Used by inspectors and live charts.
   */
  getEmploymentStatus(residentId: ResidentId): { employed: boolean; employerId: BusinessId | null; employerName?: string } {
    const resident = this.residentsSystem.getResident(residentId);
    const employer = this.getEmployerForResident(residentId);
    return {
      employed: !!(resident && resident.employerId),
      employerId: (resident?.employerId ?? null) as BusinessId | null,
      employerName: employer?.name,
    };
  }

  /**
   * Aggregate employment statistics computed from live resident data + business rosters.
   * Powers God Mode charts, dashboard KPIs, and validation.
   */
  getEmploymentStats(): EmploymentStats {
    const allResidents = this.residentsSystem.getAllResidents();
    const allBusinesses = this.getAllBusinesses();

    if (allResidents.length === 0) {
      return {
        totalEmployed: 0,
        totalUnemployed: 0,
        employmentRate: 0,
        businessesWithEmployees: 0,
        averageEmployeesPerBusiness: 0,
        averageUnemploymentDurationHours: 0,
      };
    }

    const totalEmployed = allResidents.filter(r => r.employerId !== null).length;
    const totalUnemployed = allResidents.length - totalEmployed;
    const employmentRate = totalEmployed / allResidents.length;

    const businessesWithEmployees = allBusinesses.filter(b => b.getEmployeeCount() > 0).length;
    const totalEmpCount = allBusinesses.reduce((s, b) => s + b.getEmployeeCount(), 0);
    const averageEmployeesPerBusiness = allBusinesses.length > 0 ? totalEmpCount / allBusinesses.length : 0;

    // Unemployment duration average (for charts, inspector, God Mode)
    let averageUnemploymentDurationHours: number | undefined = undefined;
    const unemps = allResidents.filter(r => r.employerId === null);
    if (unemps.length > 0) {
      const sumTicks = unemps.reduce((sum, r) => sum + (r.unemploymentDurationTicks || 0), 0);
      averageUnemploymentDurationHours = Math.round((sumTicks / unemps.length / 60) * 10) / 10;
    }

    return {
      totalEmployed,
      totalUnemployed,
      employmentRate: Math.round(employmentRate * 1000) / 1000,
      businessesWithEmployees,
      averageEmployeesPerBusiness: Math.round(averageEmployeesPerBusiness * 100) / 100,
      averageUnemploymentDurationHours,
    };
  }

  // === Basic Job Search Behavior (Unemployment model) ===

  /**
   * Lightweight job search simulation step.
   * Unemployed residents occasionally get hired into businesses, with strong preference for
   * their assigned workId (the "natural" workplace from spawn). 
   * 
   * - Only runs periodically (cheap; ~every 20 ticks inside update).
   * - Probability scaled by unemployment duration (longer unemp = slightly higher chance to accept/apply).
   * - Uses deterministic pseudo-random based on tick + resident id hash (no external RNG dep).
   * - Leverages existing coordinated hireEmployee() → real money bonus, needs relief, bidirectional sync.
   * - "Open positions" treated softly: prefers businesses with < ~12 employees for demo balance (prevents total saturation).
   * 
   * Result: unemployment visibly fluctuates; long-term unemployed get relief; charts/inspector show dynamics.
   * Called automatically; also safe for manual God Mode / test invocation.
   * 
   * @returns JobSearchResult with hires performed and candidates evaluated (enables richer logging, tests, and UI).
   */
  runBasicJobSearch(): JobSearchResult {
    const unemployed = this.residentsSystem.getUnemployedResidents();
    const candidates = unemployed.length;
    if (candidates === 0) {
      return { hires: 0, candidatesConsidered: 0 };
    }

    const currentTick = this.timeSystem.tick;
    let hiresThisStep = 0;
    const MAX_HIRES_PER_STEP = 5; // Phase A: raised for more visible employment churn and activity state flips

    for (const resident of unemployed) {
      if (hiresThisStep >= MAX_HIRES_PER_STEP) break;

      const durTicks = resident.unemploymentDurationTicks || 0;
      const durH = durTicks / 60;

      // Phase A: boosted base chances (more hires over time) while still duration-biased and capped.
      // Faster churn = more residents moving between 'working' (commute+earn) and flexible unemp states.
      let chancePct = 8;
      if (durH > 3) chancePct = 13;
      if (durH > 10) chancePct = 19;
      if (durH > 24) chancePct = 26;

      // Agentic boost: if this resident has an explicit jobHuntTargetId (from AI decision), greatly increase chance.
      // Allows AI residents to "will" themselves into better jobs for realism and agency.
      if ((resident as any).jobHuntTargetId) {
        chancePct = Math.min(80, chancePct + 40);  // strong preference for AI intent
      }

      // Deterministic pseudo-random per resident + tick (stable for replays/tests)
      const hash = this.simpleIdHash(resident.id) + (currentTick % 97);
      const roll = hash % 100;
      if (roll >= chancePct) continue;

      // Agentic support: if resident has an explicit jobHuntTargetId from AI decision, strongly prefer it.
      // This makes "I decide to go after this job" actually lead to employment for agent-controlled residents.
      // Uses robust resolver (supports LocationId workplace targets from ctx.availableWorkplaces).
      let targetBiz: Business | undefined = undefined;
      if (resident.jobHuntTargetId) {
        targetBiz = this.resolveTargetToBusiness(resident.jobHuntTargetId) ?? undefined;
      }
      if (!targetBiz || targetBiz.employeeIds.includes(resident.id)) {
        // Prefer exact workId match (natural employer from spawn)
        targetBiz = this.getBusiness(resident.workId as BusinessId);
      }
      if (!targetBiz || targetBiz.employeeIds.includes(resident.id)) {
        // Fallback: any business with "room" (soft cap for demo liveliness)
        targetBiz = this.getAllBusinesses().find(b =>
          !b.employeeIds.includes(resident.id) &&
          b.getEmployeeCount() < 12
        );
      }
      if (!targetBiz) continue;

      // Soft capacity check for "open positions" feel (businesses can overhire but we bias here)
      if (targetBiz.getEmployeeCount() >= 14) continue;

      const hired = this.hireEmployee(targetBiz.id, resident.id);
      if (hired) {
        hiresThisStep++;
        // Agentic wage uplift on successful targeted hire (arrival or search): choosing a "better" job via job_target decision now pays ongoing higher hourly.
        // This is what lets a deliberate AI resident compound to "at the top" through free labor market participation (realism: better jobs exist and reward informed choice).
        // Use presence of original jobHuntTargetId (the intent) rather than exact id match, because resolver may map loc->biz.id while keeping original targetId for Movement.
        if ((resident as any).jobHuntTargetId) {
          const prevW = resident.hourlyWage || 12;
          resident.hourlyWage = Math.max(prevW, 17.5 + ((hiresThisStep + resident.id.length) % 5));
          (resident as any).jobHuntTargetId = null; // achieved
          // Note: the bonus in hireEmployee already injected a little cash; the rate change affects future payrolls.
        }
      }

      // Brainstorm: 'interview' decision support (talk to boss for better pay).
      // Voluntary choice (set interviewTargetId in apply) -> here on search/hire consideration, small state-biased chance for extra uplift or bonus.
      // Realism: arrive/state (low fatigue) affects success; produces real wage change + future disburse. Free market layer on top of target bidding.
      if ((resident as any).interviewTargetId && resident.employerId) {
        const fatigue = (resident as any).needs?.fatigue ?? 30;
        const base = 0.35 + (1 - Math.min(100, fatigue) / 140); // fresher = better impression
        const roll = (this as any).simpleIdHash ? ((this as any).simpleIdHash(resident.id + (resident.hourlyWage||0)) % 100) / 100 : 0.5;
        if (roll < base) {
          const prev = resident.hourlyWage || 12;
          resident.hourlyWage = Math.max(prev, prev + 1.2 + (roll * 2));
          (resident as any).interviewTargetId = null;
          // small one-time for "successful talk"
          resident.money = (resident.money || 0) + 12;
        } else {
          // no change or mild letdown (no penalty to keep positive)
          (resident as any).interviewTargetId = null;
        }
      }
    }

    return { hires: hiresThisStep, candidatesConsidered: candidates };
  }

  /** Tiny deterministic string hash for pseudo-random rolls (no RNG dep in this system). */
  private simpleIdHash(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
      h = (h * 31 + id.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  // === Economy Aggregates ===

  /** Roll-up stats across every registered business. Rounded for display friendliness. */
  getTotalEconomyStats(): EconomyStats {
    const all = this.getAllBusinesses();
    if (all.length === 0) {
      return {
        count: 0,
        totalCash: 0,
        totalRevenue: 0,
        totalExpenses: 0,
        totalProfit: 0,
        totalEmployees: 0,
        averageCash: 0,
      };
    }

    const totalCash = all.reduce((sum, b) => sum + b.cash, 0);
    const totalRevenue = all.reduce((sum, b) => sum + b.totalRevenue, 0);
    const totalExpenses = all.reduce((sum, b) => sum + b.totalExpenses, 0);
    const totalProfit = all.reduce((sum, b) => sum + b.calculateProfit(), 0);
    const totalEmployees = all.reduce((sum, b) => sum + b.getEmployeeCount(), 0);

    return {
      count: all.length,
      totalCash: Math.round(totalCash * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      totalEmployees,
      averageCash: Math.round((totalCash / all.length) * 100) / 100,
    };
  }

  // === Day-Boundary Processing (core behavior) ===

  /**
   * Main tick entry point. Safe to call every simulation tick.
   * Only triggers full business day processing when the simulated calendar day changes.
   * This matches the "on day boundaries" requirement and keeps cost low (no work most ticks).
   */
  update(): void {
    const currentDay = this.timeSystem.day;
    if (currentDay !== this.lastProcessedDay) {
      this.processAllBusinessDays();
      this.lastProcessedDay = currentDay;
    }

    // Basic job search / unemployment dynamics (lightweight)
    // Phase A Core Stabilization: run much more frequently (~every 8 ticks) for rapid visible hiring/firing churn.
    // Combined with higher per-step caps + chances below, this keeps employment dynamic, money flowing,
    // and resident activity states (working vs at_home) changing often -> more commuting.
    if (this.timeSystem.tick % 8 === 0) {
      this.runBasicJobSearch(); // return value (hires/candidates) available for advanced logging or metrics
    }
  }

  /** Internal: drive one processDay + real wage disbursement for every business. */
  private processAllBusinessDays(): void {
    for (const business of this.businesses.values()) {
      // === Phase 7 BusinessBrain hook (pre-process, optional, zero-cost when disabled) ===
      // Brains see fresh context, propose narrow deltas, we apply safely, then log.
      // When brainEnabled===false this entire path is skipped — 100% identical behavior to pre-Phase 7.
      this.runBrainDecisionsForBusiness(business);

      // Rule-based operations (production, sales, operating costs + estimated wage expenses)
      // Now incorporates any brain-driven priceMultiplier / productionMultiplier from above.
      business.processDay();

      // Real linkage: pay actual employees using resident data (daily payroll from business cash)
      this.disburseRealWages(business);

      // === Phase A Core Stabilization: simple rule-based hiring/firing (non-brain path, always on) ===
      // Businesses fire when cash critically low (after wages/ops) -> visible unemployment spikes + behavior shifts.
      // Light auto-hire nudge when very flush (encourages more employment over long runs).
      // Uses only public hire/fire + existing resident lists. Creates economic feedback + activity variety.
      if (business.cash < -150 && business.employeeIds.length > 1) {
        const lastEmp = business.employeeIds[business.employeeIds.length - 1];
        this.fireEmployee(business.id, lastEmp as any);
      } else if (business.cash > 12000 && business.getEmployeeCount() < 9) {
        // Opportunistic: attempt one hire from current unemployed pool (prefers natural workId matches via job search path)
        const unemp = this.residentsSystem.getUnemployedResidents();
        const match = unemp.find(r => r.workId === business.id && !business.employeeIds.includes(r.id));
        const candidate = match || unemp.find(r => !business.employeeIds.includes(r.id));
        if (candidate) {
          this.hireEmployee(business.id, candidate.id);
        }
      }
    }
  }

  /**
   * For every employee of this business:
   * - Lookup the live Resident via ResidentsSystem
   * - Compute daily wage from their real hourlyWage (standard 8-hour day)
   * - Transfer: reduce business cash, increase resident money
   * 
   * This is the key "wiring" step requested: businesses now actually pay residents.
   * The Business entity's internal wagePerEmployeePerDay estimate remains untouched
   * (its P&L continues to use its own rule parameters for self-containment).
   *
   * ENHANCED (agents at the top): the live hourlyWage from Resident is authoritative.
   * Job switches by AI-controlled residents (via getResidentContextForAI dailyEarningsPotential
   * + job_target decision) immediately affect the next disburse amount + [PAYROLL DISBURSE] log.
   * This makes "I switched to $16/hr job -> my future paydays are visibly larger" real and measurable
   * in the play harness (combined with conserve for net wealth climb).
   */
 
  private disburseRealWages(business: Business): void {
    if (business.employeeIds.length === 0) return;

    const HOURS_PER_WORKDAY = 8;

    for (const empId of business.employeeIds) {
      const resident = this.residentsSystem.getResident(empId);
      if (!resident) {
        // Employee id may be dangling (future: cleanup hooks). Skip gracefully.
        continue;
      }

      const wage = resident.hourlyWage * HOURS_PER_WORKDAY;

      // Real transfer (business funds the payroll)
      // Cash may go negative — this is explicitly allowed by the Business foundation.
      business.cash -= wage;
      resident.money += wage;
      // CIM: real wage uplift from voluntary job choice (job_target + hire) directly increases netWealth
      if (typeof (resident as any).recordWageEarned === 'function') {
        (resident as any).recordWageEarned(wage);
      }

      // === Observability for AI agent wealth play harness (Priority 1: wage switches scale visible gains) ===
      // After a resident executes job_target + arrival hire -> [WEALTH SWITCH SUCCESS] to higher hourlyWage,
      // the very next disburseRealWages (called from processAllBusinessDays on day boundaries) will
      // transfer a *larger* amount using the live resident.hourlyWage. This log makes the scaling
      // immediately obvious in play-rich-ai.test.ts output (interleaved with [POST-SWITCH DISBURSE] etc).
      // Free markets + realism: choosing a higher-value job via deliberate AI decision now produces
      // compounding, observable higher daily payroll and faster wealth accumulation vs baseline.
      // (Play harness + future resident brains can now "see" the effect via dailyEarningsPotential in ctx
      // and watch the money curve respond.)
      console.log(`[PAYROLL DISBURSE] ${resident.name || empId} paid $${wage.toFixed(2)} ($$${resident.hourlyWage.toFixed(2)}/hr × ${HOURS_PER_WORKDAY}h) — live rate drives real money gain`);
    }
  }

  // === Observability & Serialization ===

  /** Full snapshot for inspectors, dashboards, God Mode, and debugging. */
  getSnapshot(): BusinessSystemSnapshot {
    return {
      count: this.businesses.size,
      lastProcessedDay: this.lastProcessedDay,
      businesses: this.getAllBusinesses().map(b => b.getSnapshot()),
      economy: this.getTotalEconomyStats(),
      employment: this.getEmploymentStats(),
    };
  }

  /**
   * Serializable payload suitable for save/load expansion.
   * Uses each Business's faithful toJSON().
   */
  getSerializableState(): BusinessSystemSerializableState {
    return {
      lastProcessedDay: this.lastProcessedDay,
      businesses: this.getAllBusinesses().map(b => b.toJSON()),
    };
  }

  // === Test & Maintenance Utilities ===

  /** Remove a business (rare in normal sim; useful in tests / dynamic scenarios). */
  removeBusiness(id: BusinessId): boolean {
    return this.businesses.delete(id);
  }

  /** Clear all businesses and reset day tracker (primarily for tests). */
  clear(): void {
    this.businesses.clear();
    this.lastProcessedDay = this.timeSystem.day;
  }

  // === God Mode / Debug Controls (for BusinessGodMode tooling + scenario experiments) ===
  // Clean, observable, safe mutations with real side-effects on residents where applicable.
  // All actions are logged by callers (GodModeTools) and immediately visible in snapshots/charts.

  /**
   * Force immediate full day processing across ALL businesses.
   * Executes processDay() (production/sales/ops) + real wage disbursements from business cash to actual linked residents.
   * If brain logging is enabled, brain decisions also run (pre-process).
   * Day counter is NOT advanced (pure God Mode trigger). Safe to call repeatedly.
   */
  forceProcessBusinessDay(): void {
    this.processAllBusinessDays();
  }

  /**
   * Inject (or drain) cash into a specific business by delta amount.
   * Use positive for stimulus, negative for stress tests. Returns true if business existed.
   */
  injectCash(businessId: BusinessId, amount: number): boolean {
    const b = this.businesses.get(businessId);
    if (!b) return false;
    b.cash += amount;
    return true;
  }

  /** Inject the same delta into every registered business. Returns count affected. */
  injectCashToAll(amount: number): number {
    let affected = 0;
    for (const b of this.businesses.values()) {
      b.cash += amount;
      affected++;
    }
    return affected;
  }

  /** Return list of currently unemployed resident IDs (no employerId). Useful for God Mode hire actions. */
  getUnemployedResidentIds(): ResidentId[] {
    return this.residentsSystem.getUnemployedResidents().map(r => r.id);
  }

  // === Phase 7 BusinessBrain Controls (tiny public surface, called by GodModeTools + tests) ===

  /**
   * Enable or disable the BusinessBrain decision layer globally.
   * When disabled (default): zero overhead, zero behavior change — perfect backward compatibility.
   * When enabled: RuleBasedBrain (or future swapped impl) is instantiated once and consulted on every day boundary.
   */
  enableBrainLogging(enabled: boolean): void {
    const wasEnabled = this.brainEnabled;
    this.brainEnabled = enabled;

    if (enabled && !this.brain) {
      this.brain = createRuleBasedBrain();
    }

    if (enabled && !wasEnabled) {
      // Fresh start for this session's decision history
      this.totalDecisionsLogged = 0;
      for (const b of this.businesses.values()) {
        b.clearDecisionLog();
      }
    }
  }

  isBrainEnabled(): boolean {
    return this.brainEnabled;
  }

  /** Rich stats for God Mode readout + inspector + charts. */
  getBrainStats(): { enabled: boolean; brainName?: string; totalDecisionsLogged: number; businessesWithBrains: number } {
    let withBrains = 0;
    for (const b of this.businesses.values()) {
      if (b.getBrain() || this.brainEnabled) withBrains++; // when global on, all are "under brain regime"
    }
    return {
      enabled: this.brainEnabled,
      brainName: this.brain?.name,
      totalDecisionsLogged: this.totalDecisionsLogged,
      businessesWithBrains: withBrains,
    };
  }

  /** Query decisions for a specific business (used by God Mode "recent decisions" display). */
  getBusinessDecisionLog(businessId: BusinessId): DecisionLogEntry[] {
    const b = this.businesses.get(businessId);
    return b ? b.getDecisionLog() : [];
  }

  // Internal: build context + ask brain + apply narrow sandboxed effects + record log
  private runBrainDecisionsForBusiness(business: Business): void {
    if (!this.brainEnabled || !this.brain || typeof (this.brain as any).decide !== 'function') {
      if (this.brainEnabled && this.brain) {
        console.warn('[BusinessSystem] brain present but no .decide — skipping (transient wiring edge in harness/A/B path). Safe no-op for this tick.');
      }
      return;
    }

    const ctx: BusinessContext = buildBusinessContext(business, this.timeSystem.day);
    const rawDecisions: BusinessDecision[] = this.brain.decide(ctx);
    if (!rawDecisions || rawDecisions.length === 0) return;

    // Apply with clamps (defense-in-depth sandbox)
    for (const d of rawDecisions) {
      const safeDelta = clampDecisionDelta(d.type, d.delta);

      if (d.type === 'pricing') {
        // Mutate the multiplier (processDay will use it for effective price)
        business.priceMultiplier = Math.max(0.4, Math.min(4.0, business.priceMultiplier + safeDelta));
      } else if (d.type === 'production') {
        business.productionMultiplier = Math.max(0.2, Math.min(3.0, business.productionMultiplier + safeDelta));
      } else if (d.type === 'hiring') {
        // Advisory only — sets the target the brain "wants". No employee mutation here (sandbox).
        const current = business.staffingTarget > 0 ? business.staffingTarget : business.getEmployeeCount();
        business.staffingTarget = Math.max(0, Math.floor(current + safeDelta));
      }
    }

    // Record the exact decisions + context that produced them
    const entry: DecisionLogEntry = {
      timestamp: Date.now(),
      simDay: this.timeSystem.day,
      simTick: this.timeSystem.tick,
      businessId: business.id,
      contextSnapshot: {
        cash: ctx.cash,
        totalProfit: ctx.totalProfit,
        employeeCount: ctx.employeeCount,
        inventory: { ...ctx.inventory },
        baseSellPrice: ctx.baseSellPrice,
        priceMultiplier: ctx.priceMultiplier,
        productionMultiplier: ctx.productionMultiplier,
        staffingTarget: ctx.staffingTarget,
      },
      decisions: rawDecisions.map(d => ({ ...d, delta: clampDecisionDelta(d.type, d.delta) })), // store clamped too
      brainName: this.brain.name,
    };

    business.recordBrainDecision(entry);
    this.totalDecisionsLogged += rawDecisions.length;
  }
}
