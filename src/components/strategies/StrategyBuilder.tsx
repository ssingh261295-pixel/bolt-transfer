import { useState, useEffect } from 'react';
import { Plus, X, TrendingUp, TrendingDown, Copy, Check } from 'lucide-react';
import { SymbolSelector } from './SymbolSelector';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Indicator {
  id: string;
  name: string;
  params: Record<string, number>;
}

interface Condition {
  id: string;
  indicator1: string;
  operator: string;
  indicator2: string | number;
  value?: number;
}

interface StrategyBuilderProps {
  onSave: (strategy: any) => void;
  onCancel: () => void;
  initialData?: any;
}

const AVAILABLE_INDICATORS = [
  { value: 'rsi', label: 'RSI', defaultParams: { period: 14 } },
  { value: 'ema', label: 'EMA', defaultParams: { period: 20 } },
  { value: 'sma', label: 'SMA', defaultParams: { period: 20 } },
  { value: 'macd', label: 'MACD', defaultParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
  { value: 'bb', label: 'Bollinger Bands', defaultParams: { period: 20, stdDev: 2 } },
  { value: 'adx', label: 'ADX', defaultParams: { period: 14 } },
  { value: 'stochastic', label: 'Stochastic', defaultParams: { period: 14, signalPeriod: 3 } },
  { value: 'atr', label: 'ATR', defaultParams: { period: 14 } },
  { value: 'heikinashi', label: 'Heikin-Ashi', defaultParams: {} },
];

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
  { value: 'cross_above', label: 'Crosses Above' },
  { value: 'cross_below', label: 'Crosses Below' },
];

const TIMEFRAMES = [
  { value: '1minute', label: '1 Minute' },
  { value: '3minute', label: '3 Minutes' },
  { value: '5minute', label: '5 Minutes' },
  { value: '15minute', label: '15 Minutes' },
  { value: '30minute', label: '30 Minutes' },
  { value: '60minute', label: '1 Hour' },
  { value: 'day', label: '1 Day' },
];

export function StrategyBuilder({ onSave, onCancel, initialData }: StrategyBuilderProps) {
  const { user } = useAuth();
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [symbol, setSymbol] = useState(initialData?.symbol || '');
  const [exchange, setExchange] = useState(initialData?.exchange || 'NSE');
  const [timeframe, setTimeframe] = useState(initialData?.timeframe || 'day');

  // Execution source
  const [executionSource, setExecutionSource] = useState(initialData?.execution_source || 'manual');
  const [webhookKey, setWebhookKey] = useState(initialData?.webhook_key || '');
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // ATR Configuration
  const [atrPeriod, setAtrPeriod] = useState(initialData?.atr_config?.period || 14);
  const [atrSlMultiplier, setAtrSlMultiplier] = useState(initialData?.atr_config?.sl_multiplier || 1.5);
  const [atrTargetMultiplier, setAtrTargetMultiplier] = useState(initialData?.atr_config?.target_multiplier || 2.0);
  const [atrTrailingMultiplier, setAtrTrailingMultiplier] = useState(initialData?.atr_config?.trailing_multiplier || 1.0);

  // Account mappings
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(initialData?.account_mappings || []);
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);

  const [indicators, setIndicators] = useState<Indicator[]>(initialData?.indicators || []);
  const [entryConditions, setEntryConditions] = useState<Condition[]>(initialData?.entry_conditions || []);
  const [exitConditions, setExitConditions] = useState<Condition[]>(initialData?.exit_conditions || []);

  const [stopLoss, setStopLoss] = useState(initialData?.risk_management?.stopLoss || 2);
  const [target, setTarget] = useState(initialData?.risk_management?.target || 5);
  const [positionSize, setPositionSize] = useState(initialData?.risk_management?.positionSize || 1);

  // Load available broker accounts
  useEffect(() => {
    if (user) {
      loadBrokerAccounts();
    }
  }, [user]);

  // Generate webhook key if TradingView mode and no key exists
  useEffect(() => {
    if (executionSource === 'tradingview' && !webhookKey && !initialData) {
      generateWebhookKey();
    }
  }, [executionSource]);

  const loadBrokerAccounts = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('id, broker_name, account_name, client_id, account_holder_name, is_active')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (data) {
      setAvailableAccounts(data);
    }
  };

  const generateWebhookKey = async () => {
    const { data, error } = await supabase.rpc('generate_webhook_key');
    if (!error && data) {
      setWebhookKey(data);
    }
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const copyWebhookUrl = () => {
    const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tradingview-webhook`;
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const addIndicator = () => {
    const id = `ind_${Date.now()}`;
    setIndicators([...indicators, { id, name: 'rsi', params: { period: 14 } }]);
  };

  const removeIndicator = (id: string) => {
    setIndicators(indicators.filter(i => i.id !== id));
  };

  const updateIndicator = (id: string, field: string, value: any) => {
    setIndicators(indicators.map(i =>
      i.id === id ? { ...i, [field]: value } : i
    ));
  };

  const updateIndicatorWithParams = (id: string, name: string, params: Record<string, number>) => {
    setIndicators(indicators.map(i =>
      i.id === id ? { ...i, name, params } : i
    ));
  };

  const updateIndicatorParam = (id: string, param: string, value: number) => {
    setIndicators(indicators.map(i =>
      i.id === id ? { ...i, params: { ...i.params, [param]: value } } : i
    ));
  };

  const addCondition = (type: 'entry' | 'exit') => {
    const id = `cond_${Date.now()}`;
    const condition: Condition = {
      id,
      indicator1: 'close',
      operator: 'gt',
      indicator2: 'value',
      value: 0,
    };

    if (type === 'entry') {
      setEntryConditions([...entryConditions, condition]);
    } else {
      setExitConditions([...exitConditions, condition]);
    }
  };

  const removeCondition = (type: 'entry' | 'exit', id: string) => {
    if (type === 'entry') {
      setEntryConditions(entryConditions.filter(c => c.id !== id));
    } else {
      setExitConditions(exitConditions.filter(c => c.id !== id));
    }
  };

  const updateCondition = (type: 'entry' | 'exit', id: string, field: string, value: any) => {
    const updateFn = (c: Condition) => c.id === id ? { ...c, [field]: value } : c;

    if (type === 'entry') {
      setEntryConditions(entryConditions.map(updateFn));
    } else {
      setExitConditions(exitConditions.map(updateFn));
    }
  };

  const handleSave = () => {
    const strategy = {
      name,
      description,
      symbol,
      exchange,
      timeframe,
      execution_source: executionSource,
      webhook_key: executionSource === 'tradingview' ? webhookKey : null,
      atr_config: executionSource === 'tradingview' ? {
        period: atrPeriod,
        sl_multiplier: atrSlMultiplier,
        target_multiplier: atrTargetMultiplier,
        trailing_multiplier: atrTrailingMultiplier,
      } : null,
      account_mappings: executionSource === 'tradingview' ? selectedAccounts : [],
      indicators: executionSource === 'manual' ? indicators : [],
      entry_conditions: executionSource === 'manual' ? entryConditions : [],
      exit_conditions: executionSource === 'manual' ? exitConditions : [],
      risk_management: executionSource === 'manual' ? {
        stopLoss,
        target,
        positionSize,
      } : {},
    };
    onSave(strategy);
  };

  const getIndicatorOptions = () => {
    const baseOptions = [
      { value: 'close', label: 'Close Price' },
      { value: 'open', label: 'Open Price' },
      { value: 'high', label: 'High Price' },
      { value: 'low', label: 'Low Price' },
      { value: 'volume', label: 'Volume' },
    ];

    const indicatorOptions = indicators.map(ind => ({
      value: ind.id,
      label: `${AVAILABLE_INDICATORS.find(ai => ai.value === ind.name)?.label || ind.name}`,
    }));

    return [...baseOptions, ...indicatorOptions, { value: 'value', label: 'Custom Value' }];
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-6xl mx-auto max-h-[90vh] overflow-y-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        {initialData ? 'Edit Strategy' : 'Create New Strategy'}
      </h2>

      {/* Basic Info */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Strategy Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="My Trading Strategy"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={2}
            placeholder="Strategy description..."
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <SymbolSelector
            value={symbol}
            exchange={exchange}
            onChange={(newSymbol, newExchange) => {
              setSymbol(newSymbol);
              setExchange(newExchange);
            }}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Timeframe
            </label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {TIMEFRAMES.map(tf => (
                <option key={tf.value} value={tf.value}>{tf.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Execution Source
            </label>
            <select
              value={executionSource}
              onChange={(e) => setExecutionSource(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="manual">Manual (UI-based)</option>
              <option value="tradingview">TradingView Webhook</option>
            </select>
          </div>
        </div>
      </div>

      {/* TradingView Webhook Configuration */}
      {executionSource === 'tradingview' && (
        <>
          {/* Webhook Info */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">TradingView Webhook Setup</h3>
            <div className="space-y-2 text-sm text-blue-800">
              <p>Use this webhook URL in your TradingView alert:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tradingview-webhook`}
                  className="flex-1 px-3 py-2 bg-white border border-blue-300 rounded text-xs font-mono"
                />
                <button
                  onClick={copyWebhookUrl}
                  className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
                >
                  {copiedWebhook ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedWebhook ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="mt-2">Webhook Key (include in alert message):</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookKey}
                  className="flex-1 px-3 py-2 bg-gray-100 border border-blue-300 rounded text-xs font-mono"
                />
                {initialData && (
                  <div className="px-3 py-2 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-800 flex items-center">
                    🔒 Read-only
                  </div>
                )}
              </div>
              <p className="text-xs mt-2">
                Alert message format: {'{'}"action": "{'{'}{'{'} strategy.order.action {'}'}{'}'}",
                "symbol": "{symbol}", "price": "{'{'}{'{'} close {'}'}{'}'}",
                "atr": "{'{'}{'{'} atr {'}'}{'}'}",
                "webhook_key": "{webhookKey}"{'}'}
              </p>
            </div>
          </div>

          {/* Account Selection */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Trading Accounts</h3>
            <p className="text-sm text-gray-600 mb-3">Select which broker accounts should execute this strategy:</p>
            <div className="space-y-2">
              {availableAccounts.map(account => {
                const displayName = account.account_name ||
                                   account.client_id ||
                                   account.account_holder_name ||
                                   `${account.broker_name} Account`;
                return (
                  <label key={account.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.includes(account.id)}
                      onChange={() => toggleAccount(account.id)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <div>
                      <div className="font-medium text-gray-900">{displayName}</div>
                      <div className="text-sm text-gray-600">{account.broker_name}</div>
                    </div>
                  </label>
                );
              })}
              {availableAccounts.length === 0 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  No active broker accounts found. Please connect a broker first.
                </div>
              )}
            </div>
          </div>

          {/* ATR Configuration */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">ATR-Based Risk Management</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ATR Period
                </label>
                <input
                  type="number"
                  value={atrPeriod}
                  onChange={(e) => setAtrPeriod(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  min="1"
                />
                <p className="text-xs text-gray-500 mt-1">ATR calculation period in TradingView</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Position Size (Lots)
                </label>
                <input
                  type="number"
                  value={positionSize}
                  onChange={(e) => setPositionSize(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  min="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Stop Loss Multiplier
                </label>
                <input
                  type="number"
                  value={atrSlMultiplier}
                  onChange={(e) => setAtrSlMultiplier(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  step="0.1"
                  min="0.1"
                />
                <p className="text-xs text-gray-500 mt-1">SL = Entry ± (ATR × Multiplier)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Multiplier
                </label>
                <input
                  type="number"
                  value={atrTargetMultiplier}
                  onChange={(e) => setAtrTargetMultiplier(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  step="0.1"
                  min="0.1"
                />
                <p className="text-xs text-gray-500 mt-1">Target = Entry ± (ATR × Multiplier)</p>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Trailing SL Multiplier
                </label>
                <input
                  type="number"
                  value={atrTrailingMultiplier}
                  onChange={(e) => setAtrTrailingMultiplier(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  step="0.1"
                  min="0.1"
                />
                <p className="text-xs text-gray-500 mt-1">Trailing SL distance = ATR × Multiplier (optional)</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Manual Strategy Configuration */}
      {executionSource === 'manual' && (
        <>
      {/* Indicators */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Indicators</h3>
          <button
            onClick={addIndicator}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Indicator
          </button>
        </div>

        <div className="space-y-3">
          {indicators.map(indicator => {
            const indicatorInfo = AVAILABLE_INDICATORS.find(ai => ai.value === indicator.name);
            return (
              <div key={indicator.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Indicator Type
                    </label>
                    <select
                      value={indicator.name}
                      onChange={(e) => {
                        const newIndicator = AVAILABLE_INDICATORS.find(ai => ai.value === e.target.value);
                        updateIndicatorWithParams(indicator.id, e.target.value, newIndicator?.defaultParams || {});
                      }}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {AVAILABLE_INDICATORS.map(ai => (
                        <option key={ai.value} value={ai.value}>{ai.label}</option>
                      ))}
                    </select>
                  </div>

                  {indicatorInfo && Object.keys(indicatorInfo.defaultParams).map(param => (
                    <div key={param}>
                      <label className="block text-xs font-medium text-gray-700 mb-1 capitalize">
                        {param.replace(/([A-Z])/g, ' $1').trim()}
                      </label>
                      <input
                        type="number"
                        value={indicator.params[param] || 0}
                        onChange={(e) => updateIndicatorParam(indicator.id, param, parseFloat(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => removeIndicator(indicator.id)}
                  className="mt-6 p-1.5 text-red-600 hover:bg-red-50 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Entry Conditions */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Entry Conditions
          </h3>
          <button
            onClick={() => addCondition('entry')}
            className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Condition
          </button>
        </div>

        <div className="space-y-3">
          {entryConditions.map(condition => (
            <div key={condition.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
              <div className="flex-1 space-y-2">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">First Value</label>
                    <select
                      value={condition.indicator1}
                      onChange={(e) => updateCondition('entry', condition.id, 'indicator1', e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {getIndicatorOptions().map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Operator</label>
                    <select
                      value={condition.operator}
                      onChange={(e) => updateCondition('entry', condition.id, 'operator', e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {OPERATORS.map(op => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Second Value</label>
                    <select
                      value={condition.indicator2}
                      onChange={(e) => updateCondition('entry', condition.id, 'indicator2', e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {getIndicatorOptions().map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {condition.indicator2 === 'value' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Custom Value</label>
                    <input
                      type="number"
                      value={condition.value || 0}
                      onChange={(e) => updateCondition('entry', condition.id, 'value', parseFloat(e.target.value))}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      placeholder="Enter value"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={() => removeCondition('entry', condition.id)}
                className="mt-6 p-1.5 text-red-600 hover:bg-red-50 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Exit Conditions */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-600" />
            Exit Conditions
          </h3>
          <button
            onClick={() => addCondition('exit')}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Condition
          </button>
        </div>

        <div className="space-y-3">
          {exitConditions.map(condition => (
            <div key={condition.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
              <div className="flex-1 space-y-2">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">First Value</label>
                    <select
                      value={condition.indicator1}
                      onChange={(e) => updateCondition('exit', condition.id, 'indicator1', e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {getIndicatorOptions().map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Operator</label>
                    <select
                      value={condition.operator}
                      onChange={(e) => updateCondition('exit', condition.id, 'operator', e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {OPERATORS.map(op => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Second Value</label>
                    <select
                      value={condition.indicator2}
                      onChange={(e) => updateCondition('exit', condition.id, 'indicator2', e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {getIndicatorOptions().map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {condition.indicator2 === 'value' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Custom Value</label>
                    <input
                      type="number"
                      value={condition.value || 0}
                      onChange={(e) => updateCondition('exit', condition.id, 'value', parseFloat(e.target.value))}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      placeholder="Enter value"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={() => removeCondition('exit', condition.id)}
                className="mt-6 p-1.5 text-red-600 hover:bg-red-50 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Management */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Risk Management</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stop Loss (%)
            </label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              step="0.1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Target (%)
            </label>
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              step="0.1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Position Size (Lots)
            </label>
            <input
              type="number"
              value={positionSize}
              onChange={(e) => setPositionSize(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              min="1"
            />
          </div>
        </div>
      </div>
        </>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button
          onClick={onCancel}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name || !symbol || (executionSource === 'tradingview' && (!webhookKey || selectedAccounts.length === 0))}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save Strategy
        </button>
      </div>
    </div>
  );
}
