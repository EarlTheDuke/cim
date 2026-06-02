/**
 * MovementSystem
 * 
 * Basic time-based movement for residents commuting between home and work.
 * 
 * - On each update, detects when a resident's "desired" location (from schedule intent)
 *   differs from their current physical location.
 * - Calculates travel duration using LocationsSystem positions + estimateTravelTimeMinutes.
 * - Uses simple eased interpolation to update resident.position over the travel duration.
 * - Manages 'commuting_to_work' / 'commuting_home' activity states during transit.
 * - Snaps currentLocationId + position + final activity upon arrival.
 * - Fully compatible with existing Resident activity states and ResidentsSystem.
 * - Works even when LocationsSystem has no data for a resident's IDs (graceful instant or short travel).
 * - Deterministic given positions and tick timing.
 * 
 * Designed to be registered via Simulation.registerSystem().
 * No rendering, no DOM, pure simulation logic.
 */

import type { ResidentsSystem } from './ResidentsSystem';
import type { LocationsSystem } from './LocationsSystem';
import type { TimeSystem } from '../core/TimeSystem';
import type { Resident } from '../entities/Resident';
import type { Position, LocationId } from '../entities/Location';

export class MovementSystem {
  constructor(
    private readonly residentsSystem: ResidentsSystem,
    private readonly locationsSystem: LocationsSystem,
    private readonly timeSystem: TimeSystem
  ) {}

  /** Called every simulation tick via Simulation step loop */
  update(): void {
    for (const resident of this.residentsSystem.getAllResidents()) {
      this.processResidentMovement(resident);
    }
  }

  /**
   * Snap all current residents' positions to their currentLocationId (if the location
   * is registered). Safe to call after spawn or when locations are bulk-registered.
   */
  initializePositions(): void {
    for (const resident of this.residentsSystem.getAllResidents()) {
      this.snapToCurrentLocation(resident);
    }
  }

  // === Core per-resident logic ===

  private processResidentMovement(resident: Resident): void {
    // Defensive: ensure position always exists
    if (!resident.position || typeof resident.position.x !== 'number' || typeof resident.position.y !== 'number') {
      resident.position = { x: 0, y: 0 };
    }

    const currentTick = this.timeSystem.tick;
    const desiredId = this.getDesiredLocationId(resident);

    // Already at the right place physically?
    if (resident.currentLocationId === desiredId) {
      if (resident.commuteTargetId) {
        resident.arrive();
      }
      this.snapToCurrentLocation(resident);
      return;
    }

    // We need to be somewhere else — ensure we have an active commute toward desired
    const fromId = resident.currentLocationId;
    const targetId = desiredId;

    if (resident.commuteTargetId !== targetId) {
      // (Re)start commute for this target
      const dist = this.locationsSystem.distanceBetween(fromId, targetId);
      let travelMinutes = 0;
      if (isFinite(dist) && dist > 0) {
        travelMinutes = this.locationsSystem.estimateTravelTimeMinutes(dist);
      }
      // Fuller first-class vehicle/transport (additive): dynamic speed in Movement based on owned flag + value.
      // Voluntary acquire (money sink + flag) produces real shorter commute durations on roads (physical effect).
      // Higher vehicleValue can give tiny extra edge (market differentiation of "better transport").
      // Sell will clear flag -> reverts durations (earnings opportunity from owning is real time+access).
      const hasOwned = !!(resident as any).hasPersonalTransport || !!(resident as any).ownsVehicle || resident.ownsVehicle;
      if (hasOwned) {
        const vVal = (resident as any).vehicleValue || resident.vehicleValue || 220;
        // Base ~38-42% save; small dynamic bonus from value (reallocation of faster transport worth more).
        const baseFactor = 0.60;
        const valBonus = Math.min(0.08, Math.max(0, (vVal - 200) / 1200));
        const factor = baseFactor - valBonus; // higher value -> slightly faster (0.60 down to ~0.52)
        travelMinutes = Math.max(2, Math.ceil(travelMinutes * factor));
      }
      // 1 tick == 1 simulated minute in this model
      const durationTicks = Math.max(1, Math.ceil(travelMinutes));
      resident.beginCommute(targetId, durationTicks, currentTick);
    }

    // Advance visual position using current progress (even on the arrival tick)
    const progress = resident.getCommuteProgress(currentTick);
    const fromPos = this.getLocationPosition(fromId) ?? resident.position;
    const toPos = this.getLocationPosition(targetId) ?? { x: fromPos.x + 40, y: fromPos.y + 10 };

    const t = this.easeInOutQuad(progress);
    resident.position = {
      x: fromPos.x + (toPos.x - fromPos.x) * t,
      y: fromPos.y + (toPos.y - fromPos.y) * t,
    };

    // Arrival check (use epsilon for float safety)
    if (progress >= 1 - 1e-9) {
      const wasWork = resident.commuteTargetId === resident.workId;
      resident.arrive();

      // Agentic arrival trigger (key for AI residents "at the top"): if I (as AI) set jobHuntTargetId and just arrived at it,
      // immediately attempt hire using the bias in Business runBasicJobSearch. This gives immediate realistic feedback:
      // "I chose this job with my decision, I drove the real road to it, I arrived, the market considered me preferentially -> hired or better shot."
      // Directly supports free markets (agent demand for labor slots) + city realism (commute has consequence, voluntary move leads to employment change).
      if (resident.jobHuntTargetId && resident.currentLocationId === resident.jobHuntTargetId) {
        try {
          ((this as any).residentsSystem).attemptAgentHireAtCurrentLocation?.(resident.id);
        } catch {}
      }

      // Realistic shift: when a resident arrives at work, they stay until their scheduled
      // workEndHour (or a reasonable minimum if they arrived late). This prevents the
      // unrealistic "arrive at 9:30, immediately head home because it's 'after workStart'" behavior.
      if (wasWork && resident.currentLocationId === resident.workId && resident.employerId !== null) {
        const currentHour = this.timeSystem.hourOfDay + ((currentTick % 60) / 60);
        const scheduledEnd = resident.schedule.workEndHour;

        let shiftEndTick: number;

        if (currentHour < scheduledEnd) {
          // Arrived before scheduled end → work until scheduled end today
          const hoursRemaining = scheduledEnd - currentHour;
          shiftEndTick = currentTick + Math.floor(hoursRemaining * 60);
        } else {
          // Arrived after scheduled end (long commute or late start) → work a minimum realistic shift
          // (4 hours feels fair; they still "showed up for work")
          shiftEndTick = currentTick + (4 * 60);
        }

        resident.setWorkShiftEnd(shiftEndTick);
      }

      this.snapToCurrentLocation(resident);
    }
  }

  // === Helpers ===

  /** Derive where this resident "wants" to be right now based on their current activity intent. */
  private getDesiredLocationId(resident: Resident): LocationId {
    // If we are already tracking a specific commute target, honor it until arrival
    if (resident.commuteTargetId) {
      return resident.commuteTargetId;
    }

    const act = resident.currentActivity;
    if (act === 'working' || act === 'commuting_to_work' || act === 'at_work') {
      return resident.workId;
    }

    // Agentic residents: if AI set a jobHuntTargetId (via job_target decision), strongly prefer heading there.
    // This enables real "I choose to pursue this job" agency for AI players.
    if (resident.jobHuntTargetId) {
      const h = this.timeSystem.hourOfDay;
      if (h >= 6 && h < 20) {  // broad day window for pursuit
        // High probability to head to target (AI intent wins over random)
        const idTail = parseInt(resident.id.slice(-2) || '0', 10);
        if (((this.timeSystem.tick + idTail) % 3) < 2) {  // ~67% duty cycle
          return resident.jobHuntTargetId;
        }
      }
    }

    // Phase A Core Stabilization: unemployed residents with some joblessness duration
    // periodically head toward their assigned work location during daytime hours to "job hunt".
    // This dramatically increases visible resident movement + commuting frequency on canvas
    // (extra flows to business districts throughout the day) without new locations or UI.
    // Uses tick + simple resident id hash for deterministic pseudo-varied timing (not every tick).
    if (resident.employerId === null) {
      const durH = (resident.unemploymentDurationTicks || 0) / 60;
      if (durH > 1.5) {
        const h = this.timeSystem.hourOfDay;
        if (h >= 7 && h < 19) {
          // ~50% duty cycle per resident during day (varied by id+tick) -> lively but not chaotic job-seeker traffic
          const idTail = parseInt(resident.id.slice(-2) || '0', 10);
          if (((this.timeSystem.tick + idTail) % 5) < 3) {
            return resident.workId;
          }
        }
      }
    }

    // sleeping, at_home, commuting_home, idle -> home
    return resident.homeId;
  }

  private getLocationPosition(id: LocationId): Position | null {
    const loc = this.locationsSystem.getLocation(id);
    if (!loc) return null;
    return { x: loc.position.x, y: loc.position.y };
  }

  private snapToCurrentLocation(resident: Resident): void {
    const loc = this.locationsSystem.getLocation(resident.currentLocationId);
    if (loc) {
      resident.position = { x: loc.position.x, y: loc.position.y };
    }
  }

  /** Quadratic ease-in-out for pleasing non-linear movement (matches spirit of renderer) */
  private easeInOutQuad(t: number): number {
    // Clamp
    t = Math.max(0, Math.min(1, t));
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
