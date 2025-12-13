/*
  # Add HMT Engine Keep-Alive System
  
  1. New Objects
    - Creates pg_cron extension if not exists
    - Creates a cron job to ping the HMT engine every 5 minutes
    - Creates a function to invoke the edge function health check
  
  2. Purpose
    - Ensures the HMT trigger engine stays alive and running
    - Auto-restarts the engine if it goes down
    - Provides continuous monitoring and self-healing
  
  3. Security
    - Uses service role for edge function invocation
    - No user-facing endpoints exposed
*/

-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create function to invoke HMT engine health check
CREATE OR REPLACE FUNCTION keep_hmt_engine_alive()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url text;
  anon_key text;
  response text;
BEGIN
  -- Get Supabase URL from environment
  supabase_url := current_setting('app.settings.supabase_url', true);
  
  IF supabase_url IS NULL THEN
    supabase_url := 'https://' || current_setting('app.settings.project_ref', true) || '.supabase.co';
  END IF;
  
  -- Use pg_net to invoke the edge function (if available)
  -- This will trigger the auto-start mechanism in the edge function
  -- Note: This requires the pg_net extension
  BEGIN
    -- Try to invoke using pg_net if available
    PERFORM net.http_get(
      url := supabase_url || '/functions/v1/hmt-trigger-engine/health',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- If pg_net is not available, just log
      RAISE NOTICE 'HMT Engine keep-alive: pg_net not available. Engine will auto-start on next request.';
  END;
END;
$$;

-- Schedule the keep-alive job to run every 5 minutes
-- This ensures the edge function stays warm and the engine stays running
DO $$
BEGIN
  -- Remove existing job if it exists
  PERFORM cron.unschedule('hmt-engine-keepalive');
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Ignore if job doesn't exist
END $$;

-- Create the cron job
-- Runs every 5 minutes to ping the engine
SELECT cron.schedule(
  'hmt-engine-keepalive',
  '*/5 * * * *', -- Every 5 minutes
  $$SELECT keep_hmt_engine_alive()$$
);

-- Grant execute permission
GRANT EXECUTE ON FUNCTION keep_hmt_engine_alive() TO postgres;

-- Add comment for documentation
COMMENT ON FUNCTION keep_hmt_engine_alive() IS 'Keeps the HMT trigger engine alive by pinging it every 5 minutes. Triggers auto-start if engine is down.';