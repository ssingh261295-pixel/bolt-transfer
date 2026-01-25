/*
  # Add Response Message to Webhook Logs

  ## Changes
  - Add `response_message` column to `tradingview_webhook_logs` table
  - This field stores both success and informational messages from webhook execution
  - Allows displaying detailed feedback to users about webhook processing

  ## Purpose
  Store webhook execution response messages (both success and informational)
  to provide better visibility into webhook processing results.
*/

-- Add response_message column to tradingview_webhook_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tradingview_webhook_logs' AND column_name = 'response_message'
  ) THEN
    ALTER TABLE tradingview_webhook_logs ADD COLUMN response_message text;
  END IF;
END $$;
