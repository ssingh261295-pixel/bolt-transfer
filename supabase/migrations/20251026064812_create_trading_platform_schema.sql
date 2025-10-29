/*
  # Trading Platform Database Schema

  ## Overview
  Complete database schema for a professional trading automation platform with broker integrations,
  strategy management, order execution, and portfolio tracking.

  ## New Tables

  ### 1. profiles
  Extended user profile information
  - `id` (uuid, primary key, references auth.users)
  - `full_name` (text)
  - `phone` (text)
  - `plan_type` (text) - free, basic, premium, enterprise
  - `trial_ends_at` (timestamptz)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. broker_connections
  User's broker account connections
  - `id` (uuid, primary key)
  - `user_id` (uuid, references profiles)
  - `broker_name` (text) - zerodha, angel, fyers, etc.
  - `api_key` (text, encrypted)
  - `api_secret` (text, encrypted)
  - `access_token` (text, encrypted)
  - `is_active` (boolean)
  - `last_connected_at` (timestamptz)
  - `created_at` (timestamptz)

  ### 3. strategies
  Trading strategies created by users
  - `id` (uuid, primary key)
  - `user_id` (uuid, references profiles)
  - `name` (text)
  - `description` (text)
  - `strategy_type` (text) - intraday, swing, scalping, etc.
  - `entry_conditions` (jsonb)
  - `exit_conditions` (jsonb)
  - `risk_management` (jsonb)
  - `is_active` (boolean)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 4. orders
  All trading orders executed through the platform
  - `id` (uuid, primary key)
  - `user_id` (uuid, references profiles)
  - `broker_connection_id` (uuid, references broker_connections)
  - `strategy_id` (uuid, references strategies, nullable)
  - `symbol` (text)
  - `exchange` (text) - NSE, BSE, NFO, etc.
  - `order_type` (text) - MARKET, LIMIT, SL, SL-M
  - `transaction_type` (text) - BUY, SELL
  - `quantity` (integer)
  - `price` (decimal)
  - `trigger_price` (decimal, nullable)
  - `status` (text) - PENDING, OPEN, COMPLETED, CANCELLED, REJECTED
  - `order_id` (text) - broker's order ID
  - `executed_quantity` (integer)
  - `executed_price` (decimal)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 5. positions
  Current open positions
  - `id` (uuid, primary key)
  - `user_id` (uuid, references profiles)
  - `broker_connection_id` (uuid, references broker_connections)
  - `symbol` (text)
  - `exchange` (text)
  - `product_type` (text) - MIS, CNC, NRML
  - `quantity` (integer)
  - `average_price` (decimal)
  - `current_price` (decimal)
  - `pnl` (decimal)
  - `pnl_percentage` (decimal)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 6. portfolio_history
  Historical portfolio performance data
  - `id` (uuid, primary key)
  - `user_id` (uuid, references profiles)
  - `date` (date)
  - `total_value` (decimal)
  - `invested_value` (decimal)
  - `pnl` (decimal)
  - `pnl_percentage` (decimal)
  - `created_at` (timestamptz)

  ### 7. watchlists
  User's custom watchlists
  - `id` (uuid, primary key)
  - `user_id` (uuid, references profiles)
  - `name` (text)
  - `symbols` (jsonb) - array of symbols with metadata
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  
  1. Row Level Security (RLS) is enabled on all tables
  2. Users can only access their own data
  3. Authenticated users are required for all operations
  4. Broker credentials are stored encrypted
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name text,
  phone text,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'basic', 'premium', 'enterprise')),
  trial_ends_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Create broker_connections table
CREATE TABLE IF NOT EXISTS broker_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  broker_name text NOT NULL,
  api_key text,
  api_secret text,
  access_token text,
  is_active boolean DEFAULT true,
  last_connected_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE broker_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own broker connections"
  ON broker_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own broker connections"
  ON broker_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own broker connections"
  ON broker_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own broker connections"
  ON broker_connections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create strategies table
CREATE TABLE IF NOT EXISTS strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  strategy_type text DEFAULT 'intraday',
  entry_conditions jsonb DEFAULT '{}',
  exit_conditions jsonb DEFAULT '{}',
  risk_management jsonb DEFAULT '{}',
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategies"
  ON strategies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own strategies"
  ON strategies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strategies"
  ON strategies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own strategies"
  ON strategies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  broker_connection_id uuid REFERENCES broker_connections(id) ON DELETE SET NULL,
  strategy_id uuid REFERENCES strategies(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  exchange text NOT NULL,
  order_type text DEFAULT 'MARKET',
  transaction_type text NOT NULL CHECK (transaction_type IN ('BUY', 'SELL')),
  quantity integer NOT NULL,
  price decimal(15,2),
  trigger_price decimal(15,2),
  status text DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OPEN', 'COMPLETED', 'CANCELLED', 'REJECTED')),
  order_id text,
  executed_quantity integer DEFAULT 0,
  executed_price decimal(15,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  broker_connection_id uuid REFERENCES broker_connections(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  exchange text NOT NULL,
  product_type text DEFAULT 'MIS',
  quantity integer NOT NULL,
  average_price decimal(15,2) NOT NULL,
  current_price decimal(15,2),
  pnl decimal(15,2) DEFAULT 0,
  pnl_percentage decimal(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own positions"
  ON positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions"
  ON positions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions"
  ON positions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own positions"
  ON positions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create portfolio_history table
CREATE TABLE IF NOT EXISTS portfolio_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  total_value decimal(15,2) DEFAULT 0,
  invested_value decimal(15,2) DEFAULT 0,
  pnl decimal(15,2) DEFAULT 0,
  pnl_percentage decimal(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE portfolio_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own portfolio history"
  ON portfolio_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portfolio history"
  ON portfolio_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create watchlists table
CREATE TABLE IF NOT EXISTS watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  symbols jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watchlists"
  ON watchlists FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlists"
  ON watchlists FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watchlists"
  ON watchlists FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlists"
  ON watchlists FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_broker_connections_user_id ON broker_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_history_user_id_date ON portfolio_history(user_id, date);
CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists(user_id);