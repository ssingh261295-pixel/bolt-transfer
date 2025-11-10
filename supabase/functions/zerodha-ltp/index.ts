import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const ltpCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 2000;
const connectionCache = new Map<string, { api_key: string; access_token: string }>();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const brokerId = url.searchParams.get('broker_id');
    const instrumentTokens = url.searchParams.get('instruments');

    if (!brokerId || !instrumentTokens) {
      throw new Error('Missing broker_id or instruments parameter');
    }

    const cacheKey = `${brokerId}:${instrumentTokens}`;
    const now = Date.now();

    const cached = ltpCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      return new Response(
        JSON.stringify({
          success: true,
          data: cached.data,
          cached: true,
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

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

    let brokerConnection = connectionCache.get(brokerId);

    if (!brokerConnection) {
      const { data } = await supabase
        .from('broker_connections')
        .select('api_key, access_token')
        .eq('id', brokerId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!data || !data.access_token) {
        throw new Error('Broker not connected or access token missing');
      }

      brokerConnection = { api_key: data.api_key, access_token: data.access_token };
      connectionCache.set(brokerId, brokerConnection);
    }

    const authToken = `token ${brokerConnection.api_key}:${brokerConnection.access_token}`;
    const kiteUrl = `https://api.kite.trade/quote/ltp?i=${instrumentTokens}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(kiteUrl, {
      method: 'GET',
      headers: {
        'Authorization': authToken,
        'X-Kite-Version': '3',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 403) {
        connectionCache.delete(brokerId);
      }
      const errorText = await response.text();
      throw new Error(`Failed to fetch LTP: ${response.status} - ${errorText}`);
    }

    const ltpData = await response.json();
    const resultData = ltpData.data || {};

    ltpCache.set(cacheKey, { data: resultData, timestamp: now });

    if (ltpCache.size > 100) {
      const firstKey = ltpCache.keys().next().value;
      ltpCache.delete(firstKey);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: resultData,
        cached: false,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
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