/**
 * Trigger Evaluator - Evaluates trigger conditions against live prices
 */

import { HMTTrigger, TriggerExecution } from './types.ts';

export class TriggerEvaluator {
  /**
   * Evaluate if a trigger should execute based on current price
   * Returns null if no execution needed, or TriggerExecution if conditions are met
   */
  static evaluate(trigger: HMTTrigger, ltp: number): TriggerExecution | null {
    if (trigger.status !== 'active') {
      return null;
    }

    if (trigger.condition_type === 'single') {
      return this.evaluateSingleTrigger(trigger, ltp);
    } else if (trigger.condition_type === 'two-leg') {
      return this.evaluateOCOTrigger(trigger, ltp);
    }

    return null;
  }

  /**
   * Evaluate single trigger condition
   */
  private static evaluateSingleTrigger(
    trigger: HMTTrigger,
    ltp: number
  ): TriggerExecution | null {
    let shouldTrigger = false;

    if (trigger.transaction_type === 'BUY') {
      // Buy trigger: LTP >= trigger price
      shouldTrigger = ltp >= trigger.trigger_price_1;
    } else {
      // Sell trigger: LTP <= trigger price
      shouldTrigger = ltp <= trigger.trigger_price_1;
    }

    if (!shouldTrigger) {
      return null;
    }

    return {
      trigger_id: trigger.id,
      trigger: trigger,
      triggered_leg: '1',
      ltp: ltp,
      order_data: {
        symbol: trigger.trading_symbol,
        exchange: trigger.exchange,
        transaction_type: trigger.transaction_type,
        quantity: trigger.quantity_1,
        order_type: 'MARKET',
        product: trigger.product_type_1,
        validity: 'DAY'
      }
    };
  }

  /**
   * Evaluate OCO (One-Cancels-Other) trigger condition
   * Two legs: typically stop-loss and target
   *
   * IMPORTANT: transaction_type represents the EXIT order, not the entry!
   * - SELL = Exiting a long position (entry was BUY)
   *   - Leg 1 (stop-loss): trigger when price goes DOWN (ltp <= trigger_price_1)
   *   - Leg 2 (target): trigger when price goes UP (ltp >= trigger_price_2)
   * - BUY = Exiting a short position (entry was SELL)
   *   - Leg 1 (stop-loss): trigger when price goes UP (ltp >= trigger_price_1)
   *   - Leg 2 (target): trigger when price goes DOWN (ltp <= trigger_price_2)
   */
  private static evaluateOCOTrigger(
    trigger: HMTTrigger,
    ltp: number
  ): TriggerExecution | null {
    // Check Leg 1 (typically stop-loss)
    let leg1Triggered = false;
    if (trigger.transaction_type === 'SELL') {
      // Exiting long position: stop-loss triggers when price goes DOWN
      leg1Triggered = ltp <= trigger.trigger_price_1;
    } else {
      // Exiting short position: stop-loss triggers when price goes UP
      leg1Triggered = ltp >= trigger.trigger_price_1;
    }

    // Check Leg 2 (typically target)
    let leg2Triggered = false;
    if (trigger.trigger_price_2 !== null) {
      if (trigger.transaction_type === 'SELL') {
        // Exiting long position: target triggers when price goes UP
        leg2Triggered = ltp >= trigger.trigger_price_2;
      } else {
        // Exiting short position: target triggers when price goes DOWN
        leg2Triggered = ltp <= trigger.trigger_price_2;
      }
    }

    // Prioritize leg 1 (stop-loss) over leg 2 (target) if both trigger simultaneously
    if (leg1Triggered) {
      console.log(`[Trigger Evaluator] Leg 1 (SL) triggered for ${trigger.id}: LTP=${ltp}, Trigger=${trigger.trigger_price_1}, Type=${trigger.transaction_type}`);
      return {
        trigger_id: trigger.id,
        trigger: trigger,
        triggered_leg: '1',
        ltp: ltp,
        order_data: {
          symbol: trigger.trading_symbol,
          exchange: trigger.exchange,
          transaction_type: trigger.transaction_type,
          quantity: trigger.quantity_1,
          order_type: 'MARKET',
          product: trigger.product_type_1,
          validity: 'DAY'
        }
      };
    }

    if (leg2Triggered && trigger.quantity_2 && trigger.product_type_2) {
      console.log(`[Trigger Evaluator] Leg 2 (Target) triggered for ${trigger.id}: LTP=${ltp}, Trigger=${trigger.trigger_price_2}, Type=${trigger.transaction_type}`);
      return {
        trigger_id: trigger.id,
        trigger: trigger,
        triggered_leg: '2',
        ltp: ltp,
        order_data: {
          symbol: trigger.trading_symbol,
          exchange: trigger.exchange,
          transaction_type: trigger.transaction_type,
          quantity: trigger.quantity_2,
          order_type: 'MARKET',
          product: trigger.product_type_2,
          validity: 'DAY'
        }
      };
    }

    return null;
  }
}