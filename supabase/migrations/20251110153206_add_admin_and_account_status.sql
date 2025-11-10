/*
  # Add Admin Role and Account Status
  
  ## Changes
  
  1. Add New Columns to profiles table
    - `is_admin` (boolean) - Identifies admin users
    - `account_status` (text) - Status of user account (pending, active, disabled)
    - `approved_at` (timestamptz) - When the account was approved
    - `approved_by` (uuid) - Which admin approved the account
  
  2. Default Values
    - `is_admin` defaults to false
    - `account_status` defaults to 'pending' (requires admin approval)
    - Only specific email (hitashigarg123@gmail.com) gets admin role automatically
  
  3. Security
    - Add RLS policies for admin access
    - Only admins can view all users
    - Only admins can update account status
    - Regular users can only view their own profile
  
  4. Set Specific User as Admin
    - Automatically set hitashigarg123@gmail.com as admin with active status
*/

-- Add new columns to profiles table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_admin boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'account_status'
  ) THEN
    ALTER TABLE profiles ADD COLUMN account_status text DEFAULT 'pending' 
      CHECK (account_status IN ('pending', 'active', 'disabled'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE profiles ADD COLUMN approved_at timestamptz;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'approved_by'
  ) THEN
    ALTER TABLE profiles ADD COLUMN approved_by uuid REFERENCES profiles(id);
  END IF;
END $$;

-- Create index on account_status for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_account_status ON profiles(account_status);
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles(is_admin);

-- Set the specific admin user (hitashigarg123@gmail.com) as admin and active
UPDATE profiles 
SET is_admin = true, 
    account_status = 'active',
    approved_at = now()
FROM auth.users
WHERE profiles.id = auth.users.id 
  AND auth.users.email = 'hitashigarg123@gmail.com';

-- Set all existing users (except the admin) as active for backward compatibility
UPDATE profiles 
SET account_status = 'active',
    approved_at = now()
WHERE account_status = 'pending' 
  AND is_admin = false;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Create new RLS policies

-- Allow users to view their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Allow admins to view all profiles
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Allow users to update their own profile (except admin and account_status fields)
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT is_admin FROM profiles WHERE id = auth.uid())
    AND account_status = (SELECT account_status FROM profiles WHERE id = auth.uid())
  );

-- Allow admins to update any profile
CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Allow authenticated users to insert their own profile
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND is_admin = false
  );

-- Create a function to automatically set admin for specific email on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, is_admin, account_status, approved_at)
  VALUES (
    NEW.id,
    CASE WHEN NEW.email = 'hitashigarg123@gmail.com' THEN true ELSE false END,
    CASE WHEN NEW.email = 'hitashigarg123@gmail.com' THEN 'active' ELSE 'pending' END,
    CASE WHEN NEW.email = 'hitashigarg123@gmail.com' THEN now() ELSE NULL END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
