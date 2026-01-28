/*
  # Fix NFO Symbol Settings Duplicates and Unique Constraint

  ## Problem
  PostgreSQL treats NULL values as distinct in unique constraints, causing:
  - Multiple rows with same user_id + symbol when broker_connection_id is NULL
  - Upsert operations creating duplicates instead of updating existing rows
  - Settings not persisting correctly after page refresh

  ## Solution
  1. Clean up existing duplicate rows (keep most recent)
  2. Remove the existing unique constraint
  3. Add a unique partial index for non-NULL broker_connection_id
  4. Add a unique partial index for NULL broker_connection_id (global settings)

  ## Changes
  - Delete duplicate rows
  - Drop existing UNIQUE constraint
  - Create partial unique index for broker-specific settings
  - Create partial unique index for global settings (NULL broker)
*/

-- Step 1: Clean up duplicate rows (keep the most recent based on updated_at, or created_at if updated_at is same)
DELETE FROM nfo_symbol_settings
WHERE id IN (
  SELECT id
  FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, symbol, COALESCE(broker_connection_id::text, 'NULL')
        ORDER BY updated_at DESC, created_at DESC, id DESC
      ) as rn
    FROM nfo_symbol_settings
  ) t
  WHERE t.rn > 1
);

-- Step 2: Drop the existing unique constraint
ALTER TABLE nfo_symbol_settings 
DROP CONSTRAINT IF EXISTS nfo_symbol_settings_user_id_symbol_broker_connection_id_key;

-- Step 3: Create unique partial index for broker-specific settings (non-NULL broker_connection_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfo_symbol_settings_unique_broker_specific
  ON nfo_symbol_settings(user_id, symbol, broker_connection_id)
  WHERE broker_connection_id IS NOT NULL;

-- Step 4: Create unique partial index for global settings (NULL broker_connection_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nfo_symbol_settings_unique_global
  ON nfo_symbol_settings(user_id, symbol)
  WHERE broker_connection_id IS NULL;