import { describe, it, expect, beforeEach } from 'vitest';
import { MovementSystem } from './MovementSystem';
import { ResidentsSystem } from './ResidentsSystem';
import { LocationsSystem } from './LocationsSystem';
import { TimeSystem } from '../core/TimeSystem';
import { Resident } from '../entities/Resident';

describe('MovementSystem', () => {
  let time: TimeSystem;
  let residents: ResidentsSystem;
  let locations: LocationsSystem;
  let movement: MovementSystem;

  beforeEach(() => {
    time = new TimeSystem(12345);
    residents = new ResidentsSystem(time);
    locations = new LocationsSystem();
    movement = new MovementSystem(residents, locations, time);
  });

  function addResidentWithIds(id: string, homeId: string, workId: string, activity: string = 'at_home'): Resident {
    const r = new Resident({ id, name: 'Test ' + id, homeId, workId, hourlyWage: 15 });
    r.currentActivity = activity as any;
    r.currentLocationId = homeId;
    residents.addResident(r);
    return r;
  }

  it('initializes without error on empty population', () => {
    expect(() => movement.update()).not.toThrow();
    movement.initializePositions();
  });

  it('snaps positions on initialize when locations exist', () => {
    locations.createHome('h1', 'Home 1', { x: 10, y: 20 });
    locations.createWorkplace('w1', 'Work 1', { x: 80, y: 30 });

    const r = addResidentWithIds('r1', 'h1', 'w1', 'at_home');
    r.currentLocationId = 'h1';

    movement.initializePositions();

    expect(r.position.x).toBeCloseTo(10);
    expect(r.position.y).toBeCloseTo(20);
  });

  it('detects mismatch and starts commuting toward work, updates position over time', () => {
    locations.createHome('home_a', 'A', { x: 0, y: 0 });
    locations.createWorkplace('work_b', 'B', { x: 60, y: 0 });

    const r = addResidentWithIds('r_comm', 'home_a', 'work_b', 'working'); // intent = work
    r.currentLocationId = 'home_a'; // physically still home

    // First update should detect and start commute (travel time depends on estimate ~12 min for dist 60 @5u/m)
    movement.update();

    expect(r.currentActivity).toBe('commuting_to_work');
    expect(r.commuteTargetId).toBe('work_b');
    expect(r.getCommuteProgress(time.tick)).toBeGreaterThanOrEqual(0);

    const startPosX = r.position.x;

    // Advance a few ticks (minutes)
    for (let i = 0; i < 5; i++) {
      time.advanceTick();
      movement.update();
    }

    expect(r.currentActivity).toBe('commuting_to_work');
    expect(r.position.x).toBeGreaterThan(startPosX); // moved toward work
    expect(r.currentLocationId).toBe('home_a'); // not arrived yet
  });

  it('arrives at destination after sufficient ticks, snaps location + position + activity', () => {
    locations.createHome('h', 'H', { x: 5, y: 5 });
    locations.createWorkplace('w', 'W', { x: 5, y: 55 }); // dist=50 -> ~10 min travel

    const r = addResidentWithIds('r_arrive', 'h', 'w', 'working');
    r.currentLocationId = 'h';

    movement.update(); // start commute

    // Advance enough ticks to cover travel + 1
    for (let i = 0; i < 20; i++) {
      time.advanceTick();
      movement.update();
    }

    expect(r.currentLocationId).toBe('w');
    expect(r.currentActivity).toBe('working');
    expect(r.commuteTargetId).toBeNull();
    expect(r.position.x).toBeCloseTo(5);
    expect(r.position.y).toBeCloseTo(55);
  });

  it('handles return commute (commuting_home) symmetrically', () => {
    locations.createHome('home', 'Home', { x: 100, y: 10 });
    locations.createWorkplace('office', 'Office', { x: 0, y: 10 });

    const r = addResidentWithIds('r_back', 'home', 'office', 'at_home');
    r.currentLocationId = 'office'; // left work, heading home

    movement.update();

    expect(r.currentActivity).toBe('commuting_home');
    expect(r.commuteTargetId).toBe('home');

    // Fast forward past travel
    for (let i = 0; i < 25; i++) {
      time.advanceTick();
      movement.update();
    }

    expect(r.currentLocationId).toBe('home');
    expect(r.currentActivity).toBe('at_home');
    expect(r.position.x).toBeCloseTo(100);
  });

  it('uses short default travel when locations missing (graceful compat)', () => {
    const r = addResidentWithIds('r_noloc', 'ghost_home', 'ghost_work', 'working');
    r.currentLocationId = 'ghost_home';

    movement.update();

    // Should have started a very short commute (duration 1)
    expect(r.currentActivity).toBe('commuting_to_work');

    // One more tick should complete it
    time.advanceTick();
    movement.update();

    expect(r.currentLocationId).toBe('ghost_work');
    expect(r.currentActivity).toBe('working');
  });

  it('zero-distance (same loc id) is instant snap, no stuck commute', () => {
    locations.createHome('same', 'Same Place', { x: 42, y: 99 });

    const r = addResidentWithIds('r_same', 'same', 'same', 'at_home');
    r.currentLocationId = 'same';

    movement.update();

    expect(r.currentActivity).toBe('at_home');
    expect(r.position.x).toBeCloseTo(42);
    expect(r.commuteTargetId).toBeNull();
  });

  it('initialize + multiple residents + mixed states works', () => {
    locations.createHome('h1', 'H1', { x: 1, y: 1 });
    locations.createWorkplace('w1', 'W1', { x: 91, y: 1 });
    locations.createHome('h2', 'H2', { x: 2, y: 2 });

    const r1 = addResidentWithIds('r1', 'h1', 'w1', 'working');
    r1.currentLocationId = 'h1';

    const r2 = addResidentWithIds('r2', 'h2', 'w1', 'sleeping');
    r2.currentLocationId = 'h2';

    movement.initializePositions();
    expect(r1.position.x).toBeCloseTo(1);
    expect(r2.position.x).toBeCloseTo(2);

    // r1 should start moving on update
    movement.update();
    expect(r1.currentActivity).toBe('commuting_to_work');
  });

  it('produces smooth eased progress (not just linear raw)', () => {
    locations.createHome('ha', 'HA', { x: 0, y: 0 });
    locations.createWorkplace('wb', 'WB', { x: 100, y: 0 });

    const r = addResidentWithIds('r_ease', 'ha', 'wb', 'working');
    r.currentLocationId = 'ha';

    movement.update();
    const p0 = r.getCommuteProgress(time.tick);

    time.advanceTick();
    movement.update();
    const p1 = r.getCommuteProgress(time.tick);

    // Progress advanced, position moved (easing affects curve but we just sanity check movement happened)
    expect(p1).toBeGreaterThan(p0);
    expect(r.position.x).toBeGreaterThan(0);
  });
});
