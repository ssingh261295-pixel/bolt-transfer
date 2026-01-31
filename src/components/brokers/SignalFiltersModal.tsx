import { useState, useEffect } from 'react';
import { X, Filter, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface SignalFiltersModalProps {
  broker: any;
  onClose: () => void;
  onSave: () => void;
}

export function SignalFiltersModal({ broker, onClose, onSave }: SignalFiltersModalProps) {
  const [filtersEnabled, setFiltersEnabled] = useState(broker.signal_filters_enabled || false);
  const [filters, setFilters] = useState<any>({
    symbols: { mode: 'whitelist', list: [] },
    trade_types: { allow_buy: true, allow_sell: true },
    time_filters: { enabled: false, start_time: '09:15', end_time: '15:15', timezone: 'Asia/Kolkata' },
    trade_grade: { enabled: false, min_grade: 'C' },
    trade_score: { enabled: false, min_score: 5.0 },
    entry_phase: { enabled: false, allowed_phases: ['EARLY', 'OPTIMAL', 'LATE'] },
    adx: { enabled: false, min_value: 0, max_value: 100 },
    volume: { enabled: false, min_avg_volume_5d: 0 },
    price_range: { enabled: false, min_price: 0, max_price: 1000000 }
  });
  const [symbolInput, setSymbolInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (broker.signal_filters && Object.keys(broker.signal_filters).length > 0) {
      setFilters({ ...filters, ...broker.signal_filters });
    }
  }, [broker]);

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      const { error: updateError } = await supabase
        .from('broker_connections')
        .update({
          signal_filters_enabled: filtersEnabled,
          signal_filters: filters
        })
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
      setFilters({
        ...filters,
        symbols: {
          ...filters.symbols,
          list: [...filters.symbols.list, symbol]
        }
      });
      setSymbolInput('');
    }
  };

  const removeSymbol = (symbol: string) => {
    setFilters({
      ...filters,
      symbols: {
        ...filters.symbols,
        list: filters.symbols.list.filter((s: string) => s !== symbol)
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Filter className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Signal Filters</h2>
              <p className="text-sm text-gray-600">
                {broker.account_name || broker.account_holder_name || 'Broker Account'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">Account-Level Signal Filters</h3>
                <p className="text-sm text-blue-700">
                  Configure conditions to accept or reject TradingView signals for this account. All webhooks are
                  logged regardless of filter result.
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filtersEnabled}
                  onChange={(e) => setFiltersEnabled(e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-blue-900">Enabled</span>
              </label>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Symbol Filter</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
                  <select
                    value={filters.symbols.mode}
                    onChange={(e) => setFilters({ ...filters, symbols: { ...filters.symbols, mode: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="whitelist">Whitelist (Only allow listed symbols)</option>
                    <option value="blacklist">Blacklist (Block listed symbols)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Symbols</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={symbolInput}
                      onChange={(e) => setSymbolInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSymbol())}
                      placeholder="Enter symbol (e.g., NIFTY)"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={addSymbol}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {filters.symbols.list.map((symbol: string) => (
                      <span
                        key={symbol}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                      >
                        {symbol}
                        <button
                          type="button"
                          onClick={() => removeSymbol(symbol)}
                          className="hover:text-red-600 transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </span>
                    ))}
                  </div>
                  {filters.symbols.list.length === 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      {filters.symbols.mode === 'whitelist'
                        ? 'Empty whitelist allows all symbols'
                        : 'No symbols blocked'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Trade Type Filter</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.trade_types.allow_buy}
                    onChange={(e) => setFilters({ ...filters, trade_types: { ...filters.trade_types, allow_buy: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Allow BUY signals</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.trade_types.allow_sell}
                    onChange={(e) => setFilters({ ...filters, trade_types: { ...filters.trade_types, allow_sell: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Allow SELL signals</span>
                </label>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Time Window Filter</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.time_filters.enabled}
                    onChange={(e) => setFilters({ ...filters, time_filters: { ...filters.time_filters, enabled: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={filters.time_filters.start_time}
                    onChange={(e) => setFilters({ ...filters, time_filters: { ...filters.time_filters, start_time: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input
                    type="time"
                    value={filters.time_filters.end_time}
                    onChange={(e) => setFilters({ ...filters, time_filters: { ...filters.time_filters, end_time: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Trade Grade Filter</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.trade_grade.enabled}
                    onChange={(e) => setFilters({ ...filters, trade_grade: { ...filters.trade_grade, enabled: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Grade</label>
                <select
                  value={filters.trade_grade.min_grade}
                  onChange={(e) => setFilters({ ...filters, trade_grade: { ...filters.trade_grade, min_grade: e.target.value } })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="A">A (Highest)</option>
                  <option value="B">B (High)</option>
                  <option value="C">C (Medium)</option>
                  <option value="D">D (Low)</option>
                </select>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Trade Score Filter</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.trade_score.enabled}
                    onChange={(e) => setFilters({ ...filters, trade_score: { ...filters.trade_score, enabled: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Score</label>
                <input
                  type="number"
                  step="0.1"
                  value={filters.trade_score.min_score}
                  onChange={(e) => setFilters({ ...filters, trade_score: { ...filters.trade_score, min_score: parseFloat(e.target.value) } })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Entry Phase Filter</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.entry_phase.enabled}
                    onChange={(e) => setFilters({ ...filters, entry_phase: { ...filters.entry_phase, enabled: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </label>
              </div>
              <div className="space-y-2">
                {['EARLY', 'OPTIMAL', 'LATE'].map((phase) => (
                  <label key={phase} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filters.entry_phase.allowed_phases.includes(phase)}
                      onChange={(e) => {
                        const newPhases = e.target.checked
                          ? [...filters.entry_phase.allowed_phases, phase]
                          : filters.entry_phase.allowed_phases.filter((p: string) => p !== phase);
                        setFilters({ ...filters, entry_phase: { ...filters.entry_phase, allowed_phases: newPhases } });
                      }}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{phase}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">ADX Filter</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.adx.enabled}
                    onChange={(e) => setFilters({ ...filters, adx: { ...filters.adx, enabled: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Value</label>
                  <input
                    type="number"
                    step="0.1"
                    value={filters.adx.min_value}
                    onChange={(e) => setFilters({ ...filters, adx: { ...filters.adx, min_value: parseFloat(e.target.value) } })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Value</label>
                  <input
                    type="number"
                    step="0.1"
                    value={filters.adx.max_value}
                    onChange={(e) => setFilters({ ...filters, adx: { ...filters.adx, max_value: parseFloat(e.target.value) } })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Volume Filter</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.volume.enabled}
                    onChange={(e) => setFilters({ ...filters, volume: { ...filters.volume, enabled: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min 5-Day Avg Volume</label>
                <input
                  type="number"
                  value={filters.volume.min_avg_volume_5d}
                  onChange={(e) => setFilters({ ...filters, volume: { ...filters.volume, min_avg_volume_5d: parseInt(e.target.value) } })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Price Range Filter</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.price_range.enabled}
                    onChange={(e) => setFilters({ ...filters, price_range: { ...filters.price_range, enabled: e.target.checked } })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Price</label>
                  <input
                    type="number"
                    value={filters.price_range.min_price}
                    onChange={(e) => setFilters({ ...filters, price_range: { ...filters.price_range, min_price: parseFloat(e.target.value) } })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Price</label>
                  <input
                    type="number"
                    value={filters.price_range.max_price}
                    onChange={(e) => setFilters({ ...filters, price_range: { ...filters.price_range, max_price: parseFloat(e.target.value) } })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : 'Save Filters'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
