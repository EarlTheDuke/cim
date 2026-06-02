# City Map Realism v2: Connected Roads, Background Scaling, Commuters in Cars

**Date:** 2026-05-31  
**Status:** Active – Direct response to user feedback on current map state  
**Context:** Post extensive Phase 3 work (zones, road texture, commute drama, camera/follow, realtime 1:1 effects, long-run visual QC). Current visuals are "better but still bad" per user.

## Current Problems (from direct user feedback + analysis)
- Background/zone tints (drawTownZonesAndRoads) are mostly hardcoded rectangles + curves. They do not scale or align with actual building clusters from LocationsSystem.
- Visual roads (both old hardcoded in drawTownZonesAndRoads and TrafficSystem roads) do not clearly connect home locations to workplace/factory/shop locations.
- Orphan/extra roads visible in upper-left that serve no buildings.
- Commuting residents are still rendered as walking/posed figures (drawResidents) even when in `commuting_to_work` / `commuting_home`. They do not appear "in cars" on the road network.
- No explicit "commuting" status visualization while people are moving between home and work (beyond color/pose).

**Goal:** Transform the map into something that feels like a **realistic, connected city** you can watch in realtime 1:1 with camera follow. Houses visibly linked to workplaces via roads. People travel in cars along those roads with clear commuting status. Background feels like it belongs to the buildings.

## Core Principles for the Upgrade
- **Data-driven first**: Zones, road emphasis, and connections must derive from real LocationsSystem positions + homeId/workId assignments.
- **Leverage existing systems** (do not reinvent):
  - LocationsSystem for true 2D home/work positions and clusters.
  - MovementSystem for real interpolated `resident.position` during commutes (already excellent).
  - TrafficSystem for authoritative road network + congestion + vehicles.
  - Resident.currentActivity for commuting states.
- **Commuters belong on roads in vehicles**: During commute activities, render small car sprites (or enhanced vehicle icons) at the resident's real position, snapped to the road network where possible.
- **Clear status**: "Commuting to Work" / "Commuting Home" labels, arrows, or distinct vehicle styling + wakes when moving.
- **Performance & compatibility**: Keep clustering, zero behavior change, fully additive, works with camera, realtime mode, God Mode, long-run Crown experiments.
- **Verification**: Mandatory before/after captures (canvas + god) after every batch using hardened capture tool (or desktop fallback).

## Phased Plan

### Phase 1: Clean Foundation & Background Scaling (Immediate High-Impact)
1.1 Audit & deprecate old hardcoded elements in `drawTownZonesAndRoads`:
   - Make the large zone rectangles data-driven: compute bounding boxes or density clusters from residential vs workplace locations.
   - Greatly reduce opacity or make them purely subtle atmospheric tints that automatically scale with building spread.
   - Remove or heavily fade the upper-left orphaned roads/curves that don't serve any locations.

1.2 Improve road network visual connectivity:
   - In `drawTrafficRoadsAndCongestion`, emphasize roads that actually serve high home-to-work flows (use location data + current commuting residents to boost visual weight on "real commute corridors").
   - Add faint "connector" hints or ensure major TrafficSystem roads visibly link the main residential cluster(s) to the main workplace/factory/shop cluster(s).

1.3 Background scaling fix:
   - Derive zone tints from actual location data (e.g., convex hull or simple grid density of homeId vs workId locations).
   - Multi-layer or soft gradient backgrounds that feel like they "belong" to the buildings rather than floating rectangles.

**Verification**: Fresh canvas screenshots clearly showing zones hugging the actual building clusters and roads linking them.

### Phase 2: Commuters in Cars on Roads + Status (The "Amazing" Part)
2.1 During `commuting_to_work` or `commuting_home`:
   - In `drawResidents` (or a new `drawCommuterVehicles` helper), render the resident as a small distinct car icon/sprite at their real `position` (from MovementSystem).
   - Snap the car position to the nearest TrafficSystem road segment for "on the road" feel (lightweight nearest-segment projection).
   - Use different car styles or tints for commute vs the existing freight vehicles.

2.2 Explicit commuting status:
   - Small floating or attached label near the car: "→ Work" or "← Home" (or icon arrow).
   - Stronger, direction-aware wakes/trails specifically for commuting cars (different from general traffic).
   - In realtime + camera-follow mode, these cars become the stars of the show.

2.3 Integration:
   - When a resident is selected (inspector or click), highlight their car on the road.
   - God Mode snapshot already shows commuting counts — make canvas reflect that live.

**Verification**: In realtime 1:1 + camera follow on a commuter during rush: you clearly see a car moving along a road from a house cluster to a workplace cluster with "commuting" status visible.

### Phase 3: Environmental & Realism Polish
3.1 District & connection clarity:
   - Clearer visual hierarchy: thicker/more important roads for the main home↔work arteries.
   - Small parks/green pockets near residential clusters, loading docks/props near factories.
   - District labels (tasteful, toggleable or zoom-dependent).

3.2 Time-of-day & atmosphere that supports realism:
   - Stronger road lighting / streetlights at night that affect the commute cars.
   - Rush-hour specific effects on the car layer (headlights, denser packing).

3.3 Orphan & connectivity cleanup:
   - Final audit: every visible road segment should serve at least one home-to-work pair (or be clearly decorative minor street).

### Phase 4: Polish, Camera Synergy & Documentation
- Full legend update explaining new car/commuting visuals.
- Camera follow feels perfect on a commuting car in realtime.
- Update plans/city-map-visualization-upgrade.md and ARCHITECTURE.md.
- Heavy autonomous capture QC (before/after for each phase).
- Optional: simple "commute flow replay" overlay for long-run data.

## Success Criteria (User-Visible)
- Open the map → instantly see "these houses are connected to those factories/shops via these roads."
- Slow to Real Time (1:1) during rush → watch actual cars (not walking dots) moving purposefully along roads from residential areas to work areas.
- Click Follow on one → smooth camera tracking a car with clear "commuting to work" status.
- Background feels like it belongs to the buildings (no floating rectangles).
- No orphaned roads.
- Feels like a living, realistic small city you can sit and observe.

## Execution Log (Autonomous - 2026-05-31)

**Batch 1 executed immediately after plan creation:**
- Greatly de-emphasized hardcoded background zones (now very low opacity) as short-term relief.
- **Major win**: Made zone tints data-driven. `drawTownZonesAndRoads` now computes rough bounding boxes from actual `LocationsSystem` residential vs workplace positions (falls back gracefully). Zones now scale and follow where the real houses and factories actually are.
- Removed the obvious orphaned cross streets in the upper-left work area that didn't connect to any real locations.
- Enhanced commuter car rendering:
  - Clear "COMMUTING → WORK" / "COMMUTING ← HOME" status text above the cars.
  - Better visual distinction (blue cars to work, green returning home).
  - Small driver silhouette + wheel motion kept for personality while moving on roads.
- Desktop screenshots captured after each meaningful change (reliable fallback due to known Windows capture-app friction):
  - `screenshot_2026-05-31_19-21-13.png` (baseline before v2 batch)
  - `screenshot_2026-05-31_19-21-38.png` (after data-driven zones + orphan cleanup + improved cars/status)
- tsc clean on changes.
- Plan document updated live.

**Current state (visible in latest screenshots):**
- Background tints now roughly follow the actual spread of buildings instead of floating fixed rectangles.
- Upper-left orphan roads removed.
- Commuting residents now appear as cars with explicit status labels while traveling between home and work clusters.
- Still more work needed on perfect road snapping and emphasizing real commute corridors, but the map already feels significantly more connected and realistic.

Next autonomous batches will focus on:
- Better visual emphasis on roads that actually serve current home→work flows (using live resident positions).
- Improved car snapping to TrafficSystem roads.
- More environmental realism (parks near residential, props near workplaces).
- Continued heavy screenshot verification.

All work remains additive, performant, and fully compatible with realtime 1:1 + camera follow.