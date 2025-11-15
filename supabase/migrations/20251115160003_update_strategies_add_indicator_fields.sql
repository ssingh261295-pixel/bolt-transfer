/*
  # Update Strategies Table for Indicator Support

  1. Changes
    - Add `symbol` column for trading symbol
    - Add `exchange` column for exchange (NSE/NFO)
    - Add `timeframe` column for timeframe (1m, 5m, 15m, 1h, 1d)
    - Add `indicators` column for indicator configurations
    - Update `entry_conditions` and `exit_conditions` to support new format
    
  2. Notes
    - Using IF NOT EXISTS to prevent errors if columns already exist
    - Preserving existing data
*/

-- Add symbol column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE strategies ADD COLUMN symbol text;
  END IF;
END $$;

-- Add exchange column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'exchange'
  ) THEN
    ALTER TABLE strategies ADD COLUMN exchange text;
  END IF;
END $$;

-- Add timeframe column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'timeframe'
  ) THEN
    ALTER TABLE strategies ADD COLUMN timeframe text DEFAULT '1d';
  END IF;
END $$;

-- Add indicators column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'indicators'
  ) THEN
    ALTER TABLE strategies ADD COLUMN indicators jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
