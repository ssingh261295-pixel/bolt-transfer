/*
  # Add Order Timestamp Field

  1. Changes
    - Add `order_timestamp` column to `orders` table to store the actual Zerodha order time
    - This is different from `created_at` which is when we sync the order to our database
    - Will show the correct transaction time in the Order History page
*/

-- Add order_timestamp column to store actual Zerodha order time
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'order_timestamp'
  ) THEN
    ALTER TABLE orders ADD COLUMN order_timestamp timestamptz;
  END IF;
END $$;

-- For existing orders without order_timestamp, use created_at as fallback
UPDATE orders
SET order_timestamp = created_at
WHERE order_timestamp IS NULL;