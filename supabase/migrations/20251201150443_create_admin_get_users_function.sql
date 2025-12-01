/*
  # Create Admin Get Users Function

  1. New Function
    - `get_all_users_admin()` - Returns all users with emails for admins
    - Security definer function to access auth.users
    - Only callable by admin users

  2. Security
    - Function checks if caller is admin before returning data
    - Uses security definer to access auth.users table
*/

-- Create function for admins to get all users with emails
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
  email text,
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
