import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Environment check:', {
    url: supabaseUrl,
    key: supabaseAnonKey ? 'present' : 'missing',
    allEnv: import.meta.env
  });
  throw new Error(`Missing Supabase environment variables - URL: ${supabaseUrl ? 'present' : 'missing'}, Key: ${supabaseAnonKey ? 'present' : 'missing'}`);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  plan_type: 'pro';
  trial_ends_at: string;
  created_at: string;
  updated_at: string;
};

export type BrokerConnection = {
  id: string;
  user_id: string;
  broker_name: string;
  api_key: string | null;
  api_secret: string | null;
  access_token: string | null;
  is_active: boolean;
  last_connected_at: string | null;
  created_at: string;
};

export type Strategy = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  strategy_type: string;
  entry_conditions: Record<string, unknown>;
  exit_conditions: Record<string, unknown>;
  risk_management: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  user_id: string;
  broker_connection_id: string | null;
  strategy_id: string | null;
  symbol: string;
  exchange: string;
  order_type: string;
  transaction_type: 'BUY' | 'SELL';
  quantity: number;
  price: number | null;
  trigger_price: number | null;
  status: 'PENDING' | 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
  order_id: string | null;
  executed_quantity: number;
  executed_price: number | null;
  created_at: string;
  updated_at: string;
};

export type Position = {
  id: string;
  user_id: string;
  broker_connection_id: string;
  symbol: string;
  exchange: string;
  product_type: string;
  quantity: number;
  average_price: number;
  current_price: number | null;
  pnl: number;
  pnl_percentage: number;
  created_at: string;
  updated_at: string;
};

export type Watchlist = {
  id: string;
  user_id: string;
  name: string;
  symbols: Array<{ symbol: string; exchange: string; [key: string]: unknown }>;
  created_at: string;
  updated_at: string;
};
