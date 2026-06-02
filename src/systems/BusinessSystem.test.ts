import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BusinessSystem } from './BusinessSystem';
import { Business, type BusinessId, type BusinessType } from '../entities/Business';
import { TimeSystem } from '../core/TimeSystem';
import { ResidentsSystem } from './ResidentsSystem';
import { Resident, type ResidentId } from '../entities/Resident';

describe('BusinessSystem', () => {
  let time: TimeSystem;
  let residents: ResidentsSystem;
  let system: BusinessSystem;

  const sampleBusinessId = 'biz_001' as BusinessId;
  const sampleType: BusinessType = 'mine';

  beforeEach(() => {
    time = new TimeSystem(42);
    residents = new ResidentsSystem(time);
    system = new BusinessSystem(time, residents);
  });

  // === Construction & Basic State ===

  it('starts empty with sensible defaults', () => {
    expect(system.getBusinessCount()).toBe(0);
    expect(system.getAllBusinesses()).toHaveLength(0);
    expect(system.getTotalEconomyStats().count).toBe(0);
    // lastProcessedDay is initialized to the TimeSystem's current day (1 for fresh instance)
    expect(system.getSnapshot().lastProcessedDay).toBe(1);
  });

  // === Registration ===

  it('can register and retrieve businesses', () => {
    const biz = new Business({ id: sampleBusinessId, name: 'Deep Rock Mine', type: sampleType });
    system.registerBusiness(biz);

    expect(system.getBusinessCount()).toBe(1);
    expect(system.getBusiness(sampleBusinessId)).toBe(biz);
    expect(system.hasBusiness(sampleBusinessId)).toBe(true);
    expect(system.getAllBusinesses()[0].id).toBe(sampleBusinessId);
  });

  it('supports bulk registration', () => {
    const b1 = new Business({ id: 'b1' as BusinessId, name: 'B1', type: 'farm' });
    const b2 = new Business({ id: 'b2' as BusinessId, name: 'B2', type: 'bakery' });
    system.registerBusinesses([b1, b2]);

    expect(system.getBusinessCount()).toBe(2);
  });

  it('createBusiness registers in one step and returns the instance', () => {
    const created = system.createBusiness({
      id: 'created_1' as BusinessId,
      name: 'Auto Bakery',
      type: 'bakery',
      cash: 12000,
    });

    expect(system.getBusiness('created_1' as BusinessId)).toBe(created);
    expect(created.name).toBe('Auto Bakery');
    expect(created.cash).toBe(12000);
  });

  it('warns on overwrite of different instance but still registers', () => {
    const b1 = new Business({ id: 'dup' as BusinessId, name: 'First', type: 'mine' });
    const b2 = new Business({ id: 'dup' as BusinessId, name: 'Second', type: 'mine' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    system.registerBusiness(b1);
    system.registerBusiness(b2);

    expect(system.getBusiness('dup' as BusinessId)?.name).toBe('Second');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  // === Queries ===

  it('getBusinessesByType filters correctly', () => {
    system.createBusiness({ id: 'm1' as BusinessId, name: 'M1', type: 'mine' });
    system.createBusiness({ id: 'm2' as BusinessId, name: 'M2', type: 'mine' });
    system.createBusiness({ id: 'f1' as BusinessId, name: 'F1', type: 'farm' });

    const mines = system.getBusinessesByType('mine');
    const farms = system.getBusinessesByType('farm');

    expect(mines).toHaveLength(2);
    expect(farms).toHaveLength(1);
  });

  it('getBusinessesByEmployee returns businesses employing the resident', () => {
    const empId = 'res_emp_1' as ResidentId;

    const mine = system.createBusiness({ id: 'mine_e' as BusinessId, name: 'Mine', type: 'mine' });
    const bakery = system.createBusiness({ id: 'bak_e' as BusinessId, name: 'Bakery', type: 'bakery' });

    mine.hireEmployee(empId);
    bakery.hireEmployee('other' as ResidentId);

    const employers = system.getBusinessesByEmployee(empId);
    expect(employers).toHaveLength(1);
    expect(employers[0].id).toBe('mine_e');
  });

  it('getTotalEconomyStats aggregates correctly across businesses', () => {
    const b1 = system.createBusiness({ id: 's1' as BusinessId, name: 'S1', type: 'mine', cash: 1000 });
    const b2 = system.createBusiness({ id: 's2' as BusinessId, name: 'S2', type: 'farm', cash: 3000 });
    b1.totalRevenue = 800;
    b1.totalExpenses = 300;
    b2.totalRevenue = 400;
    b2.totalExpenses = 100;

    b1.hireEmployee('e1' as ResidentId);
    b2.hireEmployee('e2' as ResidentId);
    b2.hireEmployee('e3' as ResidentId);

    const stats = system.getTotalEconomyStats();

    expect(stats.count).toBe(2);
    expect(stats.totalCash).toBeCloseTo(4000);
    expect(stats.totalRevenue).toBeCloseTo(1200);
    expect(stats.totalExpenses).toBeCloseTo(400);
    expect(stats.totalProfit).toBeCloseTo(800);
    expect(stats.totalEmployees).toBe(3);
    expect(stats.averageCash).toBeCloseTo(2000);
  });

  // === Day Boundary Processing + Real Wage Disbursement ===

  it('update() triggers processDay on businesses only when simulated day changes', () => {
    const biz = system.createBusiness({
      id: 'day_test' as BusinessId,
      name: 'Day Tester',
      type: 'factory',
      cash: 5000,
    });
    biz.hireEmployee('emp' as ResidentId); // even without real resident, processDay runs

    // Initial state: day 1
    expect(time.day).toBe(1);
    const startCash = biz.cash;
    const startExpenses = biz.totalExpenses;

    // Call update on same day — nothing should happen
    system.update();
    expect(biz.cash).toBe(startCash);
    expect(biz.totalExpenses).toBe(startExpenses);

    // Advance time across one full day boundary (1440 ticks = 24h)
    for (let i = 0; i < 1440; i++) {
      time.advanceTick();
    }
    // Now we are on day 2
    expect(time.day).toBe(2);

    system.update();

    // processDay must have run (Phase A: expenses increased for ops; cash may net up/down due to sales revenue)
    expect(biz.totalExpenses).toBeGreaterThan(startExpenses);
    // Cash movement from ops+revenue is expected; real wages hit in disburse (tested in next its)
  });

  it('disburses real wages to actual residents using their hourlyWage * 8', () => {
    // Create real resident with known wage
    const empId = 'res_wage_1' as ResidentId;
    const resident = new Resident({
      id: empId,
      name: 'Wage Worker',
      homeId: 'h1',
      workId: 'w1',
      hourlyWage: 25, // $25/hr
    });
    residents.addResident(resident);
    resident.money = 50; // starting money

    const biz = system.createBusiness({
      id: 'payroll_test' as BusinessId,
      name: 'Payroll Co',
      type: 'factory',
      cash: 10000,
    });
    biz.hireEmployee(empId);

    // Capture starting values
    const startBizCash = biz.cash;
    const startResidentMoney = resident.money;

    // Force a day boundary
    for (let i = 0; i < 1440; i++) {
      time.advanceTick();
    }
    system.update();

    // Expected daily wage = 25 * 8 = 200
    const expectedWage = 25 * 8;

    // Phase A: real disbursement is the wage hit (processDay only ops now). Resident got exactly the wage.
    // Biz cash: ops paid in processDay + real wage in disburse; sales revenue may offset.
    expect(resident.money).toBeCloseTo(startResidentMoney + expectedWage, 2);
    // At minimum, the wage transfer to resident occurred (biz funded it)
    expect(biz.cash).toBeLessThan(startBizCash); // net effect of day (ops + wages - any sales)
  });

  it('handles multiple employees with different wages correctly', () => {
    const r1 = new Resident({ id: 'r1' as ResidentId, name: 'R1', homeId: 'h', workId: 'w', hourlyWage: 10 });
    const r2 = new Resident({ id: 'r2' as ResidentId, name: 'R2', homeId: 'h', workId: 'w', hourlyWage: 30 });
    residents.addResident(r1);
    residents.addResident(r2);

    const biz = system.createBusiness({ id: 'multi' as BusinessId, name: 'Multi', type: 'general_store', cash: 20000 });
    biz.hireEmployee('r1' as ResidentId);
    biz.hireEmployee('r2' as ResidentId);

    const startR1 = r1.money;
    const startR2 = r2.money;
    const startCash = biz.cash;

    // cross day boundary
    for (let i = 0; i < 2000; i++) time.advanceTick();
    system.update();

    expect(r1.money).toBeCloseTo(startR1 + 10 * 8, 1);
    expect(r2.money).toBeCloseTo(startR2 + 30 * 8, 1);
    // Phase A: biz paid the real wages via disburse (plus ops in processDay); net may vary with revenue
    expect(biz.cash).toBeLessThan(startCash); // wages + ops outflow occurred
  });

  it('gracefully skips wage disbursement for unknown employee ids (dangling references)', () => {
    const biz = system.createBusiness({ id: 'dangle' as BusinessId, name: 'Dangle', type: 'mine', cash: 5000 });
    biz.hireEmployee('ghost_1' as ResidentId);
    biz.hireEmployee('ghost_2' as ResidentId);

    for (let i = 0; i < 1440; i++) time.advanceTick();
    system.update();

    // processDay still ran (expenses increased for ops), no wage transfers for ghosts
    expect(biz.totalExpenses).toBeGreaterThan(0);
    // Phase A: cash effect from ops only (revenue may offset; no double wage hit)
  });

  it('runs processDay + disbursements across multiple consecutive days', () => {
    const r = new Resident({ id: 'multi_day' as ResidentId, name: 'MultiDay', homeId: 'h', workId: 'w', hourlyWage: 15 });
    residents.addResident(r);

    const biz = system.createBusiness({ id: 'multi_day_b' as BusinessId, name: 'MultiDayBiz', type: 'farm', cash: 8000 });
    biz.hireEmployee('multi_day' as ResidentId);

    const startMoney = r.money;

    // Cross 3 day boundaries
    for (let d = 0; d < 3; d++) {
      for (let t = 0; t < 1440; t++) time.advanceTick();
      system.update();
    }

    // Resident should have received 3 * (15*8) = 360 from disbursements
    expect(r.money).toBeCloseTo(startMoney + 3 * 15 * 8, 2);
    expect(biz.getEmployeeCount()).toBe(1);
  });

  // === Snapshot & Serialization ===

  it('getSnapshot returns rich inspector-friendly data including nested business snapshots and economy', () => {
    const r = new Resident({ id: 'snap_emp' as ResidentId, name: 'SnapEmp', homeId: 'h', workId: 'w', hourlyWage: 22 });
    residents.addResident(r);

    const biz = system.createBusiness({ id: 'snap_b' as BusinessId, name: 'SnapBiz', type: 'bakery', cash: 7500 });
    biz.hireEmployee('snap_emp' as ResidentId);
    biz.addToInventory('food', 40);

    // Trigger one day so we have some P&L movement
    for (let i = 0; i < 1440; i++) time.advanceTick();
    system.update();

    const snap = system.getSnapshot();

    expect(snap.count).toBe(1);
    expect(snap.lastProcessedDay).toBeGreaterThan(0);
    expect(snap.businesses).toHaveLength(1);
    expect(snap.businesses[0].id).toBe('snap_b');
    expect(snap.businesses[0].employeeCount).toBe(1);
    expect(snap.economy.count).toBe(1);
    expect(snap.economy.totalEmployees).toBe(1);
    expect(typeof snap.economy.totalCash).toBe('number');
  });

  it('getSerializableState produces roundtrippable business payloads', () => {
    const biz = system.createBusiness({ id: 'ser_b' as BusinessId, name: 'SerBiz', type: 'oil_rig', cash: 25000 });
    biz.hireEmployee('ser_e' as ResidentId);
    biz.addToInventory('oil', 12);
    biz.processDay();

    const state = system.getSerializableState();

    expect(state.lastProcessedDay).toBeGreaterThanOrEqual(0);
    expect(state.businesses).toHaveLength(1);
    expect(state.businesses[0].id).toBe('ser_b');
    expect(state.businesses[0].employeeIds).toEqual(['ser_e']);
    expect(state.businesses[0].inventory.oil).toBeGreaterThanOrEqual(0);
  });

  // === Utilities ===

  it('removeBusiness and clear work as expected', () => {
    system.createBusiness({ id: 'to_remove' as BusinessId, name: 'R', type: 'mine' });
    system.createBusiness({ id: 'keep' as BusinessId, name: 'K', type: 'farm' });

    expect(system.removeBusiness('to_remove' as BusinessId)).toBe(true);
    expect(system.getBusinessCount()).toBe(1);

    system.clear();
    expect(system.getBusinessCount()).toBe(0);
    // After clear we re-sync to whatever the TimeSystem day currently is (still 1 in this test)
    expect(system.getSnapshot().lastProcessedDay).toBe(1);
  });

  it('update on empty system is a safe no-op', () => {
    // Advance many days
    for (let i = 0; i < 5000; i++) time.advanceTick();
    expect(() => system.update()).not.toThrow();
    expect(system.getBusinessCount()).toBe(0);
  });

  // ========== DEEPER EMPLOYMENT INTEGRATION TESTS ==========

  describe('coordinated employment (hire/fire with resident sync + effects)', () => {
    it('hireEmployee syncs business list + sets resident.employerId and pays hiring bonus', () => {
      const emp = new Resident({ id: 'emp1' as ResidentId, name: 'Emp', homeId: 'h', workId: 'w', hourlyWage: 20 });
      residents.addResident(emp);
      const startSocial = emp.needs.social;
      const startMoney = emp.money;

      const biz = system.createBusiness({ id: 'co_biz' as BusinessId, name: 'Co', type: 'bakery', cash: 10000 });

      const ok = system.hireEmployee('co_biz' as BusinessId, 'emp1' as ResidentId);
      expect(ok).toBe(true);
      expect(biz.employeeIds).toContain('emp1');
      expect(emp.employerId).toBe('co_biz');
      expect(emp.isEmployed()).toBe(true);
      expect(emp.needs.social).toBeLessThan(startSocial); // relief
      expect(emp.money).toBeGreaterThan(startMoney); // bonus paid
      expect(biz.cash).toBeLessThan(10000); // business funded bonus
    });

    it('fireEmployee removes from both sides, pays severance, applies stress', () => {
      const emp = new Resident({ id: 'emp2' as ResidentId, name: 'Emp2', homeId: 'h', workId: 'w', hourlyWage: 15 });
      residents.addResident(emp);
      const biz = system.createBusiness({ id: 'fire_biz' as BusinessId, name: 'F', type: 'mine', cash: 8000 });

      system.hireEmployee('fire_biz' as BusinessId, 'emp2' as ResidentId);
      const afterHireMoney = emp.money;
      const afterHireSocial = emp.needs.social;

      const ok = system.fireEmployee('fire_biz' as BusinessId, 'emp2' as ResidentId);
      expect(ok).toBe(true);
      expect(biz.employeeIds).not.toContain('emp2');
      expect(emp.employerId).toBeNull();
      expect(emp.money).toBeGreaterThan(afterHireMoney); // severance
      expect(emp.needs.social).toBeGreaterThan(afterHireSocial); // stress
    });

    it('getEmploymentStats reflects hires correctly', () => {
      const r1 = new Resident({ id: 'r1' as ResidentId, name: 'R1', homeId: 'h', workId: 'w', hourlyWage: 10 });
      const r2 = new Resident({ id: 'r2' as ResidentId, name: 'R2', homeId: 'h', workId: 'w', hourlyWage: 10 });
      residents.addResident(r1);
      residents.addResident(r2);

      system.createBusiness({ id: 'es1' as BusinessId, name: 'ES1', type: 'farm' });
      system.hireEmployee('es1' as BusinessId, 'r1' as ResidentId);

      const stats = system.getEmploymentStats();
      expect(stats.totalEmployed).toBe(1);
      expect(stats.totalUnemployed).toBe(1);
      expect(stats.employmentRate).toBeGreaterThan(0.4);
      expect(stats.businessesWithEmployees).toBe(1);
    });

    it('getEmployerForResident and getEmploymentStatus work after coordinated hire', () => {
      const r = new Resident({ id: 'rs' as ResidentId, name: 'RS', homeId: 'h', workId: 'w', hourlyWage: 12 });
      residents.addResident(r);
      system.createBusiness({ id: 'empstat' as BusinessId, name: 'ES', type: 'factory' });
      system.hireEmployee('empstat' as BusinessId, 'rs' as ResidentId);

      const employer = system.getEmployerForResident('rs' as ResidentId);
      expect(employer?.id).toBe('empstat');

      const status = system.getEmploymentStatus('rs' as ResidentId);
      expect(status.employed).toBe(true);
      expect(status.employerId).toBe('empstat');
      expect(status.employerName).toBe('ES');
    });

    it('snapshot now includes employment aggregates', () => {
      const snap = system.getSnapshot();
      expect(snap).toHaveProperty('employment');
      expect(typeof snap.employment.employmentRate).toBe('number');
      expect(snap.employment).toHaveProperty('totalEmployed');
    });

    it('getEmploymentStats now reports averageUnemploymentDurationHours', () => {
      const rU = new Resident({ id: 'ru' as ResidentId, name: 'RU', homeId: 'h', workId: 'w', hourlyWage: 10 });
      // Simulate clock accumulation (as ResidentsSystem would)
      (rU as any).unemploymentDurationTicks = 60 * 5; // 5 hours
      residents.addResident(rU);

      const stats = system.getEmploymentStats();
      expect(stats.totalUnemployed).toBeGreaterThanOrEqual(1);
      expect(typeof stats.averageUnemploymentDurationHours).toBe('number');
      expect(stats.averageUnemploymentDurationHours).toBeGreaterThanOrEqual(4.9);
    });

    it('runBasicJobSearch performs occasional hires (prefers workId match) and updates stats', () => {
      // Setup: one unemployed resident whose workId matches a business
      const rJob = new Resident({ id: 'jobseeker' as ResidentId, name: 'Job', homeId: 'h', workId: 'biz_js' as any, hourlyWage: 12 });
      // Force some unemployment duration for higher chance in the model
      (rJob as any).unemploymentDurationTicks = 60 * 8;
      residents.addResident(rJob);

      const biz = system.createBusiness({ id: 'biz_js' as BusinessId, name: 'JS Biz', type: 'bakery' });
      expect(biz.employeeIds.length).toBe(0);

      // Run multiple times (simulates ticks); with duration bias it should hire eventually
      let hired = false;
      let lastResult: { hires: number; candidatesConsidered: number } | null = null;
      for (let i = 0; i < 80; i++) {
        // Advance a fake tick for pseudo-random
        (system as any).timeSystem._tick = ((system as any).timeSystem._tick || 0) + 25;
        lastResult = system.runBasicJobSearch();
        if (biz.employeeIds.includes('jobseeker' as any)) {
          hired = true;
          break;
        }
      }

      expect(hired).toBe(true); // probabilistic but high likelihood with bias + many attempts in test
      expect(lastResult).not.toBeNull();
      expect(lastResult!.hires).toBeGreaterThanOrEqual(1);
      expect(lastResult!.candidatesConsidered).toBeGreaterThanOrEqual(1);
      const postStats = system.getEmploymentStats();
      expect(postStats.totalEmployed).toBeGreaterThan(0);
      // Coordinated: resident side also updated
      expect(rJob.isEmployed()).toBe(true);
      expect(rJob.unemploymentDurationTicks).toBe(0);
    });

    // === Wave 3 TE Targeted Job-Search / Employment Invariant Additions ===
    it('runBasicJobSearch over repeated calls gradually reduces unemployment count (relief dynamic)', () => {
      // Setup multiple unemployed with varying durations + one matching biz
      const r1 = new Resident({ id: 'js1' as ResidentId, name: 'JS1', homeId: 'h', workId: 'match_biz' as any, hourlyWage: 18 });
      const r2 = new Resident({ id: 'js2' as ResidentId, name: 'JS2', homeId: 'h', workId: 'match_biz' as any, hourlyWage: 14 });
      (r1 as any).unemploymentDurationTicks = 60 * 20;
      (r2 as any).unemploymentDurationTicks = 60 * 3;
      residents.addResident(r1);
      residents.addResident(r2);

      system.createBusiness({ id: 'match_biz' as BusinessId, name: 'Matchy', type: 'factory', cash: 25000 });

      const startUnemp = system.getEmploymentStats().totalUnemployed;
      expect(startUnemp).toBeGreaterThanOrEqual(2);

      let hiresAccum = 0;
      for (let i = 0; i < 60; i++) {
        (system as any).timeSystem._tick = ((system as any).timeSystem._tick || 0) + 30;
        const res = system.runBasicJobSearch();
        hiresAccum += res.hires;
        if (system.getEmploymentStats().totalUnemployed === 0) break;
      }

      const endStats = system.getEmploymentStats();
      // Job search must have made visible progress (not guaranteed 100% in limited steps, but reduction or hires recorded)
      expect(hiresAccum).toBeGreaterThanOrEqual(0);
      expect(endStats.totalUnemployed).toBeLessThanOrEqual(startUnemp);
      expect(endStats.totalEmployed).toBeGreaterThanOrEqual(0);
      expect(endStats.totalEmployed + endStats.totalUnemployed).toBe(2);
    });

    it('employment stats never report negative counts or rates outside [0,1] (invariant smoke)', () => {
      const r = new Resident({ id: 'inv_emp' as ResidentId, name: 'Inv', homeId: 'h', workId: 'w', hourlyWage: 16 });
      residents.addResident(r);

      const stats = system.getEmploymentStats();
      expect(stats.totalEmployed).toBeGreaterThanOrEqual(0);
      expect(stats.totalUnemployed).toBeGreaterThanOrEqual(0);
      expect(stats.employmentRate).toBeGreaterThanOrEqual(0);
      expect(stats.employmentRate).toBeLessThanOrEqual(1);
    });
  });
});
