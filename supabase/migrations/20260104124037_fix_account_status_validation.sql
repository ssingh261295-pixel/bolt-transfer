/*
  # Fix Account Status Validation in Helper Function
  
  1. Changes
    - Update is_user_approved_or_admin() function to check for 'active' status instead of 'approved'
    - The valid account statuses are: 'pending', 'active', 'disabled'
    - There is no 'approved' status in the database schema
  
  2. Impact
    - Users with 'active' status will now be able to access the platform
    - Fixes the foreign key constraint error when creating broker connections
*/

-- Fix the helper function to use correct status values
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
    AND (account_status = 'active' OR is_admin = true)
  );
$$;