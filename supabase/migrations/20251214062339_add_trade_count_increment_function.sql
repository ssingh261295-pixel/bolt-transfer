/*
  # Add Trade Count Increment Function

  ## Changes

  1. Create function to increment daily trade count
    - Atomically increments trade count for a user
    - Thread-safe for concurrent order executions
    - Used by HMT trigger engine after order placement

  ## Security
    - SECURITY DEFINER for service role access
    - Only accessible via RPC calls from engine
*/

-- Create function to increment daily trade count atomically
CREATE OR REPLACE FUNCTION increment_daily_trade_count(p_user_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE risk_limits
  SET
    daily_trades_count = daily_trades_count + 1,
    updated_at = now()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION increment_daily_trade_count TO service_role;

COMMENT ON FUNCTION increment_daily_trade_count IS 'Atomically increment daily trade count for risk tracking';
