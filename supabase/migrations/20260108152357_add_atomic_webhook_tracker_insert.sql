/*
  # Add Atomic Webhook Execution Tracker Insert Function

  This migration creates a database function to atomically insert webhook execution
  tracker entries, preventing race conditions when TradingView sends duplicate webhooks.

  ## Changes

  1. Creates function `try_insert_execution_tracker()`
     - Atomically inserts execution tracker entry
     - Uses UNIQUE constraint to prevent duplicates
     - Returns true on success, false if duplicate detected
     - Handles race conditions at database level

  ## Why This Matters

  Without this, when TradingView sends duplicate webhooks within milliseconds:
  - Both webhooks pass duplicate check
  - Both execute orders on same symbol
  - User gets unwanted double position

  With this fix:
  - First webhook inserts tracker entry → proceeds with execution
  - Second webhook fails to insert (unique constraint) → gets blocked immediately
  - Only ONE execution happens, protecting user capital

  ## Security

  Function is SECURITY DEFINER to allow edge functions to insert tracker entries
  without requiring RLS policies for service role operations.
*/

-- Create atomic insert function for webhook execution tracker
CREATE OR REPLACE FUNCTION try_insert_execution_tracker(
  p_webhook_key_id uuid,
  p_symbol text,
  p_trade_type text,
  p_price numeric,
  p_execution_date date,
  p_payload_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Try to insert the tracker entry
  -- If unique constraint is violated, return false
  INSERT INTO webhook_execution_tracker (
    webhook_key_id,
    symbol,
    trade_type,
    price,
    execution_date,
    payload_hash
  ) VALUES (
    p_webhook_key_id,
    p_symbol,
    p_trade_type,
    p_price,
    p_execution_date,
    p_payload_hash
  );

  -- If we reach here, insert succeeded
  RETURN true;

EXCEPTION
  WHEN unique_violation THEN
    -- Duplicate detected, return false
    RETURN false;
  WHEN OTHERS THEN
    -- Other errors should be raised
    RAISE;
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION try_insert_execution_tracker TO authenticated, service_role;

-- Add comment for documentation
COMMENT ON FUNCTION try_insert_execution_tracker IS
  'Atomically inserts webhook execution tracker entry. Returns true on success, false if duplicate detected. Prevents race conditions when TradingView sends duplicate webhooks.';
