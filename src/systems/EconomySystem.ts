/**
 * EconomySystem
 * 
 * Lightweight market and aggregate economic tracking system for CityWithLifeGrok.
 * 
 * === RESPONSIBILITIES (Phase 4 Foundation Slice) ===
 * - Maintain a simple price book for resources (ore, lumber, crops, food, goods, oil, + extensible).
 * - Facilitate resource trades:
 *   • Business ↔ Central Market (external demand/supply at listed prices)
 *   • Business ↔ Business (peer-to-peer B2B at market or negotiated price)
 * - Provide periodic processing hooks (update() + explicit market steps) that can be driven by Simulation
 *   or a future BusinessSystem on day/hour boundaries.
 * - Compute and expose live aggregate statistics:
 *   • Total cash across registered businesses
 *   • Total inventory value (marked-to-market using current prices)
 *   • Per-resource aggregate holdings
 *   • Cumulative trade volume and GDP-like activity metric (value of facilitated transactions)
 * - Emit typed events for all trades and daily rollovers (observable by UI, inspectors, future charts, loggers).
 * - Full observability: getSnapshot(), getEconomyStats(), price queries.
 * - Serializable (prices + cumulative counters). Business entities themselves remain the source of truth
 *   for their cash/inventory; EconomySystem only references them for aggregation and facilitation.
 * 
 * === NON-RESPONSIBILITIES (deliberately out of scope for this slice) ===
 * - Owning or creating Business instances (future BusinessSystem owns the roster and calls processDay).
 * - Dynamic price discovery, supply/demand curves, or limited central pool stock (prices are currently fixed;
 *   easy extension point via setResourcePrice or future pricing model).
 * - Automatically consuming inputs in recipes or complex production chains.
 * - Wages, resident money flows, or tax/government layer (payday still lives in ResidentsSystem for now).
 * - Bankruptcy, credit, or advanced financial instruments.
 * 
 * === DESIGN PRINCIPLES ===
 * - Lightweight and focused: one file, minimal state, no heavy dependencies.
 * - Mutation via explicit trade calls (caller decides when to trade). Periodic step is opt-in and conservative.
 * - Central "market" is an infinite counterparty (models external consumers + raw suppliers). This is
 *   consistent with how individual Businesses currently generate revenue in processDay().
 * - Peer trades conserve cash and goods between businesses.
 * - Safe partial fills: never over-sell inventory or let a buyer go negative cash.
 * - Works standalone in tests or when registered via Simulation.registerSystem().
 * - Prepares the ground for:
 *   • Agentic businesses (Phase 7) that read prices + call trade methods as part of decisions
 *   • Charts / GDP visualizers
 *   • More sophisticated EconomySystem later (auctions, contracts, futures, inflation)
 * 
 * === INTEGRATION ===
 * - Construct with a TimeSystem (for day-boundary detection in update()).
 * - Optionally pass a custom EventBus for isolated testing; defaults to the global simulationEvents.
 * - Register businesses you want included in aggregates and auto market steps.
 * - Call update() every tick (via registerSystem) OR manually invoke processMarketStep() on day changes.
 * - Trades mutate the passed Business instances directly (cash + inventory). This is intentional and
 *   matches the pattern used by ResidentsSystem.
 * 
 * === FUTURE HOOKS (documented for next agents) ===
 * - Dynamic pricing strategy can be injected by overriding or wrapping getResourcePrice().
 * - processMarketStep(autoLiquidateFraction) is a safe place for simple auto-clearing behavior.
 * - Add "market depth" or order book later without breaking TradeResult / stats interfaces.
 * - GDP can be refined to "value added" once production reporting lands.
 * 
 * References:
 * - ARCHITECTURE.md (EconomySystem planned role)
 * - src/entities/Business.ts (inventory, cash, getPrimaryOutput, processDay internal sales)
 * - plans/city-with-life-development-plan.md (Phase 4 economy emergence)
 * - references/simcity-claude-reference.md (resource trading, GDP tracking)
 */

import type { Business, BusinessId } from '../entities/Business';
import type { TimeSystem } from '../core/TimeSystem';
import { EventBus, simulationEvents } from '../utils/EventBus';

export interface TradeResult {
  success: boolean;
  /** 'market' for central pool trades; otherwise the BusinessId of the counterparty */
  buyerId: BusinessId | 'market';
  sellerId: BusinessId | 'market';
  resource: string;
  /** Actual quantity transferred after clamping (partial fills are supported) */
  quantity: number;
  pricePerUnit: number;
  totalValue: number;
  reason?: string;
}

export interface EconomyStats {
  registeredBusinessCount: number;
  /** Sum of .cash across all registered businesses (rounded) */
  totalBusinessCash: number;
  /** Aggregate inventory value across businesses using current market prices (rounded) */
  totalGoodsValue: number;
  /** Total physical units held per resource type across all registered businesses */
  resourceTotals: Record<string, number>;
  /** Lifetime value of all trades (market + p2p) facilitated by this system */
  cumulativeTradeVolume: number;
  /** GDP-like proxy: cumulative economic activity measured by value of facilitated trades */
  cumulativeGDP: number;
  /** Live view of the price book (resource -> price per unit) */
  currentPrices: Record<string, number>;
  /** Cumulative rent collected from residents via payday flows (housing market) */
  totalRentCollected: number;
  /** Rent collected on the current simulated day (resets on day rollover) */
  dailyRentCollected: number;
}

export interface EconomySnapshot extends EconomyStats {
  /** Current simulated time (hours) at snapshot */
  timeHours: number;
  /** Last simulated day number we processed a rollover for */
  lastProcessedDay: number;
  /** Trade volume that occurred on the in-progress day (resets on rollover) */
  dailyTradeVolume: number;
}

/**
 * EconomySystem implements a simple but useful central market + inter-business trading layer.
 */
export class EconomySystem {
  private readonly businesses: Map<BusinessId, Business> = new Map();
  private readonly timeSystem: TimeSystem;
  private readonly events: EventBus;

  /** Current market prices. Mutable via setResourcePrice for testing / God Mode / future agents. */
  private prices: Record<string, number>;

  // Cumulative counters (economy-owned state)
  private cumulativeTradeVolume: number = 0;
  private cumulativeGDP: number = 0;
  private dailyTradeVolume: number = 0;

  // Housing rent flow counters (populated via ResidentsSystem payday events + direct hook)
  private cumulativeRentCollected: number = 0;
  private dailyRentCollected: number = 0;

  // Day tracking for periodic behavior (independent of any other system's counters)
  private lastProcessedDay: number = -1;

  /** Base prices for core resources. Matches sensible defaults from Business.ts where possible. */
  static readonly DEFAULT_PRICES: Record<string, number> = {
    ore: 48,
    lumber: 29,
    crops: 11,
    food: 21,
    goods: 68,
    oil: 95,
  };

  /** Fallback price for any unknown resource type */
  private static readonly DEFAULT_PRICE = 25;

  constructor(timeSystem: TimeSystem, eventBus: EventBus = simulationEvents) {
    this.timeSystem = timeSystem;
    this.events = eventBus;
    this.prices = { ...EconomySystem.DEFAULT_PRICES };

    // Listen for rent collections emitted by ResidentsSystem on paydays (decoupled housing->economy flow)
    this.events.on('economy:rent-collected', (data: any) => {
      const amt = typeof data?.amount === 'number' ? data.amount : 0;
      if (amt > 0) {
        this.cumulativeRentCollected += amt;
        this.dailyRentCollected += amt;
      }
    });
  }

  // === Business Registration (for aggregates + optional auto steps) ===

  /** Register a business so it participates in aggregates and automatic market steps. Idempotent. */
  registerBusiness(business: Business): void {
    if (!business || !business.id) return;
    this.businesses.set(business.id, business);
  }

  /** Remove a business from registry (does not affect its state). */
  unregisterBusiness(id: BusinessId): void {
    this.businesses.delete(id);
  }

  /** All currently registered businesses (live references). */
  getRegisteredBusinesses(): Business[] {
    return Array.from(this.businesses.values());
  }

  getBusinessCount(): number {
    return this.businesses.size;
  }

  // === Pricing ===

  /** Current market price for a resource (falls back to DEFAULT_PRICE). */
  getResourcePrice(resource: string): number {
    if (!resource) return EconomySystem.DEFAULT_PRICE;
    return this.prices[resource] ?? EconomySystem.DEFAULT_PRICE;
  }

  /** Update the listed price for a resource. Useful for testing, God Mode, or dynamic pricing experiments. */
  setResourcePrice(resource: string, price: number): void {
    if (!resource || price <= 0) return;
    this.prices[resource] = price;
  }

  /** Snapshot of the entire current price book (defensive copy). */
  getAllPrices(): Record<string, number> {
    return { ...this.prices };
  }

  // === Core Trading APIs (the heart of inter-business / market interaction) ===

  /**
   * Sell `quantity` units of `resource` from the given business into the central market.
   * The business receives cash; goods are removed from its inventory.
   * Partial fills are supported (you may sell less than requested if inventory is low).
   * 
   * This models external consumer / export demand at the current listed price.
   */
  sellToMarket(business: Business, resource: string, quantity: number, overridePrice?: number): TradeResult {
    if (!business || !resource || quantity <= 0) {
      return this.makeFailedTrade('market', business?.id ?? 'unknown', resource, 0, 0, 'invalid parameters');
    }

    const price = overridePrice ?? this.getResourcePrice(resource);
    const actualQty = business.removeFromInventory(resource, quantity);
    if (actualQty <= 0) {
      return this.makeFailedTrade('market', business.id, resource, 0, price, 'insufficient inventory');
    }

    const value = actualQty * price;
    business.cash += value;

    this.recordTradeValue(value);

    const result: TradeResult = {
      success: true,
      buyerId: 'market',
      sellerId: business.id,
      resource,
      quantity: actualQty,
      pricePerUnit: Math.round(price * 100) / 100,
      totalValue: Math.round(value * 100) / 100,
    };

    this.events.emit('economy:trade', result);
    return result;
  }

  /**
   * Buy `quantity` units of `resource` for the given business from the central market.
   * The business spends cash; goods are added to inventory.
   * Partial fills supported based on available cash.
   * 
   * This models purchasing inputs / imports from external suppliers at the listed price.
   */
  buyFromMarket(business: Business, resource: string, quantity: number, overridePrice?: number): TradeResult {
    if (!business || !resource || quantity <= 0) {
      return this.makeFailedTrade(business?.id ?? 'unknown', 'market', resource, 0, 0, 'invalid parameters');
    }

    const price = overridePrice ?? this.getResourcePrice(resource);
    if (price <= 0) {
      return this.makeFailedTrade(business.id, 'market', resource, 0, 0, 'invalid price');
    }

    const maxAffordable = Math.floor(business.cash / price);
    const actualQty = Math.min(quantity, Math.max(0, maxAffordable));
    if (actualQty <= 0) {
      return this.makeFailedTrade(business.id, 'market', resource, 0, price, 'insufficient funds');
    }

    const value = actualQty * price;
    business.cash -= value;
    business.addToInventory(resource, actualQty);

    this.recordTradeValue(value);

    const result: TradeResult = {
      success: true,
      buyerId: business.id,
      sellerId: 'market',
      resource,
      quantity: actualQty,
      pricePerUnit: Math.round(price * 100) / 100,
      totalValue: Math.round(value * 100) / 100,
    };

    this.events.emit('economy:trade', result);
    return result;
  }

  /**
   * Execute a direct peer-to-peer trade: buyer purchases `resource` from seller.
   * Cash moves from buyer to seller; goods move from seller to buyer.
   * Uses current market price unless overridePrice is supplied.
   * Partial execution on both cash and inventory availability.
   */
  tradeBetween(
    buyer: Business,
    seller: Business,
    resource: string,
    quantity: number,
    overridePrice?: number
  ): TradeResult {
    if (!buyer || !seller || !resource || quantity <= 0) {
      return this.makeFailedTrade(
        buyer?.id ?? 'unknown',
        seller?.id ?? 'unknown',
        resource,
        0,
        0,
        'invalid parameters'
      );
    }
    if (buyer.id === seller.id) {
      return this.makeFailedTrade(buyer.id, seller.id, resource, 0, 0, 'cannot trade with self');
    }

    const price = overridePrice ?? this.getResourcePrice(resource);
    if (price <= 0) {
      return this.makeFailedTrade(buyer.id, seller.id, resource, 0, 0, 'invalid price');
    }

    const maxBuyerCanAfford = Math.floor(buyer.cash / price);
    const desiredQty = Math.min(quantity, maxBuyerCanAfford);
    if (desiredQty <= 0) {
      return this.makeFailedTrade(buyer.id, seller.id, resource, 0, price, 'buyer has insufficient funds');
    }

    const actualQty = seller.removeFromInventory(resource, desiredQty);
    if (actualQty <= 0) {
      return this.makeFailedTrade(buyer.id, seller.id, resource, 0, price, 'seller has insufficient inventory');
    }

    const value = actualQty * price;
    buyer.cash -= value;
    seller.cash += value;
    buyer.addToInventory(resource, actualQty);

    this.recordTradeValue(value);

    const result: TradeResult = {
      success: true,
      buyerId: buyer.id,
      sellerId: seller.id,
      resource,
      quantity: actualQty,
      pricePerUnit: Math.round(price * 100) / 100,
      totalValue: Math.round(value * 100) / 100,
    };

    this.events.emit('economy:trade', result);
    return result;
  }

  private makeFailedTrade(
    buyerId: BusinessId | 'market',
    sellerId: BusinessId | 'market',
    resource: string,
    quantity: number,
    price: number,
    reason: string
  ): TradeResult {
    return {
      success: false,
      buyerId,
      sellerId,
      resource: resource || 'unknown',
      quantity,
      pricePerUnit: Math.round(price * 100) / 100,
      totalValue: 0,
      reason,
    };
  }

  private recordTradeValue(value: number): void {
    if (value <= 0) return;
    this.cumulativeTradeVolume += value;
    this.cumulativeGDP += value;
    this.dailyTradeVolume += value;
  }

  // === Periodic Processing (call via Simulation.registerSystem or manually) ===

  /**
   * Lightweight per-tick entry point.
   * Detects simulated day boundaries and emits daily economic reports.
   * Does NOT perform automatic trading — call processMarketStep() explicitly when desired
   * (e.g. from a BusinessSystem at the start of each simulated day).
   */
  update(): void {
    const currentDay = Math.floor(this.timeSystem.timeHours / 24);
    if (currentDay !== this.lastProcessedDay) {
      this.processDayRollover(currentDay);
    }
  }

  private processDayRollover(newDay: number): void {
    const stats = this.getEconomyStats();

    this.events.emit('economy:daily-report', {
      day: newDay,
      ...stats,
      dailyTradeVolume: Math.round(this.dailyTradeVolume * 100) / 100,
    });

    this.dailyTradeVolume = 0;
    this.dailyRentCollected = 0;
    this.lastProcessedDay = newDay;
  }

  /**
   * Perform an explicit market clearing / step.
   * 
   * In this foundation version we auto-liquidate a configurable fraction of each
   * registered business's *primary output* inventory into the central market.
   * Phase A: default raised for stronger visible supply/demand signals + trade flows.
   * This demonstrates the EconomySystem facilitating ongoing sales channels that are
   * separate from a business's own internal processDay() logic.
   * 
   * Safe to call multiple times per day. Returns the total value moved in this step.
   * 
   * Future BusinessSystem or agentic brains can call this (or more sophisticated variants)
   * or perform their own targeted sellToMarket calls instead.
   */
  processMarketStep(autoLiquidateFraction: number = 0.22): number { // Phase A Core Stabilization: stronger default liquidation fraction for lively trade volume from boot
    let stepVolume = 0;

    for (const biz of this.businesses.values()) {
      const primary = biz.getPrimaryOutput();
      const available = typeof biz.getInventory(primary) === 'number'
        ? (biz.getInventory(primary) as number)
        : 0;

      if (available > 0) {
        const target = Math.floor(available * Math.max(0, Math.min(1, autoLiquidateFraction)));
        if (target > 0) {
          const result = this.sellToMarket(biz, primary, target);
          if (result.success) {
            stepVolume += result.totalValue;
          }
        }
      }
    }

    this.events.emit('economy:market-step', {
      volume: Math.round(stepVolume * 100) / 100,
      businessesAffected: this.businesses.size,
      fraction: autoLiquidateFraction,
    });

    return stepVolume;
  }

  // === Housing Rent Flow Hook (called by ResidentsSystem payday or God Mode / tests) ===

  /**
   * Direct hook to record rent money collected from residents (housing market).
   * Updates cumulative + daily counters used in stats/snapshots/charts.
   * Complements the event listener path (ResidentsSystem emits 'economy:rent-collected' on paydays).
   * Safe for tests that construct Economy in isolation.
   */
  recordRentCollection(amount: number, _payerCount: number = 1): void {
    if (!amount || amount <= 0) return;
    this.cumulativeRentCollected += amount;
    this.dailyRentCollected += amount;
    // Do not re-emit here (avoids double-count with listener); source (Residents) emits the event.
  }

  // === Observability & Aggregates ===

  /**
   * Live computed aggregates across all *registered* businesses.
   * Values are rounded for display / stability. Recomputed on every call (cheap at expected scale).
   */
  getEconomyStats(): EconomyStats {
    const bizs = this.getRegisteredBusinesses();
    let totalCash = 0;
    const resourceTotals: Record<string, number> = {};
    let totalValue = 0;

    for (const b of bizs) {
      totalCash += b.cash || 0;

      const inv = b.getInventory() as Record<string, number>;
      for (const [res, qtyRaw] of Object.entries(inv)) {
        const qty = qtyRaw || 0;
        resourceTotals[res] = (resourceTotals[res] ?? 0) + qty;
        totalValue += qty * this.getResourcePrice(res);
      }
    }

    return {
      registeredBusinessCount: bizs.length,
      totalBusinessCash: Math.round(totalCash * 100) / 100,
      totalGoodsValue: Math.round(totalValue * 100) / 100,
      resourceTotals,
      cumulativeTradeVolume: Math.round(this.cumulativeTradeVolume * 100) / 100,
      cumulativeGDP: Math.round(this.cumulativeGDP * 100) / 100,
      currentPrices: this.getAllPrices(),
      totalRentCollected: Math.round(this.cumulativeRentCollected * 100) / 100,
      dailyRentCollected: Math.round(this.dailyRentCollected * 100) / 100,
    };
  }

  /**
   * Rich snapshot suitable for inspectors, dashboards, and save/load UI.
   * Includes time context and daily counters.
   */
  getSnapshot(): EconomySnapshot {
    const stats = this.getEconomyStats();
    return {
      ...stats,
      timeHours: this.timeSystem.timeHours,
      lastProcessedDay: this.lastProcessedDay,
      dailyTradeVolume: Math.round(this.dailyTradeVolume * 100) / 100,
    };
  }

  // === Serialization (economy-owned state only) ===

  /**
   * Serialize the EconomySystem's own state (prices + counters + day tracking).
   * Does NOT include full business snapshots — re-register businesses after load.
   */
  toJSON(): any {
    return {
      prices: { ...this.prices },
      cumulativeTradeVolume: this.cumulativeTradeVolume,
      cumulativeGDP: this.cumulativeGDP,
      dailyTradeVolume: this.dailyTradeVolume,
      lastProcessedDay: this.lastProcessedDay,
      registeredBusinessIds: Array.from(this.businesses.keys()),
      // Housing rent persistence
      cumulativeRentCollected: this.cumulativeRentCollected,
      dailyRentCollected: this.dailyRentCollected,
    };
  }

  /**
   * Reconstruct an EconomySystem from a previous toJSON() payload.
   * You must re-register any businesses after loading (they are external references).
   */
  static fromJSON(data: any, timeSystem: TimeSystem, eventBus?: EventBus): EconomySystem {
    const sys = new EconomySystem(timeSystem, eventBus ?? simulationEvents);

    if (data && typeof data === 'object') {
      if (data.prices && typeof data.prices === 'object') {
        sys.prices = { ...data.prices };
      }
      if (typeof data.cumulativeTradeVolume === 'number') {
        sys.cumulativeTradeVolume = data.cumulativeTradeVolume;
      }
      if (typeof data.cumulativeGDP === 'number') {
        sys.cumulativeGDP = data.cumulativeGDP;
      }
      if (typeof data.dailyTradeVolume === 'number') {
        sys.dailyTradeVolume = data.dailyTradeVolume;
      }
      if (typeof data.lastProcessedDay === 'number') {
        sys.lastProcessedDay = data.lastProcessedDay;
      }
      if (typeof data.cumulativeRentCollected === 'number') {
        sys.cumulativeRentCollected = data.cumulativeRentCollected;
      }
      if (typeof data.dailyRentCollected === 'number') {
        sys.dailyRentCollected = data.dailyRentCollected;
      }
      // registeredBusinessIds are informational only; caller re-registers
    }

    return sys;
  }

  // === Test / Debug Utilities ===

  /** Reset all cumulative counters and daily volume (prices and registrations preserved). Useful in tests. */
  resetCounters(): void {
    this.cumulativeTradeVolume = 0;
    this.cumulativeGDP = 0;
    this.dailyTradeVolume = 0;
    this.cumulativeRentCollected = 0;
    this.dailyRentCollected = 0;
  }

  /** Remove all registered businesses (for test isolation). Does not mutate the businesses themselves. */
  clear(): void {
    this.businesses.clear();
    this.lastProcessedDay = -1;
    this.dailyRentCollected = 0;
    this.resetCounters();
  }
}
