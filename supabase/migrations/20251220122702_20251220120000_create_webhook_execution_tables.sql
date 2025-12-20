/*
  # TradingView Webhook Execution System

  ## Tables Created

  ### 1. webhook_keys
  User-managed webhook authentication keys for TradingView integration
  - `id` (uuid, primary key)
  - `user_id` (uuid, references profiles)
  - `name` (text) - User-friendly name for the key
  - `webhook_key` (text, unique) - The actual webhook authentication key
  - `is_active` (boolean) - Enable/disable key instantly
  - `account_mappings` (jsonb) - Array of broker_connection_ids
  - `lot_multiplier` (integer) - Multiplier for position sizing
  - `sl_multiplier` (numeric) - ATR multiplier for stop loss
  - `target_multiplier` (numeric) - ATR multiplier for target
  - `created_at` (timestamptz)
  - `last_used_at` (timestamptz)

  ### 2. tradingview_webhook_logs
  Audit trail for all webhook requests
  - `id` (uuid, primary key)
  - `webhook_key_id` (uuid, references webhook_keys)
  - `source_ip` (text) - Request source IP
  - `payload` (jsonb) - Full request payload
  - `received_at` (timestamptz)
  - `status` (text) - success / rejected / failed
  - `error_message` (text)
  - `accounts_executed` (jsonb) - Array of execution results per account

  ## Security
  - RLS enabled on both tables
  - Users can only manage their own webhook keys
  - Webhook validation happens server-side only
  - All requests logged for audit
*/

-- Create webhook_keys table
CREATE TABLE IF NOT EXISTS webhook_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  webhook_key text UNIQUE NOT NULL,
  is_active boolean DEFAULT true,
  account_mappings jsonb DEFAULT '[]'::jsonb,
  lot_multiplier integer DEFAULT 1,
  sl_multiplier numeric(10,2) DEFAULT 1.5,
  target_multiplier numeric(10,2) DEFAULT 2.0,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz
);

-- Create tradingview_webhook_logs table
CREATE TABLE IF NOT EXISTS tradingview_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_key_id uuid REFERENCES webhook_keys(id) ON DELETE SET NULL,
  source_ip text,
  payload jsonb NOT NULL,
  received_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending' CHECK (status IN ('success', 'rejected', 'failed')),
  error_message text,
  accounts_executed jsonb DEFAULT '[]'::jsonb
);

-- Enable RLS
ALTER TABLE webhook_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradingview_webhook_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for webhook_keys
CREATE POLICY "Users can view own webhook keys"
  ON webhook_keys FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own webhook keys"
  ON webhook_keys FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own webhook keys"
  ON webhook_keys FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own webhook keys"
  ON webhook_keys FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for tradingview_webhook_logs
CREATE POLICY "Users can view own webhook logs"
  ON tradingview_webhook_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM webhook_keys
      WHERE webhook_keys.id = tradingview_webhook_logs.webhook_key_id
        AND webhook_keys.user_id = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_webhook_keys_user_id ON webhook_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_keys_webhook_key ON webhook_keys(webhook_key) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_key_id ON tradingview_webhook_logs(webhook_key_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_received_at ON tradingview_webhook_logs(received_at DESC);