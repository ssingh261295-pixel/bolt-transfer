import { useEffect, useState } from 'react';
import { Plus, Link as LinkIcon, Trash2, CheckCircle, ExternalLink, Info, AlertCircle, Edit2, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function Brokers() {
  const { user, session } = useAuth();
  const [brokers, setBrokers] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [editingBroker, setEditingBroker] = useState<any>(null);
  const [formData, setFormData] = useState({
    broker_name: 'zerodha',
    api_key: '',
    api_secret: '',
    account_name: '',
    client_id: '',
    account_holder_name: '',
  });

  const brokerOptions = [
    { value: 'zerodha', label: 'Zerodha', logo: '🟢' },
    { value: 'angel', label: 'Angel One', logo: '🔴' },
    { value: 'fyers', label: 'Fyers', logo: '🔵' },
    { value: 'upstox', label: 'Upstox', logo: '🟡' },
    { value: 'aliceblue', label: 'Alice Blue', logo: '🟣' },
  ];

  useEffect(() => {
    if (user) {
      loadBrokers();
    }

    const params = new URLSearchParams(window.location.search);
    const requestToken = params.get('request_token');
    const status = params.get('status');

    if (requestToken && status === 'success' && user && session) {
      const brokerId = localStorage.getItem('zerodha_broker_id');
      if (brokerId) {
        handleTokenExchange(requestToken, brokerId);
        localStorage.removeItem('zerodha_broker_id');
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [user, session]);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (data) {
      setBrokers(data);
    }
  };

  const handleAddBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('handleAddBroker called with formData:', formData);
    setError('');

    const { data, error } = await supabase.from('broker_connections').insert({
      user_id: user?.id,
      broker_name: formData.broker_name,
      api_key: formData.api_key.trim(),
      api_secret: formData.api_secret.trim(),
      account_name: formData.account_name.trim() || null,
      client_id: formData.client_id.trim() || null,
      account_holder_name: formData.account_holder_name.trim() || null,
      is_active: false,
    }).select().single();

    if (error) {
      setError(error.message || 'Failed to add broker');
      return;
    }

    if (data && formData.broker_name === 'zerodha') {
      await handleZerodhaLogin(data.id);
    } else {
      setShowAddForm(false);
      setFormData({ broker_name: 'zerodha', api_key: '', api_secret: '', account_name: '', client_id: '', account_holder_name: '' });
      loadBrokers();
    }
  };

  const handleEditBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const { error } = await supabase
      .from('broker_connections')
      .update({
        account_name: formData.account_name.trim() || null,
        client_id: formData.client_id.trim() || null,
        account_holder_name: formData.account_holder_name.trim() || null,
      })
      .eq('id', editingBroker.id);

    if (error) {
      setError(error.message || 'Failed to update broker');
      return;
    }

    setEditingBroker(null);
    setFormData({ broker_name: 'zerodha', api_key: '', api_secret: '', account_name: '', client_id: '', account_holder_name: '' });
    loadBrokers();
  };

  const startEditing = (broker: any) => {
    setEditingBroker(broker);
    setFormData({
      broker_name: broker.broker_name,
      api_key: broker.api_key,
      api_secret: '',
      account_name: broker.account_name || '',
      client_id: broker.client_id || '',
      account_holder_name: broker.account_holder_name || '',
    });
  };

  const handleZerodhaLogin = async (brokerId: string) => {
    try {
      setConnecting(true);
      setError('');
      localStorage.setItem('zerodha_broker_id', brokerId);

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-auth/login-url?broker_id=${brokerId}`;

      console.log('Fetching login URL from:', apiUrl);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Response status:', response.status);

      const data = await response.json();
      console.log('Response data:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.login_url) {
        console.log('Redirecting to:', data.login_url);
        window.location.href = data.login_url;
      } else {
        throw new Error('Failed to get login URL');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Failed to connect to Zerodha');
      setConnecting(false);
      localStorage.removeItem('zerodha_broker_id');
    }
  };

  const handleTokenExchange = async (requestToken: string, brokerId: string) => {
    try {
      setConnecting(true);

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-auth/exchange-token`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_token: requestToken,
          broker_connection_id: brokerId,
        }),
      });

      const data = await response.json();

      console.log('Exchange token response:', data);

      if (data.success) {
        setShowAddForm(false);
        setFormData({ broker_name: 'zerodha', api_key: '', api_secret: '' });
        await loadBrokers();
        setError('');
      } else {
        const errorMsg = data.error || 'Token exchange failed';
        console.error('Token exchange failed:', errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      console.error('Token exchange error:', err);
      const errorMessage = err.message || 'Failed to complete connection';
      setError(`Connection failed: ${errorMessage}. Please check your API credentials and try again.`);
    } finally {
      setConnecting(false);
    }
  };

  const handleReconnect = async (brokerId: string, brokerName: string) => {
    console.log('handleReconnect called with brokerId:', brokerId, 'brokerName:', brokerName);
    if (brokerName === 'zerodha') {
      await handleZerodhaLogin(brokerId);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('broker_connections')
      .delete()
      .eq('id', id);

    if (!error) {
      loadBrokers();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Broker Connections</h2>
          <p className="text-sm text-gray-600 mt-1">Connect your trading accounts</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowInstructions(!showInstructions)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            <Info className="w-5 h-5" />
            Setup Guide
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            <Plus className="w-5 h-5" />
            Add Broker
          </button>
        </div>
      </div>

      {showInstructions && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-blue-900 mb-3">How to Connect Zerodha</h3>

              <div className="space-y-4 text-sm text-blue-800">
                <div>
                  <p className="font-medium mb-2">Step 1: Create a Kite Connect App</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Go to <a href="https://developers.kite.trade/" target="_blank" rel="noopener noreferrer" className="underline font-medium">developers.kite.trade</a></li>
                    <li>Sign in with your Zerodha credentials</li>
                    <li>Click "Create new app"</li>
                    <li>Fill in the app details</li>
                  </ol>
                </div>

                <div>
                  <p className="font-medium mb-2">Step 2: Set Redirect URL</p>
                  <p className="mb-2">In your Kite Connect app settings, you MUST set the redirect URL to one of these options:</p>

                  <div className="space-y-3 mt-3">
                    <div>
                      <p className="text-xs font-medium mb-1">Option A: Production URL (Recommended)</p>
                      <div className="bg-white border border-blue-300 rounded px-3 py-2 font-mono text-xs break-all">
                        https://your-domain.com
                      </div>
                      <p className="text-xs mt-1 text-blue-700">Use your deployed domain (Vercel, Netlify, etc.)</p>
                    </div>

                    <div>
                      <p className="text-xs font-medium mb-1">Option B: Local Development (127.0.0.1)</p>
                      <div className="bg-white border border-blue-300 rounded px-3 py-2 font-mono text-xs break-all">
                        http://127.0.0.1:5173
                      </div>
                      <p className="text-xs mt-1 text-blue-700">For local testing only. Must use 127.0.0.1, NOT localhost</p>
                    </div>

                    <div>
                      <p className="text-xs font-medium mb-1">Current App URL (May not work):</p>
                      <div className="bg-gray-100 border border-gray-300 rounded px-3 py-2 font-mono text-xs break-all text-gray-600">
                        {window.location.origin}
                      </div>
                      <p className="text-xs mt-1 text-red-600">Preview/staging URLs are NOT supported by Zerodha</p>
                    </div>
                  </div>

                  <div className="bg-red-50 border border-red-300 rounded p-3 mt-3">
                    <p className="font-medium text-red-900 text-xs mb-1">Critical Information:</p>
                    <ul className="text-red-800 text-xs space-y-1 list-disc list-inside">
                      <li>Zerodha does NOT accept preview/temporary URLs</li>
                      <li>The redirect URL must be exactly as registered in Kite Connect</li>
                      <li>For testing, deploy to a real domain or use http://127.0.0.1:5173</li>
                    </ul>
                  </div>
                </div>

                <div>
                  <p className="font-medium mb-2">Step 3: Get API Credentials</p>
                  <p>After creating the app, copy your API Key and API Secret from the Kite Connect dashboard.</p>
                </div>

                <div>
                  <p className="font-medium mb-2">Step 4: Add Broker Connection</p>
                  <p>Click "Add Broker" button above and enter your API credentials. You'll be redirected to Zerodha to authorize the connection.</p>
                </div>

                <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mt-4">
                  <p className="font-medium text-yellow-900 mb-1">Development Note:</p>
                  <p className="text-yellow-800 text-xs">
                    If you're seeing "refused to connect" errors, make sure your redirect URL in Kite Connect matches exactly with your current app URL. Preview/staging URLs are not supported by Zerodha.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingBroker && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Broker Account</h3>
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleEditBroker} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Holder Name</label>
              <input
                type="text"
                value={formData.account_holder_name}
                onChange={(e) => setFormData({ ...formData, account_holder_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., John Doe"
              />
              <p className="text-xs text-gray-500 mt-1">The name of the account holder</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Client ID</label>
              <input
                type="text"
                value={formData.client_id}
                onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., ABC123"
              />
              <p className="text-xs text-gray-500 mt-1">Your Zerodha client ID</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Nickname (Optional)</label>
              <input
                type="text"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., My Trading Account"
              />
              <p className="text-xs text-gray-500 mt-1">A custom name to identify this account</p>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
              >
                Save Changes
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingBroker(null);
                  setError('');
                  setFormData({ broker_name: 'zerodha', api_key: '', api_secret: '', account_name: '', client_id: '', account_holder_name: '' });
                }}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Broker Connection</h3>
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          {connecting && (
            <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
              Connecting to broker... Please complete the login on the broker's website.
            </div>
          )}
          <form onSubmit={handleAddBroker} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Broker</label>
              <select
                value={formData.broker_name}
                onChange={(e) => setFormData({ ...formData, broker_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                {brokerOptions.map((broker) => (
                  <option key={broker.value} value={broker.value}>
                    {broker.logo} {broker.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Holder Name</label>
              <input
                type="text"
                value={formData.account_holder_name}
                onChange={(e) => setFormData({ ...formData, account_holder_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., John Doe"
              />
              <p className="text-xs text-gray-500 mt-1">The name of the account holder</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Client ID</label>
              <input
                type="text"
                value={formData.client_id}
                onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., ABC123"
              />
              <p className="text-xs text-gray-500 mt-1">Your Zerodha client ID</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Nickname (Optional)</label>
              <input
                type="text"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., My Trading Account, Family Account"
              />
              <p className="text-xs text-gray-500 mt-1">A custom name to identify this account</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
              <input
                type="text"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="Enter your API key"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">API Secret</label>
              <input
                type="password"
                value={formData.api_secret}
                onChange={(e) => setFormData({ ...formData, api_secret: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="Enter your API secret"
                required
              />
            </div>

            {formData.broker_name === 'zerodha' && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg text-sm">
                <p className="text-blue-900 font-medium mb-1">Zerodha Integration</p>
                <p className="text-blue-700">After adding your API credentials, you'll be redirected to Zerodha's login page to authorize the connection.</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={connecting}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? 'Connecting...' : 'Connect Broker'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setError('');
                }}
                disabled={connecting}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {brokers.map((broker) => {
          const brokerInfo = brokerOptions.find((b) => b.value === broker.broker_name);
          return (
            <div key={broker.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="text-3xl">{brokerInfo?.logo}</div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {broker.account_holder_name || broker.account_name || brokerInfo?.label}
                    </h3>
                    {broker.client_id && (
                      <p className="text-xs text-gray-600">Client ID: {broker.client_id}</p>
                    )}
                    {broker.account_name && (
                      <p className="text-xs text-gray-500">{broker.account_name}</p>
                    )}
                    <p className="text-sm">
                      {broker.is_active ? (
                        <span className="flex items-center gap-1 text-green-600 font-medium">
                          <CheckCircle className="w-4 h-4" />
                          Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-600 font-medium">
                          <XCircle className="w-4 h-4" />
                          Disconnected
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEditing(broker)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(broker.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Last Connected</span>
                  <span className="text-gray-900">
                    {broker.last_connected_at
                      ? new Date(broker.last_connected_at).toLocaleDateString()
                      : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">API Key</span>
                  <span className="text-gray-900 font-mono text-xs">
                    {broker.api_key?.substring(0, 8)}...
                  </span>
                </div>
              </div>

              {broker.broker_name === 'zerodha' && broker.is_active && (
                <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-xs text-yellow-800 mb-2">
                    Zerodha tokens expire daily. Reconnect if you experience authentication issues.
                  </p>
                  <button
                    onClick={() => handleReconnect(broker.id, broker.broker_name)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Reconnect
                  </button>
                </div>
              )}

              {!broker.is_active && broker.broker_name === 'zerodha' && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs text-red-800 mb-2 font-medium">
                    Session expired. Please reconnect to continue trading.
                  </p>
                  <button
                    onClick={() => handleReconnect(broker.id, broker.broker_name)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Reconnect Now
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {brokers.length === 0 && !showAddForm && (
          <div className="col-span-full bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
            <LinkIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No broker connections</h3>
            <p className="text-gray-600 mb-4">Connect your first broker to start trading</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Plus className="w-5 h-5" />
              Add Broker
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
