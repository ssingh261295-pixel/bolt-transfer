/*
  # Add instrument_token to positions table for real-time price updates

  1. Changes
    - Add `instrument_token` column to `positions` table
    - This enables WebSocket subscriptions for live price updates
    - Column stores the Zerodha instrument token used for market data streaming

  2. Notes
    - instrument_token is an integer identifier provided by Zerodha API
    - Required for subscribing to real-time market data via WebSocket
    - Allows positions page to show live P&L updates without manual refresh
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'positions' AND column_name = 'instrument_token'
  ) THEN
    ALTER TABLE positions ADD COLUMN instrument_token integer;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_positions_instrument_token ON positions(instrument_token);
