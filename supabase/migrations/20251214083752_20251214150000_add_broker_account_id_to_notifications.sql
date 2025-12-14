/*
  # Add broker_account_id to notifications table
  
  1. Changes
    - Add `broker_account_id` column to notifications table
    - Add foreign key constraint to broker_connections
    - Add index for filtering by broker_account_id
  
  2. Purpose
    - Enable multi-account filtering in notification bell
    - Track which broker account triggered each notification
*/

-- Add broker_account_id column
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS broker_account_id uuid REFERENCES broker_connections(id) ON DELETE SET NULL;

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_notifications_broker_account_id 
ON notifications(broker_account_id);

-- Create compound index for common queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_broker_created 
ON notifications(user_id, broker_account_id, created_at DESC);

-- Update comment
COMMENT ON COLUMN notifications.broker_account_id IS 'Broker account that triggered this notification (optional)';