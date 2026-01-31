/*
  # Account-Level TradingView Signal Filters

  1. Purpose
    - Allow per-broker-account configurable conditions to filter TradingView signals
    - Platform acts as rule-based execution gate
    - Always log webhooks (even if filtered)
    - Does NOT change webhook payload, execution flow, or risk logic

  2. New Columns on broker_connections
    - `signal_filters_enabled` (boolean) - Master switch for filter evaluation
    - `signal_filters` (jsonb) - Filter configuration object

  3. Filter Configuration Schema
    ```json
    {
      "symbols": {
        "mode": "whitelist" | "blacklist",
        "list": ["NIFTY", "BANKNIFTY"]
      },
      "trade_types": {
        "allow_buy": true,
        "allow_sell": true
      },
      "time_filters": {
        "enabled": true,
        "start_time": "09:15",
        "end_time": "15:15",
        "timezone": "Asia/Kolkata"
      },
      "trade_grade": {
        "enabled": true,
        "min_grade": "B"
      },
      "trade_score": {
        "enabled": true,
        "min_score": 6.0
      },
      "entry_phase": {
        "enabled": true,
        "allowed_phases": ["EARLY", "OPTIMAL"]
      },
      "adx": {
        "enabled": true,
        "min_value": 20.0,
        "max_value": 50.0
      },
      "volume": {
        "enabled": true,
        "min_avg_volume_5d": 100000
      },
      "price_range": {
        "enabled": true,
        "min_price": 0,
        "max_price": 10000
      }
    }
    ```

  4. Security
    - RLS policies ensure users can only configure their own accounts
    - Filters evaluated server-side in edge function
    - Cannot be bypassed by modifying webhook payload

  5. Logging
    - All webhooks logged regardless of filter result
    - Filter evaluation result stored in `accounts_executed` array
    - Includes filter_passed, filter_reason fields
*/

-- Add signal filter columns to broker_connections
ALTER TABLE broker_connections
  ADD COLUMN IF NOT EXISTS signal_filters_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS signal_filters jsonb DEFAULT '{}'::jsonb;

-- Create index for faster filter lookups
CREATE INDEX IF NOT EXISTS idx_broker_connections_signal_filters_enabled
  ON broker_connections(signal_filters_enabled)
  WHERE signal_filters_enabled = true;

-- Add comment explaining the columns
COMMENT ON COLUMN broker_connections.signal_filters_enabled IS 'Master switch to enable/disable signal filtering for this account';
COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration object defining filter rules for TradingView signals';

-- Add default filter configuration helper function
CREATE OR REPLACE FUNCTION get_default_signal_filters()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '{
    "symbols": {
      "mode": "whitelist",
      "list": []
    },
    "trade_types": {
      "allow_buy": true,
      "allow_sell": true
    },
    "time_filters": {
      "enabled": false,
      "start_time": "09:15",
      "end_time": "15:15",
      "timezone": "Asia/Kolkata"
    },
    "trade_grade": {
      "enabled": false,
      "min_grade": "C"
    },
    "trade_score": {
      "enabled": false,
      "min_score": 5.0
    },
    "entry_phase": {
      "enabled": false,
      "allowed_phases": ["EARLY", "OPTIMAL", "LATE"]
    },
    "adx": {
      "enabled": false,
      "min_value": 0,
      "max_value": 100
    },
    "volume": {
      "enabled": false,
      "min_avg_volume_5d": 0
    },
    "price_range": {
      "enabled": false,
      "min_price": 0,
      "max_price": 1000000
    }
  }'::jsonb;
$$;

-- Update existing broker_connections to have default filters
UPDATE broker_connections
SET signal_filters = get_default_signal_filters()
WHERE signal_filters = '{}'::jsonb OR signal_filters IS NULL;