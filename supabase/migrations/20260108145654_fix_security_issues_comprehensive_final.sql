/*
  # Fix Comprehensive Security Issues - Final
  
  This migration addresses multiple security and performance issues:
  
  1. Unindexed Foreign Keys
     - Add indexes for 6 foreign key columns to improve query performance
     - Tables: dashboard_metrics_cache, hmt_trade_log, notifications, orders, profiles
  
  2. Auth RLS Initialization Plan Issues
     - Fix 6 RLS policies to use `(select auth.uid())` instead of `auth.uid()`
     - Prevents re-evaluation of auth functions for each row
     - Tables: profiles (3 policies), risk_limits (3 policies)
  
  3. Unused Indexes
     - Remove 7 unused indexes to reduce storage overhead
     - Tables: nfo_symbol_settings, webhook_execution_tracker, hmt_trade_log, websocket_subscriptions
  
  4. Multiple Permissive Policies
     - Consolidate 20 duplicate policies into single policies
     - Tables: broker_connections, gtt_orders, hmt_gtt_orders, watchlist_items
  
  5. RLS Policy Always True Issues
     - Fix 3 policies with overly permissive checks
     - Tables: hmt_engine_state (singleton global state - restrict to admins only), notifications
*/

-- =====================================================
-- 1. ADD MISSING INDEXES FOR FOREIGN KEYS
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_cache_broker_connection_id 
  ON public.dashboard_metrics_cache(broker_connection_id);

CREATE INDEX IF NOT EXISTS idx_hmt_trade_log_broker_connection_id 
  ON public.hmt_trade_log(broker_connection_id);

CREATE INDEX IF NOT EXISTS idx_notifications_broker_account_id 
  ON public.notifications(broker_account_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id 
  ON public.notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_orders_strategy_id 
  ON public.orders(strategy_id);

CREATE INDEX IF NOT EXISTS idx_profiles_approved_by 
  ON public.profiles(approved_by);

-- =====================================================
-- 2. REMOVE UNUSED INDEXES
-- =====================================================

DROP INDEX IF EXISTS public.idx_nfo_symbol_settings_user_id;
DROP INDEX IF EXISTS public.idx_nfo_symbol_settings_symbol;
DROP INDEX IF EXISTS public.idx_nfo_symbol_settings_broker;
DROP INDEX IF EXISTS public.idx_webhook_execution_tracker_date;
DROP INDEX IF EXISTS public.idx_webhook_execution_tracker_hash;
DROP INDEX IF EXISTS public.idx_hmt_trade_log_user_id;
DROP INDEX IF EXISTS public.idx_websocket_subscriptions_broker_connection_id;

-- =====================================================
-- 3. FIX AUTH RLS INITIALIZATION ISSUES - PROFILES TABLE
-- =====================================================

DROP POLICY IF EXISTS "Users can read own profile or admins read all" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile or admins update all" ON public.profiles;
DROP POLICY IF EXISTS "System can insert profiles" ON public.profiles;

CREATE POLICY "Users can read own profile or admins read all"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid()) 
    OR is_admin_user()
  );

CREATE POLICY "Users can update own profile or admins update all"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = (SELECT auth.uid()) 
    OR is_admin_user()
  )
  WITH CHECK (
    id = (SELECT auth.uid()) 
    OR is_admin_user()
  );

CREATE POLICY "System can insert profiles"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

-- =====================================================
-- 4. FIX AUTH RLS INITIALIZATION ISSUES - RISK_LIMITS TABLE
-- =====================================================

DROP POLICY IF EXISTS "Users can read own risk limits" ON public.risk_limits;
DROP POLICY IF EXISTS "Users can update own risk limits" ON public.risk_limits;
DROP POLICY IF EXISTS "Users can insert own risk limits" ON public.risk_limits;

CREATE POLICY "Users can read own risk limits"
  ON public.risk_limits
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own risk limits"
  ON public.risk_limits
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own risk limits"
  ON public.risk_limits
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- =====================================================
-- 5. CONSOLIDATE MULTIPLE PERMISSIVE POLICIES - BROKER_CONNECTIONS
-- =====================================================

DROP POLICY IF EXISTS "Users can view own broker connections" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can view own broker connections" ON public.broker_connections;
DROP POLICY IF EXISTS "Users can insert own broker connections" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can insert own broker connections" ON public.broker_connections;
DROP POLICY IF EXISTS "Users can update own broker connections" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can update own broker connections" ON public.broker_connections;
DROP POLICY IF EXISTS "Users can delete own broker connections" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can delete own broker connections" ON public.broker_connections;

CREATE POLICY "Users can view own broker connections"
  ON public.broker_connections
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can insert own broker connections"
  ON public.broker_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can update own broker connections"
  ON public.broker_connections
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can delete own broker connections"
  ON public.broker_connections
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

-- =====================================================
-- 6. CONSOLIDATE MULTIPLE PERMISSIVE POLICIES - GTT_ORDERS
-- =====================================================

DROP POLICY IF EXISTS "Users can view own GTT orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can view own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Users can create own GTT orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can insert own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Users can update own GTT orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can update own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Users can delete own GTT orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can delete own gtt orders" ON public.gtt_orders;

CREATE POLICY "Users can view own GTT orders"
  ON public.gtt_orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can create own GTT orders"
  ON public.gtt_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can update own GTT orders"
  ON public.gtt_orders
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can delete own GTT orders"
  ON public.gtt_orders
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

-- =====================================================
-- 7. CONSOLIDATE MULTIPLE PERMISSIVE POLICIES - HMT_GTT_ORDERS
-- =====================================================

DROP POLICY IF EXISTS "Users can view own HMT GTT orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can view own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can create own HMT GTT orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can insert own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can update own HMT GTT orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can update own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can delete own HMT GTT orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can delete own hmt gtt orders" ON public.hmt_gtt_orders;

CREATE POLICY "Users can view own HMT GTT orders"
  ON public.hmt_gtt_orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can create own HMT GTT orders"
  ON public.hmt_gtt_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can update own HMT GTT orders"
  ON public.hmt_gtt_orders
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

CREATE POLICY "Users can delete own HMT GTT orders"
  ON public.hmt_gtt_orders
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_user_approved_or_admin((SELECT auth.uid()))
  );

-- =====================================================
-- 8. CONSOLIDATE MULTIPLE PERMISSIVE POLICIES - WATCHLIST_ITEMS
-- =====================================================

DROP POLICY IF EXISTS "Users can view own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can view own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Users can insert own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can insert own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Users can update own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can update own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Users can delete own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can delete own watchlist items" ON public.watchlist_items;

CREATE POLICY "Users can view own watchlist items"
  ON public.watchlist_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND watchlists.user_id = (SELECT auth.uid())
        AND is_user_approved_or_admin((SELECT auth.uid()))
    )
  );

CREATE POLICY "Users can insert own watchlist items"
  ON public.watchlist_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND watchlists.user_id = (SELECT auth.uid())
        AND is_user_approved_or_admin((SELECT auth.uid()))
    )
  );

CREATE POLICY "Users can update own watchlist items"
  ON public.watchlist_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND watchlists.user_id = (SELECT auth.uid())
        AND is_user_approved_or_admin((SELECT auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND watchlists.user_id = (SELECT auth.uid())
        AND is_user_approved_or_admin((SELECT auth.uid()))
    )
  );

CREATE POLICY "Users can delete own watchlist items"
  ON public.watchlist_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND watchlists.user_id = (SELECT auth.uid())
        AND is_user_approved_or_admin((SELECT auth.uid()))
    )
  );

-- =====================================================
-- 9. FIX RLS POLICY ALWAYS TRUE - HMT_ENGINE_STATE
-- =====================================================

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Allow authenticated users to insert engine state" ON public.hmt_engine_state;
DROP POLICY IF EXISTS "Allow authenticated users to update engine state" ON public.hmt_engine_state;

-- hmt_engine_state is a singleton global state table
-- Only admins should be able to modify it
CREATE POLICY "Only admins can insert engine state"
  ON public.hmt_engine_state
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_user());

CREATE POLICY "Only admins can update engine state"
  ON public.hmt_engine_state
  FOR UPDATE
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- =====================================================
-- 10. FIX RLS POLICY ALWAYS TRUE - NOTIFICATIONS
-- =====================================================

-- Drop overly permissive policy
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;

-- Only allow inserting notifications for existing users
CREATE POLICY "System can insert notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = notifications.user_id
    )
  );
