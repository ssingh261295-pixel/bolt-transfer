/*
  # Create Watchlist Items Table
  
  1. New Tables
    - `watchlist_items`
      - `id` (uuid, primary key)
      - `watchlist_id` (uuid, foreign key to watchlists)
      - `instrument_token` (integer, instrument identifier)
      - `tradingsymbol` (text, symbol name)
      - `exchange` (text, exchange name)
      - `sort_order` (integer, display order)
      - `created_at` (timestamp)
  
  2. Security
    - Enable RLS on `watchlist_items` table
    - Add policy for authenticated users to manage their watchlist items
  
  3. Indexes
    - Add index on watchlist_id for faster lookups
    - Add composite unique index to prevent duplicate entries
*/

CREATE TABLE IF NOT EXISTS watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid REFERENCES watchlists(id) ON DELETE CASCADE NOT NULL,
  instrument_token integer NOT NULL,
  tradingsymbol text NOT NULL,
  exchange text NOT NULL DEFAULT 'NFO',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watchlist items"
  ON watchlist_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own watchlist items"
  ON watchlist_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own watchlist items"
  ON watchlist_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own watchlist items"
  ON watchlist_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM watchlists
      WHERE watchlists.id = watchlist_items.watchlist_id
      AND watchlists.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist_id ON watchlist_items(watchlist_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_items_unique ON watchlist_items(watchlist_id, instrument_token);
