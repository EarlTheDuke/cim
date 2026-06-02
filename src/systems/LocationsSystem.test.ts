import { describe, it, expect, beforeEach } from 'vitest';
import { LocationsSystem } from './LocationsSystem';
import { Location, createHome, createWorkplace, type Position } from '../entities/Location';

describe('LocationsSystem', () => {
  let system: LocationsSystem;

  beforeEach(() => {
    system = new LocationsSystem();
  });

  it('starts empty', () => {
    expect(system.getLocationCount()).toBe(0);
    expect(system.getAllLocations()).toHaveLength(0);
  });

  it('can register and retrieve locations', () => {
    const home = createHome('home_1', 'Oak Street House', { x: 10, y: 20 });
    system.registerLocation(home);

    expect(system.getLocationCount()).toBe(1);
    expect(system.getLocation('home_1')).toBe(home);
    expect(system.hasLocation('home_1')).toBe(true);
  });

  it('supports bulk registration', () => {
    const locs = [
      createHome('h1', 'H1', { x: 0, y: 0 }),
      createWorkplace('w1', 'W1', { x: 50, y: 10 }, 'commercial'),
    ];
    system.registerLocations(locs);
    expect(system.getLocationCount()).toBe(2);
  });

  it('filters by type and convenience queries', () => {
    system.createHome('h1', 'Home 1', { x: 0, y: 0 });
    system.createWorkplace('c1', 'Shop', { x: 100, y: 0 }, 'commercial');
    system.createWorkplace('i1', 'Mine', { x: 200, y: 0 }, 'industrial');

    const homes = system.getResidentialLocations();
    expect(homes.length).toBe(1);

    const workplaces = system.getWorkplaces();
    expect(workplaces.length).toBe(2);

    const commercial = system.getLocationsByType('commercial');
    expect(commercial.length).toBe(1);
  });

  it('queryLocations supports combined filters', () => {
    system.createHome('h1', 'H', { x: 0, y: 0 });
    system.createWorkplace('c1', 'C', { x: 10, y: 0 }, 'commercial');
    const residentialOnly = system.queryLocations({ residentialOnly: true });
    expect(residentialOnly).toHaveLength(1);
    expect(residentialOnly[0].id).toBe('h1');

    const workplaceOnly = system.queryLocations({ workplaceOnly: true });
    expect(workplaceOnly).toHaveLength(1);
  });

  // === Assignment validation ===

  it('validates homes vs workplaces correctly', () => {
    system.createHome('home_a', 'Apartment', { x: 0, y: 0 });
    system.createWorkplace('shop_1', 'Corner Store', { x: 40, y: 5 });

    expect(system.isValidHome('home_a')).toBe(true);
    expect(system.isValidHome('shop_1')).toBe(false);

    expect(system.isValidWorkplace('shop_1')).toBe(true);
    expect(system.isValidWorkplace('home_a')).toBe(false);

    expect(system.isValidHome('nonexistent')).toBe(false);
  });

  it('findAvailableHome and findAvailableWorkplace return sensible defaults', () => {
    expect(system.findAvailableHome()).toBeUndefined();
    expect(system.findAvailableWorkplace()).toBeUndefined();

    system.createHome('h1', 'H1', { x: 0, y: 0 }, 4);
    system.createWorkplace('w1', 'W1', { x: 30, y: 0 });

    expect(system.findAvailableHome()?.id).toBe('h1');
    expect(system.findAvailableWorkplace()?.id).toBe('w1');
  });

  // === Spatial ===

  it('computes Euclidean distance between locations', () => {
    system.createHome('a', 'A', { x: 0, y: 0 });
    system.createWorkplace('b', 'B', { x: 30, y: 40 });

    expect(system.distanceBetween('a', 'b')).toBeCloseTo(50, 5); // 3-4-5 triangle
    expect(system.distanceBetween('a', 'missing')).toBe(Infinity);
  });

  it('Location.distanceTo works directly', () => {
    const loc = new Location({ id: 'l', name: 'L', type: 'residential', position: { x: 0, y: 0 } });
    expect(loc.distanceTo({ x: 3, y: 4 })).toBeCloseTo(5);
    expect(loc.distanceTo(loc)).toBe(0);
  });

  it('findNearby returns locations inside radius (and handles Position centers)', () => {
    system.createHome('h0', 'Center', { x: 0, y: 0 });
    system.createWorkplace('w1', 'Near', { x: 8, y: 0 });
    system.createWorkplace('w2', 'Far', { x: 30, y: 0 });

    const nearby = system.findNearby('h0', 10);
    expect(nearby.map(l => l.id).sort()).toEqual(['h0', 'w1']);

    // Using raw position as center
    const nearbyFromPos = system.findNearby({ x: 5, y: 0 } as Position, 6);
    expect(nearbyFromPos.length).toBe(2); // h0 and w1
  });

  it('findNearby respects type filters', () => {
    system.createHome('h1', 'H', { x: 0, y: 0 });
    system.createWorkplace('c1', 'C', { x: 5, y: 0 }, 'commercial');
    system.createWorkplace('i1', 'I', { x: 6, y: 1 }, 'industrial');

    const nearbyWork = system.findNearby('h1', 10, { workplaceOnly: true });
    expect(nearbyWork).toHaveLength(2);
  });

  it('estimateTravelTimeMinutes gives reasonable foundation numbers', () => {
    expect(system.estimateTravelTimeMinutes(25, { speedUnitsPerMinute: 5 })).toBe(5);
    expect(system.estimateTravelTimeMinutes(0)).toBe(0);
    expect(system.estimateTravelTimeMinutes(12)).toBeGreaterThan(0);
  });

  // === Factories on system ===

  it('createHome and createWorkplace register automatically', () => {
    const h = system.createHome('hh', 'My House', { x: 12, y: 34 }, 2);
    expect(system.getLocation('hh')).toBe(h);
    expect(h.type).toBe('residential');
    expect(h.capacity).toBe(2);

    const w = system.createWorkplace('ww', 'Factory', { x: 99, y: 1 }, 'industrial', 25);
    expect(system.getLocation('ww')).toBe(w);
    expect(w.isWorkplace()).toBe(true);
  });

  // === Snapshot & misc ===

  it('produces usable snapshots', () => {
    system.createHome('s1', 'Snap Home', { x: 1, y: 2 });
    const snap = system.getSnapshot();
    expect(snap.count).toBe(1);
    expect(snap.locations[0].id).toBe('s1');
    expect(snap.locations[0].position).toEqual({ x: 1, y: 2 });
  });

  it('removeLocation and clear work for testing / dynamic use', () => {
    system.createHome('temp', 'Temp', { x: 0, y: 0 });
    expect(system.hasLocation('temp')).toBe(true);
    expect(system.removeLocation('temp')).toBe(true);
    expect(system.hasLocation('temp')).toBe(false);

    system.clear();
    expect(system.getLocationCount()).toBe(0);
  });

  it('gracefully handles string IDs that are not registered (compat with pre-location code)', () => {
    // This is critical: old code using 'home_1' strings still works
    expect(system.getLocation('home_1')).toBeUndefined();
    expect(system.isValidHome('home_1')).toBe(false);
    expect(system.distanceBetween('home_1', 'work_1')).toBe(Infinity);
  });

  // === Housing market basics (rent + vacancy queries) ===

  it('getMonthlyRent returns explicit baseRent or sensible default', () => {
    system.createHome('h_cheap', 'Cheap', { x: 0, y: 0 }, 4, 25);
    system.createHome('h_rich', 'Rich', { x: 10, y: 10 }, 2, 80);
    system.createHome('h_def', 'Defaulted', { x: 20, y: 20 }, 3);

    expect(system.getMonthlyRent('h_cheap')).toBe(25);
    expect(system.getMonthlyRent('h_rich')).toBe(80);
    expect(system.getMonthlyRent('h_def')).toBeGreaterThanOrEqual(10);
    expect(system.getMonthlyRent('nonexistent')).toBe(0);
    expect(system.getMonthlyRent('h_cheap')).toBeLessThan(system.getMonthlyRent('h_rich'));
  });

  it('findVacantHomes and findAffordableVacantHomes respect occupancy + rent caps', () => {
    system.createHome('ha', 'A', { x: 0, y: 0 }, 2, 30);
    system.createHome('hb', 'B', { x: 5, y: 0 }, 3, 50);
    system.createHome('hc', 'C', { x: 10, y: 0 }, 1, 90);

    const occ: Record<string, number> = { ha: 2, hb: 1, hc: 0 }; // ha full, hb half, hc vacant

    const allVacant = system.findVacantHomes(occ);
    expect(allVacant.length).toBe(2);
    expect(allVacant.map(l => l.id).sort()).toEqual(['hb', 'hc']);

    const cheapOnly = system.findAffordableVacantHomes(occ, 45);
    expect(cheapOnly.length).toBe(0); // hb rent=50 >45 budget

    const budget = system.findAffordableVacantHomes(occ, 95);
    expect(budget.length).toBe(2);

    const sorted = system.findVacantHomes(occ, { sortByRent: true });
    // ha full (skipped); hb (50) cheaper than hc (90) -> first vacant cheapest
    expect(sorted[0].id).toBe('hb');
  });

  it('Location serializes baseRent and currentOccupants roundtrip', () => {
    const h = system.createHome('hsnap', 'SnapHome', { x: 1, y: 2 }, 3, 42);
    h.currentOccupants = 2;
    const snap = h.getSnapshot();
    expect(snap.baseRent).toBe(42);
    expect(snap.currentOccupants).toBe(2);

    const restored = Location.fromJSON(snap);
    expect(restored.baseRent).toBe(42);
    expect(restored.currentOccupants).toBe(2);
  });
});
