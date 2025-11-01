/*
  # Make All Users Pro Plan

  1. Changes
    - Drop the old plan_type constraint
    - Update all existing users to 'pro' plan
    - Change default plan_type to 'pro'
    - Add new constraint that only allows 'pro'
  
  2. Notes
    - This removes the free/basic/premium/enterprise tier system
    - All users are now on the pro plan by default
*/

-- Drop the old constraint first
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_plan_type_check;

-- Update all existing users to pro plan
UPDATE profiles 
SET plan_type = 'pro';

-- Update the column to default to 'pro'
ALTER TABLE profiles 
ALTER COLUMN plan_type SET DEFAULT 'pro';

-- Add new constraint that only allows 'pro'
ALTER TABLE profiles 
ADD CONSTRAINT profiles_plan_type_check CHECK (plan_type = 'pro');