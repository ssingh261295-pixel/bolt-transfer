/*
  # Allow authenticated users to read vix_cache

  The vix_cache table previously only allowed service_role to read.
  Authenticated users need to read VIX data for the watchlist display.
  This adds a SELECT policy for all authenticated users.
*/

CREATE POLICY "Authenticated users can read vix_cache"
  ON vix_cache
  FOR SELECT
  TO authenticated
  USING (true);
