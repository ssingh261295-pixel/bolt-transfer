/*
  # Fix Security Issues - SQL Only
  
  1. Missing Foreign Key Indexes
    - Add index on gtt_orders.user_id
    - Add index on hmt_trade_log.hmt_order_id
    - Add index on hmt_trade_log.user_id
  
  2. RLS Optimization
    - Update notifications table policies to use (select auth.uid()) for better performance
  
  3. Remove Unused Indexes
    - Remove idx_hmt_trade_log_broker_connection_id
    - Remove idx_orders_strategy_id
    - Remove idx_positions_broker_connection_id
    - Remove idx_profiles_approved_by
    - Remove idx_strategies_webhook_key
    - Remove idx_notifications_broker_account_id
    - Remove idx_notifications_user_broker_created
    - Remove idx_notifications_user_id
    - Remove idx_notifications_created_at
    - Remove idx_notifications_is_read
    - Remove idx_notifications_user_unread
  
  4. Function Search Path
    - Fix generate_webhook_key function with stable search_path
  
  Note: Leaked password protection must be enabled via Supabase Dashboard:
  Authentication > Settings > Enable "Leaked Password Protection"
*/

-- =====================================================
-- 1. ADD MISSING FOREIGN KEY INDEXES
-- =====================================================

-- Index for gtt_orders.user_id
CREATE INDEX IF NOT EXISTS idx_gtt_orders_user_id 
ON gtt_orders(user_id);

-- Index for hmt_trade_log.hmt_order_id
CREATE INDEX IF NOT EXISTS idx_hmt_trade_log_hmt_order_id 
ON hmt_trade_log(hmt_order_id);

-- Index for hmt_trade_log.user_id  
CREATE INDEX IF NOT EXISTS idx_hmt_trade_log_user_id 
ON hmt_trade_log(user_id);

-- =====================================================
-- 2. OPTIMIZE RLS POLICIES FOR NOTIFICATIONS
-- =====================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;

-- Recreate with optimized auth function calls
CREATE POLICY "Users can view own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Users can update own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- =====================================================
-- 3. REMOVE UNUSED INDEXES
-- =====================================================

-- Drop all unused indexes identified by Supabase advisor
DROP INDEX IF EXISTS idx_hmt_trade_log_broker_connection_id;
DROP INDEX IF EXISTS idx_orders_strategy_id;
DROP INDEX IF EXISTS idx_positions_broker_connection_id;
DROP INDEX IF EXISTS idx_profiles_approved_by;
DROP INDEX IF EXISTS idx_strategies_webhook_key;
DROP INDEX IF EXISTS idx_notifications_broker_account_id;
DROP INDEX IF EXISTS idx_notifications_user_broker_created;
DROP INDEX IF EXISTS idx_notifications_user_id;
DROP INDEX IF EXISTS idx_notifications_created_at;
DROP INDEX IF EXISTS idx_notifications_is_read;
DROP INDEX IF EXISTS idx_notifications_user_unread;

-- =====================================================
-- 4. FIX FUNCTION SEARCH PATH MUTABILITY
-- =====================================================

-- Recreate generate_webhook_key with stable search_path
CREATE OR REPLACE FUNCTION generate_webhook_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_key text;
  key_exists boolean;
BEGIN
  LOOP
    -- Generate a random 32-character key
    new_key := encode(gen_random_bytes(24), 'base64');
    new_key := replace(new_key, '/', '_');
    new_key := replace(new_key, '+', '-');
    new_key := substring(new_key, 1, 32);
    
    -- Check if key already exists
    SELECT EXISTS(SELECT 1 FROM strategies WHERE webhook_key = new_key) INTO key_exists;
    
    EXIT WHEN NOT key_exists;
  END LOOP;
  
  RETURN new_key;
END;
$$;