# City Map Realism v2 — 1-2 Hour Autonomous Sprint Plan (User AFK)

**Date:** 2026-05-31  
**Sprint Duration:** 90-120 minutes continuous autonomous work  
**Owner:** Grok (full autonomy granted)  
**North Star:** Deliver a dramatically more realistic, connected city map where the background scales with buildings, roads visibly link homes to workplaces/factories/shops, there are no orphans, and people travel in cars on the actual road network with clear "commuting" status — especially delightful in Real Time (1:1) + camera follow.

## Current State Problems (Confirmed via Screenshots + Code)
- Background zones (drawTownZonesAndRoads) still partially hardcoded or only roughly data-driven → do not properly scale/follow actual building placements from LocationsSystem.
- Roads (visual + TrafficSystem) do not clearly connect the real home clusters to work/factory/shop clusters.
- Orphaned/disconnected roads in upper-left that serve no purpose.
- Commuting residents still mostly look like walking figures instead of cars on roads.
- Weak or missing explicit "commuting" status visualization while people move.
- Overall map does not yet feel like a believable, lived-in city.

## Success Criteria (User-Visible "Wow")
- Open the canvas → "This is a real city with connected districts."
- Switch to Real Time (1:1) during rush + use camera follow on a person → you watch a car drive along a proper road from a residential area to a workplace with clear "COMMUTING TO WORK" status.
- Background tints hug the actual building clusters.
- No floating rectangles or orphan roads.
- Strong environmental details (parks, lighting, district separation) that reinforce realism.
- Fully compatible with all existing features (realtime, camera, God Mode, Crown experiments, performance).

## Core Principles
- Data-driven everywhere possible (LocationsSystem for positions/clusters, MovementSystem for real commute positions, TrafficSystem for roads/vehicles).
- Leverage and enhance existing systems (no behavior changes).
- Commuters belong on roads in vehicles during commuting_* states.
- Heavy verification: desktop screenshots (reliable) + capture-app attempts after every batch + tsc gates.
- Small, safe, additive batches only.
- Prioritize visual impact: Phase 1 (background + roads) + Phase 2 (cars + status) first.

## Detailed Time-Boxed Execution Plan

### 0. Setup & Baselines (0-10 min) — IN PROGRESS
- Full hygiene + stable dev server launch.
- Multiple baseline desktop screenshots.
- Read critical code (CityRenderer zones/roads/residents/vehicles, LocationsSystem, MovementSystem, TrafficSystem).
- Create this sprint plan + todo tracking.
- Update city-map-visualization-upgrade.md with link.

**Verification:** Baseline screenshots logged.

### Phase 1: Data-Driven Background Scaling + Road Connectivity (10-40 min) — HIGHEST VISUAL IMPACT
1.1 Make zones fully data-driven:
   - Compute tight bounding boxes / convex hulls for residential (all home locations) vs commercial/industrial (all work locations) using LocationsSystem + current locMap.
   - Draw soft, scaled zone tints + faint district boundary edges that automatically hug the actual building clusters.
   - Greatly de-emphasize or remove any remaining hardcoded rects/curves that don't match data.

1.2 Road network connectivity fixes:
   - Full audit of drawTrafficRoadsAndCongestion + any remaining hardcoded roads in drawTownZonesAndRoads.
   - Remove all orphaned/disconnected roads (especially upper-left cross streets).
   - Add dynamic emphasis: roads that currently carry high commuting traffic (query residents with commuting_* activity near them) get thicker/brighter lines + stronger flow particles.
   - Visual "connection" polish: ensure major arteries clearly link the main home clusters to the main workplace/factory/shop clusters (add faint connector hints if needed).

1.3 Minor background realism:
   - Soft multi-layer or gradient zone fills that feel atmospheric rather than hard rectangles.

**Verification:** Desktop screenshot after Phase 1 + tsc. Compare directly to baseline.

### Phase 2: Commuters as Cars on Roads + Explicit Status (40-85 min) — THE TRANSFORMATIVE DELIGHT
2.1 Car rendering for commuters (enhance/replace current basic implementation):
   - In drawResidents (isCommuting branch): render proper small car sprites at the resident's real interpolated position (from MovementSystem).
   - Lightweight nearest-road snapping using TrafficSystem road segments for "actually on the road" feel.
   - Distinct visuals: different body colors/styles for to-work vs returning-home. Integrate cleanly with existing drawVehicles (freight) so they coexist without conflict.
   - Stronger, direction-aware wakes/trails that are especially prominent in realtime mode.

2.2 Clear commuting status:
   - Persistent, readable label near each commuting car: "COMMUTING TO WORK" or "COMMUTING HOME" (with arrow/icon).
   - When camera is following a commuter in realtime 1:1: the car + status becomes the clear focal point (scale up slightly, stronger effects).
   - Optional: small destination hint (factory icon, shop icon, etc.) based on target location type.

2.3 Polish & integration:
   - When a resident is selected (click or inspector), highlight their car on the road.
   - Ensure God Mode commuting counts have a direct, live visual counterpart on canvas.
   - Performance: keep everything cheap (reuse existing clustering and simpleHash).

**Verification:** Multiple screenshots in realtime + camera follow during simulated rush hours. This phase should deliver the "people in cars following roads with status" magic the user wants.

### Phase 3: Environmental & City Realism Polish (85-110 min)
3.1 Believable district details:
   - Small parks and green pockets placed near residential clusters (data-driven from home locations).
   - Industrial props (stacks, crates, loading zones) near work locations.
   - Clearer district separation with subtle labels or stronger (but tasteful) boundary edges.

3.2 Atmosphere that supports a real city:
   - Night street lighting along major roads that realistically affects commuting cars (headlights + road glow/reflections).
   - Rush-hour specific density and energy on the car layer.

3.3 Final connectivity & hierarchy:
   - Secondary streets lighter and quieter.
   - Major home↔work arteries dominant and purposeful.
   - Final orphan audit pass.

**Verification:** Screenshots at day/night + realtime. Map should now feel like a lived-in, realistic small city.

### Phase 4: Final Verification, Docs & Handoff (110-120 min)
- Update legend and any on-canvas hints for new car/commuting visuals.
- Quick performance & compatibility check.
- Heavy screenshot QC: 8-12 fresh labeled shots (baseline vs final, different conditions, realtime + camera follow).
- tsc gate + targeted health check.
- Update this plan with full execution log, before/after references, and lessons.
- Create clean handoff: `temp-parallel-agent-work/realism-v2-sprint-closeout-2026-05-31.md` (what was delivered, screenshots, how to experience the new realism).
- Light update to city-map-visualization-upgrade.md and AGENTS.md.

## Risk Mitigation & Rules
- Every edit batch → tsc + at least one desktop screenshot.
- All changes additive and reversible in spirit.
- Desktop screenshots (take-screenshot.ps1) as primary reliable verification method.
- If any change causes visual breakage or obvious perf regression → revert immediately.
- No behavior changes to core simulation, Crown, realtime, camera, or persistence.

## Success Definition
When the user returns and opens the canvas in Real Time (1:1) during rush with camera follow, they should think: "This finally looks and feels like a real city where people drive to work on actual roads."

---

**Execution starts NOW in autonomous batches. Progress, screenshots, and code changes will be logged live in this document and the handoff file.**

Current sprint todos created. First code batches will target Phase 1 immediately.