import { useEffect, useState } from 'react';
import { Plus, Play, Pause, Trash2, TrendingUp, Edit, Webhook, Copy, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { StrategyBuilder } from '../components/strategies/StrategyBuilder';

export function Strategies() {
  const { user } = useAuth();
  const [strategies, setStrategies] = useState<any[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<any>(null);
  const [copiedWebhookKey, setCopiedWebhookKey] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadStrategies();
    }
  }, [user]);

  const loadStrategies = async () => {
    const { data } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (data) {
      setStrategies(data);
    }
  };

  const handleSaveStrategy = async (strategyData: any) => {
    if (editingStrategy) {
      const { error } = await supabase
        .from('strategies')
        .update({
          ...strategyData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingStrategy.id);

      if (!error) {
        setShowBuilder(false);
        setEditingStrategy(null);
        loadStrategies();
      }
    } else {
      const { error } = await supabase.from('strategies').insert({
        user_id: user?.id,
        ...strategyData,
        is_active: false,
      });

      if (!error) {
        setShowBuilder(false);
        loadStrategies();
      }
    }
  };

  const handleEditStrategy = (strategy: any) => {
    setEditingStrategy(strategy);
    setShowBuilder(true);
  };

  const toggleActive = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('strategies')
      .update({ is_active: !currentStatus })
      .eq('id', id);

    if (!error) {
      loadStrategies();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('strategies')
      .delete()
      .eq('id', id);

    if (!error) {
      loadStrategies();
    }
  };

  const copyWebhookKey = (webhookKey: string) => {
    navigator.clipboard.writeText(webhookKey);
    setCopiedWebhookKey(webhookKey);
    setTimeout(() => setCopiedWebhookKey(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Trading Strategies</h2>
          <p className="text-sm text-gray-600 mt-1">Create and manage your automated strategies</p>
        </div>
        <button
          onClick={() => {
            setEditingStrategy(null);
            setShowBuilder(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <Plus className="w-5 h-5" />
          Create Strategy
        </button>
      </div>

      {showBuilder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <StrategyBuilder
            onSave={handleSaveStrategy}
            onCancel={() => {
              setShowBuilder(false);
              setEditingStrategy(null);
            }}
            initialData={editingStrategy}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {strategies.map((strategy) => (
          <div key={strategy.id} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{strategy.name}</h3>
                  {strategy.execution_source === 'tradingview' && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">
                      <Webhook className="w-3 h-3" />
                      TradingView
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600">
                  {strategy.description || 'No description'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEditStrategy(strategy)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => toggleActive(strategy.id, strategy.is_active)}
                  className={`p-2 rounded-lg transition ${
                    strategy.is_active
                      ? 'bg-green-100 text-green-600 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {strategy.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleDelete(strategy.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {strategy.symbol && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Symbol</span>
                  <span className="text-gray-900 font-medium">{strategy.symbol} ({strategy.exchange})</span>
                </div>
              )}
              {strategy.timeframe && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Timeframe</span>
                  <span className="text-gray-900 capitalize">{strategy.timeframe}</span>
                </div>
              )}

              {strategy.execution_source === 'tradingview' ? (
                <>
                  {strategy.account_mappings && strategy.account_mappings.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Accounts</span>
                      <span className="text-gray-900">{strategy.account_mappings.length}</span>
                    </div>
                  )}
                  {strategy.atr_config && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">ATR Period</span>
                      <span className="text-gray-900">{strategy.atr_config.period}</span>
                    </div>
                  )}
                  {strategy.webhook_key && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600 font-medium">Webhook Key</span>
                        <button
                          onClick={() => copyWebhookKey(strategy.webhook_key)}
                          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          {copiedWebhookKey === strategy.webhook_key ? (
                            <><Check className="w-3 h-3" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3" /> Copy</>
                          )}
                        </button>
                      </div>
                      <div className="text-xs font-mono bg-gray-50 px-2 py-1 rounded border border-gray-200 truncate">
                        {strategy.webhook_key}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {strategy.indicators && strategy.indicators.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Indicators</span>
                      <span className="text-gray-900">{strategy.indicators.length}</span>
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-between">
                <span className="text-gray-600">Status</span>
                <span
                  className={`px-2 py-1 rounded-full text-xs ${
                    strategy.is_active
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {strategy.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Created</span>
                <span className="text-gray-900">
                  {new Date(strategy.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        ))}

        {strategies.length === 0 && !showBuilder && (
          <div className="col-span-full bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
            <TrendingUp className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No strategies yet</h3>
            <p className="text-gray-600 mb-4">Create your first trading strategy</p>
            <button
              onClick={() => {
                setEditingStrategy(null);
                setShowBuilder(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Plus className="w-5 h-5" />
              Create Strategy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
