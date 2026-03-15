/*
  # Create VIX Cache Table

  ## Summary
  Creates a lightweight cache table to store the latest India VIX value fetched
  from the Zerodha API. The tradingview-webhook edge function reads from this cache
  so it does not need to call the Zerodha LTP API on every incoming signal.

  ## New Tables
  - `vix_cache`
    - `id` (integer, primary key, always 1 — single-row table)
    - `vix_value` (numeric) — latest India VIX value
    - `fetched_at` (timestamptz) — when the value was last successfully fetched
    - `source_broker_id` (uuid) — which broker account was used to fetch
    - `raw_response` (jsonb) — raw Zerodha quote response for debugging

  ## Security
  - RLS enabled
  - Service role can read/write (used by edge functions only)
  - No direct user access (data is fetched server-side)

  ## Design Notes
  - Single-row pattern using id=1; use UPSERT to update
  - Cache TTL is enforced in application code (edge function) — typically 1-3 minutes
  - If the fetch fails, the last known VIX value is used with a stale flag
*/

CREATE TABLE IF NOT EXISTS public.vix_cache (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vix_value numeric(10, 4),
  fetched_at timestamptz DEFAULT now(),
  source_broker_id uuid REFERENCES public.broker_connections(id) ON DELETE SET NULL,
  raw_response jsonb,
  is_stale boolean DEFAULT false
);

ALTER TABLE public.vix_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage vix_cache"
  ON public.vix_cache
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert vix_cache"
  ON public.vix_cache
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update vix_cache"
  ON public.vix_cache
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
