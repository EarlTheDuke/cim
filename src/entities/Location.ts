/**
 * Location Entity
 * 
 * Foundational spatial model for CityWithLifeGrok (Phase 2 foundation).
 * 
 * Design goals (per task):
 * - Simple but extensible for future movement, traffic, zoning, pathfinding.
 * - Named locations with explicit types (Residential for homes, Commercial/Industrial for workplaces).
 * - 2D positions for basic spatial queries (distance, nearby).
 * - Capacity for occupancy planning (homes: households, workplaces: employees).
 * - Serializable by default.
 * - No coupling to Residents or Businesses yet — IDs are referenced from those entities.
 * 
 * Future extensions (not implemented here):
 * - Full zone/road graph
 * - Building footprints / size
 * - Dynamic properties (e.g. rent, appeal, inventory stock for commercial)
 * - Pathfinding cost / travel time modifiers (weather, congestion)
 */

export type LocationId = string;

export type LocationType =
  | 'residential'      // Homes, apartments — where residents live
  | 'commercial'       // Shops, offices, services — workplaces
  | 'industrial'       // Factories, mines, farms — workplaces (resource production)
  | 'mixed_use'        // Hybrid (live + work possible)
  | 'public_service';  // Schools, hospitals, parks, government (future)

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface LocationState {
  id: LocationId;
  name: string;
  type: LocationType;
  position: Position;
  capacity?: number;
  /** Optional base monthly rent for residential homes (housing market foundation) */
  baseRent?: number;
  /** Optional runtime occupant count (maintained by ResidentsSystem on home reassignments; supports vacancy tracking) */
  currentOccupants?: number;
}

export class Location {
  public readonly id: LocationId;
  public name: string;
  public readonly type: LocationType;
  public position: Position;
  public capacity?: number;

  /** Base monthly rent (primarily for residential homes). Part of housing market basics. */
  public baseRent?: number;
  /** Current number of residents assigned to this home (for vacancy/pressure calcs + viz). Updated by ResidentsSystem. */
  public currentOccupants: number = 0;

  constructor(params: {
    id: LocationId;
    name: string;
    type: LocationType;
    position: Position;
    capacity?: number;
    baseRent?: number;
    currentOccupants?: number;
  }) {
    if (!params.id || params.id.trim() === '') {
      throw new Error('Location id cannot be empty');
    }
    this.id = params.id;
    this.name = params.name;
    this.type = params.type;
    // Defensive copy
    this.position = { x: params.position.x, y: params.position.y };
    if (params.capacity !== undefined) {
      if (params.capacity < 0) throw new Error('Capacity cannot be negative');
      this.capacity = params.capacity;
    }
    if (params.baseRent !== undefined) {
      if (params.baseRent < 0) throw new Error('baseRent cannot be negative');
      this.baseRent = params.baseRent;
    }
    if (params.currentOccupants !== undefined) {
      this.currentOccupants = Math.max(0, params.currentOccupants);
    }
  }

  /** Returns a plain serializable snapshot */
  getSnapshot(): LocationState {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      position: { ...this.position },
      ...(this.capacity !== undefined ? { capacity: this.capacity } : {}),
      ...(this.baseRent !== undefined ? { baseRent: this.baseRent } : {}),
      ...(this.currentOccupants !== undefined && this.currentOccupants > 0 ? { currentOccupants: this.currentOccupants } : {}),
    };
  }

  /** Alias for full state serialization (scenario/save support) */
  toJSON(): LocationState {
    return this.getSnapshot();
  }

  /**
   * Reconstruct a Location from saved JSON / snapshot data.
   * Used by Scenario Tools and Simulation.load for full state restoration.
   */
  static fromJSON(data: LocationState): Location {
    if (!data || !data.id) throw new Error('Invalid location data for fromJSON');
    return new Location({
      id: data.id,
      name: data.name ?? data.id,
      type: data.type,
      position: data.position,
      capacity: data.capacity,
      baseRent: data.baseRent,
      currentOccupants: data.currentOccupants,
    });
  }

  /** Euclidean distance to another Location or arbitrary Position */
  distanceTo(other: Location | Position): number {
    const otherPos = 'position' in other ? other.position : other;
    const dx = this.position.x - otherPos.x;
    const dy = this.position.y - otherPos.y;
    return Math.hypot(dx, dy);
  }

  /** Convenience: is this a place residents can live? */
  isResidential(): boolean {
    return this.type === 'residential' || this.type === 'mixed_use';
  }

  /** Convenience: is this a place residents can work? */
  isWorkplace(): boolean {
    return (
      this.type === 'commercial' ||
      this.type === 'industrial' ||
      this.type === 'mixed_use' ||
      this.type === 'public_service'
    );
  }
}

/** Factory helpers for common location creation (keeps call sites clean) */
export function createHome(
  id: LocationId,
  name: string,
  position: Position,
  capacity: number = 3, // e.g. 3 residents per household default
  baseRent?: number
): Location {
  return new Location({
    id,
    name,
    type: 'residential',
    position,
    capacity,
    baseRent,
  });
}

export function createWorkplace(
  id: LocationId,
  name: string,
  position: Position,
  type: 'commercial' | 'industrial' = 'commercial',
  capacity: number = 8
): Location {
  return new Location({
    id,
    name,
    type,
    position,
    capacity,
  });
}
