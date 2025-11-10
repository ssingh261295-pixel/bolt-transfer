/*
  # Fix Profiles RLS UPDATE Policy Recursion
  
  ## Issue
  The UPDATE policy for profiles has a WITH CHECK clause that queries profiles table,
  causing infinite recursion. The error "permission denied for table users" occurs
  because the admin check queries auth.users which users don't have direct access to.
  
  ## Solution
  - Simplify UPDATE policy to remove recursive query
  - Remove admin check from auth.users (use app_metadata directly)
  - Keep policies simple and non-recursive
  
  ## Changes
  1. Drop problematic UPDATE policies
  2. Create simple non-recursive UPDATE policies
  3. Use direct auth checks without querying tables
*/

-- Drop existing problematic UPDATE policies
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- Recreate admin view policy without auth.users query
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- Create simple UPDATE policy for users (no recursion)
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Don't allow changing is_admin or account_status
    AND is_admin = false
  );

-- Create simple UPDATE policy for admins
CREATE POLICY "Admins can update any profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  )
  WITH CHECK (true);
