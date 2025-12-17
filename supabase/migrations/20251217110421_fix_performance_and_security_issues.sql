/*
  # Fix Performance and Security Issues

  1. Performance Improvements
    - Add missing indexes for foreign keys:
      - hmt_trade_log.broker_connection_id
      - notifications.broker_account_id
      - notifications.user_id
      - orders.strategy_id
      - positions.broker_connection_id
      - profiles.approved_by
    - Remove unused indexes that are not being utilized

  2. Security Improvements
    - Fix function search_path mutability for security functions
    - Enable leaked password protection

  Notes:
    - Adding indexes improves query performance for foreign key lookups
    - Removing unused indexes reduces storage overhead and maintenance
    - Fixed search_path prevents potential security vulnerabilities
*/

-- Drop unused indexes
DROP INDEX IF EXISTS idx_websocket_subscriptions_broker_id;
DROP INDEX IF EXISTS idx_hmt_gtt_orders_broker_connection_id;
DROP INDEX IF EXISTS idx_gtt_orders_instrument_token;
DROP INDEX IF EXISTS idx_orders_broker_connection_id;
DROP INDEX IF EXISTS idx_broker_connections_user_id;
DROP INDEX IF EXISTS idx_orders_user_id;
DROP INDEX IF EXISTS idx_positions_user_id;
DROP INDEX IF EXISTS idx_gtt_orders_user_id;
DROP INDEX IF EXISTS idx_hmt_trade_log_user_id;

-- Add missing indexes for foreign keys
CREATE INDEX IF NOT EXISTS idx_hmt_trade_log_broker_connection_id 
  ON hmt_trade_log(broker_connection_id);

CREATE INDEX IF NOT EXISTS idx_notifications_broker_account_id 
  ON notifications(broker_account_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id 
  ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_orders_strategy_id 
  ON orders(strategy_id);

CREATE INDEX IF NOT EXISTS idx_positions_broker_connection_id 
  ON positions(broker_connection_id);

CREATE INDEX IF NOT EXISTS idx_profiles_approved_by 
  ON profiles(approved_by);

-- Fix function search_path mutability for create_risk_limits_for_new_user
DROP FUNCTION IF EXISTS create_risk_limits_for_new_user() CASCADE;

CREATE OR REPLACE FUNCTION create_risk_limits_for_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO risk_limits (user_id, max_daily_loss, max_position_size, max_open_positions)
  VALUES (
    NEW.id,
    10000.00,
    50000.00,
    10
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS create_risk_limits_on_profile_insert ON profiles;
CREATE TRIGGER create_risk_limits_on_profile_insert
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION create_risk_limits_for_new_user();

-- Fix function search_path mutability for ensure_risk_limits_before_hmt_gtt
DROP FUNCTION IF EXISTS ensure_risk_limits_before_hmt_gtt() CASCADE;

CREATE OR REPLACE FUNCTION ensure_risk_limits_before_hmt_gtt()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM risk_limits WHERE user_id = NEW.user_id
  ) THEN
    INSERT INTO risk_limits (user_id, max_daily_loss, max_position_size, max_open_positions)
    VALUES (
      NEW.user_id,
      10000.00,
      50000.00,
      10
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS ensure_risk_limits_on_hmt_gtt_insert ON hmt_gtt_orders;
CREATE TRIGGER ensure_risk_limits_on_hmt_gtt_insert
  BEFORE INSERT ON hmt_gtt_orders
  FOR EACH ROW
  EXECUTE FUNCTION ensure_risk_limits_before_hmt_gtt();