/*
  # Create WebSocket Subscriptions Schema

  1. New Tables
    - `websocket_subscriptions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `broker_connection_id` (uuid, foreign key to broker_connections)
      - `instrument_token` (bigint) - Zerodha instrument token
      - `symbol` (text) - Trading symbol
      - `exchange` (text) - Exchange
      - `mode` (text) - Subscription mode (ltp, quote, full)
      - `is_active` (boolean) - Whether subscription is active
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on table
    - Add policies for authenticated users to manage their own subscriptions
*/

-- Create websocket_subscriptions table
CREATE TABLE IF NOT EXISTS websocket_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  broker_connection_id uuid REFERENCES broker_connections(id) ON DELETE CASCADE NOT NULL,
  instrument_token bigint NOT NULL,
  symbol text NOT NULL,
  exchange text NOT NULL,
  mode text DEFAULT 'full' CHECK (mode IN ('ltp', 'quote', 'full')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, broker_connection_id, instrument_token)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_websocket_subscriptions_user_id ON websocket_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_websocket_subscriptions_broker_id ON websocket_subscriptions(broker_connection_id);
CREATE INDEX IF NOT EXISTS idx_websocket_subscriptions_instrument_token ON websocket_subscriptions(instrument_token);

-- Enable RLS
ALTER TABLE websocket_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own subscriptions"
  ON websocket_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own subscriptions"
  ON websocket_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON websocket_subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions"
  ON websocket_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
