/**
 * Business Entity
 * 
 * Foundational scaffolding for the Businesses & Economy layer (Phase 4).
 * Prepares the ground for Phase 7 Agentic Businesses.
 *
 * === DESIGN NOTES (Foundation - Rule-based only) ===
 * - Core identity: id (stable), name, type (extensible union of common city businesses).
 * - P&L: Simple double-entry style tracking via totalRevenue / totalExpenses (cumulative).
 *   - `cash` represents current balance sheet cash position (can go negative = debt for now).
 *   - calculateProfit() = totalRevenue - totalExpenses (lifetime). Daily P&L returned from processDay.
 * - Inventory: Flexible Record<string, number> keyed by resource names (ore, lumber, crops, food, oil, goods...).
 *   Extensible without schema changes. Methods enforce non-negative quantities.
 * - Employees: Array of ResidentId (loose coupling — no direct object refs). Hire/fire are simple.
 *   Wage costs are rule-based estimates (per-employee daily wage). Real linkage to Resident.hourlyWage comes later.
 * - Rule-based operations (processDay):
 *   - Pay fixed operating costs only (Phase A fix: variable wages removed from here to prevent double-dipping;
 *     real wages disbursed once via BusinessSystem.disburseRealWages using live Resident data).
 *   - Produce primary output resource (scales weakly with employee count; baseline production always occurs).
 *   - Sell a configurable fraction of current inventory of the output good at a type-specific price.
 *   - All money movements update cash + P&L trackers.
 * - No dependency on TimeSystem/Resident yet (pure entity). Future BusinessSystem will drive processDay on day boundaries
 *   and may call lighter per-tick updates.
 * - Serializable by default:
 *   - getSnapshot(): UI / inspector / debug friendly (rounded, derived profit, employeeCount).
 *   - toJSON() + static fromJSON(): Full faithful state for save/load.
 * - Extensibility hooks:
 *   - All economic tunables (costs, rates, prices) are public instance fields — easy for future BusinessBrain
 *     (Phase 7) to read context and mutate strategy without changing core logic.
 *   - Phase 7 delivered: priceMultiplier / productionMultiplier / staffingTarget + decisionLog + setBrain / getDecisionLog.
 *   - Primary output mapping and defaults per type are centralized.
 *   - Placeholder for more resources, multiple outputs, input consumption (recipes), market price variation later.
 * - Failure modes: Cash can go deeply negative; no bankruptcy logic yet (Phase 4+).
 * - Alignment: Mirrors Resident.ts style — rich JSDoc, public fields for observability, getSnapshot(), clean methods,
 *   no over-engineering, focused on testability and future integration.
 *
 * References:
 * - plans/city-with-life-development-plan.md (Phase 4 must-haves + Phase 7 agentic prep)
 * - references/simcity-claude-reference.md (P&L, inventory, employees, resource trading)
 * - ARCHITECTURE.md (entities/ are pure data + behavior; systems own orchestration)
 */

import type { ResidentId } from './Resident';
import type { IDecisionMaker, DecisionLogEntry } from '../systems/business/BusinessBrain';

export type BusinessId = string;

export type BusinessType =
  | 'mine'
  | 'lumberyard'
  | 'farm'
  | 'bakery'
  | 'factory'
  | 'general_store'
  | 'oil_rig';

export interface BusinessSnapshot {
  id: BusinessId;
  name: string;
  type: BusinessType;
  cash: number;
  totalRevenue: number;
  totalExpenses: number;
  profit: number;
  inventory: Record<string, number>;
  employeeCount: number;
  employeeIds: ResidentId[];
  operatingCostPerDay: number;
  baseProductionPerDay: number;
  // === Phase 7 BusinessBrain strategy levers (present for observability; default neutral when brain disabled) ===
  priceMultiplier?: number;
  productionMultiplier?: number;
  staffingTarget?: number;
}

export interface ProcessDayResult {
  dailyRevenue: number;
  dailyExpenses: number;
  dailyProfit: number;
  produced: number;
  sold: number;
  outputResource: string;
}

export class Business {
  public readonly id: BusinessId;
  public name: string;
  public readonly type: BusinessType;

  // Balance sheet
  public cash: number;

  // P&L tracking (cumulative lifetime)
  public totalRevenue: number = 0;
  public totalExpenses: number = 0;

  // Inventory: key = resource name (e.g. 'ore', 'lumber', 'food', 'crops', 'oil', 'goods')
  // Values are always non-negative. Use addToInventory / removeFromInventory.
  public inventory: Record<string, number> = {};

  // Employees (Resident IDs only — loose coupling for now)
  public employeeIds: ResidentId[] = [];

  // === Rule-based operation parameters (public for inspection + future agentic mutation) ===
  public operatingCostPerDay: number;
  public baseProductionPerDay: number;
  public wagePerEmployeePerDay: number;
  public baseSellPrice: number; // simplistic fixed price per unit of primary output

  // Rule tuning (static for foundation; can become instance fields later)
  private static readonly SELL_FRACTION = 0.45; // sell up to ~45% of available output stock each day
  private static readonly MIN_PRODUCTION_MULTIPLIER = 0.25;

  // === Phase 7 BusinessBrain strategy levers (neutral defaults guarantee ZERO behavior change when brain disabled) ===
  /** Multiplier applied to baseSellPrice inside processDay. 1.0 = neutral (no brain or disabled). */
  public priceMultiplier: number = 1.0;
  /** Multiplier applied to baseProductionPerDay inside processDay. 1.0 = neutral. */
  public productionMultiplier: number = 1.0;
  /** Advisory target headcount set by brain (0 = "no preference"). Does not auto-hire/fire. */
  public staffingTarget: number = 0;

  /** Decision log (Phase 7). Only populated when a brain is attached + enabled in BusinessSystem. */
  private decisionLog: DecisionLogEntry[] = [];
  /** Optional attached brain (future per-business brains supported; global toggle lives in BusinessSystem). */
  private brain?: IDecisionMaker;

  constructor(params: {
    id: BusinessId;
    name: string;
    type: BusinessType;
    cash?: number;
    operatingCostPerDay?: number;
    baseProductionPerDay?: number;
    wagePerEmployeePerDay?: number;
    baseSellPrice?: number;
    initialInventory?: Record<string, number>;
  }) {
    this.id = params.id;
    this.name = params.name;
    this.type = params.type;
    this.cash = params.cash ?? 5000;

    const defaults = Business.getDefaultsForType(params.type);
    this.operatingCostPerDay = params.operatingCostPerDay ?? defaults.operatingCostPerDay;
    this.baseProductionPerDay = params.baseProductionPerDay ?? defaults.baseProductionPerDay;
    this.wagePerEmployeePerDay = params.wagePerEmployeePerDay ?? defaults.wagePerEmployeePerDay;
    this.baseSellPrice = params.baseSellPrice ?? defaults.baseSellPrice;

    if (params.initialInventory) {
      // Defensive copy + sanitize
      this.inventory = {};
      for (const [res, qty] of Object.entries(params.initialInventory)) {
        if (typeof qty === 'number' && qty > 0) {
          this.inventory[res] = Math.floor(qty);
        }
      }
    }
  }

  /** Centralized sensible defaults per business archetype (easy to tweak) */
  private static getDefaultsForType(type: BusinessType): {
    operatingCostPerDay: number;
    baseProductionPerDay: number;
    wagePerEmployeePerDay: number;
    baseSellPrice: number;
  } {
    switch (type) {
      case 'mine':
        return { operatingCostPerDay: 135, baseProductionPerDay: 7, wagePerEmployeePerDay: 98, baseSellPrice: 48 };
      case 'lumberyard':
        return { operatingCostPerDay: 95, baseProductionPerDay: 11, wagePerEmployeePerDay: 82, baseSellPrice: 29 };
      case 'farm':
        return { operatingCostPerDay: 55, baseProductionPerDay: 18, wagePerEmployeePerDay: 68, baseSellPrice: 11 };
      case 'bakery':
        return { operatingCostPerDay: 78, baseProductionPerDay: 22, wagePerEmployeePerDay: 72, baseSellPrice: 21 };
      case 'factory':
        return { operatingCostPerDay: 165, baseProductionPerDay: 9, wagePerEmployeePerDay: 115, baseSellPrice: 68 };
      case 'general_store':
        return { operatingCostPerDay: 65, baseProductionPerDay: 6, wagePerEmployeePerDay: 78, baseSellPrice: 32 };
      case 'oil_rig':
        return { operatingCostPerDay: 220, baseProductionPerDay: 5, wagePerEmployeePerDay: 135, baseSellPrice: 95 };
      default:
        return { operatingCostPerDay: 100, baseProductionPerDay: 10, wagePerEmployeePerDay: 90, baseSellPrice: 30 };
    }
  }

  /** Returns the primary resource this business produces (simple 1:1 mapping for foundation) */
  getPrimaryOutput(): string {
    switch (this.type) {
      case 'mine': return 'ore';
      case 'lumberyard': return 'lumber';
      case 'farm': return 'crops';
      case 'bakery': return 'food';
      case 'factory': return 'goods';
      case 'oil_rig': return 'oil';
      case 'general_store': return 'goods';
      default: return 'goods';
    }
  }

  // === Employee Management ===

  hireEmployee(residentId: ResidentId): boolean {
    if (!residentId || this.employeeIds.includes(residentId)) {
      return false;
    }
    this.employeeIds.push(residentId);
    return true;
  }

  fireEmployee(residentId: ResidentId): boolean {
    const index = this.employeeIds.indexOf(residentId);
    if (index === -1) return false;
    this.employeeIds.splice(index, 1);
    return true;
  }

  // === Inventory Management (never negative) ===

  /** Add positive quantity of a resource. */
  addToInventory(resource: string, amount: number): void {
    if (!resource || amount <= 0) return;
    const current = this.inventory[resource] ?? 0;
    this.inventory[resource] = current + Math.floor(amount);
  }

  /**
   * Remove up to `amount` (clamped to available). Returns actual quantity removed.
   * Cleans up zero entries.
   */
  removeFromInventory(resource: string, amount: number): number {
    if (!resource || amount <= 0) return 0;
    const current = this.inventory[resource] ?? 0;
    const removed = Math.min(current, Math.floor(amount));
    if (removed <= 0) return 0;

    const remaining = current - removed;
    if (remaining <= 0) {
      delete this.inventory[resource];
    } else {
      this.inventory[resource] = remaining;
    }
    return removed;
  }

  getInventory(resource?: string): number | Record<string, number> {
    if (resource) {
      return this.inventory[resource] ?? 0;
    }
    return { ...this.inventory };
  }

  // === Core Rule-Based Behavior ===

  /**
   * Execute one simulated day of operations.
   * This is the heart of the current rule-based Business behavior.
   *
   * Sequence (simple but realistic foundation - Phase A hardened):
   * 1. Pay fixed operating costs only (real wages are disbursed separately by BusinessSystem.disburseRealWages
   *    using actual Resident hourlyWage values for true money flow linkage; prevents double-dipping).
   * 2. Produce primary output (scales with headcount + baseline).
   * 3. Sell a rule-configured fraction of the output inventory at fixed price.
   * 4. Update cash + cumulative P&L.
   *
   * Returns detailed daily result for logging / systems / future observability.
   */
  processDay(): ProcessDayResult {
    const numEmployees = this.employeeIds.length;
    const outputResource = this.getPrimaryOutput();

    // 1. Expenses: fixed operating costs ONLY (wages handled explicitly in BusinessSystem for real resident linkage + single source of truth)
    const dailyExpenses = this.operatingCostPerDay;

    this.cash -= dailyExpenses;
    this.totalExpenses += dailyExpenses;

    // 2. Production (employees help, but business can limp along with low staff)
    const productionMultiplier = Math.max(
      Business.MIN_PRODUCTION_MULTIPLIER,
      (numEmployees * 0.65) + 0.6
    );
    // Phase 7: fold in brain-controlled production intent (neutral 1.0 when disabled / no brain)
    const effectiveProd = productionMultiplier * this.productionMultiplier;
    const produced = Math.floor(this.baseProductionPerDay * effectiveProd);
    if (produced > 0) {
      this.addToInventory(outputResource, produced);
    }

    // 3. Sales — rule-based inventory clearance
    const available = this.inventory[outputResource] ?? 0;
    const desiredSell = Math.floor(available * Business.SELL_FRACTION);
    const sold = this.removeFromInventory(outputResource, desiredSell);
    // Phase 7: fold in brain-controlled pricing (neutral 1.0 when disabled / no brain)
    const effectiveSellPrice = this.baseSellPrice * this.priceMultiplier;
    const dailyRevenue = sold * effectiveSellPrice;

    this.cash += dailyRevenue;
    this.totalRevenue += dailyRevenue;

    const dailyProfit = dailyRevenue - dailyExpenses;

    return {
      dailyRevenue: Math.round(dailyRevenue * 100) / 100,
      dailyExpenses: Math.round(dailyExpenses * 100) / 100,
      dailyProfit: Math.round(dailyProfit * 100) / 100,
      produced,
      sold,
      outputResource,
    };
  }

  /** Lifetime profit (can be negative). */
  calculateProfit(): number {
    return this.totalRevenue - this.totalExpenses;
  }

  // === Observability & Serialization ===

  getEmployeeCount(): number {
    return this.employeeIds.length;
  }

  // === Phase 7 BusinessBrain hooks (minimal surface, called only by BusinessSystem when enabled) ===

  /** Attach or detach a decision maker. When null/undefined, business behaves exactly as pre-Phase 7. */
  setBrain(brain: IDecisionMaker | undefined): void {
    this.brain = brain;
  }

  getBrain(): IDecisionMaker | undefined {
    return this.brain;
  }

  /**
   * Record a decision log entry (timestamped + full context at decision time).
   * BusinessSystem calls this after a brain produces decisions and applies safe deltas.
   * Log is capped internally to protect long-running simulations.
   */
  recordBrainDecision(entry: DecisionLogEntry): void {
    this.decisionLog.push(entry);
    // Cap at 64 recent decisions per business (plenty for inspector + God Mode; keeps memory bounded)
    if (this.decisionLog.length > 64) {
      this.decisionLog.shift();
    }
  }

  /** Returns a defensive copy of the decision log (empty when brain disabled or never triggered). */
  getDecisionLog(): DecisionLogEntry[] {
    return [...this.decisionLog];
  }

  /** Clears the decision log (God Mode / test utility). */
  clearDecisionLog(): void {
    this.decisionLog = [];
  }

  /**
   * UI / God Mode / debug friendly snapshot.
   * Numbers rounded for display; includes derived profit.
   * Phase 7: now also surfaces the brain strategy multipliers for live inspection.
   */
  getSnapshot(): BusinessSnapshot {
    const profit = this.calculateProfit();
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      cash: Math.round(this.cash * 100) / 100,
      totalRevenue: Math.round(this.totalRevenue * 100) / 100,
      totalExpenses: Math.round(this.totalExpenses * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      inventory: { ...this.inventory },
      employeeCount: this.employeeIds.length,
      employeeIds: [...this.employeeIds],
      operatingCostPerDay: this.operatingCostPerDay,
      baseProductionPerDay: this.baseProductionPerDay,
      // Phase 7 additions (omitted when exactly neutral for cleanliness, but always safe to read)
      priceMultiplier: this.priceMultiplier,
      productionMultiplier: this.productionMultiplier,
      staffingTarget: this.staffingTarget,
    };
  }

  /**
   * Full serializable state (for save/load).
   * Roundtrips perfectly via Business.fromJSON().
   */
  toJSON(): any {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      cash: this.cash,
      totalRevenue: this.totalRevenue,
      totalExpenses: this.totalExpenses,
      inventory: { ...this.inventory },
      employeeIds: [...this.employeeIds],
      operatingCostPerDay: this.operatingCostPerDay,
      baseProductionPerDay: this.baseProductionPerDay,
      wagePerEmployeePerDay: this.wagePerEmployeePerDay,
      baseSellPrice: this.baseSellPrice,
      // Phase 7 brain strategy state (roundtrips cleanly; neutral defaults if absent on load)
      priceMultiplier: this.priceMultiplier,
      productionMultiplier: this.productionMultiplier,
      staffingTarget: this.staffingTarget,
    };
  }

  /** Reconstruct a Business from a previously serialized toJSON() payload. */
  static fromJSON(data: any): Business {
    if (!data || !data.id || !data.name || !data.type) {
      throw new Error('Invalid Business JSON data');
    }

    const business = new Business({
      id: data.id,
      name: data.name,
      type: data.type as BusinessType,
      cash: typeof data.cash === 'number' ? data.cash : 5000,
      operatingCostPerDay: data.operatingCostPerDay,
      baseProductionPerDay: data.baseProductionPerDay,
      wagePerEmployeePerDay: data.wagePerEmployeePerDay,
      baseSellPrice: data.baseSellPrice,
      initialInventory: data.inventory,
    });

    // Restore accumulators (constructor zeros them)
    business.totalRevenue = typeof data.totalRevenue === 'number' ? data.totalRevenue : 0;
    business.totalExpenses = typeof data.totalExpenses === 'number' ? data.totalExpenses : 0;

    // employeeIds already set via constructor if initial, but ensure from data
    if (Array.isArray(data.employeeIds)) {
      business.employeeIds = [...data.employeeIds];
    }

    // Phase 7: restore brain strategy levers (graceful defaults preserve pre-brain behavior)
    if (typeof data.priceMultiplier === 'number') business.priceMultiplier = data.priceMultiplier;
    if (typeof data.productionMultiplier === 'number') business.productionMultiplier = data.productionMultiplier;
    if (typeof data.staffingTarget === 'number') business.staffingTarget = data.staffingTarget;

    return business;
  }
}
