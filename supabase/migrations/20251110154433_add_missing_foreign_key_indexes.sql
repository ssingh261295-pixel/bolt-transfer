/*
  # Add Missing Foreign Key Indexes
  
  ## Changes
  
  1. Add indexes for foreign key columns to improve query performance
     - orders.broker_connection_id
     - orders.strategy_id
     - positions.broker_connection_id
     - profiles.approved_by
  
  ## Performance Notes
  - Foreign keys without indexes can cause slow queries on JOIN operations
  - These indexes improve performance for relationship lookups
  - Essential for maintaining good query performance at scale
*/

-- Add index for orders.broker_connection_id foreign key
CREATE INDEX IF NOT EXISTS idx_orders_broker_connection_id 
ON public.orders(broker_connection_id);

-- Add index for orders.strategy_id foreign key
CREATE INDEX IF NOT EXISTS idx_orders_strategy_id 
ON public.orders(strategy_id);

-- Add index for positions.broker_connection_id foreign key
CREATE INDEX IF NOT EXISTS idx_positions_broker_connection_id 
ON public.positions(broker_connection_id);

-- Add index for profiles.approved_by foreign key
CREATE INDEX IF NOT EXISTS idx_profiles_approved_by 
ON public.profiles(approved_by);
