import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface NotificationData {
  user_id: string;
  source: string;
  strategy_name?: string;
  symbol?: string;
  title: string;
  message: string;
  type: 'trade' | 'order' | 'alert' | 'error' | 'info';
  metadata?: Record<string, any>;
}

export async function createNotification(
  supabase: SupabaseClient,
  data: NotificationData
): Promise<void> {
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: data.user_id,
      source: data.source,
      strategy_name: data.strategy_name,
      symbol: data.symbol,
      title: data.title,
      message: data.message,
      type: data.type,
      metadata: data.metadata || {}
    });

    if (error) {
      console.error('[Notification Helper] Error creating notification:', error);
    }
  } catch (err) {
    console.error('[Notification Helper] Exception creating notification:', err);
  }
}

export function formatOrderNotification(
  action: 'placed' | 'executed' | 'failed' | 'sl_hit' | 'target_hit',
  symbol: string,
  transactionType: string,
  quantity: number,
  price?: number,
  error?: string
): { title: string; message: string; type: 'order' | 'error' } {
  switch (action) {
    case 'placed':
      return {
        title: 'Order Placed',
        message: `${transactionType} order for ${quantity}x ${symbol} placed successfully${price ? ` at ${price}` : ''}`,
        type: 'order'
      };
    case 'executed':
      return {
        title: 'Order Executed',
        message: `${transactionType} order for ${quantity}x ${symbol} executed${price ? ` at ${price}` : ''}`,
        type: 'order'
      };
    case 'failed':
      return {
        title: 'Order Failed',
        message: `${transactionType} order for ${quantity}x ${symbol} failed${error ? `: ${error}` : ''}`,
        type: 'error'
      };
    case 'sl_hit':
      return {
        title: 'Stop Loss Hit',
        message: `Stop loss triggered for ${symbol}. ${transactionType} order executed${price ? ` at ${price}` : ''}`,
        type: 'order'
      };
    case 'target_hit':
      return {
        title: 'Target Hit',
        message: `Target reached for ${symbol}. ${transactionType} order executed${price ? ` at ${price}` : ''}`,
        type: 'order'
      };
    default:
      return {
        title: 'Order Update',
        message: `Order update for ${symbol}`,
        type: 'order'
      };
  }
}