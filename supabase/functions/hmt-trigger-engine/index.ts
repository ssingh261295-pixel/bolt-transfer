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

// Engine configuration with sensible defaults
const config: EngineConfig = {
  enabled: Deno.env.get('HMT_ENGINE_ENABLED') !== 'false', // Enabled by default
  max_retries: parseInt(Deno.env.get('HMT_MAX_RETRIES') || '2'),
  retry_backoff_ms: parseInt(Deno.env.get('HMT_RETRY_BACKOFF_MS') || '1000'),
  health_check_interval_ms: parseInt(Deno.env.get('HMT_HEALTH_CHECK_INTERVAL_MS') || '30000'),
  reconnect_delay_ms: parseInt(Deno.env.get('HMT_RECONNECT_DELAY_MS') || '5000')
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Initialize the trigger engine
 */
async function initializeEngine(): Promise<void> {
  if (isEngineRunning) {
    console.log('[Engine] Already running');
    return;
  }

  if (!config.enabled) {
    console.log('[Engine] Disabled by configuration (HMT_ENGINE_ENABLED=false)');
    return;
  }

  console.log('[Engine] Initializing HMT Trigger Engine...');

  // Acquire distributed lock (SINGLETON ENFORCEMENT)
  const lockAcquired = await acquireEngineLock();
  if (!lockAcquired) {
    engineError = 'Another engine instance is already running. Only one engine can execute orders.';
    console.error('[Engine]', engineError);
    return;
  }

  engineStartTime = new Date();
  isEngineRunning = true;
  engineError = null;

  console.log(`[Engine] Lock acquired. Instance ID: ${engineInstanceId}`);

  // Initialize managers
  triggerManager = new TriggerManager();
  orderExecutor = new OrderExecutor(
    supabaseUrl,
    supabaseKey,
    config.max_retries,
    config.retry_backoff_ms
  );

  // Load active triggers from database
  await loadActiveTriggers();

  // Get broker connection for WebSocket (use first active broker)
  const broker = await getActiveBroker();
  if (!broker) {
    engineError = 'No active broker connection found. Please connect a broker account first.';
    console.error('[Engine]', engineError);
    stats.websocket_status = 'disconnected';
    // Keep engine "running" but without WebSocket - will retry when broker is added
    return;
  }

  // Initialize WebSocket manager
  wsManager = new WebSocketManager(
    broker.api_key,
    broker.access_token,
    config.reconnect_delay_ms
  );

  // Set tick handler
  wsManager.setTickHandler(handleTick);

  // Connect to WebSocket
  stats.websocket_status = 'connecting';
  try {
    await wsManager.connect();
    engineError = null;
  } catch (error: any) {
    engineError = `WebSocket connection failed: ${error.message}`;
    console.error('[Engine]', engineError);
    stats.websocket_status = 'disconnected';
  }

  // Subscribe to all instruments
  const instruments = triggerManager.getSubscribedInstruments();
  if (instruments.length > 0) {
    wsManager.subscribe(instruments);
    stats.subscribed_instruments = instruments.length;
  }

  // Start health check monitor
  startHealthCheckMonitor();

  // Start heartbeat updates to database
  startHeartbeatUpdates();

  // Listen to database changes for trigger CRUD
  subscribeToTriggerChanges();

  console.log(`[Engine] Started successfully with ${stats.active_triggers} active triggers`);
}

/**
 * Load active triggers from database into memory
 */
async function loadActiveTriggers(): Promise<void> {
  try {
    const { data: triggers, error } = await supabase
      .from('hmt_gtt_orders')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('[Engine] Error loading triggers:', error);
      return;
    }

    if (triggers && triggerManager) {
      triggers.forEach((trigger: HMTTrigger) => {
        triggerManager.addTrigger(trigger);
      });
      stats.active_triggers = triggerManager.getActiveTriggerCount();
      console.log(`[Engine] Loaded ${stats.active_triggers} active triggers`);
    }
  } catch (error) {
    console.error('[Engine] Exception loading triggers:', error);
  }
}

/**
 * Get active broker connection
 */
async function getActiveBroker(): Promise<BrokerConnection | null> {
  try {
    const { data: brokers, error } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('broker_name', 'zerodha')
      .eq('is_active', true)
      .limit(1);

    if (error || !brokers || brokers.length === 0) {
      return null;
    }

    return brokers[0];
  } catch (error) {
    console.error('[Engine] Error fetching broker:', error);
    return null;
  }
}

/**
 * Handle incoming WebSocket tick (MAIN HOT PATH)
 * This function must be extremely fast (< 1ms per tick)
 */
function handleTick(tick: WebSocketTick): void {
  if (!triggerManager || !orderExecutor) return;

  stats.processed_ticks++;
  stats.last_tick_time = tick.timestamp || new Date();
  stats.websocket_status = 'connected';

  // O(1) lookup: get all triggers for this instrument
  const triggers = triggerManager.getTriggersForInstrument(tick.instrument_token);
  if (triggers.length === 0) return;

  // Evaluate each trigger
  for (const trigger of triggers) {
    // Check if already processing (prevent duplicate execution)
    if (!triggerManager.markProcessing(trigger.id)) {
      continue;
    }

    // Evaluate trigger condition
    const execution = TriggerEvaluator.evaluate(trigger, tick.last_price);

    if (execution) {
      // Trigger condition met - execute order asynchronously
      executeTriggerAsync(execution, trigger).catch(error => {
        console.error(`[Engine] Error executing trigger ${trigger.id}:`, error);
        triggerManager?.unmarkProcessing(trigger.id);
      });
    } else {
      // Condition not met - unmark as processing
      triggerManager.unmarkProcessing(trigger.id);
    }
  }
}

/**
 * Execute trigger asynchronously (non-blocking)
 */
async function executeTriggerAsync(
  execution: any,
  trigger: HMTTrigger
): Promise<void> {
  if (!triggerManager || !orderExecutor) return;

  try {
    // Get broker connection
    const { data: broker, error: brokerError } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('id', trigger.broker_connection_id)
      .single();

    if (brokerError || !broker) {
      console.error(`[Engine] Broker not found for trigger ${trigger.id}`);
      await markTriggerFailed(trigger.id, 'Broker connection not found');
      return;
    }

    // RISK SAFETY: Check user risk limits before placing order
    const riskCheckPassed = await checkRiskLimits(trigger.user_id);
    if (!riskCheckPassed) {
      console.error(`[Engine] Risk limits exceeded for user ${trigger.user_id}`);
      await markTriggerFailed(trigger.id, 'Risk limits exceeded (max trades, max loss, or kill switch)');
      return;
    }

    // Place order
    const result = await orderExecutor.execute(execution, broker);

    if (result.success) {
      // Order placed successfully
      await markTriggerTriggered(
        trigger.id,
        execution.triggered_leg,
        execution.ltp,
        result.order_id!
      );

      // Log trade for audit and risk tracking
      await logTrade(trigger, execution, result.order_id!);

      // Handle OCO: Cancel sibling trigger ATOMICALLY
      if (trigger.condition_type === 'two-leg' && trigger.parent_id) {
        const siblingId = triggerManager.getOCOSibling(trigger.id);
        if (siblingId) {
          // Cancel sibling in database first (atomic guard)
          await cancelTrigger(siblingId, 'OCO sibling executed');
          // Then remove from memory
          triggerManager.removeTrigger(siblingId);
        }
      }

      // Remove from memory
      triggerManager.removeTrigger(trigger.id);

      stats.triggered_orders++;
      console.log(`[Engine] ✓ Trigger ${trigger.id} executed: ${result.order_id}`);
    } else {
      // Order placement failed
      await markTriggerFailed(trigger.id, result.error || 'Unknown error');
      triggerManager.removeTrigger(trigger.id);

      stats.failed_orders++;
      console.error(`[Engine] ✗ Trigger ${trigger.id} failed: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`[Engine] Exception executing trigger ${trigger.id}:`, error);
    await markTriggerFailed(trigger.id, error.message || 'Unknown error');
    triggerManager?.removeTrigger(trigger.id);
    stats.failed_orders++;
  } finally {
    triggerManager?.unmarkProcessing(trigger.id);
  }
}

/**
 * Mark trigger as triggered in database
 */
async function markTriggerTriggered(
  triggerId: string,
  triggeredLeg: string,
  triggeredPrice: number,
  orderId: string
): Promise<void> {
  await supabase
    .from('hmt_gtt_orders')
    .update({
      status: 'triggered',
      triggered_at: new Date().toISOString(),
      triggered_leg: triggeredLeg,
      triggered_price: triggeredPrice,
      order_id: orderId,
      order_status: 'COMPLETE',
      updated_at: new Date().toISOString()
    })
    .eq('id', triggerId);
}

/**
 * Mark trigger as failed in database
 */
async function markTriggerFailed(triggerId: string, errorMessage: string): Promise<void> {
  await supabase
    .from('hmt_gtt_orders')
    .update({
      status: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString()
    })
    .eq('id', triggerId);
}

/**
 * Cancel trigger (for OCO sibling)
 */
async function cancelTrigger(triggerId: string, reason: string = 'Cancelled'): Promise<void> {
  await supabase
    .from('hmt_gtt_orders')
    .update({
      status: 'cancelled',
      error_message: reason,
      updated_at: new Date().toISOString()
    })
    .eq('id', triggerId)
    .eq('status', 'active'); // Only cancel if still active (OCO atomicity guard)
}

/**
 * Check risk limits before order placement (RISK SAFETY)
 */
async function checkRiskLimits(userId: string): Promise<boolean> {
  try {
    const { data: limits, error } = await supabase
      .from('risk_limits')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !limits) {
      console.error(`[Engine] Risk limits not found for user ${userId}`);
      return false;
    }

    // Check kill switch
    if (limits.kill_switch_enabled) {
      console.error(`[Engine] Kill switch enabled for user ${userId}`);
      return false;
    }

    // Reset daily counters if needed
    const today = new Date().toISOString().split('T')[0];
    if (limits.last_reset_date !== today) {
      await supabase.rpc('reset_daily_risk_counters');
      // Reload limits after reset
      const { data: refreshedLimits } = await supabase
        .from('risk_limits')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (refreshedLimits) {
        Object.assign(limits, refreshedLimits);
      }
    }

    // Check max trades per day
    if (limits.daily_trades_count >= limits.max_trades_per_day) {
      console.error(`[Engine] Max trades per day exceeded for user ${userId}`);
      return false;
    }

    // Check max loss per day
    if (limits.daily_pnl <= -Math.abs(limits.max_loss_per_day)) {
      console.error(`[Engine] Max loss per day exceeded for user ${userId}`);
      return false;
    }

    // Check auto square-off time
    const now = new Date();
    const currentTime = now.toTimeString().split(' ')[0];
    if (currentTime >= limits.auto_square_off_time) {
      console.error(`[Engine] Auto square-off time reached for user ${userId}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Engine] Error checking risk limits:', error);
    return false;
  }
}

/**
 * Log trade for audit trail and risk tracking
 */
async function logTrade(
  trigger: HMTTrigger,
  execution: any,
  orderId: string
): Promise<void> {
  try {
    await supabase
      .from('hmt_trade_log')
      .insert({
        user_id: trigger.user_id,
        hmt_order_id: trigger.id,
        broker_connection_id: trigger.broker_connection_id,
        trading_symbol: trigger.trading_symbol,
        exchange: trigger.exchange,
        transaction_type: trigger.transaction_type,
        quantity: execution.order_data.quantity,
        trigger_price: execution.triggered_leg === '1' ? trigger.trigger_price_1 : trigger.trigger_price_2,
        executed_price: execution.ltp,
        order_id: orderId,
        order_status: 'COMPLETE'
      });

    // Update risk limits counters
    await supabase.rpc('increment_daily_trade_count', { p_user_id: trigger.user_id });
  } catch (error) {
    console.error('[Engine] Error logging trade:', error);
  }
}

/**
 * Acquire distributed lock for singleton enforcement
 */
async function acquireEngineLock(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .rpc('acquire_engine_lock', { p_instance_id: engineInstanceId });

    if (error) {
      console.error('[Engine] Error acquiring lock:', error);
      return false;
    }

    return data === true;
  } catch (error) {
    console.error('[Engine] Exception acquiring lock:', error);
    return false;
  }
}

/**
 * Release distributed lock
 */
async function releaseEngineLock(): Promise<void> {
  try {
    await supabase
      .rpc('release_engine_lock', { p_instance_id: engineInstanceId });
    console.log('[Engine] Lock released');
  } catch (error) {
    console.error('[Engine] Error releasing lock:', error);
  }
}

/**
 * Subscribe to real-time trigger changes (for CRUD operations from UI)
 */
function subscribeToTriggerChanges(): void {
  supabase
    .channel('hmt_triggers')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'hmt_gtt_orders'
    }, (payload) => {
      handleTriggerInsert(payload.new as HMTTrigger);
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'hmt_gtt_orders'
    }, (payload) => {
      handleTriggerUpdate(payload.new as HMTTrigger);
    })
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'hmt_gtt_orders'
    }, (payload) => {
      handleTriggerDelete(payload.old.id);
    })
    .subscribe();

  console.log('[Engine] Subscribed to trigger changes');
}

/**
 * Handle trigger insert from database
 */
function handleTriggerInsert(trigger: HMTTrigger): void {
  if (!triggerManager || !wsManager || trigger.status !== 'active') return;

  console.log(`[Engine] New trigger added: ${trigger.id}`);
  triggerManager.addTrigger(trigger);

  // Subscribe to new instrument if needed
  const currentInstruments = new Set(triggerManager.getSubscribedInstruments());
  if (!currentInstruments.has(trigger.instrument_token)) {
    wsManager.subscribe([trigger.instrument_token]);
    stats.subscribed_instruments++;
  }

  stats.active_triggers = triggerManager.getActiveTriggerCount();
}

/**
 * Handle trigger update from database
 */
function handleTriggerUpdate(trigger: HMTTrigger): void {
  if (!triggerManager) return;

  // Remove old version and add new if still active
  triggerManager.removeTrigger(trigger.id);

  if (trigger.status === 'active') {
    triggerManager.addTrigger(trigger);
  }

  stats.active_triggers = triggerManager.getActiveTriggerCount();
}

/**
 * Handle trigger delete from database
 */
function handleTriggerDelete(triggerId: string): void {
  if (!triggerManager) return;

  console.log(`[Engine] Trigger deleted: ${triggerId}`);
  triggerManager.removeTrigger(triggerId);
  stats.active_triggers = triggerManager.getActiveTriggerCount();
}

/**
 * Start health check monitor
 */
function startHealthCheckMonitor(): void {
  setInterval(() => {
    if (engineStartTime) {
      stats.uptime_seconds = Math.floor((Date.now() - engineStartTime.getTime()) / 1000);
    }

    if (wsManager) {
      stats.websocket_status = wsManager.isConnected() ? 'connected' : 'disconnected';
    }

    // Check for stale connection (no ticks in last 60 seconds)
    if (stats.last_tick_time) {
      const timeSinceLastTick = Date.now() - stats.last_tick_time.getTime();
      if (timeSinceLastTick > 60000 && stats.websocket_status === 'connected') {
        console.warn('[Engine] ⚠ No ticks in 60s - connection may be stale');
      }
    }

    // Heartbeat log (every health check interval)
    console.log(`[Engine] ♥ Heartbeat | Uptime: ${stats.uptime_seconds}s | Ticks: ${stats.processed_ticks} | Orders: ${stats.triggered_orders} | Active: ${stats.active_triggers} | WS: ${stats.websocket_status}`);
  }, config.health_check_interval_ms);
}

/**
 * Start heartbeat updates to database
 */
function startHeartbeatUpdates(): void {
  heartbeatInterval = setInterval(async () => {
    try {
      await supabase.rpc('update_engine_heartbeat', {
        p_instance_id: engineInstanceId,
        p_processed_ticks: stats.processed_ticks,
        p_triggered_orders: stats.triggered_orders,
        p_failed_orders: stats.failed_orders,
        p_active_triggers: triggerManager?.getActiveTriggerCount() || 0,
        p_websocket_status: stats.websocket_status
      });
    } catch (error) {
      console.error('[Engine] Error updating heartbeat:', error);
    }
  }, 10000); // Update every 10 seconds
}

/**
 * Shutdown engine gracefully
 */
async function shutdownEngine(): Promise<void> {
  console.log('[Engine] Shutting down...');
  isEngineRunning = false;

  // Stop heartbeat updates
  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (wsManager) {
    wsManager.disconnect();
    wsManager = null;
  }

  if (triggerManager) {
    triggerManager.clear();
    triggerManager = null;
  }

  orderExecutor = null;
  engineStartTime = null;

  // Release distributed lock
  await releaseEngineLock();

  console.log('[Engine] Shutdown complete');
}

/**
 * Auto-start the engine on first invocation
 */
let autoStartPromise: Promise<void> | null = null;

function ensureEngineStarted(): Promise<void> {
  if (isEngineRunning) {
    return Promise.resolve();
  }

  if (autoStartPromise) {
    return autoStartPromise;
  }

  autoStartPromise = initializeEngine()
    .then(() => {
      console.log('[Engine] Auto-start completed successfully');
      autoStartPromise = null;
    })
    .catch((error) => {
      console.error('[Engine] Auto-start failed:', error);
      autoStartPromise = null;
      // Retry after delay
      setTimeout(() => {
        ensureEngineStarted();
      }, config.reconnect_delay_ms);
    });

  return autoStartPromise;
}

// Auto-start engine on module load
ensureEngineStarted();

/**
 * HTTP Handler
 */
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Ensure engine is started on every request (self-healing)
  await ensureEngineStarted();

  const url = new URL(req.url);
  const path = url.pathname;

  // Health check endpoint
  if (path.endsWith('/health')) {
    return new Response(JSON.stringify({
      status: isEngineRunning ? 'running' : 'stopped',
      error: engineError,
      stats: {
        ...stats,
        active_triggers: triggerManager?.getActiveTriggerCount() || 0,
        subscribed_instruments: wsManager?.getSubscribedCount() || 0
      },
      config: config
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Start engine endpoint
  if (path.endsWith('/start')) {
    if (!isEngineRunning) {
      try {
        await initializeEngine();
        return new Response(JSON.stringify({ success: true, message: 'Engine started' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    return new Response(JSON.stringify({ success: true, message: 'Engine already running' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Stop engine endpoint
  if (path.endsWith('/stop')) {
    await shutdownEngine();
    return new Response(JSON.stringify({ success: true, message: 'Engine stopped' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Stats endpoint
  if (path.endsWith('/stats')) {
    return new Response(JSON.stringify({
      ...stats,
      active_triggers: triggerManager?.getActiveTriggerCount() || 0,
      subscribed_instruments: wsManager?.getSubscribedCount() || 0,
      uptime_seconds: engineStartTime ? Math.floor((Date.now() - engineStartTime.getTime()) / 1000) : 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    message: 'HMT Trigger Engine - Fully Autonomous',
    status: isEngineRunning ? 'running' : 'stopped',
    error: engineError,
    websocket_status: stats.websocket_status,
    endpoints: {
      health: '/health',
      start: '/start',
      stop: '/stop',
      stats: '/stats'
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});