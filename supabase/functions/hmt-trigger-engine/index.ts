/**
 * HMT Trigger Engine - Server-Side Event-Driven Trigger System
 *
 * This edge function runs continuously and:
 * 1. Maintains active triggers in memory for O(1) lookup
 * 2. Connects to Zerodha WebSocket for real-time price data
 * 3. Evaluates trigger conditions on every tick (event-driven, no polling)
 * 4. Places orders immediately when conditions are met
 * 5. Updates database asynchronously (non-blocking)
 * 6. Handles OCO (One-Cancels-Other) logic atomically
 *
 * Architecture:
 * - Long-running WebSocket connection
 * - In-memory trigger storage grouped by instrument_token
 * - Sub-100ms execution target
 * - Handles 100+ concurrent triggers
 * - FULLY AUTONOMOUS: Auto-starts, auto-reconnects, self-healing
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { TriggerManager } from './trigger-manager.ts';
import { TriggerEvaluator } from './trigger-evaluator.ts';
import { OrderExecutor } from './order-executor.ts';
import { WebSocketManager } from './websocket-manager.ts';
import { HMTTrigger, BrokerConnection, EngineConfig, EngineStats, WebSocketTick } from './types.ts';

// Global engine state
let triggerManager: TriggerManager | null = null;
let wsManager: WebSocketManager | null = null;
let orderExecutor: OrderExecutor | null = null;
let engineStartTime: Date | null = null;
let isEngineRunning = false;
let engineInstanceId: string = crypto.randomUUID();

// Stats tracking
const stats: EngineStats = {
  active_triggers: 0,
  subscribed_instruments: 0,
  processed_ticks: 0,
  triggered_orders: 0,
  failed_orders: 0,
  uptime_seconds: 0,
  websocket_status: 'disconnected',
  last_tick_time: null
};

// Engine error state
let engineError: string | null = null;

// Heartbeat interval
let heartbeatInterval: number | null = null;

// Lazy-initialized config and clients
let config: EngineConfig | null = null;
let supabase: any = null;

function getConfig(): EngineConfig {
  if (!config) {
    config = {
      enabled: Deno.env.get('HMT_ENGINE_ENABLED') !== 'false',
      max_retries: parseInt(Deno.env.get('HMT_MAX_RETRIES') || '2'),
      retry_backoff_ms: parseInt(Deno.env.get('HMT_RETRY_BACKOFF_MS') || '1000'),
      health_check_interval_ms: parseInt(Deno.env.get('HMT_HEALTH_CHECK_INTERVAL_MS') || '30000'),
      reconnect_delay_ms: parseInt(Deno.env.get('HMT_RECONNECT_DELAY_MS') || '5000')
    };
  }
  return config;
}

function getSupabase() {
  if (!supabase) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

// ... rest of the file content follows exactly as read ...