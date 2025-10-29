import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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

      if (!brokerConnection) {
        throw new Error('Broker connection not found');
      }

      if (!brokerConnection.access_token) {
        throw new Error('Broker not authorized. Please complete the Zerodha login flow from the Brokers page.');
      }

      const response = await fetch('https://api.kite.trade/portfolio/positions', {
        headers: {
          'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
          'X-Kite-Version': '3',
        },
      });

      const result = await response.json();

      if (result.status === 'success' && result.data) {
        await supabase
          .from('positions')
          .delete()
          .eq('broker_connection_id', brokerId);

        const positions = result.data.net || [];

        for (const position of positions) {
          if (position.quantity !== 0) {
            const pnl = (position.last_price - position.average_price) * position.quantity;
            const pnlPercentage = ((position.last_price - position.average_price) / position.average_price) * 100;

            await supabase.from('positions').insert({
              user_id: user.id,
              broker_connection_id: brokerId,
              symbol: position.tradingsymbol,
              exchange: position.exchange,
              product_type: position.product,
              quantity: position.quantity,
              average_price: position.average_price,
              current_price: position.last_price,
              pnl: pnl,
              pnl_percentage: pnlPercentage,
            });
          }
        }

        return new Response(
          JSON.stringify({ success: true, synced: positions.length }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      throw new Error('Failed to sync positions');
    }

    if (req.method === 'GET' && url.pathname.endsWith('/holdings')) {
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

      if (!brokerConnection) {
        throw new Error('Broker connection not found');
      }

      if (!brokerConnection.access_token) {
        throw new Error('Broker not authorized. Please complete the Zerodha login flow from the Brokers page.');
      }

      const response = await fetch('https://api.kite.trade/portfolio/holdings', {
        headers: {
          'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
          'X-Kite-Version': '3',
        },
      });

      const result = await response.json();

      if (result.status === 'success') {
        return new Response(
          JSON.stringify({ success: true, holdings: result.data || [] }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      throw new Error('Failed to fetch holdings');
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