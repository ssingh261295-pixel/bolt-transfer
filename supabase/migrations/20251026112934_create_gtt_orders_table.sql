/*
  # Create GTT Orders Table

  1. New Tables
    - `gtt_orders`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `broker_connection_id` (uuid, foreign key to broker_connections)
      - `symbol` (text) - Trading symbol
      - `exchange` (text) - Exchange name (NSE, BSE, NFO, etc.)
      - `transaction_type` (text) - BUY or SELL
      - `quantity` (integer) - Order quantity
      - `gtt_type` (text) - single or oco
      - `trigger_price` (decimal) - Trigger price for single GTT
      - `limit_price` (decimal) - Limit price (optional)
      - `stop_loss` (decimal) - Stop loss price for OCO
      - `target` (decimal) - Target price for OCO
      - `status` (text) - active, triggered, cancelled, expired
      - `trigger_id` (text) - ID from broker API
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `triggered_at` (timestamptz)
      - `expires_at` (timestamptz)

  2. Security
    - Enable RLS on `gtt_orders` table
    - Add policies for authenticated users to manage their own GTT orders
*/

CREATE TABLE IF NOT EXISTS gtt_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  broker_connection_id uuid REFERENCES broker_connections(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  exchange text NOT NULL,
  transaction_type text NOT NULL,
  quantity integer NOT NULL,
  gtt_type text NOT NULL DEFAULT 'single',
  trigger_price decimal,
  limit_price decimal,
  stop_loss decimal,
  target decimal,
  status text NOT NULL DEFAULT 'active',
  trigger_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  triggered_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT valid_gtt_type CHECK (gtt_type IN ('single', 'oco')),
  CONSTRAINT valid_status CHECK (status IN ('active', 'triggered', 'cancelled', 'expired')),
  CONSTRAINT valid_transaction_type CHECK (transaction_type IN ('BUY', 'SELL'))
);

ALTER TABLE gtt_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own GTT orders"
  ON gtt_orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own GTT orders"
  ON gtt_orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own GTT orders"
  ON gtt_orders FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own GTT orders"
  ON gtt_orders FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_gtt_orders_user_id ON gtt_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_gtt_orders_broker_connection_id ON gtt_orders(broker_connection_id);
CREATE INDEX IF NOT EXISTS idx_gtt_orders_status ON gtt_orders(status);
