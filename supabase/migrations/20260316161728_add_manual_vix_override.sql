/*
  # Add Manual VIX Override to vix_cache

  1. Changes
    - Add `manual_override` boolean column to vix_cache (default false)
    - Add `manual_vix_value` numeric column for user-specified VIX
    - Add `manual_set_at` timestamp for when manual value was last set
    - Add `manual_set_by` uuid for which user set it

  2. Purpose
    - When Zerodha live VIX fetch fails (expired token, market closed),
      the webhook can fall back to a manually specified VIX value
    - UI allows admin/user to set the current VIX manually
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vix_cache' AND column_name = 'manual_override'
  ) THEN
    ALTER TABLE vix_cache ADD COLUMN manual_override boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vix_cache' AND column_name = 'manual_vix_value'
  ) THEN
    ALTER TABLE vix_cache ADD COLUMN manual_vix_value numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vix_cache' AND column_name = 'manual_set_at'
  ) THEN
    ALTER TABLE vix_cache ADD COLUMN manual_set_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vix_cache' AND column_name = 'manual_set_by'
  ) THEN
    ALTER TABLE vix_cache ADD COLUMN manual_set_by uuid REFERENCES auth.users(id);
  END IF;
END $$;
