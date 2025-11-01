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

    if (!brokerId) {
      throw new Error('Missing broker_id parameter');
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

    if (req.method === 'GET') {
      const kiteUrl = 'https://api.kite.trade/gtt/triggers';

      console.log('Fetching GTT orders from Zerodha...');

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
        throw new Error(`Failed to fetch GTT orders: ${response.status}`);
      }

      const data = await response.json();

      return new Response(
        JSON.stringify({
          success: true,
          data: data.data || [],
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const kiteUrl = 'https://api.kite.trade/gtt/triggers';

      console.log('Creating GTT order - raw body:', JSON.stringify(body, null, 2));

      const formData = new URLSearchParams();

      const conditionData: any = {
        trigger_values: []
      };
      const ordersData: any = [{}, {}];

      Object.keys(body).forEach(key => {
        const value = body[key];
        if (value !== undefined && value !== null && value !== '') {
          if (key.startsWith('condition[') && key.endsWith(']')) {
            const fullMatch = key.match(/condition\[(.+?)\](?:\[(\d+)\])?/);
            if (fullMatch) {
              const fieldName = fullMatch[1];
              const arrayIndex = fullMatch[2];

              if (fieldName === 'trigger_values' && arrayIndex !== undefined) {
                const idx = parseInt(arrayIndex);
                conditionData.trigger_values[idx] = parseFloat(value);
              } else {
                conditionData[fieldName] = value;
              }
            }
          } else if (key.startsWith('orders[')) {
            const match = key.match(/orders\[(\d+)\]\[(.+?)\]/);
            if (match) {
              const orderIndex = parseInt(match[1]);
              const fieldName = match[2];
              ordersData[orderIndex][fieldName] = value;
            }
          } else if (key === 'type') {
            formData.append('type', value.toString());
          }
        }
      });

      if (!body.type) {
        formData.append('type', 'single');
      }

      formData.append('condition[exchange]', conditionData.exchange);
      formData.append('condition[tradingsymbol]', conditionData.tradingsymbol);
      formData.append('condition[instrument_token]', conditionData.instrument_token.toString());

      conditionData.trigger_values = conditionData.trigger_values.filter((v: any) => v !== undefined && v !== null);

      conditionData.trigger_values.forEach((val: number) => {
        formData.append('condition[trigger_values]', val.toString());
      });

      if (conditionData.trigger_values.length > 0) {
        formData.append('condition[last_price]', conditionData.trigger_values[0].toString());
      }

      ordersData.forEach((order: any, index: number) => {
        if (Object.keys(order).length > 0) {
          Object.keys(order).forEach(key => {
            const value = order[key];
            if (value !== undefined && value !== null && value !== '') {
              formData.append(`orders[${index}][${key}]`, value.toString());
            }
          });
        }
      });

      const formDataString = formData.toString();
      console.log('Form data being sent to Zerodha:', formDataString);

      const response = await fetch(kiteUrl, {
        method: 'POST',
        headers: {
          'Authorization': authToken,
          'X-Kite-Version': '3',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formDataString,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Zerodha API error - Full response:', response.status, errorText);

        let errorDetail = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          console.error('Parsed error JSON:', errorJson);
          errorDetail = errorJson.message || JSON.stringify(errorJson, null, 2);
        } catch (e) {
          console.error('Could not parse error as JSON');
        }

        throw new Error(`Zerodha API Error (${response.status}): ${errorDetail}`);
      }

      const data = await response.json();

      return new Response(
        JSON.stringify({
          success: true,
          data: data.data,
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (req.method === 'PUT') {
      const body = await req.json();
      const gttId = url.searchParams.get('gtt_id');

      if (!gttId) {
        throw new Error('Missing gtt_id parameter');
      }

      const kiteUrl = `https://api.kite.trade/gtt/triggers/${gttId}`;

      console.log('Modifying GTT order:', gttId, body);

      const response = await fetch(kiteUrl, {
        method: 'PUT',
        headers: {
          'Authorization': authToken,
          'X-Kite-Version': '3',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(body).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Zerodha API error:', response.status, errorText);
        throw new Error(`Failed to modify GTT: ${errorText}`);
      }

      const data = await response.json();

      return new Response(
        JSON.stringify({
          success: true,
          data: data.data,
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (req.method === 'DELETE') {
      const gttId = url.searchParams.get('gtt_id');

      if (!gttId) {
        throw new Error('Missing gtt_id parameter');
      }
      const kiteUrl = `https://api.kite.trade/gtt/triggers/${gttId}`;

      console.log('Deleting GTT order:', gttId);

      const response = await fetch(kiteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': authToken,
          'X-Kite-Version': '3',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Zerodha API error:', response.status, errorText);
        throw new Error(`Failed to delete GTT: ${errorText}`);
      }

      const data = await response.json();

      return new Response(
        JSON.stringify({
          success: true,
          data: data.data,
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    throw new Error('Method not allowed');

  } catch (error) {
    console.error('Error in zerodha-gtt function:', error);
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
