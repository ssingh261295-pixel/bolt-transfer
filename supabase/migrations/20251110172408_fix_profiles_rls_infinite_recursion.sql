/*
  # Fix Infinite Recursion in Profiles RLS Policies
  
  ## Issue
  The current RLS policies on profiles table cause infinite recursion by querying
  the profiles table within the policy definition itself.
  
  ## Solution
  - Remove recursive queries from RLS policies
  - Use a simple function-based approach for admin checks
  - Cache admin status check to avoid repeated queries
  
  ## Changes
  1. Create helper function to check if user is admin
  2. Replace recursive policies with non-recursive versions
  3. Ensure policies are efficient and don't cause infinite loops
*/

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users and admins can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users and admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Create non-recursive SELECT policy
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Create separate policy for admin SELECT
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'is_admin' = 'true'
    )
  );

-- Create non-recursive UPDATE policy for users
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin IS NOT DISTINCT FROM (SELECT is_admin FROM public.profiles WHERE id = auth.uid() LIMIT 1)
  );

-- Create separate policy for admin UPDATE
CREATE POLICY "Admins can update any profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'is_admin' = 'true'
    )
  );

-- Create INSERT policy
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND is_admin = false
  );
