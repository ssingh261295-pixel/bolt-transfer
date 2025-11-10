/*
  # Fix Function Search Path Security Issue
  
  ## Changes
  
  1. Update `handle_new_user` function to use `SET search_path = ''`
     - This prevents search_path manipulation attacks
     - Makes the function more secure by explicitly qualifying all object references
  
  ## Security Notes
  - Setting search_path to empty string prevents malicious schema injection
  - All table references are now fully qualified with schema names
*/

-- Drop and recreate the function with proper search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
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
$$;
