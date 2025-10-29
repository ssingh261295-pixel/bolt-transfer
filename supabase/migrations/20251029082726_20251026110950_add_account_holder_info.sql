/*
  # Add Account Holder Information Fields

  1. Changes
    - Add `client_id` column to `broker_connections` table to store Zerodha client ID
    - Add `account_holder_name` column to `broker_connections` table to store account holder's name
    - These fields will be used to identify accounts throughout the platform
  
  2. Security
    - No RLS changes needed as existing policies cover these new columns
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'broker_connections' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE broker_connections ADD COLUMN client_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'broker_connections' AND column_name = 'account_holder_name'
  ) THEN
    ALTER TABLE broker_connections ADD COLUMN account_holder_name text;
  END IF;
END $$;