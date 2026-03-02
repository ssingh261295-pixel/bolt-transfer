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
 * 5. Respond 200 OK to TradingView immediately (prevents timeouts)
 * 6. In background: Place MARKET order (MANDATORY FIRST)
 * 7. In background: Fetch executed price from Zerodha API
 * 8. In background: Calculate SL/Target based on EXECUTED price
 * 9. In background: Create HMT GTT (SL + Target) after order success
 * 10. In background: Notify user in real-time
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
    return { allowed: false, currentTime: currentTimeIST, reason: 'BEFORE_09_30_IST' };
  }

  if (currentMinutes > endMinutes) {
    return { allowed: false, currentTime: currentTimeIST, reason: 'AFTER_15_00_IST' };
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

  if (filters.trade_types) {
    if (tradeType === 'BUY' && filters.trade_types.allow_buy === false) {
      return { passed: false, reason: 'BUY trades not allowed' };
    }
    if (tradeType === 'SELL' && filters.trade_types.allow_sell === false) {
      return { passed: false, reason: 'SELL trades not allowed' };
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
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
      return { passed: false, reason: `Outside allowed time window (${filters.time_filters.start_time}-${filters.time_filters.end_time})` };
    }
  }

  const directionFilters = tradeType === 'BUY' ?
    (filters.buy_filters || filters) :
    (filters.sell_filters || filters);

  if (directionFilters.trade_grade?.enabled && payload.trade_grade) {
    const allowedGrades = directionFilters.trade_grade.allowed_grades || ['A', 'B', 'C', 'D'];
    if (!allowedGrades.includes(payload.trade_grade)) {
      return { passed: false, reason: `${tradeType}: Trade grade ${payload.trade_grade} not in allowed list` };
    }
  }

  if (directionFilters.trade_score?.enabled && payload.trade_score !== undefined) {
    const minScore = directionFilters.trade_score.min_score || 5.0;
    if (payload.trade_score < minScore) {
      return { passed: false, reason: `${tradeType}: Trade score ${payload.trade_score} below minimum ${minScore}` };
    }
  }

  if (directionFilters.entry_phase?.enabled && payload.entry_phase) {
    const allowedPhases = directionFilters.entry_phase.allowed_phases || ['EARLY', 'MID', 'OPTIMAL', 'LATE'];
    if (!allowedPhases.includes(payload.entry_phase)) {
      return { passed: false, reason: `${tradeType}: Entry phase ${payload.entry_phase} not in allowed list` };
    }
  }

  if (directionFilters.adx?.enabled && payload.adx !== undefined) {
    const minValue = directionFilters.adx.min_value || 0;
    const maxValue = directionFilters.adx.max_value || 100;
    if (payload.adx < minValue || payload.adx > maxValue) {
      return { passed: false, reason: `${tradeType}: ADX ${payload.adx} outside range ${minValue}-${maxValue}` };
    }
  }

  if (directionFilters.volume?.enabled && payload.vol_avg_5d !== undefined) {
    const minVolume = directionFilters.volume.min_avg_volume_5d || 0;
    if (payload.vol_avg_5d < minVolume) {
      return { passed: false, reason: `${tradeType}: Volume ${payload.vol_avg_5d} below minimum ${minVolume}` };
    }
  }

  if (directionFilters.price_range?.enabled && payload.price !== undefined) {
    const minPrice = directionFilters.price_range.min_price || 0;
    const maxPrice = directionFilters.price_range.max_price || 1000000;
    if (payload.price < minPrice || payload.price > maxPrice) {
      return { passed: false, reason: `${tradeType}: Price ${payload.price} outside range ${minPrice}-${maxPrice}` };
    }
  }

  if (directionFilters.dist_ema21_atr?.enabled && payload.dist_ema21_atr !== undefined) {
    const minValue = directionFilters.dist_ema21_atr.min_value ?? -10.0;
    const maxValue = directionFilters.dist_ema21_atr.max_value ?? 10.0;
    if (payload.dist_ema21_atr < minValue || payload.dist_ema21_atr > maxValue) {
      return { passed: false, reason: `${tradeType}: Distance from EMA21 ${payload.dist_ema21_atr.toFixed(2)} ATR outside range ${minValue}-${maxValue}` };
    }
  }

  if (directionFilters.volume_ratio?.enabled && payload.volume !== undefined && payload.vol_avg_5d !== undefined) {
    if (payload.vol_avg_5d > 0) {
      const volumeRatio = payload.volume / payload.vol_avg_5d;
      const minValue = directionFilters.volume_ratio.min_value ?? 0.0;
      const maxValue = directionFilters.volume_ratio.max_value ?? 10.0;
      if (volumeRatio < minValue || volumeRatio > maxValue) {
        return { passed: false, reason: `${tradeType}: Volume ratio ${volumeRatio.toFixed(2)} outside range ${minValue}-${maxValue}` };
      }
    }
  }

  if (directionFilters.di_spread?.enabled && payload.di_plus !== undefined && payload.di_minus !== undefined) {
    const diSpread = Math.abs(payload.di_plus - payload.di_minus);
    const minValue = directionFilters.di_spread.min_value ?? 0;
    const maxValue = directionFilters.di_spread.max_value ?? 100;
    if (diSpread < minValue || diSpread > maxValue) {
      return { passed: false, reason: `${tradeType}: DI Spread ${diSpread.toFixed(2)} outside range ${minValue}-${maxValue}` };
    }
  }

  const conditionSets = directionFilters.condition_sets || [];
  const enabledConditionSets = conditionSets.filter((cs: any) => cs.enabled);

  if (enabledConditionSets.length > 0) {
    let anyConditionSetPassed = false;
    const failedReasons: string[] = [];

    for (const conditionSet of enabledConditionSets) {
      let conditionPassed = true;
      const reasons: string[] = [];

      if (payload.volume !== undefined && payload.vol_avg_5d !== undefined && payload.vol_avg_5d > 0) {
        const volumeRatio = payload.volume / payload.vol_avg_5d;
        const minVR = conditionSet.volume_ratio?.min ?? 0;
        const maxVR = conditionSet.volume_ratio?.max ?? 100;
        if (volumeRatio < minVR || volumeRatio > maxVR) {
          conditionPassed = false;
          reasons.push(`VR=${volumeRatio.toFixed(2)} not in [${minVR}, ${maxVR}]`);
        }
      } else {
        conditionPassed = false;
        reasons.push('volume data missing');
      }

      if (payload.di_plus !== undefined && payload.di_minus !== undefined) {
        const diSpread = Math.abs(payload.di_plus - payload.di_minus);
        const minDI = conditionSet.di_spread?.min ?? 0;
        const maxDI = conditionSet.di_spread?.max ?? 100;
        if (diSpread < minDI || diSpread > maxDI) {
          conditionPassed = false;
          reasons.push(`DI=${diSpread.toFixed(2)} not in [${minDI}, ${maxDI}]`);
        }
      } else {
        conditionPassed = false;
        reasons.push('DI data missing');
      }

      if (payload.adx !== undefined) {
        const minADX = conditionSet.adx?.min ?? 0;
        const maxADX = conditionSet.adx?.max ?? 100;
        if (payload.adx < minADX || payload.adx > maxADX) {
          conditionPassed = false;
          reasons.push(`ADX=${payload.adx} not in [${minADX}, ${maxADX}]`);
        }
      } else {
        conditionPassed = false;
        reasons.push('ADX missing');
      }

      if (payload.dist_ema21_atr !== undefined) {
        const emaDistance = Math.abs(payload.dist_ema21_atr);
        const minEMA = conditionSet.ema_distance?.min ?? 0;
        const maxEMA = conditionSet.ema_distance?.max ?? 100;
        if (emaDistance < minEMA || emaDistance > maxEMA) {
          conditionPassed = false;
          reasons.push(`EMA_dist=${emaDistance.toFixed(2)} not in [${minEMA}, ${maxEMA}]`);
        }
      } else {
        conditionPassed = false;
        reasons.push('EMA distance missing');
      }

      if (conditionPassed) {
        anyConditionSetPassed = true;
        break;
      } else {
        failedReasons.push(`${conditionSet.name}: ${reasons.join(', ')}`);
      }
    }

    if (!anyConditionSetPassed) {
      return {
        passed: false,
        reason: `${tradeType}: Failed all condition sets. ${failedReasons.join(' | ')}`
      };
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

async function executeOrdersInBackground(
  supabase: any,
  normalized: NormalizedPayload,
  keyData: any,
  brokerAccounts: any[],
  instrument: any,
  sourceIp: string,
  rawPayload: any,
  executionMode: string
) {
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
        accountResult.error = `Symbol ${normalized.symbol} trading is disabled`;
        executionResults.push(accountResult);
        continue;
      }

      let rocketRuleTriggered = false;
      let finalLotMultiplier = lotMultiplier;
      let finalTargetMultiplier = targetMultiplier;

      const directionFilters = normalized.trade_type === 'BUY' ?
        account.signal_filters?.buy_filters :
        account.signal_filters?.sell_filters;

      const rocketRule = directionFilters?.rocket_rule || account.signal_filters?.rocket_rule;

      if (rocketRule?.enabled) {
        const volumeRatioThreshold = rocketRule.volume_ratio_threshold ?? 0.70;

        if (rawPayload.volume !== undefined && rawPayload.vol_avg_5d !== undefined && rawPayload.vol_avg_5d > 0) {
          const volumeRatio = rawPayload.volume / rawPayload.vol_avg_5d;

          if (volumeRatio >= volumeRatioThreshold) {
            rocketRuleTriggered = true;
            finalLotMultiplier = rocketRule.lot_multiplier ?? 2;
            finalTargetMultiplier = rocketRule.target_multiplier ?? 3.0;
          }
        }
      }

      const adjustedATR = normalized.atr * atrMultiplier;
      const quantity = instrument.lot_size * finalLotMultiplier;

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
        const maxRetries = 10;
        let retryCount = 0;

        while (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500));

          const orderDetailsResponse = await fetch('https://api.kite.trade/orders', {
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
                break;
              } else if (placedOrder.status === 'REJECTED') {
                orderRejected = true;
                accountResult.order_error = placedOrder.status_message || 'Order rejected by broker';
                break;
              }
            }
          }

          retryCount++;
        }

        if (retryCount === maxRetries && !orderCompleted && !orderRejected) {
          console.warn(`[TradingView Webhook] Failed to fetch order status after ${maxRetries} attempts, last status: ${orderStatus}`);
        }

        if (orderCompleted) {
          let stopLossPrice: number;
          let targetPrice: number;

          if (normalized.trade_type === 'BUY') {
            stopLossPrice = executedPrice - (adjustedATR * slMultiplier);
            targetPrice = executedPrice + (adjustedATR * finalTargetMultiplier);
          } else {
            stopLossPrice = executedPrice + (adjustedATR * slMultiplier);
            targetPrice = executedPrice - (adjustedATR * finalTargetMultiplier);
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
                timeframe: rawPayload.timeframe || null,
                rocket_rule_triggered: rocketRuleTriggered,
                volume_ratio: rocketRuleTriggered && rawPayload.volume && rawPayload.vol_avg_5d
                  ? (rawPayload.volume / rawPayload.vol_avg_5d).toFixed(2)
                  : null
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
          signal: { trade_type: normalized.trade_type, symbol: normalized.symbol, price: normalized.price }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tradingWindow = isWithinTradingWindow();
    if (!tradingWindow.allowed) {
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

    const executionMode = rawPayload._execution_mode ?? 'AUTOMATED';

    if (executionMode === 'AUTOMATED') {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istTime = new Date(now.getTime() + istOffset);
      const executionDate = istTime.toISOString().split('T')[0];

      const payloadHash = `${normalized.symbol}_${normalized.trade_type}_${normalized.price.toFixed(2)}_${normalized.atr.toFixed(2)}`;

      const trackerInsertResult = await supabase.rpc('try_insert_execution_tracker', {
        p_webhook_key_id: keyData.id,
        p_symbol: normalized.symbol,
        p_trade_type: normalized.trade_type,
        p_price: normalized.price,
        p_execution_date: executionDate,
        p_payload_hash: payloadHash
      });

      if (trackerInsertResult.error || !trackerInsertResult.data) {
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
    }

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

    const { data: brokerAccounts, error: brokerError } = await supabase
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
      instrument = futInstruments.length >= 2 ? futInstruments[1] : futInstruments[0];
    }

    // Respond to TradingView IMMEDIATELY to prevent timeout
    // All order execution happens in the background via EdgeRuntime.waitUntil
    const backgroundTask = executeOrdersInBackground(
      supabase,
      normalized,
      keyData,
      brokerAccounts,
      instrument,
      sourceIp,
      rawPayload,
      executionMode
    );

    EdgeRuntime.waitUntil(backgroundTask);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Signal accepted for ${normalized.symbol} ${normalized.trade_type} - executing on ${brokerAccounts.length} account(s)`,
        signal: {
          trade_type: normalized.trade_type,
          symbol: instrument.tradingsymbol,
          cash_price: normalized.price,
          atr: normalized.atr
        }
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
