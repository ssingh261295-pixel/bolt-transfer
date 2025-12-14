/*
  # Create Notifications Table
  
  ## New Tables
  1. `notifications`
     - `id` (uuid, primary key)
     - `user_id` (uuid, foreign key to auth.users)
     - `source` (text) - Where notification came from (tradingview, hmt_engine, system)
     - `strategy_name` (text) - Name of strategy if applicable
     - `symbol` (text) - Trading symbol if applicable
     - `title` (text) - Short title for notification
     - `message` (text) - Detailed message
     - `type` (text) - Type of notification (trade, order, alert, error, info)
     - `is_read` (boolean) - Whether user has read this notification
     - `created_at` (timestamptz)
  
  ## Security
     - Enable RLS on `notifications` table
     - Users can read their own notifications
     - Users can update their own notifications (mark as read)
     - System can insert notifications via service role
  
  ## Indexes
     - Index on user_id for fast lookups
     - Index on created_at for sorting
     - Index on is_read for filtering unread
*/

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  strategy_name text,
  symbol text,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL,
  is_read boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to get unread count
CREATE OR REPLACE FUNCTION get_unread_notification_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_count
  FROM notifications
  WHERE user_id = p_user_id
    AND is_read = false;
  
  RETURN v_count;
END;
$$;

-- Function to mark all notifications as read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE notifications
  SET is_read = true
  WHERE user_id = p_user_id
    AND is_read = false;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- Comments
COMMENT ON TABLE notifications IS 'Centralized notification system for all app events';
COMMENT ON COLUMN notifications.source IS 'Source of notification: tradingview, hmt_engine, system';
COMMENT ON COLUMN notifications.type IS 'Type: trade, order, alert, error, info';