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
    const exchange = url.searchParams.get('exchange') || 'NFO';
    const search = url.searchParams.get('search') || '';

    // Zerodha instruments CSV is public - no auth needed
    const instrumentsUrl = `https://api.kite.trade/instruments/${exchange}`;

    console.log('Fetching instruments from:', instrumentsUrl);

    const response = await fetch(instrumentsUrl);

    if (!response.ok) {
      console.error('Failed to fetch instruments, status:', response.status);
      throw new Error(`Failed to fetch instruments from Zerodha: ${response.status}`);
    }

    const csvText = await response.text();
    console.log('CSV text length:', csvText.length);

    // Parse CSV to JSON with better error handling
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('Invalid CSV format from Zerodha');
    }

    const headers = lines[0].split(',');
    const instruments = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim() === '') continue;

      // Handle CSV parsing with quoted values
      const values: string[] = [];
      let currentValue = '';
      let insideQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];

        if (char === '"') {
          insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim());

      if (values.length >= headers.length) {
        const instrument: any = {};
        headers.forEach((header, index) => {
          instrument[header.trim()] = values[index]?.replace(/^"|"$/g, '').trim() || '';
        });

        // Filter by search term if provided
        if (search) {
          const searchLower = search.toLowerCase();
          const tradingsymbol = instrument.tradingsymbol?.toLowerCase() || '';
          const name = instrument.name?.toLowerCase() || '';

          if (tradingsymbol.includes(searchLower) || name.includes(searchLower)) {
            instruments.push({
              instrument_token: instrument.instrument_token,
              exchange_token: instrument.exchange_token,
              tradingsymbol: instrument.tradingsymbol,
              name: instrument.name,
              last_price: instrument.last_price,
              expiry: instrument.expiry,
              strike: instrument.strike,
              tick_size: instrument.tick_size,
              lot_size: instrument.lot_size,
              instrument_type: instrument.instrument_type,
              segment: instrument.segment,
              exchange: instrument.exchange,
            });
          }
        } else {
          // Without search, return all instruments (search will be done client-side)
          instruments.push({
            instrument_token: instrument.instrument_token,
            exchange_token: instrument.exchange_token,
            tradingsymbol: instrument.tradingsymbol,
            name: instrument.name,
            last_price: instrument.last_price,
            expiry: instrument.expiry,
            strike: instrument.strike,
            tick_size: instrument.tick_size,
            lot_size: instrument.lot_size,
            instrument_type: instrument.instrument_type,
            segment: instrument.segment,
            exchange: instrument.exchange,
          });
        }
      }

      // Limit to 50 results when searching
      if (search && instruments.length >= 50) {
        break;
      }
    }

    console.log('Parsed instruments count:', instruments.length);

    return new Response(
      JSON.stringify({
        success: true,
        instruments: instruments,
        total: instruments.length,
        exchange: exchange
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in zerodha-instruments function:', error);
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
