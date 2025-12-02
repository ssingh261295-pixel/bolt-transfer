import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface OrderRequest {
  broker_connection_id: string;
  symbol: string;
  exchange: string;
  transaction_type: 'BUY' | 'SELL';
  quantity: number;
  order_type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  product: 'MIS' | 'CNC' | 'NRML';
  price?: number;
  trigger_price?: number;
  validity?: 'DAY' | 'IOC';
  strategy_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname.endsWith('/place')) {
      const orderData: OrderRequest = await req.json();

      const { data: brokerConnection } = await supabase
        .from('broker_connections')
        .select('api_key, access_token')
        .eq('id', orderData.broker_connection_id)
        .eq('user_id', user.id)
        .single();

      if (!brokerConnection || !brokerConnection.access_token) {
        throw new Error('Broker not connected');
      }

      const params: any = {
        tradingsymbol: orderData.symbol,
        exchange: orderData.exchange,
        transaction_type: orderData.transaction_type,
        quantity: orderData.quantity.toString(),
        order_type: orderData.order_type,
        product: orderData.product,
        validity: orderData.validity || 'DAY',
      };

      if (orderData.price) {
        params.price = orderData.price.toString();
      }

      if (orderData.trigger_price) {
        params.trigger_price = orderData.trigger_price.toString();
      }

      const response = await fetch('https://api.kite.trade/orders/regular', {
        method: 'POST',
        headers: {
          'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Kite-Version': '3',
        },
        body: new URLSearchParams(params),
      });

      const result = await response.json();

      if (result.status === 'success' && result.data?.order_id) {
        await supabase.from('orders').insert({
          user_id: user.id,
          broker_connection_id: orderData.broker_connection_id,
          strategy_id: orderData.strategy_id || null,
          symbol: orderData.symbol,
          exchange: orderData.exchange,
          order_type: orderData.order_type,
          transaction_type: orderData.transaction_type,
          quantity: orderData.quantity,
          price: orderData.price || null,
          trigger_price: orderData.trigger_price || null,
          status: 'OPEN',
          order_id: result.data.order_id,
        });

        return new Response(
          JSON.stringify({ success: true, order_id: result.data.order_id }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      } else {
        throw new Error(result.message || 'Order placement failed');
      }
    }

    if (req.method === 'GET' && url.pathname.endsWith('/sync')) {
      const brokerId = url.searchParams.get('broker_id');

      if (!brokerId) {
        throw new Error('Missing broker_id');
      }

      const { data: brokerConnection } = await supabase
        .from('broker_connections')
        .select('api_key, access_token')
        .eq('id', brokerId)
        .eq('user_id', user.id)
        .single();

      if (!brokerConnection || !brokerConnection.access_token) {
        throw new Error('Broker not connected');
      }

      const response = await fetch('https://api.kite.trade/orders', {
        headers: {
          'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
          'X-Kite-Version': '3',
        },
      });

      if (!response.ok) {
        if (response.status === 403) {
          await supabase
            .from('broker_connections')
            .update({ is_active: false })
            .eq('id', brokerId);

          throw new Error('Token expired. Please reconnect your broker account.');
        }
        const errorText = await response.text();
        console.error('Zerodha API error:', response.status, errorText);
        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      if (result.status === 'success' && result.data) {
        await supabase
          .from('orders')
          .delete()
          .eq('broker_connection_id', brokerId);

        const orders = result.data;

        if (orders.length > 0) {
          const orderRecords = orders.map((order: any) => ({
            user_id: user.id,
            broker_connection_id: brokerId,
            symbol: order.tradingsymbol,
            exchange: order.exchange,
            order_type: order.order_type,
            transaction_type: order.transaction_type,
            quantity: order.quantity,
            price: order.price || null,
            trigger_price: order.trigger_price || null,
            status: order.status,
            order_id: order.order_id,
            executed_quantity: order.filled_quantity || 0,
            executed_price: order.average_price || null,
          }));

          await supabase.from('orders').insert(orderRecords);
        }

        return new Response(
          JSON.stringify({ success: true, synced: orders.length }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      throw new Error('Failed to sync orders');
    }

    if (req.method === 'POST' && url.pathname.endsWith('/exit')) {
      const { position_id } = await req.json();

      const { data: position } = await supabase
        .from('positions')
        .select('*, broker_connections!inner(api_key, access_token)')
        .eq('id', position_id)
        .eq('user_id', user.id)
        .single();

      if (!position || !position.broker_connections.access_token) {
        throw new Error('Position or broker not found');
      }

      const exitTransactionType = position.quantity > 0 ? 'SELL' : 'BUY';
      const exitQuantity = Math.abs(position.quantity);

      const params: any = {
        tradingsymbol: position.symbol,
        exchange: position.exchange,
        transaction_type: exitTransactionType,
        quantity: exitQuantity.toString(),
        order_type: 'MARKET',
        product: position.product || 'MIS',
        validity: 'DAY',
      };

      const response = await fetch('https://api.kite.trade/orders/regular', {
        method: 'POST',
        headers: {
          'Authorization': `token ${position.broker_connections.api_key}:${position.broker_connections.access_token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Kite-Version': '3',
        },
        body: new URLSearchParams(params),
      });

      const result = await response.json();

      if (result.status === 'success' && result.data?.order_id) {
        await supabase.from('orders').insert({
          user_id: user.id,
          broker_connection_id: position.broker_connection_id,
          symbol: position.symbol,
          exchange: position.exchange,
          order_type: 'MARKET',
          transaction_type: exitTransactionType,
          quantity: exitQuantity,
          price: null,
          trigger_price: null,
          status: 'COMPLETE',
          order_id: result.data.order_id,
        });

        await supabase
          .from('positions')
          .update({ quantity: 0 })
          .eq('id', position_id);

        return new Response(
          JSON.stringify({ success: true, order_id: result.data.order_id, message: 'Position exited successfully' }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      } else {
        throw new Error(result.message || 'Exit order placement failed');
      }
    }

    throw new Error('Invalid endpoint');

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});