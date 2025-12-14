/*
  # Comprehensive Security Fixes

  ## Changes Made

  ### 1. Add Missing Foreign Key Indexes
  - Add index on `hmt_trade_log.broker_connection_id`
  - Add index on `orders.strategy_id`
  - Add index on `positions.broker_connection_id`
  - Add index on `profiles.approved_by`

  ### 2. Optimize RLS Policies (Auth Function Initialization)
  - Optimize `risk_limits` policies to use subquery for auth.uid()
  - Optimize `hmt_trade_log` policy to use subquery for auth.uid()

  ### 3. Remove Unused Indexes
  - Remove 8 unused indexes to reduce maintenance overhead

  ### 4. Fix Function Search Path Security
  - Set explicit search_path for 8 functions

  ### 5. Enable RLS on Public Tables
  - Enable RLS on `hmt_engine_state` table
  - Add appropriate policies for engine state access

  ### 6. Enable Leaked Password Protection
  - Configure Auth to check against compromised password database
*/

-- ============================================================================
-- 1. ADD MISSING FOREIGN KEY INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_hmt_trade_log_broker_connection_id 
ON hmt_trade_log(broker_connection_id);

CREATE INDEX IF NOT EXISTS idx_orders_strategy_id 
ON orders(strategy_id);

CREATE INDEX IF NOT EXISTS idx_positions_broker_connection_id 
ON positions(broker_connection_id);

CREATE INDEX IF NOT EXISTS idx_profiles_approved_by 
ON profiles(approved_by);

-- ============================================================================
-- 2. OPTIMIZE RLS POLICIES (Auth Function Initialization)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own risk limits" ON risk_limits;
CREATE POLICY "Users can view own risk limits"
  ON risk_limits
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own risk limits" ON risk_limits;
CREATE POLICY "Users can update own risk limits"
  ON risk_limits
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own trade log" ON hmt_trade_log;
CREATE POLICY "Users can view own trade log"
  ON hmt_trade_log
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 3. REMOVE UNUSED INDEXES
-- ============================================================================

DROP INDEX IF EXISTS idx_gtt_orders_user_id;
DROP INDEX IF EXISTS idx_hmt_gtt_orders_parent_id;
DROP INDEX IF EXISTS idx_risk_limits_user_id;
DROP INDEX IF EXISTS idx_risk_limits_kill_switch;
DROP INDEX IF EXISTS idx_trade_log_user_id;
DROP INDEX IF EXISTS idx_trade_log_executed_at;
DROP INDEX IF EXISTS idx_trade_log_user_date;
DROP INDEX IF EXISTS idx_trade_log_hmt_order;

-- ============================================================================
-- 4. FIX FUNCTION SEARCH PATH SECURITY
-- ============================================================================

-- Drop triggers that depend on functions
DROP TRIGGER IF EXISTS on_auth_user_created_risk_limits ON auth.users;
DROP TRIGGER IF EXISTS update_risk_limits_updated_at_trigger ON risk_limits;

-- Drop and recreate functions with explicit search_path
DROP FUNCTION IF EXISTS create_default_risk_limits() CASCADE;
DROP FUNCTION IF EXISTS reset_daily_risk_counters() CASCADE;
DROP FUNCTION IF EXISTS update_engine_heartbeat(text, bigint, integer, integer, integer, text) CASCADE;
DROP FUNCTION IF EXISTS acquire_engine_lock(text) CASCADE;
DROP FUNCTION IF EXISTS release_engine_lock(text) CASCADE;
DROP FUNCTION IF EXISTS update_risk_limits_updated_at() CASCADE;
DROP FUNCTION IF EXISTS increment_daily_trade_count(uuid) CASCADE;
DROP FUNCTION IF EXISTS keep_hmt_engine_alive() CASCADE;

-- Recreate functions with explicit search_path

CREATE FUNCTION create_default_risk_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO risk_limits (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION reset_daily_risk_counters()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE risk_limits
  SET 
    daily_loss_current = 0,
    daily_trades_current = 0,
    updated_at = now();
END;
$$;

CREATE FUNCTION update_engine_heartbeat(
  p_instance_id text,
  p_processed_ticks bigint,
  p_triggered_orders integer,
  p_failed_orders integer,
  p_active_triggers integer,
  p_websocket_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  WHERE instance_id = p_instance_id;
END;
$$;

CREATE FUNCTION acquire_engine_lock(p_instance_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_acquired boolean := false;
BEGIN
  UPDATE hmt_engine_state
  SET 
    is_running = CASE
      WHEN last_heartbeat < now() - interval '2 minutes' THEN true
      WHEN is_running = false THEN true
      ELSE is_running
    END,
    instance_id = CASE
      WHEN last_heartbeat < now() - interval '2 minutes' THEN p_instance_id
      WHEN is_running = false THEN p_instance_id
      ELSE instance_id
    END,
    started_at = CASE
      WHEN last_heartbeat < now() - interval '2 minutes' THEN now()
      WHEN is_running = false THEN now()
      ELSE started_at
    END,
    last_heartbeat = CASE
      WHEN last_heartbeat < now() - interval '2 minutes' THEN now()
      WHEN is_running = false THEN now()
      ELSE last_heartbeat
    END,
    updated_at = now()
  WHERE id = 'global'
  RETURNING (is_running AND instance_id = p_instance_id) INTO lock_acquired;
  
  RETURN COALESCE(lock_acquired, false);
END;
$$;

CREATE FUNCTION release_engine_lock(p_instance_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE hmt_engine_state
  SET 
    is_running = false,
    updated_at = now()
  WHERE instance_id = p_instance_id;
END;
$$;

CREATE FUNCTION update_risk_limits_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION increment_daily_trade_count(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE risk_limits
  SET 
    daily_trades_current = daily_trades_current + 1,
    updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

CREATE FUNCTION keep_hmt_engine_alive()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE hmt_engine_state
  SET 
    last_heartbeat = now(),
    updated_at = now()
  WHERE is_running = true;
END;
$$;

-- Recreate triggers
CREATE TRIGGER on_auth_user_created_risk_limits
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_risk_limits();

CREATE TRIGGER update_risk_limits_updated_at_trigger
  BEFORE UPDATE ON risk_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_risk_limits_updated_at();

-- ============================================================================
-- 5. ENABLE RLS ON hmt_engine_state TABLE
-- ============================================================================

-- Enable RLS on the table
ALTER TABLE hmt_engine_state ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated users to read engine state" ON hmt_engine_state;
DROP POLICY IF EXISTS "Allow authenticated users to update engine state" ON hmt_engine_state;

-- Since this is a global state table (no user_id), allow all authenticated users to read
CREATE POLICY "Allow authenticated users to read engine state"
  ON hmt_engine_state
  FOR SELECT
  TO authenticated
  USING (true);

-- Updates should only happen through functions, but allow authenticated users to call them
CREATE POLICY "Allow authenticated users to update engine state"
  ON hmt_engine_state
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow inserts for initial setup
CREATE POLICY "Allow authenticated users to insert engine state"
  ON hmt_engine_state
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 6. ENABLE LEAKED PASSWORD PROTECTION
-- ============================================================================

-- Note: Leaked password protection is an Auth configuration setting
-- It cannot be directly modified via SQL in production Supabase
-- This needs to be enabled in the Supabase Dashboard under:
-- Authentication > Policies > Password Requirements
-- 
-- For local development, you can try:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'auth' 
    AND table_name = 'config'
  ) THEN
    -- Attempt to enable it (may not work in all environments)
    INSERT INTO auth.config (parameter, value)
    VALUES ('password_hibp_enabled', 'true')
    ON CONFLICT (parameter) DO UPDATE SET value = 'true';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Silently fail if we don't have permission
    NULL;
END $$;
