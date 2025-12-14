/*
  # Fix Heartbeat Update Function

  ## Changes
  - Update `update_engine_heartbeat` to explicitly check both `id = 'singleton'` AND `instance_id`
  - This ensures the heartbeat update is atomic and only updates the correct row
  - Prevents potential issues if multiple rows exist (shouldn't happen, but defense in depth)
*/

CREATE OR REPLACE FUNCTION update_engine_heartbeat(
  p_instance_id text,
  p_processed_ticks bigint,
  p_triggered_orders integer,
  p_failed_orders integer,
  p_active_triggers integer,
  p_websocket_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE hmt_engine_state
  SET 
    last_heartbeat = now(),
    processed_ticks = p_processed_ticks,
    triggered_orders = p_triggered_orders,
    failed_orders = p_failed_orders,
    active_triggers = p_active_triggers,
    websocket_status = p_websocket_status,
    updated_at = now()
  WHERE id = 'singleton' AND instance_id = p_instance_id;
END;
$$;
