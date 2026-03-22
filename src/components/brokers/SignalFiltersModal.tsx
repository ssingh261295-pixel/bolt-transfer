import { useState, useEffect, useMemo } from 'react';
import { X, Filter, Save, Plus, Trash2, ChevronDown, ChevronUp, Activity, AlertTriangle, ShieldCheck, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MultiSelectFilter } from '../common/MultiSelectFilter';

interface SignalFiltersModalProps {
  broker: any;
  onClose: () => void;
  onSave: () => void;
}

const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

function rangesOverlap(minA: number | null, maxA: number | null, minB: number | null, maxB: number | null): boolean {
  const lo1 = minA ?? -Infinity;
  const hi1 = maxA ?? Infinity;
  const lo2 = minB ?? -Infinity;
  const hi2 = maxB ?? Infinity;
  return lo1 <= hi2 && lo2 <= hi1;
}

function detectVixConflicts(regimes: any[]): string[] {
  const warnings: string[] = [];
  const enabled = regimes.map((r: any, i: number) => ({ ...r, _idx: i })).filter((r: any) => r.enabled);
  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i];
      const b = enabled[j];
      if (rangesOverlap(a.vix_min, a.vix_max, b.vix_min, b.vix_max)) {
        const fmt = (min: any, max: any) => `${min ?? '—'} to ${max ?? '—'}`;
        warnings.push(`"${a.name}" (VIX ${fmt(a.vix_min, a.vix_max)}) and "${b.name}" (VIX ${fmt(b.vix_min, b.vix_max)}) have overlapping VIX ranges — only the first matching regime will execute.`);
      }
    }
  }
  return warnings;
}

const DEFAULT_REGIME_BUY_OVERRIDES = {
  allow_buy: true,
  condition_sets_override: [],
  adx: { enabled: false, min_value: 0, max_value: 100 },
  volume_ratio: { enabled: false, min_value: 0.0, max_value: 10.0 },
  di_spread: { enabled: false, min_value: 0, max_value: 100 },
  dist_ema21_atr: { enabled: false, min_value: -10.0, max_value: 10.0 },
  rocket_rule: { enabled: false, volume_ratio_threshold: 0.70, lot_multiplier: 2, target_multiplier: 3.0 }
};

const DEFAULT_REGIME_SELL_OVERRIDES = {
  allow_sell: true,
  condition_sets_override: [],
  adx: { enabled: false, min_value: 0, max_value: 100 },
  volume_ratio: { enabled: false, min_value: 0.0, max_value: 10.0 },
  di_spread: { enabled: false, min_value: 0, max_value: 100 },
  dist_ema21_atr: { enabled: false, min_value: -10.0, max_value: 10.0 },
  rocket_rule: { enabled: false, volume_ratio_threshold: 0.70, lot_multiplier: 2, target_multiplier: 3.0 }
};

const DEFAULT_REGIMES = [
  {
    name: 'Regime 1 — Low VIX (≤18)',
    enabled: false,
    vix_min: null,
    vix_max: 18,
    allowed_days: [1, 2, 3, 4],
    time_start: '10:10',
    time_end: '14:20',
    allowed_buy_engines: ['Option A', 'Option B', 'Option C'],
    allowed_sell_engines: ['Option D', 'Option E', 'Option F', 'Option G'],
    wednesday_only_buy_engines: ['Option A', 'Option C'],
    wednesday_only_sell_engines: ['Option E'],
    rocket_rule_enabled: true,
    buy_overrides: { ...DEFAULT_REGIME_BUY_OVERRIDES, allow_buy: true },
    sell_overrides: { ...DEFAULT_REGIME_SELL_OVERRIDES, allow_sell: true }
  },
  {
    name: 'Regime 2 — Mid VIX (18–20)',
    enabled: false,
    vix_min: 18.01,
    vix_max: 20,
    allowed_days: [3, 4],
    time_start: '11:15',
    time_end: '13:20',
    allowed_buy_engines: [],
    allowed_sell_engines: ['Option D'],
    wednesday_only_buy_engines: null,
    wednesday_only_sell_engines: null,
    rocket_rule_enabled: false,
    sell_adx_override: { 'Option D': { max: 40 } },
    buy_overrides: { ...DEFAULT_REGIME_BUY_OVERRIDES, allow_buy: false },
    sell_overrides: { ...DEFAULT_REGIME_SELL_OVERRIDES, allow_sell: true }
  },
  {
    name: 'Regime 3 — High VIX (>20)',
    enabled: false,
    vix_min: 20.01,
    vix_max: null,
    allowed_days: [3, 4],
    time_start: '11:15',
    time_end: '13:20',
    allowed_buy_engines: [],
    allowed_sell_engines: ['Option D'],
    wednesday_only_buy_engines: null,
    wednesday_only_sell_engines: null,
    rocket_rule_enabled: false,
    sell_adx_override: { 'Option D': { max: 25 } },
    buy_overrides: { ...DEFAULT_REGIME_BUY_OVERRIDES, allow_buy: false },
    sell_overrides: { ...DEFAULT_REGIME_SELL_OVERRIDES, allow_sell: true }
  }
];

export function SignalFiltersModal({ broker, onClose, onSave }: SignalFiltersModalProps) {
  const [filtersEnabled, setFiltersEnabled] = useState(broker.signal_filters_enabled || false);
  const [activeTab, setActiveTab] = useState<'global' | 'buy' | 'sell' | 'regimes'>('global');
  const [expandedRegimes, setExpandedRegimes] = useState<Record<number, boolean>>({});
  const [expandedRegimeSections, setExpandedRegimeSections] = useState<Record<string, boolean>>({});

  const newConditionSet = (name: string) => ({
    name,
    enabled: false,
    volume_ratio: { min: 0.40, max: 100 },
    di_spread: { min: 15, max: 100 },
    adx: { min: 0, max: 35 },
    ema_distance: { min: 1.0, max: 100 },
    rocket_rule: { enabled: false, volume_ratio_threshold: 0.70, lot_multiplier: 2, target_multiplier: 3.0 }
  });

  const defaultRocketRule = { enabled: false, volume_ratio_threshold: 0.70, lot_multiplier: 2, target_multiplier: 3.0 };

  const defaultBuyConditionSets = [
    { name: 'Option A', enabled: false, volume_ratio: { min: 0.40, max: 100 }, di_spread: { min: 15, max: 100 }, adx: { min: 0, max: 28 }, ema_distance: { min: 3.0, max: 100 }, rocket_rule: { ...defaultRocketRule } },
    { name: 'Option B', enabled: false, volume_ratio: { min: 0.45, max: 100 }, di_spread: { min: 20, max: 100 }, adx: { min: 0, max: 35 }, ema_distance: { min: 1.2, max: 2.3 }, rocket_rule: { ...defaultRocketRule } },
    { name: 'Option C', enabled: false, volume_ratio: { min: 0.30, max: 100 }, di_spread: { min: 10, max: 100 }, adx: { min: 35.1, max: 100 }, ema_distance: { min: 1.5, max: 4.0 }, rocket_rule: { ...defaultRocketRule } }
  ];

  const defaultSellConditionSets = [
    { name: 'Option D', enabled: false, volume_ratio: { min: 0.39, max: 100 }, di_spread: { min: 16.5, max: 100 }, adx: { min: 0, max: 35 }, ema_distance: { min: 1.2, max: 2.3 }, rocket_rule: { ...defaultRocketRule } },
    { name: 'Option E', enabled: false, volume_ratio: { min: 0.40, max: 100 }, di_spread: { min: 18, max: 100 }, adx: { min: 0, max: 35 }, ema_distance: { min: 3.0, max: 100 }, rocket_rule: { ...defaultRocketRule } },
    { name: 'Option F', enabled: false, volume_ratio: { min: 0.20, max: 100 }, di_spread: { min: 20, max: 100 }, adx: { min: 0, max: 25 }, ema_distance: { min: 1.5, max: 100 }, rocket_rule: { ...defaultRocketRule } },
    { name: 'Option G', enabled: false, volume_ratio: { min: 0.40, max: 100 }, di_spread: { min: 10, max: 100 }, adx: { min: 0, max: 30 }, ema_distance: { min: 1.2, max: 2.3 }, rocket_rule: { ...defaultRocketRule } }
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
    trade_enabled: true,
    symbols: { mode: 'whitelist', list: [] },
    trade_types: { allow_buy: true, allow_sell: true },
    days_filter: { enabled: false, allowed_days: [1, 2, 3, 4, 5] },
    time_filters: { enabled: false, start_time: '09:15', end_time: '15:15', timezone: 'Asia/Kolkata' },
    buy_filters: { ...defaultDirectionFilters, condition_sets: defaultBuyConditionSets },
    sell_filters: { ...defaultDirectionFilters, condition_sets: defaultSellConditionSets },
    regimes: DEFAULT_REGIMES
  });

  const [symbolInput, setSymbolInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (broker.signal_filters && Object.keys(broker.signal_filters).length > 0) {
      const brokerFilters = broker.signal_filters;
      const buyFilters = brokerFilters.buy_filters || { ...defaultDirectionFilters };
      const sellFilters = brokerFilters.sell_filters || { ...defaultDirectionFilters };

      if (!buyFilters.condition_sets || buyFilters.condition_sets.length === 0) {
        buyFilters.condition_sets = defaultBuyConditionSets;
      }
      if (!sellFilters.condition_sets || sellFilters.condition_sets.length === 0) {
        sellFilters.condition_sets = defaultSellConditionSets;
      }

      const migrateConditionSets = (sets: any[], oldRocketRule: any) =>
        sets.map((cs: any) => ({
          ...cs,
          rocket_rule: cs.rocket_rule ?? (oldRocketRule ? { ...oldRocketRule } : { ...defaultRocketRule })
        }));

      buyFilters.condition_sets = migrateConditionSets(buyFilters.condition_sets, buyFilters.rocket_rule);
      sellFilters.condition_sets = migrateConditionSets(sellFilters.condition_sets, sellFilters.rocket_rule);

      const regimes = (brokerFilters.regimes || DEFAULT_REGIMES).map((r: any) => ({
        ...r,
        buy_overrides: r.buy_overrides || { ...DEFAULT_REGIME_BUY_OVERRIDES, allow_buy: true },
        sell_overrides: r.sell_overrides || { ...DEFAULT_REGIME_SELL_OVERRIDES, allow_sell: true }
      }));

      setFilters({
        trade_enabled: brokerFilters.trade_enabled !== undefined ? brokerFilters.trade_enabled : true,
        symbols: brokerFilters.symbols || filters.symbols,
        trade_types: brokerFilters.trade_types || filters.trade_types,
        days_filter: brokerFilters.days_filter || { enabled: false, allowed_days: [1, 2, 3, 4, 5] },
        time_filters: brokerFilters.time_filters || filters.time_filters,
        buy_filters: buyFilters,
        sell_filters: sellFilters,
        regimes
      });
    }
  }, [broker]);

  const vixConflicts = useMemo(() => detectVixConflicts(filters.regimes || []), [filters.regimes]);

  const handleSave = async () => {
    if (vixConflicts.length > 0) {
      setError(`Cannot save: Fix VIX range conflicts first.\n${vixConflicts.join('\n')}`);
      return;
    }
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

  const updateRegime = (index: number, field: string, value: any) => {
    const regimes = [...(filters.regimes || [])];
    regimes[index] = { ...regimes[index], [field]: value };
    setFilters({ ...filters, regimes });
  };

  const updateRegimeBuyOverride = (regimeIndex: number, field: string, value: any) => {
    const regimes = [...(filters.regimes || [])];
    regimes[regimeIndex] = {
      ...regimes[regimeIndex],
      buy_overrides: { ...(regimes[regimeIndex].buy_overrides || DEFAULT_REGIME_BUY_OVERRIDES), [field]: value }
    };
    setFilters({ ...filters, regimes });
  };

  const updateRegimeSellOverride = (regimeIndex: number, field: string, value: any) => {
    const regimes = [...(filters.regimes || [])];
    regimes[regimeIndex] = {
      ...regimes[regimeIndex],
      sell_overrides: { ...(regimes[regimeIndex].sell_overrides || DEFAULT_REGIME_SELL_OVERRIDES), [field]: value }
    };
    setFilters({ ...filters, regimes });
  };

  const addRegime = () => {
    const regimes = [...(filters.regimes || [])];
    regimes.push({
      name: `Regime ${regimes.length + 1}`,
      enabled: false,
      vix_min: null,
      vix_max: null,
      allowed_days: [1, 2, 3, 4, 5],
      time_start: '09:15',
      time_end: '15:15',
      allowed_buy_engines: [],
      allowed_sell_engines: [],
      wednesday_only_buy_engines: null,
      wednesday_only_sell_engines: null,
      rocket_rule_enabled: false,
      buy_overrides: { ...DEFAULT_REGIME_BUY_OVERRIDES, allow_buy: true },
      sell_overrides: { ...DEFAULT_REGIME_SELL_OVERRIDES, allow_sell: true }
    });
    setFilters({ ...filters, regimes });
    setExpandedRegimes({ ...expandedRegimes, [regimes.length - 1]: true });
  };

  const removeRegime = (index: number) => {
    const regimes = [...(filters.regimes || [])];
    regimes.splice(index, 1);
    setFilters({ ...filters, regimes });
  };

  const toggleEngineInList = (index: number, field: string, engineName: string) => {
    const regime = filters.regimes[index];
    const list: string[] = [...(regime[field] || [])];
    const idx = list.indexOf(engineName);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(engineName);
    updateRegime(index, field, list);
  };

  const getBuyEngineNames = () => (filters.buy_filters?.condition_sets || []).map((cs: any) => cs.name).filter(Boolean);
  const getSellEngineNames = () => (filters.sell_filters?.condition_sets || []).map((cs: any) => cs.name).filter(Boolean);

  const toggleRegimeSection = (key: string) => {
    setExpandedRegimeSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderEngineToggleList = (regimeIndex: number, field: string, engineNames: string[], color: 'green' | 'red') => {
    const regime = filters.regimes[regimeIndex];
    const active: string[] = regime[field] || [];
    if (engineNames.length === 0) {
      return <p className="text-xs text-gray-400 italic">No engines defined yet. Add condition sets in the {color === 'green' ? 'BUY' : 'SELL'} Filters tab first.</p>;
    }
    return (
      <div className="flex flex-wrap gap-2">
        {engineNames.map((name) => {
          const isOn = active.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggleEngineInList(regimeIndex, field, name)}
              className={`px-3 py-1 text-xs font-semibold rounded-full border transition ${
                isOn
                  ? color === 'green'
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
    );
  };

  const renderRegimeAdxOverride = (regimeIndex: number, engineName: string) => {
    const regime = filters.regimes[regimeIndex];
    const overrides = regime.sell_adx_override || {};
    const override = overrides[engineName] || {};
    const updateOverride = (key: string, val: any) => {
      const newOverrides = { ...overrides, [engineName]: { ...override, [key]: val } };
      updateRegime(regimeIndex, 'sell_adx_override', newOverrides);
    };
    return (
      <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-lg">
        <p className="text-xs font-semibold text-orange-800 mb-2">ADX Override for {engineName}</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">ADX Min Override</label>
            <input
              type="number" step="0.1"
              placeholder="(use engine default)"
              value={override.min ?? ''}
              onChange={(e) => updateOverride('min', e.target.value === '' ? undefined : parseFloat(e.target.value))}
              className="w-full px-2 py-1 text-xs border border-orange-300 rounded focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">ADX Max Override</label>
            <input
              type="number" step="0.1"
              placeholder="(use engine default)"
              value={override.max ?? ''}
              onChange={(e) => updateOverride('max', e.target.value === '' ? undefined : parseFloat(e.target.value))}
              className="w-full px-2 py-1 text-xs border border-orange-300 rounded focus:ring-1 focus:ring-orange-500"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderRegimeDirectionOverrides = (regimeIndex: number, direction: 'buy' | 'sell') => {
    const regime = filters.regimes[regimeIndex];
    const overrides = direction === 'buy'
      ? (regime.buy_overrides || DEFAULT_REGIME_BUY_OVERRIDES)
      : (regime.sell_overrides || DEFAULT_REGIME_SELL_OVERRIDES);
    const updateOverride = direction === 'buy' ? updateRegimeBuyOverride : updateRegimeSellOverride;
    const allowKey = direction === 'buy' ? 'allow_buy' : 'allow_sell';
    const isAllowed: boolean = overrides[allowKey] !== false;
    const color = direction === 'buy' ? 'green' : 'red';
    const Icon = direction === 'buy' ? TrendingUp : TrendingDown;
    const engineNames = direction === 'buy' ? getBuyEngineNames() : getSellEngineNames();
    const engineField = direction === 'buy' ? 'allowed_buy_engines' : 'allowed_sell_engines';
    const wedEngineField = direction === 'buy' ? 'wednesday_only_buy_engines' : 'wednesday_only_sell_engines';
    const sectionKey = `${regimeIndex}_${direction}`;
    const isExpanded = expandedRegimeSections[sectionKey] ?? false;

    return (
      <div className={`border-2 rounded-xl overflow-hidden ${isAllowed ? `border-${color}-300` : 'border-gray-200'}`}>
        <div
          className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none ${isAllowed ? `bg-${color}-50` : 'bg-gray-50'}`}
          onClick={() => toggleRegimeSection(sectionKey)}
        >
          <Icon className={`w-4 h-4 ${isAllowed ? `text-${color}-600` : 'text-gray-400'}`} />
          <span className={`font-semibold text-sm flex-1 ${isAllowed ? `text-${color}-900` : 'text-gray-500'}`}>
            {direction.toUpperCase()} Signals
          </span>
          <label className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-gray-600">Allow {direction.toUpperCase()}</span>
            <input
              type="checkbox"
              checked={isAllowed}
              onChange={(e) => updateOverride(regimeIndex, allowKey, e.target.checked)}
              className={`w-4 h-4 text-${color}-600 rounded`}
            />
          </label>
          {isAllowed
            ? <span className={`text-xs font-semibold px-2 py-0.5 bg-${color}-600 text-white rounded-full`}>ON</span>
            : <span className="text-xs font-semibold px-2 py-0.5 bg-gray-300 text-gray-600 rounded-full">OFF</span>
          }
          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>

        {isExpanded && isAllowed && (
          <div className="p-4 space-y-4 border-t border-gray-100 bg-white">
            <div className={`border border-${color}-200 rounded-lg p-3`}>
              <h5 className={`text-sm font-semibold text-${color}-800 mb-2`}>Allowed Engines (all days)</h5>
              {renderEngineToggleList(regimeIndex, engineField, engineNames, color)}
              {direction === 'sell' && (regime[engineField] || []).map((engineName: string) => (
                <div key={engineName} className="mt-2">
                  {renderRegimeAdxOverride(regimeIndex, engineName)}
                </div>
              ))}
            </div>

            <div className={`border border-${color}-100 bg-${color}-50 rounded-lg p-3`}>
              <div className="flex items-center justify-between mb-2">
                <h5 className={`text-sm font-semibold text-${color}-800`}>Wednesday Override</h5>
                <label className={`flex items-center gap-1.5 text-xs text-${color}-700`}>
                  <input
                    type="checkbox"
                    checked={regime[wedEngineField] !== null && regime[wedEngineField] !== undefined}
                    onChange={(e) => updateRegime(regimeIndex, wedEngineField, e.target.checked ? [] : null)}
                    className="w-3.5 h-3.5"
                  />
                  Enable Wed override
                </label>
              </div>
              {regime[wedEngineField] !== null && regime[wedEngineField] !== undefined
                ? renderEngineToggleList(regimeIndex, wedEngineField, engineNames, color)
                : <p className="text-xs text-gray-400 italic">Not set — uses all-days list on Wednesdays.</p>
              }
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={`border border-${color}-200 rounded-lg p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-700">ADX Range Override</label>
                  <input
                    type="checkbox"
                    checked={overrides.adx?.enabled ?? false}
                    onChange={(e) => updateOverride(regimeIndex, 'adx', { ...overrides.adx, enabled: e.target.checked })}
                    className="w-3.5 h-3.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Min</label>
                    <input type="number" step="0.1"
                      value={overrides.adx?.min_value ?? 0}
                      onChange={(e) => updateOverride(regimeIndex, 'adx', { ...overrides.adx, min_value: parseFloat(e.target.value) })}
                      disabled={!overrides.adx?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Max</label>
                    <input type="number" step="0.1"
                      value={overrides.adx?.max_value ?? 100}
                      onChange={(e) => updateOverride(regimeIndex, 'adx', { ...overrides.adx, max_value: parseFloat(e.target.value) })}
                      disabled={!overrides.adx?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div className={`border border-${color}-200 rounded-lg p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-700">Volume Ratio Override</label>
                  <input
                    type="checkbox"
                    checked={overrides.volume_ratio?.enabled ?? false}
                    onChange={(e) => updateOverride(regimeIndex, 'volume_ratio', { ...overrides.volume_ratio, enabled: e.target.checked })}
                    className="w-3.5 h-3.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Min</label>
                    <input type="number" step="0.01"
                      value={overrides.volume_ratio?.min_value ?? 0}
                      onChange={(e) => updateOverride(regimeIndex, 'volume_ratio', { ...overrides.volume_ratio, min_value: parseFloat(e.target.value) })}
                      disabled={!overrides.volume_ratio?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Max</label>
                    <input type="number" step="0.01"
                      value={overrides.volume_ratio?.max_value ?? 10}
                      onChange={(e) => updateOverride(regimeIndex, 'volume_ratio', { ...overrides.volume_ratio, max_value: parseFloat(e.target.value) })}
                      disabled={!overrides.volume_ratio?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div className={`border border-${color}-200 rounded-lg p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-700">DI Spread Override</label>
                  <input
                    type="checkbox"
                    checked={overrides.di_spread?.enabled ?? false}
                    onChange={(e) => updateOverride(regimeIndex, 'di_spread', { ...overrides.di_spread, enabled: e.target.checked })}
                    className="w-3.5 h-3.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Min</label>
                    <input type="number" step="0.1"
                      value={overrides.di_spread?.min_value ?? 0}
                      onChange={(e) => updateOverride(regimeIndex, 'di_spread', { ...overrides.di_spread, min_value: parseFloat(e.target.value) })}
                      disabled={!overrides.di_spread?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Max</label>
                    <input type="number" step="0.1"
                      value={overrides.di_spread?.max_value ?? 100}
                      onChange={(e) => updateOverride(regimeIndex, 'di_spread', { ...overrides.di_spread, max_value: parseFloat(e.target.value) })}
                      disabled={!overrides.di_spread?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div className={`border border-${color}-200 rounded-lg p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-700">EMA Dist Override</label>
                  <input
                    type="checkbox"
                    checked={overrides.dist_ema21_atr?.enabled ?? false}
                    onChange={(e) => updateOverride(regimeIndex, 'dist_ema21_atr', { ...overrides.dist_ema21_atr, enabled: e.target.checked })}
                    className="w-3.5 h-3.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Min</label>
                    <input type="number" step="0.1"
                      value={overrides.dist_ema21_atr?.min_value ?? -10}
                      onChange={(e) => updateOverride(regimeIndex, 'dist_ema21_atr', { ...overrides.dist_ema21_atr, min_value: parseFloat(e.target.value) })}
                      disabled={!overrides.dist_ema21_atr?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Max</label>
                    <input type="number" step="0.1"
                      value={overrides.dist_ema21_atr?.max_value ?? 10}
                      onChange={(e) => updateOverride(regimeIndex, 'dist_ema21_atr', { ...overrides.dist_ema21_atr, max_value: parseFloat(e.target.value) })}
                      disabled={!overrides.dist_ema21_atr?.enabled}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className={`border border-amber-200 bg-amber-50 rounded-lg p-3`}>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-900">Rocket Rule</span>
                <label className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs text-amber-700">Enabled</span>
                  <input
                    type="checkbox"
                    checked={overrides.rocket_rule?.enabled ?? false}
                    onChange={(e) => updateOverride(regimeIndex, 'rocket_rule', { ...overrides.rocket_rule, enabled: e.target.checked })}
                    className="w-4 h-4 text-amber-600 rounded"
                  />
                </label>
              </div>
              {overrides.rocket_rule?.enabled && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">VR Threshold</label>
                    <input type="number" step="0.01"
                      value={overrides.rocket_rule?.volume_ratio_threshold ?? 0.70}
                      onChange={(e) => updateOverride(regimeIndex, 'rocket_rule', { ...overrides.rocket_rule, volume_ratio_threshold: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1 text-xs border border-amber-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Lot Multiplier</label>
                    <input type="number" step="1" min="1"
                      value={overrides.rocket_rule?.lot_multiplier ?? 2}
                      onChange={(e) => updateOverride(regimeIndex, 'rocket_rule', { ...overrides.rocket_rule, lot_multiplier: parseInt(e.target.value) })}
                      className="w-full px-2 py-1 text-xs border border-amber-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Target Multiplier</label>
                    <input type="number" step="0.1" min="0.1"
                      value={overrides.rocket_rule?.target_multiplier ?? 3.0}
                      onChange={(e) => updateOverride(regimeIndex, 'rocket_rule', { ...overrides.rocket_rule, target_multiplier: parseFloat(e.target.value) })}
                      className="w-full px-2 py-1 text-xs border border-amber-300 rounded"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {isExpanded && !isAllowed && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-400 italic">{direction.toUpperCase()} signals are disabled for this regime. Enable to configure.</p>
          </div>
        )}
      </div>
    );
  };

  const renderRegimes = () => {
    const regimes = filters.regimes || [];

    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Activity className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-1">VIX-Based Market Regimes</h3>
              <p className="text-sm text-blue-700">
                Each regime activates based on VIX level fetched live from Zerodha. Configure BUY/SELL enable,
                allowed engines, and override filters per regime. The <strong>first matching enabled regime</strong> controls execution.
                <strong> If no regime matches, the trade is rejected.</strong> Regimes are required when configured — there is no fallback.
              </p>
            </div>
          </div>
        </div>

        {vixConflicts.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span className="font-semibold text-amber-900 text-sm">VIX Range Conflicts Detected</span>
            </div>
            {vixConflicts.map((w, i) => (
              <p key={i} className="text-xs text-amber-800 pl-7">{w}</p>
            ))}
            <p className="text-xs text-amber-700 pl-7 font-medium">Fix overlapping VIX ranges before saving. You cannot save with conflicts.</p>
          </div>
        )}

        {regimes.length === 0 && (
          <div className="text-center py-10 border-2 border-dashed border-gray-300 rounded-lg">
            <Activity className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No regimes configured. Click "Add Regime" to start.</p>
          </div>
        )}

        {regimes.map((regime: any, idx: number) => {
          const isExpanded = expandedRegimes[idx] ?? false;
          const buyEnabled = regime.buy_overrides?.allow_buy !== false;
          const sellEnabled = regime.sell_overrides?.allow_sell !== false;
          const hasConflict = vixConflicts.some(w => w.includes(`"${regime.name}"`));

          return (
            <div key={idx} className={`border-2 rounded-xl overflow-hidden ${
              hasConflict ? 'border-amber-400' : regime.enabled ? 'border-blue-400' : 'border-gray-200'
            }`}>
              <div
                className={`flex items-center gap-3 p-4 cursor-pointer select-none ${
                  hasConflict ? 'bg-amber-50' : regime.enabled ? 'bg-blue-50' : 'bg-gray-50'
                }`}
                onClick={() => setExpandedRegimes({ ...expandedRegimes, [idx]: !isExpanded })}
              >
                <label className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={regime.enabled}
                    onChange={(e) => updateRegime(idx, 'enabled', e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                </label>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={regime.name}
                    onChange={(e) => { e.stopPropagation(); updateRegime(idx, 'name', e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    className={`font-semibold text-sm bg-transparent border-none outline-none w-full ${regime.enabled ? 'text-blue-900' : 'text-gray-700'}`}
                  />
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-500">
                      VIX: {regime.vix_min ?? '—'} to {regime.vix_max ?? '—'}
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="text-xs text-gray-500">
                      {(regime.allowed_days || []).map((d: number) => DAY_LABELS[d]).join(', ')}
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="text-xs text-gray-500">{regime.time_start}–{regime.time_end}</span>
                    <span className="text-gray-300">|</span>
                    <span className={`text-xs font-medium ${buyEnabled ? 'text-green-700' : 'text-gray-400'}`}>
                      BUY: {buyEnabled ? 'ON' : 'OFF'}
                    </span>
                    <span className={`text-xs font-medium ${sellEnabled ? 'text-red-700' : 'text-gray-400'}`}>
                      SELL: {sellEnabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasConflict && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  {regime.enabled && !hasConflict && (
                    <span className="px-2 py-0.5 bg-blue-600 text-white text-xs font-semibold rounded-full">ACTIVE</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeRegime(idx); }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </div>

              {isExpanded && (
                <div className="p-4 space-y-5 border-t border-gray-200 bg-white">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">VIX Min (inclusive, empty = no lower bound)</label>
                      <input
                        type="number" step="0.01" placeholder="No lower bound"
                        value={regime.vix_min ?? ''}
                        onChange={(e) => updateRegime(idx, 'vix_min', e.target.value === '' ? null : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">VIX Max (inclusive, empty = no upper bound)</label>
                      <input
                        type="number" step="0.01" placeholder="No upper bound"
                        value={regime.vix_max ?? ''}
                        onChange={(e) => updateRegime(idx, 'vix_max', e.target.value === '' ? null : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Days</label>
                    <div className="flex gap-2 flex-wrap">
                      {[1, 2, 3, 4, 5].map((day) => {
                        const isActive = (regime.allowed_days || []).includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              const days = [...(regime.allowed_days || [])];
                              const di = days.indexOf(day);
                              if (di >= 0) days.splice(di, 1); else days.push(day);
                              days.sort();
                              updateRegime(idx, 'allowed_days', days);
                            }}
                            className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition ${
                              isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'
                            }`}
                          >
                            {DAY_LABELS[day]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Time Start (IST)</label>
                      <input
                        type="time"
                        value={regime.time_start || '09:15'}
                        onChange={(e) => updateRegime(idx, 'time_start', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Time End (IST)</label>
                      <input
                        type="time"
                        value={regime.time_end || '15:15'}
                        onChange={(e) => updateRegime(idx, 'time_end', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      <h4 className="font-semibold text-gray-900 text-sm">Signal Direction Settings</h4>
                    </div>
                    {renderRegimeDirectionOverrides(idx, 'buy')}
                    {renderRegimeDirectionOverrides(idx, 'sell')}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addRegime}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-blue-300 text-blue-600 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add Regime
        </button>
      </div>
    );
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
            Signal passes if it matches <strong>ANY</strong> enabled set. Regime rules may further restrict which sets can fire.
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

                <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-xs font-semibold text-amber-900">Rocket Rule</span>
                    <label className="flex items-center gap-1.5 ml-auto">
                      <span className="text-xs text-amber-700">Enabled</span>
                      <input
                        type="checkbox"
                        checked={conditionSet.rocket_rule?.enabled ?? false}
                        onChange={(e) => updateConditionSet(direction, index, 'rocket_rule', { ...(conditionSet.rocket_rule ?? defaultRocketRule), enabled: e.target.checked })}
                        className="w-3.5 h-3.5 text-amber-600 rounded"
                      />
                    </label>
                  </div>
                  {conditionSet.rocket_rule?.enabled && (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">VR Threshold</label>
                        <input type="number" step="0.01"
                          value={conditionSet.rocket_rule?.volume_ratio_threshold ?? 0.70}
                          onChange={(e) => updateConditionSet(direction, index, 'rocket_rule', { ...conditionSet.rocket_rule, volume_ratio_threshold: parseFloat(e.target.value) })}
                          className="w-full px-2 py-1 text-xs border border-amber-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Lot Multiplier</label>
                        <input type="number" step="1" min="1"
                          value={conditionSet.rocket_rule?.lot_multiplier ?? 2}
                          onChange={(e) => updateConditionSet(direction, index, 'rocket_rule', { ...conditionSet.rocket_rule, lot_multiplier: parseInt(e.target.value) })}
                          className="w-full px-2 py-1 text-xs border border-amber-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Target Multiplier</label>
                        <input type="number" step="0.1" min="0.1"
                          value={conditionSet.rocket_rule?.target_multiplier ?? 3.0}
                          onChange={(e) => updateConditionSet(direction, index, 'rocket_rule', { ...conditionSet.rocket_rule, target_multiplier: parseFloat(e.target.value) })}
                          className="w-full px-2 py-1 text-xs border border-amber-300 rounded"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {conditionSet.enabled && (
                  <div className={`mt-3 px-3 py-2 bg-${color}-50 rounded-lg border border-${color}-200`}>
                    <p className={`text-xs text-${color}-700 font-medium`}>
                      Active — VR [{conditionSet.volume_ratio?.min}–{conditionSet.volume_ratio?.max}], DI [{conditionSet.di_spread?.min}–{conditionSet.di_spread?.max}], ADX [{conditionSet.adx?.min}–{conditionSet.adx?.max}], EMA [{conditionSet.ema_distance?.min}–{conditionSet.ema_distance?.max}]
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {conditionSets.length > 0 && (
            <div className="mt-3 flex items-center justify-between">
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

      </div>
    );
  };

  const regimeCount = (filters.regimes || []).filter((r: any) => r.enabled).length;

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
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm whitespace-pre-line">{error}</div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">Account-Level Signal Filters</h3>
                <p className="text-sm text-blue-700">
                  Configure filters and VIX-based regimes. All webhooks are logged regardless of filter result.
                  VIX is fetched live from Zerodha — no need to include it in the TradingView payload.
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
            <div className="flex gap-1 overflow-x-auto">
              {(['global', 'buy', 'sell', 'regimes'] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 font-medium text-sm border-b-2 transition whitespace-nowrap ${
                    activeTab === tab
                      ? tab === 'global' ? 'border-blue-600 text-blue-600'
                        : tab === 'buy' ? 'border-green-600 text-green-600'
                        : tab === 'sell' ? 'border-red-600 text-red-600'
                        : 'border-blue-700 text-blue-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'global' ? 'Global' : tab === 'buy' ? 'BUY Filters' : tab === 'sell' ? 'SELL Filters' : (
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      Regimes
                      {regimeCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded-full leading-none">{regimeCount}</span>
                      )}
                      {vixConflicts.length > 0 && (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'global' && (
            <div className="space-y-4">
              <div className={`border-2 rounded-lg p-4 ${filters.trade_enabled ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className={`font-bold text-lg ${filters.trade_enabled ? 'text-green-900' : 'text-red-900'}`}>Master Toggle — Trading {filters.trade_enabled ? 'ENABLED' : 'DISABLED'}</h3>
                    <p className={`text-sm mt-0.5 ${filters.trade_enabled ? 'text-green-700' : 'text-red-700'}`}>
                      {filters.trade_enabled ? 'All webhooks will be processed normally.' : 'All webhook signals will be rejected. No trades will execute.'}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={filters.trade_enabled !== false}
                      onChange={(e) => setFilters({ ...filters, trade_enabled: e.target.checked })}
                      className="w-5 h-5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                    />
                    <span className={`text-sm font-semibold ${filters.trade_enabled ? 'text-green-900' : 'text-red-900'}`}>
                      {filters.trade_enabled ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>
              </div>

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
                  <h3 className="font-semibold text-gray-900">Days Filter</h3>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filters.days_filter?.enabled ?? false}
                      onChange={(e) => setFilters({ ...filters, days_filter: { ...filters.days_filter, enabled: e.target.checked } })}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Enabled</span>
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => {
                    const labels: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
                    const isActive = (filters.days_filter?.allowed_days || [1, 2, 3, 4, 5]).includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        disabled={!filters.days_filter?.enabled}
                        onClick={() => {
                          const days = [...(filters.days_filter?.allowed_days || [1, 2, 3, 4, 5])];
                          const di = days.indexOf(day);
                          if (di >= 0) days.splice(di, 1); else days.push(day);
                          days.sort();
                          setFilters({ ...filters, days_filter: { ...filters.days_filter, allowed_days: days } });
                        }}
                        className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition disabled:opacity-40 ${
                          isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        {labels[day]}
                      </button>
                    );
                  })}
                </div>
                {filters.days_filter?.enabled && (
                  <p className="text-xs text-gray-500 mt-2">
                    Trading allowed on: {(filters.days_filter?.allowed_days || []).map((d: number) => ({ 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' }[d])).join(', ') || 'No days selected'}
                  </p>
                )}
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
          {activeTab === 'regimes' && renderRegimes()}
        </div>

        <div className="border-t border-gray-200 p-6 bg-gray-50">
          <div className="flex items-center justify-between">
            <button onClick={onClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || vixConflicts.length > 0}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : vixConflicts.length > 0 ? 'Fix VIX Conflicts First' : 'Save Filters'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
