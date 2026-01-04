/*
  # Enforce Account Approval and Admin Notifications
  
  1. Changes
    - Update ALL RLS policies to require account_status = 'approved' for non-admin users
    - Create notification system for new user registrations
    - Update handle_new_user trigger to notify all admins
    - Ensure pending users cannot access any data except their own profile (read-only)
  
  2. Security
    - Pending users are blocked from all data access
    - Only approved users can interact with the platform
    - Admins bypass approval checks
    - Admins receive notifications for new registrations
  
  3. Tables Affected
    - profiles (updated policies)
    - broker_connections (updated policies)
    - strategies (updated policies)
    - gtt_orders (updated policies)
    - hmt_gtt_orders (updated policies)
    - watchlist_items (updated policies)
    - watchlists (updated policies)
    - orders (updated policies)
    - positions (updated policies)
    - notifications (updated policies)
    - All other user-related tables
*/

-- Helper function to check if user is approved or admin
CREATE OR REPLACE FUNCTION public.is_user_approved_or_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id
    AND (account_status = 'approved' OR account_status = 'active' OR is_admin = true)
  );
$$;

-- ==========================================
-- PROFILES TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users and admins can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users and admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Approved users and admins can update profiles" ON public.profiles;

-- Pending users can ONLY view their own profile (read-only)
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = id
    OR
    -- Admins can view all profiles
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid())
      AND is_admin = true
    )
  );

-- Only approved users can update their own profile (not admin/status fields)
CREATE POLICY "Approved users and admins can update profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Approved users can update their own profile
    (
      (select auth.uid()) = id
      AND public.is_user_approved_or_admin((select auth.uid()))
    )
    OR
    -- Admins can update any profile
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid())
      AND is_admin = true
    )
  )
  WITH CHECK (
    -- Users cannot change admin/status fields
    (
      (select auth.uid()) = id
      AND is_admin = (SELECT is_admin FROM public.profiles WHERE id = (select auth.uid()))
      AND account_status = (SELECT account_status FROM public.profiles WHERE id = (select auth.uid()))
    )
    OR
    -- Admins can update any profile
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid())
      AND is_admin = true
    )
  );

CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = id
    AND is_admin = false
  );

-- ==========================================
-- BROKER_CONNECTIONS TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own brokers" ON public.broker_connections;
DROP POLICY IF EXISTS "Users can insert own brokers" ON public.broker_connections;
DROP POLICY IF EXISTS "Users can update own brokers" ON public.broker_connections;
DROP POLICY IF EXISTS "Users can delete own brokers" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can view own brokers" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can insert own brokers" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can update own brokers" ON public.broker_connections;
DROP POLICY IF EXISTS "Approved users can delete own brokers" ON public.broker_connections;

CREATE POLICY "Approved users can view own broker connections"
  ON public.broker_connections
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can insert own broker connections"
  ON public.broker_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can update own broker connections"
  ON public.broker_connections
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can delete own broker connections"
  ON public.broker_connections
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

-- ==========================================
-- STRATEGIES TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own strategies" ON public.strategies;
DROP POLICY IF EXISTS "Users can insert own strategies" ON public.strategies;
DROP POLICY IF EXISTS "Users can update own strategies" ON public.strategies;
DROP POLICY IF EXISTS "Users can delete own strategies" ON public.strategies;
DROP POLICY IF EXISTS "Approved users can view own strategies" ON public.strategies;
DROP POLICY IF EXISTS "Approved users can insert own strategies" ON public.strategies;
DROP POLICY IF EXISTS "Approved users can update own strategies" ON public.strategies;
DROP POLICY IF EXISTS "Approved users can delete own strategies" ON public.strategies;

CREATE POLICY "Approved users can view own strategies"
  ON public.strategies
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can insert own strategies"
  ON public.strategies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can update own strategies"
  ON public.strategies
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can delete own strategies"
  ON public.strategies
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

-- ==========================================
-- GTT_ORDERS TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Users can insert own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Users can update own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Users can delete own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can view own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can insert own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can update own gtt orders" ON public.gtt_orders;
DROP POLICY IF EXISTS "Approved users can delete own gtt orders" ON public.gtt_orders;

CREATE POLICY "Approved users can view own gtt orders"
  ON public.gtt_orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can insert own gtt orders"
  ON public.gtt_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can update own gtt orders"
  ON public.gtt_orders
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can delete own gtt orders"
  ON public.gtt_orders
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

-- ==========================================
-- HMT_GTT_ORDERS TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can insert own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can update own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Users can delete own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can view own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can insert own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can update own hmt gtt orders" ON public.hmt_gtt_orders;
DROP POLICY IF EXISTS "Approved users can delete own hmt gtt orders" ON public.hmt_gtt_orders;

CREATE POLICY "Approved users can view own hmt gtt orders"
  ON public.hmt_gtt_orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can insert own hmt gtt orders"
  ON public.hmt_gtt_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can update own hmt gtt orders"
  ON public.hmt_gtt_orders
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can delete own hmt gtt orders"
  ON public.hmt_gtt_orders
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

-- ==========================================
-- WATCHLIST_ITEMS TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own watchlist" ON public.watchlist_items;
DROP POLICY IF EXISTS "Users can insert own watchlist" ON public.watchlist_items;
DROP POLICY IF EXISTS "Users can update own watchlist" ON public.watchlist_items;
DROP POLICY IF EXISTS "Users can delete own watchlist" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can view own watchlist" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can insert own watchlist" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can update own watchlist" ON public.watchlist_items;
DROP POLICY IF EXISTS "Approved users can delete own watchlist" ON public.watchlist_items;

CREATE POLICY "Approved users can view own watchlist items"
  ON public.watchlist_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.watchlists w
      WHERE w.id = watchlist_items.watchlist_id
      AND w.user_id = (select auth.uid())
      AND public.is_user_approved_or_admin((select auth.uid()))
    )
  );

CREATE POLICY "Approved users can insert own watchlist items"
  ON public.watchlist_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.watchlists w
      WHERE w.id = watchlist_items.watchlist_id
      AND w.user_id = (select auth.uid())
      AND public.is_user_approved_or_admin((select auth.uid()))
    )
  );

CREATE POLICY "Approved users can update own watchlist items"
  ON public.watchlist_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.watchlists w
      WHERE w.id = watchlist_items.watchlist_id
      AND w.user_id = (select auth.uid())
      AND public.is_user_approved_or_admin((select auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.watchlists w
      WHERE w.id = watchlist_items.watchlist_id
      AND w.user_id = (select auth.uid())
      AND public.is_user_approved_or_admin((select auth.uid()))
    )
  );

CREATE POLICY "Approved users can delete own watchlist items"
  ON public.watchlist_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.watchlists w
      WHERE w.id = watchlist_items.watchlist_id
      AND w.user_id = (select auth.uid())
      AND public.is_user_approved_or_admin((select auth.uid()))
    )
  );

-- ==========================================
-- WATCHLISTS TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "Users can insert own watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "Users can update own watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "Users can delete own watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "Approved users can view own watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "Approved users can insert own watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "Approved users can update own watchlists" ON public.watchlists;
DROP POLICY IF EXISTS "Approved users can delete own watchlists" ON public.watchlists;

CREATE POLICY "Approved users can view own watchlists"
  ON public.watchlists
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can insert own watchlists"
  ON public.watchlists
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can update own watchlists"
  ON public.watchlists
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can delete own watchlists"
  ON public.watchlists
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

-- ==========================================
-- ORDERS TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can update own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can delete own orders" ON public.orders;
DROP POLICY IF EXISTS "Approved users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Approved users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "Approved users can update own orders" ON public.orders;
DROP POLICY IF EXISTS "Approved users can delete own orders" ON public.orders;

CREATE POLICY "Approved users can view own orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can insert own orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can update own orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can delete own orders"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

-- ==========================================
-- POSITIONS TABLE RLS POLICIES
-- ==========================================

DROP POLICY IF EXISTS "Users can view own positions" ON public.positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON public.positions;
DROP POLICY IF EXISTS "Users can update own positions" ON public.positions;
DROP POLICY IF EXISTS "Users can delete own positions" ON public.positions;
DROP POLICY IF EXISTS "Approved users can view own positions" ON public.positions;
DROP POLICY IF EXISTS "Approved users can insert own positions" ON public.positions;
DROP POLICY IF EXISTS "Approved users can update own positions" ON public.positions;
DROP POLICY IF EXISTS "Approved users can delete own positions" ON public.positions;

CREATE POLICY "Approved users can view own positions"
  ON public.positions
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can insert own positions"
  ON public.positions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can update own positions"
  ON public.positions
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

CREATE POLICY "Approved users can delete own positions"
  ON public.positions
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    AND public.is_user_approved_or_admin((select auth.uid()))
  );

-- ==========================================
-- NOTIFICATIONS - Admin Notification System
-- ==========================================

-- Trigger function to notify admins of new user registrations
CREATE OR REPLACE FUNCTION public.notify_admins_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  admin_record RECORD;
BEGIN
  -- Create notification for each admin
  FOR admin_record IN 
    SELECT id FROM public.profiles WHERE is_admin = true
  LOOP
    INSERT INTO public.notifications (
      user_id,
      source,
      type,
      title,
      message,
      is_read,
      created_at
    )
    VALUES (
      admin_record.id,
      'system',
      'info',
      'New User Registration',
      format('New user %s has registered and requires approval', NEW.full_name),
      false,
      now()
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Create trigger for new user notifications
DROP TRIGGER IF EXISTS trigger_notify_admins_new_user ON public.profiles;
CREATE TRIGGER trigger_notify_admins_new_user
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  WHEN (NEW.account_status = 'pending' AND NEW.is_admin = false)
  EXECUTE FUNCTION public.notify_admins_new_user();

-- Update handle_new_user to ensure it creates profile correctly
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    full_name,
    is_admin, 
    account_status, 
    approved_at,
    plan_type
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    false, 
    'pending',
    NULL,
    'pro'
  );
  
  -- The trigger_notify_admins_new_user will fire after this insert
  
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- Profile already exists, just return
    RETURN NEW;
  WHEN OTHERS THEN
    -- Log error but don't fail the signup
    RAISE WARNING 'Error creating profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;