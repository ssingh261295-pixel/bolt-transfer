/*
  # Add VIX-Based Regime System to Signal Filters

  ## Summary
  Adds a `regimes` array to the `signal_filters` JSONB column on `broker_connections`.
  Each regime defines market-condition-based trading rules that gate which engines
  (condition sets) are active based on VIX level, allowed days, time window, and
  which BUY/SELL engine options are permitted to fire.

  ## New Structure in signal_filters JSONB
  - `regimes`: Array of regime objects, each with:
    - `name`: Display name (e.g., "Regime 1 - Low VIX")
    - `enabled`: Master toggle for this regime
    - `vix_min`: Minimum VIX (inclusive, null = no lower bound)
    - `vix_max`: Maximum VIX (inclusive, null = no upper bound)
    - `allowed_days`: Array of day numbers 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
    - `time_start`: HH:MM IST start time
    - `time_end`: HH:MM IST end time
    - `allowed_buy_engines`: Array of condition set names allowed for BUY (e.g., ["Option A", "Option C"])
    - `allowed_sell_engines`: Array of condition set names allowed for SELL (e.g., ["Option D", "Option E"])
    - `wednesday_only_buy_engines`: Special override for Wednesday (null = use allowed_buy_engines)
    - `wednesday_only_sell_engines`: Special override for Wednesday (null = use allowed_sell_engines)

  ## Webhook Payload
  The webhook now supports a `vix` field in the payload for regime selection.
  If no regimes are enabled, the system falls through to the existing condition_sets logic.

  ## Notes
  - This is a non-destructive migration — no existing data is modified
  - Regimes are evaluated in order; the first matching regime wins
  - If regimes are configured, they override the day/time filter from global time_filters
    for the regime-specific time window
*/

DO $$
BEGIN
  -- No schema changes needed — the regime data lives in the existing JSONB column.
  -- This migration serves as documentation and sets up default regime templates
  -- via a DB comment update on the signal_filters column.
  
  COMMENT ON COLUMN public.broker_connections.signal_filters IS
    'JSONB configuration with global filters (symbols, trade_types, time_filters), '
    'direction-specific filters (buy_filters, sell_filters) with condition_sets, '
    'and optional regimes array for VIX-based market regime gating. '
    'Each regime: {name, enabled, vix_min, vix_max, allowed_days, time_start, time_end, '
    'allowed_buy_engines, allowed_sell_engines, wednesday_only_buy_engines, wednesday_only_sell_engines}. '
    'Webhook payload should include vix field for regime matching.';
END $$;
