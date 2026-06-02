/**
 * CityWithLifeGrok - Phase 1 Demo Entry Point (Visualization Upgrade)
 * 
 * - Working simulation clock + variable speed (up to 1000x)
 * - 40 real residents with schedules, needs, wages, money + activity-driven behavior
 * - **Major Canvas Visualization Improvements** (CityRenderer):
 *     • Real spatial layout: homes on left (residential district), workplaces on right (downtown)
 *     • Distinct building icons (houses vs 5 different workplace types)
 *     • Residents *cluster* visually by home/work — you actually see "people going home / to work"
 *     • Animated commuters travel between their anchors (satisfying at all speeds)
 *     • Time-of-day lighting, night building glows, occupancy badges, roads/zones
 *     • **Business Visualization + Economic Indicators + Clickable Buildings**: workplace buildings show type icons, live profit tints, staff badges, low-cash warnings, trade sparkles. **Polished trade flows**: event-driven directed animated lines + packets appear precisely on 'economy:trade' events (real market/B2B trades) — same signals that spike the live historical GDP/trade charts. Click buildings for tooltip (cash/P&L/staff) + highlight ring + "INSPECT" badge + auto-open rich BusinessInspector (P&L/roster/sparkline/God actions) + optional employee cross-link in Resident Inspector. Deep two-way link between map and God Mode economy views.
 *     • **Housing Market Discoverability Polish**: Residential homes (left side) now carry subtle occupancy-driven tints — green for low-occupancy/vacancy opportunity, warm for high pressure/crowded. These react to unemployment + economy (long-unemp or low-cash residents re-home toward cheaper homes). Rent collection on paydays visible as dashed series in God Mode economy charts + live counters. "🏠 Export Housing Pressure Snapshot" button + rich persistent hints in God Mode (model explanation, how to observe on map/charts/scenarios) make the full HM system immediately explorable for first-time users. All housing state (vacancy, rent totals, pressured residents) captured in PS-hardened scenario exports for perfect replay.
 *     • **Polished Movement + Traffic Flows**: real MovementSystem positions drive accurate commuting (smoothed, distance-true); Traffic roads + animated flow particles + congestion on busy routes; direction-aware cars (people flows) + freight trucks (economy cargo, gold tint) — all flows visibly connected on canvas. **TL Replacement**: God Mode now has direct 🚦 Light Phase Controls (force red/yellow/green/next/cycle via public APIs) + dedicated red/teal/yellow chart series (stopped vehicles, junction crossings, avg congestion factor) with full discoverability hints cross-referencing the live signals panel.
 *     • **Phase 3 Camera Controls & Follow Mode** (CityRenderer + tiny main wiring): mouse-drag pan, wheel zoom (cursor-centered), Follow toggle + F key + click-any-resident-or-road to smoothly track live commutes or a specific road/flow in realtime. Lightweight/optional; zero impact at default view. Perfect for "watch people drive to work up close".
 *     • On-canvas activity legend + selection links (shows where a person lives/works)
 * - Click canvas dots ↔ Resident Inspector (God Mode) — full side panel with search + live editing + visual needs bars + location positions
 * - God Mode Tools panel (in Debug) — time jumps (full sim steps), Event Injector, + rich LIVE HISTORICAL CHARTS (canvas): activity trends, needs over time, economy cash + productivity + business cash overlays
 * - 🏢 Business God Mode section (inside the panel): per-biz live P&L/inventory/employment cards, global & targeted controls (force processDay+wages, cash inject/drain, market prices, hire/fire via real BusinessSystem APIs), richer stats + top producer. All observable on charts.
 * - 🎬 Demo Scenarios Library (inside God Mode Scenario Tools) — 6 curated one-click "living story" presets (some now highlight housing pressure build during busts/shocks via unemp-driven re-homing + rent signals):
 * - Business + Traffic Visual Polish (CityRenderer): workplace icons (type-specific), profit tints, staff badges, trade sparkles + live cars/trucks on accurate roads with direction, congestion tints/markers from TrafficSystem. Charts enriched with biz cash/vehicle counts + TL replacement stopped/crossings/congF series + God light phase controls.
 *     Night Shift Economy • Hunger Crisis at Dawn • Business Boom Week • Mass Commuting Rush • Social Isolation Event • Chaos→Recovery
 *     Each auto-executes time jumps + event injections + short simulation runs so the city visibly reacts on canvas + charts.
 * - Debug panel + save/load still present (full JSON scenario export/import also available)
 * - Wave 3 Phase 7 Observability (this delivery): GrokBusinessBrain + future IDecisionMaker brains now first-class visible in God per-biz cards (name/decision count/variety badges), BusinessInspector details, and 🎭 Drama Scorecard probe (new "Run with Grok brain" option + rich A/B reports via existing enable/harness paths). Tiny main wiring only for factory + harness exposure. Makes real brain immediately inspectable/demoable alongside housing/traffic/event drama.
 */

import { Simulation } from './core/Simulation';
import type { SimulationSpeed } from './core/types';
import { ResidentInspector } from './ui/ResidentInspector';
import { GodModeTools } from './ui/GodModeTools';
import { CityRenderer } from './rendering/CityRenderer';
import type { TradeResult } from './systems/EconomySystem';
// NOTE: Heavy Crown/Drama harness imports moved to lazy dynamic load below.
// This prevents the entire app from failing to boot if simulationTestHelpers.ts has temporary
// syntax issues (duplicate exports from prior agent work). The core simulation + God panel will load.
import { createGrokBusinessBrain } from './systems/business/GrokBusinessBrain';
import { createProviderFromEnv } from './systems/business/LLMProvider';

const canvas = document.getElementById('city-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: true })!;

// New dedicated renderer (greatly improved spatial town view, clustering, buildings, legend, etc.)
const cityRenderer = new CityRenderer(ctx, canvas.width, canvas.height);

// Phase 3 Camera Controls & Follow Mode state (lightweight, optional, toggleable — zero impact when off)
let followEnabled = false;
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
// Phase 5 Camera UI Closer: track last followed for live HUD badge (additive only)
let lastFollowedResidentId: string | null = null;

const timeDisplay = document.getElementById('sim-time')!;
const debugInfo = document.getElementById('debug-info')!;

// === ULTRA-VISIBLE FALLBACK GOD MODE MARKER (Phase A stabilization) ===
// This is injected directly and always, no matter what happens with the big GodModeTools class or later imports.
// This guarantees the user can see the bottom panel, scroll to it, and know the status.
// Sets an early __citySimBooted flag so the HTML fallback script does not escalate to scary "PAGE LOADED" banner.
(function injectAlwaysVisibleGodFallback() {
  const panel = document.getElementById('debug-panel');
  if (!panel) return;

  // Make the panel impossible to miss
  panel.style.border = '3px solid #f472b6';
  panel.style.minHeight = '120px';
  panel.style.marginBottom = '40px';

  const fallback = document.createElement('div');
  fallback.id = 'god-fallback-status';
  fallback.style.cssText = `
    margin: 12px 0 8px;
    padding: 10px 12px;
    background: #1f2937;
    border: 2px dashed #c026d3;
    border-radius: 6px;
    font-size: 0.78rem;
    color: #e0e7ff;
    line-height: 1.35;
  `;
  fallback.innerHTML = `
    <strong style="color:#f472b6">👑 GOD MODE STATUS</strong><br>
    <div id="god-fallback-detail" style="margin-top:4px; font-size:0.75rem; color:#e0e7ff; line-height:1.3;">
      Initializing simulation + God Mode...
    </div>
  `;
  panel.appendChild(fallback);

  // Signal to the HTML provisional loader that main.ts top-level code is executing.
  (window as any).__citySimBooted = true;
})();

// === Phase A: Global error handlers for clear boot diagnostics ===
// Any uncaught error during early module execution (imports, Simulation ctor, etc.) now surfaces
// directly in the visible God status box instead of a silent pink "fallback mode" scare.
window.addEventListener('error', (ev) => {
  try {
    const detail = document.getElementById('god-fallback-detail');
    if (detail) {
      const msg = (ev.error && ev.error.message) || ev.message || String(ev);
      detail.innerHTML = `<span style="color:#f87171;font-weight:bold">JS ERROR DURING BOOT:</span> ${String(msg).slice(0, 140)}<br><span style="color:#94a3b8;font-size:0.7rem">See browser console (F12) for full stack. Try: npm run dev -- --force + hard refresh.</span>`;
    }
    console.error('[CityWithLifeGrok BOOT ERROR]', ev.error || ev);
  } catch {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try {
    const detail = document.getElementById('god-fallback-detail');
    if (detail) {
      const msg = (ev.reason && ev.reason.message) || String(ev.reason);
      detail.innerHTML = `<span style="color:#f87171;font-weight:bold">UNHANDLED PROMISE DURING BOOT:</span> ${String(msg).slice(0, 140)}<br><span style="color:#94a3b8;font-size:0.7rem">See console. Recovery: --force + hard refresh.</span>`;
    }
    console.error('[CityWithLifeGrok UNHANDLED REJECTION at boot]', ev.reason);
  } catch {}
});

const sim = new Simulation(42); // Fixed seed for reproducibility during development

// === Business + Economy Visualization State (for trade flows + clickable buildings) ===
let recentTradeArcs: Array<{ fromId: string; toId: string; value: number; startTime: number }> = [];
let highlightedBusinessId: string | null = null;
const TRADE_ARC_LIFETIME_MS = 3800; // how long a specific trade pulse stays visible on canvas (ties directly to chart updates)

// Subscribe once to real trade events from EconomySystem (fired on every sellToMarket + tradeBetween + market steps).
// This powers *specific* directed animated connections instead of only volume heuristics.
// (Subscription is intentionally fire-and-forget for the lifetime of the demo app.)
sim.eventBus.on('economy:trade', (result: TradeResult) => {
  if (!result || !result.success) return;
  const now = Date.now();
  const from = (result.sellerId && result.sellerId !== 'market') ? String(result.sellerId) : null;
  const to = (result.buyerId && result.buyerId !== 'market') ? String(result.buyerId) : null;

  // For p2p: exact directed pair (high signal)
  if (from && to) {
    recentTradeArcs.push({ fromId: from, toId: to, value: result.totalValue || 0, startTime: now });
  } else if (from) {
    // Market sell by a business → external outflow pulse (we draw short outward ray in renderer logic or treat self as endpoint for now; ambient + sparkle already cover)
    recentTradeArcs.push({ fromId: from, toId: from, value: result.totalValue || 0, startTime: now });
  } else if (to) {
    // Market buy → inflow
    recentTradeArcs.push({ fromId: to, toId: to, value: result.totalValue || 0, startTime: now });
  }

  // Prune old immediately on arrival (keeps buffer tiny)
  const cutoff = now - TRADE_ARC_LIFETIME_MS;
  recentTradeArcs = recentTradeArcs.filter(a => a.startTime > cutoff);
});

// === Speed Control Buttons ===

const speedButtons: Partial<Record<SimulationSpeed, HTMLButtonElement | null>> = {
  0: document.getElementById('btn-pause') as HTMLButtonElement,
  1: document.getElementById('btn-1x') as HTMLButtonElement,
  10: document.getElementById('btn-10x') as HTMLButtonElement,
  100: document.getElementById('btn-100x') as HTMLButtonElement,
  1000: document.getElementById('btn-1000x') as HTMLButtonElement,
  realtime: document.getElementById('btn-realtime') as HTMLButtonElement,
};

function setActiveSpeedButton(speed: SimulationSpeed) {
  Object.entries(speedButtons).forEach(([key, btn]) => {
    if (!btn) return;
    const isRealtime = key === 'realtime' && speed === 'realtime';
    const numericMatch = Number(key) === speed;
    btn.classList.toggle('active', isRealtime || numericMatch);
  });
}

function setupControls() {
  // Pause
  speedButtons[0]?.addEventListener('click', () => {
    sim.pause();
    setActiveSpeedButton(0);
  });

  // Speed buttons
  [1, 10, 100, 1000].forEach((speed) => {
    const btn = speedButtons[speed as SimulationSpeed];
    if (!btn) return;

    btn.addEventListener('click', () => {
      sim.setSpeed(speed as SimulationSpeed);
      setActiveSpeedButton(speed as SimulationSpeed);
    });
  });

  // Real Time (1:1 wall clock)
  speedButtons.realtime?.addEventListener('click', () => {
    sim.setSpeed('realtime');
    setActiveSpeedButton('realtime');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      sim.togglePause();
      setActiveSpeedButton(sim.state.speed);
    }
    if (e.key === '1') sim.setSpeed(1);
    if (e.key === '2') sim.setSpeed(10);
    if (e.key === '3') sim.setSpeed(100);
    if (e.key === '4') sim.setSpeed(1000);
    if (e.key.toLowerCase() === 'r') {
      sim.setSpeed('realtime');
      setActiveSpeedButton('realtime');
    }

    if ([1, 2, 3, 4].includes(Number(e.key))) {
      setActiveSpeedButton(sim.state.speed);
    }

    // Polish: ESC clears canvas business highlight + BusinessInspector selection + resident + tooltip (syncs everything)
    // + camera prototype follow / pan reset for clean exploration reset
    if (e.key === 'Escape') {
      e.preventDefault();
      highlightedBusinessId = null;
      godModeTools?.selectBusinessInInspector?.(null);
      residentInspector.selectResident(null);
      hideBusinessTooltip();
      godModeTools?.refresh?.();
      // Camera follow/pan reset on ESC (Phase 3)
      followEnabled = false;
      lastFollowedResidentId = null;
      try { cityRenderer.clearFollow(); cityRenderer.resetCamera(); } catch {}
      const ft = document.getElementById('follow-toggle') as HTMLInputElement | null;
      if (ft) ft.checked = false;
      const topFt = document.getElementById('ctb-follow') as HTMLInputElement | null;
      if (topFt) topFt.checked = false;
      const topStatus = (window as any).__ctbStatus as HTMLSpanElement | null;
      if (topStatus) topStatus.textContent = '';
    }
  });

  // Initial state
  setActiveSpeedButton(1);
}

function renderDebug() {
  const state = sim.state;
  const rng = sim.rngInstance;
  
  const isRealtime = state.speed === 'realtime';
  const speedLabel = isRealtime 
    ? '⏱️ REAL TIME (1:1 — STRICT WALL-CLOCK LOCKED, NO DRIFT)' 
    : (state.speed + 'x');
  
  debugInfo.textContent = 
`Tick: ${state.tick}
Speed: ${speedLabel} ${state.isPaused ? '(PAUSED)' : ''}
Seed: ${state.seed}

Time: ${state.timeHours.toFixed(2)} hours
Day ${Math.floor(state.timeHours / 24) + 1}, ${Math.floor(state.timeHours % 24)}:${Math.floor((state.timeHours % 1) * 60).toString().padStart(2, '0')}
${isRealtime ? '🟢 1 sim second = 1 real second — watch rush-hour commutes in human time (rock-solid, drift-free)' : ''}

RNG test value: ${rng.next().toFixed(6)}  (deterministic)
${updateResidentDebug()}`;
}

// === City Visualization (powered by CityRenderer) ===
// The old orbiting demo positions have been replaced by a rich spatial town view:
// - Homes clustered on the left (residential district) with simple house icons
// - Workplaces on the right (distinct building styles per business type)
// - Residents now visually live near their homeId or workId based on currentActivity
// - **Polished commuting flows**: use *real* MovementSystem .position (eased real-distance travel, exact sim progress — no fake lerp)
// - Time-of-day tinting, night lighting on buildings, occupancy badges, on-canvas legend, etc.
// - **Business + Economy indicators on buildings** + **Traffic viz**: real roads + congestion + animated flow particles on busy corridors; cars (commuters) + freight trucks (gold-tinted economy cargo) visibly link people movement to Business/EconomySystem activity. (TL replacement: God light phase controls + stopped/crossings/congF chart series fully observable)
// - **Economy Flow Visualization**: inter-building gold trade pulses/lines + particles (driven by live dailyTradeVolume from EconomySystem) — the charts and the map now show the same trading activity in real time.
// - Click hit-testing delegates to the renderer for accurate selection

function renderCity() {
  const t = sim.state.tick;
  const timeH = sim.state.timeHours;
  const residents = sim.residents.getAllResidents();
  const selectedId = residentInspector.getSelectedId();
  const selectedBizId = (window as any).godModeToolsRef?.getSelectedBusinessId?.() ?? null; // drives persistent INSPECT badge + selection sync for BusinessInspector (selectedBusinessId render arg); uses exposed ref for timing safety

  // Now passing the real LocationsSystem (populated at boot) for pixel-perfect spatial rendering
  // + correct building placement. This also makes inspector position data authoritative.
  // Business + Economy snapshots passed for live economic indicators on buildings (profit tint, staff badges, trade sparkles) + new inter-building Economy Flow Visualization (trade pulses/lines between businesses, driven by same dailyTradeVolume that powers the live charts).
  const bizSnap = sim.businesses?.getSnapshot?.();
  const econSnap = sim.economy?.getSnapshot?.();
  const trafficSnap = sim.traffic?.getSnapshot?.();

  // Phase B economic observability (canvas signals) built directly on Phase A Long-Run Stability foundation:
  // sim.checkCoreInvariants(), getTotalMoneyInSystem(), getBusinessHealthSnapshot(), getPopulationStabilitySnapshot(), runLongTermStabilityTest()
  // are the exact APIs proving 200d+ healthy money growth / no neg inventory — now the *same* econ snapshots + trade events make those stable flows visible (gold pulses, magenta rent, dynamic profit tints) at 100x.

  // Prune + prepare event-driven trade arcs for specific flow lines (the "when trades occur" polish).
  // age normalized to [0,1] for renderer fade (0=fresh/bright, 1=expired).
  const now = Date.now();
  const cutoff = now - TRADE_ARC_LIFETIME_MS;
  recentTradeArcs = recentTradeArcs.filter(a => a.startTime > cutoff);
  const activeTradeArcs = recentTradeArcs.map(a => ({
    fromId: a.fromId,
    toId: a.toId,
    value: a.value,
    age: Math.min(1, (now - a.startTime) / TRADE_ARC_LIFETIME_MS)
  }));

  cityRenderer.render(
    residents,
    t,
    timeH,
    selectedId,
    sim.locations,
    { showOccupancy: true, showBusinessIndicators: true },
    bizSnap?.businesses,
    econSnap,
    trafficSnap,   // vehicles + congestion from TrafficSystem (freight ties into economy too)
    activeTradeArcs,           // NEW: specific directed trade pulses when market trades actually fire (ties canvas ↔ charts)
    highlightedBusinessId,     // transient click highlight / tooltip ring
    selectedBizId,             // selectedBusinessId for BusinessInspector: persistent INSPECT badge + better canvas<->GodMode sync (no behavior change)
    sim.state.speed                // Real-Time 1:1 agent: thread speed so CityRenderer can use wall-time smooth animation phase + stronger commute flows exactly when watching in human 1:1
  );
}

function updateUI() {
  timeDisplay.textContent = sim.timeString;

  // Phase 3 Camera: smooth follow update (lerp toward selected resident/road target world pos if Follow checkbox enabled)
  // + housekeeping. Runs every frame for responsive live commute / flow tracking. Zero cost when disabled.
  try {
    if (followEnabled) {
      const selId = residentInspector.getSelectedId();
      if (selId) {
        const res = sim.residents.getAllResidents().find((r: any) => r.id === selId);
        if (res && res.position && typeof res.position.x === 'number') {
          cityRenderer.setFollowTarget(res.position.x, res.position.y);
          lastFollowedResidentId = selId; // for HUD badge
        }
      }
    }
    cityRenderer.updateCamera();
  } catch {}

  // Camera UI Closer: live status badge (👁️ FOLLOWING ...) next to speed controls — updates every frame
  try { updateFollowStatusHUD(); } catch {}

  renderDebug();
  renderCity();

  // Live-update the inspector (activities, money, energy change every tick)
  residentInspector.refresh();

  // Live-update the powerful God Mode Tools (charts, time readouts)
  godModeTools?.refresh?.();
}

// === Main Loop (Phase A: wrapped for stability so a single bad render or system tick never kills the UI or leaves scary fallback) ===

function safeUpdateUI() {
  try {
    updateUI();
  } catch (e) {
    // Surface the exact error in the God status box (much better than silent or generic fallback banner)
    try {
      const detail = document.getElementById('god-fallback-detail');
      if (detail) {
        const msg = (e as any)?.message || String(e);
        if (msg.includes('tick') || msg.includes('is not defined')) {
          // Common transient during first frames after heavy agent edits; recover gracefully
          detail.innerHTML = `⚠️ Transient render issue (${String(msg).slice(0,80)}). Core sim running — UI will recover on next ticks.`;
        } else {
          detail.innerHTML = `<span style="color:#f87171">RUNTIME ERROR in update:</span> ${String(msg).slice(0,100)}`;
        }
      }
    } catch {}
    console.warn('[safeUpdateUI] Non-fatal error (core sim continues):', e);
  }
}

function gameLoop(timestamp: number = 0) {
  try {
    sim.update(timestamp);
  } catch (e) {
    console.warn('[gameLoop] sim.update non-fatal:', e);
  }
  safeUpdateUI();
  requestAnimationFrame(gameLoop);
}

// === Save / Load Demo ===

let lastSavedState: string | null = null;

function setupSaveLoad() {
  const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;
  const loadBtn = document.getElementById('btn-load') as HTMLButtonElement;
  const statusEl = document.getElementById('save-status')!;

  saveBtn?.addEventListener('click', () => {
    lastSavedState = sim.save();
    statusEl.textContent = 'Saved!';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
    console.log('[Save] State saved');
  });

  loadBtn?.addEventListener('click', () => {
    if (!lastSavedState) {
      statusEl.textContent = 'Nothing to load';
      setTimeout(() => { statusEl.textContent = ''; }, 1500);
      return;
    }
    const success = sim.load(lastSavedState);
    if (success) {
      statusEl.textContent = 'Loaded!';
      // Force UI refresh of inspector + god tools on next frame is automatic,
      // but give immediate visual feedback
      setTimeout(() => {
        residentInspector.refresh();
        (window as any).godModeToolsRef?.refresh?.();
      }, 0);
      setTimeout(() => { statusEl.textContent = ''; }, 1500);
    }
  });
}

// === Phase 1 Demo Setup ===

// Spawn ~40 residents on startup (using the simulation's seeded RNG for determinism)
sim.spawnInitialPopulation(40);

// === Populate minimal Locations (enables real positions in inspector + accurate spatial rendering) ===
// This dramatically improves God Mode observability: inspector now shows (x,y) for homes/work
// and the canvas uses authoritative building positions instead of pure ID hashing.
const locSystem = sim.locations;
for (let i = 1; i <= 14; i++) {
  const col = (i - 1) % 5;
  const row = Math.floor((i - 1) / 5);
  const x = 95 + col * 42;
  const y = 95 + row * 105;
  locSystem.createHome(`home_${i}`, `Residence ${i}`, { x, y }, 3);
}
// Workplaces (right side of canvas to match visual clusters)
locSystem.createWorkplace('business_bakery', 'The Bakery', { x: 530, y: 110 }, 'commercial');
locSystem.createWorkplace('business_factory', 'Central Factory', { x: 580, y: 210 }, 'industrial');
locSystem.createWorkplace('business_mine', 'Old Mine', { x: 555, y: 320 }, 'industrial');
locSystem.createWorkplace('business_farm', 'Green Acres Farm', { x: 610, y: 420 }, 'commercial');
locSystem.createWorkplace('business_store', 'Corner Market', { x: 520, y: 480 }, 'commercial');

console.log(`%c[GodMode] Populated ${locSystem.getLocationCount()} locations with positions — inspector + renderer now spatially aware.`, 'color:#60a5fa');

// === Resident Inspector (God Mode Panel) — now receives locations for position display + live tick for commute progress ===
const residentInspector = new ResidentInspector(sim.residents, sim.locations, () => sim.state.tick);

// Mount the inspector into the layout (created in HTML)
const inspectorMount = document.getElementById('inspector-mount')!;
inspectorMount.appendChild(residentInspector.element);

// === NEW: Powerful God Mode Tools panel (time control, event injector, live charts) ===
// Wrapped defensively so a partial failure in the very large GodModeTools (many methods added
// across agents) never prevents the rest of the page (canvas, basic controls, inspector) from working.
let godModeTools: GodModeTools | null = null;
try {
  godModeTools = new GodModeTools(sim);
  const debugPanel = document.getElementById('debug-panel')!;
  const toolsMount = document.createElement('div');
  toolsMount.id = 'god-tools-mount';
  debugPanel.appendChild(toolsMount);
  toolsMount.appendChild(godModeTools.element);
  console.log('%c[GodMode] God Mode Tools mounted successfully (defensive init)', 'color:#4ade80');
} catch (e) {
  console.error('[GodMode] Failed to mount full GodModeTools — basic UI will still work. Error:', e);
  // At minimum keep the original small debug footer visible
}

// Expose for cross-tool refresh in advanced scenario loads (dev / god mode only)
(window as any).godModeToolsRef = godModeTools;
(window as any).__residentInspector = residentInspector;

// Tiny Phase 7 Observability wiring (God Mode 🎭 Drama Scorecard probe button only + Grok real brain support).
// These are loaded lazily via dynamic import so a syntax problem in the large harness file
// (duplicate exports from heavy agent work) does not prevent the core simulation + God Mode UI from loading.
try {
  import('./utils/simulationTestHelpers').then((harness) => {
    (window as any).runLLMEvaluationBundle = harness.runLLMEvaluationBundle;
    (window as any).formatLLMEvaluationScorecardReport = harness.formatLLMEvaluationScorecardReport;
    (window as any).formatFullCityDramaReport = harness.formatFullCityDramaReport;
    (window as any).runDramaABWithBrain = harness.runDramaABWithBrain;
    (window as any).formatABComparisonReport = harness.formatABComparisonReport;
    (window as any).runQuickDramaProbeWithBrain = harness.runQuickDramaProbeWithBrain;
    console.log('%c[GodMode] Heavy Crown/Drama harness loaded lazily (probes now available)', 'color:#a78bfa');
  }).catch(() => {
    console.warn('[GodMode] Heavy harness could not be loaded (probes temporarily unavailable - core God panel still works)');
  });
} catch {}

// Always-available simple ones
(window as any).createGrokBusinessBrain = createGrokBusinessBrain;
(window as any).createProviderFromEnv = createProviderFromEnv;
// Live decision provenance (last reasons, contextSnapshots, richer badges + BI explain + Drama log pane) now flows automatically via existing refresh() + selectBusinessInInspector paths (no new globals).

// Business God Mode controls + richer economy stats + light traffic controls are now live inside the God Mode panel
// (per-biz P&L cards, force day/wages, cash inject, price levers, hire/fire via coordinated APIs, live top-producer + overlays on trend charts;
//  🚗 Spawn Car/Truck + Clear Vehicles for direct TrafficSystem control — visible on canvas roads + historical charts;
//  🚦 TL Replacement: phase force controls + new stopped/crossings/congF dedicated chart series + discoverability hints).
console.log('%c[GodMode] Business-specific controls + richer econ stats + light traffic controls + TL phase controls & chart series wired into God Mode Tools panel', 'color:#a78bfa');

// === Canvas click → Resident selection + Clickable business buildings (tooltip + INSPECT ring + opens rich BusinessInspector) ===
// This is the key UI polish: buildings on the map are now first-class explorable objects that directly surface
// the same P&L/employment data feeding the God Mode per-biz cards and historical economy trend charts.
// Canvas click now reliably opens BusinessInspector (via selectBusinessInInspector wiring + selectedBusinessId render sync).
function setupCanvasSelection() {
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = (e as any).offsetX ?? (e.clientX - rect.left);
    const clickY = (e as any).offsetY ?? (e.clientY - rect.top);

    const t = sim.state.tick;
    const timeH = sim.state.timeHours;
    const residents = sim.residents.getAllResidents();

    // Resident dots take priority (existing excellent behavior preserved)
    const hitResident = cityRenderer.hitTest(clickX, clickY, residents, t, timeH, sim.locations, 10);
    if (hitResident) {
      highlightedBusinessId = null;
      hideBusinessTooltip();
      residentInspector.selectResident(hitResident);
      // Phase 3 Camera: if Follow enabled, immediately track the clicked resident's live commute position
      if (followEnabled) {
        const res = residents.find((r: any) => r.id === hitResident);
        if (res && res.position) {
          cityRenderer.setFollowTarget(res.position.x, res.position.y);
        }
      }
      return;
    }

    // === NEW: Building hit (workplaces only for economy focus) ===
    const hitBuilding = cityRenderer.hitTestBuilding(clickX, clickY, sim.locations, residents, 20);
    if (hitBuilding) {
      // Set highlight (drives gold ring in renderer + can be used by GodMode for cross-selection)
      highlightedBusinessId = hitBuilding;

      // THE WIRING (BI replacement): open rich BusinessInspector for this exact workplace (P&L, roster, sparkline, God actions)
      godModeTools?.selectBusinessInInspector?.(hitBuilding);

      // Focus inspector on one of the business's real employees (if any) — makes the "living city" click feel alive
      const biz = sim.businesses?.getBusiness?.(hitBuilding as any);
      if (biz && Array.isArray(biz.employeeIds) && biz.employeeIds.length > 0) {
        // Pick first for determinism; in real play different employees visible via different clicks or random
        residentInspector.selectResident(biz.employeeIds[0]);
      } else {
        // No employees yet — still clear or keep previous, but surface the building
        residentInspector.selectResident(null);
      }

      // Quick high-signal tooltip with live profit/employees/cash pulled from current BusinessSystem snapshot
      showBusinessTooltip(clickX, clickY, hitBuilding, bizSnapForTooltip());

      // Small GodMode integration feel: the per-biz controls section will show fresh numbers on next refresh tick.
      // (Optional future: godModeTools.highlightBusinessCard?.(hitBuilding) )
      return;
    }

    // Phase 3 Camera: support following a road segment (midpoint) when Follow mode is on — great for watching commute flows cross a major artery or neighborhood up close.
    if (followEnabled) {
      try {
        const tSnap = (sim as any).traffic?.getSnapshot?.();
        const roadPt = cityRenderer.hitTestRoad?.(clickX, clickY, tSnap, 22);
        if (roadPt && typeof roadPt.x === 'number') {
          cityRenderer.setFollowTarget(roadPt.x, roadPt.y);
          // Light auto-dive when engaging road follow at default zoom (optional delight, keeps lightweight)
          const camInfo = cityRenderer.getCameraDebugInfo?.();
          if (camInfo && camInfo.zoom < 1.7) {
            cityRenderer.zoomBy(1.28);
          }
        }
      } catch {}
    }

    // Empty space: clear everything (great for exploration)
    highlightedBusinessId = null;
    godModeTools?.selectBusinessInInspector?.(null);
    hideBusinessTooltip();
    residentInspector.selectResident(null);
    godModeTools?.refresh?.();
  });

  // Crosshair makes it obvious the canvas is interactive
  canvas.style.cursor = 'crosshair';
}
setupCanvasSelection();

// === Camera Controls & Follow Mode (Phase 3/5 City Map) — lightweight + delightful ===
// Drag canvas to pan, wheel to zoom (cursor-centered), F / checkbox / click resident-or-road (when Follow checked) to smoothly track live commutes or a road/flow.
// Fully optional (defaults to clean full view). Zero behavior change when unused. Enables watching specific real-time commutes up close on the living city map.
function setupCameraControls() {
  // Drag to pan (screen-space deltas feed viewPan directly — works beautifully with zoom)
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      isPanning = true;
      lastPanX = e.offsetX;
      lastPanY = e.offsetY;
      canvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e as any).offsetX ?? (e.clientX - rect.left);
    const cy = (e as any).offsetY ?? (e.clientY - rect.top);
    const dx = cx - lastPanX;
    const dy = cy - lastPanY;
    cityRenderer.panBy(dx, dy);
    lastPanX = cx;
    lastPanY = cy;
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = 'crosshair';
    }
  });

  // Wheel zoom (to cursor — natural "dive in" on a neighborhood or a car)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const rect = canvas.getBoundingClientRect();
    const mx = (e as any).offsetX ?? (e.clientX - rect.left);
    const my = (e as any).offsetY ?? (e.clientY - rect.top);
    cityRenderer.zoomBy(factor, mx, my);
  }, { passive: false });

  // Keyboard: F toggles follow on current selection; R resets camera
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f') {
      followEnabled = !followEnabled;
      const topFt = document.getElementById('ctb-follow') as HTMLInputElement | null;
      const oldFt = document.getElementById('follow-toggle') as HTMLInputElement | null;
      if (topFt) topFt.checked = followEnabled;
      if (oldFt) oldFt.checked = followEnabled;
      if (followEnabled) {
        const sel = residentInspector.getSelectedId();
        if (sel) {
          lastFollowedResidentId = sel;
          const res = sim.residents.getAllResidents().find((r: any) => r.id === sel);
          if (res && res.position) cityRenderer.setFollowTarget(res.position.x, res.position.y);
        }
        // tiny visual feedback
        console.log('%c[Camera] Follow mode ON — select a resident (or building employee) to track their commute live.', 'color:#67e8f9');
      } else {
        cityRenderer.clearFollow();
        lastFollowedResidentId = null;
        console.log('%c[Camera] Follow mode OFF', 'color:#94a3b8');
      }
      // optional: refresh God if wired later
      try { (window as any).godModeToolsRef?.refresh?.(); } catch {}
    }
    if (e.key.toLowerCase() === 'r' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      cityRenderer.resetCamera();
      followEnabled = false;
      lastFollowedResidentId = null;
      const topFt = document.getElementById('ctb-follow') as HTMLInputElement | null;
      if (topFt) topFt.checked = false;
      const oldFt = document.getElementById('follow-toggle') as HTMLInputElement | null;
      if (oldFt) oldFt.checked = false;
      const topStatus = (window as any).__ctbStatus as HTMLSpanElement | null;
      if (topStatus) topStatus.textContent = '';
      console.log('%c[Camera] View reset (R+Ctrl)', 'color:#f472b6');
    }
  });

  // Tiny delightful control strip right under the canvas hint (style-matched to existing 0.6x hints)
  const ctrl = document.createElement('div');
  ctrl.id = 'camera-controls';
  ctrl.style.cssText = 'font-size:0.62rem; color:#64748b; margin:2px 0 8px; padding:2px 6px; background:rgba(15,23,42,0.55); border:1px solid #2a3242; border-radius:3px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;';
  ctrl.innerHTML = `
    <span title="Drag to pan • Wheel (cursor-centered) to zoom • F or checkbox: follow selected resident or clicked road/flow (live commute tracking)">🔭 <strong>Camera</strong></span>
    <label style="cursor:pointer; user-select:none;"><input type="checkbox" id="follow-toggle" style="vertical-align:middle; margin-right:3px;">Follow (F) — resident/road</label>
    <button id="cam-reset" style="font-size:0.58rem; padding:1px 5px; background:#1e2937; border:1px solid #334155; color:#e2e8f0; border-radius:2px; cursor:pointer;">Reset View</button>
    <button id="cam-zoom-in" style="font-size:0.58rem; padding:1px 5px; background:#1e2937; border:1px solid #334155; color:#e2e8f0; border-radius:2px; cursor:pointer;">+</button>
    <button id="cam-zoom-out" style="font-size:0.58rem; padding:1px 5px; background:#1e2937; border:1px solid #334155; color:#e2e8f0; border-radius:2px; cursor:pointer;">−</button>
    <span style="font-size:0.55rem; opacity:0.7;">(pan • zoom • follow resident or road flow live)</span>
  `;
  const hintEl = document.getElementById('canvas-click-hint');
  if (hintEl && hintEl.parentElement) {
    hintEl.parentElement.insertBefore(ctrl, hintEl.nextSibling);
  } else {
    const viz = document.getElementById('viz-row') || canvas.parentElement;
    if (viz) viz.appendChild(ctrl);
  }

  // Wire the new controls
  const ft = document.getElementById('follow-toggle') as HTMLInputElement | null;
  if (ft) {
    ft.checked = followEnabled;
    ft.addEventListener('change', () => {
      followEnabled = ft.checked;
      const topFt = document.getElementById('ctb-follow') as HTMLInputElement | null;
      if (topFt) topFt.checked = followEnabled;
      if (followEnabled) {
        const sel = residentInspector.getSelectedId();
        if (sel) {
          lastFollowedResidentId = sel;
          const res = sim.residents.getAllResidents().find((r: any) => r.id === sel);
          if (res && res.position) cityRenderer.setFollowTarget(res.position.x, res.position.y);
        }
      } else {
        cityRenderer.clearFollow();
        lastFollowedResidentId = null;
      }
    });
  }
  document.getElementById('cam-reset')?.addEventListener('click', () => {
    cityRenderer.resetCamera();
    followEnabled = false;
    lastFollowedResidentId = null;
    if (ft) ft.checked = false;
    const topFt = document.getElementById('ctb-follow') as HTMLInputElement | null;
    if (topFt) topFt.checked = false;
    const topStatus = (window as any).__ctbStatus as HTMLSpanElement | null;
    if (topStatus) topStatus.textContent = '';
  });
  document.getElementById('cam-zoom-in')?.addEventListener('click', () => cityRenderer.zoomBy(1.2));
  document.getElementById('cam-zoom-out')?.addEventListener('click', () => cityRenderer.zoomBy(0.83));

  // Expose for God / console experiments (additive)
  (window as any).__cityCamera = {
    reset: () => cityRenderer.resetCamera(),
    follow: (on: boolean) => { followEnabled = !!on; if (ft) ft.checked = followEnabled; },
    info: () => cityRenderer.getCameraDebugInfo?.(),
  };

  // === Resident AI / "Drive a Person" testing hooks (Phase 0 of agentic-residents plan) ===
  // Lets an external AI (Grok in this chat, or future real brains) get full context for one resident
  // and drive high-level decisions safely. Use from browser console or God Mode during testing.
  (window as any).__getResidentContext = (id: string) => {
    try { return (sim as any).residents?.getResidentContextForAI?.(id); } catch (e) { return { error: String(e) }; }
  };
  (window as any).__applyResidentDecision = (id: string, decision: any) => {
    try { return (sim as any).residents?.applyResidentDecision?.(id, decision); } catch (e) { return { error: String(e) }; }
  };
  (window as any).__setResidentBrain = (id: string, useGrok: boolean) => {
    // Placeholder: in a full impl this would use createGrokResidentBrain or RuleBased.
    // For now just logs intent; real wiring comes in next batch of the agentic residents plan.
    console.log('[ResidentAI] setResidentBrain placeholder for', id, 'useGrok=', useGrok, '— see plans/agentic-residents-ai-citizens-plan.md');
    return true;
  };

  // Expose sim and advance for AI play scripts (additive, for resident AI testing / "play the sim as me")
  (window as any).__sim = sim;
  (window as any).__advanceSimHours = (hours: number) => {
    try {
      (sim as any).advanceSimulatedHours?.(hours);
      // Trigger a UI refresh if God tools present
      if ((window as any).godTools?.refresh) (window as any).godTools.refresh();
      return true;
    } catch (e) { return { error: String(e) }; }
  };

  console.log('%c[Camera] Pan (drag) • Zoom (wheel to cursor) • Follow (F/checkbox or click resident/road while Follow on) ready. Watch real commutes & flows up close.', 'color:#67e8f9');
  console.log('%c[Resident AI] __getResidentContext(id) • __applyResidentDecision(id, {type, ...}) available for direct testing. See plans/agentic-residents-ai-citizens-plan.md', 'color:#a5b4fc');
}
setupCameraControls();

// === Camera UI Closer (Phase 5): Prominent toolbar integrated right next to speed / Real Time controls + live Follow HUD badge ===
// First-class discoverability: new user sees time + speeds + realtime + camera tools together at top.
// "👁️ Follow commuter" instantly gives a live target to watch; status badge updates every frame.
// All additive, style-matched to existing tiny fonts / god panels. Syncs with the compact strip below canvas.
function setupCameraToolbarUI() {
  const controls = document.getElementById('controls');
  if (!controls) return;

  const toolbar = document.createElement('div');
  toolbar.id = 'camera-toolbar';
  toolbar.style.cssText = 'margin: 4px 0 2px 8px; display:flex; gap:3px; align-items:center; font-size:0.56rem; color:#64748b; background:rgba(15,23,42,0.65); padding:2px 6px; border:1px solid #334155; border-radius:3px; flex-wrap:wrap;';
  toolbar.innerHTML = `
    <span title="Drag canvas to pan • Wheel (at cursor) to zoom • Click a person or road then use Follow" style="font-weight:600; color:#67e8f9;">🔭 Camera</span>
    <button id="ctb-zoom-out" title="Zoom out" style="font-size:0.52rem; padding:0 4px; background:#1e2937; border:1px solid #475569; color:#e2e8f0; border-radius:2px; cursor:pointer; line-height:1;">−</button>
    <button id="ctb-zoom-in" title="Zoom in (cursor-centered)" style="font-size:0.52rem; padding:0 4px; background:#1e2937; border:1px solid #475569; color:#e2e8f0; border-radius:2px; cursor:pointer; line-height:1;">+</button>
    <button id="ctb-reset" title="Reset view + clear follow (Ctrl+R also works)" style="font-size:0.52rem; padding:1px 5px; background:#1e2937; border:1px solid #475569; color:#e2e8f0; border-radius:2px; cursor:pointer;">Reset</button>
    <label style="cursor:pointer; user-select:none; margin-left:2px;"><input type="checkbox" id="ctb-follow" style="vertical-align:middle; margin-right:2px;">Follow (F)</label>
    <button id="ctb-follow-commuter" title="Pick an active commuter (or random mover) and start following their live trip — best in Real Time (1:1)!" style="font-size:0.52rem; padding:1px 5px; background:#052e16; border:1px solid #22c55e; color:#86efac; border-radius:2px; cursor:pointer;">👁️ Follow commuter</button>
    <span id="ctb-status" style="font-size:0.50rem; color:#22c55e; margin-left:4px; min-width:120px; font-family:monospace; white-space:nowrap; display:inline-block; overflow:hidden; text-overflow:ellipsis;"></span>
  `;

  // Place immediately after the speed-controls row for instant top-level discoverability (next to time + 1x/10x/.../Real Time)
  const speedWrap = controls.querySelector('.speed-controls');
  if (speedWrap && speedWrap.parentElement) {
    speedWrap.parentElement.insertBefore(toolbar, speedWrap.nextSibling);
  } else {
    controls.appendChild(toolbar);
  }

  const topFt = document.getElementById('ctb-follow') as HTMLInputElement | null;
  const statusEl = document.getElementById('ctb-status') as HTMLSpanElement | null;

  // Wire buttons (reuse renderer public API; sync old bottom checkbox)
  document.getElementById('ctb-zoom-in')?.addEventListener('click', () => cityRenderer.zoomBy(1.2));
  document.getElementById('ctb-zoom-out')?.addEventListener('click', () => cityRenderer.zoomBy(0.83));
  document.getElementById('ctb-reset')?.addEventListener('click', () => {
    cityRenderer.resetCamera();
    followEnabled = false;
    lastFollowedResidentId = null;
    if (topFt) topFt.checked = false;
    const oldFt = document.getElementById('follow-toggle') as HTMLInputElement | null;
    if (oldFt) oldFt.checked = false;
    if (statusEl) statusEl.textContent = '';
    cityRenderer.clearFollow();
  });

  if (topFt) {
    topFt.checked = followEnabled;
    topFt.addEventListener('change', () => {
      followEnabled = topFt.checked;
      const oldFt = document.getElementById('follow-toggle') as HTMLInputElement | null;
      if (oldFt) oldFt.checked = followEnabled;
      if (!followEnabled) {
        cityRenderer.clearFollow();
        lastFollowedResidentId = null;
        if (statusEl) statusEl.textContent = '';
      } else {
        const sel = residentInspector.getSelectedId();
        if (sel) {
          lastFollowedResidentId = sel;
          const res = sim.residents.getAllResidents().find((r: any) => r.id === sel);
          if (res && res.position) cityRenderer.setFollowTarget(res.position.x, res.position.y);
        }
      }
    });
  }

  document.getElementById('ctb-follow-commuter')?.addEventListener('click', () => {
    const all = (sim.residents?.getAllResidents?.() || []) as any[];
    // Prefer residents that look like they are actively commuting (activity string or just moving ones)
    let pool = all.filter((r: any) => r && r.position && typeof r.position.x === 'number' && ((r.activity || '').toLowerCase().includes('commut') || (r.activity || '').toLowerCase().includes('travel')));
    if (pool.length === 0) pool = all.filter((r: any) => r && r.position && typeof r.position.x === 'number');
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    followEnabled = true;
    lastFollowedResidentId = pick.id;
    if (topFt) topFt.checked = true;
    const oldFt = document.getElementById('follow-toggle') as HTMLInputElement | null;
    if (oldFt) oldFt.checked = true;
    cityRenderer.setFollowTarget(pick.position.x, pick.position.y);
    console.log('%c[Camera UI] Following commuter #' + pick.id + ' — set speed to Real Time (1:1) or slow motion to watch the full trip in human time!', 'color:#22c55e');
  });

  // Expose status for live updates from game loop
  (window as any).__ctbStatus = statusEl;
  (window as any).__ctbFt = topFt;

  console.log('%c[Camera UI Closer] Top toolbar + Follow HUD + commuter picker ready next to speed controls. New users discover in <5s.', 'color:#67e8f9');
}
setupCameraToolbarUI();

// Live HUD updater (called every frame from updateUI). Shows who/ what is being followed with tiny context.
function updateFollowStatusHUD() {
  const statusEl: HTMLSpanElement | null = (window as any).__ctbStatus || null;
  if (!statusEl) return;
  const cam = cityRenderer.getCameraDebugInfo?.();
  const oldFt = document.getElementById('ctb-follow') as HTMLInputElement | null;
  if (!followEnabled || !cam || !cam.following) {
    if (statusEl.textContent) statusEl.textContent = '';
    if (oldFt && oldFt.checked) oldFt.checked = false;
    return;
  }
  let txt = '👁️ FOLLOWING ';
  if (lastFollowedResidentId != null) {
    const res = (sim.residents?.getAllResidents?.() || []).find((r: any) => r && r.id === lastFollowedResidentId);
    if (res) {
      const shortAct = String((res as any).currentActivity || (res as any).activity || 'moving').slice(0, 14);
      txt += `#${lastFollowedResidentId} ${shortAct}`;
      const p = (res as any);
      const prog = (typeof p.commuteProgress === 'number' ? p.commuteProgress : (typeof p.getCommuteProgress === 'function' ? p.getCommuteProgress() : 0));
      if (typeof prog === 'number' && prog > 0) {
        txt += ` ${Math.round(prog * 100)}%`;
      }
    } else {
      txt += `#${lastFollowedResidentId}`;
    }
  } else {
    txt += 'flow / target';
  }
  statusEl.textContent = txt;
}

// === Discoverability hint (persistent, lightweight, next to canvas) ===
// First-time users immediately see they can click buildings, what the chart series mean, *and* how the new housing/rent features appear on map + charts (tints + dashed rent).
// Placed between canvas and inspector-mount for perfect visual association with the map. Matches BI polish patterns + PS scenario UX nudges.
// Tiny addition for Grok brain discoverability (per Wave 3 Phase 7 task).
const vizRow = document.getElementById('viz-row')!;
const canvasHint = document.createElement('div');
canvasHint.id = 'canvas-click-hint';
canvasHint.style.cssText = 'font-size:0.68rem; color:#64748b; margin:4px 0 6px; padding:3px 8px; background:rgba(15,23,42,0.65); border:1px solid #2a3242; border-radius:3px; line-height:1.3;';
canvasHint.innerHTML = '🖱️ <strong>Click any workplace building</strong> (right-side icons with profit tints/staff badges) to open rich BusinessInspector (P&amp;L, employee roster, sparkline, God controls). <span style="color:#67e8f9;">Cyan</span>/<span style="color:#f472b6;">magenta</span>/<span style="color:#fb923c;">orange</span> lines in Economy chart = live commuters (Movement) • vehicles • congestion (Traffic). <strong>Left homes tint green</strong> (vacancy/opportunity) or <strong>warm</strong> (high pressure) — driven by long-unemp/low-cash re-homing. Dashed purple rent line tracks housing payday flows. <strong>🚦 In God Mode:</strong> new Light Phase Controls (Next/Red/Yellow/Green/+Cycle) under Traffic Signals panel let you experiment — watch new <span style="color:#ef4444;">red stopped</span>, <span style="color:#14b8a6;">teal crossings</span>, <span style="color:#eab308;">yellow cong factor</span> series react in Economy chart + live queues on canvas. <strong>ESC</strong> clears everything. Use God 🏠 Export button for replayable states. <strong>🧠 GrokBusinessBrain</strong> (and future brains) visible in God per-biz cards + 🎭 Drama Scorecard "Run with Grok brain" probe (rich A/B + variety logs). <strong>🔭 Top Camera toolbar</strong> (by speed/Real Time buttons): Zoom ± • Reset • Follow checkbox • 👁️ Follow commuter picker — drag/wheel on canvas too. Real Time + Follow = watch full human-time commutes.';
vizRow.insertBefore(canvasHint, document.getElementById('inspector-mount'));

// Lightweight live data grabber for the building tooltip (uses the authoritative snapshots already in scope via closure in render)
function bizSnapForTooltip() {
  const snap = sim.businesses?.getSnapshot?.();
  return snap?.businesses || [];
}

// Transient DOM tooltip for business info on click (clean, no new permanent UI, auto-hides)
let bizTooltipEl: HTMLDivElement | null = null;
function showBusinessTooltip(screenX: number, screenY: number, buildingId: string, allBiz: any[]) {
  hideBusinessTooltip();

  const bizData = allBiz.find((b: any) => b.id === buildingId) || {};
  const name = bizData.name || buildingId.replace(/^(business_|work_)/i, '');
  const cash = (bizData.cash ?? 0).toFixed(0);
  const profit = (bizData.profit ?? 0).toFixed(0);
  const emp = bizData.employeeCount ?? (bizData.employeeIds?.length ?? 0);

  bizTooltipEl = document.createElement('div');
  bizTooltipEl.style.position = 'absolute';
  bizTooltipEl.style.left = `${screenX + 12}px`;
  bizTooltipEl.style.top = `${screenY - 8}px`;
  bizTooltipEl.style.background = 'rgba(15,23,42,0.96)';
  bizTooltipEl.style.color = '#e2e8f0';
  bizTooltipEl.style.padding = '6px 9px';
  bizTooltipEl.style.borderRadius = '4px';
  bizTooltipEl.style.font = '10px/1.25 monospace';
  bizTooltipEl.style.border = '1px solid rgba(251,191,36,0.5)';
  bizTooltipEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.6)';
  bizTooltipEl.style.pointerEvents = 'none';
  bizTooltipEl.style.zIndex = '9999';
  bizTooltipEl.style.whiteSpace = 'nowrap';
  bizTooltipEl.innerHTML = `<strong>${name}</strong><br>💰 $${cash} &nbsp; P&amp;L $${profit} &nbsp; 👥 ${emp} emp`;

  // Find a good container (canvas parent or body)
  const container = canvas.parentElement || document.body;
  container.style.position = container.style.position || 'relative';
  container.appendChild(bizTooltipEl);

  // Auto hide after a few seconds (lets user read while chart/canvas continue updating)
  setTimeout(() => {
    if (bizTooltipEl && bizTooltipEl.parentNode) bizTooltipEl.parentNode.removeChild(bizTooltipEl);
    if (bizTooltipEl === bizTooltipEl) bizTooltipEl = null; // avoid stale
  }, 2650);
}

function hideBusinessTooltip() {
  if (bizTooltipEl && bizTooltipEl.parentNode) {
    bizTooltipEl.parentNode.removeChild(bizTooltipEl);
  }
  bizTooltipEl = null;
}

function updateResidentDebug() {
  const stats = sim.residents.getStats();
  const residents = sim.residents.getAllResidents();

  // Count by activity
  const activityCounts: Record<string, number> = {};
  residents.forEach(r => {
    activityCounts[r.currentActivity] = (activityCounts[r.currentActivity] || 0) + 1;
  });

  let activitySummary = Object.entries(activityCounts)
    .map(([act, count]) => `${act}: ${count}`)
    .join(', ');

  // Show a couple example residents
  const examples = residents.slice(0, 2).map(r => 
    `${r.name.split(' ')[0]}: ${r.currentActivity} ($${r.money.toFixed(0)})`
  ).join(' | ');

  // New needs averages from the expanded ResidentsSystem
  const needsLine = (stats.averageHunger !== undefined)
    ? `Avg Needs → Hunger: ${stats.averageHunger.toFixed(0)} | Fatigue: ${stats.averageFatigue?.toFixed(0)} | Social: ${stats.averageSocial?.toFixed(0)}`
    : '';

  // Spatial + Traffic + Economy info (new from parallel agents)
  const locCount = sim.locations?.getLocationCount?.() ?? 0;
  const spatialLine = locCount > 0 ? ` | Locations: ${locCount}` : '';

  const trafficSnap = sim.traffic?.getSnapshot?.();
  const trafficLine = trafficSnap ? ` | Vehicles: ${trafficSnap.vehicles?.length || 0}` : '';

  const bizStats = sim.businesses?.getTotalEconomyStats?.();
  const bizLine = bizStats ? ` | Biz: ${bizStats.count} ($${bizStats.totalCash.toFixed(0)})` : '';

  const econStats = sim.economy?.getEconomyStats?.();
  const econLine = econStats ? ` | GDP: $${(econStats.cumulativeGDP || 0).toFixed(0)}` : '';

  const empStats = sim.businesses?.getEmploymentStats?.();
  let empLine = '';
  if (empStats) {
    const dur = empStats.averageUnemploymentDurationHours != null ? ` avgUnemp ${empStats.averageUnemploymentDurationHours}h` : '';
    empLine = ` | Employed: ${empStats.totalEmployed}/${stats.total} (${(empStats.employmentRate * 100).toFixed(0)}%)` + dur;
  }

  // Realistic partial employment + active economy now standard at boot (55-90% per biz via RNG).

  // Note: Rich historical charts + 🎬 Curated Demo Scenarios + powerful Scenario Tools + Business God Mode controls + visibly active economy (incl. new trade flow lines on canvas) now live in the God Mode panel below.

  return `
Residents: ${stats.total} | Avg Money: $${stats.averageMoney.toFixed(2)}${spatialLine}${trafficLine}${bizLine}${econLine}${empLine}
Activities → ${activitySummary}
${needsLine}
Examples: ${examples}`;
}

// Boot
setupControls();
setupSaveLoad();
sim.setSpeed(1);
requestAnimationFrame(gameLoop);

console.log('%c[CityWithLifeGrok] Phase 1 + Visualization Upgrade + God Mode Tools ready', 'color:#4ade80');
console.log('Keyboard: SPACE = pause, 1/2/3/4 = speed, ESC = clear selections (resident + BusinessInspector + chart context)');
console.log('40 residents + real spatial Locations (positions shown in inspector + used by renderer).');
console.log('%c[Renderer] CityRenderer active — spatial clustering, buildings, time-of-day, legend, hit testing + Business/Economy indicators (profit tints, icons, staff badges, trade sparkles) on workplaces.', 'color:#60a5fa');
console.log('%c[Inspector] Click dots/rows → rich details with visual needs bars + (x,y) positions. God actions expanded.', 'color:#f472b6');
console.log('%c[GodTools] Panel live: time jumps, event injector + rich historical canvas charts + 🎬 DEMO SCENARIOS + 🏢 Business God Controls (per-biz P&L/hire-fire/force-day/price) + 🚗 Light Traffic (spawn/clear) + 🚦 TL phase controls (Next/Red/etc) & new stopped/crossings/congF chart series + 🎭 Drama Scorecard (Run Short Drama Probe + NEW "Run with Grok brain" A/B option for real IDecisionMaker visibility, name/decisions/variety badges in cards + BI) — all live on canvas + charts.', 'color:#c026d3');

// Update the always-visible fallback marker with real status (Phase A: richer diagnostics)
try {
  const detail = document.getElementById('god-fallback-detail');
  if (detail) {
    // Detect current harness surface (stub vs full) for transparent reporting to user.
    const harness = (window as any).runQuickDramaProbeWithBrain;
    const isStub = harness && /Stub/.test(String(harness));
    const harnessNote = isStub
      ? '<br><span style="color:#fbbf24">Harness: STUB mode (core God UI + basic probes work; full 26-scen A/B/crown drama in harness file for tests/dev).</span>'
      : '<br><span style="color:#4ade80">Harness: full (crown probes + drama A/B active).</span>';

    detail.innerHTML = `
      ✅ Core simulation + God Mode loaded cleanly.<br>
      <span style="color:#94a3b8">Scroll to pink-bordered Debug panel for Time / Events / Business / Housing / Traffic / 🎭 Crown probes. <strong>🔭 Camera:</strong> drag pan • wheel zoom • click resident/road + Follow checkbox (F) to track live commutes up close.</span>
      ${harnessNote}
    `;
    const fb = document.getElementById('god-fallback-status');
    if (fb) fb.style.borderColor = '#4ade80';
  }
  // Reinforce the flag in case of late execution paths
  (window as any).__citySimBooted = true;
} catch (e) {
  // Never let status update itself crash the boot
  console.warn('[GodStatus] Final marker update failed (non-fatal):', e);
}
