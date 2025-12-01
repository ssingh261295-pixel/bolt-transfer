/*
  # Fix Infinite Recursion in Admin RLS Policies

  1. Issue
    - Admin SELECT policy causes infinite recursion by querying profiles table
    - Cannot check is_admin from within a profiles RLS policy

  2. Solution
    - Create security definer function to check admin status
    - Use function in RLS policies to avoid recursion
    - Function runs with elevated privileges and bypasses RLS

  3. Changes
    - Create is_admin_user() function
    - Update admin policies to use this function
*/

-- Create function to check if current user is admin (bypasses RLS)
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION is_admin_user() TO authenticated;

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Recreate SELECT policy without recursion
CREATE POLICY "Users can view own profile or admins can view all"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid() OR is_admin_user()
  );

-- Recreate UPDATE policy for admins without recursion
CREATE POLICY "Admins can update any profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());
