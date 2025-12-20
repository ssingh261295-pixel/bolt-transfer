/*
  # Add Dashboard Metrics Cache

  1. New Tables
    - `dashboard_metrics_cache` - Stores precomputed dashboard metrics per broker account
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `broker_connection_id` (uuid, foreign key to broker_connections)
      - `available_margin` (numeric) - Available margin
      - `used_margin` (numeric) - Used margin
      - `available_cash` (numeric) - Opening balance/available cash
      - `today_pnl` (numeric) - Today's profit/loss
      - `active_trades` (integer) - Count of active positions
      - `active_gtt` (integer) - Count of active GTT orders
      - `last_updated` (timestamptz) - When metrics were last computed
      - `created_at` (timestamptz) - When record was created

  2. Indexes
    - Index on user_id for fast user queries
    - Index on broker_connection_id for fast broker queries
    - Composite index on (user_id, broker_connection_id) for unique constraint

  3. Security
    - Enable RLS on dashboard_metrics_cache table
    - Add policies for authenticated users to read/update their own metrics
*/

CREATE TABLE IF NOT EXISTS dashboard_metrics_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_connection_id uuid NOT NULL REFERENCES broker_connections(id) ON DELETE CASCADE,
  available_margin numeric DEFAULT 0,
  used_margin numeric DEFAULT 0,
  available_cash numeric DEFAULT 0,
  today_pnl numeric DEFAULT 0,
  active_trades integer DEFAULT 0,
  active_gtt integer DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, broker_connection_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_user_id ON dashboard_metrics_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_broker_id ON dashboard_metrics_cache(broker_connection_id);

ALTER TABLE dashboard_metrics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own metrics"
  ON dashboard_metrics_cache
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own metrics"
  ON dashboard_metrics_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own metrics"
  ON dashboard_metrics_cache
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own metrics"
  ON dashboard_metrics_cache
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);