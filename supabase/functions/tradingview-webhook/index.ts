/**
 * TradingView Webhook Execution Gateway
 *
 * CRITICAL DESIGN: Respond to TradingView IMMEDIATELY after basic payload
 * validation (pure JS, no DB calls). All DB queries and order execution
 * happen in background via EdgeRuntime.waitUntil to prevent timeouts.
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

    // Primary: use cache written by HMT engine WebSocket (updated every 30s during market hours)
    if (cached?.vix_value !== null && cached?.vix_value !== undefined && cached?.fetched_at) {
      const ageSeconds = (Date.now() - new Date(cached.fetched_at).getTime()) / 1000;
      if (ageSeconds < VIX_CACHE_TTL_SECONDS) {
        console.log(`[VIX] Using WebSocket cache: ${cached.vix_value} (age ${Math.round(ageSeconds)}s)`);
        return { vix: parseFloat(cached.vix_value), source: 'websocket_cache', stale: false };
      }
    }

    // Fallback: fetch live via REST if cache is stale (HMT engine not running)
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
  const dayOfWeek = istTime.getUTCDay() === 0 ? 7 : istTime.getUTCDay();
  return { hours, minutes, dayOfWeek, currentMinutes };
}

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
    const emaDistance = Math.abs(payload.dist_ema21_atr);
    const minEMA = conditionSet.ema_distance?.min ?? 0;
    const maxEMA = conditionSet.ema_distance?.max ?? 100;
    if (emaDistance < minEMA || emaDistance > maxEMA) { passed = false; reasons.push(`EMA_dist=${emaDistance.toFixed(2)} not in [${minEMA}, ${maxEMA}]`); }
  } else { passed = false; reasons.push('EMA distance missing'); }

  return { passed, reasons };
}

function evaluateRegimes(filters: any, payload: any, tradeType: string): {
  matched: boolean;
  regime?: any;
  regimeName?: string;
  allowedEngineNames?: string[];
  rocketRuleEnabled?: boolean;
  adxOverrides?: Record<string, { min?: number; max?: number }>;
  directionOverrides?: any;
  blockedReason?: string;
} {
  const regimes: any[] = filters.regimes || [];
  const enabledRegimes = regimes.filter((r: any) => r.enabled);
  if (enabledRegimes.length === 0) return { matched: false };

  const vix: number | undefined = payload.vix !== undefined ? parseFloat(payload.vix) : undefined;
  const ist = getISTTime();

  // If regimes are configured but VIX is unavailable, we cannot safely determine which regime applies.
  // Block the trade rather than silently falling through to the wrong regime or standard filters.
  if (vix === undefined) {
    return {
      matched: true,
      blockedReason: `VIX data unavailable — cannot determine active regime. Trade blocked to prevent execution in wrong market conditions. Please ensure the HMT engine is running.`
    };
  }

  for (const regime of enabledRegimes) {
    if (regime.vix_min !== null && regime.vix_min !== undefined && vix < regime.vix_min) continue;
    if (regime.vix_max !== null && regime.vix_max !== undefined && vix > regime.vix_max) continue;

    const allowedDays: number[] = regime.allowed_days || [];
    if (allowedDays.length > 0 && !allowedDays.includes(ist.dayOfWeek)) {
      continue;
    }

    const [startHour, startMin] = (regime.time_start || '09:15').split(':').map(Number);
    const [endHour, endMin] = (regime.time_end || '15:15').split(':').map(Number);
    const regimeStart = startHour * 60 + startMin;
    const regimeEnd = endHour * 60 + endMin;
    if (ist.currentMinutes < regimeStart || ist.currentMinutes > regimeEnd) {
      return {
        matched: true,
        regime,
        regimeName: regime.name,
        blockedReason: `Regime "${regime.name}" matched but outside time window (${regime.time_start}–${regime.time_end} IST, current: ${ist.hours.toString().padStart(2,'0')}:${ist.minutes.toString().padStart(2,'0')} IST)`
      };
    }

    const buyOverrides = regime.buy_overrides || {};
    const sellOverrides = regime.sell_overrides || {};

    if (tradeType === 'BUY' && buyOverrides.allow_buy === false) {
      return {
        matched: true,
        regime,
        regimeName: regime.name,
        blockedReason: `Regime "${regime.name}": BUY signals are disabled for this VIX regime (VIX ${vix !== undefined ? vix.toFixed(2) : 'unknown'})`
      };
    }

    if (tradeType === 'SELL' && sellOverrides.allow_sell === false) {
      return {
        matched: true,
        regime,
        regimeName: regime.name,
        blockedReason: `Regime "${regime.name}": SELL signals are disabled for this VIX regime (VIX ${vix !== undefined ? vix.toFixed(2) : 'unknown'})`
      };
    }

    const isWednesday = ist.dayOfWeek === 3;
    let allowedEngineNames: string[];
    let adxOverrides: Record<string, { min?: number; max?: number }> = {};

    if (tradeType === 'BUY') {
      if (isWednesday && regime.wednesday_only_buy_engines !== null && regime.wednesday_only_buy_engines !== undefined) {
        allowedEngineNames = regime.wednesday_only_buy_engines;
      } else {
        allowedEngineNames = buyOverrides.allowed_buy_engines || regime.allowed_buy_engines || [];
      }
    } else {
      if (isWednesday && regime.wednesday_only_sell_engines !== null && regime.wednesday_only_sell_engines !== undefined) {
        allowedEngineNames = regime.wednesday_only_sell_engines;
      } else {
        allowedEngineNames = sellOverrides.allowed_sell_engines || regime.allowed_sell_engines || [];
      }
      if (regime.sell_adx_override) {
        adxOverrides = regime.sell_adx_override;
      }
    }

    const directionOverrides = tradeType === 'BUY' ? buyOverrides : sellOverrides;

    const rocketRuleFromOverride = directionOverrides?.rocket_rule?.enabled === true ? directionOverrides.rocket_rule : null;
    const rocketRuleEnabled = rocketRuleFromOverride !== null ? true : (regime.rocket_rule_enabled ?? false);

    return {
      matched: true,
      regime,
      regimeName: regime.name,
      allowedEngineNames,
      rocketRuleEnabled,
      adxOverrides,
      directionOverrides
    };
  }

  return { matched: false };
}

function evaluateSignalFilters(filters: any, payload: any, symbol: string, tradeType: string): { passed: boolean; reason?: string; regimeInfo?: string; rocketRuleOverride?: boolean } {
  if (!filters) return { passed: true };

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

  const regimeResult = evaluateRegimes(filters, payload, tradeType);

  if (regimeResult.matched) {
    if (regimeResult.blockedReason) {
      return { passed: false, reason: regimeResult.blockedReason };
    }

    const allowedEngineNames = regimeResult.allowedEngineNames || [];
    const adxOverrides = regimeResult.adxOverrides || {};
    const regimeName = regimeResult.regimeName || 'Unknown Regime';
    const dirOverrides = regimeResult.directionOverrides || {};

    const directionFilters = tradeType === 'BUY' ? (filters.buy_filters || {}) : (filters.sell_filters || {});
    const allConditionSets: any[] = directionFilters.condition_sets || [];

    const eligibleSets = allConditionSets.filter((cs: any) => allowedEngineNames.includes(cs.name));

    if (eligibleSets.length === 0) {
      return { passed: false, reason: `Regime "${regimeName}": No engines allowed for ${tradeType} on this day/VIX condition` };
    }

    if (dirOverrides.adx?.enabled && payload.adx !== undefined) {
      const minVal = dirOverrides.adx.min_value ?? 0;
      const maxVal = dirOverrides.adx.max_value ?? 100;
      if (payload.adx < minVal || payload.adx > maxVal) {
        return { passed: false, reason: `Regime "${regimeName}": ${tradeType} ADX ${payload.adx} outside regime override range ${minVal}-${maxVal}` };
      }
    }

    if (dirOverrides.volume_ratio?.enabled && payload.volume !== undefined && payload.vol_avg_5d !== undefined && payload.vol_avg_5d > 0) {
      const vr = payload.volume / payload.vol_avg_5d;
      const minVal = dirOverrides.volume_ratio.min_value ?? 0;
      const maxVal = dirOverrides.volume_ratio.max_value ?? 10;
      if (vr < minVal || vr > maxVal) {
        return { passed: false, reason: `Regime "${regimeName}": ${tradeType} Volume ratio ${vr.toFixed(2)} outside regime override range ${minVal}-${maxVal}` };
      }
    }

    if (dirOverrides.di_spread?.enabled && payload.di_plus !== undefined && payload.di_minus !== undefined) {
      const diSpread = Math.abs(payload.di_plus - payload.di_minus);
      const minVal = dirOverrides.di_spread.min_value ?? 0;
      const maxVal = dirOverrides.di_spread.max_value ?? 100;
      if (diSpread < minVal || diSpread > maxVal) {
        return { passed: false, reason: `Regime "${regimeName}": ${tradeType} DI Spread ${diSpread.toFixed(2)} outside regime override range ${minVal}-${maxVal}` };
      }
    }

    if (dirOverrides.dist_ema21_atr?.enabled && payload.dist_ema21_atr !== undefined) {
      const emaD = Math.abs(payload.dist_ema21_atr);
      const minVal = dirOverrides.dist_ema21_atr.min_value ?? -10;
      const maxVal = dirOverrides.dist_ema21_atr.max_value ?? 10;
      if (emaD < minVal || emaD > maxVal) {
        return { passed: false, reason: `Regime "${regimeName}": ${tradeType} EMA distance ${emaD.toFixed(2)} outside regime override range ${minVal}-${maxVal}` };
      }
    }

    let anyPassed = false;
    const failedReasons: string[] = [];

    for (const cs of eligibleSets) {
      const adxOverride = adxOverrides[cs.name];
      const result = evaluateConditionSet(cs, payload, adxOverride);
      if (result.passed) { anyPassed = true; break; }
      failedReasons.push(`${cs.name}: ${result.reasons.join(', ')}`);
    }

    if (!anyPassed) {
      return { passed: false, reason: `Regime "${regimeName}": ${tradeType} signal failed all allowed engines. ${failedReasons.join(' | ')}` };
    }

    return { passed: true, regimeInfo: regimeName, rocketRuleOverride: regimeResult.rocketRuleEnabled };
  }

  const directionFilters = tradeType === 'BUY' ? (filters.buy_filters || filters) : (filters.sell_filters || filters);

  if (directionFilters.trade_grade?.enabled && payload.trade_grade) {
    const allowedGrades = directionFilters.trade_grade.allowed_grades || ['A', 'B', 'C', 'D'];
    if (!allowedGrades.includes(payload.trade_grade)) return { passed: false, reason: `${tradeType}: Trade grade ${payload.trade_grade} not in allowed list` };
  }

  if (directionFilters.trade_score?.enabled && payload.trade_score !== undefined) {
    const minScore = directionFilters.trade_score.min_score || 5.0;
    if (payload.trade_score < minScore) return { passed: false, reason: `${tradeType}: Trade score ${payload.trade_score} below minimum ${minScore}` };
  }

  if (directionFilters.entry_phase?.enabled && payload.entry_phase) {
    const allowedPhases = directionFilters.entry_phase.allowed_phases || ['EARLY', 'MID', 'OPTIMAL', 'LATE'];
    if (!allowedPhases.includes(payload.entry_phase)) return { passed: false, reason: `${tradeType}: Entry phase ${payload.entry_phase} not in allowed list` };
  }

  if (directionFilters.adx?.enabled && payload.adx !== undefined) {
    const minValue = directionFilters.adx.min_value || 0;
    const maxValue = directionFilters.adx.max_value || 100;
    if (payload.adx < minValue || payload.adx > maxValue) return { passed: false, reason: `${tradeType}: ADX ${payload.adx} outside range ${minValue}-${maxValue}` };
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

  if (directionFilters.dist_ema21_atr?.enabled && payload.dist_ema21_atr !== undefined) {
    const minValue = directionFilters.dist_ema21_atr.min_value ?? -10.0;
    const maxValue = directionFilters.dist_ema21_atr.max_value ?? 10.0;
    if (payload.dist_ema21_atr < minValue || payload.dist_ema21_atr > maxValue) {
      return { passed: false, reason: `${tradeType}: Distance from EMA21 ${payload.dist_ema21_atr.toFixed(2)} ATR outside range ${minValue}-${maxValue}` };
    }
  }

  if (directionFilters.volume_ratio?.enabled && payload.volume !== undefined && payload.vol_avg_5d !== undefined && payload.vol_avg_5d > 0) {
    const volumeRatio = payload.volume / payload.vol_avg_5d;
    const minValue = directionFilters.volume_ratio.min_value ?? 0.0;
    const maxValue = directionFilters.volume_ratio.max_value ?? 10.0;
    if (volumeRatio < minValue || volumeRatio > maxValue) return { passed: false, reason: `${tradeType}: Volume ratio ${volumeRatio.toFixed(2)} outside range ${minValue}-${maxValue}` };
  }

  if (directionFilters.di_spread?.enabled && payload.di_plus !== undefined && payload.di_minus !== undefined) {
    const diSpread = Math.abs(payload.di_plus - payload.di_minus);
    const minValue = directionFilters.di_spread.min_value ?? 0;
    const maxValue = directionFilters.di_spread.max_value ?? 100;
    if (diSpread < minValue || diSpread > maxValue) return { passed: false, reason: `${tradeType}: DI Spread ${diSpread.toFixed(2)} outside range ${minValue}-${maxValue}` };
  }

  const conditionSets = directionFilters.condition_sets || [];
  const enabledConditionSets = conditionSets.filter((cs: any) => cs.enabled);

  if (enabledConditionSets.length > 0) {
    let anyConditionSetPassed = false;
    const failedReasons: string[] = [];

    for (const conditionSet of enabledConditionSets) {
      const result = evaluateConditionSet(conditionSet, payload);
      if (result.passed) { anyConditionSetPassed = true; break; }
      failedReasons.push(`${conditionSet.name}: ${result.reasons.join(', ')}`);
    }

    if (!anyConditionSetPassed) return { passed: false, reason: `${tradeType}: Failed all condition sets. ${failedReasons.join(' | ')}` };
  }

  return { passed: true };
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

    const [keyResult, brokerQueryReady] = await Promise.all([
      supabase.from('webhook_keys')
        .select('id, user_id, name, is_active, account_mappings, lot_multiplier, sl_multiplier, target_multiplier')
        .eq('webhook_key', webhookKey)
        .maybeSingle(),
      Promise.resolve(null)
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

    const enrichedPayload = liveVIX !== null ? { ...rawPayload, vix: liveVIX } : rawPayload;

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
        let regimeRocketRuleEnabled: boolean | undefined = undefined;
        let regimeRocketRuleConfig: any = null;

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
            regimeRocketRuleEnabled = filterResult.rocketRuleOverride;
            if (filterResult.rocketRuleOverride) {
              const matchedRegime = (account.signal_filters?.regimes || []).find((r: any) => r.name === filterResult.regimeInfo);
              if (matchedRegime) {
                const dirOv = tradeType === 'BUY' ? matchedRegime.buy_overrides : matchedRegime.sell_overrides;
                if (dirOv?.rocket_rule?.enabled) regimeRocketRuleConfig = dirOv.rocket_rule;
              }
            }
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

        // Fetch fresh signal_filters for this account (needed even when signal_filters_enabled=false
        // because rocket rule is a position-sizing feature, not just a filter gate)
        const { data: freshAccount } = await supabase
          .from('broker_connections')
          .select('signal_filters')
          .eq('id', account.id)
          .maybeSingle();

        const sf = freshAccount?.signal_filters ?? account.signal_filters;
        const directionFilters = tradeType === 'BUY' ? sf?.buy_filters : sf?.sell_filters;
        // Rocket rule lives inside direction-specific filters (buy_filters/sell_filters)
        const rocketRule = directionFilters?.rocket_rule;

        console.log('[Webhook] Rocket rule check:', {
          account_id: account.id,
          trade_type: tradeType,
          has_signal_filters: !!sf,
          has_direction_filters: !!directionFilters,
          rocket_rule: rocketRule,
          volume: enrichedPayload.volume,
          vol_avg_5d: enrichedPayload.vol_avg_5d,
          vix: liveVIX,
          vix_source: vixSource
        });

        const rocketRuleActive = regimeRocketRuleEnabled !== undefined ? regimeRocketRuleEnabled : (rocketRule?.enabled ?? false);
        const effectiveRocketRule = regimeRocketRuleConfig ?? rocketRule;

        if (rocketRuleActive && effectiveRocketRule && enrichedPayload.volume !== undefined && enrichedPayload.vol_avg_5d !== undefined && enrichedPayload.vol_avg_5d > 0) {
          const volumeRatio = enrichedPayload.volume / enrichedPayload.vol_avg_5d;
          const threshold = effectiveRocketRule.volume_ratio_threshold ?? 0.70;
          console.log('[Webhook] Rocket rule volume check:', { volumeRatio, threshold, triggered: volumeRatio >= threshold, source: regimeRocketRuleConfig ? 'regime_override' : 'global' });
          if (volumeRatio >= threshold) {
            rocketRuleTriggered = true;
            finalLotMultiplier = effectiveRocketRule.lot_multiplier ?? 2;
            finalTargetMultiplier = effectiveRocketRule.target_multiplier ?? 3.0;
            console.log('[Webhook] ROCKET RULE TRIGGERED:', { finalLotMultiplier, finalTargetMultiplier, volumeRatio, source: regimeRocketRuleConfig ? 'regime_override' : 'global' });
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
