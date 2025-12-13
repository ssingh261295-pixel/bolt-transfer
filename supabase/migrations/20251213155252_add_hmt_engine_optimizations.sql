/*
  # HMT Trigger Engine Optimizations

  1. Optimizations
    - Add composite index on (instrument_token, status) for fast O(1) lookups
    - Optimize existing indexes for engine startup queries

  2. Notes
    - These indexes support the server-side trigger engine
    - The engine loads active triggers grouped by instrument_token
    - Sub-100ms query performance is critical for real-time processing
*/

-- Add composite index for instrument token + status lookup (critical for hot path)
CREATE INDEX IF NOT EXISTS idx_hmt_gtt_orders_instrument_status
  ON hmt_gtt_orders(instrument_token, status)
  WHERE status = 'active';

-- Optimize the existing user_status index with partial index
DROP INDEX IF EXISTS idx_hmt_gtt_orders_user_status;
CREATE INDEX idx_hmt_gtt_orders_user_status
  ON hmt_gtt_orders(user_id, status)
  WHERE status IN ('active', 'triggered');