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
        exchange: trigger.exchange,
        tradingsymbol: trigger.trading_symbol,
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
   */
  private static evaluateOCOTrigger(
    trigger: HMTTrigger,
    ltp: number
  ): TriggerExecution | null {
    // Check Leg 1 (typically stop-loss)
    let leg1Triggered = false;
    if (trigger.transaction_type === 'BUY') {
      leg1Triggered = ltp >= trigger.trigger_price_1;
    } else {
      leg1Triggered = ltp <= trigger.trigger_price_1;
    }

    // Check Leg 2 (typically target)
    let leg2Triggered = false;
    if (trigger.trigger_price_2 !== null) {
      if (trigger.transaction_type === 'BUY') {
        // For BUY position, target is below (take profit on the way down)
        leg2Triggered = ltp <= trigger.trigger_price_2;
      } else {
        // For SELL position, target is above (take profit on the way up)
        leg2Triggered = ltp >= trigger.trigger_price_2;
      }
    }

    // Prioritize leg 1 (stop-loss) over leg 2 (target) if both trigger simultaneously
    if (leg1Triggered) {
      return {
        trigger_id: trigger.id,
        trigger: trigger,
        triggered_leg: '1',
        ltp: ltp,
        order_data: {
          exchange: trigger.exchange,
          tradingsymbol: trigger.trading_symbol,
          transaction_type: trigger.transaction_type,
          quantity: trigger.quantity_1,
          order_type: 'MARKET',
          product: trigger.product_type_1,
          validity: 'DAY'
        }
      };
    }

    if (leg2Triggered && trigger.quantity_2 && trigger.product_type_2) {
      return {
        trigger_id: trigger.id,
        trigger: trigger,
        triggered_leg: '2',
        ltp: ltp,
        order_data: {
          exchange: trigger.exchange,
          tradingsymbol: trigger.trading_symbol,
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