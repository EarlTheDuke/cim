import { describe, it, expect, beforeEach } from 'vitest';
import { Business, type BusinessId } from './Business';
import type { ResidentId } from './Resident';

describe('Business', () => {
  let business: Business;
  const sampleResidentId: ResidentId = 'res_001' as ResidentId;

  beforeEach(() => {
    business = new Business({
      id: 'biz_mine_01' as BusinessId,
      name: 'Iron Peak Mine',
      type: 'mine',
    });
  });

  // === Construction & Defaults ===

  it('constructs with stable identity and sensible defaults', () => {
    expect(business.id).toBe('biz_mine_01');
    expect(business.name).toBe('Iron Peak Mine');
    expect(business.type).toBe('mine');
    expect(business.cash).toBeGreaterThan(1000);
    expect(business.totalRevenue).toBe(0);
    expect(business.totalExpenses).toBe(0);
    expect(business.employeeIds).toEqual([]);
    expect(business.getEmployeeCount()).toBe(0);
  });

  it('applies type-specific economic defaults', () => {
    const mine = new Business({ id: 'm1' as BusinessId, name: 'M', type: 'mine' });
    const farm = new Business({ id: 'f1' as BusinessId, name: 'F', type: 'farm' });
    const rig = new Business({ id: 'o1' as BusinessId, name: 'O', type: 'oil_rig' });

    expect(mine.operatingCostPerDay).toBeGreaterThan(100);
    expect(farm.operatingCostPerDay).toBeLessThan(mine.operatingCostPerDay);
    expect(rig.baseSellPrice).toBeGreaterThan(80);
    expect(mine.getPrimaryOutput()).toBe('ore');
    expect(farm.getPrimaryOutput()).toBe('crops');
  });

  it('accepts custom initial inventory and parameters', () => {
    const custom = new Business({
      id: 'custom1' as BusinessId,
      name: 'Custom Mill',
      type: 'lumberyard',
      cash: 12000,
      operatingCostPerDay: 200,
      initialInventory: { lumber: 45, ore: 5 },
    });

    expect(custom.cash).toBe(12000);
    expect(custom.operatingCostPerDay).toBe(200);
    expect(custom.getInventory('lumber')).toBe(45);
    expect(custom.getInventory('ore')).toBe(5);
  });

  // === Employee Management ===

  it('hires and fires employees without duplicates', () => {
    const r1 = 'res_001' as ResidentId;
    const r2 = 'res_002' as ResidentId;

    expect(business.hireEmployee(r1)).toBe(true);
    expect(business.hireEmployee(r1)).toBe(false); // duplicate
    expect(business.getEmployeeCount()).toBe(1);

    expect(business.hireEmployee(r2)).toBe(true);
    expect(business.employeeIds).toContain(r1);
    expect(business.employeeIds).toContain(r2);

    expect(business.fireEmployee(r1)).toBe(true);
    expect(business.getEmployeeCount()).toBe(1);
    expect(business.employeeIds).not.toContain(r1);

    expect(business.fireEmployee('nonexistent' as ResidentId)).toBe(false);
  });

  // === Inventory Management ===

  it('adds to and removes from inventory with non-negative enforcement', () => {
    business.addToInventory('ore', 30);
    expect(business.getInventory('ore')).toBe(30);

    const removed = business.removeFromInventory('ore', 12);
    expect(removed).toBe(12);
    expect(business.getInventory('ore')).toBe(18);

    // Over-remove is clamped
    const removedTooMuch = business.removeFromInventory('ore', 999);
    expect(removedTooMuch).toBe(18);
    expect(business.getInventory('ore')).toBe(0);
    expect(business.inventory['ore']).toBeUndefined(); // cleaned up
  });

  it('ignores invalid inventory operations', () => {
    business.addToInventory('lumber', 0);
    business.addToInventory('lumber', -5);
    expect(business.getInventory('lumber')).toBe(0);

    const removed = business.removeFromInventory('nonexistent', 10);
    expect(removed).toBe(0);
  });

  // === Rule-Based Daily Operations (processDay) ===

  it('processDay pays operating costs only (real wages disbursed separately by BusinessSystem for conservation)', () => {
    business.hireEmployee(sampleResidentId);

    const startCash = business.cash;
    const result = business.processDay();

    // Phase A fix: dailyExpenses === operating only (no embedded wages to prevent double outflow)
    expect(result.dailyExpenses).toBe(business.operatingCostPerDay);
    expect(business.totalExpenses).toBeGreaterThan(0);
    // Cash may net higher/lower depending on sales revenue vs small ops cost (no longer forced loss from wages)
  });

  it('processDay produces primary output scaled by employees', () => {
    const resultEmpty = business.processDay();
    expect(resultEmpty.produced).toBeGreaterThan(0);
    expect(resultEmpty.outputResource).toBe('ore');

    // Hire staff and run another day
    business.hireEmployee('res_a' as ResidentId);
    business.hireEmployee('res_b' as ResidentId);

    const resultStaffed = business.processDay();
    expect(resultStaffed.produced).toBeGreaterThanOrEqual(resultEmpty.produced);
  });

  it('processDay sells inventory and generates revenue', () => {
    // Seed with inventory so sales can happen
    business.addToInventory('ore', 100);

    const startRevenue = business.totalRevenue;
    const result = business.processDay();

    expect(result.sold).toBeGreaterThan(0);
    expect(result.dailyRevenue).toBeGreaterThan(0);
    expect(business.totalRevenue).toBeGreaterThan(startRevenue);
    expect(business.cash).toBeGreaterThan(4000); // rough
  });

  it('processDay returns correct daily P&L breakdown', () => {
    business.addToInventory(business.getPrimaryOutput(), 80);

    const result = business.processDay();

    expect(result).toHaveProperty('dailyRevenue');
    expect(result).toHaveProperty('dailyExpenses');
    expect(result).toHaveProperty('dailyProfit');
    expect(result.dailyProfit).toBeCloseTo(result.dailyRevenue - result.dailyExpenses, 1);
  });

  it('accumulates lifetime profit correctly over multiple days', () => {
    business.addToInventory('ore', 200);

    for (let d = 0; d < 5; d++) {
      business.processDay();
    }

    const profit = business.calculateProfit();
    expect(typeof profit).toBe('number');
    // After several days with sales, usually positive but we assert structure only
    expect(business.totalRevenue).toBeGreaterThan(0);
    expect(business.totalExpenses).toBeGreaterThan(0);
  });

  it('can operate at a loss (cash can decrease, no hard failure yet)', () => {
    // Force a business with very high costs and no inventory to sell
    const poorBiz = new Business({
      id: 'poor' as BusinessId,
      name: 'Struggling Shop',
      type: 'general_store',
      cash: 300,
      operatingCostPerDay: 400,
      baseProductionPerDay: 1,
      wagePerEmployeePerDay: 50,
    });
    poorBiz.hireEmployee('r1' as ResidentId);

    const before = poorBiz.cash;
    poorBiz.processDay();

    expect(poorBiz.cash).toBeLessThan(before);
    expect(poorBiz.cash).toBeLessThan(0); // debt is allowed in foundation
  });

  // === Snapshot & Serialization ===

  it('getSnapshot returns clean, rounded, inspector-friendly data', () => {
    business.hireEmployee(sampleResidentId);
    business.addToInventory('ore', 17);
    business.processDay();

    const snap = business.getSnapshot();

    expect(snap.id).toBe(business.id);
    expect(snap.name).toBe(business.name);
    expect(snap.type).toBe('mine');
    expect(snap.employeeCount).toBe(1);
    expect(snap.employeeIds).toEqual([sampleResidentId]);
    expect(snap.profit).toBeCloseTo(snap.totalRevenue - snap.totalExpenses, 2);
    expect(snap.inventory.ore).toBeGreaterThanOrEqual(0);
    expect(typeof snap.cash).toBe('number');
  });

  it('toJSON and fromJSON roundtrip preserves full state', () => {
    business.hireEmployee('res_x' as ResidentId);
    business.hireEmployee('res_y' as ResidentId);
    business.addToInventory('ore', 55);
    business.addToInventory('lumber', 12);
    business.processDay();
    business.processDay();

    const json = business.toJSON();
    const restored = Business.fromJSON(json);

    expect(restored.id).toBe(business.id);
    expect(restored.name).toBe(business.name);
    expect(restored.type).toBe(business.type);
    expect(restored.cash).toBeCloseTo(business.cash, 2);
    expect(restored.totalRevenue).toBeCloseTo(business.totalRevenue, 2);
    expect(restored.totalExpenses).toBeCloseTo(business.totalExpenses, 2);
    expect(restored.employeeIds).toEqual(business.employeeIds);
    expect(restored.getInventory('ore')).toBe(business.getInventory('ore'));
    expect(restored.operatingCostPerDay).toBe(business.operatingCostPerDay);
    expect(restored.getPrimaryOutput()).toBe(business.getPrimaryOutput());
  });

  it('fromJSON throws on obviously invalid data', () => {
    expect(() => Business.fromJSON(null)).toThrow();
    expect(() => Business.fromJSON({})).toThrow();
    expect(() => Business.fromJSON({ id: 'x', name: 'y' })).toThrow(); // missing type
  });

  // === calculateProfit ===

  it('calculateProfit reflects revenue minus expenses at any point', () => {
    expect(business.calculateProfit()).toBe(0);

    business.totalRevenue = 1500;
    business.totalExpenses = 920;

    expect(business.calculateProfit()).toBe(580);
  });

  // === BusinessInspector Data Contract Tests (UI glue validation, 4+ cases) ===
  // These ensure the snapshot + public surface consumed by BusinessInspector (P&L grid,
  // employee roster with links, inventory display, profit sampling) remains stable.

  it('BusinessSnapshot for inspector contains all required P&L + roster fields', () => {
    business.hireEmployee(sampleResidentId);
    business.addToInventory('ore', 42);
    business.processDay();

    const snap = business.getSnapshot();

    // Core fields the inspector renders in metrics + roster
    expect(snap).toHaveProperty('id');
    expect(snap).toHaveProperty('name');
    expect(snap).toHaveProperty('type');
    expect(snap).toHaveProperty('cash');
    expect(snap).toHaveProperty('profit');
    expect(snap).toHaveProperty('totalRevenue');
    expect(snap).toHaveProperty('totalExpenses');
    expect(snap).toHaveProperty('inventory');
    expect(snap).toHaveProperty('employeeCount');
    expect(snap).toHaveProperty('employeeIds');
    expect(snap).toHaveProperty('operatingCostPerDay');
    expect(snap).toHaveProperty('baseProductionPerDay');

    expect(Array.isArray(snap.employeeIds)).toBe(true);
    expect(snap.employeeCount).toBe(snap.employeeIds.length);
    expect(typeof snap.inventory).toBe('object');
  });

  it('inspector-friendly snapshot inventory is a safe copy (no external mutation)', () => {
    business.addToInventory('lumber', 9);
    const snap = business.getSnapshot();
    snap.inventory.lumber = 9999; // mutate the returned object

    // Original business must be unaffected
    expect(business.getInventory('lumber')).toBe(9);
  });

  it('employee roster in snapshot supports inspector cross-link buttons (ids are strings)', () => {
    business.hireEmployee('emp_alpha' as ResidentId);
    business.hireEmployee('emp_beta' as ResidentId);

    const snap = business.getSnapshot();
    expect(snap.employeeIds).toContain('emp_alpha');
    expect(snap.employeeIds).toContain('emp_beta');
    expect(snap.employeeIds.every((id) => typeof id === 'string')).toBe(true);
  });

  it('profit + cash values in snapshot are numbers suitable for sparkline and live metrics', () => {
    business.processDay();
    const snap = business.getSnapshot();

    expect(typeof snap.cash).toBe('number');
    expect(typeof snap.profit).toBe('number');
    expect(Number.isFinite(snap.cash)).toBe(true);
    expect(Number.isFinite(snap.profit)).toBe(true);
  });

  it('BusinessSystem snapshot shape used by God + inspector remains complete', () => {
    // This is a light contract test (BusinessSystem not mutated here, but shape used by inspector via system)
    // We validate Business.getSnapshot which is what BusinessSystem forwards in its array
    const snap = business.getSnapshot();
    expect(snap.profit).toBeDefined();
    expect(snap.inventory).toBeDefined();
    expect(snap.employeeIds).toBeDefined();
  });
});
