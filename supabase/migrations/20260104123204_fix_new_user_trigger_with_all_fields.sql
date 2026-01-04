/*
  # Fix New User Trigger to Include All Required Fields
  
  1. Changes
    - Update handle_new_user trigger function to include full_name from user_metadata
    - Set plan_type to 'pro' by default for all new users
    - Maintains account_status as 'pending' for manual approval
  
  2. Security
    - Function runs with SECURITY DEFINER to bypass RLS during signup
    - Only creates profile with safe defaults
*/

-- Update the handle_new_user function to include all necessary fields
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    full_name,
    is_admin, 
    account_status, 
    approved_at,
    plan_type
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    false, 
    'pending',
    NULL,
    'pro'
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- Profile already exists, just return
    RETURN NEW;
  WHEN OTHERS THEN
    -- Log error but don't fail the signup
    RAISE WARNING 'Error creating profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;