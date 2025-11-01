/*
  # Fix Security and Performance Issues

  1. Add Missing Foreign Key Indexes
    - Add index on `orders.broker_connection_id`
    - Add index on `orders.strategy_id`
    - Add index on `positions.broker_connection_id`

  2. Optimize RLS Policies
    - Update all RLS policies to use `(select auth.uid())` instead of `auth.uid()`
    - This prevents re-evaluation of auth functions for each row

  3. Remove Unused Indexes
    - Drop `idx_orders_status` (unused)
    - Drop `idx_portfolio_history_user_id_date` (unused)
    - Drop `idx_gtt_orders_user_id` (unused)
    - Drop `idx_gtt_orders_status` (unused)
*/

-- Add missing foreign key indexes
CREATE INDEX IF NOT EXISTS idx_orders_broker_connection_id ON orders(broker_connection_id);
CREATE INDEX IF NOT EXISTS idx_orders_strategy_id ON orders(strategy_id);
CREATE INDEX IF NOT EXISTS idx_positions_broker_connection_id ON positions(broker_connection_id);

-- Drop unused indexes
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_portfolio_history_user_id_date;
DROP INDEX IF EXISTS idx_gtt_orders_user_id;
DROP INDEX IF EXISTS idx_gtt_orders_status;

-- Optimize RLS policies for profiles table
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- Optimize RLS policies for broker_connections table
DROP POLICY IF EXISTS "Users can view own broker connections" ON broker_connections;
DROP POLICY IF EXISTS "Users can insert own broker connections" ON broker_connections;
DROP POLICY IF EXISTS "Users can update own broker connections" ON broker_connections;
DROP POLICY IF EXISTS "Users can delete own broker connections" ON broker_connections;

CREATE POLICY "Users can view own broker connections"
  ON broker_connections FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own broker connections"
  ON broker_connections FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own broker connections"
  ON broker_connections FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own broker connections"
  ON broker_connections FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- Optimize RLS policies for strategies table
DROP POLICY IF EXISTS "Users can view own strategies" ON strategies;
DROP POLICY IF EXISTS "Users can insert own strategies" ON strategies;
DROP POLICY IF EXISTS "Users can update own strategies" ON strategies;
DROP POLICY IF EXISTS "Users can delete own strategies" ON strategies;

CREATE POLICY "Users can view own strategies"
  ON strategies FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own strategies"
  ON strategies FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own strategies"
  ON strategies FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own strategies"
  ON strategies FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- Optimize RLS policies for orders table
DROP POLICY IF EXISTS "Users can view own orders" ON orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON orders;
DROP POLICY IF EXISTS "Users can update own orders" ON orders;

CREATE POLICY "Users can view own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = orders.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can insert own orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = orders.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can update own orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = orders.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = orders.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  );

-- Optimize RLS policies for positions table
DROP POLICY IF EXISTS "Users can view own positions" ON positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON positions;
DROP POLICY IF EXISTS "Users can update own positions" ON positions;
DROP POLICY IF EXISTS "Users can delete own positions" ON positions;

CREATE POLICY "Users can view own positions"
  ON positions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = positions.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can insert own positions"
  ON positions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = positions.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can update own positions"
  ON positions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = positions.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = positions.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can delete own positions"
  ON positions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM broker_connections
      WHERE broker_connections.id = positions.broker_connection_id
      AND broker_connections.user_id = (select auth.uid())
    )
  );

-- Optimize RLS policies for portfolio_history table
DROP POLICY IF EXISTS "Users can view own portfolio history" ON portfolio_history;
DROP POLICY IF EXISTS "Users can insert own portfolio history" ON portfolio_history;

CREATE POLICY "Users can view own portfolio history"
  ON portfolio_history FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own portfolio history"
  ON portfolio_history FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- Optimize RLS policies for watchlists table
DROP POLICY IF EXISTS "Users can view own watchlists" ON watchlists;
DROP POLICY IF EXISTS "Users can insert own watchlists" ON watchlists;
DROP POLICY IF EXISTS "Users can update own watchlists" ON watchlists;
DROP POLICY IF EXISTS "Users can delete own watchlists" ON watchlists;

CREATE POLICY "Users can view own watchlists"
  ON watchlists FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own watchlists"
  ON watchlists FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own watchlists"
  ON watchlists FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own watchlists"
  ON watchlists FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- Optimize RLS policies for gtt_orders table
DROP POLICY IF EXISTS "Users can view own GTT orders" ON gtt_orders;
DROP POLICY IF EXISTS "Users can create own GTT orders" ON gtt_orders;
DROP POLICY IF EXISTS "Users can update own GTT orders" ON gtt_orders;
DROP POLICY IF EXISTS "Users can delete own GTT orders" ON gtt_orders;

CREATE POLICY "Users can view own GTT orders"
  ON gtt_orders FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create own GTT orders"
  ON gtt_orders FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own GTT orders"
  ON gtt_orders FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own GTT orders"
  ON gtt_orders FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);
