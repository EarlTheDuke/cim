/**
 * BusinessBrain.test.ts
 *
 * Unit tests for the pluggable business-brain layer:
 *   - clampDecisionDelta safety bounds (BusinessBrain.ts)
 *   - RuleBasedBrain contract (deterministic, valid decision types)
 *   - GrokBusinessBrain heuristic + provider delegation
 *   - LLM provider abstraction (MockDeterministicProvider, GrokXAIProvider, createProviderFromEnv)
 *
 * These exercise the real, shipping decision-maker code only (no external drama harness),
 * so they are deterministic and fast and do not hit the network.
 */

import { describe, it, expect } from 'vitest';
import {
  createRuleBasedBrain,
  clampDecisionDelta,
  type BusinessContext,
  type BusinessDecision,
  type DecisionType,
} from './BusinessBrain';
import { createGrokBusinessBrain, GrokBusinessBrain } from './GrokBusinessBrain';
import {
  type IBusinessBrainProvider,
  MockDeterministicProvider,
  GrokXAIProvider,
  createProviderFromEnv,
} from './LLMProvider';

/** Build a valid, fully-populated BusinessContext for deterministic brain testing. */
function makeCtx(overrides: Partial<BusinessContext> = {}): BusinessContext {
  return {
    id: 'biz_test_1',
    type: 'factory' as any,
    cash: 1500,
    totalProfit: -50,
    inventory: { widget: 30 },
    employeeCount: 4,
    operatingCostPerDay: 120,
    baseProductionPerDay: 10,
    baseSellPrice: 12,
    priceMultiplier: 1.0,
    productionMultiplier: 1.0,
    staffingTarget: 4,
    outputResource: 'widget',
    simDay: 5,
    cashRunwayDays: 4,
    inventoryOfOutput: 30,
    profitPerEmployee: -12,
    ...overrides,
  };
}

const VALID_TYPES: DecisionType[] = ['pricing', 'hiring', 'production'];

function assertValidDecisions(decisions: BusinessDecision[]): void {
  expect(Array.isArray(decisions)).toBe(true);
  for (const d of decisions) {
    expect(VALID_TYPES).toContain(d.type);
    expect(Number.isFinite(d.delta)).toBe(true);
    expect(typeof d.reason).toBe('string');
    expect(d.reason.length).toBeGreaterThan(0);
  }
}

describe('clampDecisionDelta', () => {
  it('enforces safe pricing/hiring/production bounds', () => {
    expect(clampDecisionDelta('pricing', 99)).toBe(25);
    expect(clampDecisionDelta('pricing', -99)).toBe(-25);
    expect(clampDecisionDelta('hiring', 42)).toBe(8);
    expect(clampDecisionDelta('hiring', -42)).toBe(-8);
    expect(clampDecisionDelta('production', 5)).toBe(0.6);
    expect(clampDecisionDelta('production', -5)).toBe(-0.6);
  });

  it('returns 0 for non-finite deltas', () => {
    expect(clampDecisionDelta('pricing', NaN)).toBe(0);
    expect(clampDecisionDelta('hiring', Infinity)).toBe(0);
  });
});

describe('RuleBasedBrain', () => {
  it('has a stable name and returns only valid, deterministic decisions', () => {
    const brain = createRuleBasedBrain();
    expect(brain.name).toBe('RuleBasedBrain-v1');

    const ctx = makeCtx({ cash: 1500, inventoryOfOutput: 30, priceMultiplier: 1.0 });
    const a = brain.decide(ctx);
    const b = brain.decide(ctx);
    assertValidDecisions(a);
    // Deterministic: identical context yields identical decisions.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('discounts price under low cash + inventory backlog', () => {
    const brain = createRuleBasedBrain();
    const decisions = brain.decide(makeCtx({ cash: 1500, inventoryOfOutput: 30, priceMultiplier: 1.0 }));
    const pricing = decisions.find((d) => d.type === 'pricing');
    expect(pricing).toBeTruthy();
    expect(pricing!.delta).toBeLessThan(0);
  });
});

describe('GrokBusinessBrain (heuristic, no provider)', () => {
  it('has a stable name and returns valid deterministic decisions', () => {
    const brain = createGrokBusinessBrain();
    expect(brain.name).toBe('GrokBusinessBrain-v1');
    const ctx = makeCtx({ cashRunwayDays: 2.0, inventoryOfOutput: 60 });
    const a = brain.decide(ctx);
    const b = brain.decide(ctx);
    assertValidDecisions(a);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reports its own name as lastProviderName when no provider is injected', () => {
    const brain = new GrokBusinessBrain();
    expect(brain.lastProviderName).toBe('GrokBusinessBrain-v1');
  });
});

describe('LLM Provider abstraction', () => {
  it('MockDeterministicProvider is interface-compliant and deterministic per seed', () => {
    const ctx = makeCtx({ cash: 1800, inventoryOfOutput: 31, totalProfit: -40 });

    const p1: IBusinessBrainProvider = new MockDeterministicProvider(0xabc123);
    const p2 = new MockDeterministicProvider(0xabc123);
    const d1 = p1.decide(ctx) as BusinessDecision[];
    const d2 = p2.decide(ctx) as BusinessDecision[];

    expect(p1.name).toBe('MockDeterministic-0x00abc123');
    assertValidDecisions(d1);
    expect(d1.length).toBeGreaterThanOrEqual(1);
    expect(d1[0].reason).toContain('Mock:');
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));

    // Different seed → different provenance in the name.
    const p3 = new MockDeterministicProvider(999);
    expect(p3.name).toBe('MockDeterministic-0x000003e7');
  });

  it('GrokXAIProvider validates the key, exposes a stable name, and decides asynchronously', async () => {
    // Constructor requires a plausible (>=10 char) key.
    expect(() => new GrokXAIProvider(null)).toThrow();
    expect(() => new GrokXAIProvider('short')).toThrow();

    const provider = new GrokXAIProvider('a-sufficiently-long-but-unused-test-key-123');
    expect(provider.name).toBe('Grok-xAI (key)');

    // decide() is async and gracefully falls back (no network in tests) to valid decisions.
    const result = provider.decide(makeCtx({ cashRunwayDays: 3, inventoryOfOutput: 40 }));
    expect(typeof (result as any).then).toBe('function');
    const decisions = await (result as Promise<BusinessDecision[]>);
    assertValidDecisions(decisions);
    expect(decisions[0].reason).toContain('Grok-xAI');
  });

  it('createProviderFromEnv returns null or a Grok provider depending on env', () => {
    const fromEnv = createProviderFromEnv();
    expect(fromEnv === null || fromEnv.name.includes('Grok')).toBe(true);
  });
});

describe('GrokBusinessBrain with injected provider', () => {
  it('delegates to a synchronous provider and preserves provenance', () => {
    const provider = new MockDeterministicProvider(12345);
    const brain = new GrokBusinessBrain(provider);

    expect(brain.name).toBe('GrokBusinessBrain-v1');
    expect(brain.lastProviderName).toBe('MockDeterministic-0x00003039');

    const decisions = brain.decide(makeCtx({ cash: 3100, inventoryOfOutput: 14, totalProfit: 85 }));
    assertValidDecisions(decisions);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].reason).toContain('Mock:');
  });

  it('falls back to the internal heuristic when the provider is async (real LLM path)', () => {
    // GrokXAIProvider.decide() returns a Promise; the synchronous IDecisionMaker contract
    // must still return valid decisions via the heuristic fallback (never awaiting the network).
    const provider = new GrokXAIProvider('a-sufficiently-long-but-unused-test-key-123');
    const brain = new GrokBusinessBrain(provider);
    expect(brain.lastProviderName).toBe('Grok-xAI (key)');
    const decisions = brain.decide(makeCtx({ cashRunwayDays: 2, inventoryOfOutput: 70 }));
    assertValidDecisions(decisions);
  });
});
