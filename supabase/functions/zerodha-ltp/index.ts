import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    const instrumentTokens = url.searchParams.get('instruments'); // comma-separated tokens

    if (!brokerId) {
      throw new Error('Missing broker_id parameter');
    }

    if (!instrumentTokens) {
      throw new Error('Missing instruments parameter');
    }

    const { data: brokerConnection } = await supabase
      .from('broker_connections')
      .select('api_key, access_token')
      .eq('id', brokerId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!brokerConnection || !brokerConnection.access_token) {
      throw new Error('Broker not connected or access token missing');
    }

    const authToken = `token ${brokerConnection.api_key}:${brokerConnection.access_token}`;

    // Fetch LTP from Zerodha
    const kiteUrl = `https://api.kite.trade/quote/ltp?i=${instrumentTokens}`;

    console.log('Fetching LTP from Zerodha:', kiteUrl);

    const response = await fetch(kiteUrl, {
      method: 'GET',
      headers: {
        'Authorization': authToken,
        'X-Kite-Version': '3',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Zerodha API error:', response.status, errorText);
      throw new Error(`Failed to fetch LTP: ${response.status}`);
    }

    const ltpData = await response.json();

    return new Response(
      JSON.stringify({
        success: true,
        data: ltpData.data || {},
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in zerodha-ltp function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        details: error.toString()
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
