/*
  # Update TradingView Webhook Logs Status Constraint

  ## Changes
  - Add 'rejected' to the status CHECK constraint
  - This allows tracking of blocked/rejected signals separately from failures

  ## Status Values
  - 'success': Order placed successfully
  - 'failed': Order placement failed
  - 'rejected': Signal rejected by platform (duplicate, existing position, time window, etc.)
  - 'rejected_time_window': Outside trading hours (specific rejection type)
*/

-- Drop existing check constraint
ALTER TABLE tradingview_webhook_logs DROP CONSTRAINT IF EXISTS tradingview_webhook_logs_status_check;

-- Add updated check constraint
ALTER TABLE tradingview_webhook_logs ADD CONSTRAINT tradingview_webhook_logs_status_check
  CHECK (status IN ('success', 'failed', 'rejected', 'rejected_time_window'));
