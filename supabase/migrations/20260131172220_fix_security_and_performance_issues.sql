/*
  # Fix Security and Performance Issues

  1. Add Missing Indexes for Foreign Keys
    - Add index on hmt_trade_log.user_id
    - Add index on nfo_symbol_settings.broker_connection_id
    - Add index on websocket_subscriptions.broker_connection_id

  2. Fix RLS Policy Performance Issue
    - Update tradingview_webhook_logs RLS policy to use (select auth.uid())

  3. Fix Function Search Path Mutability
    - Set search_path for get_default_signal_filters function

  4. Remove Unused Indexes
    - Remove truly redundant indexes
*/

-- =====================================================
-- 1. Add Missing Indexes for Foreign Keys
-- =====================================================

-- Index for hmt_trade_log.user_id foreign key
CREATE INDEX IF NOT EXISTS idx_hmt_trade_log_user_id 
  ON hmt_trade_log(user_id);

-- Index for nfo_symbol_settings.broker_connection_id foreign key
CREATE INDEX IF NOT EXISTS idx_nfo_symbol_settings_broker_connection_id 
  ON nfo_symbol_settings(broker_connection_id);

-- Index for websocket_subscriptions.broker_connection_id foreign key
CREATE INDEX IF NOT EXISTS idx_websocket_subscriptions_broker_connection_id 
  ON websocket_subscriptions(broker_connection_id);

-- =====================================================
-- 2. Fix RLS Policy Performance Issue
-- =====================================================

-- Drop and recreate the problematic RLS policy with optimized query
DROP POLICY IF EXISTS "Users can delete own webhook logs" ON tradingview_webhook_logs;

CREATE POLICY "Users can delete own webhook logs"
  ON tradingview_webhook_logs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM webhook_keys
      WHERE webhook_keys.id = tradingview_webhook_logs.webhook_key_id
      AND webhook_keys.user_id = (SELECT auth.uid())
    )
  );

-- =====================================================
-- 3. Fix Function Search Path Mutability
-- =====================================================

-- Recreate function with secure search_path
CREATE OR REPLACE FUNCTION get_default_signal_filters()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT '{
    "symbols": {
      "mode": "whitelist",
      "list": []
    },
    "trade_types": {
      "allow_buy": true,
      "allow_sell": true
    },
    "time_filters": {
      "enabled": false,
      "start_time": "09:15",
      "end_time": "15:15",
      "timezone": "Asia/Kolkata"
    },
    "trade_grade": {
      "enabled": false,
      "min_grade": "C"
    },
    "trade_score": {
      "enabled": false,
      "min_score": 5.0
    },
    "entry_phase": {
      "enabled": false,
      "allowed_phases": ["EARLY", "OPTIMAL", "LATE"]
    },
    "adx": {
      "enabled": false,
      "min_value": 0,
      "max_value": 100
    },
    "volume": {
      "enabled": false,
      "min_avg_volume_5d": 0
    },
    "price_range": {
      "enabled": false,
      "min_price": 0,
      "max_price": 1000000
    }
  }'::jsonb;
$$;

-- =====================================================
-- 4. Remove Unused Indexes
-- =====================================================

-- Remove idx_profiles_approved_by if confirmed unused
DROP INDEX IF EXISTS idx_profiles_approved_by;

-- =====================================================
-- Performance Optimizations
-- =====================================================

-- Analyze tables to update statistics after index creation
ANALYZE hmt_trade_log;
ANALYZE nfo_symbol_settings;
ANALYZE websocket_subscriptions;
ANALYZE tradingview_webhook_logs;
ANALYZE broker_connections;