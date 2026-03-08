/*
  # Add next_month_day_threshold to risk_limits

  ## Summary
  Adds a configurable day-of-month threshold to the risk_limits table.
  When the current calendar day exceeds this value, the webhook engine
  will select the next-month futures contract instead of the current month.

  ## Changes
  - `risk_limits` table: new column `next_month_day_threshold` (integer, default 15)
    - Range: 1–28
    - Default 15 means: on day 16+ of the month, next month's future is used

  ## Notes
  - Existing rows get the default value of 15 (preserving current behavior)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_limits' AND column_name = 'next_month_day_threshold'
  ) THEN
    ALTER TABLE risk_limits ADD COLUMN next_month_day_threshold integer NOT NULL DEFAULT 15;
  END IF;
END $$;
