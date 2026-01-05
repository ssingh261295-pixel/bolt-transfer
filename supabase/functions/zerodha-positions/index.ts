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

        // Bulk insert all positions at once
        const positionRecords = positions
          .filter((position: any) => position.quantity !== 0)
          .map((position: any) => {
            const pnl = (position.last_price - position.average_price) * position.quantity;
            const pnlPercentage = ((position.last_price - position.average_price) / position.average_price) * 100;

            return {
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
              instrument_token: position.instrument_token,
            };
          });

        if (positionRecords.length > 0) {
          await supabase.from('positions').insert(positionRecords);
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

    if (req.method === 'GET' && url.pathname.endsWith('/margins')) {
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

      const response = await fetch('https://api.kite.trade/user/margins', {
        headers: {
          'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
          'X-Kite-Version': '3',
        },
      });

      const result = await response.json();

      if (result.status === 'success') {
        return new Response(
          JSON.stringify({ success: true, margins: result.data || {} }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      throw new Error('Failed to fetch margins');
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

    const [positionsResponse, marginsResponse] = await Promise.all([
      fetch('https://api.kite.trade/portfolio/positions', {
        headers: {
          'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
          'X-Kite-Version': '3',
        },
      }),
      fetch('https://api.kite.trade/user/margins', {
        headers: {
          'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
          'X-Kite-Version': '3',
        },
      }),
    ]);

    const positionsResult = await positionsResponse.json();
    const marginsResult = await marginsResponse.json();

    const positions = positionsResult.status === 'success' ? positionsResult.data?.net || [] : [];
    const dayPositions = positionsResult.status === 'success' ? positionsResult.data?.day || [] : [];
    const margins = marginsResult.status === 'success' ? marginsResult.data || {} : {};

    // Calculate totals for debugging
    const netPnlTotal = positions.reduce((sum: number, p: any) => sum + (parseFloat(p.pnl) || 0), 0);
    const dayPnlTotal = dayPositions.reduce((sum: number, p: any) => sum + (parseFloat(p.pnl) || 0), 0);

    return new Response(
      JSON.stringify({
        success: true,
        positions,
        dayPositions,
        margins,
        debug: {
          netCount: positions.length,
          dayCount: dayPositions.length,
          netPnlTotal,
          dayPnlTotal,
          rawPositionsStatus: positionsResult.status,
        }
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in zerodha-positions:', error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        message: error.message
      }),
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
