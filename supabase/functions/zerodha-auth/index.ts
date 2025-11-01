import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createHash } from 'node:crypto';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface TokenExchangeRequest {
  request_token: string;
  broker_connection_id: string;
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

    if (url.pathname.endsWith('/exchange-token')) {
      const body: TokenExchangeRequest = await req.json();
      const { request_token, broker_connection_id } = body;

      if (!request_token || !broker_connection_id) {
        throw new Error('Missing required parameters');
      }

      const { data: brokerConnection } = await supabase
        .from('broker_connections')
        .select('api_key, api_secret')
        .eq('id', broker_connection_id)
        .eq('user_id', user.id)
        .single();

      if (!brokerConnection) {
        throw new Error('Broker connection not found');
      }

      if (!brokerConnection.api_key || !brokerConnection.api_secret) {
        throw new Error('API credentials are missing. Please re-enter your API Key and Secret.');
      }

      const checksum = createHash('sha256')
        .update(brokerConnection.api_key + request_token + brokerConnection.api_secret)
        .digest('hex');

      const tokenParams = new URLSearchParams({
        api_key: brokerConnection.api_key.trim(),
        request_token: request_token.trim(),
        checksum: checksum,
      });

      console.log('Token exchange request:', {
        api_key: brokerConnection.api_key,
        api_key_length: brokerConnection.api_key.length,
        request_token: request_token,
        request_token_length: request_token.length,
        checksum: checksum,
        body: tokenParams.toString()
      });

      const response = await fetch('https://api.kite.trade/session/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Kite-Version': '3',
        },
        body: tokenParams.toString(),
      });

      const responseText = await response.text();
      console.log('Zerodha API raw response:', responseText);

      const data = JSON.parse(responseText);
      console.log('Zerodha API parsed response:', JSON.stringify(data));

      if (data.status === 'success' && data.data?.access_token) {
        // Calculate next midnight IST (5:30 AM UTC)
        const now = new Date();
        const nextMidnightIST = new Date(now);
        nextMidnightIST.setUTCHours(19, 30, 0, 0); // 12:00 AM IST = 7:30 PM UTC previous day

        // If we're past 7:30 PM UTC today, set to tomorrow's 7:30 PM UTC
        if (now.getUTCHours() >= 19 && now.getUTCMinutes() >= 30) {
          nextMidnightIST.setUTCDate(nextMidnightIST.getUTCDate() + 1);
        }

        await supabase
          .from('broker_connections')
          .update({
            access_token: data.data.access_token,
            is_active: true,
            last_connected_at: new Date().toISOString(),
            token_expires_at: nextMidnightIST.toISOString(),
          })
          .eq('id', broker_connection_id);

        return new Response(
          JSON.stringify({ success: true, message: 'Connected successfully' }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      } else {
        const errorMessage = data.message || data.error_type || 'Token exchange failed';
        console.error('Token exchange failed:', errorMessage, data);
        throw new Error(errorMessage);
      }
    }

    if (url.pathname.endsWith('/login-url')) {
      const { searchParams } = url;
      const brokerId = searchParams.get('broker_id');

      if (!brokerId) {
        throw new Error('Missing broker_id parameter');
      }

      const { data: brokerConnection } = await supabase
        .from('broker_connections')
        .select('api_key')
        .eq('id', brokerId)
        .eq('user_id', user.id)
        .single();

      if (!brokerConnection) {
        throw new Error('Broker connection not found');
      }

      const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${brokerConnection.api_key}&state=${brokerId}`;

      return new Response(
        JSON.stringify({ login_url: loginUrl }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
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
