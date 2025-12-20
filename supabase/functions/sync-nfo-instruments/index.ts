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

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      throw new Error('Only admins can sync instruments');
    }

    console.log('Fetching NFO instruments from Zerodha...');

    // Fetch NFO instruments CSV from Zerodha
    const instrumentsUrl = 'https://api.kite.trade/instruments/NFO';
    const response = await fetch(instrumentsUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch instruments: ${response.status}`);
    }

    const csvText = await response.text();
    const lines = csvText.trim().split('\n');

    if (lines.length < 2) {
      throw new Error('Invalid CSV format');
    }

    const headers = lines[0].split(',');
    const instruments = [];

    // Parse CSV
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim() === '') continue;

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

        // Only store FUT and optionally CE/PE for now
        if (instrument.instrument_type === 'FUT' ||
            instrument.instrument_type === 'CE' ||
            instrument.instrument_type === 'PE') {

          instruments.push({
            instrument_token: parseInt(instrument.instrument_token) || 0,
            exchange_token: parseInt(instrument.exchange_token) || 0,
            tradingsymbol: instrument.tradingsymbol,
            name: instrument.name,
            last_price: parseFloat(instrument.last_price) || 0,
            expiry: instrument.expiry || null,
            strike: parseFloat(instrument.strike) || 0,
            tick_size: parseFloat(instrument.tick_size) || 0.05,
            lot_size: parseInt(instrument.lot_size) || 1,
            instrument_type: instrument.instrument_type,
            segment: instrument.segment,
            exchange: instrument.exchange,
          });
        }
      }
    }

    console.log(`Parsed ${instruments.length} NFO instruments`);

    // Clear existing data and insert new data
    const { error: deleteError } = await supabase
      .from('nfo_instruments')
      .delete()
      .neq('instrument_token', 0);

    if (deleteError) {
      console.error('Error clearing old instruments:', deleteError);
    }

    // Insert in batches of 1000
    const batchSize = 1000;
    let inserted = 0;

    for (let i = 0; i < instruments.length; i += batchSize) {
      const batch = instruments.slice(i, i + batchSize);

      const { error: insertError } = await supabase
        .from('nfo_instruments')
        .insert(batch);

      if (insertError) {
        console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
        throw insertError;
      }

      inserted += batch.length;
      console.log(`Inserted ${inserted} / ${instruments.length} instruments`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully synced ${inserted} NFO instruments`,
        total: inserted,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in sync-nfo-instruments function:', error);
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
