/**
 * Zerodha Postback Receiver
 *
 * Receives order status updates from Zerodha via postback URL
 * Updates order status in database and creates notifications
 *
 * SAFETY: This is informational only - no orders are placed or modified
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

interface ZerodhaPostback {
  order_id: string;
  tradingsymbol: string;
  transaction_type: string;
  quantity: number;
  price?: number;
  average_price?: number;
  status: string;
  status_message?: string;
  order_timestamp?: string;
  exchange_timestamp?: string;
  filled_quantity?: number;
  pending_quantity?: number;
  cancelled_quantity?: number;
  trigger_price?: number;
  exchange?: string;
  product?: string;
  order_type?: string;
}

function getNotificationTypeFromStatus(status: string): 'trade' | 'error' | 'info' | 'alert' {
  const statusUpper = status.toUpperCase();
  switch (statusUpper) {
    case 'COMPLETE':
    case 'COMPLETED':
      return 'trade';
    case 'REJECTED':
    case 'CANCELLED':
      return 'error';
    case 'TRIGGERED':
    case 'OPEN':
      return 'alert';
    default:
      return 'info';
  }
}

function mapZerodhaStatusToDBStatus(status: string): string {
  const statusUpper = status.toUpperCase();
  switch (statusUpper) {
    case 'COMPLETE':
      return 'COMPLETED';
    case 'OPEN':
    case 'TRIGGER PENDING':
      return 'OPEN';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return statusUpper;
  }
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
    const contentType = req.headers.get('content-type') || '';
    let postbackData: ZerodhaPostback;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      postbackData = {
        order_id: formData.get('order_id') as string,
        tradingsymbol: formData.get('tradingsymbol') as string,
        transaction_type: formData.get('transaction_type') as string,
        quantity: parseInt(formData.get('quantity') as string) || 0,
        price: formData.get('price') ? parseFloat(formData.get('price') as string) : undefined,
        average_price: formData.get('average_price') ? parseFloat(formData.get('average_price') as string) : undefined,
        status: formData.get('status') as string,
        status_message: formData.get('status_message') as string || undefined,
        order_timestamp: formData.get('order_timestamp') as string || undefined,
        exchange_timestamp: formData.get('exchange_timestamp') as string || undefined,
        filled_quantity: formData.get('filled_quantity') ? parseInt(formData.get('filled_quantity') as string) : undefined,
        pending_quantity: formData.get('pending_quantity') ? parseInt(formData.get('pending_quantity') as string) : undefined,
        cancelled_quantity: formData.get('cancelled_quantity') ? parseInt(formData.get('cancelled_quantity') as string) : undefined,
        trigger_price: formData.get('trigger_price') ? parseFloat(formData.get('trigger_price') as string) : undefined,
        exchange: formData.get('exchange') as string || undefined,
        product: formData.get('product') as string || undefined,
        order_type: formData.get('order_type') as string || undefined,
      };
    } else if (contentType.includes('application/json')) {
      postbackData = await req.json();
    } else {
      return new Response(
        JSON.stringify({ error: "Unsupported content type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log('[Zerodha Postback] Received:', {
      order_id: postbackData.order_id,
      symbol: postbackData.tradingsymbol,
      status: postbackData.status,
      quantity: postbackData.quantity
    });

    if (!postbackData.order_id) {
      return new Response(
        JSON.stringify({ error: "Missing order_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up order in database
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, broker_connection_id, symbol, transaction_type, quantity, status')
      .eq('order_id', postbackData.order_id)
      .maybeSingle();

    if (orderError) {
      console.error('[Zerodha Postback] Error looking up order:', orderError);
      return new Response(
        JSON.stringify({ success: true, message: "Acknowledged but order not found in DB" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!order) {
      console.log('[Zerodha Postback] Order not found in database:', postbackData.order_id);
      return new Response(
        JSON.stringify({ success: true, message: "Order not found, acknowledged anyway" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dbStatus = mapZerodhaStatusToDBStatus(postbackData.status);
    const executedPrice = postbackData.average_price || postbackData.price;
    const executedQuantity = postbackData.filled_quantity || 0;

    // Update order status
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: dbStatus,
        executed_price: executedPrice,
        executed_quantity: executedQuantity,
        updated_at: new Date().toISOString()
      })
      .eq('id', order.id);

    if (updateError) {
      console.error('[Zerodha Postback] Error updating order:', updateError);
    } else {
      console.log('[Zerodha Postback] Updated order:', {
        order_id: order.id,
        status: dbStatus,
        executed_price: executedPrice,
        executed_quantity: executedQuantity
      });
    }

    // Create notification
    const notificationType = getNotificationTypeFromStatus(postbackData.status);
    const priceStr = executedPrice ? ` at 500 ${executedPrice}` : '';
    const qtyStr = executedQuantity > 0 ? ` (${executedQuantity}/${postbackData.quantity})` : '';

    let notificationTitle = 'Order Update';
    let notificationMessage = `${postbackData.tradingsymbol} ${postbackData.status}${priceStr}${qtyStr}`;

    switch (postbackData.status.toUpperCase()) {
      case 'COMPLETE':
      case 'COMPLETED':
        notificationTitle = 'Order Executed';
        notificationMessage = `${postbackData.transaction_type} order for ${postbackData.tradingsymbol} executed${priceStr}`;
        break;
      case 'REJECTED':
        notificationTitle = 'Order Rejected';
        notificationMessage = `${postbackData.transaction_type} order for ${postbackData.tradingsymbol} was rejected${postbackData.status_message ? `: ${postbackData.status_message}` : ''}`;
        break;
      case 'CANCELLED':
        notificationTitle = 'Order Cancelled';
        notificationMessage = `${postbackData.transaction_type} order for ${postbackData.tradingsymbol} was cancelled`;
        break;
      case 'TRIGGERED':
        notificationTitle = 'Order Triggered';
        notificationMessage = `${postbackData.transaction_type} order for ${postbackData.tradingsymbol} has been triggered`;
        break;
    }

    const { error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_id: order.user_id,
        broker_account_id: order.broker_connection_id,
        source: 'zerodha',
        symbol: postbackData.tradingsymbol,
        title: notificationTitle,
        message: notificationMessage,
        type: notificationType,
        metadata: {
          order_id: postbackData.order_id,
          db_order_id: order.id,
          status: postbackData.status,
          transaction_type: postbackData.transaction_type,
          quantity: postbackData.quantity,
          filled_quantity: executedQuantity,
          executed_price: executedPrice,
          status_message: postbackData.status_message,
          exchange: postbackData.exchange,
          product: postbackData.product
        }
      });

    if (notifError) {
      console.error('[Zerodha Postback] Error creating notification:', notifError);
    } else {
      console.log('[Zerodha Postback] Created notification for order:', postbackData.order_id);
    }

    // Always return 200 to acknowledge receipt
    return new Response(
      JSON.stringify({
        success: true,
        message: "Postback received and processed",
        order_id: postbackData.order_id,
        status: dbStatus
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('[Zerodha Postback] Unhandled error:', error);
    // Still return 200 to prevent Zerodha retries
    return new Response(
      JSON.stringify({
        success: true,
        message: "Acknowledged with error",
        error: error.message
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});