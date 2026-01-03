import { useState, useEffect } from 'react';
import { Save, RefreshCw, Search, Filter, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface NFOSymbol {
  name: string;
  instrument_type: string;
}

interface SymbolSetting {
  symbol: string;
  atr_multiplier: number;
  sl_multiplier: number;
  target_multiplier: number;
  lot_multiplier: number;
  is_enabled: boolean;
  broker_connection_id: string | null;
}

export function NFOSymbolSettings() {
  const { user } = useAuth();
  const [nfoSymbols, setNfoSymbols] = useState<string[]>([]);
  const [settings, setSettings] = useState<Map<string, SymbolSetting>>(new Map());
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<string>('global');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [editedSymbols, setEditedSymbols] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      loadBrokers();
      loadNFOSymbols();
    }
  }, [user]);

  useEffect(() => {
    if (nfoSymbols.length > 0) {
      loadSettings();
    }
  }, [nfoSymbols, selectedBroker]);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('id, account_name, account_holder_name, client_id')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data) {
      setBrokers(data);
    }
  };

  const loadNFOSymbols = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('nfo_instruments')
        .select('name')
        .eq('instrument_type', 'FUT')
        .order('name');

      if (data) {
        const uniqueSymbols = [...new Set(data.map(item => item.name))].sort();
        setNfoSymbols(uniqueSymbols);
      }
    } catch (error) {
      console.error('Error loading NFO symbols:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const brokerId = selectedBroker === 'global' ? null : selectedBroker;

      let query = supabase
        .from('nfo_symbol_settings')
        .select('*')
        .eq('user_id', user?.id);

      if (brokerId) {
        query = query.eq('broker_connection_id', brokerId);
      } else {
        query = query.is('broker_connection_id', null);
      }

      const { data } = await query;

      const settingsMap = new Map<string, SymbolSetting>();

      nfoSymbols.forEach(symbol => {
        const existing = data?.find(s => s.symbol === symbol);
        settingsMap.set(symbol, {
          symbol,
          atr_multiplier: existing?.atr_multiplier ?? 1.5,
          sl_multiplier: existing?.sl_multiplier ?? 1.0,
          target_multiplier: existing?.target_multiplier ?? 1.0,
          lot_multiplier: existing?.lot_multiplier ?? 1,
          is_enabled: existing?.is_enabled ?? true,
          broker_connection_id: brokerId
        });
      });

      setSettings(settingsMap);
      setEditedSymbols(new Set());
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSettingChange = (symbol: string, field: keyof SymbolSetting, value: any) => {
    const newSettings = new Map(settings);
    const setting = newSettings.get(symbol);
    if (setting) {
      newSettings.set(symbol, { ...setting, [field]: value });
      setSettings(newSettings);
      setEditedSymbols(prev => new Set(prev).add(symbol));
    }
  };

  const handleSave = async () => {
    if (editedSymbols.size === 0) {
      setMessage('No changes to save');
      setMessageType('error');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const brokerId = selectedBroker === 'global' ? null : selectedBroker;
      const updates = Array.from(editedSymbols).map(symbol => {
        const setting = settings.get(symbol)!;
        return {
          user_id: user?.id,
          broker_connection_id: brokerId,
          symbol: setting.symbol,
          atr_multiplier: setting.atr_multiplier,
          sl_multiplier: setting.sl_multiplier,
          target_multiplier: setting.target_multiplier,
          lot_multiplier: setting.lot_multiplier,
          is_enabled: setting.is_enabled
        };
      });

      const { error } = await supabase
        .from('nfo_symbol_settings')
        .upsert(updates, {
          onConflict: 'user_id,symbol,broker_connection_id'
        });

      if (error) throw error;

      setMessage(`Successfully saved ${editedSymbols.size} symbol settings`);
      setMessageType('success');
      setEditedSymbols(new Set());
      setTimeout(() => setMessage(''), 5000);
    } catch (error: any) {
      setMessage('Failed to save settings: ' + error.message);
      setMessageType('error');
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkUpdate = (field: keyof SymbolSetting, value: any) => {
    const newSettings = new Map(settings);
    filteredSymbols.forEach(symbol => {
      const setting = newSettings.get(symbol);
      if (setting) {
        newSettings.set(symbol, { ...setting, [field]: value });
      }
    });
    setSettings(newSettings);
    setEditedSymbols(new Set(filteredSymbols));
  };

  const filteredSymbols = nfoSymbols.filter(symbol =>
    symbol.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">NFO Symbol Trading Settings</h1>
          <p className="text-gray-600 mt-1">
            Configure ATR multipliers, risk/reward ratios, and lot sizes for each NFO Future symbol
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadSettings}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleSave}
            disabled={saving || editedSymbols.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : `Save ${editedSymbols.size > 0 ? `(${editedSymbols.size})` : ''}`}
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${
          messageType === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-center gap-2">
            {messageType === 'success' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <XCircle className="w-5 h-5" />
            )}
            <p className="font-medium">{message}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search symbols..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <select
            value={selectedBroker}
            onChange={(e) => setSelectedBroker(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="global">Global Settings (All Accounts)</option>
            {brokers.map(broker => (
              <option key={broker.id} value={broker.id}>
                {broker.account_holder_name || broker.account_name} ({broker.client_id})
              </option>
            ))}
          </select>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-blue-800">
              <span className="font-medium">Bulk Update:</span> Apply same values to filtered symbols ({filteredSymbols.length})
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.1"
                placeholder="ATR"
                className="w-20 px-2 py-1 text-sm border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                onBlur={(e) => e.target.value && handleBulkUpdate('atr_multiplier', parseFloat(e.target.value))}
              />
              <input
                type="number"
                step="0.1"
                placeholder="SL"
                className="w-20 px-2 py-1 text-sm border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                onBlur={(e) => e.target.value && handleBulkUpdate('sl_multiplier', parseFloat(e.target.value))}
              />
              <input
                type="number"
                step="0.1"
                placeholder="Target"
                className="w-20 px-2 py-1 text-sm border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                onBlur={(e) => e.target.value && handleBulkUpdate('target_multiplier', parseFloat(e.target.value))}
              />
              <input
                type="number"
                placeholder="Lot"
                className="w-20 px-2 py-1 text-sm border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                onBlur={(e) => e.target.value && handleBulkUpdate('lot_multiplier', parseInt(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">Loading NFO symbols...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Symbol</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-32">
                    <div>ATR Multiplier</div>
                    <div className="text-[10px] text-gray-400 font-normal normal-case">Base ATR calc</div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-32">
                    <div>SL Multiplier</div>
                    <div className="text-[10px] text-gray-400 font-normal normal-case">Risk ratio</div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-32">
                    <div>Target Multiplier</div>
                    <div className="text-[10px] text-gray-400 font-normal normal-case">Reward ratio</div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-28">
                    <div>Lot Multiplier</div>
                    <div className="text-[10px] text-gray-400 font-normal normal-case">Position size</div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-24">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredSymbols.map(symbol => {
                  const setting = settings.get(symbol);
                  if (!setting) return null;

                  const isEdited = editedSymbols.has(symbol);

                  return (
                    <tr key={symbol} className={`hover:bg-gray-50 ${isEdited ? 'bg-yellow-50' : ''}`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {symbol}
                        {isEdited && <span className="ml-2 text-xs text-yellow-600">●</span>}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.1"
                          value={setting.atr_multiplier}
                          onChange={(e) => handleSettingChange(symbol, 'atr_multiplier', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-1.5 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.1"
                          value={setting.sl_multiplier}
                          onChange={(e) => handleSettingChange(symbol, 'sl_multiplier', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-1.5 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.1"
                          value={setting.target_multiplier}
                          onChange={(e) => handleSettingChange(symbol, 'target_multiplier', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-1.5 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={setting.lot_multiplier}
                          onChange={(e) => handleSettingChange(symbol, 'lot_multiplier', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-1.5 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={setting.is_enabled}
                          onChange={(e) => handleSettingChange(symbol, 'is_enabled', e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">How It Works</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>ATR Multiplier:</strong> Adjusts the base ATR value from TradingView (ATR × multiplier)</li>
          <li>• <strong>SL Multiplier:</strong> Stop Loss distance = Adjusted ATR × SL Multiplier</li>
          <li>• <strong>Target Multiplier:</strong> Target distance = Adjusted ATR × Target Multiplier</li>
          <li>• <strong>Lot Multiplier:</strong> Number of lots to trade (Standard Lot Size × multiplier)</li>
          <li>• <strong>Global Settings:</strong> Apply to all broker accounts unless account-specific overrides exist</li>
          <li>• <strong>Account-Specific:</strong> Override global settings for a specific broker account</li>
        </ul>
      </div>
    </div>
  );
}
