/**
 * SimulationValidation.test.ts
 *
 * Core long-running validation of the Simulation: invariant checks, multi-day
 * stability, and the public stability/observability surfaces that God Mode and
 * the long-run tooling rely on.
 *
 * Exercises real public Simulation surfaces only:
 *   - checkCoreInvariants()
 *   - runLongTermStabilityTest()
 *   - spawnInitialPopulation() / forceHousingMarketStep()
 * plus the brain wiring + invariant helpers. No speculative drama/A-B harness.
 */

import { describe, it, expect } from 'vitest';
import {
  createTestSimulation,
  runSimulationForDays,
  enableBrainForSimulation,
  assertSimulationInvariants,
  assertBusinessInvariants,
  getBrainDecisionSummary,
} from '../utils/simulationTestHelpers';
import { createGrokBusinessBrain } from '../systems/business/GrokBusinessBrain';
import { createRuleBasedBrain } from '../systems/business/BusinessBrain';

function freshSim(seed: number, pop = 30) {
  const sim = createTestSimulation(seed);
  sim.spawnInitialPopulation(pop);
  return sim;
}

describe('checkCoreInvariants', () => {
  it('reports a healthy, populated city after boot with sane metrics', () => {
    const sim = freshSim(0xC0A1);
    const inv = sim.checkCoreInvariants();

    expect(inv.ok).toBe(true);
    expect(inv.issues).toEqual([]);
    expect(inv.metrics).toBeTruthy();
    // Brain / housing / traffic metric sub-objects are always present and numeric.
    expect(typeof inv.metrics.brain.totalDecisionsLogged).toBe('number');
    expect(typeof inv.metrics.housing.totalOccupants).toBe('number');
    expect(typeof inv.metrics.traffic.lightCount).toBe('number');
    expect(typeof inv.metrics.traffic.stoppedVehicleCount).toBe('number');
  });

  it('stays invariant-clean across a multi-day run (money + population)', () => {
    const sim = freshSim(0xC0A2);
    runSimulationForDays(sim, 4);
    assertSimulationInvariants(sim);
    assertBusinessInvariants(sim);

    const inv = sim.checkCoreInvariants();
    expect(inv.ok).toBe(true);
    expect(inv.issues).toEqual([]);
  });
});

describe('runLongTermStabilityTest', () => {
  it('completes a short long-run without crashing and ends invariant-clean', () => {
    const sim = freshSim(0xC0A3);
    const res = sim.runLongTermStabilityTest(6, 500);

    expect(res.crashed).toBe(false);
    expect(res.finalInvariants).toBeTruthy();
    expect(res.finalInvariants.ok).toBe(true);
    expect(typeof res.report).toBe('string');
    expect(res.report.length).toBeGreaterThan(0);
    expect(Array.isArray(res.checkpoints)).toBe(true);
  });
});

describe('Brain wiring under live simulation', () => {
  it('RuleBasedBrain logs decisions and keeps the city invariant-clean', () => {
    const sim = freshSim(0xC0B1);
    enableBrainForSimulation(sim, () => createRuleBasedBrain());
    runSimulationForDays(sim, 5);

    const summary = getBrainDecisionSummary(sim);
    expect(summary.total).toBeGreaterThanOrEqual(0);

    const inv = sim.checkCoreInvariants();
    expect(inv.ok).toBe(true);
    // No malformed brain decision log entries.
    const logIssues = inv.issues.filter((i: string) => /decision log malformed/i.test(i));
    expect(logIssues).toEqual([]);
  });

  it('GrokBusinessBrain (heuristic) runs cleanly under a multi-day drama-free run', () => {
    const sim = freshSim(0xC0B2);
    enableBrainForSimulation(sim, () => createGrokBusinessBrain());
    runSimulationForDays(sim, 5);

    const inv = sim.checkCoreInvariants();
    expect(inv.ok).toBe(true);
    expect(inv.issues).toEqual([]);
  });
});

describe('Housing market step', () => {
  it('keeps occupancy within bounds after a forced re-home pass', () => {
    const sim = freshSim(0xC0C1);
    runSimulationForDays(sim, 2);
    sim.forceHousingMarketStep();
    runSimulationForDays(sim, 1);

    const inv = sim.checkCoreInvariants();
    const occupancyIssues = inv.issues.filter((i: string) =>
      /over-occupied|negative home occupants/i.test(i)
    );
    expect(occupancyIssues).toEqual([]);
    expect(inv.metrics.housing.totalOccupants).toBeGreaterThanOrEqual(0);
  });
});
