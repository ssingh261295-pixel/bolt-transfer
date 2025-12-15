/*
  # Add GTT Orders Caching Support

  1. Changes
    - Add `instrument_token` column to store Zerodha instrument token
    - Add `last_price` column to cache last known price
    - Add `raw_data` JSONB column to store complete Zerodha GTT response
    - Add `synced_at` timestamp to track when data was last synced from Zerodha
    - Add `zerodha_gtt_id` to store Zerodha's GTT ID
    
  2. Purpose
    - Enable instant page loads by showing cached data first
    - Sync with Zerodha API in background for fresh data
    - Preserve all Zerodha API response data for complete display

  3. Performance Impact
    - GTT page will load instantly from database
    - No waiting for slow Zerodha API calls
    - Background sync keeps data fresh
*/

-- Add new columns if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gtt_orders' AND column_name = 'instrument_token'
  ) THEN
    ALTER TABLE gtt_orders ADD COLUMN instrument_token bigint;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gtt_orders' AND column_name = 'last_price'
  ) THEN
    ALTER TABLE gtt_orders ADD COLUMN last_price decimal;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gtt_orders' AND column_name = 'raw_data'
  ) THEN
    ALTER TABLE gtt_orders ADD COLUMN raw_data jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gtt_orders' AND column_name = 'synced_at'
  ) THEN
    ALTER TABLE gtt_orders ADD COLUMN synced_at timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'gtt_orders' AND column_name = 'zerodha_gtt_id'
  ) THEN
    ALTER TABLE gtt_orders ADD COLUMN zerodha_gtt_id integer;
  END IF;
END $$;

-- Add index on instrument_token for faster lookups
CREATE INDEX IF NOT EXISTS idx_gtt_orders_instrument_token ON gtt_orders(instrument_token);

-- Add index on zerodha_gtt_id for faster sync operations
CREATE INDEX IF NOT EXISTS idx_gtt_orders_zerodha_gtt_id ON gtt_orders(zerodha_gtt_id, broker_connection_id);