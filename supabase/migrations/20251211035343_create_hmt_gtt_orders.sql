/*
  # Create HMT GTT Orders Table

  1. New Tables
    - `hmt_gtt_orders`
      - `id` (uuid, primary key) - Unique identifier for the HMT GTT order
      - `user_id` (uuid) - Reference to the user who created the order
      - `broker_connection_id` (uuid) - Reference to the broker connection
      - `trading_symbol` (text) - Trading symbol (e.g., NIFTY25JAN25000CE)
      - `exchange` (text) - Exchange (NSE, BSE, NFO, etc.)
      - `instrument_token` (bigint) - Instrument token for websocket subscription
      - `condition_type` (text) - Type of GTT: 'single' or 'two-leg' (OCO)
      - `transaction_type` (text) - BUY or SELL
      - `product_type_1` (text) - Product type for first leg: NRML or MIS
      - `trigger_price_1` (numeric) - Trigger price for first leg (stoploss in OCO)
      - `order_price_1` (numeric) - Order price for first leg
      - `quantity_1` (integer) - Quantity for first leg
      - `product_type_2` (text, nullable) - Product type for second leg (OCO only)
      - `trigger_price_2` (numeric, nullable) - Trigger price for second leg (target in OCO)
      - `order_price_2` (numeric, nullable) - Order price for second leg (OCO only)
      - `quantity_2` (integer, nullable) - Quantity for second leg (OCO only)
      - `status` (text) - Order status: active, triggered, cancelled, failed, expired
      - `triggered_at` (timestamptz, nullable) - When the order was triggered
      - `triggered_leg` (text, nullable) - Which leg was triggered (1 or 2) for OCO orders
      - `triggered_price` (numeric, nullable) - Price at which trigger occurred
      - `order_id` (text, nullable) - Zerodha order ID after placement
      - `order_status` (text, nullable) - Status of the placed order
      - `error_message` (text, nullable) - Error message if failed
      - `created_at` (timestamptz) - When the order was created
      - `updated_at` (timestamptz) - When the order was last updated
      - `expires_at` (timestamptz, nullable) - Optional expiry time for the order

  2. Security
    - Enable RLS on `hmt_gtt_orders` table
    - Add policy for users to read their own HMT GTT orders
    - Add policy for users to create their own HMT GTT orders
    - Add policy for users to update their own HMT GTT orders
    - Add policy for users to delete their own HMT GTT orders

  3. Indexes
    - Index on user_id for faster queries
    - Index on broker_connection_id for faster queries
    - Index on status for filtering active orders
    - Index on instrument_token for monitoring
    - Composite index on (user_id, status) for common query pattern
*/

-- Create the HMT GTT orders table
CREATE TABLE IF NOT EXISTS hmt_gtt_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_connection_id uuid NOT NULL REFERENCES broker_connections(id) ON DELETE CASCADE,
  trading_symbol text NOT NULL,
  exchange text NOT NULL,
  instrument_token bigint NOT NULL,
  condition_type text NOT NULL CHECK (condition_type IN ('single', 'two-leg')),
  transaction_type text NOT NULL CHECK (transaction_type IN ('BUY', 'SELL')),
  product_type_1 text NOT NULL CHECK (product_type_1 IN ('NRML', 'MIS')),
  trigger_price_1 numeric(10, 2) NOT NULL,
  order_price_1 numeric(10, 2) NOT NULL,
  quantity_1 integer NOT NULL CHECK (quantity_1 > 0),
  product_type_2 text CHECK (product_type_2 IN ('NRML', 'MIS')),
  trigger_price_2 numeric(10, 2),
  order_price_2 numeric(10, 2),
  quantity_2 integer CHECK (quantity_2 IS NULL OR quantity_2 > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled', 'failed', 'expired')),
  triggered_at timestamptz,
  triggered_leg text CHECK (triggered_leg IN ('1', '2')),
  triggered_price numeric(10, 2),
  order_id text,
  order_status text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT two_leg_requires_second_leg CHECK (
    (condition_type = 'single') OR
    (condition_type = 'two-leg' AND product_type_2 IS NOT NULL AND trigger_price_2 IS NOT NULL AND order_price_2 IS NOT NULL AND quantity_2 IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE hmt_gtt_orders ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own HMT GTT orders"
  ON hmt_gtt_orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own HMT GTT orders"
  ON hmt_gtt_orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own HMT GTT orders"
  ON hmt_gtt_orders FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own HMT GTT orders"
  ON hmt_gtt_orders FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_user_id ON hmt_gtt_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_broker_connection_id ON hmt_gtt_orders(broker_connection_id);
CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_status ON hmt_gtt_orders(status);
CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_instrument_token ON hmt_gtt_orders(instrument_token);
CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_user_status ON hmt_gtt_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_created_at ON hmt_gtt_orders(created_at DESC);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_hmt_gtt_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_hmt_gtt_orders_updated_at
  BEFORE UPDATE ON hmt_gtt_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_hmt_gtt_orders_updated_at();