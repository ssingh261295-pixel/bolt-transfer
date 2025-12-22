/*
  # Add metadata column to hmt_gtt_orders table

  1. Changes
    - Add `metadata` column (jsonb type) to `hmt_gtt_orders` table
    - Allows storing full TradingView payload and execution context
    - Nullable to support existing records
  
  2. Purpose
    - Store TradingView webhook payload details
    - Preserve audit trail for order origin
    - Track entry price, ATR, timeframe, and other signal data
*/

-- Add metadata column to store TradingView webhook payload and execution context
ALTER TABLE hmt_gtt_orders 
ADD COLUMN IF NOT EXISTS metadata jsonb;
