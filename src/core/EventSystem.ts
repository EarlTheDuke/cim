/**
 * EventSystem — Lightweight, deterministic emergent events for living city storytelling.
 *
 * Prepares Phase 7 narrative depth + agentic drama without heavy machinery.
 * - 100% replayable given seed + timeline (decisions driven by Simulation's SeededRNG)
 * - Fires via day-boundary checks (cheap) when auto enabled (low probability)
 * - Manual triggers always available (God Mode, scenarios, tests)
 * - All effects use ONLY public APIs on ResidentsSystem / BusinessSystem / EconomySystem
 *   (never direct private mutation). Effects are real, bounded, and chart-visible.
 * - Full snapshot + load roundtrip support (active events + log + config)
 * - Emits via console + internal log; future listeners can subscribe via Simulation eventBus
 *
 * Owned strictly by Agent EV (Wave 3 replacements). No DOM, no rendering. Full hostile set (major+port+rate+cyber+labor+tariff) powers 26-scenario crown jewel (A/B + quick probe + stress + UI) + real GrokBusinessBrain decision quality under compound housing+traffic+event shocks.
 */

import { SeededRNG } from '../utils/rng';
import { TimeSystem } from './TimeSystem';
// Type-only imports to avoid circular module evaluation with Simulation (which owns + wires the systems + EventSystem)
import type { ResidentsSystem } from '../systems/ResidentsSystem';
import type { BusinessSystem } from '../systems/BusinessSystem';
import type { EconomySystem } from '../systems/EconomySystem';

export type EventType =
  | 'supply_shock'
  | 'flu_season'
  | 'local_festival'
  | 'job_fair'
  | 'minor_recession'
  | 'infrastructure_boost'
  | 'heatwave'
  | 'community_grant'
  // === Wave 3 EV replacement: 3 new brain-hostile deterministic seeded events (richer drama fuel for real/LLM brains + full housing+traffic+EV trio) ===
  // All effects bounded, via public APIs only. Snapshot + auto/manual + God triggers fully supported.
  | 'major_blackout'       // Sharp citywide energy crisis: resident needs spike + business cash burn (halted production proxy). Hostile to operating decisions.
  | 'port_strike'          // Acute supply chain collapse: violent multi-resource price/inventory ripples + trade shock. Forces reactive pricing & inventory management under pressure.
  | 'interest_rate_shock'  // Sudden financing/rent cost surge: resident financial stress (accelerates HM re-homing churn) + business margin squeeze + wage sensitivity. Directly amplifies housing + unemployment drama.
  // === Additional brain-hostile events (this EV replacement slice): 3 more high-signal drama fuel types for 26-scenario trio + real GrokBusinessBrain / future LLM provider path ===
  // All via public APIs only. Force measurable pressure on pricing, hiring, housing churn, cash mgmt. Auto-included in random fire + harness compounds.
  | 'cyber_attack'   // Digital/comms blackout: extreme social+fatigue isolation + goods price chaos + biz ops cash burn. Pushes brains into defensive high-uncertainty decisions; amplifies eventReactivity + varietyUnderStress in A/B vs housing/traffic amps.
  | 'labor_strike'   // Coordinated labor action: resident distress + explicit housing re-homing churn (forceHousingMarketStep) + biz margin/ops burn. Directly stresses employment/wage brains while multiplying housing pressure dimension in full drama trio.
  | 'tariff_shock';  // Broad trade barrier shock: across-board violent price spikes + cost-of-living resident pressure + biz squeeze. Compounds with port_strike etc for extreme multi-shock scenarios; tests real-brain robustness on sustained cost volatility + churn.
export interface CityEvent {
  id: string;
  type: EventType;
  name: string;
  description: string;
  startTick: number;
  startTimeHours: number;
  intensity: number; // 0.5–1.8 (scales effect strength)
  durationHours?: number;
}

export interface RecentEventLogEntry {
  tick: number;
  hours: number;
  type: EventType;
  name: string;
  summary: string;
}

export interface EventSystemSnapshot {
  activeEvents: CityEvent[];
  recentLog: RecentEventLogEntry[];
  autoEnabled: boolean;
  autoProbability: number;
  lastCheckedDay: number;
  eventCounter: number;
}

// Human-friendly definitions (used for both manual + auto)
const EVENT_DEFINITIONS: Record<EventType, { name: string; description: string; typicalDurationHours: number }> = {
  supply_shock: {
    name: 'Supply Chain Shock',
    description: 'Logistics disruption causes a visible resource price spike.',
    typicalDurationHours: 48,
  },
  flu_season: {
    name: 'Flu Season',
    description: 'Citywide illness spike — fatigue and social isolation rise sharply.',
    typicalDurationHours: 72,
  },
  local_festival: {
    name: 'Local Festival',
    description: 'Community celebration delivers broad morale and social relief.',
    typicalDurationHours: 24,
  },
  job_fair: {
    name: 'Job Fair',
    description: 'Employment surge event accelerates hiring for the unemployed.',
    typicalDurationHours: 12,
  },
  minor_recession: {
    name: 'Minor Recession',
    description: 'Economic softening drains business cash and adds mild resident pressure.',
    typicalDurationHours: 96,
  },
  infrastructure_boost: {
    name: 'Infrastructure Boost',
    description: 'Public investment injects capital and eases select operating costs.',
    typicalDurationHours: 120,
  },
  heatwave: {
    name: 'Heatwave',
    description: 'Extreme temperatures drive fatigue and hunger stress across the population.',
    typicalDurationHours: 36,
  },
  community_grant: {
    name: 'Community Grant',
    description: 'Stimulus funding directly bolsters business reserves citywide.',
    typicalDurationHours: 48,
  },
  // New brain-hostile events (EV Wave 3 replacement)
  major_blackout: {
    name: 'Major Blackout',
    description: 'Citywide power failure — sharp resident fatigue/hunger spike + business emergency cash burn (production halt proxy). Hostile operating environment for brains.',
    typicalDurationHours: 36,
  },
  port_strike: {
    name: 'Port Strike / Supply Collapse',
    description: 'Major logistics/port disruption — acute inventory shortages + violent price spikes and trade volume shocks across key resources. Strong pressure on pricing & stocking decisions.',
    typicalDurationHours: 72,
  },
  interest_rate_shock: {
    name: 'Interest Rate Shock',
    description: 'Financing/rent cost shock — amplified burdens on residents (fuels housing re-homing churn + unemployment pressure) + margin squeeze on businesses (wage sensitivity). Direct drama multiplier for housing+brain interplay.',
    typicalDurationHours: 96,
  },
  // Additional 3 brain-hostile event defs (this slice): rich names/descriptions for God Mode + logs + inspector + harness reports. Typical durations chosen for drama overlap with housing/traffic cycles.
  cyber_attack: {
    name: 'Cyber Attack',
    description: 'Widespread digital disruption — extreme isolation/fatigue from comms blackout + chaotic price swings on consumer goods + emergency cash burn for businesses. Hostile uncertainty environment that rewards (or punishes) adaptive brain decisions under the full 26-scen housing+traffic+event trio.',
    typicalDurationHours: 48,
  },
  labor_strike: {
    name: 'Labor Strike',
    description: 'Sector-wide labor action — resident financial/morale distress + explicit acceleration of housing re-homing churn + business operating cash burn. Directly tests brain employment/wage logic + housing pressure interactions in A/B real-Grok measurements.',
    typicalDurationHours: 60,
  },
  tariff_shock: {
    name: 'Tariff Shock',
    description: 'Sudden broad trade/tariff barrier — violent price inflation across resources + resident cost-of-living pressure + business margin squeeze. Compounds existing port/interest shocks for extreme multi-event drama; measures real LLM brain reactivity + robustness at scale.',
    typicalDurationHours: 84,
  },
};

export class EventSystem {
  private readonly timeSystem: TimeSystem;
  private readonly rng: SeededRNG;
  private readonly residentsSystem: ResidentsSystem;
  private readonly businessSystem: BusinessSystem;
  private readonly economySystem: EconomySystem;

  private activeEvents: CityEvent[] = [];
  private recentLog: RecentEventLogEntry[] = [];
  private autoEnabled: boolean = true;
  private autoProbability: number = 0.065; // ~6.5% chance an event fires on any new simulated day
  private lastCheckedDay: number = -999;
  private eventCounter: number = 0;

  constructor(
    timeSystem: TimeSystem,
    rng: SeededRNG,
    residentsSystem: ResidentsSystem,
    businessSystem: BusinessSystem,
    economySystem: EconomySystem
  ) {
    this.timeSystem = timeSystem;
    this.rng = rng;
    this.residentsSystem = residentsSystem;
    this.businessSystem = businessSystem;
    this.economySystem = economySystem;
    this.lastCheckedDay = timeSystem.day;
  }

  /** Called every tick via Simulation registration (day-boundary logic inside is cheap) */
  update(): void {
    if (!this.autoEnabled) return;

    const currentDay = this.timeSystem.day;
    if (currentDay === this.lastCheckedDay) return;

    this.lastCheckedDay = currentDay;

    // Low-probability auto emergence — fully deterministic for given seed+timeline
    if (this.rng.chance(this.autoProbability)) {
      const allTypes = Object.keys(EVENT_DEFINITIONS) as EventType[];
      const chosenType = this.rng.pick(allTypes);
      const intensity = 0.78 + this.rng.next() * 0.48; // 0.78–1.26 range for natural variety
      this.triggerEvent(chosenType, intensity, true);
    }
  }

  /**
   * Trigger a specific emergent event (manual from God Mode / tests / scenarios, or internal auto).
   * Always produces a real bounded side-effect via public system APIs.
   * Returns the created event record (or null on unknown type).
   */
  triggerEvent(type: EventType, intensity: number = 1.0, isAuto: boolean = false): CityEvent | null {
    const def = EVENT_DEFINITIONS[type];
    if (!def) {
      return null;
    }

    const clamped = Math.max(0.5, Math.min(1.8, intensity || 1.0));

    const evt: CityEvent = {
      id: `evt_${this.eventCounter++}`,
      type,
      name: def.name,
      description: def.description,
      startTick: this.timeSystem.tick,
      startTimeHours: this.timeSystem.timeHours,
      intensity: clamped,
      durationHours: def.typicalDurationHours,
    };

    this.activeEvents.push(evt);
    // Keep active list tiny for perf + clarity
    if (this.activeEvents.length > 6) {
      this.activeEvents.shift();
    }

    // === REAL EFFECTS (public APIs only, bounded, observable in charts/inspector) ===
    this.applyBoundedEffects(evt, clamped);

    // Record for God Mode recent log + replay/debug
    const summary = this.formatLogSummary(type, clamped, isAuto);
    this.recentLog.unshift({
      tick: evt.startTick,
      hours: evt.startTimeHours,
      type,
      name: def.name,
      summary,
    });
    if (this.recentLog.length > 14) {
      this.recentLog.pop();
    }

    return evt;
  }

  private applyBoundedEffects(evt: CityEvent, intensity: number): void {
    const scale = (base: number) => Math.round(base * intensity);

    try {
      switch (evt.type) {
        case 'supply_shock': {
          // Price shock on a key tradable resource — immediately visible in econ readout + trade dynamics
          const prices = this.economySystem.getAllPrices ? this.economySystem.getAllPrices() : {};
          const pool = Object.keys(prices).filter(r => ['ore', 'lumber', 'food', 'goods', 'crops'].includes(r));
          const resource = pool.length > 0 ? this.rng.pick(pool) : 'ore';
          const current = this.economySystem.getResourcePrice ? this.economySystem.getResourcePrice(resource) : 45;
          const factor = 1.23 + (intensity - 1.0) * 0.18;
          const nextPrice = Math.max(current + 6, Math.round(current * factor));
          this.economySystem.setResourcePrice(resource, nextPrice);
          break;
        }

        case 'flu_season': {
          // Direct need pressure — fatigue hits productivity, social compounds isolation (visible in needs trends)
          this.residentsSystem.applyGlobalNeedDelta({
            fatigue: scale(29),
            social: scale(13),
          });
          break;
        }

        case 'local_festival': {
          // Strong positive morale pulse — excellent for "recovery arc" storytelling in charts
          this.residentsSystem.applyGlobalNeedDelta({
            hunger: -scale(19),
            fatigue: -scale(13),
            social: -scale(24),
          });
          break;
        }

        case 'job_fair': {
          // Hiring surge — calls the real (deterministic) job search logic multiple times
          const passes = intensity > 1.15 ? 5 : 3;
          for (let i = 0; i < passes; i++) {
            if (typeof (this.businessSystem as any).runBasicJobSearch === 'function') {
              (this.businessSystem as any).runBasicJobSearch();
            }
          }
          break;
        }

        case 'minor_recession': {
          // Business cash pressure + mild resident hardship (tests resilience without catastrophe)
          const drain = -scale(680);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(drain);
          }
          this.residentsSystem.applyGlobalNeedDelta({
            hunger: scale(7),
            fatigue: scale(5),
          });
          break;
        }

        case 'infrastructure_boost': {
          // Capital injection + targeted price relief (positive economic signal)
          const grant = scale(1150);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(grant);
          }
          // Mild relief on one non-oil resource
          const prices = this.economySystem.getAllPrices ? this.economySystem.getAllPrices() : {};
          const candidates = Object.keys(prices).filter(r => r !== 'oil');
          if (candidates.length > 0 && this.economySystem.getResourcePrice && this.economySystem.setResourcePrice) {
            const res = this.rng.pick(candidates);
            const cur = this.economySystem.getResourcePrice(res);
            const relief = Math.max(4, Math.round(cur * 0.81));
            this.economySystem.setResourcePrice(res, relief);
          }
          break;
        }

        case 'heatwave': {
          // Harsh environmental pressure (pairs beautifully with recovery events)
          this.residentsSystem.applyGlobalNeedDelta({
            fatigue: scale(33),
            hunger: scale(14),
          });
          break;
        }

        case 'community_grant': {
          // Direct broad stimulus (excellent counterpart to recession)
          const amount = scale(1450);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(amount);
          }
          break;
        }

        // === New brain-hostile events (public APIs only, bounded, chart/inspector visible, interact with housing churn + traffic friction + brain decisions) ===
        case 'major_blackout': {
          // Sharp energy crisis: resident needs explosion (fatigue primary) + business cash burn simulating halted production + emergency costs. Very hostile to daily ops/pricing/hiring brains.
          this.residentsSystem.applyGlobalNeedDelta({
            fatigue: scale(42),
            hunger: scale(18),
            social: scale(9),
          });
          const burn = -scale(920);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(burn);
          }
          break;
        }

        case 'port_strike': {
          // Supply collapse: hit multiple key resources with sharp price spikes (inventory/price/trade ripples). Brains must react with pricing nudges or production changes under shortage pressure.
          const prices = this.economySystem.getAllPrices ? this.economySystem.getAllPrices() : {};
          const pool = Object.keys(prices).filter(r => ['ore', 'lumber', 'food', 'goods', 'crops', 'oil'].includes(r));
          for (let i = 0; i < 3 && pool.length > 0; i++) {
            const resource = this.rng.pick(pool);
            const current = this.economySystem.getResourcePrice ? this.economySystem.getResourcePrice(resource) : 50;
            const factor = 1.35 + (intensity - 1.0) * 0.25;
            const nextPrice = Math.max(current + 12, Math.round(current * factor));
            this.economySystem.setResourcePrice(resource, nextPrice);
          }
          break;
        }

        case 'interest_rate_shock': {
          // Cost shock: financial stress on residents (hunger/fatigue proxy for rent burden) accelerates HM pressure/re-homing (interacts with housing churn + long-unemp) + business margin squeeze (wage sensitivity). Excellent brain-hostile housing+economy drama.
          this.residentsSystem.applyGlobalNeedDelta({
            hunger: scale(11),
            fatigue: scale(15),
          });
          const marginSqueeze = -scale(520);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(marginSqueeze);
          }
          break;
        }

        // === Additional brain-hostile cases (new EV slice) — all bounded public-API effects only. Produce observable churn, price pressure, cash/need deltas that feed directly into real GrokBusinessBrain decisions + 26-scen harness metrics (housingRobustness, trafficSens, eventReactivity, variety under stress). ===
        case 'cyber_attack': {
          // Comms blackout: severe isolation (social) + fatigue/hunger from disrupted life + multi-good price chaos (brains must price-react fast) + biz emergency burn. High-signal for decision quality under uncertainty + compounds with housing amps.
          this.residentsSystem.applyGlobalNeedDelta({
            fatigue: scale(38),
            hunger: scale(16),
            social: scale(29),
          });
          const prices = this.economySystem.getAllPrices ? this.economySystem.getAllPrices() : {};
          const pool = Object.keys(prices).filter(r => ['food', 'goods', 'crops'].includes(r));
          for (let i = 0; i < 2 && pool.length > 0; i++) {
            const res = this.rng.pick(pool);
            const cur = this.economySystem.getResourcePrice ? this.economySystem.getResourcePrice(res) : 40;
            const factor = 1.28 + (intensity - 1) * 0.22;
            this.economySystem.setResourcePrice(res, Math.max(cur + 8, Math.round(cur * factor)));
          }
          const burn = -scale(780);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(burn);
          }
          break;
        }

        case 'labor_strike': {
          // Labor action: resident distress needs + direct housing churn amp (re-homing pressure visible in HM stats) + biz cash burn (lost shifts / tension). Explicitly exercises forceHousing + interacts with unemployment/job-search in brains.
          this.residentsSystem.applyGlobalNeedDelta({
            hunger: scale(14),
            fatigue: scale(19),
            social: scale(11),
          });
          if (typeof (this.residentsSystem as any).forceHousingMarketStep === 'function') {
            (this.residentsSystem as any).forceHousingMarketStep();
          }
          const strikeBurn = -scale(610);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(strikeBurn);
          }
          // Light job-search churn signal (brains see employment pressure)
          if (typeof (this.businessSystem as any).runBasicJobSearch === 'function') {
            (this.businessSystem as any).runBasicJobSearch();
          }
          break;
        }

        case 'tariff_shock': {
          // Trade barrier: broad aggressive price inflation on tradables + resident living-cost pressure (needs) + margin squeeze burn on biz. Creates sustained volatility that real brains + LLM providers must navigate alongside traffic + eviction waves.
          const prices = this.economySystem.getAllPrices ? this.economySystem.getAllPrices() : {};
          const pool = Object.keys(prices).filter(r => ['ore', 'lumber', 'food', 'goods', 'crops', 'oil'].includes(r));
          for (let i = 0; i < 4 && pool.length > 0; i++) {
            const res = this.rng.pick(pool);
            const cur = this.economySystem.getResourcePrice ? this.economySystem.getResourcePrice(res) : 45;
            const factor = 1.42 + (intensity - 1) * 0.30;
            this.economySystem.setResourcePrice(res, Math.max(cur + 15, Math.round(cur * factor)));
          }
          this.residentsSystem.applyGlobalNeedDelta({
            hunger: scale(13),
            fatigue: scale(9),
          });
          const squeeze = -scale(590);
          if (typeof (this.businessSystem as any).injectCashToAll === 'function') {
            (this.businessSystem as any).injectCashToAll(squeeze);
          }
          break;
        }
      }
    } catch (err) {
      // Events must never crash the simulation — log and continue
      console.warn(`[EventSystem] Non-fatal effect error for ${evt.type}:`, err);
    }
  }

  private formatLogSummary(type: EventType, intensity: number, isAuto: boolean): string {
    const tag = isAuto ? 'auto' : 'manual';
    const i = intensity.toFixed(1);
    switch (type) {
      case 'supply_shock':
        return `Supply shock (${tag}, ×${i})`;
      case 'flu_season':
        return `Flu season outbreak (${tag})`;
      case 'local_festival':
        return `Festival morale boost (${tag})`;
      case 'job_fair':
        return `Job fair hiring surge (${tag})`;
      case 'minor_recession':
        return `Recession pressure (${tag}, ×${i})`;
      case 'infrastructure_boost':
        return `Infrastructure investment (${tag})`;
      case 'heatwave':
        return `Heatwave stress event (${tag})`;
      case 'community_grant':
        return `Community stimulus grant (${tag})`;
      case 'major_blackout':
        return `Major blackout crisis (${tag}, ×${i})`;
      case 'port_strike':
        return `Port strike supply collapse (${tag}, ×${i})`;
      case 'interest_rate_shock':
        return `Interest rate shock (${tag}, ×${i})`;
      case 'cyber_attack':
        return `Cyber attack disruption (${tag}, ×${i})`;
      case 'labor_strike':
        return `Labor strike action (${tag})`;
      case 'tariff_shock':
        return `Tariff shock trade barrier (${tag}, ×${i})`;
      default:
        return `${type} fired (${tag})`;
    }
  }

  // === God Mode / Scenario / Test Controls ===

  /** Enable/disable automatic low-probability firing on day boundaries */
  setAutoEnabled(enabled: boolean): void {
    this.autoEnabled = !!enabled;
  }

  getAutoEnabled(): boolean {
    return this.autoEnabled;
  }

  /** Adjust daily auto-fire probability (clamped sane range) */
  setAutoProbability(prob: number): void {
    this.autoProbability = Math.max(0.001, Math.min(0.35, prob));
  }

  getAutoProbability(): number {
    return this.autoProbability;
  }

  getActiveEvents(): CityEvent[] {
    return this.activeEvents.map(e => ({ ...e }));
  }

  getRecentLog(): RecentEventLogEntry[] {
    return this.recentLog.map(e => ({ ...e }));
  }

  /** Clear only the visible recent log (keeps active state) — useful after big scenario resets */
  clearRecentLog(): void {
    this.recentLog = [];
  }

  /** Full reset of event state (primarily tests + extreme scenario tooling) */
  reset(): void {
    this.activeEvents = [];
    this.recentLog = [];
    this.lastCheckedDay = this.timeSystem.day;
    this.eventCounter = 0;
  }

  // === Snapshot & Serialization (core contract) ===

  getSnapshot(): EventSystemSnapshot {
    return {
      activeEvents: this.activeEvents.map(e => ({ ...e })),
      recentLog: this.recentLog.map(l => ({ ...l })),
      autoEnabled: this.autoEnabled,
      autoProbability: this.autoProbability,
      lastCheckedDay: this.lastCheckedDay,
      eventCounter: this.eventCounter,
    };
  }

  /**
   * Restore from a prior snapshot (supports full save/load + scenario roundtrips).
   * Safe against partial or old data.
   */
  loadFromSnapshot(data: Partial<EventSystemSnapshot> | null | undefined): void {
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.activeEvents)) {
      this.activeEvents = data.activeEvents.map((e: any) => ({ ...e }));
    }
    if (Array.isArray(data.recentLog)) {
      this.recentLog = data.recentLog.map((l: any) => ({ ...l }));
    }
    if (typeof data.autoEnabled === 'boolean') {
      this.autoEnabled = data.autoEnabled;
    }
    if (typeof data.autoProbability === 'number' && isFinite(data.autoProbability)) {
      this.autoProbability = Math.max(0.001, Math.min(0.35, data.autoProbability));
    }
    if (typeof data.lastCheckedDay === 'number') {
      this.lastCheckedDay = data.lastCheckedDay;
    }
    if (typeof data.eventCounter === 'number') {
      this.eventCounter = Math.max(0, data.eventCounter);
    }
  }
}
