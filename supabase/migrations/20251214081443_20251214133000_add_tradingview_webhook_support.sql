/*
  # Add TradingView Webhook Support to Strategies
  
  ## Changes
  1. New Columns
     - `execution_source` - How the strategy is executed ('manual' or 'tradingview')
     - `webhook_key` - Unique key for webhook authentication
     - `atr_config` - ATR configuration (period, sl_multiplier, target_multiplier, trailing_multiplier)
     - `account_mappings` - Array of broker_connection_id that this strategy trades on
  
  2. Notes
     - Minimal schema changes
     - No execution logic added
     - TradingView sends signals, HMT GTT executes
*/

-- Add execution_source column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'execution_source'
  ) THEN
    ALTER TABLE strategies ADD COLUMN execution_source text DEFAULT 'manual';
  END IF;
END $$;

-- Add webhook_key column (unique identifier for webhook validation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'webhook_key'
  ) THEN
    ALTER TABLE strategies ADD COLUMN webhook_key text UNIQUE;
  END IF;
END $$;

-- Add atr_config column for ATR-based risk management
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'atr_config'
  ) THEN
    ALTER TABLE strategies ADD COLUMN atr_config jsonb DEFAULT '{
      "period": 14,
      "sl_multiplier": 1.5,
      "target_multiplier": 2.0,
      "trailing_multiplier": 1.0
    }'::jsonb;
  END IF;
END $$;

-- Add account_mappings column (which accounts to trade on)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strategies' AND column_name = 'account_mappings'
  ) THEN
    ALTER TABLE strategies ADD COLUMN account_mappings jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Create index on webhook_key for fast lookups
CREATE INDEX IF NOT EXISTS idx_strategies_webhook_key ON strategies(webhook_key);

-- Create function to generate webhook key
CREATE OR REPLACE FUNCTION generate_webhook_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'whk_' || encode(gen_random_bytes(32), 'hex');
END;
$$;

-- Comments
COMMENT ON COLUMN strategies.execution_source IS 'How strategy is executed: manual or tradingview';
COMMENT ON COLUMN strategies.webhook_key IS 'Unique key for TradingView webhook authentication';
COMMENT ON COLUMN strategies.atr_config IS 'ATR configuration: period, sl_multiplier, target_multiplier, trailing_multiplier';
COMMENT ON COLUMN strategies.account_mappings IS 'Array of broker_connection_id that trade this strategy';