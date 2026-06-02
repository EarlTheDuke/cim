/**
 * BusinessBrain — Phase 7 Agentic Businesses Foundation (Crown Jewel Prep)
 *
 * Clean, swappable, heavily logged scaffolding for future LLM-powered business decision making.
 * ZERO actual LLM / network calls in this file — pure deterministic scaffolding + explainable logging.
 *
 * === EXACT ALIGNMENT WITH MASTER PLAN (plans/city-with-life-development-plan.md) ===
 * Phase 7: "Agentic Businesses (The Crown Jewel)"
 *   - "We will design a clean 'BusinessBrain' interface"
 *   - "Businesses will receive structured context (their financials, market conditions, employee situation)"
 *   - "We will start with narrow decision scopes (pricing, production targets, hiring)"
 *   - "Heavy investment in decision logging and explainability"
 *   - "Ability to easily disable agentic mode per business"
 *   - "A/B testing (same starting conditions, one with agentic businesses, one without)"
 *   - "Strong sandboxing of what decisions a business can actually make"
 *   - "Excellent logging + replay capability"
 *
 * LLM Integration Strategy (Critical for Phase 7+):
 *   - All LLM calls must go through a well-defined abstraction layer (this IDecisionMaker)
 *   - We must be able to swap providers and mock them for testing
 *   - Every LLM call must be logged with full context + response + timestamp
 *   - Cost tracking from day one in Phase 7
 *
 * === NON-NEGOTIABLES (for future LLM safety & correctness) ===
 * - Decisions are NARROW + SANDBOXED:
 *     • pricing delta (affects effective sell price via multiplier)
 *     • target employee count delta (advisory; logged for job-search / inspector / future auto-hire bias)
 *     • production intent delta (affects effective output via multiplier)
 *   NEVER: direct cash moves, arbitrary inventory, firing specific people, price setting to absolute, etc.
 * - Every decision is logged with rich context snapshot taken at decision time.
 * - Toggleable globally (BusinessSystem) or attach per-business (future).
 * - When disabled / no brain: ZERO behavior change to Business.processDay or any money/employee flows.
 * - Fully deterministic (no Math.random) so A/B harnesses + replays + seeds are identical.
 * - Snapshot + serialization friendly (logs are queryable; multipliers persist in Business JSON).
 *
 * === HOW TO SWAP IN A REAL GROK PROVIDER (future agent task) ===
 * 1. Implement `class GrokBusinessBrain implements IDecisionMaker { decide(ctx) { ... } }`
 *    - Build a concise, structured prompt from BusinessContext (include P&L, inventory, employees, recent log history).
 *    - Call Grok API (or xAI SDK) with tool-use / JSON mode.
 *    - STRICTLY validate + clamp the returned decisions array to the three allowed types + safe numeric bounds.
 *    - Record raw prompt, raw response, token usage, and estimated cost in an extended log entry (or side log).
 * 2. The apply logic + clamps in BusinessSystem stay exactly the same — only the source of decisions changes.
 * 3. Add a small cost accumulator on the provider (or in BusinessSystem) exposed via getBrainStats().
 * 4. Support "shadow mode": call real LLM but ignore its decisions (only log) for safe evaluation.
 * 5. Per-business brains: BusinessSystem can hold a Map<BusinessId, IDecisionMaker> in the future.
 *
 * References:
 * - plans/city-with-life-development-plan.md (Phase 7 + LLM Strategy + Risk Register)
 * - AGENTS.md (Agent BB ownership + success criteria)
 * - src/entities/Business.ts (processDay + the three new strategy multipliers this brain controls)
 * - src/systems/BusinessSystem.ts (the registration/hook site + enable/disable + stats)
 *
 * This file is intentionally small, pure, and side-effect free except for the data it returns.
 */

import type { BusinessId, BusinessType } from '../../entities/Business';

/** Narrow, sandboxed decision kinds the brain is allowed to propose. */
export type DecisionType = 'pricing' | 'hiring' | 'production';

export interface BusinessDecision {
  /** Which narrow lever this decision targets. */
  type: DecisionType;

  /**
   * Signed numeric delta (units depend on type):
   * - pricing: dollar amount to add to effective price (e.g. +1.25 or -2.0)
   * - hiring: integer change to desired staffing target (e.g. +2 or -1)
   * - production: fractional change to production multiplier (e.g. +0.10 or -0.07)
   */
  delta: number;

  /**
   * Human-readable (and future LLM-auditable) explanation.
   * This is the #1 deliverable for Phase 7 explainability.
   */
  reason: string;
}

/** Structured read-only snapshot passed to any brain implementation at decision time. */
export interface BusinessContext {
  readonly id: BusinessId;
  readonly type: BusinessType;
  readonly cash: number;
  readonly totalProfit: number; // lifetime P&L
  readonly inventory: Readonly<Record<string, number>>;
  readonly employeeCount: number;
  readonly operatingCostPerDay: number;
  readonly baseProductionPerDay: number;
  readonly baseSellPrice: number;

  // Current brain-controlled strategy state (neutral = 1.0 / 0 when disabled)
  readonly priceMultiplier: number;
  readonly productionMultiplier: number;
  readonly staffingTarget: number;

  readonly outputResource: string;
  readonly simDay: number;

  // Cheap derived signals (brains love these)
  readonly cashRunwayDays: number; // rough estimate
  readonly inventoryOfOutput: number;
  readonly profitPerEmployee: number;
}

/** Immutable, timestamped record of what a brain decided + the exact world it saw. */
export interface DecisionLogEntry {
  /** Real-world wall-clock time (for cross-session correlation / debugging). */
  timestamp: number;
  /** Simulated day number (1-based from TimeSystem). */
  simDay: number;
  /** Optional precise tick for intra-day ordering. */
  simTick?: number;

  businessId: BusinessId;

  /** Frozen copy of key state at the exact moment the decision was requested. */
  contextSnapshot: {
    cash: number;
    totalProfit: number;
    employeeCount: number;
    inventory: Record<string, number>;
    baseSellPrice: number;
    priceMultiplier: number;
    productionMultiplier: number;
    staffingTarget: number;
  };

  decisions: BusinessDecision[];
  brainName: string;
}

/**
 * The core swappable abstraction for business "intelligence".
 * Any implementation (rule-based today, Grok/LLM tomorrow, scripted scenario brains, etc.)
 * must honor the narrow decision contract and be side-effect free.
 */
export interface IDecisionMaker {
  /** Stable identifier for logging + God Mode display (e.g. "RuleBasedBrain-v1" or "Grok-4-Business"). */
  readonly name: string;

  /**
   * Pure function: given current context, return the decisions this brain wants right now.
   * Return [] when it chooses to do nothing.
   *
   * CONTRACT (enforced by callers + tests):
   * - Only the three DecisionTypes above.
   * - Deltas must be finite and within generous but safe bounds (caller clamps anyway).
   * - No side effects whatsoever.
   * - Deterministic given identical context (critical for A/B and replay).
   */
  decide(context: BusinessContext): BusinessDecision[];
}

/* ========================================================================== */
/*                           RULE-BASED DEFAULT BRAIN                         */
/* ========================================================================== */

/**
 * Deterministic, explainable, conservative rule-based brain.
 * Serves as the safe default + the "control" in all A/B harnesses.
 *
 * Heuristics deliberately simple and observable:
 * - Pricing reacts to cash pressure + inventory backlog (move goods) or strong profits (premium test).
 * - Production intent backs off on gluts, ramps on stockouts when cash healthy.
 * - Hiring target is purely advisory (logged for future job-search biasing or inspector use).
 *
 * All decisions are small nudges — the simulation stays stable even if left on for 500+ days.
 */
export class RuleBasedBrain implements IDecisionMaker {
  public readonly name = 'RuleBasedBrain-v1';

  decide(ctx: BusinessContext): BusinessDecision[] {
    const decisions: BusinessDecision[] = [];

    const {
      cash,
      totalProfit,
      employeeCount,
      inventoryOfOutput,
      priceMultiplier,
      productionMultiplier,
      staffingTarget,
      simDay,
      profitPerEmployee,
    } = ctx;

    // --- PRICING DECISIONS (most direct P&L lever) ---
    const lowCash = cash < 1800;
    const highStock = inventoryOfOutput > 28;
    const strongProfits = totalProfit > 4200;

    if (lowCash && highStock && priceMultiplier > 0.55) {
      decisions.push({
        type: 'pricing',
        delta: -1.8,
        reason: 'Cash runway tightening + output inventory backlog: modest price discount to accelerate turnover and stabilize cash (sandboxed pricing nudge)',
      });
    } else if (strongProfits && inventoryOfOutput < 9 && priceMultiplier < 1.75) {
      decisions.push({
        type: 'pricing',
        delta: +1.4,
        reason: 'Healthy lifetime profits + low finished-goods stock: small premium test to capture margin without killing volume',
      });
    } else if (simDay % 6 === 2 && cash > 6500 && priceMultiplier < 1.45) {
      // Periodic "exploration" nudge — fully deterministic by day
      decisions.push({
        type: 'pricing',
        delta: +0.9,
        reason: 'Scheduled profitability probe (every ~6 days when cash healthy): evaluate price elasticity with tiny upward nudge',
      });
    }

    // --- PRODUCTION INTENT DECISIONS ---
    if (highStock && productionMultiplier > 0.45) {
      decisions.push({
        type: 'production',
        delta: -0.09,
        reason: 'Excess inventory accumulating: dial back production intent to reduce variable operating drag and prevent spoilage-like waste',
      });
    } else if (!lowCash && inventoryOfOutput < 6 && productionMultiplier < 1.65) {
      decisions.push({
        type: 'production',
        delta: +0.11,
        reason: 'Low buffer stock + adequate cash: raise production intent to capture demand before competitors or shortages appear',
      });
    }

    // --- HIRING TARGET DECISIONS (advisory / logged only for Phase 7 scaffolding) ---
    // These do not auto-mutate employee lists (sandbox). They set desired staffingTarget on the Business.
    // Future brains / job-search enhancements can read staffingTarget to bias hiring pressure.
    if (strongProfits && profitPerEmployee > 180 && employeeCount < 9 && staffingTarget < employeeCount + 3) {
      const delta = Math.min(2, 9 - employeeCount);
      if (delta !== 0) {
        decisions.push({
          type: 'hiring',
          delta,
          reason: 'Strong per-employee profitability + expansion runway: raise staffing target (advisory — actual hiring still via job search / God Mode)',
        });
      }
    } else if (lowCash && employeeCount > 4 && (staffingTarget === 0 || staffingTarget > employeeCount - 2)) {
      decisions.push({
        type: 'hiring',
        delta: -1,
        reason: 'Cash pressure detected: recommend trimming one headcount from target to protect runway (advisory only)',
      });
    }

    return decisions;
  }
}

/** Convenience factory so callers never new directly (easy to mock/swap later). */
export function createRuleBasedBrain(): IDecisionMaker {
  return new RuleBasedBrain();
}

/* ========================================================================== */
/*                           UTILITY HELPERS                                  */
/* ========================================================================== */

/** Build a safe BusinessContext from a live Business + current sim day. Pure & cheap. */
export function buildBusinessContext(
  business: {
    id: BusinessId;
    type: BusinessType;
    cash: number;
    calculateProfit(): number;
    getInventory(): number | Record<string, number>;
    getEmployeeCount(): number;
    operatingCostPerDay: number;
    baseProductionPerDay: number;
    baseSellPrice: number;
    priceMultiplier?: number;
    productionMultiplier?: number;
    staffingTarget?: number;
    getPrimaryOutput(): string;
  },
  simDay: number
): BusinessContext {
  const profit = business.calculateProfit();
  const inv = business.getInventory() as Record<string, number>;
  const emp = business.getEmployeeCount();
  const output = business.getPrimaryOutput();

  const priceM = business.priceMultiplier ?? 1.0;
  const prodM = business.productionMultiplier ?? 1.0;
  const staffT = business.staffingTarget ?? 0;

  const inventoryOfOutput = inv[output] ?? 0;
  const dailyBurnEst = Math.max(1, business.operatingCostPerDay + (emp * 70)); // rough wage proxy
  const cashRunway = Math.round((business.cash / dailyBurnEst) * 10) / 10;
  const profitPerEmp = emp > 0 ? Math.round((profit / emp) * 100) / 100 : 0;

  return {
    id: business.id,
    type: business.type,
    cash: Math.round(business.cash * 100) / 100,
    totalProfit: Math.round(profit * 100) / 100,
    inventory: { ...inv },
    employeeCount: emp,
    operatingCostPerDay: business.operatingCostPerDay,
    baseProductionPerDay: business.baseProductionPerDay,
    baseSellPrice: business.baseSellPrice,
    priceMultiplier: priceM,
    productionMultiplier: prodM,
    staffingTarget: staffT,
    outputResource: output,
    simDay,
    cashRunwayDays: cashRunway,
    inventoryOfOutput,
    profitPerEmployee: profitPerEmp,
  };
}

/** Clamp helper used by BusinessSystem when applying decisions (defense in depth). */
export function clampDecisionDelta(type: DecisionType, delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  switch (type) {
    case 'pricing':
      return Math.max(-25, Math.min(25, Math.round(delta * 100) / 100));
    case 'hiring':
      return Math.max(-8, Math.min(8, Math.floor(delta)));
    case 'production':
      return Math.max(-0.6, Math.min(0.6, Math.round(delta * 1000) / 1000));
    default:
      return 0;
  }
}
