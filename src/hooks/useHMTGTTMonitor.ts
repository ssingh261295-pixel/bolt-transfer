import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

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
  userId: string | undefined,
  activeOrders: HMTGTTOrder[],
  getLTP: (token: number) => number | null,
  sessionToken: string | undefined,
  onOrderTriggered?: () => void
) {
  const processingRef = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!userId || !sessionToken || activeOrders.length === 0) {
      return;
    }

    const checkOrders = async () => {
      const now = Date.now();

      for (const order of activeOrders) {
        // Skip if already processing this order
        if (processingRef.current.has(order.id)) {
          continue;
        }

        // Throttle checks to once every 500ms per order
        const lastCheck = lastCheckRef.current.get(order.id) || 0;
        if (now - lastCheck < 500) {
          continue;
        }

        lastCheckRef.current.set(order.id, now);

        const ltp = getLTP(order.instrument_token);
        if (!ltp) continue;

        let shouldTrigger = false;
        let triggeredLeg: '1' | '2' | null = null;
        let triggerPrice = 0;
        let orderPrice = 0;
        let quantity = 0;
        let productType = '';

        if (order.condition_type === 'single') {
          // Single trigger
          if (order.transaction_type === 'BUY') {
            shouldTrigger = ltp >= order.trigger_price_1;
          } else {
            shouldTrigger = ltp <= order.trigger_price_1;
          }

          if (shouldTrigger) {
            triggeredLeg = '1';
            triggerPrice = order.trigger_price_1;
            orderPrice = order.order_price_1;
            quantity = order.quantity_1;
            productType = order.product_type_1;
          }
        } else {
          // Two-leg (OCO)
          const trigger1Met = order.transaction_type === 'BUY'
            ? ltp >= order.trigger_price_1
            : ltp <= order.trigger_price_1;

          const trigger2Met = order.trigger_price_2 && (
            order.transaction_type === 'BUY'
              ? ltp <= order.trigger_price_2
              : ltp >= order.trigger_price_2
          );

          if (trigger1Met) {
            shouldTrigger = true;
            triggeredLeg = '1';
            triggerPrice = order.trigger_price_1;
            orderPrice = order.order_price_1;
            quantity = order.quantity_1;
            productType = order.product_type_1;
          } else if (trigger2Met) {
            shouldTrigger = true;
            triggeredLeg = '2';
            triggerPrice = order.trigger_price_2!;
            orderPrice = order.order_price_2!;
            quantity = order.quantity_2!;
            productType = order.product_type_2!;
          }
        }

        if (shouldTrigger && triggeredLeg) {
          processingRef.current.add(order.id);

          try {
            // Place market order via Zerodha API
            const orderData = {
              exchange: order.exchange,
              tradingsymbol: order.trading_symbol,
              transaction_type: order.transaction_type,
              quantity: quantity,
              order_type: 'MARKET',
              product: productType,
              validity: 'DAY'
            };

            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders?broker_id=${order.broker_connection_id}`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${sessionToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(orderData),
              }
            );

            const result = await response.json();

            // Update HMT GTT order in database
            if (result.success && result.order_id) {
              await supabase
                .from('hmt_gtt_orders')
                .update({
                  status: 'triggered',
                  triggered_at: new Date().toISOString(),
                  triggered_leg: triggeredLeg,
                  triggered_price: ltp,
                  order_id: result.order_id,
                  order_status: 'COMPLETE'
                })
                .eq('id', order.id)
                .eq('user_id', userId);

              console.log(`HMT GTT ${order.id} triggered at ${ltp}, order placed: ${result.order_id}`);

              if (onOrderTriggered) {
                onOrderTriggered();
              }
            } else {
              // Failed to place order
              await supabase
                .from('hmt_gtt_orders')
                .update({
                  status: 'failed',
                  error_message: result.error || 'Failed to place order',
                  triggered_at: new Date().toISOString(),
                  triggered_leg: triggeredLeg,
                  triggered_price: ltp
                })
                .eq('id', order.id)
                .eq('user_id', userId);

              console.error(`Failed to place order for HMT GTT ${order.id}:`, result.error);
            }
          } catch (error: any) {
            console.error(`Error processing HMT GTT ${order.id}:`, error);

            // Update as failed
            await supabase
              .from('hmt_gtt_orders')
              .update({
                status: 'failed',
                error_message: error.message || 'Unknown error',
                triggered_at: new Date().toISOString(),
                triggered_leg: triggeredLeg,
                triggered_price: ltp
              })
              .eq('id', order.id)
              .eq('user_id', userId);
          } finally {
            processingRef.current.delete(order.id);
          }
        }
      }
    };

    // Check every 100ms for quick response
    const interval = setInterval(checkOrders, 100);

    return () => {
      clearInterval(interval);
    };
  }, [userId, activeOrders, getLTP, sessionToken]);

  return null;
}
