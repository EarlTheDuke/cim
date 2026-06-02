/**
 * TrafficSystem
 * 
 * Foundational traffic simulation for CityWithLifeGrok (Phase 3 slice).
 * 
 * Responsibilities:
 * - Owns a simple bidirectional road network (segments between major clusters: residential ↔ downtown/work ↔ industrial).
 * - Manages basic Vehicle entities (cars for personal/commute, trucks for freight) that travel along roads.
 * - Vehicles advance position over simulated time (1 tick ≈ 1 minute) using simple progress + direction model.
 * - Provides time-aware update hook, basic rerouting at "intersections" (endpoint proximity), and observability.
 * - Clean integration: depends only on TimeSystem (ctor injection). Optional LocationsSystem for future dynamic road generation from real home/work clusters.
 * 
 * Design constraints (deliberately foundational):
 * - No A* pathfinding, per-resident ownership, or complex scheduling yet.
 * - Simple traffic lights (2 junctions, 3-phase cycle) + congestion speed impact now added (Agent TL).
 * - Fixed small fleet for determinism and testability (can be extended via spawnVehicle).
 * - Roads, vehicles, lights, stopped state + richer stats fully serializable via getSnapshot().
 * - Extensible: addRoad, removeRoad, getVehiclesOnRoad, etc.
 * 
 * Traffic Model Summary (see final agent report for full details):
 * - Roads: { id, from: Position, to: Position, name? }
 * - Vehicle: id, type ('car'|'truck'), currentRoadId, progress [0,1], direction (±1), purpose ('commute'|'freight'), stopped?
 * - Lights: 2 junctions (center, industrial), 3-phase cycle (green/yellow/red) driven by tick; red halts approaching vehicles.
 * - Advancement: per-tick progress delta = (speed / roadLength) * direction. Now modulated by road density (smarter congestion) + light state.
 * - Behaviors: cars faster + commute bias; trucks slower + freight bias toward industrial roads. Queues form at reds.
 * - Time integration: update() uses TimeSystem.hourOfDay + tick for lights + rush. Full stats: stopped, crossings, avgCongestionFactor.
 * 
 * Integration points:
 * - new TrafficSystem(timeSystem)
 * - sim.registerSystem(trafficSystem)  // or Simulation auto-registers in enhanced ctor
 * - traffic.getSnapshot(), traffic.getAllVehicles(), etc. for UI / renderers / inspectors
 */

import type { TimeSystem } from '../core/TimeSystem';
import type { Position } from '../entities/Location';
import type { LocationsSystem } from './LocationsSystem'; // optional future use

export type VehicleId = string;
export type VehicleType = 'car' | 'truck';
export type VehiclePurpose = 'commute' | 'freight';

export interface Road {
  readonly id: string;
  readonly from: Position;
  readonly to: Position;
  readonly name?: string;
}

export interface VehicleSnapshot {
  id: VehicleId;
  type: VehicleType;
  purpose: VehiclePurpose;
  currentRoadId: string;
  progress: number; // 0..1
  direction: 1 | -1;
  position: Position;
  /** True when held by red light (or extreme congestion) at junction — enables queue viz + stopped counts */
  stopped?: boolean;
}

export interface TrafficSnapshot {
  roadCount: number;
  vehicleCount: number;
  vehiclesByType: { cars: number; trucks: number };
  roads: Road[];
  vehicles: VehicleSnapshot[];
  // Simple density proxy: vehicles per road (foundational congestion signal)
  roadOccupancy: Record<string, number>;
  // === Agent TL additions: traffic lights + richer flow stats (snapshot-friendly, deterministic) ===
  lights: Array<{ id: string; phase: number; position: Position }>; // 0=green, 1=yellow/caution, 2=red
  stoppedVehicleCount: number;
  totalJunctionCrossings: number;
  avgCongestionFactor: number; // 1.0=freeflow, lower=delayed by density (used for observability + future charts)
}

interface InternalVehicle {
  id: VehicleId;
  type: VehicleType;
  purpose: VehiclePurpose;
  currentRoadId: string;
  progress: number;
  direction: 1 | -1;
  speedFactor: number; // cars > trucks
  stopped: boolean; // TL: current tick stopped by light/congestion (for stats + viz)
}

// Reusable lerp helper (pure, no deps)
function lerpPosition(a: Position, b: Position, t: number): Position {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    x: a.x + (b.x - a.x) * clamped,
    y: a.y + (b.y - a.y) * clamped,
  };
}

function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.hypot(dx, dy);
}

export class TrafficSystem {
  private readonly roads: Map<string, Road> = new Map();
  private readonly vehicles: Map<VehicleId, InternalVehicle> = new Map();
  private vehicleCounter = 0;

  // Tunables (kept as private fields for easy future God Mode tweaking)
  private readonly DEFAULT_CAR_SPEED = 1.8; // world units per simulated minute
  private readonly DEFAULT_TRUCK_SPEED = 1.1;
  private readonly REROUTE_CHANCE = 0.35; // at junction, chance to switch roads instead of pure bounce

  // === TL: Simple traffic lights at major junctions (2-3 phase cycle) ===
  private readonly lightStates: Map<string, { phase: 0 | 1 | 2; position: Position }> = new Map();
  private readonly LIGHT_CYCLE_TICKS = 25; // phase advances every 25 ticks (~visible cycle)
  private totalJunctionCrossings = 0;

  constructor(private readonly timeSystem: TimeSystem, private readonly locationsSystem?: LocationsSystem) {
    this.initializeDefaultRoadNetwork();
    this.initializeTrafficLights();
    this.spawnInitialFleet(8); // small deterministic fleet for visual interest + testing
  }

  // === Road Network ===

  /** Add a road segment. Idempotent on duplicate id (warns on overwrite). */
  addRoad(road: Road): void {
    if (this.roads.has(road.id)) {
      console.warn(`[TrafficSystem] Overwriting road "${road.id}"`);
    }
    // Defensive copy of positions
    this.roads.set(road.id, {
      id: road.id,
      from: { x: road.from.x, y: road.from.y },
      to: { x: road.to.x, y: road.to.y },
      name: road.name,
    });
  }

  removeRoad(id: string): boolean {
    // Also remove any vehicles stranded on it (they will be cleaned on next update or via query)
    const hadVehicles = Array.from(this.vehicles.values()).some(v => v.currentRoadId === id);
    if (hadVehicles) {
      for (const [vid, v] of this.vehicles) {
        if (v.currentRoadId === id) this.vehicles.delete(vid);
      }
    }
    return this.roads.delete(id);
  }

  getRoad(id: string): Road | undefined {
    return this.roads.get(id);
  }

  getAllRoads(): Road[] {
    return Array.from(this.roads.values());
  }

  getRoadCount(): number {
    return this.roads.size;
  }

  /**
   * Future hook: rebuild simple cluster-to-cluster roads from actual LocationsSystem data.
   * Currently a no-op if no locations or insufficient data — falls back to defaults.
   * Call after locations are populated for dynamic Phase 3+ worlds.
   */
  rebuildRoadsFromLocations(): void {
    if (!this.locationsSystem) return;

    const homes = this.locationsSystem.getResidentialLocations();
    const works = this.locationsSystem.getWorkplaces();

    if (homes.length === 0 || works.length === 0) return;

    // Compute crude centroids
    const homeCentroid = this.computeCentroid(homes.map(h => h.position));
    const workCentroid = this.computeCentroid(works.map(w => w.position));

    // Clear existing demo roads and install one primary connector (extensible later)
    this.roads.clear();
    this.addRoad({
      id: 'dynamic_home_to_work',
      from: homeCentroid,
      to: workCentroid,
      name: 'Primary Commute Corridor (from Locations)',
    });

    // Add a tiny "loop" stub near work for freight flavor if enough works
    if (works.length >= 2) {
      const offset = { x: workCentroid.x + 8, y: workCentroid.y + 6 };
      this.addRoad({
        id: 'dynamic_work_loop',
        from: workCentroid,
        to: offset,
        name: 'Work Zone Freight Spur',
      });
    }
  }

  private computeCentroid(positions: Position[]): Position {
    if (positions.length === 0) return { x: 50, y: 50 };
    const sumX = positions.reduce((s, p) => s + p.x, 0);
    const sumY = positions.reduce((s, p) => s + p.y, 0);
    return {
      x: sumX / positions.length,
      y: sumY / positions.length,
    };
  }

  // === TL: Traffic Lights initialization + junction helpers (simple, deterministic, snapshotable) ===
  private initializeTrafficLights(): void {
    this.lightStates.clear();
    // Center junction (convergence of res_to_center, center_arterial, industrial_return)
    this.lightStates.set('center_jct', {
      phase: 0,
      position: { x: 50, y: 50 },
    });
    // Industrial junction (center_to_industrial + industrial_return meet)
    this.lightStates.set('industrial_jct', {
      phase: 0,
      position: { x: 76, y: 59 },
    });
  }

  /** Map a road + its current endpoint to a controlled junction id (tuned to default network). */
  private getJunctionForRoadEndpoint(roadId: string, endPos: Position): string | null {
    const eps = 9.5; // tuned to actual endpoint distances (e.g. 42,48 -> 50,50 ~8.2)
    // Center junction approaches
    if ((roadId === 'res_to_center' || roadId === 'center_arterial' || roadId === 'industrial_return') &&
        distance(endPos, { x: 50, y: 50 }) <= eps) {
      return 'center_jct';
    }
    // Industrial junction approaches
    if ((roadId === 'center_to_industrial' || roadId === 'industrial_return') &&
        distance(endPos, { x: 76, y: 59 }) <= eps) {
      return 'industrial_jct';
    }
    return null;
  }

  /** Pure query: is this vehicle currently stopped at a red light? (used for snapshot + stats + viz) */
  private isVehicleStoppedAtLight(v: InternalVehicle): boolean {
    const road = this.roads.get(v.currentRoadId);
    if (!road) return false;
    const approachingEnd = v.direction > 0 ? v.progress > 0.85 : v.progress < 0.15;
    if (!approachingEnd) return false;
    const jid = this.getJunctionForRoadEndpoint(v.currentRoadId, v.direction > 0 ? road.to : road.from);
    if (!jid) return false;
    const light = this.lightStates.get(jid);
    return !!(light && light.phase === 2); // red = stopped
  }

  // === Vehicle Management ===

  private spawnInitialFleet(count: number): void {
    const roadIds = Array.from(this.roads.keys());
    if (roadIds.length === 0) return;

    for (let i = 0; i < count; i++) {
      const type: VehicleType = (i % 3 === 0) ? 'truck' : 'car';
      const purpose: VehiclePurpose = type === 'truck' ? 'freight' : 'commute';
      const roadId = roadIds[i % roadIds.length];
      const progress = (i * 0.17) % 1; // spread them out deterministically
      const direction = (i % 2 === 0) ? 1 : -1 as 1 | -1;

      this.spawnVehicle({
        type,
        purpose,
        roadId,
        progress,
        direction,
      });
    }
  }

  /**
   * Public spawn for tests / God Mode / future dynamic traffic events.
   * Returns the created vehicle id.
   */
  spawnVehicle(params: {
    type?: VehicleType;
    purpose?: VehiclePurpose;
    roadId?: string;
    progress?: number;
    direction?: 1 | -1;
  } = {}): VehicleId {
    const roadIds = Array.from(this.roads.keys());
    if (roadIds.length === 0) {
      throw new Error('[TrafficSystem] Cannot spawn vehicle: no roads exist');
    }

    const id: VehicleId = `veh_${(this.vehicleCounter++).toString().padStart(3, '0')}`;
    const type = params.type ?? ((this.vehicleCounter % 3 === 0) ? 'truck' : 'car');
    const purpose = params.purpose ?? (type === 'truck' ? 'freight' : 'commute');
    const roadId = params.roadId && this.roads.has(params.roadId) ? params.roadId : roadIds[0];
    const progress = Math.max(0, Math.min(1, params.progress ?? 0.1));
    const direction = params.direction ?? 1;

    const speedFactor = type === 'car' ? 1.0 : 0.65;

    const vehicle: InternalVehicle = {
      id,
      type,
      purpose,
      currentRoadId: roadId,
      progress,
      direction,
      speedFactor,
      stopped: false,
    };

    this.vehicles.set(id, vehicle);
    return id;
  }

  removeVehicle(id: VehicleId): boolean {
    return this.vehicles.delete(id);
  }

  getVehicle(id: VehicleId): VehicleSnapshot | undefined {
    const v = this.vehicles.get(id);
    if (!v) return undefined;
    return this.toSnapshot(v);
  }

  getAllVehicles(): VehicleSnapshot[] {
    return Array.from(this.vehicles.values()).map(v => this.toSnapshot(v));
  }

  getVehiclesByType(type: VehicleType): VehicleSnapshot[] {
    return this.getAllVehicles().filter(v => v.type === type);
  }

  getVehiclesOnRoad(roadId: string): VehicleSnapshot[] {
    return this.getAllVehicles().filter(v => v.currentRoadId === roadId);
  }

  getVehicleCount(): number {
    return this.vehicles.size;
  }

  // === Core Simulation Step ===

  /** Called every tick via Simulation (registered system) */
  update(): void {
    if (this.vehicles.size === 0 || this.roads.size === 0) return;

    const hour = this.timeSystem.hourOfDay;
    const tick = this.timeSystem.tick;

    // Light time-of-day flavor (no behavior mutation yet, keeps deterministic & simple)
    // Could slow trucks at night or boost commuter spawns in rush hours in future slices.
    const isRush = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 19);
    const timeMultiplier = isRush ? 1.15 : 1.0; // slight rush "feel" via comment only for v1

    // Advance simple traffic light phases (deterministic from tick)
    for (const [_jid, light] of this.lightStates) {
      light.phase = Math.floor(tick / this.LIGHT_CYCLE_TICKS) % 3 as 0 | 1 | 2;
    }

    // Live road occupancy for congestion calc (cheap O(vehicles))
    const roadCounts = new Map<string, number>();
    for (const v of this.vehicles.values()) {
      roadCounts.set(v.currentRoadId, (roadCounts.get(v.currentRoadId) || 0) + 1);
    }

    for (const vehicle of this.vehicles.values()) {
      this.advanceVehicle(vehicle, timeMultiplier, roadCounts);
    }
  }

  private advanceVehicle(vehicle: InternalVehicle, timeMultiplier: number, roadCounts?: Map<string, number>): void {
    const road = this.roads.get(vehicle.currentRoadId);
    if (!road) {
      // Stranded vehicle — move to first available road
      const firstRoad = Array.from(this.roads.keys())[0];
      if (firstRoad) vehicle.currentRoadId = firstRoad;
      vehicle.stopped = false;
      return;
    }

    const length = distance(road.from, road.to);
    if (length <= 0.0001) {
      vehicle.progress = 0.5;
      vehicle.stopped = false;
      return;
    }

    // Effective speed in world units / tick
    const base = vehicle.type === 'car' ? this.DEFAULT_CAR_SPEED : this.DEFAULT_TRUCK_SPEED;
    let effectiveSpeed = base * vehicle.speedFactor * timeMultiplier;

    // === Smarter Congestion: density reduces speed (graceful, never <25% from cong alone) ===
    const occ = roadCounts ? (roadCounts.get(vehicle.currentRoadId) || 0) : 0;
    const maxDensity = 6; // tuned for demo roads + fleet size
    const density = Math.min(1, occ / maxDensity);
    const congFactor = Math.max(0.28, 1 - density * 0.65);
    effectiveSpeed *= congFactor;

    // === Traffic Light Control: stop (or slow) when approaching red/yellow at controlled junctions ===
    const approachingEnd = vehicle.direction > 0 ? vehicle.progress > 0.82 : vehicle.progress < 0.18;
    if (approachingEnd) {
      const jid = this.getJunctionForRoadEndpoint(vehicle.currentRoadId, vehicle.direction > 0 ? road.to : road.from);
      if (jid) {
        const light = this.lightStates.get(jid);
        if (light) {
          if (light.phase === 2) {
            effectiveSpeed = 0; // hard stop at red -> queues form visibly
          } else if (light.phase === 1) {
            effectiveSpeed *= 0.35; // yellow = caution
          }
          // phase 0 = green: full (cong-reduced) speed
        }
      }
    }

    const delta = (effectiveSpeed / length) * vehicle.direction;
    vehicle.progress += delta;
    vehicle.stopped = (effectiveSpeed < 0.05); // mark for snapshot + viz (red or extreme cong)

    // Endpoint handling + simple network traversal (only if actually advanced)
    if (vehicle.progress >= 1.0) {
      vehicle.progress = 1.0;
      vehicle.direction = -1;
      vehicle.stopped = false;
      this.handleJunction(vehicle, road.to);
    } else if (vehicle.progress <= 0.0) {
      vehicle.progress = 0.0;
      vehicle.direction = 1;
      vehicle.stopped = false;
      this.handleJunction(vehicle, road.from);
    }
  }

  private handleJunction(vehicle: InternalVehicle, junctionPos: Position): void {
    this.totalJunctionCrossings++; // throughput / flow volume metric (cumulative, observable in God Mode)

    const connectedRoads = this.findConnectedRoads(vehicle.currentRoadId, junctionPos);

    if (connectedRoads.length > 0) {
      // Deterministic "randomness" using tick + vehicle id (reproducible across runs with same seed)
      const tick = this.timeSystem.tick;
      const hashSeed = this.simpleHash(vehicle.id + tick.toString());
      const shouldReroute = (hashSeed % 100) < Math.floor(this.REROUTE_CHANCE * 100);

      if (shouldReroute) {
        // Bias freight toward "industrial-ish" roads when possible (name heuristic for demo)
        let candidate = connectedRoads[hashSeed % connectedRoads.length];
        if (vehicle.purpose === 'freight') {
          const freightPrefer = connectedRoads.find(r => /industrial|freight|spur|work/i.test(r.name || r.id));
          if (freightPrefer) candidate = freightPrefer;
        }
        vehicle.currentRoadId = candidate.id;
        // Slight push off the exact endpoint to avoid instant re-flip
        vehicle.progress = vehicle.direction > 0 ? 0.02 : 0.98;
      }
    }
    // Otherwise: pure bounce (direction already flipped by caller)
  }

  /** Very small deterministic hash for reproducible pseudo-random decisions */
  private simpleHash(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return Math.abs(h) >>> 0;
  }

  /** Find other roads whose endpoints are close to the given junction point. */
  private findConnectedRoads(excludeRoadId: string, junction: Position, epsilon = 6.0): Road[] {
    const connected: Road[] = [];
    for (const road of this.roads.values()) {
      if (road.id === excludeRoadId) continue;
      if (distance(road.from, junction) <= epsilon || distance(road.to, junction) <= epsilon) {
        connected.push(road);
      }
    }
    return connected;
  }

  // === Observability & Queries ===

  private toSnapshot(v: InternalVehicle): VehicleSnapshot {
    const road = this.roads.get(v.currentRoadId);
    const pos = road
      ? lerpPosition(road.from, road.to, v.progress)
      : { x: 0, y: 0 };

    return {
      id: v.id,
      type: v.type,
      purpose: v.purpose,
      currentRoadId: v.currentRoadId,
      progress: Number(v.progress.toFixed(4)),
      direction: v.direction,
      position: { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)) },
      stopped: !!v.stopped || this.isVehicleStoppedAtLight(v),
    };
  }

  /** Full serializable state for inspectors, renderers, save/load, debug tools. */
  getSnapshot(): TrafficSnapshot {
    const vehicles = this.getAllVehicles();
    const roadOccupancy: Record<string, number> = {};

    for (const r of this.roads.keys()) {
      roadOccupancy[r] = 0;
    }
    for (const v of vehicles) {
      roadOccupancy[v.currentRoadId] = (roadOccupancy[v.currentRoadId] || 0) + 1;
    }

    const cars = vehicles.filter(v => v.type === 'car').length;
    const trucks = vehicles.length - cars;

    // === TL richer stats computed fresh from current state (cheap, no extra storage) ===
    const stoppedVehicleCount = vehicles.filter(v => v.stopped).length;

    // Compute avg congestion factor from current occupancy (matches advance logic)
    let sumFactor = 0;
    const vcount = vehicles.length || 1;
    for (const v of vehicles) {
      const occ = roadOccupancy[v.currentRoadId] || 0;
      const dens = Math.min(1, occ / 6);
      sumFactor += Math.max(0.28, 1 - dens * 0.65);
    }
    const avgCongestionFactor = sumFactor / vcount;

    return {
      roadCount: this.roads.size,
      vehicleCount: vehicles.length,
      vehiclesByType: { cars, trucks },
      roads: this.getAllRoads(),
      vehicles,
      roadOccupancy,
      lights: Array.from(this.lightStates.entries()).map(([id, st]) => ({
        id,
        phase: st.phase,
        position: { x: Number(st.position.x.toFixed(1)), y: Number(st.position.y.toFixed(1)) },
      })),
      stoppedVehicleCount,
      totalJunctionCrossings: this.totalJunctionCrossings,
      avgCongestionFactor: Number(avgCongestionFactor.toFixed(3)),
    };
  }

  /** Aggregate stats useful for charts / economy / god mode. Now richer with TL signals. */
  getStats() {
    const snap = this.getSnapshot();
    return {
      totalVehicles: snap.vehicleCount,
      cars: snap.vehiclesByType.cars,
      trucks: snap.vehiclesByType.trucks,
      roads: snap.roadCount,
      busiestRoad: Object.entries(snap.roadOccupancy).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      averageVehiclesPerRoad: snap.roadCount > 0 ? snap.vehicleCount / snap.roadCount : 0,
      // TL additions (read-only, snapshot derived)
      stoppedVehicles: snap.stoppedVehicleCount,
      totalCrossings: snap.totalJunctionCrossings,
      avgCongestionFactor: snap.avgCongestionFactor,
    };
  }

  // === Test / Debug Utilities ===

  /** Force a specific vehicle to a road/progress (God Mode / test helper). */
  debugSetVehicleState(id: VehicleId, updates: Partial<{ roadId: string; progress: number; direction: 1 | -1; stopped?: boolean }>): boolean {
    const v = this.vehicles.get(id);
    if (!v) return false;
    if (updates.roadId && this.roads.has(updates.roadId)) v.currentRoadId = updates.roadId;
    if (updates.progress !== undefined) v.progress = Math.max(0, Math.min(1, updates.progress));
    if (updates.direction !== undefined) v.direction = updates.direction;
    if (updates.stopped !== undefined) v.stopped = updates.stopped;
    return true;
  }

  /** Clear all vehicles (tests / reset scenarios) */
  clearVehicles(): void {
    this.vehicles.clear();
    this.vehicleCounter = 0;
  }

  /** Reset entire traffic state (primarily tests) */
  reset(): void {
    this.roads.clear();
    this.vehicles.clear();
    this.vehicleCounter = 0;
    this.totalJunctionCrossings = 0;
    this.initializeDefaultRoadNetwork();
    this.initializeTrafficLights();
    this.spawnInitialFleet(8);
  }

  // === Private init ===

  private initializeDefaultRoadNetwork(): void {
    // Foundational network: residential cluster (left) <-> work/downtown (center) <-> industrial (right)
    // Coordinates chosen to roughly align with CityRenderer world 0-100 and Location clusters.
    this.addRoad({
      id: 'res_to_center',
      from: { x: 18, y: 38 },
      to: { x: 42, y: 48 },
      name: 'Residential Connector',
    });
    this.addRoad({
      id: 'center_arterial',
      from: { x: 42, y: 48 },
      to: { x: 58, y: 51 },
      name: 'Main Arterial',
    });
    this.addRoad({
      id: 'center_to_industrial',
      from: { x: 58, y: 51 },
      to: { x: 82, y: 62 },
      name: 'Industrial Spur',
    });
    // Bonus cross / return flavor road for more interesting network traversal
    this.addRoad({
      id: 'industrial_return',
      from: { x: 82, y: 62 },
      to: { x: 55, y: 55 },
      name: 'Return Corridor',
    });
  }
}
