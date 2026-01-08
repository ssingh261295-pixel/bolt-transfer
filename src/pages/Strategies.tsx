import { useEffect, useState } from 'react';
import { Plus, Play, Pause, Trash2, TrendingUp, Key, Copy, Check, RefreshCw, Activity, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface WebhookKey {
  id: string;
  name: string;
  webhook_key: string;
  is_active: boolean;
  account_mappings: string[];
  lot_multiplier: number;
  sl_multiplier: number;
  target_multiplier: number;
  created_at: string;
  last_used_at: string | null;
}

interface BrokerAccount {
  id: string;
  account_name: string;
  broker_name: string;
  account_holder_name: string | null;
  client_id: string | null;
  is_active: boolean;
}

export function Strategies() {
  const { user } = useAuth();
  const [webhookKeys, setWebhookKeys] = useState<WebhookKey[]>([]);
  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccount[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingKey, setEditingKey] = useState<WebhookKey | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadWebhookKeys();
      loadBrokerAccounts();
    }
  }, [user]);

  const loadWebhookKeys = async () => {
    const { data } = await supabase
      .from('webhook_keys')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (data) {
      setWebhookKeys(data);
    }
  };

  const loadBrokerAccounts = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('id, account_name, broker_name, account_holder_name, client_id, is_active')
      .eq('user_id', user?.id)
      .eq('is_active', true);

    if (data) {
      setBrokerAccounts(data);
    }
  };

  const generateWebhookKey = () => {
    return 'wk_' + Array.from({ length: 32 }, () =>
      Math.random().toString(36)[2] || '0'
    ).join('');
  };

  const handleCreateKey = async (formData: Partial<WebhookKey>) => {
    const newKey = generateWebhookKey();

    const { error } = await supabase.from('webhook_keys').insert({
      user_id: user?.id,
      webhook_key: newKey,
      ...formData
    });

    if (!error) {
      setShowCreateModal(false);
      loadWebhookKeys();
    }
  };

  const handleUpdateKey = async (id: string, updates: Partial<WebhookKey>) => {
    const { error } = await supabase
      .from('webhook_keys')
      .update(updates)
      .eq('id', id);

    if (!error) {
      setEditingKey(null);
      loadWebhookKeys();
    }
  };

  const handleRegenerateKey = async (id: string) => {
    if (!confirm('Regenerate webhook key? The old key will stop working immediately.')) return;

    const newKey = generateWebhookKey();
    await handleUpdateKey(id, { webhook_key: newKey });
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    await handleUpdateKey(id, { is_active: !currentStatus });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook key? This action cannot be undone.')) return;

    const { error } = await supabase
      .from('webhook_keys')
      .delete()
      .eq('id', id);

    if (!error) {
      loadWebhookKeys();
    }
  };

  const copyWebhookKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyWebhookUrl = () => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tradingview-webhook`;
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="space-y-4 md:space-y-6 max-w-full overflow-x-hidden">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">TradingView Integration</h2>
          <p className="text-sm text-gray-600 mt-1">Manage webhook keys for automated execution</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition w-full md:w-auto"
        >
          <Plus className="w-5 h-5" />
          Create Webhook Key
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-medium text-blue-900 mb-1">How it works</h3>
            <p className="text-sm text-blue-800 mb-2">
              TradingView owns your strategy logic. This platform acts as a secure execution gateway:
            </p>
            <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
              <li>Create a webhook key and map your broker accounts</li>
              <li>Configure per-symbol settings in <strong>NFO Settings</strong> page (ATR multiplier, SL/Target ratios, lot size)</li>
              <li>TradingView sends signals → Platform validates & places MARKET order → Creates HMT GTT (SL + Target)</li>
            </ol>
            <div className="mt-3 pt-3 border-t border-blue-200">
              <div className="flex flex-col gap-3">
                <div className="flex-1">
                  <p className="text-xs text-blue-700 font-medium mb-1">Webhook URL:</p>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    <code className="flex-1 text-xs bg-white px-2 py-1 rounded border border-blue-300 font-mono break-all w-full">
                      {import.meta.env.VITE_SUPABASE_URL}/functions/v1/tradingview-webhook
                    </code>
                    <button
                      onClick={copyWebhookUrl}
                      className="text-blue-600 hover:text-blue-700 p-1 flex items-center gap-1 whitespace-nowrap"
                      title="Copy URL"
                    >
                      <Copy className="w-4 h-4" />
                      <span className="text-xs sm:hidden">Copy URL</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-2 p-2 bg-white rounded border border-blue-200">
              <p className="text-xs text-blue-700">
                <strong>Note:</strong> Trading parameters (ATR, SL, Target, Lots) are now configured per NFO symbol in <a href="/nfo-settings" className="underline font-medium">NFO Settings</a> page, with support for global and account-specific overrides.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Webhook Keys List */}
      <div className="space-y-4">
        {webhookKeys.map((key) => (
          <div key={key.id} className="bg-white rounded-lg border border-gray-200">
            <div className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Key className="w-4 h-4 text-gray-400" />
                    <h3 className="font-semibold text-gray-900">{key.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      key.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {key.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-gray-600">
                    <span className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {key.account_mappings?.length || 0} account{(key.account_mappings?.length || 0) !== 1 ? 's' : ''} mapped
                    </span>
                    {key.last_used_at && (
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        Last used {new Date(key.last_used_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </span>
                    )}
                    <span className="text-blue-600">
                      Settings: Per symbol in NFO Settings
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingKey(key)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                    title="Edit"
                  >
                    <Key className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(key.id, key.is_active)}
                    className={`p-2 rounded-lg transition ${
                      key.is_active
                        ? 'bg-green-100 text-green-600 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title={key.is_active ? 'Disable' : 'Enable'}
                  >
                    {key.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(key.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setExpandedKey(expandedKey === key.id ? null : key.id)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                  >
                    {expandedKey === key.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Webhook Key Display */}
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">Webhook Key</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyWebhookKey(key.webhook_key)}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      {copiedKey === key.webhook_key ? (
                        <><Check className="w-3 h-3" /> Copied</>
                      ) : (
                        <><Copy className="w-3 h-3" /> Copy</>
                      )}
                    </button>
                    <button
                      onClick={() => handleRegenerateKey(key.id)}
                      className="text-xs text-orange-600 hover:text-orange-700 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerate
                    </button>
                  </div>
                </div>
                <code className="text-xs font-mono text-gray-800 break-all">
                  {key.webhook_key}
                </code>
              </div>

              {/* Expanded Details */}
              {expandedKey === key.id && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 block mb-1">Mapped Accounts</span>
                      {key.account_mappings?.length > 0 ? (
                        <div className="space-y-1">
                          {key.account_mappings.map(accountId => {
                            const account = brokerAccounts.find(a => a.id === accountId);
                            return account ? (
                              <div key={accountId} className="text-xs bg-gray-50 px-2 py-1 rounded">
                                {account.account_holder_name
                                  ? `${account.account_holder_name}${account.client_id ? ` (${account.client_id})` : ''}`
                                  : account.account_name || `${account.broker_name} Account`}
                              </div>
                            ) : null;
                          })}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">No accounts mapped</span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-600 block mb-1">TradingView Payload</span>
                      <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-auto">
{`{
  "webhook_key": "${key.webhook_key.substring(0, 20)}...",
  "symbol": "NIFTY",
  "exchange": "NSE",
  "action": "BUY",
  "price": 24500.50,
  "atr": 120.75,
  "timeframe": "60"
}`}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {webhookKeys.length === 0 && (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
            <Key className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No webhook keys yet</h3>
            <p className="text-gray-600 mb-4">Create your first webhook key to start automated trading</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Plus className="w-5 h-5" />
              Create Webhook Key
            </button>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingKey) && (
        <WebhookKeyModal
          key={editingKey?.id || 'new'}
          initialData={editingKey}
          brokerAccounts={brokerAccounts}
          onSave={(data) => {
            if (editingKey) {
              handleUpdateKey(editingKey.id, data);
            } else {
              handleCreateKey(data);
            }
          }}
          onCancel={() => {
            setShowCreateModal(false);
            setEditingKey(null);
          }}
        />
      )}
    </div>
  );
}

function WebhookKeyModal({
  initialData,
  brokerAccounts,
  onSave,
  onCancel
}: {
  initialData: WebhookKey | null;
  brokerAccounts: BrokerAccount[];
  onSave: (data: Partial<WebhookKey>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialData?.name || '');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(initialData?.account_mappings || []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      account_mappings: selectedAccounts,
      lot_multiplier: 1,
      sl_multiplier: 1.0,
      target_multiplier: 1.0
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {initialData ? 'Edit Webhook Key' : 'Create Webhook Key'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production Key"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Accounts
            </label>
            <div className="border border-gray-300 rounded-lg p-2 max-h-32 overflow-y-auto">
              {brokerAccounts.length > 0 ? (
                brokerAccounts.map(account => (
                  <label key={account.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.includes(account.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAccounts([...selectedAccounts, account.id]);
                        } else {
                          setSelectedAccounts(selectedAccounts.filter(id => id !== account.id));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {account.account_holder_name
                          ? `${account.account_holder_name}${account.client_id ? ` (${account.client_id})` : ''}`
                          : account.account_name || `${account.broker_name} Account`}
                      </div>
                      <div className="text-xs text-gray-500">{account.broker_name}</div>
                    </div>
                  </label>
                ))
              ) : (
                <div className="text-center py-4">
                  <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 mb-1">No broker accounts found</p>
                  <p className="text-xs text-gray-500">Please connect a broker account first</p>
                </div>
              )}
            </div>
            {brokerAccounts.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {selectedAccounts.length} account(s) selected
              </p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-blue-900 mb-1">Trading Parameters</p>
                <p className="text-xs text-blue-700">
                  ATR multiplier, SL/Target ratios, and lot sizes are now configured per NFO symbol in the <a href="/nfo-settings" className="underline font-semibold">NFO Settings</a> page.
                  This allows granular control over each symbol with global and account-specific overrides.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              {initialData ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
