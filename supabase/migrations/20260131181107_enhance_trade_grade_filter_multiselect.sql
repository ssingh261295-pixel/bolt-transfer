/*
  # Enhance Trade Grade Filter to Multi-Select

  1. Changes
    - Update get_default_signal_filters() function to use allowed_grades array instead of min_grade
    - Change trade_grade filter from minimum grade to multi-select allowed grades
    - Similar to entry_phase filter structure

  2. Schema Change
    Before: { "enabled": false, "min_grade": "C" }
    After:  { "enabled": false, "allowed_grades": ["A", "B", "C", "D"] }
*/

-- Update the get_default_signal_filters function with new trade_grade structure
CREATE OR REPLACE FUNCTION get_default_signal_filters()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT '{
    "symbols": {
      "mode": "whitelist",
      "list": []
    },
    "trade_types": {
      "allow_buy": true,
      "allow_sell": true
    },
    "time_filters": {
      "enabled": false,
      "start_time": "09:15",
      "end_time": "15:15",
      "timezone": "Asia/Kolkata"
    },
    "trade_grade": {
      "enabled": false,
      "allowed_grades": ["A", "B", "C", "D"]
    },
    "trade_score": {
      "enabled": false,
      "min_score": 5.0
    },
    "entry_phase": {
      "enabled": false,
      "allowed_phases": ["EARLY", "OPTIMAL", "LATE"]
    },
    "adx": {
      "enabled": false,
      "min_value": 0,
      "max_value": 100
    },
    "volume": {
      "enabled": false,
      "min_avg_volume_5d": 0
    },
    "price_range": {
      "enabled": false,
      "min_price": 0,
      "max_price": 1000000
    }
  }'::jsonb;
$$;

-- Update existing broker_connections that have old trade_grade structure
UPDATE broker_connections
SET signal_filters = jsonb_set(
  signal_filters,
  '{trade_grade}',
  jsonb_build_object(
    'enabled', 
    COALESCE((signal_filters->'trade_grade'->>'enabled')::boolean, false),
    'allowed_grades',
    CASE 
      WHEN signal_filters->'trade_grade'->>'min_grade' = 'A' THEN '["A"]'::jsonb
      WHEN signal_filters->'trade_grade'->>'min_grade' = 'B' THEN '["A", "B"]'::jsonb
      WHEN signal_filters->'trade_grade'->>'min_grade' = 'C' THEN '["A", "B", "C"]'::jsonb
      WHEN signal_filters->'trade_grade'->>'min_grade' = 'D' THEN '["A", "B", "C", "D"]'::jsonb
      ELSE '["A", "B", "C", "D"]'::jsonb
    END
  )
)
WHERE signal_filters IS NOT NULL 
  AND signal_filters ? 'trade_grade'
  AND signal_filters->'trade_grade' ? 'min_grade';

COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration object defining filter rules for TradingView signals. trade_grade.allowed_grades is an array of allowed grade values (A, B, C, D, F).';