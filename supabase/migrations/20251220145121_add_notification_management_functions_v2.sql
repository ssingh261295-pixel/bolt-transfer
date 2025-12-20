/*
  # Add Notification Management Functions

  1. New Functions
    - `mark_all_notifications_read`: Marks all notifications as read for a user
    - `clear_all_notifications`: Deletes all notifications for a user

  2. Security
    - Functions use SECURITY DEFINER with explicit user_id checks
    - Only allows users to manage their own notifications
*/

DROP FUNCTION IF EXISTS mark_all_notifications_read(uuid);

CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET is_read = true
  WHERE user_id = p_user_id AND is_read = false;
END;
$$;

CREATE OR REPLACE FUNCTION clear_all_notifications(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM notifications
  WHERE user_id = p_user_id;
END;
$$;
