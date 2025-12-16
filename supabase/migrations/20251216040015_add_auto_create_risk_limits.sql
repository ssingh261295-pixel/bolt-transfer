/*
  # Auto-Create Risk Limits for HMT GTT Safety

  ## Problem
  - HMT GTT engine requires risk_limits for safety checks
  - Orders fail if risk_limits don't exist for a user
  - No automatic creation of risk limits when users sign up or create HMT GTT orders

  ## Solution
  1. Create default risk limits for all existing users
  2. Add trigger to auto-create risk limits for new users
  3. Add trigger to auto-create risk limits when users create their first HMT GTT order

  ## Default Risk Limits
  - max_trades_per_day: 50 (generous limit)
  - max_loss_per_day: ₹50,000
  - auto_square_off_time: 15:15 (standard market closing)
  - kill_switch_enabled: false (not active by default)
*/

-- Create default risk limits for all existing users who don't have them
INSERT INTO risk_limits (user_id, max_trades_per_day, max_loss_per_day, auto_square_off_time, kill_switch_enabled)
SELECT 
  id,
  50,
  50000.00,
  '15:15:00'::time,
  false
FROM auth.users
WHERE NOT EXISTS (
  SELECT 1 FROM risk_limits WHERE risk_limits.user_id = auth.users.id
);

-- Function: Auto-create risk limits for new users
CREATE OR REPLACE FUNCTION create_risk_limits_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO risk_limits (
    user_id,
    max_trades_per_day,
    max_loss_per_day,
    auto_square_off_time,
    kill_switch_enabled
  ) VALUES (
    NEW.id,
    50,
    50000.00,
    '15:15:00'::time,
    false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Create risk limits when new user is created
DROP TRIGGER IF EXISTS on_auth_user_created_create_risk_limits ON auth.users;
CREATE TRIGGER on_auth_user_created_create_risk_limits
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_risk_limits_for_new_user();

-- Function: Ensure risk limits exist before creating HMT GTT order
CREATE OR REPLACE FUNCTION ensure_risk_limits_before_hmt_gtt()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if risk limits exist for this user
  IF NOT EXISTS (SELECT 1 FROM risk_limits WHERE user_id = NEW.user_id) THEN
    -- Create default risk limits
    INSERT INTO risk_limits (
      user_id,
      max_trades_per_day,
      max_loss_per_day,
      auto_square_off_time,
      kill_switch_enabled
    ) VALUES (
      NEW.user_id,
      50,
      50000.00,
      '15:15:00'::time,
      false
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Ensure risk limits before HMT GTT order creation
DROP TRIGGER IF EXISTS before_hmt_gtt_order_ensure_risk_limits ON hmt_gtt_orders;
CREATE TRIGGER before_hmt_gtt_order_ensure_risk_limits
  BEFORE INSERT ON hmt_gtt_orders
  FOR EACH ROW
  EXECUTE FUNCTION ensure_risk_limits_before_hmt_gtt();