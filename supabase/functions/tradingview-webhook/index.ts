/**
 * TradingView Webhook Handler
 * 
 * Receives signals from TradingView alerts and creates HMT GTT orders
 * for all accounts mapped to the strategy.
 * 
 * Expected payload:
 * {
 *   "action": "buy" | "sell",
 *   "symbol": "NIFTY25DECFUT",
 *   "price": 24500.50,
 *   "atr": 120.75,
 *   "webhook_key": "whk_abc123..."
 * }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface TradingViewPayload {
  action: string;
  symbol: string;
  price: number;
  atr: number;
  webhook_key: string;
}

interface Strategy {
  id: string;
  name: string;
  user_id: string;
  symbol: string;
  exchange: string;
  is_active: boolean;
  atr_config: {
    period: number;
    sl_multiplier: number;
    target_multiplier: number;
    trailing_multiplier: number;
  };
  account_mappings: string[];
  risk_management: {
    positionSize?: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Parse payload
    const payload: TradingViewPayload = await req.json();

    console.log('[TradingView Webhook] Received payload:', {
      action: payload.action,
      symbol: payload.symbol,
      price: payload.price,
      atr: payload.atr,
      webhook_key: payload.webhook_key?.substring(0, 10) + '...'
    });

    // Validate required fields
    if (!payload.webhook_key || !payload.action || !payload.symbol || !payload.price || !payload.atr) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields",
          required: ["webhook_key", "action", "symbol", "price", "atr"]
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate strategy by webhook_key
    const { data: strategy, error: strategyError } = await supabase
      .from('strategies')
      .select('*')
      .eq('webhook_key', payload.webhook_key)
      .maybeSingle();

    if (strategyError || !strategy) {
      console.error('[TradingView Webhook] Invalid webhook key:', payload.webhook_key);
      return new Response(
        JSON.stringify({ error: "Invalid webhook key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if strategy is active
    if (!strategy.is_active) {
      console.error('[TradingView Webhook] Strategy is not active:', strategy.name);
      return new Response(
        JSON.stringify({ error: "Strategy is not active" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize action (BUY/SELL)
    const action = payload.action.toUpperCase();
    if (action !== 'BUY' && action !== 'SELL') {
      return new Response(
        JSON.stringify({ error: "Invalid action. Must be 'buy' or 'sell'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get account mappings
    const accountIds = strategy.account_mappings || [];
    if (accountIds.length === 0) {
      console.error('[TradingView Webhook] No accounts mapped to strategy:', strategy.name);
      return new Response(
        JSON.stringify({ error: "No accounts mapped to this strategy" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get broker connections
    const { data: brokerAccounts, error: brokerError } = await supabase
      .from('broker_connections')
      .select('id, broker_name, api_key, is_active')
      .in('id', accountIds)
      .eq('is_active', true);

    if (brokerError || !brokerAccounts || brokerAccounts.length === 0) {
      console.error('[TradingView Webhook] No active broker accounts found');
      return new Response(
        JSON.stringify({ error: "No active broker accounts found for this strategy" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get instrument token for the symbol
    const { data: instrument, error: instrumentError } = await supabase
      .from('nfo_instruments')
      .select('instrument_token, tradingsymbol, exchange')
      .eq('tradingsymbol', payload.symbol)
      .maybeSingle();

    if (instrumentError || !instrument) {
      console.error('[TradingView Webhook] Instrument not found:', payload.symbol);
      return new Response(
        JSON.stringify({ error: `Instrument not found: ${payload.symbol}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate SL and Target based on ATR
    const atrConfig = strategy.atr_config || {
      sl_multiplier: 1.5,
      target_multiplier: 2.0,
      trailing_multiplier: 1.0
    };

    const entryPrice = payload.price;
    const atr = payload.atr;

    let stopLossPrice: number;
    let targetPrice: number;

    if (action === 'BUY') {
      // For BUY: SL below entry, Target above entry
      stopLossPrice = entryPrice - (atr * atrConfig.sl_multiplier);
      targetPrice = entryPrice + (atr * atrConfig.target_multiplier);
    } else {
      // For SELL: SL above entry, Target below entry
      stopLossPrice = entryPrice + (atr * atrConfig.sl_multiplier);
      targetPrice = entryPrice - (atr * atrConfig.target_multiplier);
    }

    // Get quantity
    const quantity = strategy.risk_management?.positionSize || 1;

    // Create HMT GTT orders for each account
    const createdOrders = [];
    const errors = [];

    for (const account of brokerAccounts) {
      try {
        // Create HMT GTT order (OCO: stop-loss + target)
        const parentId = crypto.randomUUID();

        // Leg 1: Stop Loss
        const { data: slOrder, error: slError } = await supabase
          .from('hmt_gtt_orders')
          .insert({
            user_id: strategy.user_id,
            broker_connection_id: account.id,
            trading_symbol: instrument.tradingsymbol,
            exchange: instrument.exchange,
            instrument_token: instrument.instrument_token,
            condition_type: 'two-leg',
            transaction_type: action,
            product_type_1: 'MIS',
            trigger_price_1: stopLossPrice,
            order_price_1: stopLossPrice,
            quantity_1: quantity,
            product_type_2: 'MIS',
            trigger_price_2: targetPrice,
            order_price_2: targetPrice,
            quantity_2: quantity,
            parent_id: parentId,
            status: 'active',
            metadata: {
              source: 'tradingview_webhook',
              strategy_id: strategy.id,
              strategy_name: strategy.name,
              entry_price: entryPrice,
              atr: atr,
              atr_config: atrConfig
            }
          })
          .select()
          .single();

        if (slError) {
          console.error(`[TradingView Webhook] Error creating HMT GTT for account ${account.id}:`, slError);
          errors.push({
            account_id: account.id,
            error: slError.message
          });
          continue;
        }

        createdOrders.push({
          account_id: account.id,
          broker_name: account.broker_name,
          order_id: slOrder.id,
          stop_loss: stopLossPrice,
          target: targetPrice
        });

        console.log(`[TradingView Webhook] Created HMT GTT for account ${account.id}:`, {
          symbol: instrument.tradingsymbol,
          action: action,
          entry: entryPrice,
          sl: stopLossPrice,
          target: targetPrice,
          quantity: quantity
        });

        // Create notification for this account
        await supabase.from('notifications').insert({
          user_id: strategy.user_id,
          broker_account_id: account.id,
          source: 'tradingview',
          strategy_name: strategy.name,
          symbol: payload.symbol,
          title: 'TradingView Signal Received',
          message: `${action} signal for ${payload.symbol} via ${strategy.name}. Entry: ${entryPrice}, SL: ${stopLossPrice.toFixed(2)}, Target: ${targetPrice.toFixed(2)}`,
          type: 'trade',
          metadata: {
            action: action,
            entry_price: entryPrice,
            stop_loss: stopLossPrice,
            target: targetPrice,
            atr: atr,
            quantity: quantity,
            broker_name: account.broker_name
          }
        });
      } catch (error: any) {
        console.error(`[TradingView Webhook] Exception for account ${account.id}:`, error);
        errors.push({
          account_id: account.id,
          error: error.message
        });
      }
    }

    // Return response
    return new Response(
      JSON.stringify({
        success: true,
        message: `HMT GTT orders created for ${createdOrders.length} account(s)`,
        strategy: {
          id: strategy.id,
          name: strategy.name,
        },
        signal: {
          action: action,
          symbol: payload.symbol,
          entry_price: entryPrice,
          atr: atr,
          stop_loss: stopLossPrice,
          target: targetPrice,
          quantity: quantity
        },
        orders: createdOrders,
        errors: errors.length > 0 ? errors : undefined
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error: any) {
    console.error('[TradingView Webhook] Unhandled error:', error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        message: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
