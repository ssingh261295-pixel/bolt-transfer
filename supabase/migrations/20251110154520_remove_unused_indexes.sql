/*
  # Remove Unused Indexes
  
  ## Changes
  
  1. Remove indexes that have not been used
     - idx_gtt_orders_user_id
     - idx_profiles_account_status
     - idx_profiles_is_admin
     - idx_nfo_instruments_token
     - idx_nfo_instruments_symbol
     - idx_nfo_instruments_expiry
     - idx_nfo_instruments_type
     - idx_broker_connections_token_expires_at
  
  ## Performance Notes
  - Unused indexes consume storage space
  - Unused indexes slow down INSERT, UPDATE, and DELETE operations
  - Removing them improves write performance
  - Indexes can be added back later if query patterns change
  
  ## Important
  - These indexes were identified as unused based on current usage patterns
  - Monitor query performance after removal
  - Consider query patterns before permanently removing
*/

-- Drop unused indexes on gtt_orders
DROP INDEX IF EXISTS public.idx_gtt_orders_user_id;

-- Drop unused indexes on profiles
DROP INDEX IF EXISTS public.idx_profiles_account_status;
DROP INDEX IF EXISTS public.idx_profiles_is_admin;

-- Drop unused indexes on nfo_instruments
DROP INDEX IF EXISTS public.idx_nfo_instruments_token;
DROP INDEX IF EXISTS public.idx_nfo_instruments_symbol;
DROP INDEX IF EXISTS public.idx_nfo_instruments_expiry;
DROP INDEX IF EXISTS public.idx_nfo_instruments_type;

-- Drop unused indexes on broker_connections
DROP INDEX IF EXISTS public.idx_broker_connections_token_expires_at;
