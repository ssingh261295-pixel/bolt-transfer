/*
  # Create NFO Instruments Table

  1. New Tables
    - `nfo_instruments`
      - `id` (uuid, primary key)
      - `instrument_token` (integer, unique) - Zerodha's instrument token
      - `exchange_token` (integer) - Exchange token
      - `tradingsymbol` (text) - Trading symbol (e.g., NIFTY25JAN26000CE)
      - `name` (text) - Instrument name
      - `last_price` (numeric) - Last traded price
      - `exchange` (text) - Exchange (NFO)
      - `instrument_type` (text) - CE, PE, FUT
      - `segment` (text) - NFO-OPT, NFO-FUT
      - `strike` (numeric) - Strike price for options
      - `tick_size` (numeric) - Tick size
      - `lot_size` (integer) - Lot size
      - `expiry` (date) - Expiry date
      - `last_updated` (timestamptz) - Last price update time
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `nfo_instruments` table
    - Add policy for authenticated users to read instrument data
    - Add policy for service role to update instrument data

  3. Indexes
    - Index on instrument_token for fast lookups
    - Index on tradingsymbol for search
    - Index on expiry for filtering
*/

CREATE TABLE IF NOT EXISTS nfo_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_token integer UNIQUE NOT NULL,
  exchange_token integer,
  tradingsymbol text NOT NULL,
  name text,
  last_price numeric DEFAULT 0,
  exchange text DEFAULT 'NFO',
  instrument_type text,
  segment text,
  strike numeric,
  tick_size numeric DEFAULT 0.05,
  lot_size integer DEFAULT 1,
  expiry date,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE nfo_instruments ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read instrument data
CREATE POLICY "Authenticated users can read NFO instruments"
  ON nfo_instruments
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to insert/update instrument data (for webhooks/updates)
CREATE POLICY "Service role can manage NFO instruments"
  ON nfo_instruments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_nfo_instruments_token ON nfo_instruments(instrument_token);
CREATE INDEX IF NOT EXISTS idx_nfo_instruments_symbol ON nfo_instruments(tradingsymbol);
CREATE INDEX IF NOT EXISTS idx_nfo_instruments_expiry ON nfo_instruments(expiry);
CREATE INDEX IF NOT EXISTS idx_nfo_instruments_type ON nfo_instruments(instrument_type);