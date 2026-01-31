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
 * 6. Fetch executed price from Zerodha API
 * 7. Calculate SL/Target based on EXECUTED price (not CASH price)
 * 8. Create HMT GTT (SL + Target) after order success
 * 9. Notify user in real-time
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

function isWithinTradingWindow(): { allowed: boolean; currentTime: string; reason?: string } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);

  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const currentTimeIST = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  const startHour = 9;
  const startMinute = 30;
  const endHour = 15;
  const endMinute = 0;

  const currentMinutes = hours * 60 + minutes;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (currentMinutes < startMinutes) {
    return {
      allowed: false,
      currentTime: currentTimeIST,
      reason: 'BEFORE_09_30_IST'
    };
  }

  if (currentMinutes > endMinutes) {
    return {
      allowed: false,
      currentTime: currentTimeIST,
      reason: 'AFTER_15_00_IST'
    };
  }

  return { allowed: true, currentTime: currentTimeIST };
}

function evaluateSignalFilters(
  filters: any,
  payload: any,
  symbol: string,
  tradeType: string
): { passed: boolean; reason?: string } {
  if (!filters) {
    return { passed: true };
  }

  // Symbol filter
  if (filters.symbols?.list && Array.isArray(filters.symbols.list) && filters.symbols.list.length > 0) {
    const mode = filters.symbols.mode || 'whitelist';
    const symbolInList = filters.symbols.list.includes(symbol);

    if (mode === 'whitelist' && !symbolInList) {
      return { passed: false, reason: `Symbol ${symbol} not in whitelist` };
    }
    if (mode === 'blacklist' && symbolInList) {
      return { passed: false, reason: `Symbol ${symbol} is blacklisted` };
    }
  }

  // Trade type filter
  if (filters.trade_types) {
    if (tradeType === 'BUY' && filters.trade_types.allow_buy === false) {
      return { passed: false, reason: 'BUY trades not allowed' };
    }
    if (tradeType === 'SELL' && filters.trade_types.allow_sell === false) {
      return { passed: false, reason: 'SELL trades not allowed' };
    }
  }

  // Time filter
  if (filters.time_filters?.enabled) {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const hours = istTime.getUTCHours();
    const minutes = istTime.getUTCMinutes();
    const currentMinutes = hours * 60 + minutes;

    const [startHour, startMin] = (filters.time_filters.start_time || '09:15').split(':').map(Number);
    const [endHour, endMin] = (filters.time_filters.end_time || '15:15').split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
      return { passed: false, reason: `Outside allowed time window (${filters.time_filters.start_time}-${filters.time_filters.end_time})` };
    }
  }

  // Trade grade filter
  if (filters.trade_grade?.enabled && payload.trade_grade) {
    const gradeOrder = { 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5 };
    const minGrade = filters.trade_grade.min_grade || 'C';
    const signalGrade = payload.trade_grade;

    if (gradeOrder[signalGrade] > gradeOrder[minGrade]) {
      return { passed: false, reason: `Trade grade ${signalGrade} below minimum ${minGrade}` };
    }
  }

  // Trade score filter
  if (filters.trade_score?.enabled && payload.trade_score !== undefined) {
    const minScore = filters.trade_score.min_score || 5.0;
    if (payload.trade_score < minScore) {
      return { passed: false, reason: `Trade score ${payload.trade_score} below minimum ${minScore}` };
    }
  }

  // Entry phase filter
  if (filters.entry_phase?.enabled && payload.entry_phase) {
    const allowedPhases = filters.entry_phase.allowed_phases || ['EARLY', 'OPTIMAL', 'LATE'];
    if (!allowedPhases.includes(payload.entry_phase)) {
      return { passed: false, reason: `Entry phase ${payload.entry_phase} not in allowed list` };
    }
  }

  // ADX filter
  if (filters.adx?.enabled && payload.adx !== undefined) {
    const minValue = filters.adx.min_value || 0;
    const maxValue = filters.adx.max_value || 100;
    if (payload.adx < minValue || payload.adx > maxValue) {
      return { passed: false, reason: `ADX ${payload.adx} outside range ${minValue}-${maxValue}` };
    }
  }

  // Volume filter
  if (filters.volume?.enabled && payload.vol_avg_5d !== undefined) {
    const minVolume = filters.volume.min_avg_volume_5d || 0;
    if (payload.vol_avg_5d < minVolume) {
      return { passed: false, reason: `Volume ${payload.vol_avg_5d} below minimum ${minVolume}` };
    }
  }

  // Price range filter
  if (filters.price_range?.enabled && payload.price !== undefined) {
    const minPrice = filters.price_range.min_price || 0;
    const maxPrice = filters.price_range.max_price || 1000000;
    if (payload.price < minPrice || payload.price > maxPrice) {
      return { passed: false, reason: `Price ${payload.price} outside range ${minPrice}-${maxPrice}` };
    }
  }

  return { passed: true };
}

interface NormalizedPayload {
  symbol: string;
  exchange: string;
  trade_type: 'BUY' | 'SELL' | 'EXIT_LONG' | 'EXIT_SHORT';
  price: number;
  atr: number;
  webhook_key: string;
  raw_payload: any;
  is_exit_signal?: boolean;
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    rawPayload = await req.json();

    const webhookKey = rawPayload.webhook_key;
    const symbol = rawPayload.symbol ? String(rawPayload.symbol).toUpperCase().trim() : '';
    const exchange = rawPayload.exchange ? String(rawPayload.exchange).toUpperCase().trim() : 'NSE';

    const tradeTypeRaw = rawPayload.trade_type || rawPayload.action;
    const tradeType = tradeTypeRaw ? String(tradeTypeRaw).toUpperCase().trim() : '';

    const price = typeof rawPayload.price === 'number' ? rawPayload.price : parseFloat(rawPayload.price);
    const atr = typeof rawPayload.atr === 'number' ? rawPayload.atr : parseFloat(rawPayload.atr);

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

    const isExitSignal = tradeType === 'EXIT_LONG' || tradeType === 'EXIT_SHORT';

    if (tradeType !== 'BUY' && tradeType !== 'SELL' && !isExitSignal) {
      await supabase.from('tradingview_webhook_logs').insert({
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected',
        error_message: "Invalid trade_type. Must be 'BUY', 'SELL', 'EXIT_LONG', or 'EXIT_SHORT'"
      });

      return new Response(
        JSON.stringify({ error: "Invalid trade_type. Must be 'BUY', 'SELL', 'EXIT_LONG', or 'EXIT_SHORT'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalized: NormalizedPayload = {
      symbol,
      exchange,
      trade_type: tradeType as 'BUY' | 'SELL' | 'EXIT_LONG' | 'EXIT_SHORT',
      price,
      atr,
      webhook_key: webhookKey,
      raw_payload: rawPayload,
      is_exit_signal: isExitSignal
    };

    console.log('[TradingView Webhook] Normalized:', {
      symbol: normalized.symbol,
      trade_type: normalized.trade_type,
      price: normalized.price,
      exchange: normalized.exchange,
      is_exit_signal: normalized.is_exit_signal,
      ip: sourceIp
    });

    // If this is an EXIT signal, log it and return immediately without executing
    if (normalized.is_exit_signal) {
      const { data: keyData } = await supabase
        .from('webhook_keys')
        .select('id, user_id, name')
        .eq('webhook_key', normalized.webhook_key)
        .maybeSingle();

      const exitMessage = `${normalized.trade_type} signal received and logged. No action taken (exit signals are informational only).`;

      if (keyData) {
        await supabase.from('tradingview_webhook_logs').insert({
          webhook_key_id: keyData.id,
          source_ip: sourceIp,
          payload: rawPayload,
          status: 'success',
          error_message: `Exit signal logged: ${normalized.trade_type} - No action taken`,
          response_message: exitMessage
        });

        console.log('[TradingView Webhook] EXIT signal logged (no action taken):', {
          trade_type: normalized.trade_type,
          symbol: normalized.symbol,
          webhook_key: keyData.name
        });
      } else {
        await supabase.from('tradingview_webhook_logs').insert({
          source_ip: sourceIp,
          payload: rawPayload,
          status: 'success',
          error_message: `Exit signal logged: ${normalized.trade_type} - No action taken`,
          response_message: exitMessage
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: exitMessage,
          signal: {
            trade_type: normalized.trade_type,
            symbol: normalized.symbol,
            price: normalized.price
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tradingWindow = isWithinTradingWindow();
    if (!tradingWindow.allowed) {
      console.log('[TradingView Webhook] REJECTED - Outside trading window:', {
        current_time_ist: tradingWindow.currentTime,
        reason: tradingWindow.reason,
        symbol: normalized.symbol,
        trade_type: normalized.trade_type
      });

      const { data: keyData } = await supabase
        .from('webhook_keys')
        .select('id, user_id, name, account_mappings')
        .eq('webhook_key', normalized.webhook_key)
        .maybeSingle();

      if (keyData) {
        await supabase.from('tradingview_webhook_logs').insert({
          webhook_key_id: keyData.id,
          source_ip: sourceIp,
          payload: rawPayload,
          status: 'rejected_time_window',
          error_message: `Trading window closed. Current time: ${tradingWindow.currentTime} IST. Trading allowed only 09:30-15:00 IST. Reason: ${tradingWindow.reason}`
        });

        const accountIds = keyData.account_mappings || [];
        if (accountIds.length > 0) {
          const notificationPromises = accountIds.map((accountId: string) =>
            supabase.from('notifications').insert({
              user_id: keyData.user_id,
              broker_account_id: accountId,
              type: 'trade_blocked',
              title: 'Trade Blocked: Outside Trading Window',
              message: `TradingView signal rejected for ${normalized.symbol}.\n\nReason: Trading window closed\nCurrent Time: ${tradingWindow.currentTime} IST\nAllowed Window: 09:30 AM - 03:00 PM IST\n\nTrade Type: ${normalized.trade_type}\nPrice: ₹${normalized.price}\nATR: ${normalized.atr}`,
              metadata: {
                source: 'tradingview_webhook',
                webhook_key_name: keyData.name,
                blocked_reason: tradingWindow.reason,
                current_time_ist: tradingWindow.currentTime,
                symbol: normalized.symbol,
                trade_type: normalized.trade_type,
                price: normalized.price,
                atr: normalized.atr,
                event_time: rawPayload.event_time || null
              }
            })
          );

          await Promise.all(notificationPromises);
        }
      } else {
        await supabase.from('tradingview_webhook_logs').insert({
          source_ip: sourceIp,
          payload: rawPayload,
          status: 'rejected_time_window',
          error_message: `Trading window closed. Current time: ${tradingWindow.currentTime} IST. Reason: ${tradingWindow.reason}`
        });
      }

      return new Response(
        JSON.stringify({
          success: false,
          blocked_by_platform: true,
          reason: 'Trading window closed (09:30-15:00 IST)',
          current_time_ist: tradingWindow.currentTime,
          allowed_window: '09:30 AM - 03:00 PM IST',
          message: 'Platform rejected trade. Market orders only allowed during trading window.'
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log('[TradingView Webhook] Trading window check passed:', tradingWindow.currentTime, 'IST');

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

    // Extract execution mode (MANUAL from UI, AUTOMATED from TradingView)
    const executionMode = rawPayload._execution_mode ?? 'AUTOMATED';

    console.log('[TradingView Webhook] Execution mode:', executionMode);

    // CRITICAL: Check for duplicate ONLY for AUTOMATED TradingView webhooks
    // This prevents duplicate webhooks from TradingView from being logged multiple times
    // MANUAL execution from UI is ALWAYS allowed (operator override)
    if (executionMode === 'AUTOMATED') {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istTime = new Date(now.getTime() + istOffset);
      const executionDate = istTime.toISOString().split('T')[0];

      // Enhanced payload hash with ATR and more precise price to better identify unique signals
      const payloadHash = `${normalized.symbol}_${normalized.trade_type}_${normalized.price.toFixed(2)}_${normalized.atr.toFixed(2)}`;

      // First check: Try to insert into tracker (handles race conditions at DB level)
      const trackerInsertResult = await supabase.rpc('try_insert_execution_tracker', {
        p_webhook_key_id: keyData.id,
        p_symbol: normalized.symbol,
        p_trade_type: normalized.trade_type,
        p_price: normalized.price,
        p_execution_date: executionDate,
        p_payload_hash: payloadHash
      });

      if (trackerInsertResult.error || !trackerInsertResult.data) {
        console.log('[TradingView Webhook] DUPLICATE SIGNAL BLOCKED (TradingView retry detected):', {
          symbol: normalized.symbol,
          trade_type: normalized.trade_type,
          execution_date: executionDate,
          webhook_key: keyData.name,
          payload_hash: payloadHash
        });

        // Return immediately WITHOUT logging to avoid duplicate log entries
        // The original webhook was already logged with status 'success'
        return new Response(
          JSON.stringify({
            success: false,
            blocked_by_platform: true,
            reason: 'Duplicate signal - already processed',
            message: `This ${normalized.trade_type} signal for ${normalized.symbol} was already executed today. Webhook duplicate detected.`
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      console.log('[TradingView Webhook] MANUAL execution - duplicate detection SKIPPED');
    }

    // Note: 60-second duplicate check removed to allow quick successive signals
    // The payload hash check above is sufficient for preventing true duplicates
    // This allows legitimate rapid signals (e.g., quick reversals, multiple strategies)

    await supabase
      .from('webhook_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id);

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

    const { data: brokerAccounts, error: brokerError} = await supabase
      .from('broker_connections')
      .select('id, account_name, account_holder_name, broker_name, api_key, access_token, is_active, signal_filters_enabled, signal_filters')
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

    const todayDate = new Date().toISOString().split('T')[0];
    const day = new Date().getDate();

    const { data: futInstruments, error: instrumentError } = await supabase
      .from('nfo_instruments')
      .select('instrument_token, tradingsymbol, exchange, lot_size, expiry')
      .eq('name', normalized.symbol)
      .eq('instrument_type', 'FUT')
      .gte('expiry', todayDate)
      .order('expiry', { ascending: true })
      .limit(2);

    if (instrumentError || !futInstruments || futInstruments.length === 0) {
      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: keyData.id,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'failed',
        error_message: `FUT instrument not found for ${normalized.symbol}`
      });

      return new Response(
        JSON.stringify({ error: `FUT instrument not found for ${normalized.symbol}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let instrument;
    if (day <= 15) {
      instrument = futInstruments[0];
    } else {
      if (futInstruments.length < 2) {
        await supabase.from('tradingview_webhook_logs').insert({
          webhook_key_id: keyData.id,
          source_ip: sourceIp,
          payload: rawPayload,
          status: 'failed',
          error_message: `Second nearest FUT expiry not found for ${normalized.symbol} (day > 15)`
        });

        return new Response(
          JSON.stringify({ error: `Second nearest FUT expiry not found for ${normalized.symbol}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      instrument = futInstruments[1];
    }

    console.log('[TradingView Webhook] Resolved FUT instrument:', {
      symbol: normalized.symbol,
      tradingsymbol: instrument.tradingsymbol,
      expiry: instrument.expiry,
      lot_size: instrument.lot_size,
      day_of_month: day
    });

    // Duplicate detection already performed earlier after webhook key validation
    // No need to check again here

    const executionResults = [];

    for (const account of brokerAccounts) {
      const accountResult: any = {
        account_id: account.id,
        account_name: account.account_name || account.account_holder_name || 'Unknown Account',
        broker_name: account.broker_name,
        order_placed: false,
        hmt_gtt_created: false,
        filter_passed: true
      };

      try {
        // Evaluate signal filters if enabled
        if (account.signal_filters_enabled && account.signal_filters) {
          const filterResult = evaluateSignalFilters(
            account.signal_filters,
            rawPayload,
            normalized.symbol,
            normalized.trade_type
          );

          accountResult.filter_passed = filterResult.passed;

          if (!filterResult.passed) {
            accountResult.filter_reason = filterResult.reason;
            accountResult.error = `Signal filtered: ${filterResult.reason}`;

            console.log(`[TradingView Webhook] Signal filtered for account ${account.id}:`, filterResult.reason);

            // Send notification about filtered signal
            await supabase.from('notifications').insert({
              user_id: keyData.user_id,
              broker_account_id: account.id,
              type: 'trade_blocked',
              title: 'Signal Filtered',
              message: `TradingView signal filtered for ${normalized.symbol}.\n\nReason: ${filterResult.reason}\nTrade Type: ${normalized.trade_type}\nPrice: ₹${normalized.price}\nATR: ${normalized.atr}`,
              metadata: {
                source: 'tradingview_webhook',
                webhook_key_name: keyData.name,
                blocked_reason: 'signal_filtered',
                filter_reason: filterResult.reason,
                symbol: normalized.symbol,
                trade_type: normalized.trade_type,
                price: normalized.price,
                atr: normalized.atr
              }
            });

            executionResults.push(accountResult);
            continue;
          }
        }
        const { data: symbolSettings } = await supabase
          .from('nfo_symbol_settings')
          .select('*')
          .eq('user_id', keyData.user_id)
          .eq('symbol', normalized.symbol)
          .or(`broker_connection_id.eq.${account.id},broker_connection_id.is.null`)
          .order('broker_connection_id', { ascending: false, nullsLast: true })
          .limit(1)
          .maybeSingle();

        const atrMultiplier = symbolSettings?.atr_multiplier ?? 1.5;
        const slMultiplier = symbolSettings?.sl_multiplier ?? (keyData.sl_multiplier || 1.0);
        const targetMultiplier = symbolSettings?.target_multiplier ?? (keyData.target_multiplier || 2.0);
        const lotMultiplier = symbolSettings?.lot_multiplier ?? (keyData.lot_multiplier || 1);
        const isEnabled = symbolSettings?.is_enabled ?? true;

        if (!isEnabled) {
          console.log(`[TradingView Webhook] Symbol ${normalized.symbol} is disabled for account ${account.id}`);
          accountResult.error = `Symbol ${normalized.symbol} trading is disabled`;
          executionResults.push(accountResult);
          continue;
        }

        const adjustedATR = normalized.atr * atrMultiplier;
        const quantity = instrument.lot_size * lotMultiplier;

        console.log('[TradingView Webhook] Using settings:', {
          account_id: account.id,
          symbol: normalized.symbol,
          atr_multiplier: atrMultiplier,
          sl_multiplier: slMultiplier,
          target_multiplier: targetMultiplier,
          lot_multiplier: lotMultiplier,
          quantity,
          adjusted_atr: adjustedATR,
          is_account_specific: symbolSettings?.broker_connection_id === account.id
        });

        const positionsResponse = await fetch('https://api.kite.trade/portfolio/positions', {
          method: 'GET',
          headers: {
            'Authorization': `token ${account.api_key}:${account.access_token}`,
            'X-Kite-Version': '3',
          },
        });

        const positionsResult = await positionsResponse.json();

        if (positionsResult.status === 'success' && positionsResult.data) {
          const existingPosition = positionsResult.data.net?.find((pos: any) =>
            pos.tradingsymbol === instrument.tradingsymbol &&
            pos.quantity !== 0
          );

          if (existingPosition) {
            const positionDirection = existingPosition.quantity > 0 ? 'LONG' : 'SHORT';
            const signalDirection = normalized.trade_type === 'BUY' ? 'LONG' : 'SHORT';

            if (positionDirection === signalDirection) {
              console.log('[TradingView Webhook] POSITION ALREADY EXISTS:', {
                symbol: instrument.tradingsymbol,
                existing_position: existingPosition.quantity,
                signal_type: normalized.trade_type
              });

              await supabase.from('notifications').insert({
                user_id: keyData.user_id,
                broker_account_id: account.id,
                type: 'trade_blocked',
                title: 'Position Already Exists',
                message: `TradingView ${normalized.trade_type} signal blocked for ${instrument.tradingsymbol}.\n\nReason: You already have a ${positionDirection} position\nExisting Quantity: ${Math.abs(existingPosition.quantity)}\nAverage Price: ₹${existingPosition.average_price}\n\nClose existing position before entering new one.`,
                metadata: {
                  source: 'tradingview_webhook',
                  webhook_key_name: keyData.name,
                  blocked_reason: 'existing_position',
                  symbol: instrument.tradingsymbol,
                  trade_type: normalized.trade_type,
                  existing_quantity: existingPosition.quantity,
                  existing_avg_price: existingPosition.average_price
                }
              });

              accountResult.error = `Position already exists: ${positionDirection} ${Math.abs(existingPosition.quantity)}`;
              executionResults.push(accountResult);
              continue;
            }
          }
        }

        const orderParams: any = {
          tradingsymbol: instrument.tradingsymbol,
          exchange: instrument.exchange,
          transaction_type: normalized.trade_type,
          quantity: quantity.toString(),
          order_type: 'MARKET',
          product: 'NRML',
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
            product: 'NRML',
          });

          let executedPrice = normalized.price;
          let orderCompleted = false;
          let orderRejected = false;
          let orderStatus = 'UNKNOWN';
          let maxRetries = 10;
          let retryCount = 0;

          while (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 500));

            const orderDetailsResponse = await fetch(`https://api.kite.trade/orders`, {
              method: 'GET',
              headers: {
                'Authorization': `token ${account.api_key}:${account.access_token}`,
                'X-Kite-Version': '3',
              },
            });

            const orderDetailsResult = await orderDetailsResponse.json();

            if (orderDetailsResult.status === 'success' && orderDetailsResult.data) {
              const placedOrder = orderDetailsResult.data.find((o: any) => o.order_id === orderResult.data.order_id);

              if (placedOrder) {
                orderStatus = placedOrder.status;

                if (placedOrder.status === 'COMPLETE' && placedOrder.average_price > 0) {
                  executedPrice = placedOrder.average_price;
                  orderCompleted = true;
                  console.log(`[TradingView Webhook] Order executed at: ${executedPrice} (attempt ${retryCount + 1})`);
                  break;
                } else if (placedOrder.status === 'REJECTED') {
                  orderRejected = true;
                  accountResult.order_error = placedOrder.status_message || 'Order rejected by broker';
                  console.log(`[TradingView Webhook] Order rejected: ${placedOrder.status_message}`);
                  break;
                }
              }
            }

            retryCount++;
          }

          if (retryCount === maxRetries && !orderCompleted && !orderRejected) {
            console.warn(`[TradingView Webhook] Failed to fetch order status for ${orderResult.data.order_id} after ${maxRetries} attempts, last status: ${orderStatus}`);
          }

          // CRITICAL: Only create HMT GTT if order was successfully COMPLETED
          // Do NOT create HMT GTT if order was rejected (e.g., insufficient balance)
          if (orderCompleted) {
            let stopLossPrice: number;
            let targetPrice: number;

            if (normalized.trade_type === 'BUY') {
              stopLossPrice = executedPrice - (adjustedATR * slMultiplier);
              targetPrice = executedPrice + (adjustedATR * targetMultiplier);
            } else {
              stopLossPrice = executedPrice + (adjustedATR * slMultiplier);
              targetPrice = executedPrice - (adjustedATR * targetMultiplier);
            }

            const { data: hmtGtt, error: hmtError } = await supabase
              .from('hmt_gtt_orders')
              .insert({
                user_id: keyData.user_id,
                broker_connection_id: account.id,
                trading_symbol: instrument.tradingsymbol,
                exchange: instrument.exchange,
                instrument_token: instrument.instrument_token,
                condition_type: 'two-leg',
                transaction_type: normalized.trade_type === 'BUY' ? 'SELL' : 'BUY',
                product_type_1: 'NRML',
                trigger_price_1: stopLossPrice,
                order_price_1: stopLossPrice,
                quantity_1: quantity,
                product_type_2: 'NRML',
                trigger_price_2: targetPrice,
                order_price_2: targetPrice,
                quantity_2: quantity,
                status: 'active',
                metadata: {
                  source: 'tradingview_webhook',
                  webhook_key_name: keyData.name,
                  entry_price: executedPrice,
                  cash_price: normalized.price,
                  atr: normalized.atr,
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
              accountResult.executed_price = executedPrice;
            } else {
              accountResult.hmt_gtt_error = hmtError?.message || 'Unknown error';
            }

            await supabase.from('notifications').insert({
              user_id: keyData.user_id,
              broker_account_id: account.id,
              type: 'trade',
              title: `TradingView: ${normalized.trade_type} ${instrument.tradingsymbol}`,
              message: `Order placed: ${normalized.trade_type} ${quantity} @ ₹${executedPrice.toFixed(2)}\nSL: ₹${stopLossPrice.toFixed(2)} | Target: ₹${targetPrice.toFixed(2)}\nATR: ${normalized.atr.toFixed(2)} | Timeframe: ${rawPayload.timeframe || 'N/A'}`,
              metadata: {
                source: 'tradingview',
                trade_type: normalized.trade_type,
                symbol: instrument.tradingsymbol,
                entry_price: executedPrice,
                cash_price: normalized.price,
                quantity,
                stop_loss: stopLossPrice,
                target: targetPrice,
                atr: normalized.atr,
                order_id: orderResult.data.order_id
              }
            });
          } else if (orderRejected) {
            // Send notification for rejected order (insufficient balance, margin issue, etc.)
            await supabase.from('notifications').insert({
              user_id: keyData.user_id,
              broker_account_id: account.id,
              type: 'trade_blocked',
              title: `TradingView: Order Rejected for ${instrument.tradingsymbol}`,
              message: `Order rejected by broker.\n\nReason: ${accountResult.order_error}\nSymbol: ${instrument.tradingsymbol}\nTrade Type: ${normalized.trade_type}\nQuantity: ${quantity}\n\nPlease check your account balance and margin requirements.`,
              metadata: {
                source: 'tradingview',
                blocked_reason: 'order_rejected',
                trade_type: normalized.trade_type,
                symbol: instrument.tradingsymbol,
                quantity,
                order_id: orderResult.data.order_id
              }
            });
          }

        } else {
          accountResult.order_error = orderResult.message || 'Order placement failed';
        }

      } catch (error: any) {
        accountResult.error = error.message;
      }

      executionResults.push(accountResult);
    }

    const successCount = executionResults.filter(r => r.order_placed).length;
    const responseMessage = `Executed on ${successCount}/${brokerAccounts.length} account(s)`;

    await supabase.from('tradingview_webhook_logs').insert({
      webhook_key_id: keyData.id,
      source_ip: sourceIp,
      payload: { ...rawPayload, _execution_mode: executionMode },
      status: successCount > 0 ? 'success' : 'failed',
      accounts_executed: executionResults,
      response_message: responseMessage
    });

    const firstSuccessfulExecution = executionResults.find(r => r.order_placed);
    const responseSignal: any = {
      trade_type: normalized.trade_type,
      symbol: instrument.tradingsymbol,
      cash_price: normalized.price,
      quantity,
      atr: normalized.atr
    };

    if (firstSuccessfulExecution) {
      responseSignal.executed_price = firstSuccessfulExecution.executed_price;
      responseSignal.stop_loss = firstSuccessfulExecution.stop_loss;
      responseSignal.target = firstSuccessfulExecution.target;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: responseMessage,
        signal: responseSignal,
        accounts: executionResults
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('[TradingView Webhook] Error:', error);

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