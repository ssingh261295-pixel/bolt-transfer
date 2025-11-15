/*
  # Add unique constraint for GTT trigger_id

  1. Changes
    - Add unique constraint on (broker_connection_id, trigger_id) to prevent duplicates
    - This allows efficient upsert operations when syncing GTT orders from broker API
  
  2. Notes
    - The combination of broker_connection_id and trigger_id ensures uniqueness
    - trigger_id is the ID from the broker's API (e.g., Zerodha's GTT ID)
*/

-- Add unique constraint on broker_connection_id and trigger_id
ALTER TABLE gtt_orders
ADD CONSTRAINT gtt_orders_broker_trigger_unique
UNIQUE (broker_connection_id, trigger_id);