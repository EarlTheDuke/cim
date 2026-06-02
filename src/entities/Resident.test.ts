import { describe, it, expect, beforeEach } from 'vitest';
import { Resident, type Activity } from './Resident';

describe('Resident', () => {
  let resident: Resident;

  beforeEach(() => {
    resident = new Resident({
      id: 'r_001',
      name: 'Alex Rivera',
      homeId: 'home_1',
      workId: 'business_bakery',
      hourlyWage: 18,
    });
  });

  it('starts at home with correct defaults', () => {
    expect(resident.currentLocationId).toBe('home_1');
    expect(resident.currentActivity).toBe('sleeping');
    expect(resident.money).toBe(0);
  });

  it('transitions to working during work hours', () => {
    // Simulate 10:00
    resident.update(10, 0);
    expect(resident.currentActivity).toBe('working');
  });

  it('does NOT auto-accrue per-minute wages (Phase A: centralized to daily BusinessSystem payroll for money conservation)', () => {
    const startMoney = resident.money;
    resident.setEmployer('test_employer_biz' as any);
    for (let i = 0; i < 60; i++) {
      resident.update(10, i);
      resident.updateUnemploymentClock();
      if ((resident.unemploymentDurationTicks || 0) > 10) resident.unemploymentDurationTicks = 0;
    }
    // No per-minute money added (removed for robustness; explicit daily disburse is the wage source)
    expect(resident.money).toBe(startMoney);
    // Activity still correctly 'working' for movement/commute viz
    expect(resident.currentActivity).toBe('working');
    resident.setEmployer(null);
  });

  it('returns home after work hours', () => {
    resident.update(18, 30); // after 17:00
    expect(resident.currentActivity).toBe('at_home');
  });

  it('recovers energy while sleeping (energy derived from fatigue)', () => {
    // Use the new needs model directly - simulate multiple ticks for visible recovery
    resident.needs.fatigue = 60;
    for (let i = 0; i < 40; i++) {
      resident.update(2, i % 60); // 40 ticks of sleep (~40 min)
    }
    expect(resident.energy).toBeGreaterThanOrEqual(50); // recovered substantially (40 ticks * 0.25 recovery)
    expect(resident.needs.fatigue).toBeLessThanOrEqual(50);
  });

  // ========== NEW NEEDS SYSTEM TESTS ==========

  it('initializes with sensible default needs', () => {
    expect(resident.needs.hunger).toBe(0);
    expect(resident.needs.fatigue).toBe(0);
    expect(resident.needs.social).toBeGreaterThanOrEqual(0);
    expect(resident.needs.social).toBeLessThanOrEqual(100);
  });

  it('hunger increases over time', () => {
    const startHunger = resident.needs.hunger;
    // Advance 2 simulated hours (120 ticks)
    for (let i = 0; i < 120; i++) {
      resident.update(10, i % 60);
    }
    expect(resident.needs.hunger).toBeGreaterThan(startHunger + 10);
  });

  it('fatigue builds while working and recovers while sleeping', () => {
    // Work for ~2 hours
    for (let i = 0; i < 120; i++) {
      resident.update(10, i % 60);
    }
    const fatigueAfterWork = resident.needs.fatigue;
    expect(fatigueAfterWork).toBeGreaterThan(15);

    // Then sleep for 3 hours
    for (let i = 0; i < 180; i++) {
      resident.update(2, i % 60);
    }
    expect(resident.needs.fatigue).toBeLessThan(fatigueAfterWork - 20);
  });

  it('social need creeps up when not at home in evenings and relieves at home', () => {
    // Force some time passing at work (social creeps)
    for (let i = 0; i < 60; i++) {
      resident.update(10, i);
    }
    const socialAfterWork = resident.needs.social;

    // Now simulate evening at_home for 30 ticks
    for (let i = 0; i < 30; i++) {
      resident.update(18, i);
    }
    expect(resident.needs.social).toBeLessThan(socialAfterWork);
  });

  it('high hunger causes resident to leave work early (schedule override)', () => {
    // Set hunger to urgent level
    resident.needs.hunger = 75;

    // Time is during work hours
    resident.update(12, 0);
    expect(resident.currentActivity).toBe('at_home'); // skipped/ left work to eat
  });

  it('high fatigue near end of workday forces early sleep (schedule override)', () => {
    resident.needs.fatigue = 90;

    // Just before normal sleep, after work
    resident.update(20, 0); // assume schedule ends work at 17, sleeps 23
    expect(resident.currentActivity).toBe('sleeping');
  });

  it('high social (loneliness) can keep resident at home in the morning', () => {
    resident.needs.social = 85;

    // Morning pre-work window
    resident.update(8, 0); // after wake (7) before workStart(9)
    expect(resident.currentActivity).toBe('at_home');
  });

  it('snapshot includes full needs data for inspectors', () => {
    resident.needs.hunger = 42.7;
    resident.needs.fatigue = 33.9;
    resident.needs.social = 17.2;

    const snap = resident.getSnapshot();
    expect(snap).toHaveProperty('needs');
    expect(snap.needs.hunger).toBe(43);
    expect(snap.needs.fatigue).toBe(34);
    expect(snap.needs.social).toBe(17);
    // Legacy energy still present
    expect(snap).toHaveProperty('energy');
  });

  it('eating simulation reduces hunger when at_home and hungry', () => {
    resident.needs.hunger = 80;
    // Force at_home time
    resident.update(19, 30);
    expect(resident.currentActivity).toBe('at_home');
    expect(resident.needs.hunger).toBeLessThan(80); // eating happened
  });

  // ========== EXPANDED EDGE CASES, SCHEDULE TRANSITIONS, PAYDAY ==========

  it('handles exact boundary transitions correctly (work start)', () => {
    // At exactly workStartHour (9:00) should be working
    resident.update(9, 0);
    expect(resident.currentActivity).toBe('working');

    // One tick before (8:59) should be at_home
    resident.update(8, 59);
    expect(resident.currentActivity).toBe('at_home');
  });

  it('handles exact boundary transitions correctly (sleep start)', () => {
    // At exactly sleepHour (23:00) -> sleeping
    resident.update(23, 0);
    expect(resident.currentActivity).toBe('sleeping');

    // Just before (22:59) -> at_home
    resident.update(22, 59);
    expect(resident.currentActivity).toBe('at_home');
  });

  it('handles exact boundary transitions correctly (work end)', () => {
    // At exactly workEnd (17:00) -> at_home
    resident.update(17, 0);
    expect(resident.currentActivity).toBe('at_home');
  });

  it('receivePayday adds money correctly and can be called multiple times', () => {
    const initial = resident.money;
    resident.receivePayday(100);
    expect(resident.money).toBe(initial + 100);

    resident.receivePayday(50.5);
    expect(resident.money).toBeCloseTo(initial + 150.5, 5);
  });

  it('money never goes negative from any sequence of updates (invariant)', () => {
    // Run through a full simulated day with custom low wage
    const lowWageResident = new Resident({
      id: 'r_low',
      name: 'Low Earner',
      homeId: 'h',
      workId: 'w',
      hourlyWage: 5,
    });
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) { // sample every 5 min
        lowWageResident.update(h, m);
        expect(lowWageResident.money).toBeGreaterThanOrEqual(0);
      }
    }
    expect(lowWageResident.money).toBeGreaterThanOrEqual(0);
  });

  it('supports fully custom schedules and follows them', () => {
    // Note: current schedule logic assumes sleepHour > wakeUpHour (no midnight cross).
    // Spawn logic guarantees this; tests must too.
    const lateRiser = new Resident({
      id: 'r_late',
      name: 'Late Riser',
      homeId: 'h',
      workId: 'w',
      hourlyWage: 22,
      schedule: { wakeUpHour: 10, workStartHour: 12, workEndHour: 20, sleepHour: 23 },
    });

    // During their night (3am < wake) -> sleeping
    lateRiser.update(3, 0);
    expect(lateRiser.currentActivity).toBe('sleeping');

    // Their "work" time (18:30 is during 12-20)
    lateRiser.update(18, 30);
    expect(lateRiser.currentActivity).toBe('working');
  });

  it('needs values are always clamped to [0, 100] even after many ticks', () => {
    for (let i = 0; i < 5000; i++) {
      resident.update((i % 24), (i % 60));
      expect(resident.needs.hunger).toBeGreaterThanOrEqual(0);
      expect(resident.needs.hunger).toBeLessThanOrEqual(100);
      expect(resident.needs.fatigue).toBeGreaterThanOrEqual(0);
      expect(resident.needs.fatigue).toBeLessThanOrEqual(100);
      expect(resident.needs.social).toBeGreaterThanOrEqual(0);
      expect(resident.needs.social).toBeLessThanOrEqual(100);
    }
  });

  it('currentActivity is always a valid Activity type', () => {
    const validActivities: Activity[] = ['sleeping', 'at_home', 'commuting_to_work', 'working', 'commuting_home', 'at_work', 'idle'];
    for (let h = 0; h < 48; h++) { // two days
      resident.update(h % 24, 30);
      expect(validActivities).toContain(resident.currentActivity);
    }
  });

  it('getSnapshot rounds money and needs correctly', () => {
    resident.money = 123.4567;
    resident.needs.hunger = 12.9;
    const snap = resident.getSnapshot();
    expect(snap.money).toBe(123.46);
    expect(snap.needs.hunger).toBe(13);
  });

  it('need override thresholds are respected at exact boundaries', () => {
    // Force a clean pre-work state so previous tests don't pollute hunger.
    resident.needs.hunger = 40;
    resident.update(11, 59);
    resident.needs.hunger = 54.7; // after +rate will be just under threshold
    resident.update(12, 0);
    expect(resident.currentActivity).toBe('working');

    // Cross the threshold
    resident.needs.hunger = 56.0;
    resident.update(12, 0);
    expect(resident.currentActivity).toBe('at_home');
  });

  // ========== EMPLOYMENT INTEGRATION TESTS (Business-Resident deeper linkage) ==========

  it('starts unemployed with null employerId', () => {
    expect(resident.employerId).toBeNull();
    expect(resident.isEmployed()).toBe(false);
    expect(resident.getEmployerId()).toBeNull();
  });

  it('setEmployer to a value marks employed and gives social relief', () => {
    const startSocial = resident.needs.social;
    resident.setEmployer('biz_bakery' as any);
    expect(resident.employerId).toBe('biz_bakery');
    expect(resident.isEmployed()).toBe(true);
    expect(resident.needs.social).toBeLessThan(startSocial); // relief applied
  });

  it('setEmployer to null (firing) applies social stress bump', () => {
    resident.setEmployer('biz_temp' as any);
    const stressedSocial = resident.needs.social;
    resident.setEmployer(null);
    expect(resident.employerId).toBeNull();
    expect(resident.isEmployed()).toBe(false);
    expect(resident.needs.social).toBeGreaterThan(stressedSocial);
  });

  it('snapshot and full JSON roundtrip include employerId', () => {
    resident.setEmployer('biz_42' as any);
    const snap = resident.getSnapshot();
    expect(snap.employerId).toBe('biz_42');
    expect(snap.isEmployed).toBe(true);

    const full = resident.toJSON();
    expect(full.employerId).toBe('biz_42');

    const restored = Resident.fromJSON(full);
    expect(restored.employerId).toBe('biz_42');
    expect(restored.isEmployed()).toBe(true);
  });

  it('setEmployer is idempotent and only triggers effects on actual change', () => {
    resident.setEmployer('same_biz' as any);
    const socialAfterFirst = resident.needs.social;
    resident.setEmployer('same_biz' as any);
    expect(resident.needs.social).toBe(socialAfterFirst);
  });

  // ========== UNEMPLOYMENT MODEL TESTS (visualization + basic job search behavior prep) ==========

  it('starts with unemploymentDurationTicks = 0', () => {
    expect(resident.unemploymentDurationTicks).toBe(0);
  });

  it('updateUnemploymentClock accumulates only while unemployed and resets on hire', () => {
    // Simulate system calling the clock
    resident.updateUnemploymentClock();
    expect(resident.unemploymentDurationTicks).toBe(1);

    resident.updateUnemploymentClock();
    expect(resident.unemploymentDurationTicks).toBe(2);

    // Hire resets
    resident.setEmployer('biz_x' as any);
    expect(resident.unemploymentDurationTicks).toBe(0);

    // Firing + more clock ticks
    resident.setEmployer(null);
    resident.updateUnemploymentClock();
    resident.updateUnemploymentClock();
    expect(resident.unemploymentDurationTicks).toBe(2);
  });

  it('long-term unemployment applies extra social pressure and fatigue in advanceNeeds', () => {
    // Force long unemp state
    resident.setEmployer(null);
    (resident as any).unemploymentDurationTicks = 60 * 20; // 20 hours

    const socialBefore = resident.needs.social;
    const fatigueBefore = resident.needs.fatigue;

    // Advance needs (simulates many ticks)
    for (let i = 0; i < 30; i++) {
      resident.update(10, 0); // daytime non-work for simplicity
    }

    expect(resident.needs.social).toBeGreaterThan(socialBefore + 0.3); // extra creep applied
    expect(resident.needs.fatigue).toBeGreaterThanOrEqual(fatigueBefore); // mild extra fatigue for very long
  });

  it('long-term unemployed gain schedule flexibility (more at_home during work hours)', () => {
    resident.setEmployer(null);
    (resident as any).unemploymentDurationTicks = 60 * 10; // 10h
    resident.needs.social = 50; // above threshold in override

    // During work hours
    resident.update(11, 30); // 11:30am
    expect(resident.currentActivity).toBe('at_home'); // flexibility kicked in
  });

  it('snapshot + JSON roundtrip include unemploymentDurationTicks', () => {
    resident.setEmployer(null);
    (resident as any).unemploymentDurationTicks = 123;
    const snap = resident.getSnapshot();
    // Match the exact rounding used in getSnapshot impl
    const expectedRounded = Math.round((123 / 60) * 10) / 10;
    expect(snap.unemploymentDurationHours).toBe(expectedRounded);

    const full = resident.toJSON();
    expect(full.unemploymentDurationTicks).toBe(123);

    const restored = Resident.fromJSON(full);
    expect(restored.unemploymentDurationTicks).toBe(123);
    expect(restored.isEmployed()).toBe(false);
  });
});
