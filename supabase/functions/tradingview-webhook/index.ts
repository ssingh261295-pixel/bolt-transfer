/**
 * TradingView Webhook Execution Gateway
 *
 * CRITICAL DESIGN: Respond to TradingView IMMEDIATELY after basic payload
 * validation (pure JS, no DB calls). All DB queries and order execution
 * happen in background via EdgeRuntime.waitUntil to prevent timeouts.
 *
 * EXECUTION FLOW (per spec):
 * Step 1: Global Check — trade_enabled, symbol whitelist/blacklist, days filter, time window
 * Step 2: Evaluate Regimes — active regimes, day/time/VIX match
 * Step 3: Direction Logic — buy/sell engines inside matched regime
 * Step 4: Final Decision — if NO regime matches → reject trade
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VIX_CACHE_TTL_SECONDS = 120;
const INDIA_VIX_INSTRUMENT = 'NSE:INDIA VIX';

async function fetchAndCacheVIX(supabase: any, brokerAccounts: any[]): Promise<{ vix: number | null; source: string; stale: boolean }> {
  try {
    const { data: cached } = await supabase
      .from('vix_cache')
      .select('vix_value, fetched_at, is_stale')
      .eq('id', 1)
      .maybeSingle();

    if (cached?.vix_value !== null && cached?.vix_value !== undefined && cached?.fetched_at) {
      const ageSeconds = (Date.now() - new Date(cached.fetched_at).getTime()) / 1000;
      if (ageSeconds < VIX_CACHE_TTL_SECONDS) {
        console.log(`[VIX] Using WebSocket cache: ${cached.vix_value} (age ${Math.round(ageSeconds)}s)`);
        return { vix: parseFloat(cached.vix_value), source: 'websocket_cache', stale: false };
      }
    }

    const activeBroker = brokerAccounts.find((b: any) => b.api_key && b.access_token);
    if (!activeBroker) {
      if (cached?.vix_value !== null && cached?.vix_value !== undefined) {
        console.log('[VIX] No broker available, using stale cache:', cached.vix_value);
        return { vix: parseFloat(cached.vix_value), source: 'stale_cache', stale: true };
      }
      return { vix: null, source: 'no_broker', stale: false };
    }

    const vixUrl = `https://api.kite.trade/quote/ltp?i=${encodeURIComponent(INDIA_VIX_INSTRUMENT)}`;
    const vixResponse = await fetch(vixUrl, {
      method: 'GET',
      headers: {
        'Authorization': `token ${activeBroker.api_key}:${activeBroker.access_token}`,
        'X-Kite-Version': '3'
      }
    });

    if (!vixResponse.ok) {
      console.error('[VIX] Zerodha REST API error:', vixResponse.status, '— using stale cache');
      if (cached?.vix_value !== null && cached?.vix_value !== undefined) {
        await supabase.from('vix_cache').upsert({ id: 1, is_stale: true }, { onConflict: 'id' });
        return { vix: parseFloat(cached.vix_value), source: 'stale_cache', stale: true };
      }
      return { vix: null, source: 'fetch_failed', stale: false };
    }

    const vixData = await vixResponse.json();
    const vixKey = Object.keys(vixData?.data || {})[0];
    const vixValue: number | undefined = vixData?.data?.[vixKey]?.last_price;

    if (vixValue === undefined || vixValue === null) {
      console.error('[VIX] Could not parse VIX from REST response:', JSON.stringify(vixData));
      if (cached?.vix_value !== null && cached?.vix_value !== undefined) {
        return { vix: parseFloat(cached.vix_value), source: 'stale_cache', stale: true };
      }
      return { vix: null, source: 'parse_failed', stale: false };
    }

    await supabase.from('vix_cache').upsert({
      id: 1,
      vix_value: vixValue,
      fetched_at: new Date().toISOString(),
      source_broker_id: activeBroker.id,
      raw_response: vixData?.data || {},
      is_stale: false
    }, { onConflict: 'id' });

    console.log('[VIX] Fetched and cached via REST fallback:', vixValue);
    return { vix: vixValue, source: 'rest_live', stale: false };

  } catch (err: any) {
    console.error('[VIX] Error fetching VIX:', err.message);
    return { vix: null, source: 'error', stale: false };
  }
}

function isWithinTradingWindow(): { allowed: boolean; currentTime: string; reason?: string } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const currentTimeIST = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const currentMinutes = hours * 60 + minutes;
  const startMinutes = 9 * 60 + 30;
  const endMinutes = 15 * 60 + 0;

  if (currentMinutes < startMinutes) return { allowed: false, currentTime: currentTimeIST, reason: 'BEFORE_09_30_IST' };
  if (currentMinutes > endMinutes) return { allowed: false, currentTime: currentTimeIST, reason: 'AFTER_15_00_IST' };
  return { allowed: true, currentTime: currentTimeIST };
}

function getISTTime(): { hours: number; minutes: number; dayOfWeek: number; currentMinutes: number } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const currentMinutes = hours * 60 + minutes;
  // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  const dayOfWeek = istTime.getUTCDay() === 0 ? 7 : istTime.getUTCDay();
  return { hours, minutes, dayOfWeek, currentMinutes };
}

/**
 * Evaluate a single buy/sell engine (condition set).
 * All conditions inside one engine use AND logic.
 * EMA distance in engines is absolute value (distance in ATR units, always positive).
 */
function evaluateConditionSet(conditionSet: any, payload: any, adxOverride?: { min?: number; max?: number }): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let passed = true;

  if (payload.volume !== undefined && payload.vol_avg_5d !== undefined && payload.vol_avg_5d > 0) {
    const volumeRatio = payload.volume / payload.vol_avg_5d;
    const minVR = conditionSet.volume_ratio?.min ?? 0;
    const maxVR = conditionSet.volume_ratio?.max ?? 100;
    if (volumeRatio < minVR || volumeRatio > maxVR) { passed = false; reasons.push(`VR=${volumeRatio.toFixed(2)} not in [${minVR}, ${maxVR}]`); }
  } else { passed = false; reasons.push('volume data missing'); }

  if (payload.di_plus !== undefined && payload.di_minus !== undefined) {
    const diSpread = Math.abs(payload.di_plus - payload.di_minus);
    const minDI = conditionSet.di_spread?.min ?? 0;
    const maxDI = conditionSet.di_spread?.max ?? 100;
    if (diSpread < minDI || diSpread > maxDI) { passed = false; reasons.push(`DI=${diSpread.toFixed(2)} not in [${minDI}, ${maxDI}]`); }
  } else { passed = false; reasons.push('DI data missing'); }

  if (payload.adx !== undefined) {
    const minADX = adxOverride?.min !== undefined ? adxOverride.min : (conditionSet.adx?.min ?? 0);
    const maxADX = adxOverride?.max !== undefined ? adxOverride.max : (conditionSet.adx?.max ?? 100);
    if (payload.adx < minADX || payload.adx > maxADX) { passed = false; reasons.push(`ADX=${payload.adx} not in [${minADX}, ${maxADX}]`); }
  } else { passed = false; reasons.push('ADX missing'); }

  if (payload.dist_ema21_atr !== undefined) {
    // Inside engines, EMA distance is treated as absolute distance (always positive)
    const emaDistance = Math.abs(payload.dist_ema21_atr);
    const minEMA = conditionSet.ema_distance?.min ?? 0;
    const maxEMA = conditionSet.ema_distance?.max ?? 100;
    if (emaDistance < minEMA || emaDistance > maxEMA) { passed = false; reasons.push(`EMA_dist=${emaDistance.toFixed(2)} not in [${minEMA}, ${maxEMA}]`); }
  } else { passed = false; reasons.push('EMA distance missing'); }

  if (conditionSet.trade_grade?.enabled && payload.trade_grade) {
    const allowedGrades = conditionSet.trade_grade.allowed_grades || ['A', 'B', 'C', 'D'];
    if (!allowedGrades.includes(payload.trade_grade)) { passed = false; reasons.push(`Grade ${payload.trade_grade} not in [${allowedGrades.join(',')}]`); }
  }

  return { passed, reasons };
}

/**
 * STEP 2 + 3: Evaluate regimes.
 *
 * FINAL RULE: ALL trades must match a regime. If no regimes are configured/enabled → reject.
 * Per-direction schedule: each direction's overrides carries a schedule map (day→time window).
 * Per-day engine overrides: day_engine_overrides[dayNumber] overrides the default engines list.
 *
 * Backward compat: old format fields (allowed_days, time_start, time_end, allowed_buy_engines,
 * wednesday_only_buy_engines, sell_adx_override) are converted on-the-fly.
 */
function evaluateRegimes(filters: any, payload: any, tradeType: string): {
  matched: boolean;
  regime?: any;
  regimeName?: string;
  allowedEngineNames?: string[];
  blockedReason?: string;
} {
  const regimes: any[] = filters.regimes || [];
  const enabledRegimes = regimes.filter((r: any) => r.enabled);

  if (enabledRegimes.length === 0) {
    return { matched: true, blockedReason: 'No regimes configured. All trades must match a regime.' };
  }

  const vix: number | undefined = payload.vix !== undefined ? parseFloat(payload.vix) : undefined;
  const ist = getISTTime();

  if (vix === undefined) {
    return {
      matched: true,
      blockedReason: `VIX data unavailable — cannot determine active regime. Trade blocked to prevent execution in wrong market conditions. Please ensure the HMT engine is running.`
    };
  }

  const dayKey = String(ist.dayOfWeek);
  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let vixBlockedCount = 0;
  let scheduleBlockedCount = 0;

  for (const regime of enabledRegimes) {
    if (regime.vix_min !== null && regime.vix_min !== undefined && vix < regime.vix_min) { vixBlockedCount++; continue; }
    if (regime.vix_max !== null && regime.vix_max !== undefined && vix > regime.vix_max) { vixBlockedCount++; continue; }

    const dirOverrides = tradeType === 'BUY'
      ? (regime.buy_overrides || {})
      : (regime.sell_overrides || {});

    const allowKey = tradeType === 'BUY' ? 'allow_buy' : 'allow_sell';
    if (dirOverrides[allowKey] === false) {
      return {
        matched: true,
        regime,
        regimeName: regime.name,
        blockedReason: `Regime "${regime.name}": ${tradeType} signals are disabled for this VIX regime (VIX ${vix.toFixed(2)})`
      };
    }

    // Build schedule — new format: schedule[dayKey] = { start_time, end_time }
    // Backward compat: if old format (allowed_days + time_start + time_end), build schedule on-the-fly
    let schedule: Record<string, { start_time: string; end_time: string }> = dirOverrides.schedule || {};
    if (Object.keys(schedule).length === 0 && regime.allowed_days) {
      const allowedDays: number[] = regime.allowed_days || [];
      const ts = regime.time_start || '09:15';
      const te = regime.time_end || '15:15';
      for (const d of allowedDays) {
        schedule[String(d)] = { start_time: ts, end_time: te };
      }
    }

    // Check if today's day is in this direction's schedule
    const todayWindow = schedule[dayKey];
    if (!todayWindow) {
      scheduleBlockedCount++;
      continue;
    }

    // Check time window for today
    const [startHour, startMin] = (todayWindow.start_time || '09:15').split(':').map(Number);
    const [endHour, endMin] = (todayWindow.end_time || '15:15').split(':').map(Number);
    const windowStart = startHour * 60 + startMin;
    const windowEnd = endHour * 60 + endMin;
    if (ist.currentMinutes < windowStart || ist.currentMinutes > windowEnd) {
      scheduleBlockedCount++;
      continue;
    }

    // Build engine list — new format: engines + day_engine_overrides[dayKey]
    // Backward compat: old format (allowed_buy/sell_engines, wednesday_only_*)
    let engines: string[] = dirOverrides.engines || [];
    if (engines.length === 0) {
      if (tradeType === 'BUY') {
        engines = dirOverrides.allowed_buy_engines || regime.allowed_buy_engines || [];
      } else {
        engines = dirOverrides.allowed_sell_engines || regime.allowed_sell_engines || [];
      }
    }

    const dayEngineOverrides: Record<string, string[]> = dirOverrides.day_engine_overrides || {};
    let allowedEngineNames: string[] = dayEngineOverrides[dayKey] ?? engines;

    // Backward compat: wednesday_only_* fields
    if (!dirOverrides.day_engine_overrides && ist.dayOfWeek === 3) {
      if (tradeType === 'BUY' && regime.wednesday_only_buy_engines !== null && regime.wednesday_only_buy_engines !== undefined) {
        allowedEngineNames = regime.wednesday_only_buy_engines;
      } else if (tradeType === 'SELL' && regime.wednesday_only_sell_engines !== null && regime.wednesday_only_sell_engines !== undefined) {
        allowedEngineNames = regime.wednesday_only_sell_engines;
      }
    }

    return {
      matched: true,
      regime,
      regimeName: regime.name,
      allowedEngineNames
    };
  }

  const vixStr = vix.toFixed(2);
  const dayName = dayNames[ist.dayOfWeek] || `Day ${ist.dayOfWeek}`;
  const currentTimeStr = `${ist.hours.toString().padStart(2,'0')}:${ist.minutes.toString().padStart(2,'0')}`;

  return {
    matched: true,
    blockedReason: `No active regime matched current conditions (VIX=${vixStr}, Day=${dayName}, Time=${currentTimeStr} IST, ${enabledRegimes.length} regime(s) checked — ${vixBlockedCount} VIX mismatch, ${scheduleBlockedCount} schedule/time mismatch). Trade rejected: all trades must match a regime.`
  };
}

/**
 * Main signal filter evaluation.
 *
 * ARCHITECTURE:
 * Layer 1: Global filters (trade_enabled, symbol, days, time)
 * Layer 2: Regime matching (VIX, per-direction schedule, day engine overrides)
 * Layer 3: Pre-engine standalone gates (trade_score, entry_phase, volume, price_range)
 * Layer 4: Engine evaluation (OR logic — any one passing engine = signal passes)
 * Layer 5: Rocket rule applied from matched engine
 *
 * FINAL RULE: ALL trades must match a regime. No fallback path.
 */
function evaluateSignalFilters(filters: any, payload: any, symbol: string, tradeType: string): {
  passed: boolean;
  reason?: string;
  regimeInfo?: string;
  matchedEngineName?: string;
} {
  if (!filters) return { passed: true };

  // --- LAYER 1: GLOBAL CHECKS ---
  if (filters.trade_enabled === false) {
    return { passed: false, reason: 'Trading is disabled (master toggle off)' };
  }

  if (filters.symbols?.list && Array.isArray(filters.symbols.list) && filters.symbols.list.length > 0) {
    const mode = filters.symbols.mode || 'whitelist';
    const symbolInList = filters.symbols.list.includes(symbol);
    if (mode === 'whitelist' && !symbolInList) return { passed: false, reason: `Symbol ${symbol} not in whitelist` };
    if (mode === 'blacklist' && symbolInList) return { passed: false, reason: `Symbol ${symbol} is blacklisted` };
  }

  if (filters.trade_types) {
    if (tradeType === 'BUY' && filters.trade_types.allow_buy === false) return { passed: false, reason: 'BUY trades not allowed' };
    if (tradeType === 'SELL' && filters.trade_types.allow_sell === false) return { passed: false, reason: 'SELL trades not allowed' };
  }

  const ist = getISTTime();
  if (filters.days_filter?.enabled) {
    const allowedDays: number[] = filters.days_filter.allowed_days || [1, 2, 3, 4, 5];
    if (!allowedDays.includes(ist.dayOfWeek)) {
      const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      return { passed: false, reason: `Trading not allowed on ${dayNames[ist.dayOfWeek] || 'today'} (global days filter)` };
    }
  }

  if (filters.time_filters?.enabled) {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const hours = istTime.getUTCHours();
    const minutes = istTime.getUTCMinutes();
    const currentMinutes = hours * 60 + minutes;
    const [startHour, startMin] = (filters.time_filters.start_time || '09:15').split(':').map(Number);
    const [endHour, endMin] = (filters.time_filters.end_time || '15:15').split(':').map(Number);
    if (currentMinutes < startHour * 60 + startMin || currentMinutes > endHour * 60 + endMin) {
      return { passed: false, reason: `Outside allowed time window (${filters.time_filters.start_time}-${filters.time_filters.end_time})` };
    }
  }

  // --- LAYER 2: REGIME MATCHING ---
  const regimeResult = evaluateRegimes(filters, payload, tradeType);

  if (regimeResult.blockedReason) {
    return { passed: false, reason: regimeResult.blockedReason };
  }

  const allowedEngineNames = regimeResult.allowedEngineNames || [];
  const regimeName = regimeResult.regimeName || 'Unknown Regime';

  const directionFilters = tradeType === 'BUY' ? (filters.buy_filters || {}) : (filters.sell_filters || {});
  const allConditionSets: any[] = directionFilters.condition_sets || [];
  const eligibleSets = allConditionSets.filter((cs: any) => allowedEngineNames.includes(cs.name));

  if (eligibleSets.length === 0) {
    return { passed: false, reason: `Regime "${regimeName}": No engines configured for ${tradeType} on this day/schedule` };
  }

  // --- LAYER 3: STANDALONE PRE-ENGINE GATES ---
  if (directionFilters.trade_score?.enabled && payload.trade_score !== undefined) {
    const minScore = directionFilters.trade_score.min_score || 5.0;
    if (payload.trade_score < minScore) return { passed: false, reason: `${tradeType}: Trade score ${payload.trade_score} below minimum ${minScore}` };
  }

  if (directionFilters.entry_phase?.enabled && payload.entry_phase) {
    const allowedPhases = directionFilters.entry_phase.allowed_phases || ['EARLY', 'MID', 'OPTIMAL', 'LATE'];
    if (!allowedPhases.includes(payload.entry_phase)) return { passed: false, reason: `${tradeType}: Entry phase ${payload.entry_phase} not in allowed list` };
  }

  if (directionFilters.volume?.enabled && payload.vol_avg_5d !== undefined) {
    const minVolume = directionFilters.volume.min_avg_volume_5d || 0;
    if (payload.vol_avg_5d < minVolume) return { passed: false, reason: `${tradeType}: Volume ${payload.vol_avg_5d} below minimum ${minVolume}` };
  }

  if (directionFilters.price_range?.enabled && payload.price !== undefined) {
    const minPrice = directionFilters.price_range.min_price || 0;
    const maxPrice = directionFilters.price_range.max_price || 1000000;
    if (payload.price < minPrice || payload.price > maxPrice) return { passed: false, reason: `${tradeType}: Price ${payload.price} outside range ${minPrice}-${maxPrice}` };
  }

  // --- LAYER 4: ENGINE EVALUATION (OR logic) ---
  let anyPassed = false;
  let matchedEngineName: string | undefined;
  const failedReasons: string[] = [];

  for (const cs of eligibleSets) {
    const result = evaluateConditionSet(cs, payload);
    if (result.passed) { anyPassed = true; matchedEngineName = cs.name; break; }
    failedReasons.push(`${cs.name}: ${result.reasons.join(', ')}`);
  }

  if (!anyPassed) {
    return { passed: false, reason: `Regime "${regimeName}": ${tradeType} signal failed all allowed engines. ${failedReasons.join(' | ')}` };
  }

  return { passed: true, regimeInfo: regimeName, matchedEngineName };
}

async function processWebhook(supabase: any, rawPayload: any, sourceIp: string) {
  try {
    const webhookKey = rawPayload.webhook_key;
    const symbol = rawPayload.symbol ? String(rawPayload.symbol).toUpperCase().trim() : '';
    const exchange = rawPayload.exchange ? String(rawPayload.exchange).toUpperCase().trim() : 'NSE';
    const tradeTypeRaw = rawPayload.trade_type || rawPayload.action;
    const tradeType = tradeTypeRaw ? String(tradeTypeRaw).toUpperCase().trim() : '';
    const price = typeof rawPayload.price === 'number' ? rawPayload.price : parseFloat(rawPayload.price);
    const atr = typeof rawPayload.atr === 'number' ? rawPayload.atr : parseFloat(rawPayload.atr);
    const isExitSignal = tradeType === 'EXIT_LONG' || tradeType === 'EXIT_SHORT';
    const executionMode = rawPayload._execution_mode ?? 'AUTOMATED';

    if (isExitSignal) {
      const { data: keyData } = await supabase
        .from('webhook_keys').select('id, user_id, name').eq('webhook_key', webhookKey).maybeSingle();
      const exitMessage = `${tradeType} signal received and logged. No action taken (exit signals are informational only).`;
      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: keyData?.id ?? null,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'success',
        error_message: `Exit signal logged: ${tradeType} - No action taken`,
        response_message: exitMessage
      });
      return;
    }

    const tradingWindow = isWithinTradingWindow();
    if (!tradingWindow.allowed) {
      const { data: keyData } = await supabase
        .from('webhook_keys').select('id, user_id, name, account_mappings').eq('webhook_key', webhookKey).maybeSingle();

      await supabase.from('tradingview_webhook_logs').insert({
        webhook_key_id: keyData?.id ?? null,
        source_ip: sourceIp,
        payload: rawPayload,
        status: 'rejected_time_window',
        error_message: `Trading window closed. Current time: ${tradingWindow.currentTime} IST. Reason: ${tradingWindow.reason}`
      });

      if (keyData) {
        const accountIds = keyData.account_mappings || [];
        if (accountIds.length > 0) {
          await Promise.all(accountIds.map((accountId: string) =>
            supabase.from('notifications').insert({
              user_id: keyData.user_id,
              broker_account_id: accountId,
              type: 'trade_blocked',
              title: 'Trade Blocked: Outside Trading Window',
              message: `TradingView signal rejected for ${symbol}.\n\nReason: Trading window closed\nCurrent Time: ${tradingWindow.currentTime} IST\nAllowed Window: 09:30 AM - 03:00 PM IST\n\nTrade Type: ${tradeType}\nPrice: ₹${price}\nATR: ${atr}`,
              metadata: { source: 'tradingview_webhook', webhook_key_name: keyData.name, blocked_reason: tradingWindow.reason, current_time_ist: tradingWindow.currentTime, symbol, trade_type: tradeType, price, atr }
            })
          ));
        }
      }
      return;
    }

    const [keyResult] = await Promise.all([
      supabase.from('webhook_keys')
        .select('id, user_id, name, is_active, account_mappings, lot_multiplier, sl_multiplier, target_multiplier')
        .eq('webhook_key', webhookKey)
        .maybeSingle(),
    ]);

    const keyData = keyResult.data;
    const keyError = keyResult.error;

    if (keyError || !keyData) {
      await supabase.from('tradingview_webhook_logs').insert({ source_ip: sourceIp, payload: rawPayload, status: 'rejected', error_message: 'Invalid webhook_key' });
      return;
    }

    if (!keyData.is_active) {
      await supabase.from('tradingview_webhook_logs').insert({ webhook_key_id: keyData.id, source_ip: sourceIp, payload: rawPayload, status: 'rejected', error_message: 'Webhook key is disabled' });
      return;
    }

    if (executionMode === 'AUTOMATED') {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istTime = new Date(now.getTime() + istOffset);
      const executionDate = istTime.toISOString().split('T')[0];
      const payloadHash = `${symbol}_${tradeType}_${price.toFixed(2)}_${atr.toFixed(2)}`;

      const trackerResult = await supabase.rpc('try_insert_execution_tracker', {
        p_webhook_key_id: keyData.id,
        p_symbol: symbol,
        p_trade_type: tradeType,
        p_price: price,
        p_execution_date: executionDate,
        p_payload_hash: payloadHash
      });

      if (trackerResult.error || !trackerResult.data) {
        console.log('[Webhook] Duplicate signal blocked:', symbol, tradeType);
        await supabase.from('tradingview_webhook_logs').insert({
          webhook_key_id: keyData.id,
          source_ip: sourceIp,
          payload: rawPayload,
          status: 'rejected',
          error_message: `Duplicate signal blocked: ${symbol} ${tradeType} at ₹${price.toFixed(2)} was already processed today. TradingView may have sent the same alert multiple times.`
        });
        return;
      }
    }

    const accountIds = keyData.account_mappings || [];
    if (accountIds.length === 0) {
      await supabase.from('tradingview_webhook_logs').insert({ webhook_key_id: keyData.id, source_ip: sourceIp, payload: rawPayload, status: 'rejected', error_message: 'No accounts mapped to webhook key' });
      return;
    }

    const todayDate = new Date().toISOString().split('T')[0];
    const day = new Date().getDate();

    const [brokerResult, instrumentResult, riskLimitsResult] = await Promise.all([
      supabase.from('broker_connections')
        .select('id, account_name, account_holder_name, broker_name, api_key, access_token, is_active, signal_filters_enabled, signal_filters')
        .in('id', accountIds)
        .eq('is_active', true),
      supabase.from('nfo_instruments')
        .select('instrument_token, tradingsymbol, exchange, lot_size, expiry')
        .eq('name', symbol)
        .eq('instrument_type', 'FUT')
        .gte('expiry', todayDate)
        .order('expiry', { ascending: true })
        .limit(2),
      supabase.from('risk_limits')
        .select('next_month_day_threshold')
        .eq('user_id', keyData.user_id)
        .maybeSingle(),
      supabase.from('webhook_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyData.id)
    ]);

    const nextMonthDayThreshold: number = riskLimitsResult.data?.next_month_day_threshold ?? 15;

    const brokerAccounts = brokerResult.data;
    const brokerError = brokerResult.error;
    const futInstruments = instrumentResult.data;
    const instrumentError = instrumentResult.error;

    if (brokerError || !brokerAccounts || brokerAccounts.length === 0) {
      await supabase.from('tradingview_webhook_logs').insert({ webhook_key_id: keyData.id, source_ip: sourceIp, payload: rawPayload, status: 'failed', error_message: 'No active broker accounts found' });
      return;
    }

    if (instrumentError || !futInstruments || futInstruments.length === 0) {
      await supabase.from('tradingview_webhook_logs').insert({ webhook_key_id: keyData.id, source_ip: sourceIp, payload: rawPayload, status: 'failed', error_message: `FUT instrument not found for ${symbol}` });
      return;
    }

    const instrument = (day <= nextMonthDayThreshold || futInstruments.length < 2) ? futInstruments[0] : futInstruments[1];

    const hasRegimesEnabled = brokerAccounts.some((b: any) =>
      b.signal_filters_enabled && b.signal_filters?.regimes?.some((r: any) => r.enabled)
    );

    let liveVIX: number | null = null;
    let vixSource = 'not_fetched';
    if (hasRegimesEnabled) {
      const vixResult = await fetchAndCacheVIX(supabase, brokerAccounts);
      liveVIX = vixResult.vix;
      vixSource = vixResult.source;
      console.log('[Webhook] VIX for regime evaluation:', { liveVIX, vixSource, stale: vixResult.stale });
    }

    // Compute dist_ema21_atr from components if not explicitly provided
    const computedDistEma21Atr =
      rawPayload.dist_ema21_atr === undefined &&
      rawPayload.price !== undefined &&
      rawPayload.ema21 !== undefined &&
      rawPayload.atr !== undefined &&
      rawPayload.atr > 0
        ? (rawPayload.price - rawPayload.ema21) / rawPayload.atr
        : undefined;

    const enrichedPayload = {
      ...rawPayload,
      ...(liveVIX !== null ? { vix: liveVIX } : {}),
      ...(computedDistEma21Atr !== undefined ? { dist_ema21_atr: computedDistEma21Atr } : {}),
    };

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
        if (!account.signal_filters_enabled) {
          accountResult.filter_passed = false;
          accountResult.filter_reason = 'Signal filters are disabled for this account — trading via webhook is paused';
          accountResult.error = 'Signal filters are disabled for this account — trading via webhook is paused';
          executionResults.push(accountResult);
          continue;
        }

        if (account.signal_filters) {
          const filterResult = evaluateSignalFilters(account.signal_filters, enrichedPayload, symbol, tradeType);
          accountResult.filter_passed = filterResult.passed;

          if (!filterResult.passed) {
            accountResult.filter_reason = filterResult.reason;
            accountResult.error = `Signal filtered: ${filterResult.reason}`;
            await supabase.from('notifications').insert({
              user_id: keyData.user_id,
              broker_account_id: account.id,
              type: 'trade_blocked',
              title: 'Signal Filtered',
              message: `TradingView signal filtered for ${symbol}.\n\nReason: ${filterResult.reason}\nTrade Type: ${tradeType}\nPrice: ₹${price}\nATR: ${atr}`,
              metadata: { source: 'tradingview_webhook', webhook_key_name: keyData.name, blocked_reason: 'signal_filtered', filter_reason: filterResult.reason, symbol, trade_type: tradeType, price, atr }
            });
            executionResults.push(accountResult);
            continue;
          }

          if (filterResult.regimeInfo) {
            accountResult.regime_matched = filterResult.regimeInfo;
            accountResult.matched_engine = filterResult.matchedEngineName;
          }
        }

        const { data: symbolSettings } = await supabase
          .from('nfo_symbol_settings').select('*').eq('user_id', keyData.user_id).eq('symbol', symbol)
          .or(`broker_connection_id.eq.${account.id},broker_connection_id.is.null`)
          .order('broker_connection_id', { ascending: false, nullsLast: true }).limit(1).maybeSingle();

        const atrMultiplier = symbolSettings?.atr_multiplier ?? 1.5;
        const slMultiplier = symbolSettings?.sl_multiplier ?? (keyData.sl_multiplier || 1.0);
        const targetMultiplier = symbolSettings?.target_multiplier ?? (keyData.target_multiplier || 2.0);
        const lotMultiplier = symbolSettings?.lot_multiplier ?? (keyData.lot_multiplier || 1);
        const isEnabled = symbolSettings?.is_enabled ?? true;

        if (!isEnabled) {
          accountResult.error = `Symbol ${symbol} trading is disabled`;
          executionResults.push(accountResult);
          continue;
        }

        let rocketRuleTriggered = false;
        let finalLotMultiplier = lotMultiplier;
        let finalTargetMultiplier = targetMultiplier;

        const { data: freshAccount } = await supabase
          .from('broker_connections')
          .select('signal_filters')
          .eq('id', account.id)
          .maybeSingle();

        const sf = freshAccount?.signal_filters ?? account.signal_filters;
        const directionFilters = tradeType === 'BUY' ? sf?.buy_filters : sf?.sell_filters;
        const matchedEngineName = accountResult.matched_engine;
        const engineConditionSets: any[] = directionFilters?.condition_sets || [];
        const matchedEngine = matchedEngineName
          ? engineConditionSets.find((cs: any) => cs.name === matchedEngineName)
          : null;
        const engineRocketRule = matchedEngine?.rocket_rule ?? null;

        console.log('[Webhook] Rocket rule check:', {
          account_id: account.id,
          trade_type: tradeType,
          matched_engine: matchedEngineName,
          engine_rocket_rule: engineRocketRule,
          volume: enrichedPayload.volume,
          vol_avg_5d: enrichedPayload.vol_avg_5d,
          vix: liveVIX,
          vix_source: vixSource
        });

        const rocketRuleActive = engineRocketRule?.enabled ?? false;

        if (rocketRuleActive && engineRocketRule && enrichedPayload.volume !== undefined && enrichedPayload.vol_avg_5d !== undefined && enrichedPayload.vol_avg_5d > 0) {
          const volumeRatio = enrichedPayload.volume / enrichedPayload.vol_avg_5d;
          const threshold = engineRocketRule.volume_ratio_threshold ?? 0.70;
          console.log('[Webhook] Rocket rule volume check:', { volumeRatio, threshold, triggered: volumeRatio >= threshold });
          if (volumeRatio >= threshold) {
            rocketRuleTriggered = true;
            finalLotMultiplier = engineRocketRule.lot_multiplier ?? 2;
            finalTargetMultiplier = engineRocketRule.target_multiplier ?? 3.0;
            console.log('[Webhook] ROCKET RULE TRIGGERED:', { finalLotMultiplier, finalTargetMultiplier, volumeRatio });
          }
        }

        const adjustedATR = atr * atrMultiplier;
        const quantity = instrument.lot_size * finalLotMultiplier;

        const positionsResponse = await fetch('https://api.kite.trade/portfolio/positions', {
          method: 'GET',
          headers: { 'Authorization': `token ${account.api_key}:${account.access_token}`, 'X-Kite-Version': '3' },
        });
        const positionsResult = await positionsResponse.json();

        if (positionsResult.status === 'success' && positionsResult.data) {
          const existingPosition = positionsResult.data.net?.find((pos: any) => pos.tradingsymbol === instrument.tradingsymbol && pos.quantity !== 0);
          if (existingPosition) {
            const positionDirection = existingPosition.quantity > 0 ? 'LONG' : 'SHORT';
            const signalDirection = tradeType === 'BUY' ? 'LONG' : 'SHORT';
            if (positionDirection === signalDirection) {
              await supabase.from('notifications').insert({
                user_id: keyData.user_id, broker_account_id: account.id, type: 'trade_blocked',
                title: 'Position Already Exists',
                message: `TradingView ${tradeType} signal blocked for ${instrument.tradingsymbol}.\n\nReason: You already have a ${positionDirection} position\nExisting Quantity: ${Math.abs(existingPosition.quantity)}\nAverage Price: ₹${existingPosition.average_price}\n\nClose existing position before entering new one.`,
                metadata: { source: 'tradingview_webhook', webhook_key_name: keyData.name, blocked_reason: 'existing_position', symbol: instrument.tradingsymbol, trade_type: tradeType, existing_quantity: existingPosition.quantity, existing_avg_price: existingPosition.average_price }
              });
              accountResult.error = `Position already exists: ${positionDirection} ${Math.abs(existingPosition.quantity)}`;
              executionResults.push(accountResult);
              continue;
            }
          }
        }

        const orderResponse = await fetch('https://api.kite.trade/orders/regular', {
          method: 'POST',
          headers: { 'Authorization': `token ${account.api_key}:${account.access_token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Kite-Version': '3' },
          body: new URLSearchParams({ tradingsymbol: instrument.tradingsymbol, exchange: instrument.exchange, transaction_type: tradeType, quantity: quantity.toString(), order_type: 'MARKET', product: 'NRML', validity: 'DAY' }),
        });
        const orderResult = await orderResponse.json();

        if (orderResult.status === 'success' && orderResult.data?.order_id) {
          accountResult.order_placed = true;
          accountResult.order_id = orderResult.data.order_id;

          await supabase.from('orders').insert({
            user_id: keyData.user_id, broker_connection_id: account.id, symbol: instrument.tradingsymbol,
            exchange: instrument.exchange, order_type: 'MARKET', transaction_type: tradeType,
            quantity, status: 'OPEN', order_id: orderResult.data.order_id, variety: 'regular', product: 'NRML',
          });

          let executedPrice = price;
          let orderCompleted = false;
          let orderRejected = false;
          let orderStatus = 'UNKNOWN';

          for (let retryCount = 0; retryCount < 10; retryCount++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const detailsResponse = await fetch('https://api.kite.trade/orders', {
              method: 'GET',
              headers: { 'Authorization': `token ${account.api_key}:${account.access_token}`, 'X-Kite-Version': '3' },
            });
            const detailsResult = await detailsResponse.json();
            if (detailsResult.status === 'success' && detailsResult.data) {
              const placedOrder = detailsResult.data.find((o: any) => o.order_id === orderResult.data.order_id);
              if (placedOrder) {
                orderStatus = placedOrder.status;
                if (placedOrder.status === 'COMPLETE' && placedOrder.average_price > 0) {
                  executedPrice = placedOrder.average_price;
                  orderCompleted = true;
                  break;
                } else if (placedOrder.status === 'REJECTED') {
                  orderRejected = true;
                  accountResult.order_error = placedOrder.status_message || 'Order rejected by broker';
                  break;
                }
              }
            }
          }

          if (orderCompleted) {
            let stopLossPrice: number;
            let targetPrice: number;
            if (tradeType === 'BUY') {
              stopLossPrice = executedPrice - (adjustedATR * slMultiplier);
              targetPrice = executedPrice + (adjustedATR * finalTargetMultiplier);
            } else {
              stopLossPrice = executedPrice + (adjustedATR * slMultiplier);
              targetPrice = executedPrice - (adjustedATR * finalTargetMultiplier);
            }

            const { data: hmtGtt, error: hmtError } = await supabase.from('hmt_gtt_orders').insert({
              user_id: keyData.user_id, broker_connection_id: account.id, trading_symbol: instrument.tradingsymbol,
              exchange: instrument.exchange, instrument_token: instrument.instrument_token, condition_type: 'two-leg',
              transaction_type: tradeType === 'BUY' ? 'SELL' : 'BUY',
              product_type_1: 'NRML', trigger_price_1: stopLossPrice, order_price_1: stopLossPrice, quantity_1: quantity,
              product_type_2: 'NRML', trigger_price_2: targetPrice, order_price_2: targetPrice, quantity_2: quantity,
              status: 'active',
              metadata: { source: 'tradingview_webhook', webhook_key_name: keyData.name, entry_price: executedPrice, cash_price: price, atr, timeframe: enrichedPayload.timeframe || null, rocket_rule_triggered: rocketRuleTriggered, volume_ratio: enrichedPayload.volume && enrichedPayload.vol_avg_5d ? (enrichedPayload.volume / enrichedPayload.vol_avg_5d).toFixed(2) : null, vix: liveVIX, vix_source: vixSource, regime_matched: accountResult.regime_matched || null }
            }).select().single();

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
              user_id: keyData.user_id, broker_account_id: account.id, type: 'trade',
              title: `TradingView: ${tradeType} ${instrument.tradingsymbol}`,
              message: `Order placed: ${tradeType} ${quantity} @ ₹${executedPrice.toFixed(2)}\nSL: ₹${stopLossPrice.toFixed(2)} | Target: ₹${targetPrice.toFixed(2)}\nATR: ${atr.toFixed(2)} | Timeframe: ${rawPayload.timeframe || 'N/A'}`,
              metadata: { source: 'tradingview', trade_type: tradeType, symbol: instrument.tradingsymbol, entry_price: executedPrice, cash_price: price, quantity, stop_loss: stopLossPrice, target: targetPrice, atr, order_id: orderResult.data.order_id }
            });
          } else if (orderRejected) {
            await supabase.from('notifications').insert({
              user_id: keyData.user_id, broker_account_id: account.id, type: 'trade_blocked',
              title: `TradingView: Order Rejected for ${instrument.tradingsymbol}`,
              message: `Order rejected by broker.\n\nReason: ${accountResult.order_error}\nSymbol: ${instrument.tradingsymbol}\nTrade Type: ${tradeType}\nQuantity: ${quantity}\n\nPlease check your account balance and margin requirements.`,
              metadata: { source: 'tradingview', blocked_reason: 'order_rejected', trade_type: tradeType, symbol: instrument.tradingsymbol, quantity, order_id: orderResult.data.order_id }
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
    await supabase.from('tradingview_webhook_logs').insert({
      webhook_key_id: keyData.id,
      source_ip: sourceIp,
      payload: { ...rawPayload, _execution_mode: executionMode },
      status: successCount > 0 ? 'success' : 'failed',
      accounts_executed: executionResults,
      response_message: `Executed on ${successCount}/${brokerAccounts.length} account(s)`
    });

  } catch (err: any) {
    console.error('[Webhook Background] Error:', err.message);
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase2 = createClient(supabaseUrl, supabaseKey);
      await supabase2.from('tradingview_webhook_logs').insert({ source_ip: sourceIp, payload: rawPayload, status: 'failed', error_message: err.message });
    } catch (_) {}
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const sourceIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  let rawPayload: any = {};

  try {
    rawPayload = await req.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const webhookKey = rawPayload.webhook_key;
  const symbol = rawPayload.symbol ? String(rawPayload.symbol).toUpperCase().trim() : '';
  const tradeTypeRaw = rawPayload.trade_type || rawPayload.action;
  const tradeType = tradeTypeRaw ? String(tradeTypeRaw).toUpperCase().trim() : '';
  const price = typeof rawPayload.price === 'number' ? rawPayload.price : parseFloat(rawPayload.price);
  const atr = typeof rawPayload.atr === 'number' ? rawPayload.atr : parseFloat(rawPayload.atr);

  if (!webhookKey || !symbol || !tradeType || !price || !atr || isNaN(price) || isNaN(atr) || price <= 0 || atr <= 0) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid required fields: webhook_key, symbol, trade_type, price, atr" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const validTradeTypes = ['BUY', 'SELL', 'EXIT_LONG', 'EXIT_SHORT'];
  if (!validTradeTypes.includes(tradeType)) {
    return new Response(
      JSON.stringify({ error: "Invalid trade_type. Must be 'BUY', 'SELL', 'EXIT_LONG', or 'EXIT_SHORT'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  EdgeRuntime.waitUntil(processWebhook(supabase, rawPayload, sourceIp));

  return new Response(
    JSON.stringify({ success: true, message: `Signal received for ${symbol} ${tradeType} - processing` }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
