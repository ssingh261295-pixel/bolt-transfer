/**
 * Order Executor - Places orders via Zerodha API
 */

import { TriggerExecution, OrderResult, BrokerConnection } from './types.ts';

export class OrderExecutor {
  private supabaseUrl: string;
  private supabaseKey: string;
  private maxRetries: number;
  private retryBackoffMs: number;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    maxRetries: number = 2,
    retryBackoffMs: number = 1000
  ) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.maxRetries = maxRetries;
    this.retryBackoffMs = retryBackoffMs;
  }

  /**
   * Execute a trigger by placing a market order
   */
  async execute(
    execution: TriggerExecution,
    broker: BrokerConnection
  ): Promise<OrderResult> {
    let lastError: string = '';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff
          const delay = this.retryBackoffMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          console.log(`[OrderExecutor] Retry attempt ${attempt} for trigger ${execution.trigger_id}`);
        }

        const result = await this.placeOrder(execution, broker);

        if (result.success) {
          console.log(`[OrderExecutor] Order placed successfully: ${result.order_id} for trigger ${execution.trigger_id}`);
          return result;
        }

        lastError = result.error || 'Unknown error';

        // Don't retry on certain errors (e.g., insufficient funds, invalid parameters)
        if (this.isNonRetryableError(lastError)) {
          console.error(`[OrderExecutor] Non-retryable error for trigger ${execution.trigger_id}: ${lastError}`);
          break;
        }
      } catch (error: any) {
        lastError = error.message || 'Network error';
        console.error(`[OrderExecutor] Exception on attempt ${attempt} for trigger ${execution.trigger_id}:`, error);
      }
    }

    return {
      success: false,
      error: lastError
    };
  }

  /**
   * Place order via zerodha-orders edge function
   */
  private async placeOrder(
    execution: TriggerExecution,
    broker: BrokerConnection
  ): Promise<OrderResult> {
    const url = `${this.supabaseUrl}/functions/v1/zerodha-orders?broker_id=${broker.id}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(execution.order_data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`
      };
    }

    const result = await response.json();

    if (result.success && result.order_id) {
      return {
        success: true,
        order_id: result.order_id
      };
    }

    return {
      success: false,
      error: result.error || result.message || 'Order placement failed'
    };
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRetryableError(error: string): boolean {
    const nonRetryablePatterns = [
      'insufficient funds',
      'insufficient margin',
      'invalid quantity',
      'invalid price',
      'invalid symbol',
      'blocked',
      'disabled',
      'order window closed',
      'market closed'
    ];

    const errorLower = error.toLowerCase();
    return nonRetryablePatterns.some(pattern => errorLower.includes(pattern));
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
