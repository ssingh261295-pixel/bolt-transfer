/*
  # Fix Engine Lock Acquisition Threshold
  
  ## Problem
  - The `acquire_engine_lock` function uses a hardcoded 2-minute threshold
  - The engine's health check uses a 20-second threshold (2 × 10s health interval)
  - This mismatch causes the UI to show "stale" but prevents lock reclamation
  
  ## Solution
  - Update `acquire_engine_lock` to use a 30-second threshold
  - This aligns better with the engine's 10-second health check interval
  - Allows faster recovery from stale instances
*/

-- Drop and recreate the function with a 30-second threshold
DROP FUNCTION IF EXISTS acquire_engine_lock(text) CASCADE;

CREATE FUNCTION acquire_engine_lock(p_instance_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_acquired boolean := false;
BEGIN
  UPDATE hmt_engine_state
  SET 
    is_running = CASE
      WHEN last_heartbeat < now() - interval '30 seconds' THEN true
      WHEN is_running = false THEN true
      ELSE is_running
    END,
    instance_id = CASE
      WHEN last_heartbeat < now() - interval '30 seconds' THEN p_instance_id
      WHEN is_running = false THEN p_instance_id
      ELSE instance_id
    END,
    started_at = CASE
      WHEN last_heartbeat < now() - interval '30 seconds' THEN now()
      WHEN is_running = false THEN now()
      ELSE started_at
    END,
    last_heartbeat = now(),
    error_message = null,
    updated_at = now()
  WHERE id = 'singleton'
    AND (
      is_running = false
      OR last_heartbeat < now() - interval '30 seconds'
    )
  RETURNING true INTO lock_acquired;

  RETURN COALESCE(lock_acquired, false);
END;
$$;