/**
 * Simple typed EventBus for the simulation.
 * 
 * Systems can emit events and other systems can subscribe.
 * This keeps coupling low between systems.
 */

type EventHandler<T = any> = (payload: T) => void;

export class EventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  /** Subscribe to an event. Returns unsubscribe function. */
  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler);

    return () => this.off(event, handler);
  }

  /** Subscribe once */
  once<T = any>(event: string, handler: EventHandler<T>): () => void {
    const wrapper = (payload: T) => {
      handler(payload);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  off<T = any>(event: string, handler: EventHandler<T>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /** Emit an event to all listeners */
  emit<T = any>(event: string, payload?: T): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    // Copy to array to allow safe removal during iteration
    [...handlers].forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    });
  }

  /** Remove all listeners (useful for testing/reset) */
  clear(): void {
    this.listeners.clear();
  }

  /** Get current listener count for debugging */
  getListenerCount(event?: string): number {
    if (event) {
      return this.listeners.get(event)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }
}

// Global event bus for the simulation (we can make this injectable later)
export const simulationEvents = new EventBus();
