/**
 * Shared Types for HMT Trigger Engine
 */

export interface HMTTrigger {
  id: string;
  user_id: string;
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
  product_type_2: string | null;
  trigger_price_2: number | null;
  order_price_2: number | null;
  quantity_2: number | null;
  status: 'active' | 'processing' | 'triggered' | 'failed' | 'cancelled' | 'expired';
  parent_id: string | null; // Links OCO legs together
  metadata?: {
    strategy_name?: string;
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
}

export interface BrokerConnection {
  id: string;
  user_id: string;
  broker_name: string;
  access_token: string;
  api_key: string;
  is_active: boolean;
}

export interface WebSocketTick {
  instrument_token: number;
  last_price: number;
  timestamp?: Date;
}

export interface TriggerExecution {
  trigger_id: string;
  trigger: HMTTrigger;
  triggered_leg: '1' | '2';
  ltp: number;
  order_data: {
    exchange: string;
    tradingsymbol: string;
    transaction_type: string;
    quantity: number;
    order_type: string;
    product: string;
    validity: string;
  };
}

export interface OrderResult {
  success: boolean;
  order_id?: string;
  error?: string;
}

export interface EngineConfig {
  enabled: boolean;
  max_retries: number;
  retry_backoff_ms: number;
  health_check_interval_ms: number;
  reconnect_delay_ms: number;
}

export interface EngineStats {
  active_triggers: number;
  subscribed_instruments: number;
  processed_ticks: number;
  triggered_orders: number;
  failed_orders: number;
  uptime_seconds: number;
  websocket_status: 'connected' | 'disconnected' | 'connecting';
  last_tick_time: Date | null;
}