import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EconomySystem } from './EconomySystem';
import { Business, type BusinessId } from '../entities/Business';
import { TimeSystem } from '../core/TimeSystem';
import { EventBus } from '../utils/EventBus';
import {
  createTestSimulation,
  runFastTicks,
  runSimulationForDays,
} from '../utils/simulationTestHelpers';

describe('EconomySystem', () => {
  let timeSystem: TimeSystem;
  let events: EventBus;
  let economy: EconomySystem;
  let mine: Business;
  let bakery: Business;

  const makeBusiness = (id: string, type: any, name?: string, cash = 10000): Business => {
    return new Business({
      id: id as BusinessId,
      name: name ?? `Test ${type}`,
      type,
      cash,
    });
  };

  beforeEach(() => {
    timeSystem = new TimeSystem(424242);
    events = new EventBus();
    economy = new EconomySystem(timeSystem, events);

    mine = makeBusiness('biz_mine_01', 'mine', 'Iron Peak', 8000);
    bakery = makeBusiness('biz_bakery_01', 'bakery', 'Golden Loaf', 6000);

    // Seed some inventory for trading tests
    mine.addToInventory('ore', 120);
    bakery.addToInventory('food', 80);
  });

  // === Construction & Basics ===

  it('constructs with sensible defaults and injected dependencies', () => {
    expect(economy.getBusinessCount()).toBe(0);
    expect(economy.getResourcePrice('ore')).toBe(48);
    expect(economy.getResourcePrice('nonexistent')).toBe(25);
    const stats = economy.getEconomyStats();
    expect(stats.registeredBusinessCount).toBe(0);
    expect(stats.cumulativeTradeVolume).toBe(0);
    expect(stats.cumulativeGDP).toBe(0);
  });

  it('allows price overrides for testing and future dynamic pricing', () => {
    economy.setResourcePrice('ore', 55);
    expect(economy.getResourcePrice('ore')).toBe(55);
    expect(economy.getAllPrices().ore).toBe(55);

    // unknown resource
    economy.setResourcePrice('widgets', 99);
    expect(economy.getResourcePrice('widgets')).toBe(99);
  });

  // === Registration & Aggregates ===

  it('registers businesses and computes live aggregates correctly', () => {
    economy.registerBusiness(mine);
    economy.registerBusiness(bakery);

    expect(economy.getBusinessCount()).toBe(2);

    const stats = economy.getEconomyStats();
    expect(stats.registeredBusinessCount).toBe(2);
    expect(stats.totalBusinessCash).toBeCloseTo(14000, 1);
    // ore 120 * 48 + food 80 * 21
    expect(stats.totalGoodsValue).toBeCloseTo(120 * 48 + 80 * 21, 1);
    expect(stats.resourceTotals.ore).toBe(120);
    expect(stats.resourceTotals.food).toBe(80);
  });

  it('aggregates correctly after inventory and cash mutations outside the system', () => {
    economy.registerBusiness(mine);
    mine.addToInventory('lumber', 40);
    mine.cash += 2500;

    const stats = economy.getEconomyStats();
    expect(stats.totalBusinessCash).toBeGreaterThanOrEqual(10500);
    expect(stats.resourceTotals.lumber).toBe(40);
    expect(stats.totalGoodsValue).toBeGreaterThan(120 * 48);
  });

  // === Market Trades (Central Pool) ===

  it('sellToMarket transfers goods and cash correctly with partial fill', () => {
    const result = economy.sellToMarket(mine, 'ore', 50);

    expect(result.success).toBe(true);
    expect(result.buyerId).toBe('market');
    expect(result.sellerId).toBe(mine.id);
    expect(result.quantity).toBe(50);
    expect(result.pricePerUnit).toBe(48);
    expect(result.totalValue).toBeCloseTo(50 * 48, 2);

    expect(mine.getInventory('ore')).toBe(70);
    expect(mine.cash).toBeCloseTo(8000 + 50 * 48, 2);
  });

  it('sellToMarket supports override price and emits trade event', () => {
    const handler = vi.fn();
    events.on('economy:trade', handler);

    const result = economy.sellToMarket(mine, 'ore', 10, 60);

    expect(result.totalValue).toBeCloseTo(600, 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].success).toBe(true);
  });

  it('buyFromMarket transfers goods and deducts cash (partial on insufficient funds)', () => {
    // Give bakery limited cash
    bakery.cash = 300; // can afford ~14 food at 21 each
    const result = economy.buyFromMarket(bakery, 'food', 50);

    expect(result.success).toBe(true);
    expect(result.quantity).toBeLessThan(50); // partial
    expect(result.quantity).toBeGreaterThan(0);
    expect(bakery.getInventory('food')).toBe(80 + result.quantity);
    expect(bakery.cash).toBeLessThanOrEqual(6);
    expect(bakery.cash).toBeGreaterThanOrEqual(0); // spent almost all (partial fill)
  });

  it('buyFromMarket fails gracefully with no cash', () => {
    bakery.cash = 5;
    const result = economy.buyFromMarket(bakery, 'food', 10);

    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/insufficient/i);
    expect(bakery.getInventory('food')).toBe(80);
  });

  it('market trades update cumulative volume and GDP', () => {
    economy.sellToMarket(mine, 'ore', 30);
    economy.buyFromMarket(bakery, 'food', 10);

    const stats = economy.getEconomyStats();
    const expected = 30 * 48 + 10 * 21;
    expect(stats.cumulativeTradeVolume).toBeCloseTo(expected, 1);
    expect(stats.cumulativeGDP).toBeCloseTo(expected, 1);
  });

  // === Peer-to-Peer Trades ===

  it('tradeBetween executes B2B transfer of goods and cash', () => {
    // Bakery needs ore, mine has it
    const result = economy.tradeBetween(bakery, mine, 'ore', 25);

    expect(result.success).toBe(true);
    expect(result.buyerId).toBe(bakery.id);
    expect(result.sellerId).toBe(mine.id);
    expect(result.quantity).toBe(25);

    expect(bakery.getInventory('ore')).toBe(25);
    expect(mine.getInventory('ore')).toBe(95);

    const oreCost = 25 * 48;
    expect(bakery.cash).toBeCloseTo(6000 - oreCost, 2);
    expect(mine.cash).toBeCloseTo(8000 + oreCost, 2);
  });

  it('tradeBetween supports price override and partials on both sides', () => {
    // Limit the BUYER (bakery) cash so it can't afford full request at override price
    bakery.cash = 65; // at $10/unit can afford only 6
    mine.cash = 10000;

    const result = economy.tradeBetween(bakery, mine, 'ore', 100, 10); // cheap override

    expect(result.success).toBe(true);
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.quantity).toBeLessThan(100); // buyer cash limited at the override price
    expect(result.totalValue).toBeCloseTo(result.quantity * 10, 1);
  });

  it('tradeBetween prevents self-trading and emits events', () => {
    const handler = vi.fn();
    events.on('economy:trade', handler);

    const bad = economy.tradeBetween(mine, mine, 'ore', 5);
    expect(bad.success).toBe(false);
    expect(bad.reason).toMatch(/self/i);

    expect(handler).not.toHaveBeenCalled();
  });

  // === Periodic Behavior & Market Steps ===

  it('update() detects day rollovers and emits daily-report events', () => {
    const reports: any[] = [];
    events.on('economy:daily-report', (p) => reports.push(p));

    // Advance almost one day (1439 ticks) then one more to cross boundary
    // 24 hours * 60 ticks = 1440 ticks per day
    runFastTicks({ forceAdvanceTicks: (n: number) => { for (let i=0;i<n;i++) { timeSystem.advanceTick(); economy.update(); } } } as any, 1440);

    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports[0]).toHaveProperty('day');
    expect(reports[0]).toHaveProperty('dailyTradeVolume');
  });

  it('processMarketStep auto-liquidates primary output from registered businesses and updates stats', () => {
    economy.registerBusiness(mine);
    const beforeOre = mine.getInventory('ore') as number;
    const beforeCash = mine.cash;

    const volume = economy.processMarketStep(0.25);

    expect(volume).toBeGreaterThan(0);
    const afterOre = mine.getInventory('ore') as number;
    expect(afterOre).toBeLessThan(beforeOre);

    // cash should have increased
    expect(mine.cash).toBeGreaterThan(beforeCash);

    // aggregates reflect the change
    const stats = economy.getEconomyStats();
    expect(stats.cumulativeTradeVolume).toBeGreaterThan(0);
  });

  it('can be registered on a real Simulation and receives ticks', () => {
    const sim = createTestSimulation(123);
    // Use a fresh economy bound to the simulation's clock for this test
    // (we access the private for test purposes only; real usage passes TimeSystem at construction)
    const simTime = (sim as any).timeSystem as TimeSystem;
    const simEcon = new EconomySystem(simTime, events);
    sim.registerSystem(simEcon);

    // Spawn some residents (not strictly needed) — now also creates demo businesses on sim.businesses
    sim.spawnInitialPopulation(5);

    // Wire the demo businesses (spawned by Simulation integration) into *this* test EconomySystem instance.
    // Validates that the new spawnDemoBusinessesAndLinkEmployees + Economy registration path works.
    const demoBiz = sim.businesses.getAllBusinesses();
    demoBiz.forEach(b => simEcon.registerBusiness(b));

    // Advance a few simulated hours — exercises the registered update() path + day boundary logic
    runFastTicks(sim, 60 * 6); // 6 hours

    // No crash + basic sanity (timeHours advanced inside the sim's TimeSystem)
    const snap = simEcon.getSnapshot();
    expect(snap.timeHours).toBeGreaterThan(5);
    expect(simEcon.getBusinessCount()).toBeGreaterThan(0); // demo businesses from spawn are now wired to this econ

    // Exercise market step (the real Simulation calls this automatically via thin day hook in checkForPayday;
    // here we drive it manually on the test econ to prove production + trading works over days without crashing)
    const beforeVol = simEcon.getSnapshot().cumulativeTradeVolume;
    simEcon.processMarketStep(0.10);
    const afterSnap = simEcon.getSnapshot();
    expect(afterSnap.registeredBusinessCount).toBeGreaterThan(0);
    // Trade volume may be 0 if no inventory yet on first partial day, but call succeeds and GDP field is present
    expect(afterSnap.cumulativeGDP).toBeGreaterThanOrEqual(beforeVol);
  });

  // === Snapshot & Serialization ===

  it('getSnapshot includes time context, daily volume, and full stats', () => {
    economy.registerBusiness(mine);
    economy.sellToMarket(mine, 'ore', 15);

    const snap = economy.getSnapshot();
    expect(snap).toHaveProperty('timeHours');
    expect(snap).toHaveProperty('lastProcessedDay');
    expect(snap).toHaveProperty('dailyTradeVolume');
    expect(snap.cumulativeTradeVolume).toBeGreaterThan(0);
    expect(snap.registeredBusinessCount).toBe(1);
  });

  it('toJSON / fromJSON roundtrips economy-owned state (prices + counters)', () => {
    economy.setResourcePrice('lumber', 42);
    economy.sellToMarket(mine, 'ore', 8);
    economy.registerBusiness(bakery); // ids captured

    const json = economy.toJSON();
    expect(json.prices.lumber).toBe(42);
    expect(json.cumulativeTradeVolume).toBeGreaterThan(0);
    expect(json.registeredBusinessIds).toContain(bakery.id);

    // Fresh time + events for reconstruction
    const newTime = new TimeSystem(999);
    const restored = EconomySystem.fromJSON(json, newTime, events);

    expect(restored.getResourcePrice('lumber')).toBe(42);
    const restoredStats = restored.getEconomyStats();
    expect(restoredStats.cumulativeTradeVolume).toBeCloseTo(json.cumulativeTradeVolume, 2);

    // Businesses are NOT auto-restored (by design)
    expect(restored.getBusinessCount()).toBe(0);
  });

  it('fromJSON is defensive against bad data', () => {
    const newTime = new TimeSystem(1);
    const restored = EconomySystem.fromJSON(null, newTime);
    expect(restored.getResourcePrice('ore')).toBe(48); // defaults intact

    const restored2 = EconomySystem.fromJSON({}, newTime);
    expect(restored2.getEconomyStats().cumulativeGDP).toBe(0);
  });

  // === Edge Cases & Robustness ===

  it('handles zero/negative/invalid trade attempts without corrupting state', () => {
    const beforeCash = mine.cash;
    const beforeInv = mine.getInventory('ore');

    economy.sellToMarket(mine, 'ore', 0);
    economy.sellToMarket(mine, '', 10);
    economy.buyFromMarket(bakery, 'food', -3);
    const badP2p = economy.tradeBetween(mine, bakery, 'ore', 0);

    expect(badP2p.success).toBe(false);
    expect(mine.cash).toBe(beforeCash);
    expect(mine.getInventory('ore')).toBe(beforeInv);
  });

  it('resetCounters and clear work as expected for test isolation', () => {
    economy.sellToMarket(mine, 'ore', 5);
    economy.registerBusiness(mine);

    economy.resetCounters();
    let stats = economy.getEconomyStats();
    expect(stats.cumulativeTradeVolume).toBe(0);
    expect(stats.cumulativeGDP).toBe(0);

    economy.clear();
    expect(economy.getBusinessCount()).toBe(0);
    stats = economy.getEconomyStats();
    expect(stats.registeredBusinessCount).toBe(0);
  });

  // === Integration with Long-Running Simulation (light) ===

  it('survives long simulated runs when registered and maintains non-negative invariants', () => {
    const sim = createTestSimulation(777);
    const econ = new EconomySystem(sim['timeSystem'] ?? (sim as any).timeSystem, events); // access via any for test helper
    // Better: use the exposed time? We can just use a fresh one synced via ticks
    sim.registerSystem(econ);

    // Create and register a couple businesses directly on economy
    const farm = makeBusiness('f1', 'farm');
    farm.addToInventory('crops', 200);
    econ.registerBusiness(farm);

    const factory = makeBusiness('fac1', 'factory');
    econ.registerBusiness(factory);

    runSimulationForDays(sim, 12);

    const finalStats = econ.getEconomyStats();
    expect(finalStats.totalBusinessCash).toBeGreaterThanOrEqual(0);
    expect(finalStats.totalGoodsValue).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(finalStats.cumulativeGDP)).toBe(true);

    // No crash and some economic activity likely occurred
    expect(finalStats.cumulativeTradeVolume).toBeGreaterThanOrEqual(0);
  });

  // === Wave 3 TE Targeted Additions: Post-Trade Inventory + Money Conservation Invariants ===
  it('never produces negative inventory after repeated sell/buy/tradeBetween operations (post-trade integrity)', () => {
    economy.registerBusiness(mine);
    economy.registerBusiness(bakery);

    // Perform a battery of trades (some will partial-fill)
    for (let i = 0; i < 25; i++) {
      economy.sellToMarket(mine, 'ore', 4 + (i % 3));
      economy.buyFromMarket(bakery, 'food', 2 + (i % 2));
      if (i % 3 === 0) {
        economy.tradeBetween(bakery, mine, 'ore', 1);
      }
    }

    // Core invariant: no negative quantities anywhere
    const stats = economy.getEconomyStats();
    expect(stats.resourceTotals.ore).toBeGreaterThanOrEqual(0);
    expect(stats.resourceTotals.food).toBeGreaterThanOrEqual(0);

    // Explicit per-business check (mirrors new helper logic)
    expect(mine.getInventory('ore')).toBeGreaterThanOrEqual(0);
    expect(bakery.getInventory('food')).toBeGreaterThanOrEqual(0);
    expect(bakery.getInventory('ore')).toBeGreaterThanOrEqual(0);
  });

  it('tradeBetween conserves total cash between two businesses (zero-sum transfer rule)', () => {
    economy.registerBusiness(mine);
    economy.registerBusiness(bakery);

    const beforeMine = mine.cash;
    const beforeBakery = bakery.cash;
    const beforeGrand = beforeMine + beforeBakery;

    const result = economy.tradeBetween(bakery, mine, 'ore', 12);

    expect(result.success).toBe(true);
    const afterGrand = mine.cash + bakery.cash;

    // Cash is strictly conserved between participants (price * qty moved from buyer to seller)
    expect(afterGrand).toBeCloseTo(beforeGrand, 2);
    expect(mine.cash).toBeGreaterThan(beforeMine);
    expect(bakery.cash).toBeLessThan(beforeBakery);
  });
});
