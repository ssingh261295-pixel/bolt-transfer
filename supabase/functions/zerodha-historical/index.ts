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
    const brokerId = url.searchParams.get('broker_id');
    const instrumentToken = url.searchParams.get('instrument_token');
    const from = url.searchParams.get('from'); // YYYY-MM-DD
    const to = url.searchParams.get('to'); // YYYY-MM-DD
    const interval = url.searchParams.get('interval') || 'day'; // minute, day, 3minute, 5minute, 10minute, 15minute, 30minute, 60minute

    if (!brokerId || !instrumentToken || !from || !to) {
      throw new Error('Missing required parameters: broker_id, instrument_token, from, to');
    }

    // Get broker connection
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
      throw new Error('Broker not authorized. Please complete the Zerodha login flow.');
    }

    // Fetch historical data from Zerodha
    const histUrl = `https://api.kite.trade/instruments/historical/${instrumentToken}/${interval}?from=${from}&to=${to}`;
    
    const response = await fetch(histUrl, {
      headers: {
        'Authorization': `token ${brokerConnection.api_key}:${brokerConnection.access_token}`,
        'X-Kite-Version': '3',
      },
    });

    const result = await response.json();

    if (result.status === 'success' && result.data && result.data.candles) {
      // Transform data format
      // Zerodha format: [date, open, high, low, close, volume]
      const candles = result.data.candles.map((candle: any) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: candles,
          count: candles.length 
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    throw new Error(result.message || 'Failed to fetch historical data');

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
