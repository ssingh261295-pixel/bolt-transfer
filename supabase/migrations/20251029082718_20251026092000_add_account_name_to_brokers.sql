/*
  # Add Account Name to Broker Connections

  1. Changes
    - Add `account_name` column to `broker_connections` table
    - This allows users to identify multiple accounts from the same broker
    - Default to broker name if not specified

  2. Notes
    - Existing connections will have NULL account_name initially
    - Users can set custom names to distinguish between accounts
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'broker_connections' AND column_name = 'account_name'
  ) THEN
    ALTER TABLE broker_connections ADD COLUMN account_name text;
  END IF;
END $$;