/*
  # NFO Symbol-Specific Trading Settings

  ## Overview
  This migration creates tables for managing per-NFO symbol trading parameters,
  enabling users to configure ATR multipliers, risk/reward ratios, and lot sizes
  for each NFO Future instrument, with broker account-specific overrides.

  ## New Tables

  ### 1. nfo_symbol_settings
  Master configuration for each NFO symbol
  - `id` (uuid, primary key) - Unique identifier
  - `user_id` (uuid, references profiles) - Owner of the settings
  - `broker_connection_id` (uuid, references broker_connections) - Optional: specific broker account
  - `symbol` (text) - NFO symbol name (e.g., "NIFTY", "BANKNIFTY")
  - `atr_multiplier` (numeric) - ATR calculation multiplier (default: 1.5)
  - `sl_multiplier` (numeric) - Stop Loss = ATR × multiplier (default: 1.0)
  - `target_multiplier` (numeric) - Target = ATR × multiplier (default: 1.0)
  - `lot_multiplier` (integer) - Number of lots to trade (default: 1)
  - `is_enabled` (boolean) - Enable/disable trading for this symbol (default: true)
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. webhook_execution_tracker
  Tracks webhook executions to prevent duplicates within same trading day
  - `id` (uuid, primary key) - Unique identifier
  - `webhook_key_id` (uuid, references webhook_keys) - Webhook key used
  - `symbol` (text) - Symbol from webhook payload
  - `trade_type` (text) - BUY or SELL
  - `price` (numeric) - Price from webhook
  - `execution_date` (date) - Trading date (IST)
  - `execution_timestamp` (timestamptz) - Exact execution time
  - `payload_hash` (text) - Hash of critical payload fields for duplicate detection

  ## Indexes
  - Fast lookup by user + symbol + broker
  - Fast duplicate detection by webhook_key + date + hash
  - Efficient date-based cleanup queries

  ## Security
  - RLS enabled on both tables
  - Users can only manage their own settings
  - Webhook execution tracker readable by owner only
*/

-- Create nfo_symbol_settings table
CREATE TABLE IF NOT EXISTS nfo_symbol_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  broker_connection_id uuid REFERENCES broker_connections(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  atr_multiplier numeric(10,2) DEFAULT 1.5 CHECK (atr_multiplier > 0),
  sl_multiplier numeric(10,2) DEFAULT 1.0 CHECK (sl_multiplier > 0),
  target_multiplier numeric(10,2) DEFAULT 1.0 CHECK (target_multiplier > 0),
  lot_multiplier integer DEFAULT 1 CHECK (lot_multiplier > 0),
  is_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, symbol, broker_connection_id)
);

-- Create webhook_execution_tracker table for duplicate prevention
CREATE TABLE IF NOT EXISTS webhook_execution_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_key_id uuid REFERENCES webhook_keys(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  trade_type text NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  price numeric(10,2) NOT NULL,
  execution_date date NOT NULL,
  execution_timestamp timestamptz DEFAULT now(),
  payload_hash text NOT NULL,
  UNIQUE(webhook_key_id, symbol, trade_type, execution_date)
);

-- Indexes for nfo_symbol_settings
CREATE INDEX IF NOT EXISTS idx_nfo_symbol_settings_user_id
  ON nfo_symbol_settings(user_id);

CREATE INDEX IF NOT EXISTS idx_nfo_symbol_settings_symbol
  ON nfo_symbol_settings(symbol) WHERE is_enabled = true;

CREATE INDEX IF NOT EXISTS idx_nfo_symbol_settings_broker
  ON nfo_symbol_settings(broker_connection_id) WHERE broker_connection_id IS NOT NULL;

-- Indexes for webhook_execution_tracker
CREATE INDEX IF NOT EXISTS idx_webhook_execution_tracker_webhook_key
  ON webhook_execution_tracker(webhook_key_id, execution_date DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_execution_tracker_date
  ON webhook_execution_tracker(execution_date DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_execution_tracker_hash
  ON webhook_execution_tracker(payload_hash);

-- Enable RLS
ALTER TABLE nfo_symbol_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_execution_tracker ENABLE ROW LEVEL SECURITY;

-- RLS Policies for nfo_symbol_settings
CREATE POLICY "Users can view own NFO symbol settings"
  ON nfo_symbol_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own NFO symbol settings"
  ON nfo_symbol_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own NFO symbol settings"
  ON nfo_symbol_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own NFO symbol settings"
  ON nfo_symbol_settings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for webhook_execution_tracker
CREATE POLICY "Users can view own webhook execution tracker"
  ON webhook_execution_tracker FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM webhook_keys
      WHERE webhook_keys.id = webhook_execution_tracker.webhook_key_id
        AND webhook_keys.user_id = auth.uid()
    )
  );

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_nfo_symbol_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS update_nfo_symbol_settings_updated_at_trigger ON nfo_symbol_settings;
CREATE TRIGGER update_nfo_symbol_settings_updated_at_trigger
  BEFORE UPDATE ON nfo_symbol_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_nfo_symbol_settings_updated_at();

-- Function to clean up old webhook execution tracker records (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_execution_tracker()
RETURNS void AS $$
BEGIN
  DELETE FROM webhook_execution_tracker
  WHERE execution_date < CURRENT_DATE - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment on tables
COMMENT ON TABLE nfo_symbol_settings IS 'Per-symbol trading configuration for NFO futures, with optional broker account overrides';
COMMENT ON TABLE webhook_execution_tracker IS 'Tracks webhook executions to prevent duplicate trades within the same trading day';
