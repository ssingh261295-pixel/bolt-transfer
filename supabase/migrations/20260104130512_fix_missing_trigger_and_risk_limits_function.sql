/*
  # Fix Missing New User Trigger and Risk Limits Function

  1. Problem
    - The handle_new_user() function exists but the trigger on auth.users was never created
    - create_risk_limits_for_new_user() function has wrong column names
    - New users can signup but no profile is created for them
    - User ravi.verma@helpmetrade.club can login but has no profile
  
  2. Solution
    - Fix create_risk_limits_for_new_user() function with correct column names
    - Create the missing trigger on auth.users table
    - Manually create profile for ravi.verma@helpmetrade.club with pending status
  
  3. Changes
    - Fix risk limits function to use correct columns
    - Create trigger on auth.users to call handle_new_user() on insert
    - Create profile for user ID 60a07c8d-5fe9-420b-b7de-1d4885cc15a2
    - Create notifications for admins about this new user
*/

-- Fix the create_risk_limits_for_new_user function with correct column names
CREATE OR REPLACE FUNCTION public.create_risk_limits_for_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.risk_limits (
    user_id,
    max_trades_per_day,
    max_loss_per_day,
    auto_square_off_time,
    kill_switch_enabled,
    daily_trades_count,
    daily_pnl,
    last_reset_date
  )
  VALUES (
    NEW.id,
    50,
    50000.00,
    '15:15:00',
    false,
    0,
    0.00,
    CURRENT_DATE
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error creating risk limits for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Create the missing trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Manually create profile for ravi.verma@helpmetrade.club
INSERT INTO public.profiles (
  id,
  full_name,
  is_admin,
  account_status,
  approved_at,
  plan_type,
  created_at,
  updated_at
)
VALUES (
  '60a07c8d-5fe9-420b-b7de-1d4885cc15a2',
  'Ravi Verma',
  false,
  'pending',
  NULL,
  'pro',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Manually create risk limits for ravi.verma@helpmetrade.club
INSERT INTO public.risk_limits (
  user_id,
  max_trades_per_day,
  max_loss_per_day,
  auto_square_off_time,
  kill_switch_enabled,
  daily_trades_count,
  daily_pnl,
  last_reset_date
)
VALUES (
  '60a07c8d-5fe9-420b-b7de-1d4885cc15a2',
  50,
  50000.00,
  '15:15:00',
  false,
  0,
  0.00,
  CURRENT_DATE
)
ON CONFLICT (user_id) DO NOTHING;

-- Create notifications for all admins about this new user
INSERT INTO public.notifications (
  user_id,
  source,
  type,
  title,
  message,
  is_read,
  created_at
)
SELECT 
  id,
  'system',
  'info',
  'New User Registration',
  'New user Ravi Verma has registered and requires approval',
  false,
  now()
FROM public.profiles
WHERE is_admin = true
ON CONFLICT DO NOTHING;
