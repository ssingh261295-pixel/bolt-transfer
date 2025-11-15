import { useEffect, useState } from 'react';
import { Plus, List, Trash2, Eye, Activity, Search, X } from 'lucide-react';
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
  const [showAddInstrument, setShowAddInstrument] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

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
    setCurrentPage(1);
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
    try {
      setLoading(true);
      setError('');
      const { data, error: fetchError } = await supabase
        .from('watchlists')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('Error loading watchlists:', fetchError);
        setError(`Failed to load watchlists: ${fetchError.message}`);
        return;
      }

      if (data) {
        setWatchlists(data);
        if (data.length > 0 && !selectedWatchlist) {
          setSelectedWatchlist(data[0]);
        }
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError('Watchlist name is required');
      return;
    }

    try {
      setError('');
      const { error: createError } = await supabase.from('watchlists').insert({
        user_id: user?.id,
        name: formData.name,
        symbols: [],
      });

      if (createError) {
        console.error('Error creating watchlist:', createError);
        setError(`Failed to create watchlist: ${createError.message}`);
        return;
      }

      setShowCreateForm(false);
      setFormData({ name: '' });
      await loadWatchlists();
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('Failed to create watchlist');
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

  const searchInstruments = async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError('Not authenticated. Please log in.');
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=NFO&search=${encodeURIComponent(query)}`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Search result:', result);

      if (result.success) {
        setSearchResults(result.instruments || []);
      } else {
        setError(result.error || 'Failed to search instruments');
      }
    } catch (error) {
      console.error('Error searching instruments:', error);
      setError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSearching(false);
    }
  };

  const addInstrumentToWatchlist = async (instrument: any) => {
    if (!selectedWatchlist) return;

    const currentSymbols = selectedWatchlist.symbols || [];
    const exists = currentSymbols.some((s: any) => s.instrument_token === instrument.instrument_token);

    if (exists) {
      setError('Instrument already in watchlist');
      return;
    }

    const newSymbol = {
      symbol: instrument.tradingsymbol,
      exchange: instrument.exchange,
      instrument_token: parseInt(instrument.instrument_token),
      name: instrument.name,
      instrument_type: instrument.instrument_type,
      expiry: instrument.expiry,
      strike: instrument.strike,
      lot_size: instrument.lot_size,
    };

    try {
      const updatedSymbols = [...currentSymbols, newSymbol];
      const { error: updateError } = await supabase
        .from('watchlists')
        .update({ symbols: updatedSymbols })
        .eq('id', selectedWatchlist.id);

      if (updateError) {
        console.error('Error adding instrument:', updateError);
        setError(`Failed to add instrument: ${updateError.message}`);
        return;
      }

      setSelectedWatchlist({ ...selectedWatchlist, symbols: updatedSymbols });
      setSearchQuery('');
      setSearchResults([]);
      await loadWatchlists();
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('Failed to add instrument');
    }
  };

  const removeInstrumentFromWatchlist = async (instrumentToken: number) => {
    if (!selectedWatchlist) return;

    const currentSymbols = selectedWatchlist.symbols || [];
    const updatedSymbols = currentSymbols.filter((s: any) => s.instrument_token !== instrumentToken);

    const { error } = await supabase
      .from('watchlists')
      .update({ symbols: updatedSymbols })
      .eq('id', selectedWatchlist.id);

    if (!error) {
      loadWatchlists();
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-700 hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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

          {loading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-sm text-gray-600 mt-2">Loading...</p>
            </div>
          )}

          {!loading && watchlists.length === 0 && (
            <div className="text-center py-8 bg-white rounded-lg border border-gray-200 p-6">
              <List className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900 mb-1">No watchlists yet</p>
              <p className="text-xs text-gray-600 mb-4">Create your first watchlist to start tracking instruments</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Create Watchlist
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          {selectedWatchlist ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{selectedWatchlist.name}</h3>
                <button
                  onClick={() => setShowAddInstrument(!showAddInstrument)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  {showAddInstrument ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {showAddInstrument ? 'Close' : 'Add Instrument'}
                </button>
              </div>

              {showAddInstrument && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        searchInstruments(e.target.value);
                      }}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Search F&O instruments (e.g., NIFTY, BANKNIFTY)"
                    />
                  </div>

                  {searching && (
                    <div className="mt-2 text-center text-sm text-gray-600">Searching...</div>
                  )}

                  {searchResults.length > 0 && (
                    <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
                      {searchResults.map((inst: any) => (
                        <div
                          key={inst.instrument_token}
                          className="flex items-center justify-between p-2 hover:bg-white rounded cursor-pointer"
                          onClick={() => addInstrumentToWatchlist(inst)}
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">{inst.tradingsymbol}</p>
                            <p className="text-xs text-gray-600">
                              {inst.name} | {inst.instrument_type} | Exp: {inst.expiry || 'N/A'}
                            </p>
                          </div>
                          <Plus className="w-4 h-4 text-blue-600" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {Array.isArray(selectedWatchlist.symbols) && selectedWatchlist.symbols.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-gray-600">
                      Showing {Math.min((currentPage - 1) * itemsPerPage + 1, selectedWatchlist.symbols.length)} - {Math.min(currentPage * itemsPerPage, selectedWatchlist.symbols.length)} of {selectedWatchlist.symbols.length} instruments
                    </p>
                    {selectedWatchlist.symbols.length > itemsPerPage && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Previous
                        </button>
                        <span className="px-3 py-1 text-sm text-gray-600">
                          Page {currentPage} of {Math.ceil(selectedWatchlist.symbols.length / itemsPerPage)}
                        </span>
                        <button
                          onClick={() => setCurrentPage(p => Math.min(Math.ceil(selectedWatchlist.symbols.length / itemsPerPage), p + 1))}
                          disabled={currentPage >= Math.ceil(selectedWatchlist.symbols.length / itemsPerPage)}
                          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-600 uppercase tracking-wider">Symbol</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-600 uppercase tracking-wider">Last</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-600 uppercase tracking-wider">Chg</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-600 uppercase tracking-wider">Chg%</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-600 uppercase tracking-wider">High</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-600 uppercase tracking-wider">Low</th>
                          <th className="text-right py-2 px-3 text-xs font-medium text-gray-600 uppercase tracking-wider">Volume</th>
                          <th className="py-2 px-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedWatchlist.symbols
                          .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                          .map((symbol: any, index: number) => {
                        const ltp = symbol.instrument_token ? getLTP(symbol.instrument_token) : null;
                        const tick = symbol.instrument_token ? ticks.get(symbol.instrument_token) : null;
                        const price = ltp ?? symbol.price ?? 0;
                        const change = tick?.close ? (price - tick.close) : 0;
                        const changePercent = tick?.close ? ((price - tick.close) / tick.close) * 100 : 0;
                        const isPositive = change >= 0;

                        return (
                          <tr key={index} className="hover:bg-gray-50 group">
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                {isConnected && ltp && (
                                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                                )}
                                <div>
                                  <p className="font-medium text-sm text-gray-900">{symbol.symbol}</p>
                                  <p className="text-xs text-gray-500">{symbol.exchange}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <p className="text-sm font-medium text-gray-900">₹{price.toFixed(2)}</p>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <p className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                {isPositive ? '+' : ''}₹{change.toFixed(2)}
                              </p>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <p className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                              </p>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <p className="text-sm text-gray-600">{tick?.high ? `₹${tick.high.toFixed(2)}` : '-'}</p>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <p className="text-sm text-gray-600">{tick?.low ? `₹${tick.low.toFixed(2)}` : '-'}</p>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <p className="text-sm text-gray-600">{tick?.volume_traded ? tick.volume_traded.toLocaleString() : '-'}</p>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <button
                                onClick={() => removeInstrumentFromWatchlist(symbol.instrument_token)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                title="Remove"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                </>
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
