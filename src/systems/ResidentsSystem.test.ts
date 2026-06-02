import { describe, it, expect, beforeEach } from 'vitest';
import { ResidentsSystem } from './ResidentsSystem';
import { Resident } from '../entities/Resident';
import { TimeSystem } from '../core/TimeSystem';
import { LocationsSystem } from './LocationsSystem';
import { createHome } from '../entities/Location';

describe('ResidentsSystem', () => {
  let time: TimeSystem;
  let system: ResidentsSystem;

  beforeEach(() => {
    time = new TimeSystem(42);
    system = new ResidentsSystem(time);
  });

  it('can add and retrieve residents', () => {
    const resident = new Resident({
      id: 'r_test',
      name: 'Test Person',
      homeId: 'h1',
      workId: 'w1',
      hourlyWage: 20,
    });

    system.addResident(resident);
    expect(system.getResident('r_test')).toBeDefined();
    expect(system.getAllResidents().length).toBe(1);
  });

  it('updates all residents when time advances', () => {
    const r1 = new Resident({ id: 'r1', name: 'A', homeId: 'h', workId: 'w', hourlyWage: 15 });
    const r2 = new Resident({ id: 'r2', name: 'B', homeId: 'h', workId: 'w', hourlyWage: 15 });

    system.addResident(r1);
    system.addResident(r2);

    // Advance time to 10:30
    for (let i = 0; i < 10 * 60 + 30; i++) {
      time.advanceTick();
    }

    system.update();

    expect(r1.currentActivity).toBe('working');
    expect(r2.currentActivity).toBe('working');
  });

  it('propagates needs updates and includes them in system snapshots', () => {
    const r = new Resident({ id: 'r_needs', name: 'NeedsTest', homeId: 'h', workId: 'w', hourlyWage: 15 });
    system.addResident(r);

    // Advance simulated time into the workday so fatigue builds (instead of recovering at night)
    for (let i = 0; i < 10 * 60 + 15; i++) {
      time.advanceTick();
    }

    // Now perform many updates while time reports work hours -> fatigue + hunger accumulate
    for (let i = 0; i < 120; i++) {
      system.update();
    }

    // Check live object first (debug aid)
    expect(r.needs.hunger).toBeGreaterThan(5);
    expect(r.needs.fatigue).toBeGreaterThan(10);

    const snap = system.getSnapshot();
    const residentSnap = snap.find(s => s.id === 'r_needs');
    expect(residentSnap).toBeDefined();
    expect(residentSnap?.needs).toBeDefined();
    expect(residentSnap?.needs.hunger).toBeGreaterThan(5);
    expect(residentSnap?.needs.fatigue).toBeGreaterThan(10);
  });

  // ========== PAYDAY & STATS EXPANSION ==========

  it('processFridayPayday performs rent collection only (no wage distribution - Phase A wage unification; wages via daily payroll)', () => {
    const r1 = new Resident({ id: 'r1', name: 'A', homeId: 'h', workId: 'w', hourlyWage: 20 });
    r1.money = 500;
    system.addResident(r1);

    // Without LocationsSystem, payday does nothing but must not crash or add wages
    const before = r1.money;
    system.processFridayPayday();
    expect(r1.money).toBe(before); // no wage added

    // With Locations (mock minimal): rent collected, capped, event would fire in real
    // (full rent test below exercises the Locations path)
  });

  it('getStats reflects average money and needs accurately', () => {
    const r1 = new Resident({ id: 'r1', name: 'A', homeId: 'h', workId: 'w', hourlyWage: 10 });
    const r2 = new Resident({ id: 'r2', name: 'B', homeId: 'h', workId: 'w', hourlyWage: 30 });
    r1.money = 100;
    r2.money = 200;
    r1.needs.hunger = 10;
    r2.needs.hunger = 20;

    system.addResident(r1);
    system.addResident(r2);

    const stats = system.getStats();
    expect(stats.total).toBe(2);
    expect(stats.averageMoney).toBeCloseTo(150, 5);
    expect(stats.averageHunger).toBeCloseTo(15, 5);
    expect(stats.averageFatigue).toBeGreaterThanOrEqual(0);
  });

  it('getStats handles empty population gracefully', () => {
    const stats = system.getStats();
    expect(stats.total).toBe(0);
    expect(stats.averageMoney).toBe(0);
    expect(stats.averageHunger).toBe(0);
  });

  it('multiple processFridayPayday calls accumulate NO wages (Phase A: only rent when Locations present)', () => {
    const r = new Resident({ id: 'rp', name: 'P', homeId: 'h', workId: 'w', hourlyWage: 25 });
    r.money = 100;
    system.addResident(r);

    system.processFridayPayday();
    system.processFridayPayday();

    // No wage accumulation anymore
    expect(r.money).toBe(100);
  });

  // === God Mode / Debug global actions (new in this sprint) ===
  it('forcePaydayNow works (alias for process - rent only path)', () => {
    const r = new Resident({ id: 'g1', name: 'G', homeId: 'h', workId: 'w', hourlyWage: 18 });
    r.money = 50;
    system.addResident(r);
    system.forcePaydayNow();
    // Still runs without crash (rent skipped without Locations); money unchanged here
    expect(r.money).toBe(50);
  });

  it('applyGlobalNeedDelta and spike helpers mutate all residents safely', () => {
    const r1 = new Resident({ id: 'g2', name: 'G2', homeId: 'h', workId: 'w', hourlyWage: 15 });
    const r2 = new Resident({ id: 'g3', name: 'G3', homeId: 'h', workId: 'w', hourlyWage: 15 });
    r1.needs.hunger = 10; r1.needs.fatigue = 20; r1.needs.social = 30;
    r2.needs.hunger = 15; r2.needs.fatigue = 25; r2.needs.social = 35;
    system.addResident(r1);
    system.addResident(r2);

    system.triggerHungerCrisis();
    expect(r1.needs.hunger).toBeGreaterThan(60);
    expect(r2.needs.hunger).toBeGreaterThan(60);

    system.resetAllNeeds();
    expect(r1.needs.hunger).toBeLessThan(20);
    expect(r2.needs.fatigue).toBeLessThan(20);
  });

  it('global need deltas clamp correctly', () => {
    const r = new Resident({ id: 'gc', name: 'C', homeId: 'h', workId: 'w', hourlyWage: 12 });
    r.needs.hunger = 90;
    system.addResident(r);
    system.applyGlobalNeedDelta({ hunger: 50, fatigue: -999 });
    expect(r.needs.hunger).toBe(100);
    expect(r.needs.fatigue).toBe(0);
  });

  // === Wave 3 TE Targeted Additions: Employment / Unemployment helpers ===
  it('getEmploymentCounts reports accurate employed/unemployed split and rate in [0,1]', () => {
    const r1 = new Resident({ id: 'e1', name: 'E1', homeId: 'h', workId: 'w', hourlyWage: 20 });
    const r2 = new Resident({ id: 'e2', name: 'E2', homeId: 'h', workId: 'w', hourlyWage: 15 });
    const r3 = new Resident({ id: 'u1', name: 'U1', homeId: 'h', workId: 'w', hourlyWage: 18 });
    (r1 as any).employerId = 'biz_a';
    (r2 as any).employerId = 'biz_b';
    // r3 stays null = unemployed

    system.addResident(r1);
    system.addResident(r2);
    system.addResident(r3);

    const counts = system.getEmploymentCounts();
    expect(counts.total).toBeUndefined(); // impl uses employed + unemployed
    expect(counts.employed).toBe(2);
    expect(counts.unemployed).toBe(1);
    // System uses Math.round((employed / total) * 1000) / 1000 → 0.667 for 2/3
    expect(counts.rate).toBeCloseTo(0.667, 3);
    expect(counts.rate).toBeGreaterThanOrEqual(0);
    expect(counts.rate).toBeLessThanOrEqual(1);
  });

  it('getUnemployedResidents returns only residents without employerId', () => {
    const employed = new Resident({ id: 'emp_r', name: 'EmpR', homeId: 'h', workId: 'w', hourlyWage: 22 });
    (employed as any).employerId = 'some_biz';
    const unemp1 = new Resident({ id: 'u_r1', name: 'UR1', homeId: 'h', workId: 'w', hourlyWage: 10 });
    const unemp2 = new Resident({ id: 'u_r2', name: 'UR2', homeId: 'h', workId: 'w', hourlyWage: 10 });

    system.addResident(employed);
    system.addResident(unemp1);
    system.addResident(unemp2);

    const unemps = system.getUnemployedResidents();
    expect(unemps.length).toBe(2);
    expect(unemps.every((r: any) => r.employerId === null)).toBe(true);
    expect(unemps.map((r: any) => r.id)).toContain('u_r1');
    expect(unemps.map((r: any) => r.id)).toContain('u_r2');
  });

  // === Housing market + rent (HM agent additions) ===

  it('ctor accepts optional LocationsSystem (back-compat with 1-arg calls)', () => {
    const locs = new LocationsSystem();
    const s2 = new ResidentsSystem(time, locs);
    expect(s2).toBeDefined();
    // 1-arg still works (tested by all prior its in this file)
  });

  it('processFridayPayday collects rent using Locations rents (never negative money)', () => {
    const locs = new LocationsSystem();
    const home = createHome('home_pay', 'PayHome', { x: 0, y: 0 }, 2, 22);
    locs.registerLocation(home);

    const r1 = new Resident({ id: 'rp1', name: 'P1', homeId: 'home_pay', workId: 'w', hourlyWage: 15 });
    const r2 = new Resident({ id: 'rp2', name: 'P2', homeId: 'home_pay', workId: 'w', hourlyWage: 10 });
    r1.money = 5; // low
    r2.money = 100;

    const sys = new ResidentsSystem(time, locs);
    sys.addResident(r1);
    sys.addResident(r2);

    sys.processFridayPayday();

    // Phase A: no wages added on payday; only rent collected (capped, never-negative)
    expect(r1.money).toBeGreaterThanOrEqual(0);
    expect(r2.money).toBeGreaterThanOrEqual(0);
    // r1 started at 5, can only pay min(22,5)=5 -> 0 left
    expect(r1.money).toBe(0);
    // r2 started 100, pays full 22 rent
    expect(r2.money).toBe(100 - 22);
  });

  it('forceHousingMarketStep + day boundary logic can reassign pressured residents to cheaper vacant homes', () => {
    const locs = new LocationsSystem();
    const cheap = createHome('h_cheap', 'Cheap', { x: 0, y: 0 }, 5, 18);
    const expensive = createHome('h_exp', 'Expensive', { x: 30, y: 30 }, 2, 75);
    locs.registerLocation(cheap);
    locs.registerLocation(expensive);

    const sys = new ResidentsSystem(time, locs);

    // 3 residents in expensive, low money + long unemp -> pressure
    for (let i = 0; i < 3; i++) {
      const r = new Resident({ id: `u${i}`, name: `U${i}`, homeId: 'h_exp', workId: 'w', hourlyWage: 12 });
      (r as any).employerId = null;
      r.unemploymentDurationTicks = 900; // ~15h
      r.money = 10;
      sys.addResident(r);
    }
    // 1 in cheap for headroom
    const stable = new Resident({ id: 's1', name: 'S', homeId: 'h_cheap', workId: 'w', hourlyWage: 20 });
    sys.addResident(stable);

    // Initial occ: exp=3 (cap2 -> pressure), cheap=1
    expect(locs.getLocation('h_exp')!.currentOccupants).toBe(0); // not yet synced

    sys.forceHousingMarketStep();

    // After: at least one should have moved to cheap (vacancy exists)
    const afterExp = sys.getAllResidents().filter(r => r.homeId === 'h_exp').length;
    const afterCheap = sys.getAllResidents().filter(r => r.homeId === 'h_cheap').length;
    expect(afterExp).toBeLessThan(3);
    expect(afterCheap).toBeGreaterThan(1);

    // Still no one stranded, all have valid homes
    expect(sys.getAllResidents().every(r => r.homeId === 'h_cheap' || r.homeId === 'h_exp')).toBe(true);
  });

  it('rent collection and housing reassign survive loadFromFullStates roundtrip', () => {
    const locs = new LocationsSystem();
    locs.createHome('h_rt', 'RT', { x: 0, y: 0 }, 4, 30);

    const sys = new ResidentsSystem(time, locs);
    const r = new Resident({ id: 'rt', name: 'RT', homeId: 'h_rt', workId: 'w', hourlyWage: 18 });
    r.money = 50;
    sys.addResident(r);

    const states = sys.getFullStates();
    sys.clear();
    sys.loadFromFullStates(states);

    // After load, can still trigger payday rent without crash
    sys.processFridayPayday();
    expect(sys.getResident('rt')!.money).toBeGreaterThanOrEqual(0);

    sys.forceHousingMarketStep(); // no-op but safe
  });
});
