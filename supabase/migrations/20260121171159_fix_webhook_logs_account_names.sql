/*
  # Fix Webhook Logs Account Names
  
  1. Updates all existing tradingview_webhook_logs records
     - Updates account_name in accounts_executed JSON array
     - Matches account_id with broker_connections to get account_holder_name
  
  2. Changes
     - Updates all logs where accounts_executed has null account_name
     - Sets account_name to account_holder_name from broker_connections
*/

DO $$
DECLARE
  log_record RECORD;
  updated_accounts jsonb;
  account_item jsonb;
  account_name_value text;
BEGIN
  -- Loop through all webhook logs that have accounts_executed data
  FOR log_record IN 
    SELECT id, accounts_executed 
    FROM tradingview_webhook_logs 
    WHERE accounts_executed IS NOT NULL 
      AND jsonb_array_length(accounts_executed) > 0
  LOOP
    updated_accounts := '[]'::jsonb;
    
    -- Loop through each account in the accounts_executed array
    FOR account_item IN 
      SELECT * FROM jsonb_array_elements(log_record.accounts_executed)
    LOOP
      -- Get the account name from broker_connections
      SELECT COALESCE(bc.account_name, bc.account_holder_name, 'Unknown Account')
      INTO account_name_value
      FROM broker_connections bc
      WHERE bc.id = (account_item->>'account_id')::uuid;
      
      -- Update the account_name in the JSON object
      account_item := jsonb_set(
        account_item,
        '{account_name}',
        to_jsonb(account_name_value)
      );
      
      -- Add to updated array
      updated_accounts := updated_accounts || jsonb_build_array(account_item);
    END LOOP;
    
    -- Update the log record with the new accounts_executed array
    UPDATE tradingview_webhook_logs
    SET accounts_executed = updated_accounts
    WHERE id = log_record.id;
  END LOOP;
END $$;
