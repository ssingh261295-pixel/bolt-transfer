/**
 * DEPRECATED: This hook is no longer used.
 *
 * HMT GTT monitoring has been moved to the server-side edge function.
 * The trigger engine runs continuously on the server and processes
 * all triggers in real-time via WebSocket ticks.
 *
 * This file is kept for backward compatibility but does nothing.
 * The UI now only displays data from the database and listens to
 * real-time changes via Supabase subscriptions.
 */

interface HMTGTTOrder {
  id: string;
  broker_connection_id: string;
  trading_symbol: string;
  exchange: string;
  instrument_token: number;
  condition_type: 'single' | 'two-leg';
  transaction_type: 'BUY' | 'SELL';
  product_type_1: string;
  trigger_price_1: number;
  order_price_1: number;
  quantity_1: number;
  product_type_2?: string;
  trigger_price_2?: number;
  order_price_2?: number;
  quantity_2?: number;
  status: string;
}

export function useHMTGTTMonitor(
  _userId: string | undefined,
  _activeOrders: HMTGTTOrder[],
  _getLTP: (token: number) => number | null,
  _sessionToken: string | undefined,
  _onOrderTriggered?: () => void
) {
  // No-op: All monitoring is done server-side
  return null;
}
