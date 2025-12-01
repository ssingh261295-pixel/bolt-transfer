/*
  # Remove Auto-Approval for New Users

  1. Changes
    - Removes the auto-approval logic that was activating all users
    - New users will now default to 'pending' status
    - Only admins can approve users

  2. Notes
    - Existing active users remain active
    - This only affects new user registrations going forward
*/

-- No changes to existing data, just documenting that new users
-- will now stay in 'pending' status until admin approval

-- The default value of 'pending' is already set in the profiles table
-- We just need to ensure the trigger doesn't auto-approve

-- Update the handle_new_user function to NOT auto-approve
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (id, is_admin, account_status, approved_at)
  VALUES (
    new.id, 
    false, 
    'pending',  -- Keep as pending, admin must approve
    NULL        -- No approval timestamp
  );
  RETURN new;
END;
$$;
