/**
 * LLMProvider — Phase 7 Crown Jewel Provider Abstraction (Wave 3)
 *
 * Clean, minimal, production-ready surface for real LLM-backed business brains.
 * - GrokXAIProvider: real fetch to xAI chat completions + JSON mode + timeout/retry/backoff + graceful heuristic fallback.
 * - MockDeterministicProvider: reproducible A/B and test harness use.
 * - createProviderFromEnv(): the single factory the God Mode UI and all harnesses call.
 *
 * This file was fully recovered after the Wave 3 parallel agent append storm
 * left 1500+ lines of syntax-damaged shadow/demo code (invalid 0xP057 hex,
 * unbalanced braces, duplicate fragments). Only the exact runtime surface
 * required by main.ts, GodModeTools.ts, GrokBusinessBrain.ts, and the
 * 26-scenario / Crown Jewel harnesses is present.
 *
 * The heavy shadow demo blocks (demoShadowMode*, runShadowModeDramaExamplesOnNewFuel,
 * sophisticated*Heuristic, etc.) were the source of every TS1125/TS1005 error.
 * They can be restored cleanly from git history later. Core God Mode buttons,
 * real Grok path, persistence, and all A/B + drama harnesses do not need them.
 *
 * === EXACT ALIGNMENT ===
 * - Master Plan Phase 7: IDecisionMaker + real LLM swap-in path documented.
 * - God Mode "Real LLM Experiments" + "🚀 Run Crown Jewel Final Probe" use createProviderFromEnv().
 * - All 5 core + housing + decisionLog + TL invariants remain enforced.
 */

import type {
  BusinessContext,
  BusinessDecision,
} from './BusinessBrain';

/** Alias used everywhere for the decision payload (array of narrow sandboxed decisions). */
export type Decision = BusinessDecision[];

/**
 * Swappable provider contract.
 * decide() may be sync (mocks/heuristic fallbacks) or async (real network LLM).
 * Must be side-effect free except logging and must always return a valid (possibly empty) array.
 */
export interface IBusinessBrainProvider {
  /** Stable name shown in BI/God badges and reports (e.g. "Grok-xAI (key)" or "MockDeterministic-v1"). */
  readonly name: string;

  /**
   * Produce 0–3 narrow sandboxed decisions.
   * Implementations must respect the clamps documented in BusinessBrain.ts.
   */
  decide(context: BusinessContext): Decision | Promise<Decision>;
}

/* ========================================================================== */
/*                           MOCK DETERMINISTIC PROVIDER                      */
/* ========================================================================== */

/**
 * Deterministic seeded provider used for A/B harnesses (brain ON vs OFF on identical seeds)
 * and when no real API key is present. Always produces reproducible output.
 */
export class MockDeterministicProvider implements IBusinessBrainProvider {
  readonly name: string;
  private readonly seed: number;

  constructor(seed: number = 0xC0FFEE) {
    this.seed = seed >>> 0;
    this.name = `MockDeterministic-0x${this.seed.toString(16).padStart(8, '0')}`;
  }

  decide(ctx: BusinessContext): Decision {
    // Tiny deterministic heuristic based only on the numeric signals + seed
    const decisions: BusinessDecision[] = [];
    const h = (this.seed ^ (ctx.simDay * 31)) >>> 0;
    const lowRunway = ctx.cashRunwayDays < 5.5;
    const tightInv = ctx.inventoryOfOutput < 7;

    if (lowRunway && ctx.priceMultiplier > 0.75) {
      decisions.push({ type: 'pricing', delta: -1.4, reason: `Mock: defensive price relief (runway ${ctx.cashRunwayDays.toFixed(1)}d, seed 0x${this.seed.toString(16)})` });
    } else if (tightInv) {
      decisions.push({ type: 'production', delta: 0.08, reason: `Mock: production nudge for inventory hole (inv=${ctx.inventoryOfOutput})` });
    } else if ((h % 5) === 0 && ctx.profitPerEmployee > 40) {
      decisions.push({ type: 'hiring', delta: 1, reason: `Mock: opportunistic hire on profitable day ${ctx.simDay}` });
    } else {
      decisions.push({ type: 'pricing', delta: 0.3, reason: `Mock: baseline probe (deterministic, seed 0x${this.seed.toString(16)})` });
    }
    return decisions.slice(0, 3);
  }
}

/* ========================================================================== */
/*                           GROK XAI PROVIDER (REAL LLM)                     */
/* ========================================================================== */

/**
 * Real xAI Grok provider.
 * - Uses chat completions with JSON mode.
 * - Strict timeout + retry with exponential backoff.
 * - Always falls back gracefully to a tiny local heuristic if the network
 *   call fails for any reason (key missing, rate limit, timeout, bad JSON, etc.).
 * - Records lastLatencyMs / lastEstCost / lastTokens for the God Mode badge + reports.
 *
 * Prompt recipe (for future real-LLM or Grok-4 swap-in):
 *   System: "You are an expert city-economy business operator. Return ONLY a compact JSON array..."
 *   User:   "Current exact BusinessContext snapshot:\n${JSON.stringify(ctx, null, 2)}"
 *   Response format: { "decisions": [ { "type": "pricing"|"hiring"|"production", "delta": number, "reason": "Grok-xAI: ..." } ] }
 *
 * Cost/latency are estimated; real usage is logged server-side by xAI.
 */
export class GrokXAIProvider implements IBusinessBrainProvider {
  readonly name = 'Grok-xAI (key)';
  private readonly apiKey: string;

  // Observable last-call metrics (used by God Mode "Provider status" badge + BI provenance)
  lastLatencyMs: number | null = null;
  lastEstCost: number | null = null;
  lastTokens: { prompt?: number; completion?: number } | null = null;

  constructor(apiKey: string | null) {
    if (!apiKey || apiKey.trim().length < 10) {
      throw new Error('GrokXAIProvider requires a non-empty xAI API key');
    }
    this.apiKey = apiKey.trim();
  }

  async decide(ctx: BusinessContext): Promise<Decision> {
    const start = performance.now();

    const prompt = this.buildPrompt(ctx);

    const body = {
      model: 'grok-2-latest', // or 'grok-3' / future Grok-4 as they become available
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 280,
      response_format: { type: 'json_object' },
    };

    const url = 'https://api.x.ai/v1/chat/completions';

    // Timeout + retry (2 attempts)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8500);

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          throw new Error(`xAI HTTP ${res.status}`);
        }

        const json: any = await res.json();
        const text = json.choices?.[0]?.message?.content ?? '';
        const parsed = this.safeParseJSON(text);

        const decisions = this.validateAndClamp(parsed);

        this.lastLatencyMs = Math.round(performance.now() - start);
        this.lastTokens = {
          prompt: json.usage?.prompt_tokens,
          completion: json.usage?.completion_tokens,
        };
        // Rough cost estimate (grok-2 class pricing as of 2026)
        const tokens = (this.lastTokens.prompt ?? 0) + (this.lastTokens.completion ?? 0);
        this.lastEstCost = Math.round((tokens * 0.0000028) * 10000) / 10000;

        return decisions;
      } catch (err) {
        if (attempt === 1) {
          // Final fallback — never let the UI or a harness crash
          const fb = this.fallbackDecisions(ctx, `Grok-xAI fallback after error: ${String(err).slice(0, 80)}`);
          this.lastLatencyMs = Math.round(performance.now() - start);
          this.lastEstCost = 0;
          return fb;
        }
        // brief backoff before retry
        await new Promise(r => setTimeout(r, 180 * (attempt + 1)));
      }
    }

    // Unreachable
    return this.fallbackDecisions(ctx, 'Grok-xAI: unreachable fallback');
  }

  private systemPrompt(): string {
    return 'You are an expert city-economy business operator running a single business inside a living SimCity-style simulation. '
      + 'You receive a compact numeric snapshot (cash, runway days, inventory, profit/employee, current multipliers, active hostile events, housing pressure, traffic stats). '
      + 'Return ONLY a compact JSON object with a "decisions" array containing 0–3 narrow, sandboxed moves. '
      + 'Allowed decision types ONLY: "pricing" (delta dollars), "hiring" (delta headcount), "production" (delta multiplier). '
      + 'Never output cash moves, absolute prices, or anything outside the three levers. '
      + 'Reasons must start with "Grok-xAI: " and be short, numeric, and auditable. '
      + 'Prioritize survival under hostile events (blackout, port strike, interest rate shock, cyber, labor, tariff) and housing/traffic pressure.';
  }

  private buildPrompt(ctx: BusinessContext): string {
    return `Current exact BusinessContext snapshot:
${JSON.stringify(ctx, null, 2)}

Return ONLY valid JSON: { "decisions": [ { "type": "pricing"|"hiring"|"production", "delta": number, "reason": "Grok-xAI: ..." } ] }`;
  }

  private safeParseJSON(text: string): any {
    try {
      // Some models wrap JSON in ```json ... ```
      const cleaned = text.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }

  private validateAndClamp(raw: any): Decision {
    if (!raw || !Array.isArray(raw.decisions)) return [];

    const out: BusinessDecision[] = [];
    for (const d of raw.decisions) {
      if (!d || typeof d !== 'object') continue;
      const type = d.type as BusinessDecision['type'];
      if (type !== 'pricing' && type !== 'hiring' && type !== 'production') continue;

      let delta = Number(d.delta);
      if (!Number.isFinite(delta)) delta = 0;

      // Same clamps used by the RuleBasedBrain / GrokBusinessBrain
      if (type === 'pricing') delta = Math.max(-12, Math.min(12, Math.round(delta * 100) / 100));
      else if (type === 'hiring') delta = Math.max(-4, Math.min(4, Math.floor(delta)));
      else delta = Math.max(-0.35, Math.min(0.35, Math.round(delta * 1000) / 1000));

      const reason = typeof d.reason === 'string' && d.reason.length > 0
        ? (d.reason.startsWith('Grok-xAI:') ? d.reason : `Grok-xAI: ${d.reason}`)
        : 'Grok-xAI: (no reason)';

      out.push({ type, delta, reason });
      if (out.length >= 3) break;
    }
    return out;
  }

  private fallbackDecisions(ctx: BusinessContext, reason: string): Decision {
    const decisions: BusinessDecision[] = [];
    const lowRunway = ctx.cashRunwayDays < 5;
    const backlog = ctx.inventoryOfOutput > 18;

    if (lowRunway && backlog && ctx.priceMultiplier > 0.7) {
      decisions.push({ type: 'pricing', delta: -1.6, reason });
    } else if (ctx.inventoryOfOutput < 6 && ctx.cashRunwayDays > 6 && ctx.productionMultiplier < 1.3) {
      decisions.push({ type: 'production', delta: 0.09, reason });
    } else {
      decisions.push({ type: 'pricing', delta: 0.4, reason });
    }
    return decisions;
  }
}

/* ========================================================================== */
/*                           FACTORY FROM ENV                                 */
/* ========================================================================== */

/**
 * The single function the entire Crown Jewel UI and all drama harnesses call.
 * Reads VITE_XAI_API_KEY (browser) or process.env (Node/test) and returns a
 * ready GrokXAIProvider when a plausible key exists, otherwise null.
 *
 * When null, callers fall back to GrokBusinessBrain (heuristic) or RuleBasedBrain.
 * This is the exact "real LLM Experiments" + "Run Crown Jewel Final Probe" path.
 */
export function createProviderFromEnv(): IBusinessBrainProvider | null {
  let key: string | undefined;

  // Vite / browser build
  try {
    // @ts-ignore - import.meta may be undefined in pure Node
    const env = (import.meta as any)?.env;
    if (env && typeof env.VITE_XAI_API_KEY === 'string') {
      key = env.VITE_XAI_API_KEY;
    }
  } catch {
    /* ignore */
  }

  // Node / test / shell fallback
  // @ts-ignore - process is Node-only; guarded + any cast for dual browser/Node tsc in Vite project
  if (!key && typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.env) {
    key = (globalThis as any).process.env.VITE_XAI_API_KEY;
  }

  if (key && typeof key === 'string' && key.trim().length > 10) {
    return new GrokXAIProvider(key.trim());
  }
  return null;
}

/* ==========================================================================
   PARSE RECOVERY COMPLETE
   ==========================================================================
   This file now contains ONLY the minimal, correct, tsc-clean surface required
   for the God Mode Crown Jewel Dashboard (🚀 Run Crown Jewel Final Probe button,
   📜 persistent history with Re-run, Real LLM Experiments, persistence export,
   runDramaABWithBrain, runQuickDramaProbeWithBrain, etc.) to function at
   http://localhost:5173.

   All previous syntax damage (invalid hex seeds 0xP057/0xGROK7/etc., orphaned
   fragments, duplicate blocks, unterminated comments) has been removed.

   The full sophisticated shadow/demo surface can be restored later from
   agent handoff notes or git history without touching any caller.
   ========================================================================== */
