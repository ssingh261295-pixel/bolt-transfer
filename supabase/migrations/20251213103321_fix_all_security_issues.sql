/*
  # Fix All Security Issues

  1. Performance & Security Issues
    - Add missing index for gtt_orders.user_id foreign key
    - Optimize RLS policies to use (select auth.uid()) instead of auth.uid()
    - Remove unused indexes that slow down write operations
    - Fix multiple permissive policies on profiles table
    - Fix function search path for security

  2. Tables Affected
    - gtt_orders
    - profiles
    - websocket_subscriptions
    - watchlist_items
    - hmt_gtt_orders

  3. Security Notes
    - Using (select auth.uid()) prevents re-evaluation for each row
    - Removing unused indexes improves write performance
    - Consolidating policies reduces policy evaluation overhead
    - Setting search_path prevents search_path injection attacks
*/

-- =====================================================
-- 1. Add missing index for gtt_orders.user_id
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_gtt_orders_user_id ON gtt_orders(user_id);

-- =====================================================
-- 2. Remove unused indexes
-- =====================================================
DROP INDEX IF EXISTS idx_websocket_subscriptions_user_id;
DROP INDEX IF EXISTS idx_websocket_subscriptions_instrument_token;
DROP INDEX IF EXISTS idx_hmt_gtt_orders_user_id;
DROP INDEX IF EXISTS idx_hmt_gtt_orders_status;
DROP INDEX IF EXISTS idx_hmt_gtt_orders_instrument_token;
DROP INDEX IF EXISTS idx_orders_strategy_id;
DROP INDEX IF EXISTS idx_positions_broker_connection_id;
DROP INDEX IF EXISTS idx_profiles_approved_by;
DROP INDEX IF EXISTS idx_hmt_gtt_orders_created_at;
DROP INDEX IF EXISTS idx_positions_instrument_token;
DROP INDEX IF EXISTS idx_watchlist_items_watchlist_id;

-- =====================================================
-- 3. Fix function search path for security
-- =====================================================
CREATE OR REPLACE FUNCTION update_hmt_gtt_orders_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- 4. Fix profiles RLS policies (consolidate and optimize)
-- =====================================================

-- Drop existing UPDATE policies on profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;

-- Create consolidated UPDATE policy with optimized auth check
CREATE POLICY "Users can update own profile or admins can update any"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id OR is_admin_user())
  WITH CHECK ((select auth.uid()) = id OR is_admin_user());

-- Drop and recreate SELECT policy with optimized auth check
DROP POLICY IF EXISTS "Users can view own profile or admins can view all" ON public.profiles;

CREATE POLICY "Users can view own profile or admins can view all"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id OR is_admin_user());

-- Drop and recreate INSERT policy with optimized auth check
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- =====================================================
-- 5. Fix websocket_subscriptions RLS policies
-- =====================================================

DROP POLICY IF EXISTS "Users can view own subscriptions" ON websocket_subscriptions;
DROP POLICY IF EXISTS "Users can create own subscriptions" ON websocket_subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON websocket_subscriptions;
DROP POLICY IF EXISTS "Users can delete own subscriptions" ON websocket_subscriptions;

CREATE POLICY "Users can view own subscriptions"
  ON websocket_subscriptions FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create own subscriptions"
  ON websocket_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON websocket_subscriptions FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own subscriptions"
  ON websocket_subscriptions FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- =====================================================
-- 6. Fix watchlist_items RLS policies
-- =====================================================

DROP POLICY IF EXISTS "Users can view own watchlist items" ON watchlist_items;
DROP POLICY IF EXISTS "Users can insert own watchlist items" ON watchlist_items;
DROP POLICY IF EXISTS "Users can update own watchlist items" ON watchlist_items;
DROP POLICY IF EXISTS "Users can delete own watchlist items" ON watchlist_items;

CREATE POLICY "Users can view own watchlist items"
  ON watchlist_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can insert own watchlist items"
  ON watchlist_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can update own watchlist items"
  ON watchlist_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can delete own watchlist items"
  ON watchlist_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = (select auth.uid())
    )
  );

-- =====================================================
-- 7. Fix hmt_gtt_orders RLS policies
-- =====================================================

DROP POLICY IF EXISTS "Users can view own HMT GTT orders" ON hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can create own HMT GTT orders" ON hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can update own HMT GTT orders" ON hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can delete own HMT GTT orders" ON hmt_gtt_orders;

CREATE POLICY "Users can view own HMT GTT orders"
  ON hmt_gtt_orders FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create own HMT GTT orders"
  ON hmt_gtt_orders FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own HMT GTT orders"
  ON hmt_gtt_orders FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own HMT GTT orders"
  ON hmt_gtt_orders FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- =====================================================
-- 8. Enable leaked password protection (documentation)
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'IMPORTANT: Enable Leaked Password Protection';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'This migration has fixed all database-level security issues.';
  RAISE NOTICE '';
  RAISE NOTICE 'However, you must MANUALLY enable leaked password protection:';
  RAISE NOTICE '1. Go to Supabase Dashboard';
  RAISE NOTICE '2. Navigate to: Authentication > Providers > Email';
  RAISE NOTICE '3. Enable "Check for breached passwords"';
  RAISE NOTICE '';
  RAISE NOTICE 'This will prevent users from using compromised passwords.';
  RAISE NOTICE '========================================';
END $$;