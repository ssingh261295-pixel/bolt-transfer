/*
  # Optimize RLS Policies for Performance
  
  ## Changes
  
  1. Update all RLS policies on profiles table to use (select auth.uid())
     - This prevents re-evaluation of auth.uid() for each row
     - Significantly improves query performance at scale
     - auth.uid() is evaluated once per query instead of once per row
  
  2. Consolidate multiple permissive policies into single policies
     - Combines admin and user SELECT policies
     - Combines admin and user UPDATE policies
     - Reduces policy evaluation overhead
  
  ## Performance Notes
  - Using (select auth.uid()) allows PostgreSQL to cache the result
  - Consolidating policies reduces the number of policy checks per query
  - These changes are crucial for performance at scale
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Create optimized consolidated SELECT policy
CREATE POLICY "Users and admins can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    -- Users can view their own profile
    (select auth.uid()) = id
    OR
    -- Admins can view all profiles
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid())
      AND is_admin = true
    )
  );

-- Create optimized consolidated UPDATE policy
CREATE POLICY "Users and admins can update profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Users can update their own profile
    (select auth.uid()) = id
    OR
    -- Admins can update any profile
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid())
      AND is_admin = true
    )
  )
  WITH CHECK (
    -- Users can only update their own profile and cannot change admin/status fields
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

-- Create optimized INSERT policy
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = id
    AND is_admin = false
  );
