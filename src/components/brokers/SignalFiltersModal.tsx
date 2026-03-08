import { useState, useEffect } from 'react';
import { X, Filter, Save, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MultiSelectFilter } from '../common/MultiSelectFilter';

interface SignalFiltersModalProps {
  broker: any;
  onClose: () => void;
  onSave: () => void;
}

export function SignalFiltersModal({ broker, onClose, onSave }: SignalFiltersModalProps) {
  const [filtersEnabled, setFiltersEnabled] = useState(broker.signal_filters_enabled || false);
  const [activeTab, setActiveTab] = useState<'global' | 'buy' | 'sell'>('global');

  const newConditionSet = (name: string) => ({
    name,
    enabled: false,
    volume_ratio: { min: 0.40, max: 100 },
    di_spread: { min: 15, max: 100 },
    adx: { min: 0, max: 35 },
    ema_distance: { min: 1.0, max: 100 }
  });

  const defaultBuyConditionSets = [
    { name: 'Option A', enabled: false, volume_ratio: { min: 0.40, max: 100 }, di_spread: { min: 15, max: 100 }, adx: { min: 0, max: 28 }, ema_distance: { min: 3.0, max: 100 } },
    { name: 'Option B', enabled: false, volume_ratio: { min: 0.39, max: 100 }, di_spread: { min: 20, max: 100 }, adx: { min: 0, max: 35 }, ema_distance: { min: 1.2, max: 2.3 } }
  ];

  const defaultSellConditionSets = [
    { name: 'Option C', enabled: false, volume_ratio: { min: 0.39, max: 100 }, di_spread: { min: 16.5, max: 100 }, adx: { min: 0, max: 35 }, ema_distance: { min: 1.2, max: 2.3 } },
    { name: 'Option D', enabled: false, volume_ratio: { min: 0.40, max: 100 }, di_spread: { min: 15, max: 100 }, adx: { min: 0, max: 35 }, ema_distance: { min: 3.0, max: 100 } }
  ];

  const defaultDirectionFilters = {
    trade_grade: { enabled: false, allowed_grades: ['A', 'B', 'C', 'D'] },
    trade_score: { enabled: false, min_score: 5.0 },
    entry_phase: { enabled: false, allowed_phases: ['EARLY', 'MID', 'OPTIMAL', 'LATE'] },
    adx: { enabled: false, min_value: 0, max_value: 100 },
    volume: { enabled: false, min_avg_volume_5d: 0 },
    price_range: { enabled: false, min_price: 0, max_price: 1000000 },
    dist_ema21_atr: { enabled: false, min_value: -10.0, max_value: 10.0 },
    volume_ratio: { enabled: false, min_value: 0.0, max_value: 10.0 },
    di_spread: { enabled: false, min_value: 0, max_value: 100 },
    rocket_rule: { enabled: false, volume_ratio_threshold: 0.70, lot_multiplier: 2, target_multiplier: 3.0 },
    condition_sets: []
  };

  const [filters, setFilters] = useState<any>({
    symbols: { mode: 'whitelist', list: [] },
    trade_types: { allow_buy: true, allow_sell: true },
    time_filters: { enabled: false, start_time: '09:15', end_time: '15:15', timezone: 'Asia/Kolkata' },
    buy_filters: defaultDirectionFilters,
    sell_filters: defaultDirectionFilters
  });

  const [symbolInput, setSymbolInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (broker.signal_filters && Object.keys(broker.signal_filters).length > 0) {
      const brokerFilters = broker.signal_filters;
      const buyFilters = brokerFilters.buy_filters || defaultDirectionFilters;
      const sellFilters = brokerFilters.sell_filters || defaultDirectionFilters;

      if (!buyFilters.condition_sets || buyFilters.condition_sets.length === 0) {
        buyFilters.condition_sets = defaultBuyConditionSets;
      }
      if (!sellFilters.condition_sets || sellFilters.condition_sets.length === 0) {
        sellFilters.condition_sets = defaultSellConditionSets;
      }

      setFilters({
        symbols: brokerFilters.symbols || filters.symbols,
        trade_types: brokerFilters.trade_types || filters.trade_types,
        time_filters: brokerFilters.time_filters || filters.time_filters,
        buy_filters: buyFilters,
        sell_filters: sellFilters
      });
    }
  }, [broker]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('broker_connections')
        .update({ signal_filters_enabled: filtersEnabled, signal_filters: filters })
        .eq('id', broker.id);
      if (updateError) throw updateError;
      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save filters');
    } finally {
      setSaving(false);
    }
  };

  const addSymbol = () => {
    const symbol = symbolInput.trim().toUpperCase();
    if (symbol && !filters.symbols.list.includes(symbol)) {
      setFilters({ ...filters, symbols: { ...filters.symbols, list: [...filters.symbols.list, symbol] } });
      setSymbolInput('');
    }
  };

  const removeSymbol = (symbol: string) => {
    setFilters({ ...filters, symbols: { ...filters.symbols, list: filters.symbols.list.filter((s: string) => s !== symbol) } });
  };

  const updateDirectionFilter = (direction: 'buy' | 'sell', filterKey: string, value: any) => {
    setFilters({ ...filters, [`${direction}_filters`]: { ...filters[`${direction}_filters`], [filterKey]: value } });
  };

  const updateConditionSet = (direction: 'buy' | 'sell', index: number, field: string, value: any) => {
    const directionFilters = filters[`${direction}_filters`];
    const conditionSets = [...(directionFilters.condition_sets || [])];
    conditionSets[index] = { ...conditionSets[index], [field]: value };
    updateDirectionFilter(direction, 'condition_sets', conditionSets);
  };

  const addConditionSet = (direction: 'buy' | 'sell') => {
    const directionFilters = filters[`${direction}_filters`];
    const conditionSets = [...(directionFilters.condition_sets || [])];
    const letter = String.fromCharCode(65 + conditionSets.length);
    conditionSets.push(newConditionSet(`Option ${letter}`));
    updateDirectionFilter(direction, 'condition_sets', conditionSets);
  };

  const removeConditionSet = (direction: 'buy' | 'sell', index: number) => {
    const directionFilters = filters[`${direction}_filters`];
    const conditionSets = [...(directionFilters.condition_sets || [])];
    conditionSets.splice(index, 1);
    updateDirectionFilter(direction, 'condition_sets', conditionSets);
  };

  const renameConditionSet = (direction: 'buy' | 'sell', index: number, name: string) => {
    updateConditionSet(direction, index, 'name', name);
  };

  const renderDirectionFilters = (direction: 'buy' | 'sell') => {
    const directionFilters = filters[`${direction}_filters`];
    const color = direction === 'buy' ? 'green' : 'red';
    const conditionSets = directionFilters.condition_sets || [];

    return (
      <div className="space-y-4">
        <div className={`border-2 border-${color}-300 bg-${color}-50 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={`font-bold text-${color}-900 text-lg`}>Dynamic Condition Sets (OR Logic)</h3>
            <button
              type="button"
              onClick={() => addConditionSet(direction)}
              className={`flex items-center gap-1.5 px-3 py-1.5 bg-${color}-600 text-white text-sm font-medium rounded-lg hover:bg-${color}-700 transition`}
            >
              <Plus className="w-4 h-4" />
              Add Set
            </button>
          </div>
          <p className={`text-sm text-${color}-700 mb-4`}>
            Signal passes if it matches <strong>ANY</strong> enabled set. Add as many sets as needed.
          </p>

          {conditionSets.length === 0 && (
            <div className={`text-center py-6 border-2 border-dashed border-${color}-300 rounded-lg`}>
              <p className={`text-sm text-${color}-600`}>No condition sets. Click "Add Set" to create one.</p>
            </div>
          )}

          <div className="space-y-4">
            {conditionSets.map((conditionSet: any, index: number) => (
              <div key={index} className={`bg-white border border-${color}-200 rounded-lg p-4`}>
                <div className="flex items-center gap-3 mb-4">
                  <input
                    type="text"
                    value={conditionSet.name}
                    onChange={(e) => renameConditionSet(direction, index, e.target.value)}
                    className={`flex-1 px-3 py-1.5 text-sm font-semibold border border-${color}-300 rounded-lg focus:ring-2 focus:ring-${color}-500 focus:border-transparent`}
                    placeholder="Set name"
                  />
                  <label className="flex items-center gap-2 shrink-0">
                    <input
                      type="checkbox"
                      checked={conditionSet.enabled}
                      onChange={(e) => updateConditionSet(direction, index, 'enabled', e.target.checked)}
                      className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`}
                    />
                    <span className={`text-sm font-medium text-${color}-700`}>Active</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeConditionSet(direction, index)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Remove this set"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Volume Ratio Min</label>
                    <input
                      type="number" step="0.01"
                      value={conditionSet.volume_ratio?.min ?? 0}
                      onChange={(e) => updateConditionSet(direction, index, 'volume_ratio', { ...conditionSet.volume_ratio, min: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Volume Ratio Max</label>
                    <input
                      type="number" step="0.01"
                      value={conditionSet.volume_ratio?.max ?? 100}
                      onChange={(e) => updateConditionSet(direction, index, 'volume_ratio', { ...conditionSet.volume_ratio, max: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">DI Spread Min</label>
                    <input
                      type="number" step="0.1"
                      value={conditionSet.di_spread?.min ?? 0}
                      onChange={(e) => updateConditionSet(direction, index, 'di_spread', { ...conditionSet.di_spread, min: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">DI Spread Max</label>
                    <input
                      type="number" step="0.1"
                      value={conditionSet.di_spread?.max ?? 100}
                      onChange={(e) => updateConditionSet(direction, index, 'di_spread', { ...conditionSet.di_spread, max: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">ADX Min</label>
                    <input
                      type="number" step="0.01"
                      value={conditionSet.adx?.min ?? 0}
                      onChange={(e) => updateConditionSet(direction, index, 'adx', { ...conditionSet.adx, min: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">ADX Max</label>
                    <input
                      type="number" step="0.01"
                      value={conditionSet.adx?.max ?? 100}
                      onChange={(e) => updateConditionSet(direction, index, 'adx', { ...conditionSet.adx, max: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">EMA Distance Min</label>
                    <input
                      type="number" step="0.1"
                      value={conditionSet.ema_distance?.min ?? 0}
                      onChange={(e) => updateConditionSet(direction, index, 'ema_distance', { ...conditionSet.ema_distance, min: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">EMA Distance Max</label>
                    <input
                      type="number" step="0.1"
                      value={conditionSet.ema_distance?.max ?? 100}
                      onChange={(e) => updateConditionSet(direction, index, 'ema_distance', { ...conditionSet.ema_distance, max: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {conditionSet.enabled && (
                  <div className={`mt-3 px-3 py-2 bg-${color}-50 rounded-lg border border-${color}-200`}>
                    <p className={`text-xs text-${color}-700 font-medium`}>
                      Active — signal passes if VR [{conditionSet.volume_ratio?.min}–{conditionSet.volume_ratio?.max}], DI [{conditionSet.di_spread?.min}–{conditionSet.di_spread?.max}], ADX [{conditionSet.adx?.min}–{conditionSet.adx?.max}], EMA dist [{conditionSet.ema_distance?.min}–{conditionSet.ema_distance?.max}]
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {conditionSets.length > 0 && (
            <div className={`mt-3 flex items-center justify-between`}>
              <p className={`text-xs text-${color}-700`}>
                {conditionSets.filter((cs: any) => cs.enabled).length} of {conditionSets.length} sets active
              </p>
              <button
                type="button"
                onClick={() => addConditionSet(direction)}
                className={`flex items-center gap-1 text-xs text-${color}-700 hover:text-${color}-900 font-medium transition`}
              >
                <Plus className="w-3.5 h-3.5" />
                Add another set
              </button>
            </div>
          )}
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Trade Grade</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.trade_grade?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'trade_grade', { ...directionFilters.trade_grade, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <MultiSelectFilter
            options={['A', 'B', 'C', 'D']}
            selectedValues={directionFilters.trade_grade?.allowed_grades || ['A', 'B', 'C', 'D']}
            onChange={(values) => updateDirectionFilter(direction, 'trade_grade', { ...directionFilters.trade_grade, allowed_grades: values })}
            label="Allowed Grades"
          />
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Trade Score</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.trade_score?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'trade_score', { ...directionFilters.trade_score, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Score</label>
            <input type="number" step="0.1"
              value={directionFilters.trade_score?.min_score ?? 5.0}
              onChange={(e) => updateDirectionFilter(direction, 'trade_score', { ...directionFilters.trade_score, min_score: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Entry Phase</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.entry_phase?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'entry_phase', { ...directionFilters.entry_phase, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <MultiSelectFilter
            options={['EARLY', 'MID', 'OPTIMAL', 'LATE']}
            selectedValues={directionFilters.entry_phase?.allowed_phases || ['EARLY', 'MID', 'OPTIMAL', 'LATE']}
            onChange={(values) => updateDirectionFilter(direction, 'entry_phase', { ...directionFilters.entry_phase, allowed_phases: values })}
            label="Allowed Phases"
          />
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">ADX Range</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.adx?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'adx', { ...directionFilters.adx, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Value</label>
              <input type="number" step="0.01" value={directionFilters.adx?.min_value ?? 0}
                onChange={(e) => updateDirectionFilter(direction, 'adx', { ...directionFilters.adx, min_value: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Value</label>
              <input type="number" step="0.01" value={directionFilters.adx?.max_value ?? 100}
                onChange={(e) => updateDirectionFilter(direction, 'adx', { ...directionFilters.adx, max_value: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Volume Filter</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.volume?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'volume', { ...directionFilters.volume, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Avg Volume (5D)</label>
            <input type="number" value={directionFilters.volume?.min_avg_volume_5d ?? 0}
              onChange={(e) => updateDirectionFilter(direction, 'volume', { ...directionFilters.volume, min_avg_volume_5d: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Price Range</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.price_range?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'price_range', { ...directionFilters.price_range, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Price</label>
              <input type="number" value={directionFilters.price_range?.min_price ?? 0}
                onChange={(e) => updateDirectionFilter(direction, 'price_range', { ...directionFilters.price_range, min_price: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Price</label>
              <input type="number" value={directionFilters.price_range?.max_price ?? 1000000}
                onChange={(e) => updateDirectionFilter(direction, 'price_range', { ...directionFilters.price_range, max_price: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Distance from EMA21 (ATR units)</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.dist_ema21_atr?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'dist_ema21_atr', { ...directionFilters.dist_ema21_atr, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Value</label>
              <input type="number" step="0.1" value={directionFilters.dist_ema21_atr?.min_value ?? -10.0}
                onChange={(e) => updateDirectionFilter(direction, 'dist_ema21_atr', { ...directionFilters.dist_ema21_atr, min_value: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Value</label>
              <input type="number" step="0.1" value={directionFilters.dist_ema21_atr?.max_value ?? 10.0}
                onChange={(e) => updateDirectionFilter(direction, 'dist_ema21_atr', { ...directionFilters.dist_ema21_atr, max_value: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Volume Ratio</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.volume_ratio?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'volume_ratio', { ...directionFilters.volume_ratio, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Value</label>
              <input type="number" step="0.1" value={directionFilters.volume_ratio?.min_value ?? 0.0}
                onChange={(e) => updateDirectionFilter(direction, 'volume_ratio', { ...directionFilters.volume_ratio, min_value: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Value</label>
              <input type="number" step="0.1" value={directionFilters.volume_ratio?.max_value ?? 10.0}
                onChange={(e) => updateDirectionFilter(direction, 'volume_ratio', { ...directionFilters.volume_ratio, max_value: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
        </div>

        <div className={`border border-${color}-200 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">DI Spread</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.di_spread?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'di_spread', { ...directionFilters.di_spread, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Value</label>
              <input type="number" value={directionFilters.di_spread?.min_value ?? 0}
                onChange={(e) => updateDirectionFilter(direction, 'di_spread', { ...directionFilters.di_spread, min_value: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Value</label>
              <input type="number" value={directionFilters.di_spread?.max_value ?? 100}
                onChange={(e) => updateDirectionFilter(direction, 'di_spread', { ...directionFilters.di_spread, max_value: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
        </div>

        <div className={`border border-${color}-200 bg-${color}-50 rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`font-semibold text-${color}-900`}>Rocket Rule</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={directionFilters.rocket_rule?.enabled ?? false}
                onChange={(e) => updateDirectionFilter(direction, 'rocket_rule', { ...directionFilters.rocket_rule, enabled: e.target.checked })}
                className={`w-4 h-4 text-${color}-600 rounded focus:ring-2 focus:ring-${color}-500`} />
              <span className={`text-sm text-${color}-700 font-medium`}>Enabled</span>
            </label>
          </div>
          <p className={`text-xs text-${color}-700 mb-4 font-medium`}>
            High-conviction trade trigger: When volume ratio exceeds threshold, uses custom multipliers below
          </p>
          <div className="space-y-3">
            <div>
              <label className={`block text-sm font-medium text-${color}-900 mb-1`}>Volume Ratio Threshold</label>
              <input type="number" step="0.01"
                value={directionFilters.rocket_rule?.volume_ratio_threshold ?? 0.70}
                onChange={(e) => updateDirectionFilter(direction, 'rocket_rule', { ...directionFilters.rocket_rule, volume_ratio_threshold: parseFloat(e.target.value) })}
                className={`w-full px-3 py-2 border border-${color}-300 rounded-lg focus:ring-2 focus:ring-${color}-500 focus:border-transparent`} />
              <p className={`text-xs text-${color}-600 mt-1`}>Trigger when volume/vol_avg_5d &gt;= this value (e.g., 0.70 = 70% of avg volume)</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-sm font-medium text-${color}-900 mb-1`}>Lot Multiplier</label>
                <input type="number" step="1" min="1"
                  value={directionFilters.rocket_rule?.lot_multiplier ?? 2}
                  onChange={(e) => updateDirectionFilter(direction, 'rocket_rule', { ...directionFilters.rocket_rule, lot_multiplier: parseInt(e.target.value) })}
                  className={`w-full px-3 py-2 border border-${color}-300 rounded-lg focus:ring-2 focus:ring-${color}-500 focus:border-transparent`} />
                <p className={`text-xs text-${color}-600 mt-1`}>Number of lots to trade</p>
              </div>
              <div>
                <label className={`block text-sm font-medium text-${color}-900 mb-1`}>Target Multiplier</label>
                <input type="number" step="0.1" min="0.1"
                  value={directionFilters.rocket_rule?.target_multiplier ?? 3.0}
                  onChange={(e) => updateDirectionFilter(direction, 'rocket_rule', { ...directionFilters.rocket_rule, target_multiplier: parseFloat(e.target.value) })}
                  className={`w-full px-3 py-2 border border-${color}-300 rounded-lg focus:ring-2 focus:ring-${color}-500 focus:border-transparent`} />
                <p className={`text-xs text-${color}-600 mt-1`}>Target reward multiplier</p>
              </div>
            </div>
            <div className={`p-3 bg-white rounded-lg border border-${color}-200`}>
              <p className={`text-xs text-${color}-700`}>
                <strong>Example:</strong> If volume ratio &gt;= {directionFilters.rocket_rule?.volume_ratio_threshold ?? 0.70}, order uses {directionFilters.rocket_rule?.lot_multiplier ?? 2} lots and target multiplier {directionFilters.rocket_rule?.target_multiplier ?? 3.0}x instead of NFO settings
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Filter className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Signal Filters</h2>
              <p className="text-sm text-gray-600">{broker.account_name || broker.account_holder_name || 'Broker Account'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">Account-Level Signal Filters</h3>
                <p className="text-sm text-blue-700">
                  Configure different filter conditions for BUY and SELL signals. All webhooks are logged regardless of filter result.
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={filtersEnabled} onChange={(e) => setFiltersEnabled(e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500" />
                <span className="text-sm font-medium text-blue-900">Enabled</span>
              </label>
            </div>
          </div>

          <div className="border-b border-gray-200">
            <div className="flex gap-2">
              {(['global', 'buy', 'sell'] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
                    activeTab === tab
                      ? tab === 'global' ? 'border-blue-600 text-blue-600'
                        : tab === 'buy' ? 'border-green-600 text-green-600'
                        : 'border-red-600 text-red-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'global' ? 'Global Filters' : tab === 'buy' ? 'BUY Filters' : 'SELL Filters'}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'global' && (
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Symbol Filter</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
                    <select value={filters.symbols.mode}
                      onChange={(e) => setFilters({ ...filters, symbols: { ...filters.symbols, mode: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                      <option value="whitelist">Whitelist (Only allow listed symbols)</option>
                      <option value="blacklist">Blacklist (Block listed symbols)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Symbols</label>
                    <div className="flex gap-2 mb-2">
                      <input type="text" value={symbolInput} onChange={(e) => setSymbolInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSymbol())}
                        placeholder="Enter symbol (e.g., NIFTY)"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                      <button type="button" onClick={addSymbol}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">Add</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {filters.symbols.list.map((symbol: string) => (
                        <span key={symbol} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                          {symbol}
                          <button type="button" onClick={() => removeSymbol(symbol)} className="hover:text-red-600 transition">
                            <X className="w-4 h-4" />
                          </button>
                        </span>
                      ))}
                    </div>
                    {filters.symbols.list.length === 0 && (
                      <p className="text-xs text-gray-500 mt-2">
                        {filters.symbols.mode === 'whitelist' ? 'Empty whitelist allows all symbols' : 'No symbols blocked'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Trade Type Filter</h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={filters.trade_types.allow_buy}
                      onChange={(e) => setFilters({ ...filters, trade_types: { ...filters.trade_types, allow_buy: e.target.checked } })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500" />
                    <span className="text-sm text-gray-700">Allow BUY signals</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={filters.trade_types.allow_sell}
                      onChange={(e) => setFilters({ ...filters, trade_types: { ...filters.trade_types, allow_sell: e.target.checked } })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500" />
                    <span className="text-sm text-gray-700">Allow SELL signals</span>
                  </label>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Time Window Filter</h3>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={filters.time_filters.enabled}
                      onChange={(e) => setFilters({ ...filters, time_filters: { ...filters.time_filters, enabled: e.target.checked } })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500" />
                    <span className="text-sm text-gray-700">Enabled</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                    <input type="time" value={filters.time_filters.start_time}
                      onChange={(e) => setFilters({ ...filters, time_filters: { ...filters.time_filters, start_time: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                    <input type="time" value={filters.time_filters.end_time}
                      onChange={(e) => setFilters({ ...filters, time_filters: { ...filters.time_filters, end_time: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">Timezone: Asia/Kolkata (IST)</p>
              </div>
            </div>
          )}

          {activeTab === 'buy' && renderDirectionFilters('buy')}
          {activeTab === 'sell' && renderDirectionFilters('sell')}
        </div>

        <div className="border-t border-gray-200 p-6 bg-gray-50">
          <div className="flex items-center justify-between">
            <button onClick={onClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Filters'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
