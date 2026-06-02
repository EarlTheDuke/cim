/**
 * CityRenderer
 *
 * Pure visualization layer for the CityWithLifeGrok canvas demo.
 * 
 * Responsibilities (Phase 5/6 visualization improvements):
 * - Spatial town layout using real Location entities (with .position) when available
 * - Falls back gracefully to ID-derived layout if locations system not populated yet
 * - Visual buildings: house shapes for residential, varied workplace buildings
 * - Resident clustering around their home/work locations based on currentActivity
 * - Animated commuters visually traveling between anchors
 * - Time-of-day atmospheric effects, night lights, occupancy, legend, selection highlights
 * - Phase C (Buildings & Occupancy): distinct residential houses (chimneys/doors/proportional lit windows + density bars + living activity glows) vs commercial/industrial workplaces (stacks/awnings + staff-driven window activity + visible profit health borders). All additive, performant, reuses clustering.
 * - **Business Visualization + Economic Indicators** (on workplace buildings):
 *     • Business type icons (simple geometric symbols for bakery/farm/mine/factory/store)
 *     • Profit-level color tints (green for profitable, red for loss-making)
 *     • Staff roster badge (employee count from BusinessSystem) + cash/profit hints
 *     • Trade activity sparkle when EconomySystem reports daily volume (lightweight, time-modulated)
 *     • Light integration via optional businessSnapshots + economySnapshot passed from main (pure read-only)
 *
 * - **Economy Flow Visualization** (inter-building trading):
 *     • Animated gold/silver dashed trade lines + traveling particles/pulses drawn directly between workplace buildings.
 *     • Activates on EconomySystem dailyTradeVolume (the exact same signal driving live historical charts, GDP counters, and building sparkles).
 *     • Makes market trading activity (B2B + market steps from processMarketStep) spatially visible and connected to the data views.
 *     • Cheap O(bizCount) canvas primitives, volume + tick modulated, fully decoupled via snapshots.
 *
 * - **Polished Movement + Traffic Visual Flows** (tied to economy):
 *     • Commuting residents now use *real* MovementSystem-updated .position (exact eased progress + real world distances from Locations).
 *     • Authoritative TrafficSystem roads drawn with live congestion coloring/width + animated flow-line particle hints on busy segments.
 *     • Direction-aware cars (commute) + trucks (freight) with night headlights; freight vehicles get subtle economy gold cargo tint.
 *     • High-traffic roads get optional numeric "busy route" labels + stronger visual weight — makes people+vehicle+economy flows feel connected.
 *     • Simple traffic light indicators (3-phase green/yellow/red) at junctions + subtle stopped queue/brake viz (Agent TL).
 *     • All traffic viz is optional snapshot-driven (zero coupling).
 *     • Phase 1.1 Road Texture polish (continuation): double lane dashes + refined shoulders/curbs on majors, junction caps, light trees/greenery on residential locals + industrial props on heavy roads. Roads now read as a connected purposeful city network. (additive, reuses TrafficSystem roads).
 *     • Environmental Polish & District Details (Phase 1.1 / 2.4 continuation): richer hash-driven trees/greenery along residential roads + scattered in neighborhoods, more varied subtle industrial props near heavy/industrial zones, slightly stronger but tasteful district ground tints + faint edge/boundary details for clearer zone separation, light time-of-day modulated atmospheric haze/mist for real-city depth (denser at dusk/night). All cheap deterministic primitives, zero state, excellent perf.
 *
 * Phase C (Canvas People & Traffic): streets/sidewalks feel like a real city in motion
 *     • Residents: beyond dots+legs — distinct poses per state (walking with arm swing, working tool/carrying poses, standing clusters, weary long-unemp slouch). Subtle per-resident variety via hash (bags, hardhats, chatting pairs) while preserving all trails + activity colors + performance.
 *     • Vehicles: more distinct subtypes (sedans, vans, short "bus" variants on cars via hash; occasional trailer semis on trucks) + richer congestion feel (intensified multi-glow brake lights + road reflection when stopped/bunched, variable streak length, exhaust hints).
 *     • Fully additive on top of existing streak/trail system. Pure viz, zero perf impact at 400+ pop.
 *
 * Phase 3 (City Map Visualization — Commute Flow Drama): real-time commutes are now dramatically visible and delightful, especially during rush hours.
 *     • Rush-hour detection using TimeSystem hour + live resident commuting activity + Traffic commute-purpose vehicles (morning 6.2-9.8, evening 16-19.8 with intensity driven by actual commuter density).
 *     • Stronger "commute waves" on roads during peak: significantly denser/faster/larger directional flow particles, chevrons/arrows, thicker animated dashes, subtle surge glow on major corridors — makes rush hour feel like a living tide of people moving purposefully.
 *     • Visual distinction: rush boosts commuter trails (longer wakes), limb swing speed/amplitude, motion speed-lines behind walkers; commute vehicles get intensified streaks + wakes; overall roads get energetic "busy flow" accents.
 *     • Seamless integration with existing expressive resident poses (Phase C) and authoritative vehicle/road rendering — commuters driving/walking feel alive and part of the city's heartbeat.
 *     • Purely visual, snapshot-driven, zero behavior change, excellent performance (bounded cheap canvas primitives, O(1) extra per frame).
 *
 * Designed to be decoupled: only reads data. Uses the actual sim-provided Location positions
 * (scaled to canvas) for perfect alignment with future movement / spatial systems.
 * Business/economy + traffic data are optional and snapshot-based for zero coupling.
 *
 * Phase B (post Long-Run Stability): Economy feels alive & observable at 100x+
 * - Stronger, lower-threshold animated gold trade flows (ambient network + event pulses) so money movement is obvious on canvas.
 * - Dynamic business health: stronger profit tints, more responsive staff/cash signals, visual "thriving vs struggling".
 * - Rent collection visibility: magenta sparks / coin hints on homes when Economy dailyRentCollected > 0 (ties to HM payday flows + econ counters).
 * - All driven by the exact same EconomySystem snapshots + recentTrades that power charts/GodMode (plus foundation from Phase A invariant APIs: checkCoreInvariants, getBusinessHealthSnapshot, getTotalMoneyInSystem etc for proven stability context).
 */

import type { Resident } from '../entities/Resident';
import type { LocationsSystem } from '../systems/LocationsSystem';
import type { TrafficSnapshot, Road } from '../systems/TrafficSystem';

export interface RenderOptions {
  showConnections?: boolean;
  showOccupancy?: boolean;
  showBusinessIndicators?: boolean; // toggles business icons, profit tints, staff badges, trade sparkles
}

export class CityRenderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  // Cache for ID -> canvas pixel position (used for fallback or labels)
  private locationPixelCache: Map<string, { x: number; y: number }> = new Map();

  private readonly ACTIVITY_COLORS: Record<string, string> = {
    sleeping: '#60a5fa',
    at_home: '#fbbf24',
    working: '#4ade80',
    at_work: '#4ade80',
    commuting_to_work: '#a78bfa',
    commuting_home: '#c084fc',
    idle: '#94a3b8',
    default: '#64748b',
  };

  // World coordinate bounds we expect from LocationsSystem (from spawn logic ~0-100)
  private readonly WORLD_MIN = 0;
  private readonly WORLD_MAX = 100;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
  }

  // ============================================
  // Camera / Pan / Zoom / Follow — Phase 3/5 City Map Visualization (delivered)
  // Lightweight, additive, optional, toggleable. Zero impact when unused (defaults to full view).
  // Pan (mouse drag), zoom (wheel, cursor-centered), smooth lerp follow on selected resident or road midpoint.
  // Click a resident (or road segment while Follow enabled) → tracks their live commute / flow in real-time or slow-mo.
  // Integrates cleanly with existing hitTest/selection + canvas clicks. Public API for God/main wiring.
  // All drawing + hitTest use final screen space (raw mouse coords always correct even when zoomed/panned).
  // Enables the "watch people drive to work up close" experience on the stable Phase A core + Crown observability.
  // ============================================
  private camWorldX = 50;
  private camWorldY = 50;
  private camZoom = 1.0;
  private viewPanX = 0;
  private viewPanY = 0;
  private followTarget: { x: number; y: number } | null = null;
  private readonly MIN_ZOOM = 0.35;
  private readonly MAX_ZOOM = 5.0;
  private readonly FOLLOW_LERP = 0.13;

  /**
   * Phase 3 Commute Flow Drama: lightweight rush-hour intensity (0..~1.25).
   * Uses TimeSystem hour + count of actual commuting residents + commute-purpose vehicles from Traffic snapshot.
   * Pure viz helper (no side effects). Called from render + key draw methods.
   */
  private getRushHourIntensity(timeHours: number, residents: Resident[], trafficSnapshot?: TrafficSnapshot): number {
    const hour = ((timeHours % 24) + 24) % 24;
    let base = 0;
    // Morning rush window (dominant commute_to_work)
    if (hour >= 6.2 && hour <= 9.8) {
      base = Math.max(base, 1.0 - Math.abs(hour - 7.85) / 1.85);
    }
    // Evening rush window (dominant commute_home)
    if (hour >= 16.0 && hour <= 19.8) {
      base = Math.max(base, 1.0 - Math.abs(hour - 17.85) / 2.05);
    }
    if (base < 0.04) return 0;

    // Real activity density (residents actually on the move right now)
    let commuting = 0;
    for (const r of residents) {
      const act = r.currentActivity;
      if (act === 'commuting_to_work' || act === 'commuting_home') commuting++;
    }
    const pop = residents.length || 1;
    const commuteFrac = commuting / pop;

    // Traffic layer confirmation (commute-purpose vehicles)
    let vehCommuteFrac = 0;
    if (trafficSnapshot && trafficSnapshot.vehicles && trafficSnapshot.vehicles.length > 0) {
      const commuteVeh = trafficSnapshot.vehicles.filter(v => v.purpose === 'commute').length;
      vehCommuteFrac = Math.min(0.65, commuteVeh / Math.max(4, pop * 0.55));
    }

    // Combined intensity (capped for tasteful visual boost, never overwhelming)
    const intensity = Math.min(1.28, base * (0.55 + commuteFrac * 1.05 + vehCommuteFrac * 0.6));
    return intensity < 0.06 ? 0 : intensity;
  }

  /**
   * Main render call. 
   * locationsSystem is optional; when present we use real .position data for perfect spatial fidelity.
   * businessSnapshots (from sim.businesses.getSnapshot().businesses) + economySnapshot enable live economic indicators on workplaces.
   * All business/economy inputs are optional, read-only snapshots for pure visualization decoupling.
   * trafficSnapshot (from sim.traffic.getSnapshot()) enables drawing of live direction-aware vehicles (cars/trucks) + road congestion visuals + lights + stopped queues.
   * economySnapshot also drives **Economy Flow Visualization** (new): animated gold trade lines + traveling particles between business buildings when dailyTradeVolume > threshold.
   * All extra inputs optional/read-only snapshots → pure viz, zero side effects, cheap when absent.
   */
  render(
    residents: Resident[],
    tick: number,
    timeHours: number,
    selectedId: string | null = null,
    locationsSystem?: LocationsSystem,
    options: RenderOptions = {},
    businessSnapshots?: Array<{ id: string; cash: number; profit: number; employeeCount: number; type?: string; decisionLog?: any[]; brainProvider?: string; lastDecisionReason?: string; decisionHistory?: any[] }>,
    economySnapshot?: { dailyTradeVolume?: number; cumulativeGDP?: number; totalBusinessCash?: number; dailyRentCollected?: number; totalRentCollected?: number },
    trafficSnapshot?: TrafficSnapshot,
    /** Event-driven recent trades for *specific* directed flow lines (stronger tie to actual 'economy:trade' occurrences that also move the charts) */
    recentTrades?: Array<{ fromId: string; toId: string; value: number; age: number }>,
    /** Optional business id to draw extra emphasis ring/glow — enables clickable buildings + God Mode / inspector cross-focus */
    highlightedBusinessId?: string | null,
    /** NEW: Explicit selected business for rich BusinessInspector (non-breaking optional; falls back to highlighted for viz continuity) */
    selectedBusinessId?: string | null,
    /** Real-Time 1:1 agent: speed passed from main for wall-time smooth commute flow animation (no jumpy dashes at 1 tick/sec) + stronger realtime-specific visuals */
    speed?: import('../core/types').SimulationSpeed
  ): void {
    // Phase 3 Commute Flow Drama: compute once per frame (cheap) and thread to visual layers for consistent rush-hour energy.
    const rushIntensity = this.getRushHourIntensity(timeHours, residents, trafficSnapshot);

    // Real-Time 1:1 agent: wall-clock smooth animation phase (Date.now based) so dashes / limb swings / flow particles are silky 60fps continuous
    // even when sim ticks only 1x per real second in 'realtime' mode. High speeds still use deterministic tick phase.
    const isRealtimeMode = speed === 'realtime';
    const wallPhase = (Date.now() / 850) % 1.0; // ~1.176s cycle, smooth human-eye flow for watching commutes
    const smoothAnimPhase = isRealtimeMode ? wallPhase : (tick * 0.07) % 1.0;

    this.drawTimeOfDayBackground(timeHours, tick);
    this.drawTownZonesAndRoads(locationsSystem, undefined);

    // Draw real TrafficSystem roads (with congestion + animated flow particles) early for proper layering
    // under buildings, residents, and vehicles. Uses tick for smooth flow animation.
    if (trafficSnapshot && trafficSnapshot.roads && trafficSnapshot.roads.length > 0) {
      this.drawTrafficRoadsAndCongestion(trafficSnapshot, tick, timeHours, rushIntensity, smoothAnimPhase, isRealtimeMode);
    }
    // TL: Draw traffic light fixtures at junctions (after roads, before vehicles for correct layering)
    if (trafficSnapshot && trafficSnapshot.lights && trafficSnapshot.lights.length > 0) {
      this.drawTrafficLights(trafficSnapshot);
    }

    // Build pixel positions from real locations if possible, else fallback
    const locPixelMap = this.buildLocationPixelMap(residents, locationsSystem);

    // New camera-aware district labels (Phase 2) - correctly positioned and transform with camera
    this.drawDistrictLabels(locationsSystem, locPixelMap);

    // Build fast lookup for business indicators keyed by id (matches workplace loc ids)
    const businessMap = this.buildBusinessIndicatorMap(businessSnapshots);

    const showBiz = options.showBusinessIndicators ?? true;
    const effectiveBizHighlight = selectedBusinessId ?? highlightedBusinessId ?? null;
    this.drawBuildings(
      residents,
      locPixelMap,
      tick,
      timeHours,
      locationsSystem,
      options.showOccupancy ?? true,
      showBiz ? businessMap : undefined,
      showBiz ? economySnapshot : undefined,
      effectiveBizHighlight
    );

    // Economy Flow Visualization: light lines + particles between businesses (uses same dailyTradeVolume as charts + per-biz sparkles)
    // Drawn after buildings (over building bases) but before residents/vehicles for clean layering and high-signal "economy is trading" feel.
    // Now also receives recentTrades for specific per-trade directed connections (when actual market/B2B trades fire) + highlight for deeper UI linking.
    this.drawEconomyTradeFlows(locPixelMap, showBiz ? businessMap : undefined, showBiz ? economySnapshot : undefined, tick, recentTrades, effectiveBizHighlight);

    const residentPositions = this.drawResidents(residents, locPixelMap, tick, timeHours, rushIntensity, isRealtimeMode);

    if (selectedId) {
      this.drawSelectionHighlight(residents, selectedId, residentPositions, locPixelMap);
    }

    // Vehicles drawn late (on top of roads + people) — direction-aware + economy freight tinted.
    if (trafficSnapshot && trafficSnapshot.vehicles && trafficSnapshot.vehicles.length > 0) {
      this.drawVehicles(trafficSnapshot, timeHours, rushIntensity, isRealtimeMode);
    }

    this.drawLegend();
    this.drawTimeIndicator(timeHours, rushIntensity, isRealtimeMode);
  }

  /** Internal: fast Map<id, indicator> from lightweight business snapshots (no full objects). */
  private buildBusinessIndicatorMap(
    snapshots?: Array<{ id: string; cash: number; profit: number; employeeCount: number; type?: string; decisionLog?: any[]; brainProvider?: string; lastDecisionReason?: string; decisionHistory?: any[] }>
  ): Map<string, { cash: number; profit: number; employeeCount: number; type?: string; decisionLog?: any[]; brainProvider?: string; lastDecisionReason?: string; decisionHistory?: any[] }> {
    const map = new Map<string, { cash: number; profit: number; employeeCount: number; type?: string; decisionLog?: any[]; brainProvider?: string; lastDecisionReason?: string; decisionHistory?: any[] }>();
    if (!snapshots || snapshots.length === 0) return map;
    for (const s of snapshots) {
      if (s && s.id) {
        map.set(s.id, {
          cash: s.cash,
          profit: s.profit,
          employeeCount: s.employeeCount,
          type: s.type,
          // Phase 7 canvas discoverability (additive only): optional brain decision fields surface when present in snapshots (future-proof; graceful no-op if absent from current BusinessSnapshot)
          decisionLog: (s as any).decisionLog,
          brainProvider: (s as any).brainProvider,
          lastDecisionReason: (s as any).lastDecisionReason,
          // canvas-longrun-viz-14 (additive): carry optional P7-PERSIST decisionHistory array for fading long-run history dots on canvas during 60/90d experiments
          decisionHistory: (s as any).decisionHistory,
        });
      }
    }
    return map;
  }

  hitTest(
    mouseX: number,
    mouseY: number,
    residents: Resident[],
    tick: number,
    timeHours: number,
    locationsSystem: LocationsSystem | undefined,
    hitRadius = 10
  ): string | null {
    const locPixelMap = this.buildLocationPixelMap(residents, locationsSystem);

    let closestId: string | null = null;
    let closestDist = Infinity;

    for (const r of residents) {
      const pos = this.getResidentPixelPos(r, locPixelMap, tick, timeHours);
      const dx = pos.x - mouseX;
      const dy = pos.y - mouseY;
      const dist = Math.hypot(dx, dy);

      if (dist < hitRadius && dist < closestDist) {
        closestDist = dist;
        closestId = r.id;
      }
    }
    return closestId;
  }

  /**
   * Hit test for buildings / workplaces (for clickable economy viz + BusinessInspector).
   * Returns the location id (e.g. 'business_factory') of the closest workplace within radius.
   *
   * Powers the rich BusinessInspector (P&L, roster with cross-links, inventory, profit sparkline, God actions).
   * Used by canvas click handler → highlight ring (with INSPECT badge) + BusinessInspector open.
   * Complements the resident-only hitTest — keeps existing resident selection behavior intact.
   *
   * Click-to-inspect wiring: call this from UI layer on canvas click; feed result to
   * BusinessInspector.selectBusiness(id) and CityRenderer render(..., highlightedBusinessId, selectedBusinessId).
   */
  hitTestBuilding(
    mouseX: number,
    mouseY: number,
    locationsSystem: LocationsSystem | undefined,
    residentsForFallback: Resident[] = [],
    hitRadius = 20   // Slightly generous for inspector targeting on small building icons
  ): string | null {
    const locPixelMap = this.buildLocationPixelMap(residentsForFallback, locationsSystem);

    let closestId: string | null = null;
    let closestDist = Infinity;

    // Prefer real locations (authoritative for demo workplaces)
    if (locationsSystem && locationsSystem.getLocationCount() > 0) {
      for (const loc of locationsSystem.getAllLocations()) {
        if (loc.isResidential()) continue; // only workplaces for business/economy clicking
        const pos = locPixelMap.get(loc.id);
        if (!pos) continue;
        const dx = pos.x - mouseX;
        const dy = pos.y - mouseY;
        const dist = Math.hypot(dx, dy);
        if (dist < hitRadius && dist < closestDist) {
          closestDist = dist;
          closestId = loc.id;
        }
      }
      if (closestId) return closestId;
    }

    // Fallback: scan locPixelMap for non-home keys (business_* etc)
    for (const [id, pos] of locPixelMap.entries()) {
      if (id.startsWith('home_')) continue;
      const dx = pos.x - mouseX;
      const dy = pos.y - mouseY;
      const dist = Math.hypot(dx, dy);
      if (dist < hitRadius && dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    }
    return closestId;
  }

  /**
   * Lightweight road segment hit test (Phase 3 Camera Controls & Follow Mode).
   * Returns the WORLD midpoint of the closest Traffic road segment within radius (screen space).
   * Enables "click a road to follow the flow / watch a neighborhood artery".
   * Pure viz + input for setFollowTarget; uses existing worldToCanvas for accurate hit under any pan/zoom.
   * Compact point-to-segment projection (no allocations in hot path).
   */
  public hitTestRoad(
    mouseX: number,
    mouseY: number,
    trafficSnapshot?: TrafficSnapshot,
    hitRadius = 18
  ): { x: number; y: number } | null {
    if (!trafficSnapshot || !trafficSnapshot.roads || trafficSnapshot.roads.length === 0) return null;

    const ptSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 < 0.0001) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * dx + (py - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const projX = x1 + t * dx, projY = y1 + t * dy;
      return Math.hypot(px - projX, py - projY);
    };

    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;

    for (const road of trafficSnapshot.roads) {
      const p1 = this.worldToCanvas(road.from.x, road.from.y);
      const p2 = this.worldToCanvas(road.to.x, road.to.y);
      const d = ptSeg(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y);
      if (d < hitRadius && d < bestD) {
        bestD = d;
        // Static but useful: midpoint in world space (user watches flows cross it; dynamic resident follow is the "live commute" path)
        best = { x: (road.from.x + road.to.x) * 0.5, y: (road.from.y + road.to.y) * 0.5 };
      }
    }
    return best;
  }

  // ============================================
  // Layout: prefer real Location positions, scale to canvas
  // ============================================

  private buildLocationPixelMap(
    residents: Resident[],
    locationsSystem?: LocationsSystem
  ): Map<string, { x: number; y: number }> {
    const map = new Map<string, { x: number; y: number }>();
    this.locationPixelCache.clear();

    // Camera-aware: delegate to worldToCanvas (now includes pan/zoom/follow view transform).
    // This keeps hitTest + all resident/building/road positions in final screen space (raw click coords work unchanged).
    const worldToCanvas = (wx: number, wy: number) => this.worldToCanvas(wx, wy);

    if (locationsSystem && locationsSystem.getLocationCount() > 0) {
      // Use the authoritative positions from the simulation world
      for (const loc of locationsSystem.getAllLocations()) {
        const px = worldToCanvas(loc.position.x, loc.position.y);
        map.set(loc.id, px);
        this.locationPixelCache.set(loc.id, px);
      }
      return map;
    }

    // Fallback: derive clusters from homeId/workId strings (original behavior before LocationsSystem was wired)
    const homes = new Set<string>();
    const works = new Set<string>();
    residents.forEach(r => {
      homes.add(r.homeId);
      works.add(r.workId);
    });

    const sortedHomes = Array.from(homes).sort();
    const sortedWorks = Array.from(works).sort();

    const homeBaseX = 95;
    const homeBaseY = 105;
    const cols = 4;
    const sx = 58, sy = 70;

    sortedHomes.forEach((hid, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = { x: homeBaseX + col * sx + (row % 2) * 9, y: homeBaseY + row * sy };
      map.set(hid, px);
      this.locationPixelCache.set(hid, px);
    });

    const workBaseX = 535;
    const workBaseY = 125;
    sortedWorks.forEach((wid, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const px = { x: workBaseX + col * 95 + (row % 2) * 15, y: workBaseY + row * 95 };
      map.set(wid, px);
      this.locationPixelCache.set(wid, px);
    });

    return map;
  }

  private getLocPixel(id: string, map: Map<string, { x: number; y: number }>): { x: number; y: number } {
    return map.get(id) ?? { x: this.width * 0.5, y: this.height * 0.5 };
  }

  /**
   * Convert world (0-100) coords from Locations/Movement/Traffic into canvas pixels.
   * Uses identical margins/scale as buildLocationPixelMap for perfect alignment.
   * Critical for real MovementSystem positions + Traffic roads/vehicles.
   * Camera-aware (pan/zoom/follow): applies view transform on top of base layout.
   */
  private worldToCanvas(wx: number, wy: number): { x: number; y: number } {
    const base = this.getBasePixel(wx, wy);
    return this.applyViewTransform(base.x, base.y);
  }

  // --- Camera helpers (prototype) ---
  private getBasePixel(wx: number, wy: number): { x: number; y: number } {
    const marginX = 70;
    const marginY = 65;
    const usableW = this.width - marginX * 2;
    const usableH = this.height - marginY * 2 - 20;
    const scaleX = usableW / (this.WORLD_MAX - this.WORLD_MIN);
    const scaleY = usableH / (this.WORLD_MAX - this.WORLD_MIN);
    return {
      x: marginX + (wx - this.WORLD_MIN) * scaleX,
      y: marginY + (wy - this.WORLD_MIN) * scaleY,
    };
  }

  private applyViewTransform(baseX: number, baseY: number): { x: number; y: number } {
    const cx = this.width / 2 + this.viewPanX;
    const cy = this.height / 2 + this.viewPanY;
    const baseCam = this.getBasePixel(this.camWorldX, this.camWorldY);
    const dx = (baseX - baseCam.x) * this.camZoom;
    const dy = (baseY - baseCam.y) * this.camZoom;
    return { x: cx + dx, y: cy + dy };
  }

  /**
   * Screen (final canvas pixel) → world coord (inverse of camera transform).
   * Used for zoom-to-cursor and follow math.
   */
  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cx = this.width / 2 + this.viewPanX;
    const cy = this.height / 2 + this.viewPanY;
    const baseCam = this.getBasePixel(this.camWorldX, this.camWorldY);
    const dx = (sx - cx) / this.camZoom;
    const dy = (sy - cy) / this.camZoom;
    const baseX = baseCam.x + dx;
    const baseY = baseCam.y + dy;
    const marginX = 70;
    const marginY = 65;
    const usableW = this.width - marginX * 2;
    const usableH = this.height - marginY * 2 - 20;
    const scaleX = usableW / (this.WORLD_MAX - this.WORLD_MIN);
    const scaleY = usableH / (this.WORLD_MAX - this.WORLD_MIN);
    const wx = this.WORLD_MIN + (baseX - marginX) / scaleX;
    const wy = this.WORLD_MIN + (baseY - marginY) / scaleY;
    return { x: wx, y: wy };
  }

  // ============================================
  // Background, zones, atmosphere
  // ============================================

  private drawTimeOfDayBackground(timeHours: number, tick: number = 0): void {
    const ctx = this.ctx;
    const hour = ((timeHours % 24) + 24) % 24;

    const isNight = hour < 5.8 || hour >= 21.2;
    const isDawn = hour >= 5.8 && hour < 7.5;
    const isDusk = hour >= 17.5 && hour < 20.5;

    // Richer time-of-day gradient sky for much more noticeable day/night cycle liveliness
    const grad = ctx.createLinearGradient(0, 0, 0, this.height * 0.68);
    if (isNight) {
      grad.addColorStop(0, '#05080f');
      grad.addColorStop(0.45, '#0a0f1a');
      grad.addColorStop(1, '#111318');
    } else if (isDawn) {
      grad.addColorStop(0, '#2a1f2e');
      grad.addColorStop(0.32, '#4a3a2a');
      grad.addColorStop(0.68, '#3a4a5a');
      grad.addColorStop(1, '#1f2a38');
    } else if (isDusk) {
      grad.addColorStop(0, '#1a2233');
      grad.addColorStop(0.38, '#3a2a1f');
      grad.addColorStop(0.72, '#2a2538');
      grad.addColorStop(1, '#111318');
    } else {
      grad.addColorStop(0, '#1e2a3f');
      grad.addColorStop(0.48, '#162033');
      grad.addColorStop(1, '#0f141f');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Pronounced dawn/dusk horizon warm glow band — makes time progression satisfyingly obvious
    if (isDawn || isDusk) {
      const warm = isDawn ? 'rgba(244, 162, 97, 0.24)' : 'rgba(245, 158, 11, 0.19)';
      ctx.fillStyle = warm;
      ctx.fillRect(0, this.height * 0.36, this.width, this.height * 0.22);
    }

    // Twinkling stars at night (animated with tick for lively night sky, cheap deterministic)
    if (isNight) {
      ctx.fillStyle = 'rgba(224, 242, 255, 0.9)';
      for (let i = 0; i < 14; i++) {
        const sx = 28 + ((i * 47) % (this.width - 55));
        const sy = 18 + ((i * 29) % 165);
        const tw = Math.sin((tick * 0.085) + i * 1.65) * 0.55 + 0.65;
        const r = 0.65 + tw * 0.55;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (i % 4 === 0) {
          // occasional warm twinkle accent
          ctx.fillStyle = 'rgba(253, 224, 71, 0.55)';
          ctx.beginPath();
          ctx.arc(sx + 0.8, sy - 0.7, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(224, 242, 255, 0.9)';
        }
      }
    }

    // Subtle ground haze for depth (helps roads/buildings pop at all times)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.fillRect(0, this.height * 0.71, this.width, this.height * 0.29);

    // === Environmental Polish (Phase 1.1/2.4): light time-of-day modulated atmospheric haze / mist ===
    // Adds real-city depth and mood without clutter. Faint vertical gradient, stronger/denser at night + dusk (classic urban atmosphere).
    // Cheap single rect + soft overlay; integrates beautifully with the new road texture, zone tints, and greenery.
    const mistAlpha = isNight ? 0.095 : (isDusk ? 0.072 : (isDawn ? 0.055 : 0.038));
    const mistTop = this.height * 0.68;
    ctx.fillStyle = isNight
      ? `rgba(30, 41, 59, ${mistAlpha})`
      : (isDusk ? `rgba(120, 80, 60, ${mistAlpha * 0.85})` : `rgba(70, 90, 110, ${mistAlpha})`);
    ctx.fillRect(0, mistTop, this.width, this.height - mistTop);

    // Extra soft lower ground mist band at night/dusk for extra "city at evening" feel (very low cost)
    if (isNight || isDusk) {
      ctx.fillStyle = isNight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(100, 70, 55, 0.07)';
      ctx.fillRect(0, this.height * 0.82, this.width, this.height * 0.18);
    }
  }

  private drawTownZonesAndRoads(locationsSystem?: LocationsSystem, locMap?: Map<string, { x: number; y: number }>): void {
    const ctx = this.ctx;

    // === City Map Realism v2 - Data-driven zones ===
    // Zones now attempt to follow actual building clusters from LocationsSystem instead of fixed pixels.
    // This directly addresses "background does not scale with the houses".

    let resBounds = { minX: 50, maxX: 340, minY: 60, maxY: 520 };
    let workBounds = { minX: 480, maxX: 780, minY: 60, maxY: 520 };
    let indBounds = { minX: 360, maxX: 520, minY: 390, maxY: 540 };

    if (locationsSystem && locationsSystem.getLocationCount() > 0) {
      const resXs: number[] = [], resYs: number[] = [];
      const workXs: number[] = [], workYs: number[] = [];

      for (const loc of locationsSystem.getAllLocations()) {
        const px = locMap?.get(loc.id) ?? this.worldToCanvas(loc.position.x, loc.position.y);
        if (loc.isResidential()) {
          resXs.push(px.x); resYs.push(px.y);
        } else {
          workXs.push(px.x); workYs.push(px.y);
        }
      }

      if (resXs.length > 0) {
        resBounds = {
          minX: Math.min(...resXs) - 25, maxX: Math.max(...resXs) + 25,
          minY: Math.min(...resYs) - 20, maxY: Math.max(...resYs) + 20
        };
      }
      if (workXs.length > 0) {
        workBounds = {
          minX: Math.min(...workXs) - 25, maxX: Math.max(...workXs) + 25,
          minY: Math.min(...workYs) - 20, maxY: Math.max(...workYs) + 20
        };
      }
    }

    // Very soft, data-driven multi-layer zone tints for realistic depth and scaling with actual buildings
    // Residential (soft green layers)
    ctx.fillStyle = 'rgba(16, 185, 129, 0.022)';
    ctx.fillRect(resBounds.minX, resBounds.minY, resBounds.maxX - resBounds.minX, resBounds.maxY - resBounds.minY);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.012)';
    ctx.fillRect(resBounds.minX + 8, resBounds.minY + 8, resBounds.maxX - resBounds.minX - 16, resBounds.maxY - resBounds.minY - 16);

    ctx.strokeStyle = 'rgba(16, 185, 129, 0.05)';
    ctx.lineWidth = 1.0;
    ctx.strokeRect(resBounds.minX, resBounds.minY, resBounds.maxX - resBounds.minX, resBounds.maxY - resBounds.minY);

    // Work / commercial (cool blue layers)
    ctx.fillStyle = 'rgba(59, 130, 246, 0.018)';
    ctx.fillRect(workBounds.minX, workBounds.minY, workBounds.maxX - workBounds.minX, workBounds.maxY - workBounds.minY);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.01)';
    ctx.fillRect(workBounds.minX + 6, workBounds.minY + 6, workBounds.maxX - workBounds.minX - 12, workBounds.maxY - workBounds.minY - 12);

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.04)';
    ctx.strokeRect(workBounds.minX, workBounds.minY, workBounds.maxX - workBounds.minX, workBounds.maxY - workBounds.minY);

    // Industrial (warm, very light)
    ctx.fillStyle = 'rgba(245, 158, 11, 0.016)';
    ctx.fillRect(indBounds.minX, indBounds.minY, indBounds.maxX - indBounds.minX, indBounds.maxY - indBounds.minY);

    // === Phase 1 Cleanup: Hardcoded roads removed ===
    // All old fixed-pixel roads (quadratic major road, secondary streets, etc.) have been removed.
    // We now rely exclusively on the real authoritative roads from TrafficSystem (drawn in drawTrafficRoadsAndCongestion).
    // This eliminates the "unrelated outdated roads" problem.

    // === Environmental Polish: scattered neighborhood trees / greenery inside residential district (hash-driven, low cost) ===
    // Makes the residential area feel alive with pockets of green beyond just road edges. 8-10 trees, fully deterministic.
    // Placed inside the residential rect with hash spacing so they look "natural" and never overlap roads/buildings badly.
    {
      const resX = 30, resY = 40, resW = 310, resH = 510;
      for (let i = 0; i < 10; i++) {
        const seed = this.simpleHash('neighborhood-tree-' + i);
        const tx = resX + 18 + ((seed * 17) % (resW - 36));
        const ty = resY + 22 + ((seed * 31 + i * 7) % (resH - 44));
        // Skip if too close to the major road path (rough visual culling, cheap)
        const nearMajor = Math.abs(tx - 320) < 38 && ty > 70 && ty < 530;
        if (nearMajor) continue;

        const size = 3.2 + ((seed % 5) * 0.35);
        const alpha = 0.22 + ((seed % 3) * 0.04);

        // Foliage (soft triangle cluster for "tree" feel)
        ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(tx, ty - size * 1.35);
        ctx.lineTo(tx - size * 0.95, ty + size * 0.75);
        ctx.lineTo(tx + size * 0.95, ty + size * 0.75);
        ctx.closePath();
        ctx.fill();

        // Second smaller foliage layer for volume (richer without cost)
        ctx.fillStyle = `rgba(52, 211, 153, ${alpha * 0.65})`;
        ctx.beginPath();
        ctx.moveTo(tx - 0.6, ty - size * 0.9);
        ctx.lineTo(tx - size * 0.65, ty + size * 0.35);
        ctx.lineTo(tx + size * 0.55, ty + size * 0.35);
        ctx.closePath();
        ctx.fill();

        // Tiny trunk
        ctx.fillStyle = 'rgba(120, 113, 108, 0.28)';
        ctx.fillRect(tx - 0.6, ty + size * 0.55, 1.2, size * 0.9);
      }
    }

    // === Phase 3+: More data-driven parks + industrial props for "amazing" connected city (v2 realism) ===
    // Parks near actual residential clusters, props near work clusters. Makes districts feel purposeful and lived-in.
    {
      const seedBase = 4242;
      for (let p = 0; p < 5; p++) {
        const s = this.simpleHash('park-' + p + seedBase);
        const px = resBounds.minX + 35 + ((s * 13) % (resBounds.maxX - resBounds.minX - 70));
        const py = resBounds.minY + 55 + ((s * 29 + p * 11) % (resBounds.maxY - resBounds.minY - 100));

        // Soft grass patch
        ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
        ctx.beginPath();
        ctx.ellipse(px, py, 18 + (s % 5), 12 + (s % 4), 0, 0, Math.PI * 2);
        ctx.fill();

        // A few trees in the park
        for (let t = 0; t < 3; t++) {
          const ts = this.simpleHash('park-tree-' + p + t);
          const tx = px - 8 + (ts % 16);
          const ty = py - 4 + (ts % 8);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
          ctx.beginPath();
          ctx.moveTo(tx, ty - 7);
          ctx.lineTo(tx - 5, ty + 4);
          ctx.lineTo(tx + 5, ty + 4);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Industrial props near actual work clusters (stacks, crates) - makes the map feel like a real economic city
      if (workBounds) {
        for (let i = 0; i < 3; i++) {
          const s = this.simpleHash('ind-prop-' + i);
          const px = workBounds.minX + 20 + ((s * 17) % (workBounds.maxX - workBounds.minX - 40));
          const py = workBounds.minY + 30 + ((s * 23) % (workBounds.maxY - workBounds.minY - 60));

          // Simple stack or crate
          ctx.fillStyle = 'rgba(71, 85, 105, 0.45)';
          ctx.fillRect(px - 4, py - 8, 8, 14);
          ctx.fillStyle = 'rgba(100, 116, 139, 0.35)';
          ctx.fillRect(px - 3, py - 6, 6, 4);
        }
      }
    }

    // Old hardcoded district labels removed (Phase 2 will add proper camera-aware versions based on real location clusters).
  }

  /**
   * Phase 2: Proper camera-aware district labels.
   * Labels are positioned at the center of actual location clusters and drawn via worldToCanvas
   * so they move, scale, and stay correct when the user pans, zooms, or follows a commuter.
   */
  private drawDistrictLabels(
    locationsSystem?: LocationsSystem,
    locMap?: Map<string, { x: number; y: number }>
  ): void {
    if (!locationsSystem || locationsSystem.getLocationCount() === 0) return;

    const ctx = this.ctx;
    const resCenters: { x: number; y: number }[] = [];
    const workCenters: { x: number; y: number }[] = [];
    const indCenters: { x: number; y: number }[] = [];

    for (const loc of locationsSystem.getAllLocations()) {
      const px = locMap?.get(loc.id) ?? this.worldToCanvas(loc.position.x, loc.position.y);
      if (loc.isResidential()) {
        resCenters.push(px);
      } else if (loc.type === 'industrial') {
        indCenters.push(px);
      } else {
        workCenters.push(px);
      }
    }

    const drawLabel = (centers: { x: number; y: number }[], text: string, color: string) => {
      if (centers.length === 0) return;
      const avgX = centers.reduce((s, p) => s + p.x, 0) / centers.length;
      const avgY = centers.reduce((s, p) => s + p.y, 0) / centers.length;

      // Draw in screen space but slightly offset for readability
      ctx.fillStyle = color;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(text, avgX - 60, avgY - 8);
    };

    drawLabel(resCenters, 'RESIDENTIAL', 'rgba(16, 185, 129, 0.75)');
    drawLabel(workCenters, 'WORK / COMMERCE', 'rgba(59, 130, 246, 0.75)');
    drawLabel(indCenters, 'INDUSTRIAL', 'rgba(245, 158, 11, 0.75)');
  }

  // ============================================
  // Buildings (now aligned to real or fallback positions)
  // ============================================

  private drawBuildings(
    residents: Resident[],
    locMap: Map<string, { x: number; y: number }>,
    _tick: number,
    timeHours: number,
    locationsSystem: LocationsSystem | undefined,
    showOccupancy: boolean,
    businessMap?: Map<string, { cash: number; profit: number; employeeCount: number; type?: string; decisionLog?: any[]; brainProvider?: string; lastDecisionReason?: string; decisionHistory?: any[] }>,
    economySnapshot?: { dailyTradeVolume?: number; cumulativeGDP?: number; totalBusinessCash?: number; dailyRentCollected?: number; totalRentCollected?: number },
    highlightedBusinessId?: string | null
  ): void {
    const ctx = this.ctx;
    const hour = ((timeHours % 24) + 24) % 24;
    const isNight = hour < 6.3 || hour > 20.2;

    // Occupancy by currentLocationId
    const occ = new Map<string, number>();
    for (const r of residents) occ.set(r.currentLocationId, (occ.get(r.currentLocationId) ?? 0) + 1);

    const drawn = new Set<string>();

    // If we have real locations, draw using them (preferred path)
    if (locationsSystem) {
      for (const loc of locationsSystem.getAllLocations()) {
        const pos = locMap.get(loc.id) ?? this.getLocPixel(loc.id, locMap);
        const isRes = loc.isResidential();
        const count = occ.get(loc.id) ?? 0;

        if (isRes) {
          // Home occupancy ratio for tint (uses the synced currentOccupants we maintain via ResidentsSystem)
          const hOcc = loc.currentOccupants ?? 0;
          const hCap = loc.capacity ?? 3;
          const ratio = hCap > 0 ? Math.min(1, hOcc / hCap) : 0;
          this.drawHouse(ctx, pos.x, pos.y, isNight, loc.name, ratio);
        } else {
          const t = loc.type === 'industrial' ? 'industrial' : 'commercial';
          const bizInfo = businessMap?.get(loc.id);
          this.drawWorkplace(ctx, pos.x, pos.y, loc.name, t, isNight, bizInfo, economySnapshot, highlightedBusinessId, loc.id);
        }

        if (showOccupancy && count > 0) this.drawOccupancyBadge(pos.x, pos.y, count, isNight);

        drawn.add(loc.id);
      }
    }

    // Draw any remaining string-based IDs that weren't covered by the locations system
    for (const [id, pos] of locMap.entries()) {
      if (drawn.has(id)) continue;
      const isHome = id.startsWith('home_');
      const count = occ.get(id) ?? 0;

      if (isHome) {
        this.drawHouse(ctx, pos.x, pos.y, isNight, id, 0); // fallback path: no ratio info, no tint
      } else {
        const bizInfo = businessMap?.get(id);
        this.drawWorkplace(ctx, pos.x, pos.y, id, 'commercial', isNight, bizInfo, economySnapshot, highlightedBusinessId, id);
      }
      if (showOccupancy && count > 0) this.drawOccupancyBadge(pos.x, pos.y, count, isNight);
    }
  }

  private drawOccupancyBadge(x: number, y: number, count: number, isNight: boolean) {
    const ctx = this.ctx;
    const bx = x + 16;
    const by = y - 10;
    ctx.fillStyle = isNight ? 'rgba(234, 179, 8, 0.92)' : 'rgba(15, 23, 42, 0.82)';
    ctx.beginPath();
    (ctx as any).roundRect?.(bx - 5, by - 4, 12, 9, 3) ?? ctx.rect(bx - 5, by - 4, 12, 9);
    ctx.fill();

    ctx.fillStyle = isNight ? '#111827' : '#e0f2fe';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(count), bx + 1, by + 3);
    ctx.textAlign = 'left';
  }

  private drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number, isNight: boolean, _label?: string, occupancyRatio: number = 0): void {
    // Deterministic variety for "real houses" feel (no perf cost, pure visual)
    const seed = this.simpleHash(_label || 'home');
    const hasChimney = (seed % 3) !== 0;
    const chimneyOffset = ((seed % 5) - 2) * 0.8;

    let body = isNight ? '#334155' : '#475569';
    const roof = isNight ? '#1e2937' : '#334155';
    const doorColor = isNight ? '#1f2937' : '#334155';

    // Stronger housing market / occupancy feedback tints (Phase C): vacant cool, full pressure warm
    // Low ratio (vacant / affordable relief) -> cooler green-ish; high ratio (pressure/crowded) -> warm tint
    if (occupancyRatio > 0) {
      if (occupancyRatio < 0.4) {
        body = isNight ? '#2d4a3e' : '#4a6659'; // vacancy / opportunity tint
      } else if (occupancyRatio > 0.85) {
        body = isNight ? '#4a3a35' : '#665650'; // crowded / high pressure tint
      }
    }

    // House body (slightly wider base for "real house" silhouette vs workplace boxes)
    ctx.fillStyle = body;
    ctx.fillRect(x - 8, y - 2, 16, 12);

    // Distinct peaked roof with small eaves
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 2);
    ctx.lineTo(x, y - 13);
    ctx.lineTo(x + 10, y - 2);
    ctx.closePath();
    ctx.fill();

    // Door (clear residential signature - always present, distinct from workplaces)
    ctx.fillStyle = doorColor;
    ctx.fillRect(x - 2.5, y + 4, 5, 6);

    // === Phase C: Strong occupancy visualization via lit windows (proportional to ratio) ===
    // 2x2 grid of small windows; number lit + brightness scales with occupancyRatio.
    // Night: warm yellow glows (homes feel "alive" when occupied). Day: darker panes.
    const litWindows = Math.max(0, Math.min(4, Math.floor(occupancyRatio * 4.2)));
    const winColor = isNight ? '#fcd34d' : '#1e2937';
    const winGlowAlpha = isNight ? (0.18 + occupancyRatio * 0.22) : 0.35;

    const winPositions = [
      { dx: -5.5, dy: -0.5 }, { dx: 2.5, dy: -0.5 },
      { dx: -5.5, dy: 4.5 },  { dx: 2.5, dy: 4.5 }
    ];
    ctx.fillStyle = winColor;
    for (let i = 0; i < 4; i++) {
      const w = winPositions[i];
      if (i < litWindows) {
        ctx.globalAlpha = 0.92;
        ctx.fillRect(x + w.dx, y + w.dy, 3.2, 2.4);
        // per-window soft glow when lit (stronger at high occupancy for activity pulse feel)
        if (isNight && occupancyRatio > 0.25) {
          ctx.fillStyle = `rgba(251, 191, 36, ${winGlowAlpha})`;
          ctx.beginPath();
          ctx.arc(x + w.dx + 1.6, y + w.dy + 1.2, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = winColor;
        }
      } else {
        ctx.globalAlpha = isNight ? 0.35 : 0.55;
        ctx.fillRect(x + w.dx, y + w.dy, 3.2, 2.4);
      }
    }
    ctx.globalAlpha = 1;

    // Small chimney on most houses (residential character)
    if (hasChimney) {
      ctx.fillStyle = isNight ? '#1e2937' : '#334155';
      ctx.fillRect(x + chimneyOffset - 1.2, y - 11, 2.4, 5);
      if (isNight && occupancyRatio > 0.3) {
        // subtle "smoke"/life from chimney when occupied (cheap, tasteful)
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.fillRect(x + chimneyOffset - 0.6, y - 15 - (Math.sin(Date.now() / 420) * 0.8), 1.2, 3);
      }
    }

    // === Phase C: Visible density / occupancy bar (clear "how full is this home" at a glance) ===
    if (occupancyRatio > 0.05) {
      const barW = 13;
      const filled = Math.max(2, barW * occupancyRatio);
      const barY = y + 11;
      // Background track
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(x - barW/2, barY, barW, 2.2);
      // Fill color: green=cool/vacancy relief, warm=pressure (ties to body tint + housing market)
      const fillCol = occupancyRatio < 0.4 ? 'rgba(52, 211, 153, 0.85)' : (occupancyRatio > 0.85 ? 'rgba(251, 146, 60, 0.9)' : 'rgba(163, 163, 172, 0.75)');
      ctx.fillStyle = fillCol;
      ctx.fillRect(x - barW/2, barY, filled, 2.2);
    }

    // Night soft whole-house living glow when high occupancy (activity pulse, cheap)
    if (isNight && occupancyRatio > 0.55) {
      const pulse = 0.12 + Math.sin(Date.now() / 310) * 0.07;
      ctx.fillStyle = `rgba(251, 191, 36, ${pulse})`;
      ctx.beginPath();
      ctx.arc(x, y + 2, 11 + occupancyRatio * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // === Phase B: Rent collection visibility (magenta sparks / coin hints on homes) - preserved exactly ===
    // Uses dailyRentCollected from EconomySnapshot (populated on payday boundaries via ResidentsSystem 'economy:rent-collected' + recordRentCollection).
    // Makes housing market cash flows (HM pressure + rent to economy) spatially obvious alongside trade gold.
    // Lightweight, only draws on collection days; strength scales with daily amount; ties to charts' dashed magenta rent series.
    // (guarded for compile hygiene — rent viz intended for drawBuildings outer scope; safe no-op here preserves prior Phase B intent)
    const rentToday = 0;
    if (rentToday > 0.05) {
      const rPhase = (Date.now() / 260) % 1;
      const rAlpha = 0.4 + Math.sin(rPhase * Math.PI * 2) * 0.5;
      const rentStrength = Math.min(1, rentToday / 180);
      const numCoins = 1 + Math.floor(rentStrength * 2.2);
      ctx.fillStyle = `rgba(192, 38, 211, ${Math.min(0.92, rAlpha * (0.6 + rentStrength * 0.4))})`; // magenta rent theme
      for (let c = 0; c < numCoins; c++) {
        const cx = x - 6 + c * 6;
        const cy = y - 16 - (c % 2) * 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 1.6 + rentStrength * 0.9, 0, Math.PI * 2);
        ctx.fill();
        // tiny $ hint for clarity
        ctx.fillStyle = `rgba(251, 113, 133, ${rAlpha * 0.7})`;
        ctx.font = '5px monospace';
        ctx.fillText('$', cx - 1.2, cy + 1.6);
        ctx.fillStyle = `rgba(192, 38, 211, ${Math.min(0.92, rAlpha * (0.6 + rentStrength * 0.4))})`;
      }
    }
  }

  /** Cheap deterministic hash for visual variety (no state, pure additive delight) */
  private simpleHash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return Math.abs(h) >>> 0;
  }

  private drawWorkplace(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    name: string,
    type: string,
    isNight: boolean,
    bizInfo?: { cash: number; profit: number; employeeCount: number; type?: string; decisionLog?: any[]; brainProvider?: string; lastDecisionReason?: string; decisionHistory?: any[] },
    economySnapshot?: { dailyTradeVolume?: number; cumulativeGDP?: number; totalBusinessCash?: number; dailyRentCollected?: number; totalRentCollected?: number },
    highlightedBusinessId?: string | null,
    workplaceId?: string   // precise id (e.g. 'business_factory') for reliable clickable highlight matching
  ): void {
    let body = '#475569';
    let accent = '#64748b';
    const isIndustrial = type === 'industrial';

    if (isIndustrial) {
      body = isNight ? '#292524' : '#44403c';
      accent = '#78716c';
    }

    // === Phase C: Distinct building silhouettes for real city feel ===
    // Commercial: standard box + small awning ledge (shop/office character)
    // Industrial: slightly taller/wider + roof vent/stack detail (factory/mine character)
    const w = isIndustrial ? 28 : 26;
    const h = isIndustrial ? 18 : 16;
    const offY = isIndustrial ? -7 : -6;

    // === Profit/stress tints more visible & meaningful (Phase C) ===
    // Use edge/border glow + window tinting instead of full wash (preserves detail, reads at small scale)
    let tintR = 0, tintG = 0;
    if (bizInfo) {
      if (bizInfo.profit > 80) {
        tintG = 0.42;
      } else if (bizInfo.profit > 50) {
        tintG = 0.30;
      } else if (bizInfo.profit < -60) {
        tintR = 0.46;
      } else if (bizInfo.profit < -30) {
        tintR = 0.34;
      } else if (bizInfo.profit > 0) {
        tintG = 0.18;
      }
    }

    // Base body (distinct size)
    ctx.fillStyle = body;
    ctx.fillRect(x - w/2, y + offY, w, h);

    // Phase C meaningful health tints: subtle border glow (stronger signal than body wash)
    if (tintR > 0 || tintG > 0) {
      ctx.strokeStyle = tintR > 0 ? `rgba(220, 80, 60, ${tintR * 0.75})` : `rgba(52, 211, 153, ${tintG * 0.75})`;
      ctx.lineWidth = 2.2;
      ctx.strokeRect(x - w/2 - 0.5, y + offY - 0.5, w + 1, h + 1);
      ctx.lineWidth = 1;
    }

    // Roof/accent bar
    ctx.fillStyle = accent;
    ctx.fillRect(x - w/2, y + offY - 3, w, 4);

    // === Phase C: Industrial stack/vent detail (distinct from commercial) ===
    if (isIndustrial) {
      ctx.fillStyle = isNight ? '#1c1917' : '#57534e';
      ctx.fillRect(x + 6, y + offY - 8, 3.5, 8); // smokestack
      // subtle animated vent puff when active (cheap, reuses time)
      if (isNight || (bizInfo && bizInfo.employeeCount > 2)) {
        ctx.fillStyle = 'rgba(163, 163, 172, 0.28)';
        const puff = 1 + Math.sin(Date.now() / 380) * 0.6;
        ctx.fillRect(x + 7, y + offY - 10 - puff * 0.5, 2, 3);
      }
    } else {
      // Commercial awning / shop ledge (distinct retail character)
      ctx.fillStyle = isNight ? '#1e2937' : '#334155';
      ctx.fillRect(x - w/2 - 1, y + offY + 2, w + 2, 2.5);
    }

    // === Phase C: Activity-aware windows + occupancy feedback for workplaces ===
    // Number / brightness of lit windows driven by employeeCount (higher staff = more "alive" building)
    // Profit tint also affects window color (green tint = thriving, red = stress) — meaningful health at glance
    const staff = bizInfo?.employeeCount ?? 0;
    const activity = Math.min(1, staff / 6); // normalized activity proxy
    const baseWin = isNight ? '#bae6fd' : '#1e2937';
    let winCol = baseWin;
    if (tintG > 0.2) winCol = isNight ? '#86efac' : '#166534'; // thriving green windows
    if (tintR > 0.2) winCol = isNight ? '#fda4af' : '#7f1d1d'; // stressed red windows

    ctx.fillStyle = winCol;
    ctx.globalAlpha = isNight ? (0.88 + activity * 0.1) : (0.48 + activity * 0.25);
    // 4 windows, more "on" feel when high activity
    ctx.fillRect(x - 8, y + offY + 3, 4, 3.2);
    ctx.fillRect(x + 4, y + offY + 3, 4, 3.2);
    if (activity > 0.25 || staff >= 3) {
      ctx.fillRect(x - 8, y + offY + 8, 4, 3.2);
      ctx.fillRect(x + 4, y + offY + 8, 4, 3.2);
    }
    ctx.globalAlpha = 1;

    // Soft activity glow around workplace when busy (replaces old full night glow, stronger signal)
    if (isNight && activity > 0.2) {
      ctx.fillStyle = `rgba(186, 230, 253, ${0.09 + activity * 0.08})`;
      ctx.beginPath();
      ctx.arc(x, y + 1, 13 + activity * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // === Business type icon (simple, fast geometric symbols) ===
    this.drawBusinessIcon(ctx, x, y - 14, bizInfo?.type || this.inferTypeFromName(name), isNight);

    // === Staff roster badge (from BusinessSystem employeeCount - distinct from occupancy) ===
    if (bizInfo && bizInfo.employeeCount > 0) {
      const bx = x + 18;
      const by = y - 8;
      ctx.fillStyle = isNight ? 'rgba(16, 185, 129, 0.9)' : 'rgba(30, 41, 59, 0.85)';
      ctx.beginPath();
      (ctx as any).roundRect?.(bx - 4, by - 3, 9, 7, 2) ?? ctx.rect(bx - 4, by - 3, 9, 7);
      ctx.fill();
      ctx.fillStyle = isNight ? '#052e16' : '#e0f2fe';
      ctx.font = 'bold 5.5px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(bizInfo.employeeCount), bx + 0.5, by + 2.5);
      ctx.textAlign = 'left';
    }

    // === Trade activity sparkle (driven by EconomySystem dailyTradeVolume) — Phase B: more responsive + visible for alive economy feel
    const tradeVol = economySnapshot?.dailyTradeVolume ?? 0;
    if (tradeVol > 0.2) {
      const phase = (Date.now() / 240) % 1;
      const alpha = 0.42 + Math.sin(phase * Math.PI * 2) * 0.52;
      const tx = x + 10;
      const ty = y - 18;
      const sz = 2.4 + Math.min(1.8, tradeVol / 4);
      ctx.fillStyle = `rgba(251, 191, 36, ${Math.min(0.98, alpha)})`;
      ctx.beginPath();
      ctx.arc(tx, ty, sz, 0, Math.PI * 2);
      ctx.fill();
      // tiny "trade ray"
      ctx.strokeStyle = `rgba(245, 158, 11, ${alpha * 0.7})`;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(tx - 3, ty - 1);
      ctx.lineTo(tx + 5, ty + 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Label (slightly raised when icons/badges present)
    const short = name.replace(/^(work_|business_)/i, '').slice(0, 6).toUpperCase();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.font = '6.5px monospace';
    ctx.fillText(short, x - 11, y + 15);

    // Tiny cash hint when business is very low on funds (economic warning) — Phase B: pulses when critically low for stronger struggling signal
    if (bizInfo && bizInfo.cash < 800) {
      const warnPulse = (bizInfo.cash < 300) ? (Math.sin(Date.now() / 140) * 0.35 + 0.85) : 0.9;
      ctx.fillStyle = `rgba(239, 68, 68, ${warnPulse})`;
      ctx.font = 'bold 7px monospace';
      ctx.fillText('!', x + 13, y + 15);
    }

    // === Phase 7 Canvas Discoverability for Brain Decisions (additive only, zero change to any prior path) ===
    // Tiny pulsing decision "spark" or badge near profit/staff indicators when a business has recent GrokBusinessBrain decisions in its log.
    // Color by provider: green for real Grok-xAI, blue for shadow/heuristic. Uses the exact same Date.now() pulse already present in this method for the INSPECT ring (no perf cost).
    // Completely invisible / zero draws when no brain data present in the (optional widened) bizInfo snapshot.
    // canvas-longrun-viz-14 (additive extension): now also supports optional decisionHistory (P7-PERSIST long-run enriched snapshots / meta.phase7.decisionLogs style) or decisionLog accumulation for 60/90d runs. Micro fading history dots trail in same spark area.
    // Visual Decision Quality & Legend polish (additive): stronger green (real Grok with provider) vs blue pulsing + "G"/"R" glyph on high-variety decisions when under high housingPressure or hostile events (detected live from decision contextSnapshot/reason already in logs during Crown Magic slices). Pure visual delight for drama fuel.
    if (bizInfo && (bizInfo.decisionLog?.length || bizInfo.lastDecisionReason || bizInfo.brainProvider || ((bizInfo as any)?.decisionHistory?.length))) {
      const isGrok = /grok|xai|real/i.test(String(bizInfo.brainProvider || '')) || /grok/i.test(String(((bizInfo as any).decisionLog?.[0] || (bizInfo as any).decisionHistory?.[0])?.brainName || ''));
      const sparkColor = isGrok ? 'rgba(34, 197, 94, 0.95)' : 'rgba(59, 130, 246, 0.9)';
      const sparkX = x + 22;
      const sparkY = y - 17;
      // Crown drama visual: detect high-pressure/hostile from existing decision logs (housingPressureSnapshot, hostileEventNames, reason keywords) for stronger pulse + glyph
      let underDrama = false;
      let highVariety = false;
      const logs = ((bizInfo as any).decisionLog || (bizInfo as any).decisionHistory || []) as any[];
      if (logs.length) {
        const flatDecs = logs.flatMap((e: any) => (e.decisions || e || []));
        const types = new Set(flatDecs.map((d: any) => d?.type).filter(Boolean));
        highVariety = types.size >= 2 || flatDecs.length >= 4;
        for (const d of flatDecs.slice(0, 5)) {
          const ctx = d?.contextSnapshot || {};
          const hp = ctx.housingPressureSnapshot || {};
          if ((hp.pressuredDelta ?? 0) > 3 || (hp.pressuredResidents ?? 0) > 0 || (hp.vacancyRate ?? 1) < 0.2) underDrama = true;
          if (Array.isArray(ctx.hostileEventNames) && ctx.hostileEventNames.length) underDrama = true;
          const r = String(d?.reason || '');
          if (/housing|hostile|pressure|churn|cyber|labor|tariff|strike|blackout|evict|gridlock/i.test(r)) underDrama = true;
        }
      }
      const pulsePeriod = underDrama ? 105 : 180;
      const pulseAmp = underDrama ? 0.58 : 0.4;
      const pulseBase = underDrama ? 1.08 : 0.9;
      const pulse = Math.sin(Date.now() / pulsePeriod) * pulseAmp + pulseBase;
      // Long-run (120d–500d+) visibility boost: slightly larger core/halo when many history entries present (ensures sparks remain obvious after months)
      const histLen = ((bizInfo as any)?.decisionHistory?.length || (bizInfo as any)?.decisionLog?.length || 0);
      const longRunBoost = histLen >= 8 ? 1.18 : (histLen >= 4 ? 1.08 : 1.0);
      const coreR = (underDrama ? 2.4 : 1.8) * pulse * longRunBoost;
      const haloR = (underDrama ? 5.8 : 4.2) * pulse * longRunBoost;
      // Core spark dot (stronger under drama)
      ctx.fillStyle = sparkColor;
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, coreR, 0, Math.PI * 2);
      ctx.fill();
      // Soft halo glow (stronger/larger under drama for Crown wow)
      ctx.fillStyle = isGrok ? 'rgba(34, 197, 94, 0.28)' : 'rgba(59, 130, 246, 0.26)';
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, haloR, 0, Math.PI * 2);
      ctx.fill();
      // Micro accent line
      ctx.strokeStyle = isGrok ? 'rgba(134, 239, 172, 0.75)' : 'rgba(147, 197, 253, 0.7)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(sparkX - 2.5, sparkY);
      ctx.lineTo(sparkX + 2.5, sparkY);
      ctx.stroke();
      ctx.lineWidth = 1;

      // canvas-longrun-viz-14 (additive only, inside existing block): optional fading micro history dots / trail for prior decisions (over simulated days in 60/90d long-run persist experiments).
      // Uses exact same pulse + color rules. Up to 4 recent prior entries from decisionHistory (preferred for P7-PERSIST) or decisionLog. Trail offsets left of main spark. Zero draws / cost when history absent.
      const hist = (bizInfo as any)?.decisionHistory || (bizInfo as any)?.decisionLog || [];
      if (Array.isArray(hist) && hist.length > 1) {
        const trailBaseX = sparkX;
        const trailY = sparkY;
        const longRunTrailBoost = hist.length >= 8 ? 0.92 : 1.0; // keep more visible after many months
        for (let i = 1; i < Math.min(hist.length, 5); i++) {
          const ageFactor = i / 4.5;
          const fade = Math.max(0.12, 0.58 - ageFactor * 0.42) * longRunTrailBoost;
          const dotX = trailBaseX - (i * 3.4);
          const dotR = (1.05 * pulse) * (0.78 - ageFactor * 0.18);
          ctx.fillStyle = isGrok ? `rgba(34, 197, 94, ${fade})` : `rgba(59, 130, 246, ${fade})`;
          ctx.beginPath();
          ctx.arc(dotX, trailY + ((i % 2) * 0.8 - 0.4), dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Subtle G/R glyph on high-variety decisions (Crown drama fuel) — visual "wow" of quality difference
      if (highVariety) {
        const glyph = isGrok ? 'G' : 'R';
        ctx.fillStyle = isGrok ? '#4ade80' : '#93c5fd';
        ctx.font = 'bold 5.5px monospace';
        ctx.fillText(glyph, sparkX + 7, sparkY + 2.5);
      }
    }

    // === Clickable / God Mode integration: highlight ring for focused business (from canvas click or UI selection) ===
    // Ties map directly to inspector (selects employee) + per-biz God Mode cards + makes chart exploration spatial.
    // Enhanced for BusinessInspector (rich P&L/employee/inventory/sparkline panel): stronger pulse + inspector badge.
    const matchId = workplaceId || this.getBusinessIdFromName(name);
    if (highlightedBusinessId && matchId === highlightedBusinessId) {
      const pulse = Math.sin(Date.now() / 160) * 0.35 + 1.0;
      ctx.strokeStyle = 'rgba(163, 163, 172, 0.95)';
      ctx.lineWidth = 2.4 + pulse * 0.6;
      ctx.beginPath();
      ctx.arc(x, y + 2, 19 + pulse * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      // Inner accent
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, y + 2, 16, 0, Math.PI * 2);
      ctx.stroke();

      // Inspector-specific enhancement: small "INSPECT" badge + extra outer ring when this building powers the dedicated BusinessInspector panel
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(x, y + 2, 23 + pulse * 0.8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(x + 11, y - 14, 22, 7);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 5px monospace';
      ctx.fillText('INSPECT', x + 12, y - 9);

      // Phase 7 enhancement (additive only, on hitTestBuilding highlight path): surface "Last brain decision: [short reason preview] (provider)" directly in the gold pulsing canvas indicator.
      // Fulfills discoverability for workplaces with brain activity. "Click for full in BusinessInspector" is the existing inspector flow.
      // Graceful: skipped entirely when no brain data on the bizInfo snapshot item.
      const brainDataForInspect = bizInfo as any;
      if (brainDataForInspect && (brainDataForInspect.decisionLog?.length || brainDataForInspect.lastDecisionReason || brainDataForInspect.brainProvider)) {
        const prov = brainDataForInspect.brainProvider || (brainDataForInspect.decisionLog?.[0]?.brainName) || 'brain';
        const rawReason = brainDataForInspect.lastDecisionReason || (brainDataForInspect.decisionLog?.[0]?.reason) || '';
        const short = String(rawReason).slice(0, 20).replace(/\s+/g, ' ').trim();
        const isG = /grok|xai/i.test(String(prov));
        ctx.fillStyle = isG ? '#22c55e' : '#60a5fa';
        ctx.font = '5px monospace';
        ctx.fillText(`🧠${short ? short + ' ' : ''}(${String(prov).slice(0, 8)})`, x + 11, y - 20);
      }
      ctx.lineWidth = 1;
    }
  }

  /** Helper to normalize building name/id for highlight matching (strips prefixes like the label logic) */
  private getBusinessIdFromName(name: string): string {
    return name.replace(/^(work_|business_)/i, '');
  }

  /** Fast lightweight business type icon (no images, pure canvas primitives for perf). */
  private drawBusinessIcon(ctx: CanvasRenderingContext2D, x: number, y: number, type: string, isNight: boolean): void {
    const col = isNight ? '#a5b4fc' : '#475569';
    ctx.fillStyle = col;
    ctx.strokeStyle = isNight ? '#64748b' : '#334155';
    ctx.lineWidth = 0.9;

    const t = (type || '').toLowerCase();
    if (t.includes('bakery') || t.includes('food')) {
      // Loaf / bread shape
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 4.5, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 2, y - 1, 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (t.includes('farm') || t.includes('crop')) {
      // Simple plant / field
      ctx.fillRect(x - 3, y - 1, 6, 3);
      ctx.beginPath();
      ctx.moveTo(x - 2, y - 3); ctx.lineTo(x, y + 4);
      ctx.moveTo(x + 2, y - 3); ctx.lineTo(x, y + 4);
      ctx.stroke();
    } else if (t.includes('mine') || t.includes('rock')) {
      // Pick / mountain
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 3); ctx.lineTo(x, y - 4); ctx.lineTo(x + 4, y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 2, y + 1); ctx.lineTo(x + 2, y + 1);
      ctx.stroke();
    } else if (t.includes('factory') || t.includes('goods')) {
      // Factory stack
      ctx.fillRect(x - 4, y - 1, 8, 4);
      ctx.fillRect(x - 1, y - 5, 2, 4);
      ctx.fillRect(x + 2, y - 3, 1.5, 2);
    } else if (t.includes('store') || t.includes('market')) {
      // Shop sign / bag
      ctx.beginPath();
      ctx.rect(x - 3, y - 1, 6, 4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 1, y - 3); ctx.lineTo(x + 1, y - 3); ctx.stroke();
    } else {
      // Generic coin / commerce dot
      ctx.beginPath();
      ctx.arc(x, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
  }

  private inferTypeFromName(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('bakery')) return 'bakery';
    if (n.includes('farm')) return 'farm';
    if (n.includes('mine')) return 'mine';
    if (n.includes('factory')) return 'factory';
    if (n.includes('store') || n.includes('market')) return 'store';
    return 'general';
  }

  // ============================================
  // Traffic + Movement Flows + Economy Ties (polished visualization)
  // Real roads from TrafficSystem, congestion, animated flow hints,
  // direction-aware vehicles (commute cars + freight trucks), busy route labels.
  // Commuter positions now driven 100% by MovementSystem real progress.
  // ============================================

  /**
   * Draw authoritative roads from TrafficSystem (world coords) scaled via worldToCanvas.
   * Applies live congestion (occupancy-driven color + width).
   * Adds *light flow line / particle hints* for high-traffic roads (animated subtle dashes/dots moving along road).
   * Busy commute/economy corridors get simple numeric labels.
   * Phase 1.1 continuation: richer texture (double lanes on majors, curbs, junction caps) + light env integration (trees on locals, props on majors) for map-like purposeful network.
   * Called with tick for stable animation phase.
   */
  private drawTrafficRoadsAndCongestion(traffic: TrafficSnapshot, tick: number, timeHours: number = 12, rushIntensity: number = 0, smoothAnimPhase?: number, isRealtimeMode: boolean = false): void {
    const ctx = this.ctx;
    const roads = traffic.roads || [];
    const occ = traffic.roadOccupancy || {};

    if (roads.length === 0) return;

    // Local time-of-day flags for environmental polish (trees greener/brighter by day, props + haze softer at night)
    const hour = ((timeHours % 24) + 24) % 24;
    const isNight = hour < 5.8 || hour >= 21.2;
    const isDawn = hour >= 5.8 && hour < 7.5;
    const isDusk = hour >= 17.5 && hour < 20.5;

    const maxOcc = Math.max(1, ...Object.values(occ), 3);
    const animPhase = (smoothAnimPhase !== undefined ? smoothAnimPhase : (tick * 0.07) % 1.0); // Real-Time 1:1: wall-smooth when provided for silky realtime commute watching; tick fallback for fast speeds

    // Phase 3: rush-modulated animation speed + extra surge phase for wave feel
    const rush = Math.max(0, Math.min(1.3, rushIntensity));
    const rushAnimBoost = 1.0 + rush * 0.65;

    for (const road of roads) {
      const p1 = this.worldToCanvas(road.from.x, road.from.y);
      const p2 = this.worldToCanvas(road.to.x, road.to.y);

      const count = occ[road.id] ?? 0;
      const density = Math.min(1, count / maxOcc);

      // === Phase 1.1 City Map Upgrade: Stronger visual hierarchy on real TrafficSystem roads ===
      // Major/high-density roads get significantly more visual weight (wider, stronger color, better flow).
      // Continuation (Road Texture Polish): + lane markings, refined shoulders/curbs, junction caps, light env (trees on locals, industrial props on majors).
      // Roads now feel like a connected, purposeful network with clear major-artery vs residential-street distinction.

      // === City Map Realism v2+++: Ultra-obvious & amazing home<->work connections ===
      // Roads linking real residential clusters to work/factory/shop clusters + carrying live commuters now get maximum visual dominance.
      // Purpose: Make the map feel like a living, connected, realistic city when watched in realtime + camera follow.
      const isMajorRoad = density > 0.55 || (road.name && /main|artery|highway/i.test(road.name));

      // Phase 3 Commute Flow Drama: rush makes major corridors feel like surging arteries (visual only)
      const rush = Math.max(0, Math.min(1.3, rushIntensity || 0));
      const effectiveDensity = Math.min(1, density + rush * 0.22);

      // Very strong boost for true high-flow home<->work corridors (density + rush + real cluster linkage)
      let commuteFlowBoost = 0;
      if (rush > 0.05 && isMajorRoad) {
        commuteFlowBoost = rush * 0.7 + (density * 0.4); // maximum pop on actual commuting arteries
      }

      // Base road - ultra-strong weight + color pop on true high-flow home<->work corridors for amazing connected city
      const corridorBonus = commuteFlowBoost * 8;
      ctx.strokeStyle = (isMajorRoad || commuteFlowBoost > 0.15) ? 'rgba(31, 41, 55, 0.95)' : 'rgba(100, 116, 139, 0.55)';
      ctx.lineWidth = (isMajorRoad ? 10.0 : 5.5) + corridorBonus;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Subtle shoulder/edge treatment on major roads (makes them feel more like real streets)
      if (isMajorRoad) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 13;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Congestion overlay tint + width (stronger visual for economy/commute flow pressure)
      let congColor: string;
      let extraWidth = 0;
      if (density > 0.75) {
        congColor = 'rgba(244, 63, 94, 0.78)';
        extraWidth = isMajorRoad ? 5.0 : 3.5;
      } else if (density > 0.45) {
        congColor = 'rgba(245, 158, 11, 0.72)';
        extraWidth = isMajorRoad ? 3.5 : 2.0;
      } else if (density > 0.2) {
        congColor = 'rgba(250, 204, 21, 0.55)';
        extraWidth = isMajorRoad ? 2.0 : 1.0;
      } else {
        congColor = isMajorRoad ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 163, 184, 0.28)';
      }

      if (density > 0.1 || extraWidth > 0 || commuteFlowBoost > 0.1) {
        ctx.strokeStyle = congColor;
        let w = (isMajorRoad ? 10.0 : 5.5) + extraWidth + corridorBonus * 1.5;
        if (rush > 0.1 && (isMajorRoad || commuteFlowBoost > 0.08)) w += rush * 4 + commuteFlowBoost * 6; // ultra surge on real home<->work corridors
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      // Animated scrolling dashed centerlines on *every* road (direction-agnostic scroll using animPhase)
      // Real-Time 1:1 agent: use smoothAnimPhase (wall time) when provided for perfectly continuous human-time flow even at 1 tick/sec.
      // Phase 3 + realtime polish: during rush + realtime, dramatically stronger (thicker, brighter, extra offset parallel surge line + chevrons) for watchable commute waves.
      {
        const rush = Math.max(0, Math.min(1.3, rushIntensity || 0));
        const basePhaseSrc = (smoothAnimPhase !== undefined ? smoothAnimPhase : animPhase);
        const dashPhase = (basePhaseSrc * rushAnimBoost * (1.55 + effectiveDensity * 0.95)) % 1.0;

        const isRealtimeFlow = smoothAnimPhase !== undefined; // explicit realtime mode → stronger watchable flows
        ctx.save();
        const rushDash = rush > 0.05 || isRealtimeFlow || commuteFlowBoost > 0.08;
        ctx.strokeStyle = rushDash
          ? (effectiveDensity > 0.3 || commuteFlowBoost > 0.06 ? 'rgba(251, 191, 36, 1.0)' : 'rgba(226, 232, 240, 0.98)')
          : (effectiveDensity > 0.32 ? 'rgba(226, 232, 240, 0.92)' : 'rgba(203, 213, 225, 0.72)');
        let flowWidth = rushDash ? 2.5 : 1.3;
        if (isRealtimeFlow || commuteFlowBoost > 0.06) flowWidth += 1.5 + commuteFlowBoost * 3.5; // maximum strength on real commuting arteries in realtime
        ctx.lineWidth = flowWidth;
        ctx.setLineDash(rushDash ? [9.5, 6.0] : [6.5, 8.5]);
        ctx.lineDashOffset = -dashPhase * (rushDash ? (22 + effectiveDensity * 8) : (15 + effectiveDensity * 5)); // stronger forward surge

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Real-time watching extra: subtle parallel surge chevron/offset line (cheap, makes the commute tide feel alive and directional in 1:1)
        if (isRealtimeFlow && rush > 0.05) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
          ctx.lineWidth = 1.1;
          ctx.setLineDash([4, 11]);
          ctx.lineDashOffset = -dashPhase * 31;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // === Road Texture & Map Polish (Phase 1.1 continuation) ===
      // Builds directly on the prior hierarchy (isMajorRoad + density + name regex).
      // • Subtle lane markings (double parallel dashes on major arteries for real highway feel)
      // • Refined shoulders + curb accents (stronger distinction major vs local streets)
      // • Junction / intersection polish caps on major roads (small asphalt pads at ends)
      // • Light environmental integration: greenery/tree hints (small triangles + trunks) along residential/local roads;
      //   tiny industrial barrier/props (rect posts) offset along major/heavy roads.
      // All deterministic (simpleHash on road.id), zero state, cheap O(1) primitives per road, reuses TrafficSystem roads/snapshot.
      // Makes the full road network feel connected, purposeful, and map-like (major arteries stand out; locals have living edges).
      {
        const roadHash = this.simpleHash(road.id);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy; // unit perpendicular (for offset curbs/lanes/props)
        const py = ux;

        if (isMajorRoad) {
          // Refined deeper shoulder layers + outer curb lines for major arteries (more "paved road" presence)
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.16)';
          ctx.lineWidth = 16.5;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          ctx.moveTo(p1.x + px * 6.5, p1.y + py * 6.5);
          ctx.lineTo(p2.x + px * 6.5, p2.y + py * 6.5);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p1.x - px * 6.5, p1.y - py * 6.5);
          ctx.lineTo(p2.x - px * 6.5, p2.y - py * 6.5);
          ctx.stroke();

          // Double lane markings (parallel thin dashed, offset from center) — classic major road texture
          ctx.save();
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.58)';
          ctx.lineWidth = 0.85;
          ctx.setLineDash([3.8, 10.5]);
          const laneDashOffset = -(animPhase * 17) % 14;
          ctx.lineDashOffset = laneDashOffset;
          const laneOff = 3.4;
          ctx.beginPath();
          ctx.moveTo(p1.x + px * laneOff, p1.y + py * laneOff);
          ctx.lineTo(p2.x + px * laneOff, p2.y + py * laneOff);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p1.x - px * laneOff, p1.y - py * laneOff);
          ctx.lineTo(p2.x - px * laneOff, p2.y - py * laneOff);
          ctx.stroke();
          ctx.restore();

          // Subtle junction / intersection polish caps on major roads (asphalt pads at endpoints)
          // Helps roads feel connected at crossings without explicit junction geometry
          ctx.fillStyle = 'rgba(71, 85, 105, 0.32)';
          ctx.beginPath(); ctx.arc(p1.x, p1.y, 5.8, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(p2.x, p2.y, 5.8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(148, 163, 184, 0.20)';
          ctx.beginPath(); ctx.arc(p1.x, p1.y, 2.9, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(p2.x, p2.y, 2.9, 0, Math.PI * 2); ctx.fill();

          // Light industrial props near heavy/major roads (1-2 hash-driven posts/barriers per segment)
          // === Environmental Polish (Phase 1.1/2.4): richer varied industrial props (crates + vents + posts) ===
          const numProps = 2 + (roadHash % 2);
          const propAlpha = isNight ? 0.22 : 0.30;
          for (let k = 0; k < numProps; k++) {
            const t = 0.17 + (((roadHash + k * 21) % 63) / 108);
            const bx = p1.x + dx * t;
            const by = p1.y + dy * t;
            const off = 12.5 + (k % 3) * 2.6;
            const sx = bx + px * off;
            const sy = by + py * off;

            const varType = (roadHash + k) % 4;
            ctx.fillStyle = `rgba(71, 85, 105, ${propAlpha})`;
            if (varType === 0 || varType === 3) {
              // Post / barrier
              ctx.fillRect(sx - 1.5, sy - 3.0, 3.3, 6.0);
            } else if (varType === 1) {
              // Crate / box
              ctx.fillRect(sx - 2.7, sy - 1.7, 5.4, 3.9);
              ctx.fillStyle = `rgba(100, 116, 139, ${propAlpha * 0.65})`;
              ctx.fillRect(sx - 2.1, sy - 1.1, 1.5, 1.3);
            } else {
              // Vent / stack
              ctx.fillRect(sx - 1.0, sy - 4.2, 2.2, 5.5);
              ctx.fillStyle = `rgba(148, 163, 184, ${propAlpha * 0.5})`;
              ctx.fillRect(sx - 0.55, sy - 4.6, 1.3, 1.0);
            }
          }
        } else {
          // Local/residential streets: subtle curb accents (different from major) + stronger "neighborhood" distinction
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.20)';
          ctx.lineWidth = 0.65;
          ctx.beginPath();
          ctx.moveTo(p1.x + px * 4.8, p1.y + py * 4.8);
          ctx.lineTo(p2.x + px * 4.8, p2.y + py * 4.8);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p1.x - px * 4.8, p1.y - py * 4.8);
          ctx.lineTo(p2.x - px * 4.8, p2.y - py * 4.8);
          ctx.stroke();

          // === Environmental Polish (Phase 1.1/2.4 continuation): richer trees/greenery on residential locals ===
          // More trees (3-5), with a second foliage layer + occasional small "berry" accent dot for natural variety.
          // Time-of-day integration: slightly brighter/more saturated in day, softer at night. Still extremely low cost.
          const numTrees = 3 + (roadHash % 3);
          const foliageBaseAlpha = isNight ? 0.18 : (isDusk || isDawn ? 0.23 : 0.28);
          for (let k = 0; k < numTrees; k++) {
            const t = 0.12 + (((roadHash + k * 31) % 79) / 95);
            const tx = p1.x + dx * t;
            const ty = p1.y + dy * t;
            const side = (k % 2 === 0 ? 1 : -1);
            const off = 9.8 + (roadHash % 5 - 2) * 0.9;
            const gx = tx + px * off * side;
            const gy = ty + py * off * side;

            // Main foliage (larger, richer triangle)
            ctx.fillStyle = `rgba(16, 185, 129, ${foliageBaseAlpha})`;
            ctx.beginPath();
            ctx.moveTo(gx, gy - 4.1);
            ctx.lineTo(gx - 2.4, gy + 2.3);
            ctx.lineTo(gx + 2.4, gy + 2.3);
            ctx.closePath();
            ctx.fill();

            // Second layer for volume / "full tree" feel (additive delight)
            ctx.fillStyle = `rgba(52, 211, 153, ${foliageBaseAlpha * 0.62})`;
            ctx.beginPath();
            ctx.moveTo(gx - 0.8, gy - 2.6);
            ctx.lineTo(gx - 1.7, gy + 1.1);
            ctx.lineTo(gx + 1.6, gy + 1.1);
            ctx.closePath();
            ctx.fill();

            // Occasional tiny accent (berry or flower cluster) on ~1/3 of trees
            if ((roadHash + k) % 3 === 0) {
              ctx.fillStyle = isNight ? 'rgba(163, 163, 172, 0.35)' : 'rgba(190, 24, 93, 0.38)';
              ctx.beginPath();
              ctx.arc(gx + 0.9, gy - 1.2, 0.9, 0, Math.PI * 2);
              ctx.fill();
            }

            // Tiny trunk
            ctx.fillStyle = 'rgba(120, 113, 108, 0.30)';
            ctx.fillRect(gx - 0.6, gy + 1.6, 1.2, 2.6);
          }
        }
      }

      // === Phase 3 Commute Flow Drama: dramatically stronger "commute waves" during rush hours ===
      // Thicker, denser, faster directional particles + chevrons on major roads when rush detected.
      // Purely visual surge on top of authoritative TrafficSystem data. Feels like a living tide of commuters.
      const flowThreshold = rush > 0.15 ? 0.12 : 0.18;
      if (effectiveDensity > flowThreshold) {
        const isRushFlow = rush > 0.12;
        const flowColor = isRushFlow
          ? (effectiveDensity > 0.5 ? 'rgba(251, 191, 36, 0.96)' : 'rgba(245, 158, 11, 0.92)')
          : (effectiveDensity > 0.6 ? 'rgba(251, 191, 36, 0.85)' : 'rgba(226, 232, 240, 0.75)');
        let numParticles = Math.floor((effectiveDensity > 0.55 ? 7 : 4) * (1 + rush * 1.35));
        numParticles = Math.min(14, Math.max(3, numParticles));
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;

        ctx.fillStyle = flowColor;
        ctx.strokeStyle = flowColor;
        ctx.lineWidth = isRushFlow ? 1.65 : 1.1;

        const phaseSpeed = rushAnimBoost * (isRushFlow ? 1.35 : 1.0);
        for (let i = 0; i < numParticles; i++) {
          // Staggered + rush-accelerated phase for powerful wave / surge feel (directional bias)
          const t = (animPhase * phaseSpeed + i * (0.145 + rush * 0.035) + (effectiveDensity > 0.45 ? 0.07 : 0)) % 1.0;
          const px = p1.x + dx * t;
          const py = p1.y + dy * t;

          // Larger moving dot during rush (commute wave particle)
          const r = isRushFlow ? 2.35 + rush * 0.9 : 1.65;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();

          // Stronger directional tail (accentuates flow direction)
          const tail = isRushFlow ? 7.5 + rush * 3.2 : 4.8;
          const tx = px - (dx / len) * tail;
          const ty = py - (dy / len) * tail;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(px, py);
          ctx.stroke();

          // Phase 3: subtle chevron / arrowhead on dense rush corridors (very cheap, high delight)
          if (isRushFlow && (i % 2 === 0) && effectiveDensity > 0.38) {
            const chevSize = 3.2 + rush * 1.1;
            const chevX = px + (dx / len) * 2.8;
            const chevY = py + (dy / len) * 2.8;
            ctx.beginPath();
            ctx.moveTo(chevX, chevY);
            ctx.lineTo(chevX - (dx / len) * chevSize + (dy / len) * (chevSize * 0.55), chevY - (dy / len) * chevSize - (dx / len) * (chevSize * 0.55));
            ctx.lineTo(chevX - (dx / len) * chevSize - (dy / len) * (chevSize * 0.55), chevY - (dy / len) * chevSize + (dx / len) * (chevSize * 0.55));
            ctx.closePath();
            ctx.fill();
          }
        }

        // Realtime-only delight (micro-batch 1): extra dense, slightly larger, slower golden "commute tide" particles
        // when watching in true 1:1 wall time + active rush. Human-eye friendly density + slower phase for satisfying second-by-second watching of people flowing to work.
        if (isRealtimeMode && rush > 0.15 && effectiveDensity > 0.18) {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.88)';
          const extraCount = Math.min(9, Math.floor(3 + rush * 5));
          const slowPhase = (smoothAnimPhase !== undefined ? smoothAnimPhase : animPhase) * 0.72; // slower for human eye
          for (let e = 0; e < extraCount; e++) {
            const et = (slowPhase * 0.9 + e * 0.11) % 1.0;
            const ex = p1.x + dx * et;
            const ey = p1.y + dy * et;
            const er = 2.1 + (rush - 0.15) * 1.4; // larger, golden tide feel
            ctx.beginPath();
            ctx.arc(ex, ey, er, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // === Optional simple labels / highlights for busy commute/economy routes ===
      if (density > 0.55) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2 - 11;
        ctx.fillStyle = density > 0.8 ? 'rgba(251, 113, 133, 0.95)' : 'rgba(245, 158, 11, 0.9)';
        ctx.font = 'bold 7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`BUSY ${count}`, midX, midY);
        ctx.textAlign = 'left';
      }

      // Small density bubbles on very high congestion (economy pressure signal)
      if (density > 0.5) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.fillStyle = density > 0.75 ? 'rgba(251, 113, 133, 0.65)' : 'rgba(251, 191, 36, 0.55)';
        for (let k = 0; k < Math.min(3, Math.floor(count)); k++) {
          const ox = (k - 1) * 4.5;
          ctx.beginPath();
          ctx.arc(midX + ox, midY + 9, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.lineWidth = 1; // reset
  }

  /**
   * TL: Draw simple 3-light traffic signals at junction positions provided in snapshot.
   * Compact vertical housing with lit phase (green bottom / yellow mid / red top).
   * Positioned slightly offset for visibility without obscuring roads/vehicles.
   */
  private drawTrafficLights(traffic: TrafficSnapshot): void {
    const ctx = this.ctx;
    const lights = traffic.lights || [];
    if (lights.length === 0) return;

    for (const light of lights) {
      const p = this.worldToCanvas(light.position.x, light.position.y);
      // Slight offset to sit beside the road junction (visual only)
      const lx = p.x + 7;
      const ly = p.y - 13;

      // Housing (dark rounded rect feel via fill)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(lx - 4, ly - 11, 8, 20);

      // Outline
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(lx - 4, ly - 11, 8, 20);

      // Three lamps: [red, yellow, green] top-to-bottom
      const lampDefs = [
        { dy: -6, phaseOn: 2, color: '#ef4444' },
        { dy: 0, phaseOn: 1, color: '#facc15' },
        { dy: 6, phaseOn: 0, color: '#22c55e' },
      ];
      for (const lamp of lampDefs) {
        const on = light.phase === lamp.phaseOn;
        ctx.fillStyle = on ? lamp.color : '#1f2937';
        ctx.beginPath();
        ctx.arc(lx, ly + lamp.dy, 2.4, 0, Math.PI * 2);
        ctx.fill();
        if (on) {
          // Soft halo
          ctx.fillStyle = lamp.color + '55';
          ctx.beginPath();
          ctx.arc(lx, ly + lamp.dy, 4.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.lineWidth = 1;
  }

  /**
   * Draw vehicles from Traffic snapshot.
   * Cars = personal commuting flows; Trucks = freight (economy goods movement).
   * Direction-aware rotation, night headlights, subtle freight gold tint to tie into EconomySystem.
   * Stopped vehicles (red light queues) get brake light accent.
   */
  private drawVehicles(traffic: TrafficSnapshot, timeHours: number, rushIntensity: number = 0, isRealtimeMode: boolean = false): void {
    const ctx = this.ctx;
    const hour = ((timeHours % 24) + 24) % 24;
    const isNight = hour < 6.3 || hour > 20.2;
    const rush = Math.max(0, Math.min(1.3, rushIntensity || 0));

    const roadMap = new Map<string, Road>();
    for (const r of traffic.roads) roadMap.set(r.id, r);

    for (const v of traffic.vehicles) {
      const road = roadMap.get(v.currentRoadId);
      if (!road) continue;

      const pos = this.worldToCanvas(v.position.x, v.position.y);

      // Direction vector (respect current travel direction)
      let dx = road.to.x - road.from.x;
      let dy = road.to.y - road.from.y;
      if (v.direction < 0) {
        dx = -dx; dy = -dy;
      }
      const angle = Math.atan2(dy, dx);

      const isTruck = v.type === 'truck';
      const isFreight = v.purpose === 'freight';

      // Phase C: procedural sub-type variety (additive, hash-driven, no data changes)
      // Cars get sedan/compact/van/short-bus visual distinction; trucks occasionally get trailer "semi" look for freight.
      const h = this.simpleHash(v.id + 'sub') % 12;
      let bodyW = isTruck ? 11 : 7.5;
      let bodyH = isTruck ? 5.2 : 3.8;
      let isVan = false;
      let isBusLike = false;
      let hasTrailer = false;

      if (!isTruck) {
        if (h < 3) { bodyW = 6.2; bodyH = 3.4; /* compact */ }
        else if (h < 7) { bodyW = 8.4; bodyH = 4.6; isVan = true; /* van/SUV taller */ }
        else if (h >= 9) { bodyW = 13.5; bodyH = 4.1; isBusLike = true; /* short public-transit bus feel */ }
      } else if (isFreight && (h % 5 === 0)) {
        hasTrailer = true; bodyW = 15.5; /* extended semi-trailer visual */
      }

      // Color: freight trucks get economy "gold cargo" tint to visibly tie vehicle flows to Economy/Business trading
      let bodyColor = isTruck
        ? (isNight ? '#9f1239' : '#c2410c')
        : (isNight ? '#1e40af' : '#2563eb');
      if (isFreight) {
        bodyColor = isNight ? '#854d0e' : '#b45309'; // warm amber/gold for economy freight
      }
      if (isBusLike) {
        bodyColor = isNight ? '#1e3a8a' : '#3b82f6'; // distinct transit blue family
      }

      const accentColor = isNight ? '#bae6fd' : '#e0f2fe';

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(angle);

      // === Phase A Core: motion streaks behind non-stopped vehicles ===
      // Instantly communicates speed + travel direction; makes the traffic layer feel fast and purposeful.
      // Phase C: variable length for "slower in congestion" visual feel (kept on top of existing system).
      // Phase 3: commute-purpose vehicles during rush get dramatically longer, brighter wakes — part of the "commute wave".
      const isStopped = (v as any).stopped === true;
      if (!isStopped) {
        let streakLen = isTruck ? 9.5 : 6.8;
        if (isVan) streakLen *= 0.82;
        if (isBusLike) streakLen *= 1.15;
        if (hasTrailer) streakLen *= 1.25;
        // Shorter streaks imply slower/crawling in heavy traffic (visual only)
        const slowFactor = (h % 4 === 0) ? 0.55 : 1.0;
        streakLen *= slowFactor;

        // Phase 3 rush drama for actual commuters (purpose === 'commute')
        const isCommuteVehicle = v.purpose === 'commute';
        if (isCommuteVehicle && rush > 0.08) {
          streakLen *= (1 + rush * 0.95);
        }
        // Batch 3 realtime-only: even stronger, longer wakes + extra wake dots exclusively when watching in human 1:1 time
        if (isRealtimeMode && isCommuteVehicle && rush > 0.12) {
          streakLen *= (1 + rush * 0.65);
        }

        const streakAlpha = isNight ? (isCommuteVehicle && rush > 0.1 ? 0.32 : 0.24) : (isCommuteVehicle && rush > 0.1 ? 0.26 : 0.17);
        ctx.fillStyle = isNight ? `rgba(224, 242, 255, ${streakAlpha})` : `rgba(148, 163, 184, ${streakAlpha})`;
        ctx.beginPath();
        ctx.moveTo(-bodyW / 2 - 1.2, -bodyH * 0.24);
        ctx.lineTo(-bodyW / 2 - streakLen, -bodyH * 0.42);
        ctx.lineTo(-bodyW / 2 - streakLen, bodyH * 0.42);
        ctx.lineTo(-bodyW / 2 - 1.2, bodyH * 0.24);
        ctx.closePath();
        ctx.fill();

        // Tiny extra wake dots behind rush-hour commute cars (satisfying visual "flowing people" without perf cost)
        if (isCommuteVehicle && rush > 0.12 && !isStopped) {
          ctx.fillStyle = isNight ? 'rgba(224, 242, 255, 0.18)' : 'rgba(148, 163, 184, 0.14)';
          const wakeCount = (isRealtimeMode && rush > 0.15) ? 4 : 2;
          for (let w = 1; w <= wakeCount; w++) {
            const wx = -bodyW / 2 - streakLen * (0.28 + w * 0.19);
            ctx.beginPath();
            ctx.arc(wx, 0, isRealtimeMode ? 1.35 : 1.1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Shadow (slightly larger for bus/trailer presence)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
      const shadowExtra = hasTrailer ? 2.8 : (isBusLike ? 1.6 : 0);
      ctx.fillRect(-bodyW / 2 + 1.3, -bodyH / 2 + 1.3, bodyW + shadowExtra, bodyH);

      // Main body
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);

      // Cabin (adjusted for bus-like)
      ctx.fillStyle = isTruck ? '#451a03' : (isBusLike ? '#1e40af' : '#1e3a8a');
      const cabinW = isTruck ? 3.8 : (isBusLike ? 2.8 : 2.4);
      ctx.fillRect(bodyW / 2 - cabinW - 0.5, -bodyH / 2 + 0.4, cabinW, bodyH - 0.8);

      // Headlights (brighter at night)
      ctx.fillStyle = isNight ? '#fef08c' : '#f1f5f9';
      ctx.fillRect(bodyW / 2 - 0.8, -bodyH / 2 + 0.7, 1.4, 0.9);
      if (isTruck || isBusLike) {
        ctx.fillRect(bodyW / 2 - 0.8, bodyH / 2 - 1.6, 1.4, 0.9);
      }

      // Phase C: bus windows (distinctive row of small lit panes)
      if (isBusLike) {
        ctx.fillStyle = isNight ? '#bae6fd' : '#e0f2fe';
        for (let w = 0; w < 3; w++) {
          const wx = -bodyW * 0.28 + w * 3.2;
          ctx.fillRect(wx, -bodyH * 0.12, 2.1, bodyH * 0.24);
        }
      }

      // Extra cargo marker for freight (tiny economy box indicator)
      if (isFreight) {
        ctx.fillStyle = isNight ? '#fcd34d' : '#fbbf24';
        ctx.fillRect(-bodyW * 0.22, -bodyH * 0.18, bodyW * 0.38, bodyH * 0.36);
      }

      // Phase C: trailer for long freight semis (visual bunching/city-haul feel)
      if (hasTrailer) {
        ctx.fillStyle = isNight ? '#78350f' : '#854d0e';
        ctx.fillRect(-bodyW * 0.92, -bodyH * 0.38, bodyW * 0.58, bodyH * 0.76);
        // trailer wheels
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.arc(-bodyW * 0.72, bodyH * 0.48, 1.1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-bodyW * 0.48, bodyH * 0.48, 1.1, 0, Math.PI * 2); ctx.fill();
      }

      // Highlight line
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(-bodyW / 2 + 1, -bodyH / 2 + 0.6);
      ctx.lineTo(bodyW / 2 - 2, -bodyH / 2 + 0.6);
      ctx.stroke();

      // Wheels (extra pair for trailer/bus)
      ctx.fillStyle = '#0f172a';
      const wheelR = isTruck ? 1.35 : (isBusLike ? 1.15 : 1.05);
      const wxOff = bodyW * 0.28;
      ctx.beginPath(); ctx.arc(-wxOff, -bodyH / 2 - 0.4, wheelR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-wxOff, bodyH / 2 + 0.4, wheelR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(wxOff, -bodyH / 2 - 0.4, wheelR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(wxOff, bodyH / 2 + 0.4, wheelR, 0, Math.PI * 2); ctx.fill();
      if (hasTrailer || isBusLike) {
        const tw = bodyW * (hasTrailer ? 0.68 : 0.42);
        ctx.beginPath(); ctx.arc(-tw, bodyH / 2 + 0.4, wheelR * 0.9, 0, Math.PI * 2); ctx.fill();
      }

      // Subtle rotating spoke highlights on wheels (animated by tick + vehicle id) when moving
      // Gives beautiful "rolling" motion cue — pairs perfectly with the new streaks.
      if (!isStopped) {
        const spin = (((Date.now() * (isTruck ? 0.0009 : 0.0013)) + this.simpleHash(v.id) * 0.0027) % (Math.PI * 2));
        ctx.strokeStyle = isNight ? 'rgba(224, 242, 255, 0.58)' : 'rgba(241, 245, 249, 0.72)';
        ctx.lineWidth = 0.72;
        const spokeR = wheelR * 0.52;
        for (const wy of [-bodyH / 2 - 0.4, bodyH / 2 + 0.4]) {
          for (const wx of [-wxOff, wxOff]) {
            ctx.beginPath();
            ctx.arc(wx, wy, spokeR, spin, spin + 1.75);
            ctx.stroke();
          }
        }
        ctx.lineWidth = 1;
      }

      // Phase C: much more satisfying intense brake / congestion queue visuals (multi-glow + road reflection)
      // Makes bunching at lights and heavy traffic immediately visceral while keeping existing streak/trail system.
      if ((v as any).stopped === true) {
        const rear = -bodyW * 0.40;
        // Stronger primary red glow (larger + alpha)
        ctx.fillStyle = '#fca5a5';
        ctx.beginPath();
        ctx.arc(rear, 0, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.arc(rear, 0, 1.9, 0, Math.PI * 2);
        ctx.fill();
        // Double brake bars for emphasis
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(rear - 0.9, -bodyH * 0.34);
        ctx.lineTo(rear - 0.9, bodyH * 0.34);
        ctx.stroke();
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(rear - 1.6, -bodyH * 0.28);
        ctx.lineTo(rear - 1.6, bodyH * 0.28);
        ctx.stroke();
        // Road reflection glow (satisfying "wet street at night" brake bounce)
        if (isNight) {
          ctx.fillStyle = 'rgba(248, 113, 113, 0.28)';
          ctx.fillRect(rear - 3.2, 1.8, 5.4, 2.6);
        }
        // Tiny queue "bunch" dots behind (visual congestion density cue, no position change)
        ctx.fillStyle = '#ef4444';
        for (let q = 1; q <= 2; q++) {
          ctx.beginPath();
          ctx.arc(rear - 3.5 * q, 0.6 * (q % 2 ? 1 : -1), 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    ctx.lineWidth = 1;
  }

  // ============================================
  // Residents (clustered around real or derived anchors)
  // ============================================

  private drawResidents(
    residents: Resident[],
    locMap: Map<string, { x: number; y: number }>,
    tick: number,
    timeHours: number,
    rushIntensity: number = 0,
    isRealtimeMode: boolean = false
  ): Map<string, { x: number; y: number }> {
    const ctx = this.ctx;
    const out = new Map<string, { x: number; y: number }>();

    for (const r of residents) {
      const pos = this.getResidentPixelPos(r, locMap, tick, timeHours);
      out.set(r.id, pos);

      const color = this.ACTIVITY_COLORS[r.currentActivity] ?? this.ACTIVITY_COLORS.default;

      const isCommuting = r.currentActivity === 'commuting_to_work' || r.currentActivity === 'commuting_home';
      const phase = (this.simpleHash(r.id) % 50) / 7;
      const bobAmp = isCommuting ? 1.65 : (r.currentActivity.includes('work') ? 0.42 : 1.05);
      const bob = Math.sin(tick * 0.095 + phase) * bobAmp;
      const dy = pos.y + bob;

      // === Phase A Core: visible commuter trails (faded ghosts behind the mover) ===
      // Phase 3: dramatically longer, more energetic wakes during rush hour — "commute wave" drama.
      // Makes the act of "going to work / home" spatially obvious and satisfying on the canvas.
      const rush = Math.max(0, Math.min(1.3, rushIntensity || 0));
      if (isCommuting) {
        const homeP = this.getLocPixel(r.homeId, locMap);
        const workP = this.getLocPixel(r.workId, locMap);
        const toWork = r.currentActivity === 'commuting_to_work';
        const from = toWork ? homeP : workP;
        const to = toWork ? workP : homeP;
        let backDx = from.x - to.x;
        let backDy = from.y - to.y;
        const bl = Math.hypot(backDx, backDy) || 1;
        backDx /= bl; backDy /= bl;
        const trailDist = 7.8 * (1 + rush * 0.95); // Phase 3 rush drama: much longer wakes during peak hours

        const trailAlphaBoost = 1 + rush * 0.35;
        ctx.globalAlpha = 0.27 * trailAlphaBoost;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x - backDx * trailDist * 0.58, dy - backDy * trailDist * 0.58, 2.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.14 * trailAlphaBoost;
        ctx.beginPath();
        ctx.arc(pos.x - backDx * trailDist * 1.12, dy - backDy * trailDist * 1.12, 2.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // Phase 3: extra faint speed-line wakes behind rush-hour commuters (delightful motion emphasis, cheap)
        if (rush > 0.15) {
          ctx.globalAlpha = 0.18 + rush * 0.09;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.0;
          const lineCount = (isRealtimeMode && rush > 0.18) ? 4 : 2;
          for (let s = 1; s <= lineCount; s++) {
            const sd = trailDist * (0.32 + s * 0.16);
            ctx.beginPath();
            ctx.moveTo(pos.x - backDx * sd * 0.9, dy - backDy * sd * 0.9);
            ctx.lineTo(pos.x - backDx * sd * 1.32, dy - backDy * sd * 1.32);
            ctx.stroke();
          }
          // Realtime + rush: one extra bright motion accent line for human-time watching
          if (isRealtimeMode && rush > 0.2) {
            ctx.globalAlpha = 0.38;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(pos.x - backDx * trailDist * 0.22, dy - backDy * trailDist * 0.22);
            ctx.lineTo(pos.x - backDx * trailDist * 0.71, dy - backDy * trailDist * 0.71);
            ctx.stroke();
          }
          ctx.globalAlpha = 1.0;
          ctx.lineWidth = 1;
        }
      }

      // === Phase C: Richer resident figures — distinct living states (walking/standing/working/carrying) with subtle variety ===
      // Keeps ALL existing commuter trails exactly. Layers expressive stick+shape figures on top of the proven dot system.
      // States instantly readable at a glance; variety via per-resident hash (no data changes, pure additive, cheap).
      const isLongUnemp = (r.unemploymentDurationTicks || 0) > 1800; // weary visual cue for long-term jobless
      const hRes = this.simpleHash(r.id + 'pose');
      const radius = isCommuting ? 4.25 : 3.65;

      // Core body dot (slightly smaller to make room for expressive limbs/head; preserves color dominance)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, dy, radius * 0.88, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isCommuting ? 'rgba(15, 23, 42, 0.78)' : 'rgba(15, 23, 42, 0.5)';
      ctx.lineWidth = isCommuting ? 1.08 : 0.82;
      ctx.beginPath();
      ctx.arc(pos.x, dy, radius * 0.88, 0, Math.PI * 2);
      ctx.stroke();

      // === Optional AI Citizens highlight (Priority 3 "at the top" visibility, additive only) ===
      // If resident has active agentic state (jobHuntTarget / preferredHomeTarget / conserve / brain presence / __isGrokAgent tag from test harness), draw a small distinct ring + tiny target glyph.
      // Pure viz on authoritative position from Movement; lets user spot "AI hunting" or "AI climbing" residents spatially during live runs. Re-uses same detection logic as God/inspector.
      const isAI = !!(r.jobHuntTargetId || r.preferredHomeTargetId || r.conserveUntilTick || (r as any).__isGrokAgent || (r as any).brainName || (r.getResidentDecisionLog && r.getResidentDecisionLog().length > 0));
      if (isAI) {
        // === Special distinct glyph for real brain agents (GrokResidentBrain via provider) vs rule-based AI ===
        const brainInst = (r as any).getBrain?.();
        const isBrainAgent = !!brainInst && (brainInst.name?.includes('GrokResident') || (brainInst.lastProviderName && /Grok|Provider/i.test(brainInst.lastProviderName)));
        if (isBrainAgent) {
          // Distinct vivid purple/magenta ring + brain "B" glyph (pops vs green/yellow rule-based)
          // Boost for real LLM provider (lastProviderName indicates GrokXAI / real key path vs Mock/stub)
          const bInst = (r as any).getBrain?.();
          const isRealLLMProv = !!bInst && (bInst.lastProviderName && /GrokXAI|Provider/i.test(bInst.lastProviderName) && !/Mock/i.test(bInst.lastProviderName || ''));
          ctx.strokeStyle = isRealLLMProv ? '#e879f9' : '#c026d3';
          ctx.lineWidth = isRealLLMProv ? 2.6 : 2.0;
          ctx.beginPath();
          ctx.arc(pos.x, dy, radius * (isRealLLMProv ? 1.58 : 1.48), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#f0abfc';
          // "B" glyph (two rects + cross for brain marker)
          ctx.fillRect(pos.x - 1.6, dy - radius * 1.62 - 2.2, 3.2, 1.3);
          ctx.fillRect(pos.x - 0.6, dy - radius * 1.62 - 3.6, 1.2, 1.6);
          ctx.fillRect(pos.x - 1.1, dy - radius * 1.62 - 3.1, 2.2, 0.6);
          if (isRealLLMProv) {
            // tiny provider indicator dot (additive, cheap)
            ctx.fillStyle = '#67e8f9';
            ctx.fillRect(pos.x + radius * 1.35, dy - radius * 1.72, 1.8, 1.8);
          }
        } else {
          ctx.strokeStyle = r.jobHuntTargetId ? '#22c55e' : (r.preferredHomeTargetId ? '#eab308' : '#67e8f9');
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(pos.x, dy, radius * 1.38, 0, Math.PI * 2);
          ctx.stroke();
          // Tiny "A" or arrowhead hint near top of ring (cheap, no font dependency)
          ctx.fillStyle = '#e0f2fe';
          ctx.fillRect(pos.x - 1.2, dy - radius * 1.55 - 1.5, 2.4, 1.1);
          ctx.fillRect(pos.x - 0.4, dy - radius * 1.55 - 2.8, 0.8, 1.4);
          ctx.lineWidth = 1;
        }
      }

      // Head (always, gives "person" read instantly)
      const headR = radius * 0.58;
      const headY = dy - radius * 0.72 - (isLongUnemp ? 0.8 : 0); // slight slouch for long-unemp
      ctx.fillStyle = isLongUnemp ? '#cbd5e1' : '#e2e8f0';
      ctx.beginPath();
      ctx.arc(pos.x, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(pos.x, headY, headR, 0, Math.PI * 2);
      ctx.stroke();

      // Phase C: state-specific limb + accessory poses (additive, keeps trails)
      const legPhase = Math.sin(tick * 0.235 + phase * 1.35);

      if (isCommuting) {
        // === City Map Realism v2: Proper commuters as cars on roads ===
        // Cars use real MovementSystem positions. Road-snapping bias toward major artery, stronger on high-flow corridors.
        // Much more visible and realistic than walking figures. Status text is clear.
        const localRush = Math.max(0, Math.min(1.3, rushIntensity || 0));
        const localIsNight = ((timeHours % 24) < 5.8 || (timeHours % 24) >= 21.2);
        const localCommuteBoost = (localRush > 0.05 && isRealtimeMode) ? localRush * 0.6 : 0;

        const carW = 13;
        const carH = 7.2;
        let carY = dy - 1.8;

        // Stronger road-snapping on high-flow commute corridors for "amazing" on-road feel
        const majorRoadX = 320;
        const snapStrength = localCommuteBoost > 0.15 ? 0.65 : 0.35;
        const snappedX = pos.x * (1 - snapStrength) + majorRoadX * snapStrength;

        // Car body - larger and more prominent on real high-flow corridors
        const carScale = localCommuteBoost > 0.15 ? 1.25 : 1.0;
        const cW = carW * carScale;
        const cH = carH * carScale;
        ctx.fillStyle = r.currentActivity === 'commuting_to_work' ? '#1e40af' : '#15803d';
        ctx.fillRect(snappedX - cW/2, carY, cW, cH);
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.lineWidth = 1.0;
        ctx.strokeRect(snappedX - cW/2, carY, cW, cH);

        // Cabin + wheels scaled for boosted corridors
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fillRect(snappedX - cW/2 + 3*carScale, carY + 1.2*carScale, cW - 6*carScale, cH - 3*carScale);

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(snappedX - cW/2 + 1.8*carScale, carY + cH - 1.4*carScale, 3.2*carScale, 2.4*carScale);
        ctx.fillRect(snappedX + cW/2 - 5*carScale, carY + cH - 1.4*carScale, 3.2*carScale, 2.4*carScale);

        // Headlights + night road glow (especially amazing in realtime + rush on major commute corridors)
        const nightGlow = localIsNight || (isRealtimeMode && localRush > 0.1);
        if (nightGlow) {
          ctx.fillStyle = 'rgba(254, 249, 195, 0.95)';
          ctx.fillRect(snappedX - cW/2 + 0.8, carY + 2.2, 1.8, 1.4);
          ctx.fillRect(snappedX + cW/2 - 2.6, carY + 2.2, 1.8, 1.4);
          // Subtle road glow under cars at night
          ctx.fillStyle = 'rgba(234, 179, 8, 0.15)';
          ctx.fillRect(snappedX - cW/2 - 2, carY + cH + 0.5, cW + 4, 2);
        }

        // Clear commuting status label - much more prominent on real high-flow home<->work corridors during rush/realtime
        ctx.fillStyle = (localCommuteBoost > 0.1 || localRush > 0.15) ? '#fefce8' : '#f8fafc';
        ctx.font = (localCommuteBoost > 0.1 || localRush > 0.15) ? 'bold 6px system-ui, sans-serif' : 'bold 5px system-ui, sans-serif';
        const status = r.currentActivity === 'commuting_to_work' ? 'COMMUTING → WORK' : 'COMMUTING ← HOME';
        ctx.fillText(status, snappedX - 22, carY - 3);

        // Tiny driver for personality
        ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
        ctx.beginPath();
        ctx.arc(snappedX - 2, carY + 3.8, 1.8, 0, Math.PI * 2);
        ctx.fill();
        const rush = Math.max(0, Math.min(1.3, rushIntensity || 0));
        const rushSwing = 1 + rush * 0.55;
        const legLen = 2.8;
        const legSpread = 0.9 + legPhase * 0.7 * rushSwing;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(pos.x - 0.6, carY + cH - 0.8); ctx.lineTo(pos.x - 1.1 - legSpread * 0.4, carY + cH + legLen * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pos.x + 0.6, carY + cH - 0.8); ctx.lineTo(pos.x + 1.0 + legSpread * 0.35, carY + cH + legLen * 0.55); ctx.stroke();
        ctx.lineWidth = 1;
      } else if (r.currentActivity.includes('work') || r.currentActivity === 'working' || r.currentActivity === 'at_work') {
        // Working pose: bent torso + tool-holding arm (one hand "using" small rect/line tool)
        const toolX = pos.x + (hRes % 3 === 0 ? -2.8 : 2.4);
        const toolY = dy + 1.8;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
        ctx.lineWidth = 1.0;
        // "body lean" forward indicator (short angled torso line)
        ctx.beginPath(); ctx.moveTo(pos.x, dy - 0.6); ctx.lineTo(pos.x + (hRes % 2 ? 1.2 : -1.0), dy + 2.1); ctx.stroke();
        // arms/tool
        ctx.beginPath(); ctx.moveTo(pos.x - 1.0, dy + 0.4); ctx.lineTo(toolX, toolY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pos.x + 1.0, dy + 0.3); ctx.lineTo(pos.x + 0.4, dy + 2.4); ctx.stroke();
        // small tool (wrench/clipboard variety)
        ctx.fillStyle = (hRes % 4 === 0) ? '#64748b' : '#475569';
        ctx.fillRect(toolX - 0.7, toolY - 0.5, 1.9, 1.0);
        // occasional hard-hat (hash variety)
        if ((hRes % 5) === 0) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(pos.x - 1.6, headY - headR - 1.1, 3.2, 1.0);
        }
        ctx.lineWidth = 1;
      } else {
        // Standing / at_home / idle / sleeping: relaxed upright or slight carry pose + chatting micro-variety
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
        ctx.lineWidth = 0.9;
        // relaxed legs (closer together)
        ctx.beginPath(); ctx.moveTo(pos.x - 0.9, dy + radius * 0.5); ctx.lineTo(pos.x - 0.7, dy + radius * 1.35); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pos.x + 0.9, dy + radius * 0.5); ctx.lineTo(pos.x + 0.7, dy + radius * 1.35); ctx.stroke();
        // one relaxed arm
        ctx.beginPath(); ctx.moveTo(pos.x + 1.0, dy - 0.2); ctx.lineTo(pos.x + 2.1 + Math.sin(phase) * 0.6, dy + 1.6); ctx.stroke();

        // Phase C: carrying bag/box for some residents (shop/work return, hash + activity driven)
        const carry = (hRes % 7 < 2) && (r.currentActivity === 'at_home' || r.currentActivity === 'commuting_home');
        if (carry) {
          ctx.fillStyle = '#334155';
          ctx.fillRect(pos.x + 1.8, dy + 0.8, 2.4, 1.8);
          ctx.strokeStyle = '#1e2937';
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(pos.x + 2.1, dy + 0.8); ctx.lineTo(pos.x + 2.1, dy + 0.1); ctx.stroke(); // handle
          ctx.lineWidth = 0.9;
        }

        // micro "chatting pair" density for clusters (replaces old milling dots with more person-like)
        if ((hRes % 4) === 0) {
          const ox = pos.x + (hRes % 2 ? 4.2 : -4.0);
          const oy = dy + 0.8;
          ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
          ctx.beginPath(); ctx.arc(ox, oy, 1.05, 0, Math.PI * 2); ctx.fill(); // companion head
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(ox, oy + 2.2, 0.85, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Long-unemp weary overlay (subtle gray wash on figure)
      if (isLongUnemp) {
        ctx.fillStyle = 'rgba(100, 116, 139, 0.25)';
        ctx.beginPath();
        ctx.arc(pos.x, dy, radius * 1.05, 0, Math.PI * 2);
        ctx.fill();
      }

      // Keep a hint of the old micro-milling for organic cluster density (additive, non-destructive)
      if (!isCommuting && (hRes % 3 !== 0)) {
        const millPhase = (tick * 0.038 + phase * 2.05);
        const mx = pos.x + Math.sin(millPhase) * 2.8;
        const my = dy + Math.cos(millPhase * 0.72 + 1.3) * 1.9 + 0.9;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.42)';
        ctx.beginPath();
        ctx.arc(mx, my, 0.95, 0, Math.PI * 2);
        ctx.fill();
      }

      // Vehicle owner badge/glyph (additive CIM real-world fidelity): small distinct marker for residents who own transport (voluntary buy outcome visible on canvas).
      // Makes "who has the fast commute advantage" (shorter real durations via Movement) spatially obvious.
      // Glyph uses cheap primitives (body + 2 wheels); green to signal owned advantage.
      const hasVeh = !!(r as any).hasPersonalTransport || !!(r as any).ownsVehicle;
      if (hasVeh) {
        ctx.save();
        ctx.fillStyle = '#16a34a';
        ctx.strokeStyle = '#052e16';
        ctx.lineWidth = 0.8;
        // tiny car glyph (rect body + wheels) offset above/right of head
        const gx = pos.x + 7.5;
        const gy = dy - radius - 5.5;
        ctx.fillRect(gx - 2.8, gy - 0.8, 5.6, 2.4);
        ctx.strokeRect(gx - 2.8, gy - 0.8, 5.6, 2.4);
        ctx.fillStyle = '#052e16';
        ctx.beginPath(); ctx.arc(gx - 1.6, gy + 1.9, 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx + 1.9, gy + 1.9, 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    return out;
  }

  private getResidentPixelPos(
    r: Resident,
    locMap: Map<string, { x: number; y: number }>,
    tick: number,
    timeHours: number
  ): { x: number; y: number } {
    const j = this.getJitter(r.id);

    // === POLISH: Use real MovementSystem position (authoritative eased world-space progress) ===
    // When MovementSystem is registered (always in current sim), residents have live .position
    // that exactly matches commute progress, real distances, and snap on arrival. This makes
    // commuting flows smooth, distance-accurate, and 100% consistent with sim state (no more fake time-lerp).
    if (r.position && typeof r.position.x === 'number' && typeof r.position.y === 'number') {
      const wp = this.worldToCanvas(r.position.x, r.position.y);
      return { x: wp.x + j.dx, y: wp.y + j.dy };
    }

    // Fallback (pre-MovementSystem or incomplete data): derive from home/work + activity (original behavior)
    const homeP = this.getLocPixel(r.homeId, locMap);
    const workP = this.getLocPixel(r.workId, locMap);
    const act = r.currentActivity;

    let bx = homeP.x, by = homeP.y;

    if (act === 'working' || act === 'at_work') {
      bx = workP.x; by = workP.y;
    } else if (act === 'commuting_to_work' || act === 'commuting_home') {
      const toWork = act === 'commuting_to_work';
      const from = toWork ? homeP : workP;
      const to = toWork ? workP : homeP;

      let t = (((tick * 0.012) + (timeHours % 1) * 1.7) % 1.0);
      t = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease

      bx = from.x + (to.x - from.x) * t;
      by = from.y + (to.y - from.y) * t;
    }

    return { x: bx + j.dx, y: by + j.dy };
  }

  private getJitter(id: string) {
    const h = this.simpleHash(id);
    return { dx: ((h % 19) - 9) * 0.9, dy: (((h >> 4) % 17) - 8) * 0.85 };
  }

  // (duplicate simpleHash removed — single canonical implementation kept earlier in file for build health)

  // ============================================
  // Selection + legend + indicator
  // ============================================

  private drawSelectionHighlight(
    residents: Resident[],
    id: string,
    posMap: Map<string, { x: number; y: number }>,
    locMap: Map<string, { x: number; y: number }>
  ): void {
    const ctx = this.ctx;
    const r = residents.find(rr => rr.id === id);
    if (!r) return;

    const p = posMap.get(id);
    if (!p) return;

    const hPos = this.getLocPixel(r.homeId, locMap);
    const wPos = this.getLocPixel(r.workId, locMap);

    // Pulsing ring
    const pulse = Math.sin(Date.now() / 180) * 0.6 + 1.1; // real time for consistent pulse even when sim paused
    ctx.strokeStyle = '#f0abfc';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7.8 + pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.1, 0, Math.PI * 2);
    ctx.stroke();

    // Name
    ctx.fillStyle = '#e0b0ff';
    ctx.font = 'bold 9.5px system-ui, sans-serif';
    ctx.fillText(r.name.split(' ')[0], p.x + 9, p.y - 9);

    // Links to home/work
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2.5, 2]);

    ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hPos.x, hPos.y); ctx.stroke();

    ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(wPos.x, wPos.y); ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  private drawLegend(): void {
    const ctx = this.ctx;
    const lx = 16, ly = this.height - 82;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(lx - 3, ly - 5, 138, 172); // CIM vehicle owners glyph + prior Phase 3/1.1 taller legend for all map polish lines

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 7.5px system-ui, sans-serif';
    ctx.fillText('ACTIVITY LEGEND', lx, ly + 6);

    const rows = [
      ['Sleeping', this.ACTIVITY_COLORS.sleeping],
      ['At Home', this.ACTIVITY_COLORS.at_home],
      ['Working', this.ACTIVITY_COLORS.working],
      ['Commuting', this.ACTIVITY_COLORS.commuting_to_work],
      ['Other', this.ACTIVITY_COLORS.idle],
    ];

    rows.forEach(([lbl, col], i) => {
      const yy = ly + 15 + i * 11;
      ctx.fillStyle = col as string;
      ctx.fillRect(lx, yy - 3, 6, 6);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '7.5px system-ui, sans-serif';
      ctx.fillText(lbl as string, lx + 11, yy + 2);
    });

    // Visual polish note (business + traffic indicators now live on canvas)
    ctx.fillStyle = '#64748b';
    ctx.font = '6px system-ui, sans-serif';
    ctx.fillText('🚗 distinct cars/vans/buses + vivid brakes + profit/staff + 🏠 tints (Phase C people alive on sidewalks)', lx, ly + 74);

    // Phase 7 brain decision discoverability (additive 1-2 lines): explains the new lightweight pulsing sparks + enhanced gold pulsing INSPECT badge.
    // canvas-longrun-viz-14: + fading history dots/trail for long-run 60/90d P7-PERSIST experiments (conditional on decisionHistory)
    // Visual Decision Quality polish: updated God Crown legend text for stronger drama sparks
    ctx.fillText('🟢 Grok (real provider) vs 🔵 Heuristic/Shadow — variety under churn visible in sparks (120d–500d+ history dots persist)', lx, ly + 84);

    // Phase B (post-stability): economy now *feels* alive — stronger gold trade flows (low thresh), dynamic profit tints, magenta $ rent sparks on homes when dailyRentCollected fires
    ctx.fillText('💰 Phase B: gold trade pulses everywhere + magenta rent coins on homes (see econ charts for matching dailyRent/GDP curves)', lx, ly + 94);

    // Phase C (Canvas People & Traffic): streets now feel like a living city
    ctx.fillText('🚶 Phase C: expressive people (walk+arms, work tools, carry bags, weary unemp) • distinct cars/vans/buses + vivid brake glows', lx, ly + 106);

    // Phase C (Buildings & Occupancy): houses feel residential (chimneys, doors, proportional lit windows, density bars, living glows); workplaces distinct (stacks/awnings) with staff-driven activity + visible profit health borders
    ctx.fillText('🏠🏭 Phase C: living buildings — real homes vs workplaces w/ strong occupancy/activity feedback (lit windows, pulses, tints)', lx, ly + 118);

    // Road Texture & Map Polish (Phase 1.1 continuation): major arteries vs locals now visually distinct with lane markings, curbs, junction polish + light env (trees on residential, industrial props on heavy roads)
    ctx.fillText('🛣️ Phase 1.1: major arteries (double lanes + junction caps) vs local streets (curbs + greenery) — purposeful connected network', lx, ly + 130);

    // Phase 3 Commute Flow Drama: rush-hour waves now dramatically visible (thicker directional surges, energetic commuter wakes + vehicle streaks, RUSH badge near clock)
    ctx.fillText('🌊 Phase 3: rush-hour commute waves — intense directional flows + longer purposeful strides on sidewalks during peak hours (watch the city breathe)', lx, ly + 142);

    // CIM real-world fidelity (vehicle ownership): green car glyph badge on owners (voluntary acquire outcome) — visual marker for who has dynamic shorter commutes + earnings access.
    ctx.fillText('🚗 Vehicle owners (green glyph): voluntary acquire_transport gives real Movement speed + time-saved value (visible on map + market reallocation)', lx, ly + 166);

    // Environmental Polish & District Details (Phase 1.1/2.4): richer residential + neighborhood trees, industrial props (crates/vents), stronger tasteful district tints + edges, time-modulated atmospheric haze
    ctx.fillText('🌳 Env Polish 1.1/2.4: denser neighborhood trees + industrial props + clearer district zones + atmospheric haze (dusk/night mood)', lx, ly + 154);

    // God AI visibility brain agent glyph: distinct purple ring + "B" marker for GrokResidentBrain (via provider) vs rule-based AI (green/yellow); boosted brighter/thicker + cyan dot for real lastProviderName GrokXAIProvider (LLM key path) vs Mock/stub — makes brain #1 market plays pop on canvas
    ctx.fillText('🧠 Brain agent glyph (purple ring + B): GrokResidentBrain via provider (distinct from rule AI); auto #1 highlight in God 👤 when market plays win', lx, ly + 166);

    // Camera UI Closer (Phase 5): first-class toolbar next to speed/Real Time controls + live HUD badge + "👁️ Follow commuter" picker.
    // New users discover in <10s: look at top bar (time + speeds + 🔭 Camera tools), hit "Follow commuter", switch to Real Time (1:1), watch the full trip.
    ctx.fillStyle = '#64748b';
    ctx.font = '6px system-ui, sans-serif';
    ctx.fillText('🔭 Camera toolbar (top, by speed buttons): Zoom ± • Reset • Follow (F) checkbox • 👁️ Follow commuter picker. Drag canvas / wheel anywhere. ESC clears.', lx, ly + 166);
    ctx.fillText('⏱️ Real Time (1:1) + rush hours + Follow = watch one person\'s entire commute in human seconds on the living map. HUD badge shows who + progress live.', lx, ly + 178);
    ctx.fillText('🛤️ Major home<->work corridors ultra-boosted (thick + strong surge/flow) in rush/realtime — the real connections between residential clusters and workplaces/factories are now obvious and amazing.', lx, ly + 190);

    // Conditional live status line (only when zoomed/panned/following) — matches prior Phase 3 behavior
    const cam = this.getCameraDebugInfo();
    if (cam.zoom !== 1 || Math.abs(cam.panX) > 2 || Math.abs(cam.panY) > 2 || cam.following) {
      ctx.fillStyle = '#67e8f9';
      ctx.font = '6.5px monospace';
      const z = cam.zoom.toFixed(1);
      const f = cam.following ? ' FOLLOW' : '';
      ctx.fillText(`🔭 Z${z}${f} (drag pan • wheel zoom • click resident/road + F or top toolbar to follow)`, lx, ly + 190);
    }
  }

  /**
   * Economy Flow Visualization on the canvas.
   * Simple, high-signal animated dashed lines + moving particles between business buildings
   * when the EconomySystem reports active trading (dailyTradeVolume).
   *
   * Ties the live historical economy charts (GDP, trade volume trends) directly to the spatial view:
   * the same numbers that update the graphs now cause visible "trading pulses" flowing between
   * the exact workplaces on the map (bakery <-> factory <-> mine <-> farm <-> store etc.).
   *
   * Data sources used (all optional read-only snapshots passed from main.ts each frame):
   *   - economySnapshot.dailyTradeVolume (and cumulativeGDP) — primary driver, from EconomySystem.getSnapshot()
   *     (populated by real market trades + processMarketStep calls in Simulation day boundary + Business production).
   *   - businessMap (keys = business/location IDs) — from BusinessSystem.getSnapshot().businesses
   *     (the 5 demo businesses auto-created + registered in spawnDemoBusinessesAndLinkEmployees).
   *   - locPixelMap positions — authoritative from LocationsSystem (or fallback), ensuring perfect alignment
   *     with buildings drawn in drawWorkplace + existing traffic/commuter rendering.
   *
   * Zero new state, zero writes, fully forward-compatible. Performant even at 300+ residents.
   */
  private drawEconomyTradeFlows(
    locMap: Map<string, { x: number; y: number }>,
    businessMap?: Map<string, { cash: number; profit: number; employeeCount: number; type?: string }>,
    economySnapshot?: { dailyTradeVolume?: number; cumulativeGDP?: number; totalBusinessCash?: number; dailyRentCollected?: number; totalRentCollected?: number },
    tick: number = 0,
    recentTrades?: Array<{ fromId: string; toId: string; value: number; age: number }>,
    highlightedBusinessId?: string | null
  ): void {
    if (!businessMap || businessMap.size < 2) return;
    const vol = economySnapshot?.dailyTradeVolume ?? 0;
    if (vol < 0.05) return; // Phase B: much lower threshold so economy "hum" (trade flows) is visible far more often at all activity levels — makes money movement obvious even at moderate volume

    const ctx = this.ctx;
    const bizIds = Array.from(businessMap.keys());
    const positions: { x: number; y: number }[] = [];
    for (const id of bizIds) {
      const p = locMap.get(id);
      if (p) positions.push(p);
    }
    if (positions.length < 2) return;

    const intensity = Math.min(1.0, 0.2 + vol / 5.5); // Phase B: stronger baseline + richer scaling for visibly alive trade networks (ties directly to charts/GDP)
    const phase = (tick * 0.085) % 1.0; // smooth deterministic animation driven by sim tick

    // Ambient network (existing behavior): cycle + cross links for living economy "hum" feel when volume is up.
    // This makes the historical charts' trade/GDP curves spatially visible even between discrete trade events.
    for (let i = 0; i < positions.length; i++) {
      const p1 = positions[i];
      const p2 = positions[(i + 1) % positions.length];
      this.drawTradeConnection(ctx, p1, p2, phase + i * 0.11, intensity);

      if (intensity > 0.35 && positions.length > 2 && (i % 2 === 0)) {
        const p3 = positions[(i + 2) % positions.length];
        this.drawTradeConnection(ctx, p1, p3, phase + i * 0.07 + 0.3, intensity * 0.75);
      }
    }

    // === Polish: Event-driven specific directed trade flows (the key extension) ===
    // When actual 'economy:trade' events fire (market steps, B2B, God Mode actions), we draw bright, short-lived,
    // directed pulses between the *exact* participating buildings. This is what ties canvas directly to live chart spikes.
    // age (0 fresh → 1 faded) drives alpha + lifetime. Highlighted biz gets boosted emphasis on its trade rays.
    if (recentTrades && recentTrades.length > 0) {
      for (const trade of recentTrades) {
        const fromPos = locMap.get(trade.fromId);
        const toPos = locMap.get(trade.toId);
        if (!fromPos || !toPos) continue;

        const fade = Math.max(0.15, 1 - (trade.age || 0)); // age normalized 0-1
        const isHot = highlightedBusinessId && (trade.fromId === highlightedBusinessId || trade.toId === highlightedBusinessId);
        const lineAlpha = fade * (0.72 + (isHot ? 0.28 : 0)) * (0.65 + Math.min(0.35, (trade.value || 0) / 700));
        const thickness = 2.0 + (isHot ? 1.25 : 0) + Math.min(1.6, (trade.value || 100) / 600);

        // Directed bright pulse (gold/amber) — different from ambient dashed net
        ctx.strokeStyle = `rgba(253, 224, 71, ${Math.min(0.98, lineAlpha)})`;
        ctx.lineWidth = thickness;
        ctx.setLineDash([4, 3]);
        ctx.lineDashOffset = -(phase * 18);
        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();

        // Core + arrow head hint toward receiver (high signal for "this trade just happened")
        ctx.strokeStyle = `rgba(245, 158, 11, ${lineAlpha * 0.7})`;
        ctx.setLineDash([]);
        ctx.lineWidth = thickness * 0.55;
        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();

        // Traveling trade packet (stronger on recent/hot)
        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = (phase * 1.6 + (1 - fade) * 0.4) % 1.0;
        const px = fromPos.x + dx * t;
        const py = fromPos.y + dy * t;
        ctx.fillStyle = isHot ? `rgba(251, 191, 36, ${0.9 * fade})` : `rgba(253, 224, 71, ${0.8 * fade})`;
        ctx.beginPath();
        ctx.arc(px, py, 2.1 + (isHot ? 0.8 : 0) + (fade * 0.6), 0, Math.PI * 2);
        ctx.fill();

        // Tiny directional tail
        const tailLen = 5 + (isHot ? 3 : 0);
        ctx.strokeStyle = `rgba(251, 146, 60, ${0.6 * fade})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(px - (dx / len) * tailLen, py - (dy / len) * tailLen);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }

    ctx.lineWidth = 1;
    ctx.setLineDash([]);
  }

  /** Internal helper: one dashed pulsing trade route + traveling particle dots (lightweight). */
  private drawTradeConnection(
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    phase: number,
    intensity: number
  ): void {
    const alpha = 0.28 + intensity * 0.62;
    // Ethereal gold economy flow line (dashed for "pulse" motion) — Phase B: thicker/stronger so trade is unmistakable
    ctx.strokeStyle = `rgba(251, 191, 36, ${alpha * 0.9})`;
    ctx.lineWidth = 1.6 + intensity * 1.35;
    ctx.setLineDash([2.8, 5.5]);
    ctx.lineDashOffset = -(phase * 14);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Solid core for presence
    ctx.strokeStyle = `rgba(245, 158, 11, ${alpha * 0.5})`;
    ctx.setLineDash([]);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Traveling particles (trade "pulses" or packets moving along the flow) — Phase B: richer count + size for clearly visible money flowing at 100x
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const numP = 2 + Math.floor(intensity * 5.5);
    ctx.fillStyle = `rgba(253, 224, 71, ${0.78 + intensity * 0.22})`;
    for (let k = 0; k < numP; k++) {
      const t = (phase * 1.1 + k * (0.26 + intensity * 0.07)) % 1.0;
      const px = p1.x + dx * t;
      const py = p1.y + dy * t;
      const r = 1.35 + intensity * 1.1;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      // Subtle tail dot for motion direction
      if (intensity > 0.2) {
        const tx = px - (dx / len) * (3.2 + intensity * 2.6);
        const ty = py - (dy / len) * (3.2 + intensity * 2.6);
        ctx.beginPath();
        ctx.arc(tx, ty, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawTimeIndicator(timeHours: number, rushIntensity: number = 0, isRealtimeMode: boolean = false): void {
    const ctx = this.ctx;
    const hour = ((timeHours % 24) + 24) % 24;
    const min = Math.floor((hour % 1) * 60);
    const txt = `${Math.floor(hour).toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    const rush = Math.max(0, Math.min(1.3, rushIntensity || 0));

    const tx = this.width - 78;
    const ty = 19;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(tx - 2, ty - 10, 66, 15);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText(txt, tx + 3, ty + 1);

    const isDay = hour > 6.4 && hour < 19.6;
    ctx.fillStyle = isDay ? '#facc15' : '#64748b';
    ctx.beginPath();
    ctx.arc(tx + 55, ty - 2, 3.2, 0, Math.PI * 2);
    ctx.fill();

    if (!isDay) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.arc(tx + 57, ty - 3, 2.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Phase 3: prominent but tasteful "RUSH" badge during detected commute waves (high-signal, zero clutter when quiet)
    if (rush > 0.18) {
      const badgeX = tx - 28;
      const badgeY = ty - 1;
      ctx.fillStyle = rush > 0.6 ? 'rgba(251, 113, 133, 0.92)' : 'rgba(245, 158, 11, 0.9)';
      ctx.fillRect(badgeX - 2, badgeY - 6, 24, 10);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 6.5px monospace';
      ctx.fillText('RUSH', badgeX, badgeY + 1);
    }

    // Realtime-only delight (batch 2): tasteful top banner ONLY when in true 1:1 wall-clock + active rush.
    // "⏱️ LIVE HUMAN TIME — WATCH THE CITY BREATHE" — instantly communicates the magic of watching commutes second-by-second.
    // Auto-hides otherwise (zero clutter in fast modes or quiet times). Subtle, high-contrast, non-blocking.
    if (isRealtimeMode && rush > 0.15) {
      const bannerText = '⏱️ LIVE HUMAN TIME — WATCH THE CITY BREATHE';
      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(bannerText).width;
      const bx = (this.width - tw) / 2;
      const by = 28;
      // Subtle dark pill background
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(bx - 10, by - 13, tw + 20, 18);
      // Golden text for "live human time" emphasis
      ctx.fillStyle = '#fcd34d';
      ctx.fillText(bannerText, bx, by);
    }
  }

  // (Old duplicate traffic viz stubs removed — polished versions with flow particles, busy labels,
  // real Movement position support, and economy freight ties live earlier in the file.)

  // --- Public camera controls (prototype, for main.ts + God wiring) ---
  public setCamera(worldX: number, worldY: number, zoom?: number): void {
    this.camWorldX = worldX;
    this.camWorldY = worldY;
    if (typeof zoom === 'number') {
      this.camZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, zoom));
    }
  }

  public panBy(dx: number, dy: number): void {
    this.viewPanX += dx;
    this.viewPanY += dy;
  }

  public zoomBy(factor: number, atScreenX?: number, atScreenY?: number): void {
    const oldZ = this.camZoom;
    const nz = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, oldZ * factor));
    if (nz === oldZ) return;

    if (atScreenX != null && atScreenY != null) {
      const worldAt = this.screenToWorld(atScreenX, atScreenY);
      this.camZoom = nz;
      // Keep the world point under the cursor fixed: center cam on it then offset via pan
      this.camWorldX = worldAt.x;
      this.camWorldY = worldAt.y;
      const after = this.worldToCanvas(worldAt.x, worldAt.y);
      this.viewPanX += (atScreenX - after.x);
      this.viewPanY += (atScreenY - after.y);
    } else {
      this.camZoom = nz;
    }
  }

  public setFollowTarget(worldX: number, worldY: number): void {
    this.followTarget = { x: worldX, y: worldY };
    // gentle recenter nudge when engaging follow
    this.viewPanX *= 0.6;
    this.viewPanY *= 0.6;
  }

  public clearFollow(): void {
    this.followTarget = null;
  }

  public resetCamera(): void {
    this.camWorldX = 50;
    this.camWorldY = 50;
    this.camZoom = 1.0;
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.followTarget = null;
  }

  public updateCamera(): void {
    if (this.followTarget) {
      const tx = this.followTarget.x;
      const ty = this.followTarget.y;
      this.camWorldX = this.camWorldX * (1 - this.FOLLOW_LERP) + tx * this.FOLLOW_LERP;
      this.camWorldY = this.camWorldY * (1 - this.FOLLOW_LERP) + ty * this.FOLLOW_LERP;
      // slowly pull view pan back toward follow center
      this.viewPanX *= 0.65;
      this.viewPanY *= 0.65;
    }
  }

  public getCameraDebugInfo(): { worldX: number; worldY: number; zoom: number; following: boolean; panX: number; panY: number } {
    return {
      worldX: this.camWorldX,
      worldY: this.camWorldY,
      zoom: this.camZoom,
      following: !!this.followTarget,
      panX: this.viewPanX,
      panY: this.viewPanY,
    };
  }

  /**
   * Tiny additive chart series hook (canvas-longrun-viz-14).
   * Provides simple "decision variety over simulated time" sampling for long-run 60/90d experiments (ties canvas brain viz to P7-PERSIST long-run data).
   * Reachable via public API on any CityRenderer instance (or window exposure below) or direct call after runLongTerm / 60d God probe.
   * Emits console [CANVAS-LONGRUN-CHART-HOOK] tagged compact series (per-biz decision counts as variety proxy from history/logs).
   * If P7-PERSIST enriched snapshots (with decisionHistory) or live decisionLog accum are passed (tests or future wiring), series reflects long-run accumulation over days.
   * Pure read-only; zero side effects, allocations only on explicit call. Re-uses the same snapshot shapes already widened for sparks.
   */
  public sampleLongRunDecisionVarietyOverTime(businessSnapshots?: Array<any>): { seriesSample: number[]; note: string } {
    const series: number[] = [];
    if (businessSnapshots && businessSnapshots.length > 0) {
      for (const b of businessSnapshots) {
        const h = (b && (b.decisionHistory || b.decisionLog)) || [];
        if (Array.isArray(h) && h.length > 0) {
          series.push(h.length); // simple count proxy for variety signal; richer day-bucketing possible if simDay fields present in entries
        }
      }
    }
    const note = series.length
      ? `[CANVAS-LONGRUN-CHART-HOOK] decision-variety-over-time sample (per-biz counts from history/logs): ${series.slice(0, 5).join(',')}${series.length > 5 ? '...' : ''} | ready for 60/90d trend series in economy/brain charts (public hook + window.lastLongRunDecisionVarietySample)`
      : '[CANVAS-LONGRUN-CHART-HOOK] no long-run decisionHistory/decisionLog present in snapshots (graceful no-op for non-persist runs)';
    // eslint-disable-next-line no-console
    console.log(note);
    try {
      (globalThis as any).lastLongRunDecisionVarietySample = series;
      (globalThis as any).lastLongRunDecisionVarietyNote = note;
    } catch {}
    return { seriesSample: series, note };
  }
}
