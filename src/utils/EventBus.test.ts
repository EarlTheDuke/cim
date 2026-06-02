import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('calls subscribed handlers', () => {
    let called = false;
    bus.on('test', () => { called = true; });
    bus.emit('test');
    expect(called).toBe(true);
  });

  it('passes payload to handler', () => {
    let received: any = null;
    bus.on('data', (payload) => { received = payload; });
    bus.emit('data', { value: 42 });
    expect(received).toEqual({ value: 42 });
  });

  it('supports unsubscribe', () => {
    let count = 0;
    const unsub = bus.on('count', () => { count++; });
    bus.emit('count');
    unsub();
    bus.emit('count');
    expect(count).toBe(1);
  });

  it('once only fires once', () => {
    let count = 0;
    bus.once('once-test', () => { count++; });
    bus.emit('once-test');
    bus.emit('once-test');
    expect(count).toBe(1);
  });
});
