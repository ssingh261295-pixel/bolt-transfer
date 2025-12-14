/*
  # Add Unique Constraint to Webhook Key
  
  1. Changes
    - Add unique constraint to webhook_key column in strategies table
    - Create function to generate unique webhook keys
    - Add check constraint to ensure webhook_key is required for TradingView strategies
  
  2. Security
    - Ensures no two strategies can have the same webhook_key
    - Prevents webhook key collisions
*/

-- Add unique constraint to webhook_key (allows null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'strategies_webhook_key_key'
  ) THEN
    ALTER TABLE strategies 
    ADD CONSTRAINT strategies_webhook_key_key UNIQUE (webhook_key);
  END IF;
END $$;

-- Create function to generate unique webhook keys
CREATE OR REPLACE FUNCTION generate_webhook_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_key text;
  key_exists boolean;
BEGIN
  LOOP
    -- Generate a random 32-character key
    new_key := encode(gen_random_bytes(24), 'base64');
    new_key := replace(new_key, '/', '_');
    new_key := replace(new_key, '+', '-');
    new_key := substring(new_key, 1, 32);
    
    -- Check if key already exists
    SELECT EXISTS(SELECT 1 FROM strategies WHERE webhook_key = new_key) INTO key_exists;
    
    EXIT WHEN NOT key_exists;
  END LOOP;
  
  RETURN new_key;
END;
$$;

-- Add check constraint to ensure webhook_key is provided for TradingView strategies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'strategies_webhook_key_required_for_tradingview'
  ) THEN
    ALTER TABLE strategies 
    ADD CONSTRAINT strategies_webhook_key_required_for_tradingview 
    CHECK (
      (execution_source = 'tradingview' AND webhook_key IS NOT NULL) 
      OR execution_source != 'tradingview' 
      OR execution_source IS NULL
    );
  END IF;
END $$;