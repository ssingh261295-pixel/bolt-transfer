/*
  # Fix RLS Infinite Recursion and Remove Duplicate Policies

  1. Problem
    - Multiple duplicate RLS policies on profiles and risk_limits tables
    - Infinite recursion in profiles SELECT policy due to subquery checking is_admin
    - Frontend cannot read user profile data, causing:
      - Admin Panel menu item not showing
      - Risk limits not loading
  
  2. Solution
    - Drop all existing conflicting policies
    - Create clean, non-recursive policies using helper function
    - Ensure single responsibility for each policy
  
  3. Changes
    - Remove duplicate SELECT policies on profiles
    - Remove duplicate UPDATE policies on profiles
    - Fix infinite recursion by using is_admin_user() function
    - Keep policies simple and non-recursive
*/

-- Drop all existing policies on profiles
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile or admins can view all" ON profiles;
DROP POLICY IF EXISTS "Approved users and admins can update profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile or admins can update any" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Drop all existing policies on risk_limits
DROP POLICY IF EXISTS "Users can view own risk limits" ON risk_limits;
DROP POLICY IF EXISTS "Users can update own risk limits" ON risk_limits;

-- Create simple, non-recursive policies for profiles
CREATE POLICY "Users can read own profile or admins read all"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id 
    OR is_admin_user()
  );

CREATE POLICY "Users can update own profile or admins update all"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id 
    OR is_admin_user()
  )
  WITH CHECK (
    auth.uid() = id 
    OR is_admin_user()
  );

CREATE POLICY "System can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Create simple policies for risk_limits
CREATE POLICY "Users can read own risk limits"
  ON risk_limits FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own risk limits"
  ON risk_limits FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can insert own risk limits"
  ON risk_limits FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
