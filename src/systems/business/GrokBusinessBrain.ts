/**
 * GrokBusinessBrain — First Real Drop-in IDecisionMaker (Phase 7 Crown Jewel)
 *
 * The initial production-grade, LLM-ready implementation of the swappable business intelligence layer.
 * Implements the exact IDecisionMaker contract defined in BusinessBrain.ts.
 *
 * This is the direct successor to the RuleBasedBrain scaffolding:
 * - Still 100% deterministic (no Math.random, pure function of BusinessContext)
 * - Still narrow + sandboxed (only pricing/hiring/production deltas)
 * - Richer, more "agentic" multi-factor heuristics designed to feel like a thoughtful
 *   operator reacting to P&L, efficiency, inventory dynamics, and city "season" (simDay)
 * - Explicitly prepared for future real Grok/xAI LLM swap-in (see comments below)
 * - Excellent explainability: every decision carries a detailed, auditable reason string
 *   containing numeric context values at decision time
 *
 * === ALIGNMENT WITH MATURE HARNESS (Wave 3 Phase 7) ===
 * The surrounding test harness (simulationTestHelpers + BusinessBrain.test) now exposes:
 *   - buildBusinessContext (core)
 *   - augmentBizContextWithHousingDrama / augmentBizContextWithTrafficDrama
 *   - computeHousingDramaReactivity / computeTrafficDramaReactivity
 *   - snapshot*DramaState + full-city drama runners (housing pressure + traffic stress + events)
 *   - analyzeRealBrainDecisions + runLLMEvaluationBundle + rich scorecard
 *
 * While the decide() signature receives only the canonical BusinessContext (for production safety
 * and determinism), the 4 focused tests added alongside this file exercise the brain under
 * explicit housing-crisis + traffic + event seeds. In those tests we pair live ctx snapshots
 * with the augment overlays to demonstrate exactly what a future extended context (or
 * LLM prompt builder) would feed a real Grok brain.
 *
 * All decisions + logs produced here flow through the identical BusinessSystem apply path,
 * DecisionLogEntry records, God Mode inspector, charts, and the full invariant battery
 * (5 TE + housing + TL traffic + decisionLogIntegrity).
 *
 * === HOW TO EVOLVE INTO A TRUE GROK LLM BRAIN (future agent / Phase 7+ work) ===
 * 1. Keep this file as the "GrokBusinessBrain" name (or rename to xAIBusinessBrain).
 * 2. Add constructor options: { apiKey?: string; shadowMode?: boolean; model?: string }
 * 3. In decide():
 *      - Serialize a compact prompt from ctx + (optionally) recent log history
 *      - Call xAI Grok chat/completions with JSON mode + strict schema for Decision[]
 *      - Validate + clamp client-side (never trust the model 100%)
 *      - If shadowMode, log the would-be decision but return []
 * 4. Record extra fields in an extended log (tokens, cost, rawPrompt, rawResponse, model)
 * 5. Wire via the existing enable path + any future setBrainFactory on BusinessSystem
 *    (orchestrator will expose the tiny hook).
 * 6. Re-run the exact same 4+ drama tests + runLLMEvaluationBundle — the harness is
 *    already LLM-pluggable.
 *
 * === REAL LLM PATH (Wave 3 Crown Jewel — LLM Provider Abstraction complete) ===
 * The clean drop-in path is now implemented in sibling `LLMProvider.ts`:
 *   - IBusinessBrainProvider (sync or Promise-returning decide)
 *   - MockDeterministicProvider (seedable, for reproducible A/B divergence in tests/harness)
 *   - GrokXAIProvider (real fetch to xAI chat/completions + JSON mode + timeout/retry + rich
 *     "Grok-xAI: ..." reasons + graceful heuristic fallback on any error/missing key)
 *   - createProviderFromEnv() helper (reads VITE_XAI_API_KEY)
 *   - Full copy-paste recipe in the LLMProvider.ts header (exact prompt template, JSON schema
 *     for {type, delta, reason} array, shadow-mode pattern, env setup, how to feed into
 *     createGrokBusinessBrain({provider}), and exactly how the 26-scenario v6 Housing Drama
 *     Summary + runDramaABWithBrain + invariants judge the real LLM).
 *
 * Usage (already works with all existing surfaces — no other files touched):
 *   import { createGrokBusinessBrain } from './GrokBusinessBrain';
 *   import { createProviderFromEnv, MockDeterministicProvider } from './LLMProvider';
 *   const provider = createProviderFromEnv() ?? new MockDeterministicProvider(0xC0FFEE);
 *   const brain = createGrokBusinessBrain({ provider });
 *   // Pass factory to runDramaABWithBrain / runQuickDramaProbeWithBrain / runBundleStressReport etc.
 *   // Or wire directly in God Mode / inspector via lastProviderName for badges.
 *
 * When a provider is supplied:
 *   - Sync providers (Mock) fully delegate — decisions + reasons come from the provider.
 *   - Async providers (GrokXAIProvider with real key) are accepted; the sync decide() path
 *     (required by IDecisionMaker contract for all current callers/harnesses) safely uses the
 *     internal heuristic while lastProviderName exposes the real provider for UI provenance.
 *   - True async LLM decisions are available via provider.decide(ctx) / decideWithGrok(ctx)
 *     for future async evaluation paths or direct shadow-mode use. Clamping + logging still
 *     happen exactly as before on the apply side.
 *
 * All pre-existing behavior (no provider) is byte-for-byte identical. New tests at the end of
 * BusinessBrain.test.ts exercise the full surface + roundtrips + invariants.
 *
 * Zero behavior change to the simulation when this brain is not attached.
 * Toggleable exactly like RuleBasedBrain via BusinessSystem.enableBrainLogging(true).
 *
 * References:
 * - AGENTS.md (Wave 3 Phase 7 crown jewel task for this exact agent)
 * - src/systems/business/BusinessBrain.ts (IDecisionMaker, BusinessContext, RuleBasedBrain, clamps)
 * - src/systems/BusinessSystem.ts (the live call site: build → decide → clamp → record)
 * - src/entities/Business.ts (setBrain / multipliers / recordBrainDecision / decisionLog)
 * - src/systems/business/LLMProvider.ts (the provider abstraction + recipe + real xAI impl)
 * - The full drama harness surfaces (housing/traffic/event augments + reactivity scorers + 26-scen v6)
 */

import type {
  IDecisionMaker,
  BusinessContext,
  BusinessDecision,
} from './BusinessBrain';

import type { IBusinessBrainProvider } from './LLMProvider';

/**
 * First real drop-in Grok-style BusinessBrain.
 * More sophisticated heuristics than the baseline RuleBasedBrain while remaining
 * fully deterministic, explainable, and safely sandboxed.
 *
 * Now supports optional IBusinessBrainProvider injection (see LLMProvider.ts) for the real LLM path
 * while preserving the exact original heuristic behavior when no provider is supplied.
 */
export class GrokBusinessBrain implements IDecisionMaker {
  public readonly name = 'GrokBusinessBrain-v1';
  private readonly provider?: IBusinessBrainProvider;

  constructor(provider?: IBusinessBrainProvider) {
    this.provider = provider;
  }

  /**
   * Public getter for UI badges / God Mode / inspector provenance.
   * Returns the injected provider name when present (e.g. "GrokXAIProvider-v1" or "MockDeterministicProvider(seed=..."),
   * otherwise falls back to this brain's own name. Enables live display of which intelligence is active.
   */
  public get lastProviderName(): string {
    return this.provider?.name ?? this.name;
  }

  /**
   * Entry point per IDecisionMaker contract (always synchronous).
   * When a provider is present:
   *   - If the provider returns synchronously (MockDeterministicProvider etc.): fully delegate.
   *   - If the provider returns a Promise (real GrokXAIProvider with key): fall back to the internal
   *     heuristic for contract compatibility with existing sync callers/harnesses. The provider
   *     name is still exposed via lastProviderName. True async LLM usage happens via direct
   *     provider.decide() / decideWithGrok() calls in evaluation or future async paths.
   * When no provider: identical behavior to all prior versions (original heuristic).
   */
  decide(ctx: BusinessContext): BusinessDecision[] {
    if (this.provider) {
      const result = this.provider.decide(ctx);
      if (result && typeof (result as any).then === 'function') {
        // Async provider (real LLM) — cannot block here without changing the IDecisionMaker contract
        // and all downstream callers. Safe fallback preserves 100% backward compatibility for every
        // existing 26-scenario run, stress guard, A/B, quick probe, and God Mode path.
        return this.heuristicDecide(ctx);
      }
      return result as BusinessDecision[];
    }
    return this.heuristicDecide(ctx);
  }

  /**
   * Original GrokBusinessBrain heuristic (renamed for clarity when providers are present).
   * Pure, deterministic decision function.
   * Considers a rich set of signals from the provided context:
   *   - Cash runway & absolute cash (housing rent pressure + event cash shocks manifest here)
   *   - Inventory relative to production scale (supply shocks / festival demand swings)
   *   - Profit per employee + lifetime P&L (traffic friction + morale effects surface in ops)
   *   - Current strategy multipliers (avoid over-correction)
   *   - simDay (captures "seasonal" / event-cascade timing patterns in drama scenarios)
   *
   * Returns 0–3 narrow decisions per call. Reasons are verbose and numeric for auditability.
   * (Behavior unchanged from all previous versions when no provider is injected.)
   */
  private heuristicDecide(ctx: BusinessContext): BusinessDecision[] {
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
      cashRunwayDays,
      profitPerEmployee,
      baseProductionPerDay,
    } = ctx;

    // --- Derived signals (all deterministic) ---
    // (scale computation elided as unused in current heuristic; capacity uses employeeCount directly)
    const productionCapacityEst = Math.max(1, Math.round(baseProductionPerDay * productionMultiplier * (employeeCount * 0.6 + 1)));
    const overstocked = inventoryOfOutput > productionCapacityEst * 1.8;
    const tightStock = inventoryOfOutput < Math.max(3, Math.round(productionCapacityEst * 0.35));
    const criticalRunway = cashRunwayDays < 3.0;
    const tightRunway = cashRunwayDays < 6.0 && cashRunwayDays >= 3.0;
    const healthyRunway = cashRunwayDays > 14;
    const strongEfficiency = profitPerEmployee > 135;
    const weakEfficiency = profitPerEmployee < -35;
    const longTermHealthy = totalProfit > 6500;
    const underPressure = cash < 2200 || totalProfit < -800;

    // ============================================
    // PRICING DECISIONS (most immediate P&L impact)
    // ============================================
    if (criticalRunway && overstocked && priceMultiplier > 0.65) {
      decisions.push({
        type: 'pricing',
        delta: -3.2,
        reason: `Grok: CRITICAL runway ${cashRunwayDays.toFixed(1)}d + heavy backlog (${inventoryOfOutput} units vs ~${productionCapacityEst} capacity) — deep tactical discount to liquidate inventory fast and defend cash position under city pressure (day ${simDay}).`,
      });
    } else if (tightRunway && inventoryOfOutput > 18 && priceMultiplier > 0.72) {
      decisions.push({
        type: 'pricing',
        delta: -1.9,
        reason: `Grok: Tight runway (${cashRunwayDays.toFixed(1)}d) + excess finished goods — measured price relief to accelerate turnover, generate operating cash, and reduce rent/housing pressure drag on residents (and thus demand).`,
      });
    } else if (healthyRunway && tightStock && priceMultiplier < 1.55 && (longTermHealthy || strongEfficiency)) {
      decisions.push({
        type: 'pricing',
        delta: +2.3,
        reason: `Grok: Excellent runway + low buffer + proven per-employee profitability (${profitPerEmployee}) — opportunistic premium test to expand margins while city conditions (events/traffic) support volume.`,
      });
    } else if (simDay % 8 === 4 && cash > 9500 && priceMultiplier < 1.35 && !underPressure) {
      // Deterministic "exploration cycle" aligned to common drama schedule lengths
      decisions.push({
        type: 'pricing',
        delta: +0.85,
        reason: `Grok: Rhythmic market-sensing probe (day ${simDay} mod 8) with strong reserves — tiny upward elasticity test before next potential event/housing shock wave.`,
      });
    }

    // ============================================
    // PRODUCTION INTENT DECISIONS
    // ============================================
    if (overstocked && productionMultiplier > 0.48) {
      const backoff = Math.max(-0.22, Math.min(-0.06, -0.09 * (inventoryOfOutput / (productionCapacityEst + 4))));
      decisions.push({
        type: 'production',
        delta: backoff,
        reason: `Grok: Inventory glut (${inventoryOfOutput} vs capacity ~${productionCapacityEst}) detected under ${cashRunwayDays.toFixed(1)}d runway — dialing back production intent to protect variable costs and prevent further cash bleed during housing/traffic stress periods.`,
      });
    } else if (!tightRunway && tightStock && productionMultiplier < 1.55) {
      decisions.push({
        type: 'production',
        delta: +0.14,
        reason: `Grok: Stockout risk + viable runway — increasing production intent to rebuild buffers ahead of anticipated demand swings (festival, post-recession recovery, or resident re-homing effects).`,
      });
    } else if (strongEfficiency && simDay % 6 === 1 && productionMultiplier < 1.28 && cashRunwayDays > 9) {
      decisions.push({
        type: 'production',
        delta: +0.07,
        reason: `Grok: High efficiency (${profitPerEmployee}) + stable runway on day ${simDay} — modest scheduled capacity nudge to capitalize on current operating strength before next drama cycle.`,
      });
    }

    // ============================================
    // HIRING TARGET DECISIONS (advisory / future job-search bias)
    // ============================================
    if (strongEfficiency && profitPerEmployee > 155 && employeeCount < 11 && (staffingTarget === 0 || staffingTarget < employeeCount + 3)) {
      const hireDelta = Math.min(3, Math.max(1, Math.floor((profitPerEmployee - 80) / 35)));
      decisions.push({
        type: 'hiring',
        delta: hireDelta,
        reason: `Grok: Outstanding per-employee profitability (${profitPerEmployee}) + proven model under current city load — raising staffing target (advisory) to scale operations while housing/traffic conditions allow recruitment.`,
      });
    } else if (criticalRunway && employeeCount >= 5 && (staffingTarget === 0 || staffingTarget > employeeCount - 2)) {
      decisions.push({
        type: 'hiring',
        delta: -1,
        reason: `Grok: Critical cash runway (${cashRunwayDays.toFixed(1)}d) with meaningful headcount — recommending defensive reduction in staffing target to safeguard the business through rent pressure + event-induced demand volatility (advisory only).`,
      });
    } else if (weakEfficiency && underPressure && employeeCount > 4 && simDay > 9) {
      decisions.push({
        type: 'hiring',
        delta: -2,
        reason: `Grok: Sustained weak efficiency (${profitPerEmployee}) + overall pressure on day ${simDay} — conservative contraction signal to staffing target to reduce burn while the city (housing market + traffic + events) stabilizes.`,
      });
    }

    return decisions;
  }
}

/** Convenience factory (matches the RuleBased pattern for easy swapping in harnesses / God Mode). */
export function createGrokBusinessBrain(opts?: { provider?: IBusinessBrainProvider }): IDecisionMaker {
  return new GrokBusinessBrain(opts?.provider);
}
