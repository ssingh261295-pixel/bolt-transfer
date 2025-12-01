/*
  # Fix Admin Get Users Function - Email Type

  1. Changes
    - Update email column type from text to varchar(255) to match auth.users
    - This fixes the type mismatch error

  2. Notes
    - The auth.users.email column is varchar(255), not text
*/

-- Drop and recreate function with correct email type
DROP FUNCTION IF EXISTS get_all_users_admin();

CREATE OR REPLACE FUNCTION get_all_users_admin()
RETURNS TABLE (
  id uuid,
  full_name text,
  phone text,
  plan_type text,
  account_status text,
  is_admin boolean,
  created_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  updated_at timestamptz,
  email varchar(255),  -- Changed from text to varchar(255)
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if the caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return all users with their email addresses
  RETURN QUERY
  SELECT 
    p.id,
    p.full_name,
    p.phone,
    p.plan_type,
    p.account_status,
    p.is_admin,
    p.created_at,
    p.approved_at,
    p.approved_by,
    p.updated_at,
    u.email,
    u.email_confirmed_at,
    u.last_sign_in_at
  FROM profiles p
  LEFT JOIN auth.users u ON p.id = u.id
  ORDER BY p.created_at DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_all_users_admin() TO authenticated;
