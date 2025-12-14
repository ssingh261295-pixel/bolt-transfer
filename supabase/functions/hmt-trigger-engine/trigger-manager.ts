/**
 * Trigger Manager - In-Memory Storage and Lookup
 * Provides O(1) lookup by instrument_token for fast tick processing
 */

import { HMTTrigger } from './types.ts';

export class TriggerManager {
  // Map: instrument_token -> Set of trigger IDs
  private triggersByInstrument: Map<number, Set<string>> = new Map();

  // Map: trigger_id -> trigger data
  private triggers: Map<string, HMTTrigger> = new Map();

  // Map: parent_id -> [leg1_id, leg2_id] for OCO tracking
  private ocoGroups: Map<string, string[]> = new Map();

  // Set of triggers currently being processed (prevent double execution)
  private processing: Set<string> = new Set();

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

    // Track OCO groups
    if (trigger.condition_type === 'two-leg' && trigger.parent_id) {
      if (!this.ocoGroups.has(trigger.parent_id)) {
        this.ocoGroups.set(trigger.parent_id, []);
      }
      this.ocoGroups.get(trigger.parent_id)!.push(trigger.id);
    }
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

    // Remove from OCO groups
    if (trigger.parent_id) {
      const group = this.ocoGroups.get(trigger.parent_id);
      if (group) {
        const filtered = group.filter(id => id !== triggerId);
        if (filtered.length === 0) {
          this.ocoGroups.delete(trigger.parent_id);
        } else {
          this.ocoGroups.set(trigger.parent_id, filtered);
        }
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
    const triggerIds = this.triggersByInstrument.get(instrumentToken);
    if (!triggerIds || triggerIds.size === 0) {
      return [];
    }

    return Array.from(triggerIds)
      .map(id => this.triggers.get(id))
      .filter((t): t is HMTTrigger => t !== undefined && t.status === 'active');
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
   * Get OCO sibling trigger ID
   */
  getOCOSibling(triggerId: string): string | null {
    const trigger = this.triggers.get(triggerId);
    if (!trigger || !trigger.parent_id) return null;

    const group = this.ocoGroups.get(trigger.parent_id);
    if (!group || group.length !== 2) return null;

    return group.find(id => id !== triggerId) || null;
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
    this.ocoGroups.clear();
    this.processing.clear();
  }
}