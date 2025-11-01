/*
  # Add Token Expiry Tracking for Zerodha

  1. Changes
    - Add `token_expires_at` column to `broker_connections` table
    - This tracks when the Zerodha access token expires (daily at midnight)

  2. Notes
    - Zerodha tokens expire daily at midnight IST
    - This column helps determine if reconnection is needed
    - When token is exchanged, this should be set to next midnight IST
*/

-- Add token expiry tracking column
ALTER TABLE broker_connections
ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

-- Add index for efficient queries on expired tokens
CREATE INDEX IF NOT EXISTS idx_broker_connections_token_expires_at
ON broker_connections(token_expires_at)
WHERE token_expires_at IS NOT NULL;
