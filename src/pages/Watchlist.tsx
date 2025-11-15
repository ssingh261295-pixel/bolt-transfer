import { useEffect, useState } from 'react';
import { Plus, List, Trash2, Eye, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';

export function Watchlist() {
  const { user } = useAuth();
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedWatchlist, setSelectedWatchlist] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '' });
  const [brokerId, setBrokerId] = useState<string>('');

  const { isConnected, connect, disconnect, subscribe, getLTP, ticks } = useZerodhaWebSocket(brokerId);

  useEffect(() => {
    if (user) {
      loadWatchlists();
      loadBrokerConnection();
    }
  }, [user]);

  useEffect(() => {
    if (brokerId) {
      connect();
    }
    return () => disconnect();
  }, [brokerId, connect, disconnect]);

  useEffect(() => {
    if (isConnected && selectedWatchlist?.symbols) {
      const tokens = selectedWatchlist.symbols
        .filter((s: any) => s.instrument_token)
        .map((s: any) => s.instrument_token);
      if (tokens.length > 0) {
        subscribe(tokens, 'full');
      }
    }
  }, [isConnected, selectedWatchlist, subscribe]);

  const loadBrokerConnection = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('id')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .single();

    if (data) {
      setBrokerId(data.id);
    }
  };

  const loadWatchlists = async () => {
    const { data } = await supabase
      .from('watchlists')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (data) {
      setWatchlists(data);
      if (data.length > 0 && !selectedWatchlist) {
        setSelectedWatchlist(data[0]);
      }
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    const { error } = await supabase.from('watchlists').insert({
      user_id: user?.id,
      name: formData.name,
      symbols: [],
    });

    if (!error) {
      setShowCreateForm(false);
      setFormData({ name: '' });
      loadWatchlists();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('watchlists')
      .delete()
      .eq('id', id);

    if (!error) {
      if (selectedWatchlist?.id === id) {
        setSelectedWatchlist(null);
      }
      loadWatchlists();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Watchlists</h2>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-gray-600">Track your favorite stocks and instruments</p>
            {isConnected && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                <Activity className="w-3 h-3 animate-pulse" />
                Live
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <Plus className="w-5 h-5" />
          Create Watchlist
        </button>
      </div>

      {showCreateForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Watchlist</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Watchlist Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., Tech Stocks"
                required
              />
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
              >
                Create Watchlist
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-2">
          {watchlists.map((watchlist) => (
            <button
              key={watchlist.id}
              onClick={() => setSelectedWatchlist(watchlist)}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition ${
                selectedWatchlist?.id === watchlist.id
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-gray-600" />
                <div className="text-left">
                  <p className="font-medium text-gray-900">{watchlist.name}</p>
                  <p className="text-xs text-gray-600">
                    {Array.isArray(watchlist.symbols) ? watchlist.symbols.length : 0} symbols
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(watchlist.id);
                }}
                className="p-1 text-red-600 hover:bg-red-50 rounded transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </button>
          ))}

          {watchlists.length === 0 && (
            <div className="text-center py-8">
              <List className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">No watchlists yet</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          {selectedWatchlist ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedWatchlist.name}</h3>
              {Array.isArray(selectedWatchlist.symbols) && selectedWatchlist.symbols.length > 0 ? (
                <div className="space-y-2">
                  {selectedWatchlist.symbols.map((symbol: any, index: number) => {
                    const ltp = symbol.instrument_token ? getLTP(symbol.instrument_token) : null;
                    const tick = symbol.instrument_token ? ticks.get(symbol.instrument_token) : null;
                    const price = ltp ?? symbol.price ?? 0;
                    const change = tick?.close ? ((price - tick.close) / tick.close) * 100 : 0;
                    const isPositive = change >= 0;

                    return (
                      <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">{symbol.symbol}</p>
                          <p className="text-sm text-gray-600">{symbol.exchange}</p>
                          {tick && (
                            <div className="flex gap-3 mt-1 text-xs text-gray-500">
                              <span>O: {tick.open?.toFixed(2)}</span>
                              <span>H: {tick.high?.toFixed(2)}</span>
                              <span>L: {tick.low?.toFixed(2)}</span>
                              <span>Vol: {tick.volume_traded?.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-gray-900">
                            ₹{price.toFixed(2)}
                            {isConnected && ltp && (
                              <span className="ml-1 text-xs text-green-600">●</span>
                            )}
                          </p>
                          <p className={`text-sm ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {isPositive ? '+' : ''}{change.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <p>No symbols in this watchlist</p>
                  <p className="text-sm mt-1">Add symbols to start tracking</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <List className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No watchlist selected</h3>
              <p className="text-gray-600">Select or create a watchlist to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
