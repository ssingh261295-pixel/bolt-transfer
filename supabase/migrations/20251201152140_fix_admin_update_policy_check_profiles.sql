/*
  # Fix Admin Update Policy to Check Profiles Table

  1. Issue
    - Current policy checks auth.jwt()->>'is_admin' but is_admin is not in JWT
    - is_admin is only stored in profiles table
    - This causes admin update operations to fail

  2. Solution
    - Update policy to check profiles table directly
    - Use subquery to check if current user is admin
    - Avoid recursion by using simple EXISTS check

  3. Changes
    - Drop existing admin update policies
    - Create new policy that checks profiles.is_admin correctly
*/

-- Drop existing admin policies
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- Recreate admin view policy
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS admin_check
      WHERE admin_check.id = auth.uid()
      AND admin_check.is_admin = true
    )
    OR id = auth.uid()
  );

-- Create admin UPDATE policy that checks profiles table
CREATE POLICY "Admins can update any profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS admin_check
      WHERE admin_check.id = auth.uid()
      AND admin_check.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS admin_check
      WHERE admin_check.id = auth.uid()
      AND admin_check.is_admin = true
    )
  );
