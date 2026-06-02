/**
 * LocationsSystem
 * 
 * Core spatial world manager for CityWithLifeGrok.
 * 
 * Responsibilities (foundational Phase 2 slice):
 * - Register and own all Location entities in the world.
 * - Provide lookup by ID and filtered queries (by type).
 * - Support assignment of residents to homes/workplaces via validation helpers
 *   (actual assignment mutates Resident.homeId/workId — this system only validates).
 * - Basic spatial queries: Euclidean distance + radius search (foundation for movement).
 * - Designed to scale toward grid/road/pathfinding/zoning without API breakage.
 * 
 * Non-responsibilities (deliberately out of scope for this slice):
 * - Tracking current resident positions or movement simulation (future MovementSystem).
 * - Maintaining bidirectional occupancy lists (can be derived or added later).
 * - Path costs, roads, vehicles, traffic (Phase 3).
 * - Economic properties of locations (Phase 4+).
 * 
 * Integration notes:
 * - Owned by Simulation (like ResidentsSystem).
 * - Residents continue to hold homeId / workId / currentLocationId as LocationId (string).
 * - String IDs remain valid even if a Location is not yet registered (supports incremental adoption + tests).
 */

import { Location, type LocationId, type LocationType, type Position, type LocationState, createHome, createWorkplace } from '../entities/Location';

export interface LocationQueryOptions {
  type?: LocationType;
  /** Only return locations whose type makes them valid homes */
  residentialOnly?: boolean;
  /** Only return locations whose type makes them valid workplaces */
  workplaceOnly?: boolean;
}

export class LocationsSystem {
  private readonly locations: Map<LocationId, Location> = new Map();

  constructor() {
    // No RNG stored — generation/positioning is caller-driven (Simulation uses its own seeded RNG)
  }

  // === Registration ===

  /** Register a new location. Idempotent if same instance already registered. */
  registerLocation(location: Location): void {
    const existing = this.locations.get(location.id);
    if (existing && existing !== location) {
      // Allow re-register of identical id only if it's the exact same object (defensive)
      console.warn(`[LocationsSystem] Overwriting location with id "${location.id}"`);
    }
    this.locations.set(location.id, location);
  }

  /** Bulk register (convenience) */
  registerLocations(locations: Location[]): void {
    for (const loc of locations) {
      this.registerLocation(loc);
    }
  }

  // === Lookups ===

  getLocation(id: LocationId): Location | undefined {
    return this.locations.get(id);
  }

  hasLocation(id: LocationId): boolean {
    return this.locations.has(id);
  }

  getAllLocations(): Location[] {
    return Array.from(this.locations.values());
  }

  getLocationsByType(type: LocationType): Location[] {
    return this.getAllLocations().filter(l => l.type === type);
  }

  queryLocations(options: LocationQueryOptions = {}): Location[] {
    let result = this.getAllLocations();

    if (options.type) {
      result = result.filter(l => l.type === options.type);
    }
    if (options.residentialOnly) {
      result = result.filter(l => l.isResidential());
    }
    if (options.workplaceOnly) {
      result = result.filter(l => l.isWorkplace());
    }
    return result;
  }

  getResidentialLocations(): Location[] {
    return this.queryLocations({ residentialOnly: true });
  }

  getWorkplaces(): Location[] {
    return this.queryLocations({ workplaceOnly: true });
  }

  // === Assignment helpers (validation only — no mutation of residents) ===

  /**
   * Can this location serve as a home for a resident?
   * Used by spawning / assignment logic and God Mode tools.
   */
  isValidHome(locationId: LocationId): boolean {
    const loc = this.getLocation(locationId);
    return !!loc && loc.isResidential();
  }

  /**
   * Can this location serve as a workplace?
   */
  isValidWorkplace(locationId: LocationId): boolean {
    const loc = this.getLocation(locationId);
    return !!loc && loc.isWorkplace();
  }

  /**
   * Suggest a home for assignment. Simple round-robin / first-available heuristic.
   * Does not track current occupancy counts (future: pass occupancy map or derive from residents).
   * Returns undefined if no valid homes exist.
   */
  findAvailableHome(preferCapacity: boolean = true): Location | undefined {
    const homes = this.getResidentialLocations();
    if (homes.length === 0) return undefined;

    if (!preferCapacity) return homes[0];

    // Prefer homes that still have declared capacity headroom (if capacity known)
    const withCapacity = homes.filter(h => h.capacity === undefined || h.capacity > 0);
    return (withCapacity.length > 0 ? withCapacity[0] : homes[0]);
  }

  /**
   * Suggest a workplace. Similar simple heuristic.
   */
  findAvailableWorkplace(): Location | undefined {
    const workplaces = this.getWorkplaces();
    return workplaces.length > 0 ? workplaces[0] : undefined;
  }

  // === Housing Market (rent + vacancy) helpers (Wave 3 HM lightweight foundation) ===

  /**
   * Returns monthly rent for a residential location.
   * Uses explicit baseRent if set on the Location, otherwise a sensible default
   * scaled by capacity (larger households = lower per-person effective rent).
   */
  getMonthlyRent(homeId: LocationId): number {
    const loc = this.getLocation(homeId);
    if (!loc || !loc.isResidential()) return 0;
    if (loc.baseRent !== undefined && loc.baseRent > 0) {
      return loc.baseRent;
    }
    const cap = loc.capacity ?? 3;
    // Default: ~$40 base scaled inversely by capacity (affordable family homes cheaper per slot)
    return Math.max(10, Math.round((48 / Math.max(1, cap)) * 2.5));
  }

  /**
   * Returns the effective (market) monthly rent incorporating free-market occupancy/vacancy pressure.
   * Rents rise when a home is highly occupied (demand pressure in popular areas),
   * fall when vacant. AI home_target decisions (via ctx) now see live price signals
   * with real econ consequences (move to save on underpriced, pay premium for hot spots).
   * Non-breaking: getMonthlyRent stays as pure base/list rent.
   * Formula uses currentOccupants (kept live by ResidentsSystem) for supply/demand.
   * This satisfies free markets (price discovery from occupancy supply/demand).
   */
  getEffectiveMonthlyRent(homeId: LocationId): number {
    const base = this.getMonthlyRent(homeId);
    const loc = this.getLocation(homeId);
    if (!loc || !loc.isResidential() || base <= 0) return base;
    const occ = Math.max(0, loc.currentOccupants || 0);
    const cap = Math.max(1, loc.capacity ?? 3);
    const pressure = Math.min(1, occ / cap); // 0 (vacant opportunity) .. 1 (full/hot)
    const multiplier = 1 + 0.8 * pressure; // ~1.0x empty -> ~1.8x at capacity
    return Math.max(5, Math.round(base * multiplier));
  }

  /**
   * Returns normalized housing market pressure 0-1 for AI signals (0=vacant/cheap, 1=full/premium).
   */
  getHousingMarketPressure(homeId: LocationId): number {
    const loc = this.getLocation(homeId);
    if (!loc || !loc.isResidential()) return 0;
    const occ = Math.max(0, loc.currentOccupants || 0);
    const cap = Math.max(1, loc.capacity ?? 3);
    return Math.min(1, occ / cap);
  }

  /**
   * Given a map of current occupants per home (authoritative source: ResidentsSystem),
   * returns residential locations that have vacancy (current < capacity or no cap limit).
   * Can filter + sort by rent affordability.
   */
  findVacantHomes(
    occupancy: Record<LocationId, number> | Map<LocationId, number>,
    options: { sortByRent?: boolean; maxRent?: number } = {}
  ): Location[] {
    const homes = this.getResidentialLocations();
    const getOcc = (id: LocationId): number => {
      if (occupancy instanceof Map) return occupancy.get(id) ?? 0;
      return (occupancy as Record<LocationId, number>)[id] ?? 0;
    };

    let candidates = homes.filter((h) => {
      const occ = getOcc(h.id);
      const cap = h.capacity ?? Number.POSITIVE_INFINITY;
      return occ < cap;
    });

    if (options.maxRent !== undefined && options.maxRent > 0) {
      candidates = candidates.filter((h) => this.getMonthlyRent(h.id) <= options.maxRent!);
    }

    if (options.sortByRent) {
      candidates = [...candidates].sort((a, b) => this.getMonthlyRent(a.id) - this.getMonthlyRent(b.id));
    }

    return candidates;
  }

  /**
   * Convenience wrapper for housing pressure logic: finds the cheapest vacant homes
   * affordable under a max rent budget (used by ResidentsSystem reassignments).
   */
  findAffordableVacantHomes(
    occupancy: Record<LocationId, number> | Map<LocationId, number>,
    maxRent: number = 120
  ): Location[] {
    return this.findVacantHomes(occupancy, { sortByRent: true, maxRent });
  }

  // === Basic car/transport market price signals (additive for CIM real-world fidelity) ===
  // Voluntary acquire decision uses this as "available" price in ctx.
  // Enables market reallocation of "fast transport" value (buy/sell changes who has shorter commutes + earnings opp).
  // Small variance for different "deals" without complex inventory.

  /**
   * Base market price for a personal vehicle/transport (additive).
   * Stable signal ~240 so AI ctx can weigh cost vs time-save benefit.
   */
  getBaseCarMarketPrice(): number {
    return 240;
  }

  /**
   * Available car market price (with tiny deterministic variant per caller for "different lots").
   * Exposed in ResidentContext for acquire decisions + rig self-checks.
   */
  getAvailableCarMarketPrice(variantSeed: number = 0): number {
    const base = this.getBaseCarMarketPrice();
    const varn = Math.abs(variantSeed % 7) * 8; // 0..48 spread, realistic deal variance
    return base + varn;
  }

  // === Simple dynamic food/grocery market helper (additive CIM real-world fidelity) ===
  // Base price + small variance (pressure/drama callers can modulate for ctx signals).
  // Exposed to ResidentContext as foodPriceSignal + foodReliefPotential so brains can decide 'purchase_food'
  // when hunger high + price vs dailyPotential makes sense (voluntary money sink + strong relief).
  // For now simple variance (free market price signal + agent demand modulation later).
  getBaseFoodPrice(): number {
    return 4.5;
  }
  getFoodMarketInfo(variantSeed: number = 0, dramaFactor: number = 0): { basePrice: number; availableFoodPrice: number; foodReliefPotential: number } {
    const base = this.getBaseFoodPrice();
    const varn = (Math.abs(variantSeed % 5) - 2) * 0.4; // small -0.8..+0.8 realistic spread
    const dramaAdj = Math.max(-0.8, Math.min(1.2, (dramaFactor || 0) * 0.9)); // e.g. hostile events can nudge price
    const price = Math.max(2.8, Math.round((base + varn + dramaAdj) * 10) / 10);
    const relief = 6.2 + (dramaAdj > 0.3 ? -0.4 : 0.6); // slight relief variance
    return { basePrice: base, availableFoodPrice: price, foodReliefPotential: Math.round(relief * 10) / 10 };
  }

  // === Spatial Queries ===

  /** Euclidean distance between two registered locations. Returns Infinity if either missing. */
  distanceBetween(a: LocationId, b: LocationId): number {
    const la = this.getLocation(a);
    const lb = this.getLocation(b);
    if (!la || !lb) return Infinity;
    return la.distanceTo(lb);
  }

  /**
   * Find all locations within a given radius of a center point (or registered location).
   * Results are unsorted; includes the center itself if center is a LocationId.
   */
  findNearby(center: LocationId | Position, radius: number, options: LocationQueryOptions = {}): Location[] {
    if (radius < 0) return [];

    let cx: number, cy: number;

    if (typeof (center as any).x === 'number' && typeof (center as any).y === 'number') {
      const p = center as Position;
      cx = p.x;
      cy = p.y;
    } else {
      const loc = this.getLocation(center as LocationId);
      if (!loc) return [];
      cx = loc.position.x;
      cy = loc.position.y;
    }

    const candidates = this.queryLocations(options);

    return candidates.filter(loc => {
      const dx = loc.position.x - cx;
      const dy = loc.position.y - cy;
      return Math.hypot(dx, dy) <= radius;
    });
  }

  /** Estimate naive travel time in simulated minutes (foundation for movement). */
  estimateTravelTimeMinutes(distance: number, options?: { speedUnitsPerMinute?: number }): number {
    const speed = options?.speedUnitsPerMinute ?? 5; // default "units" per simulated minute (tunable later)
    if (distance <= 0 || speed <= 0) return 0;
    return Math.ceil(distance / speed);
  }

  // === Utility ===

  getLocationCount(): number {
    return this.locations.size;
  }

  /** Full serializable snapshot (for save/load, inspectors, debug) */
  getSnapshot() {
    return {
      count: this.locations.size,
      locations: this.getAllLocations().map(l => l.getSnapshot()),
    };
  }

  // === Factories (delegated for ergonomics) ===

  /** Create + register a residential home in one call. */
  createHome(id: LocationId, name: string, position: Position, capacity?: number, baseRent?: number): Location {
    const loc = createHome(id, name, position, capacity, baseRent);
    this.registerLocation(loc);
    return loc;
  }

  /** Create + register a workplace in one call. */
  createWorkplace(
    id: LocationId,
    name: string,
    position: Position,
    type: 'commercial' | 'industrial' = 'commercial',
    capacity?: number
  ): Location {
    const loc = createWorkplace(id, name, position, type, capacity);
    this.registerLocation(loc);
    return loc;
  }

  /** Remove a location (rarely needed; useful for tests or dynamic world changes) */
  removeLocation(id: LocationId): boolean {
    return this.locations.delete(id);
  }

  /** Clear all (primarily for tests) */
  clear(): void {
    this.locations.clear();
  }

  // === Full State Restore for Scenarios / Save-Load ===

  /**
   * Replace all locations from saved state array.
   * Returns count loaded. Critical for loading custom scenarios or saved simulations.
   */
  loadFromStates(states: LocationState[]): number {
    this.clear();
    let count = 0;
    for (const s of states) {
      try {
        const loc = Location.fromJSON(s);
        this.registerLocation(loc);
        count++;
      } catch (e) {
        console.warn('[LocationsSystem] Skipped bad location in loadFromStates', e);
      }
    }
    return count;
  }

  /** Return full serializable location states (used by Simulation for scenarios) */
  getFullStates(): LocationState[] {
    return this.getAllLocations().map(l => l.toJSON());
  }
}
