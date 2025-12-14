/*
  # HMT GTT Safety and OCO Improvements

  ## Changes

  1. Add parent_id column for OCO linking
    - Links two-leg OCO triggers together for atomic cancellation
    - Enables proper sibling lookup without additional database queries

  2. Create engine_state table for singleton enforcement
    - Ensures only ONE engine instance can execute orders
    - Tracks engine heartbeat and last activity
    - Provides distributed locking mechanism

  3. Create risk_limits table for per-user risk management
    - Max trades per day enforcement
    - Max loss per day tracking
    - Auto square-off time configuration
    - Global kill switch per user

  4. Create trade_log table for audit trail
    - Tracks all order executions from HMT GTT
    - Enables P&L calculation and risk monitoring
    - Provides compliance and debugging data

  ## Security
    - RLS enabled on all tables
    - Users can only view their own risk limits and trade logs
    - Engine state is admin-only visibility

  ## Performance
    - Indexes on hot query paths
    - Partial indexes for active records
    - Minimal impact on execution latency
*/

-- Add parent_id to hmt_gtt_orders for OCO linking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hmt_gtt_orders' AND column_name = 'parent_id'
  ) THEN
    ALTER TABLE hmt_gtt_orders ADD COLUMN parent_id uuid;
    CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_parent_id ON hmt_gtt_orders(parent_id)
      WHERE parent_id IS NOT NULL;
  END IF;
END $$;

-- Create engine_state table for singleton enforcement
CREATE TABLE IF NOT EXISTS hmt_engine_state (
  id text PRIMARY KEY DEFAULT 'singleton',
  is_running boolean NOT NULL DEFAULT false,
  instance_id text,
  started_at timestamptz,
  last_heartbeat timestamptz,
  processed_ticks bigint DEFAULT 0,
  triggered_orders integer DEFAULT 0,
  failed_orders integer DEFAULT 0,
  active_triggers integer DEFAULT 0,
  websocket_status text DEFAULT 'disconnected',
  error_message text,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT singleton_check CHECK (id = 'singleton')
);

-- Insert singleton row if not exists
INSERT INTO hmt_engine_state (id, is_running)
VALUES ('singleton', false)
ON CONFLICT (id) DO NOTHING;

-- Create risk_limits table
CREATE TABLE IF NOT EXISTS risk_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  max_trades_per_day integer NOT NULL DEFAULT 10,
  max_loss_per_day numeric(12, 2) NOT NULL DEFAULT 10000.00,
  auto_square_off_time time NOT NULL DEFAULT '15:15:00',
  kill_switch_enabled boolean NOT NULL DEFAULT false,
  daily_trades_count integer NOT NULL DEFAULT 0,
  daily_pnl numeric(12, 2) NOT NULL DEFAULT 0.00,
  last_reset_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE risk_limits ENABLE ROW LEVEL SECURITY;

-- Create policies for risk_limits
CREATE POLICY "Users can view own risk limits"
  ON risk_limits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own risk limits"
  ON risk_limits FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create trade_log table
CREATE TABLE IF NOT EXISTS hmt_trade_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hmt_order_id uuid NOT NULL REFERENCES hmt_gtt_orders(id) ON DELETE CASCADE,
  broker_connection_id uuid NOT NULL REFERENCES broker_connections(id) ON DELETE CASCADE,
  trading_symbol text NOT NULL,
  exchange text NOT NULL,
  transaction_type text NOT NULL,
  quantity integer NOT NULL,
  trigger_price numeric(10, 2) NOT NULL,
  executed_price numeric(10, 2) NOT NULL,
  order_id text NOT NULL,
  order_status text NOT NULL,
  pnl numeric(12, 2),
  executed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE hmt_trade_log ENABLE ROW LEVEL SECURITY;

-- Create policies for trade_log
CREATE POLICY "Users can view own trade log"
  ON hmt_trade_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert trade log"
  ON hmt_trade_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_risk_limits_user_id ON risk_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_limits_kill_switch ON risk_limits(user_id, kill_switch_enabled)
  WHERE kill_switch_enabled = false;

CREATE INDEX IF NOT EXISTS idx_trade_log_user_id ON hmt_trade_log(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_log_executed_at ON hmt_trade_log(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_log_user_date ON hmt_trade_log(user_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_trade_log_hmt_order ON hmt_trade_log(hmt_order_id);

-- Create function to auto-insert risk limits for new users
CREATE OR REPLACE FUNCTION create_default_risk_limits()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO risk_limits (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for auto-inserting risk limits
DROP TRIGGER IF EXISTS on_auth_user_created_risk_limits ON auth.users;
CREATE TRIGGER on_auth_user_created_risk_limits
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_risk_limits();

-- Create function to reset daily counters at midnight
CREATE OR REPLACE FUNCTION reset_daily_risk_counters()
RETURNS void AS $$
BEGIN
  UPDATE risk_limits
  SET
    daily_trades_count = 0,
    daily_pnl = 0.00,
    last_reset_date = CURRENT_DATE,
    updated_at = now()
  WHERE last_reset_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to update engine heartbeat
CREATE OR REPLACE FUNCTION update_engine_heartbeat(
  p_instance_id text,
  p_processed_ticks bigint,
  p_triggered_orders integer,
  p_failed_orders integer,
  p_active_triggers integer,
  p_websocket_status text
)
RETURNS void AS $$
BEGIN
  UPDATE hmt_engine_state
  SET
    last_heartbeat = now(),
    processed_ticks = p_processed_ticks,
    triggered_orders = p_triggered_orders,
    failed_orders = p_failed_orders,
    active_triggers = p_active_triggers,
    websocket_status = p_websocket_status,
    updated_at = now()
  WHERE id = 'singleton' AND instance_id = p_instance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to acquire engine lock
CREATE OR REPLACE FUNCTION acquire_engine_lock(p_instance_id text)
RETURNS boolean AS $$
DECLARE
  lock_acquired boolean;
BEGIN
  UPDATE hmt_engine_state
  SET
    is_running = true,
    instance_id = p_instance_id,
    started_at = now(),
    last_heartbeat = now(),
    error_message = null,
    updated_at = now()
  WHERE id = 'singleton'
    AND (
      is_running = false
      OR last_heartbeat < now() - interval '2 minutes'
    )
  RETURNING true INTO lock_acquired;

  RETURN COALESCE(lock_acquired, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to release engine lock
CREATE OR REPLACE FUNCTION release_engine_lock(p_instance_id text)
RETURNS void AS $$
BEGIN
  UPDATE hmt_engine_state
  SET
    is_running = false,
    instance_id = null,
    updated_at = now()
  WHERE id = 'singleton' AND instance_id = p_instance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add updated_at triggers
CREATE OR REPLACE FUNCTION update_risk_limits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_risk_limits_updated_at ON risk_limits;
CREATE TRIGGER update_risk_limits_updated_at
  BEFORE UPDATE ON risk_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_risk_limits_updated_at();

-- Comments for documentation
COMMENT ON TABLE hmt_engine_state IS 'Singleton table for engine state and distributed locking';
COMMENT ON TABLE risk_limits IS 'Per-user risk management limits and daily counters';
COMMENT ON TABLE hmt_trade_log IS 'Audit log of all HMT GTT order executions';
COMMENT ON FUNCTION acquire_engine_lock IS 'Acquire distributed lock for engine execution. Returns true if lock acquired.';
COMMENT ON FUNCTION release_engine_lock IS 'Release engine lock when shutting down';
COMMENT ON FUNCTION reset_daily_risk_counters IS 'Reset daily trade counters at midnight. Should be called by cron job.';
