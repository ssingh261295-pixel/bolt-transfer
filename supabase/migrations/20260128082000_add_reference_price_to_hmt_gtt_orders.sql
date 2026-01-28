/*
  # Add reference_price to HMT GTT Orders

  ## Problem
  When converting GTT to HMT GTT, triggers fire immediately if current price
  already meets the trigger condition, instead of waiting for price to CROSS
  the trigger threshold.

  ## Solution
  Add `reference_price` field to track the price when the GTT order was created.
  This allows the trigger engine to verify that price has crossed the trigger
  from the correct direction, similar to how Zerodha GTT works.

  ## Changes
  - Add `reference_price` column to store initial price reference
  - This will be used by trigger evaluator to detect price crossings
*/

-- Add reference_price column to track initial price when GTT was created
ALTER TABLE hmt_gtt_orders 
ADD COLUMN IF NOT EXISTS reference_price numeric(10, 2);

-- Comment on the column
COMMENT ON COLUMN hmt_gtt_orders.reference_price IS 'Initial price reference when GTT was created. Used to detect if price has crossed trigger threshold from the correct direction.';