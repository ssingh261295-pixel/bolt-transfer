/**
 * Trigger Manager - In-Memory Storage and Lookup
 * Provides O(1) lookup by instrument_token for fast tick processing
 */

import { HMTTrigger } from './types.ts';

const EMPTY: HMTTrigger[] = Object.freeze([]) as any;

export class TriggerManager {
  // Map: instrument_token -> Set of trigger IDs
  private triggersByInstrument: Map<number, Set<string>> = new Map();

  // Map: trigger_id -> trigger data
  private triggers: Map<string, HMTTrigger> = new Map();

  // Set of triggers currently being processed (prevent double execution)
  private processing: Set<string> = new Set();

  // Map: broker_connection_id -> Set of instrument tokens
  private instrumentsByBroker: Map<string, Set<number>> = new Map();

  /**
   * Load triggers from database on startup
   */
  addTrigger(trigger: HMTTrigger): void {
    this.triggers.set(trigger.id, trigger);

    // Index by instrument token
    if (!this.triggersByInstrument.has(trigger.instrument_token)) {
      this.triggersByInstrument.set(trigger.instrument_token, new Set());
    }
    this.triggersByInstrument.get(trigger.instrument_token)!.add(trigger.id);

    // Index by broker
    if (!this.instrumentsByBroker.has(trigger.broker_connection_id)) {
      this.instrumentsByBroker.set(trigger.broker_connection_id, new Set());
    }
    this.instrumentsByBroker.get(trigger.broker_connection_id)!.add(trigger.instrument_token);
  }

  /**
   * Remove trigger from memory
   */
  removeTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return;

    // Remove from instrument index
    const tokenSet = this.triggersByInstrument.get(trigger.instrument_token);
    if (tokenSet) {
      tokenSet.delete(triggerId);
      if (tokenSet.size === 0) {
        this.triggersByInstrument.delete(trigger.instrument_token);
      }
    }

    // Clean up broker instrument index if no more triggers for this token under this broker
    const brokerTokens = this.instrumentsByBroker.get(trigger.broker_connection_id);
    if (brokerTokens) {
      const tokenSet = this.triggersByInstrument.get(trigger.instrument_token);
      if (!tokenSet || tokenSet.size === 0) {
        brokerTokens.delete(trigger.instrument_token);
        if (brokerTokens.size === 0) this.instrumentsByBroker.delete(trigger.broker_connection_id);
      }
    }

    // Remove from main storage
    this.triggers.delete(triggerId);
    this.processing.delete(triggerId);
  }

  /**
   * Get all triggers for a specific instrument (O(1) lookup)
   */
  getTriggersForInstrument(instrumentToken: number): HMTTrigger[] {
    const ids = this.triggersByInstrument.get(instrumentToken);
    if (!ids || ids.size === 0) return EMPTY;

    if (ids.size === 1) {
      const t = this.triggers.get(ids.values().next().value);
      return (t && t.status === 'active') ? [t] : EMPTY;
    }

    const result: HMTTrigger[] = [];
    for (const id of ids) {
      const t = this.triggers.get(id);
      if (t && t.status === 'active') result.push(t);
    }
    return result;
  }

  getInstrumentsForBroker(brokerId: string): number[] {
    return Array.from(this.instrumentsByBroker.get(brokerId) || []);
  }

  /**
   * Get a specific trigger
   */
  getTrigger(triggerId: string): HMTTrigger | undefined {
    return this.triggers.get(triggerId);
  }

  /**
   * Mark trigger as processing (prevent duplicate execution)
   */
  markProcessing(triggerId: string): boolean {
    if (this.processing.has(triggerId)) {
      return false; // Already processing
    }
    this.processing.add(triggerId);
    return true;
  }

  /**
   * Unmark trigger as processing
   */
  unmarkProcessing(triggerId: string): void {
    this.processing.delete(triggerId);
  }

  /**
   * Get all unique instrument tokens being monitored
   */
  getSubscribedInstruments(): number[] {
    return Array.from(this.triggersByInstrument.keys());
  }

  /**
   * Get total number of active triggers
   */
  getActiveTriggerCount(): number {
    return this.triggers.size;
  }

  /**
   * Clear all triggers (for shutdown/restart)
   */
  clear(): void {
    this.triggers.clear();
    this.triggersByInstrument.clear();
    this.processing.clear();
    this.instrumentsByBroker.clear();
  }
}