/**
 * TradingView Webhook Execution Gateway
 *
 * Platform acts as SECURE EXECUTION GATEWAY ONLY.
 * TradingView owns strategy logic.
 *
 * Flow:
 * 1. Validate webhook_key + log request
 * 2. Normalize and validate payload
 * 3. Resolve accounts mapped to key
 * 4. Resolve NFO FUT symbol + lot size
 * 5. Place MARKET order (MANDATORY FIRST)
 * 6. Create HMT GTT (SL + Target) after order success
 * 7. Notify user in real-time
 *
 * REQUIRED payload fields:
 * {
 *   "webhook_key": "wk_...",
 *   "symbol": "NIFTY", // CASH symbol
 *   "trade_type": "BUY" | "SELL", // or "action"
 *   "price": 24500.50,
 *   "atr": 120.75
 * }
 *
 * OPTIONAL fields:
 * {
 *   "exchange": "NSE", // defaults to NSE
 *   "timeframe": "60",
 *   "event_time": 1710000000000,
 *   ... any other fields (ignored but logged)
 * }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface NormalizedPayload {
  symbol: string;
  exchange: string;
  trade_type: 'BUY' | 'SELL';
  price: number;
  atr: number;
  webhook_key: string;
  raw_payload: any;
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

  const sourceIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  let webhookKeyId: string | null = null;
  let rawPayload: any = {};

  try {
    // Parse raw payload (accept ANY JSON structure)
    rawPayload = await req.json();

    // ============================================================
    // STEP 0: NORMALIZE & VALIDATE PAYLOAD
    // ============================================================

    // Extract and validate required fields
    const webhookKey = rawPayload.webhook_key;
    const symbol = rawPayload.symbol ? String(rawPayload.symbol).toUpperCase().trim() : '';
    const exchange = rawPayload.exchange ? String(rawPayload.exchange).toUpperCase().trim() : 'NSE';

    // Support both "trade_type" and "action" fields (prioritize trade_type)
    const tradeTypeRaw = rawPayload.trade_type || rawPayload.action;
    const tradeType = tradeTypeRaw ? String(tradeTypeRaw).toUpperCase().trim() : '';

    const price = typeof rawPayload.price === 'number' ? rawPayload.price : parseFloat(rawPayload.price);
    const atr = typeof rawPayload.atr === 'number' ? rawPayload.atr : parseFloat(rawPayload.atr);

    // Validate required fields
    if (!webhookKey || !symbol || !tradeType || !price || !atr) {
      await supabase.from('tradingview_webhook_logs').insert({
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected',
        error_message: 'Missing required fields: webhook_key, symbol, trade_type (or action), price, atr'
      });

      return new Response(
        JSON.stringify({ error: "Missing required fields: webhook_key, symbol, trade_type, price, atr" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate numeric fields
    if (isNaN(price) || isNaN(atr) || price <= 0 || atr <= 0) {
      await supabase.from('tradingview_webhook_logs').insert({
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected',
        error_message: 'Invalid numeric values: price and atr must be positive numbers'
      });

      return new Response(
        JSON.stringify({ error: "Invalid numeric values" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate trade_type
    if (tradeType !== 'BUY' && tradeType !== 'SELL') {
      await supabase.from('tradingview_webhook_logs').insert({
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected',
        error_message: "Invalid trade_type. Must be 'BUY' or 'SELL'"
      });

      return new Response(
        JSON.stringify({ error: "Invalid trade_type. Must be 'BUY' or 'SELL'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create normalized payload
    const normalized: NormalizedPayload = {
      symbol,
      exchange,
      trade_type: tradeType as 'BUY' | 'SELL',
      price,
      atr,
      webhook_key: webhookKey,
      raw_payload: rawPayload
    };

    console.log('[TradingView Webhook] Normalized:', {
      symbol: normalized.symbol,
      trade_type: normalized.trade_type,
      price: normalized.price,
      exchange: normalized.exchange,
      ip: sourceIp
    });

    // ============================================================
    // STEP 1: VALIDATE WEBHOOK KEY
    // ============================================================

    const { data: keyData, error: keyError } = await supabase
      .from('webhook_keys')
      .select('id, user_id, name, is_active, account_mappings, lot_multiplier, sl_multiplier, target_multiplier')
      .eq('webhook_key', normalized.webhook_key)
      .maybeSingle();

    if (keyError || !keyData) {
      await supabase.from('tradingview_webhook_logs').insert({
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected',
        error_message: 'Invalid webhook_key'
      });

      return new Response(
        JSON.stringify({ error: "Invalid webhook_key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!keyData.is_active) {
      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: keyData.id,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected',
        error_message: 'Webhook key is disabled'
      });

      return new Response(
        JSON.stringify({ error: "Webhook key is disabled" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    webhookKeyId = keyData.id;

    // Update last_used_at
    await supabase
      .from('webhook_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id);

    // ============================================================
    // STEP 2: RESOLVE ACCOUNTS
    // ============================================================

    const accountIds = keyData.account_mappings || [];
    if (accountIds.length === 0) {
      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: keyData.id,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected',
        error_message: 'No accounts mapped to webhook key'
      });

      return new Response(
        JSON.stringify({ error: "No accounts mapped" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: brokerAccounts, error: brokerError } = await supabase
      .from('broker_connections')
      .select('id, account_name, broker_name, api_key, access_token, is_active')
      .in('id', accountIds)
      .eq('is_active', true);

    if (brokerError || !brokerAccounts || brokerAccounts.length === 0) {
      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: keyData.id,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'failed',
        error_message: 'No active broker accounts found'
      });

      return new Response(
        JSON.stringify({ error: "No active accounts" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // STEP 3: RESOLVE NFO FUT SYMBOL
    // ============================================================

    const now = new Date();
    const day = now.getDate();

    // Determine expiry month (current if day <= 15, else next)
    let expiryDate = new Date(now.getFullYear(), now.getMonth(), 1);
    if (day > 15) {
      expiryDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const year = expiryDate.getFullYear().toString().slice(-2);
    const month = monthNames[expiryDate.getMonth()];

    // Build FUT tradingsymbol
    const futSymbol = `${normalized.symbol}${year}${month}FUT`;

    console.log('[TradingView Webhook] Resolved FUT symbol:', futSymbol);

    const { data: instrument, error: instrumentError } = await supabase
      .from('nfo_instruments')
      .select('instrument_token, tradingsymbol, exchange, lot_size')
      .eq('tradingsymbol', futSymbol)
      .maybeSingle();

    if (instrumentError || !instrument) {
      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: keyData.id,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'failed',
        error_message: `Instrument not found: ${futSymbol}`
      });

      return new Response(
        JSON.stringify({ error: `Instrument not found: ${futSymbol}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate quantity using server-side multiplier (NEVER trust client)
    const lotMultiplier = keyData.lot_multiplier || 1;
    const quantity = instrument.lot_size * lotMultiplier;

    // Calculate SL and Target using server-side ATR multipliers (NEVER trust client)
    const slMultiplier = keyData.sl_multiplier || 1.5;
    const targetMultiplier = keyData.target_multiplier || 2.0;

    const entryPrice = normalized.price;
    const atr = normalized.atr;

    let stopLossPrice: number;
    let targetPrice: number;

    if (normalized.trade_type === 'BUY') {
      stopLossPrice = entryPrice - (atr * slMultiplier);
      targetPrice = entryPrice + (atr * targetMultiplier);
    } else {
      stopLossPrice = entryPrice + (atr * slMultiplier);
      targetPrice = entryPrice - (atr * targetMultiplier);
    }

    // ============================================================
    // STEP 4: EXECUTE FOR EACH ACCOUNT
    // ============================================================

    const executionResults = [];

    for (const account of brokerAccounts) {
      const accountResult: any = {
        account_id: account.id,
        account_name: account.account_name,
        broker_name: account.broker_name,
        order_placed: false,
        hmt_gtt_created: false
      };

      try {
        // PLACE MARKET ORDER (MANDATORY FIRST)
        const orderParams: any = {
          tradingsymbol: instrument.tradingsymbol,
          exchange: instrument.exchange,
          transaction_type: normalized.trade_type,
          quantity: quantity.toString(),
          order_type: 'MARKET',
          product: 'MIS',
          validity: 'DAY',
        };

        const orderResponse = await fetch('https://api.kite.trade/orders/regular', {
          method: 'POST',
          headers: {
            'Authorization': `token ${account.api_key}:${account.access_token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Kite-Version': '3',
          },
          body: new URLSearchParams(orderParams),
        });

        const orderResult = await orderResponse.json();

        if (orderResult.status === 'success' && orderResult.data?.order_id) {
          accountResult.order_placed = true;
          accountResult.order_id = orderResult.data.order_id;

          // Insert into orders table
          await supabase.from('orders').insert({
            user_id: keyData.user_id,
            broker_connection_id: account.id,
            symbol: instrument.tradingsymbol,
            exchange: instrument.exchange,
            order_type: 'MARKET',
            transaction_type: normalized.trade_type,
            quantity: quantity,
            status: 'OPEN',
            order_id: orderResult.data.order_id,
            variety: 'regular',
            product: 'MIS',
          });

          // CREATE HMT GTT (ONLY AFTER ORDER SUCCESS)
          const { data: hmtGtt, error: hmtError } = await supabase
            .from('hmt_gtt_orders')
            .insert({
              user_id: keyData.user_id,
              broker_connection_id: account.id,
              trading_symbol: instrument.tradingsymbol,
              exchange: instrument.exchange,
              instrument_token: instrument.instrument_token,
              condition_type: 'two-leg',
              transaction_type: normalized.trade_type === 'BUY' ? 'SELL' : 'BUY', // Opposite for exit
              product_type_1: 'MIS',
              trigger_price_1: stopLossPrice,
              order_price_1: stopLossPrice,
              quantity_1: quantity,
              product_type_2: 'MIS',
              trigger_price_2: targetPrice,
              order_price_2: targetPrice,
              quantity_2: quantity,
              status: 'active',
              metadata: {
                source: 'tradingview_webhook',
                webhook_key_name: keyData.name,
                entry_price: entryPrice,
                atr: atr,
                timeframe: rawPayload.timeframe || null
              }
            })
            .select()
            .single();

          if (!hmtError && hmtGtt) {
            accountResult.hmt_gtt_created = true;
            accountResult.hmt_gtt_id = hmtGtt.id;
            accountResult.stop_loss = stopLossPrice;
            accountResult.target = targetPrice;
          } else {
            accountResult.hmt_gtt_error = hmtError?.message || 'Unknown error';
          }

          // Create notification
          await supabase.from('notifications').insert({
            user_id: keyData.user_id,
            broker_account_id: account.id,
            type: 'trade',
            title: `TradingView: ${normalized.trade_type} ${instrument.tradingsymbol}`,
            message: `Order placed: ${normalized.trade_type} ${quantity} @ Market\nSL: ₹${stopLossPrice.toFixed(2)} | Target: ₹${targetPrice.toFixed(2)}\nATR: ${atr.toFixed(2)} | Timeframe: ${rawPayload.timeframe || 'N/A'}`,
            metadata: {
              source: 'tradingview',
              trade_type: normalized.trade_type,
              symbol: instrument.tradingsymbol,
              entry_price: entryPrice,
              quantity,
              stop_loss: stopLossPrice,
              target: targetPrice,
              atr,
              order_id: orderResult.data.order_id
            }
          });

        } else {
          accountResult.order_error = orderResult.message || 'Order placement failed';
        }

      } catch (error: any) {
        accountResult.error = error.message;
      }

      executionResults.push(accountResult);
    }

    // Log execution (with full raw payload for audit)
    const successCount = executionResults.filter(r => r.order_placed).length;
    await supabase.from('tradingview_webhook_logs').insert({
      webhook_key_id: keyData.id,
      source_ip: sourceIp,
      payload: rawPayload,
      status: successCount > 0 ? 'success' : 'failed',
      accounts_executed: executionResults
    });

    // Return response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Executed on ${successCount}/${brokerAccounts.length} account(s)`,
        signal: {
          trade_type: normalized.trade_type,
          symbol: instrument.tradingsymbol,
          entry_price: entryPrice,
          quantity,
          stop_loss: stopLossPrice,
          target: targetPrice,
          atr
        },
        accounts: executionResults
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('[TradingView Webhook] Error:', error);

    // Always log failures with full raw payload
    if (webhookKeyId) {
      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: webhookKeyId,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'failed',
        error_message: error.message
      });
    } else {
      await supabase.from('tradingview_webhook_logs').insert({
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'failed',
        error_message: error.message
      });
    }

    return new Response(
      JSON.stringify({ error: "Internal server error", message: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});