import { useEffect, useState } from 'react';
import { Plus, Search, X, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';

export function Watchlist() {
  const { user } = useAuth();
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] = useState<any>(null);
  const [brokerId, setBrokerId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [showWatchlistDropdown, setShowWatchlistDropdown] = useState(false);

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
      .select('*')
      .eq('user_id', user?.id)
      .eq('broker_name', 'zerodha')
      .maybeSingle();

    if (data?.id) {
      setBrokerId(data.id);
    }
  };

  const loadWatchlists = async () => {
    const { data } = await supabase
      .from('watchlists')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at');

    if (data) {
      setWatchlists(data);
      if (data.length > 0 && !selectedWatchlist) {
        setSelectedWatchlist(data[0]);
      }
    }
  };

  const createWatchlist = async () => {
    if (!newWatchlistName.trim()) return;

    const { error } = await supabase.from('watchlists').insert({
      user_id: user?.id,
      name: newWatchlistName,
      symbols: [],
    });

    if (!error) {
      setNewWatchlistName('');
      setShowCreateModal(false);
      loadWatchlists();
    }
  };

  const searchInstruments = async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=NFO&search=${query}`,
        {
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
          },
        }
      );

      const result = await response.json();
      if (result.success) {
        setSearchResults(result.instruments.slice(0, 20));
      }
    } catch (error) {
      console.error('Error searching instruments:', error);
    } finally {
      setSearching(false);
    }
  };

  const addInstrumentToWatchlist = async (instrument: any) => {
    if (!selectedWatchlist) return;

    const currentSymbols = selectedWatchlist.symbols || [];
    const exists = currentSymbols.some((s: any) => s.instrument_token === instrument.instrument_token);

    if (exists) return;

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

    const updatedSymbols = [...currentSymbols, newSymbol];
    const { error } = await supabase
      .from('watchlists')
      .update({ symbols: updatedSymbols })
      .eq('id', selectedWatchlist.id);

    if (!error) {
      setSelectedWatchlist({ ...selectedWatchlist, symbols: updatedSymbols });
      setSearchQuery('');
      setSearchResults([]);
      await loadWatchlists();
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
      setSelectedWatchlist({ ...selectedWatchlist, symbols: updatedSymbols });
      await loadWatchlists();
    }
  };

  const deleteWatchlist = async (id: string) => {
    if (!confirm('Delete this watchlist?')) return;

    const { error } = await supabase.from('watchlists').delete().eq('id', id);
    if (!error) {
      setSelectedWatchlist(null);
      loadWatchlists();
    }
  };

  return (
    <div className="flex h-screen bg-white">
      <div className="w-80 border-r border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                searchInstruments(e.target.value);
              }}
              placeholder="Search eg: infy bse, nifty fut, index fund, etc"
              className="w-full pl-9 pr-16 py-2 text-sm border border-gray-200 rounded focus:outline-none focus:border-blue-400"
            />
            <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-400 font-mono">Ctrl + K</span>
          </div>

          {searchResults.length > 0 && (
            <div className="absolute left-3 right-3 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-80 overflow-y-auto z-50">
              {searchResults.map((inst: any) => (
                <button
                  key={inst.instrument_token}
                  onClick={() => addInstrumentToWatchlist(inst)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                >
                  <div className="font-medium text-sm text-gray-900">{inst.tradingsymbol}</div>
                  <div className="text-xs text-gray-500">{inst.name} · {inst.exchange}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <button
                  onClick={() => setShowWatchlistDropdown(!showWatchlistDropdown)}
                  className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 font-medium"
                >
                  {selectedWatchlist?.name || 'Select Watchlist'}
                  <ChevronDown className="w-3 h-3" />
                </button>
                <span className="text-xs text-gray-400">
                  ({selectedWatchlist?.symbols?.length || 0} / 250)
                </span>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-blue-600 hover:text-blue-700 text-xs font-medium"
              >
                + New group
              </button>
            </div>

            {showWatchlistDropdown && (
              <div className="mt-2 bg-white border border-gray-200 rounded shadow-lg">
                {watchlists.map((wl) => (
                  <div
                    key={wl.id}
                    className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    <button
                      onClick={() => {
                        setSelectedWatchlist(wl);
                        setShowWatchlistDropdown(false);
                      }}
                      className="flex-1 text-left text-sm text-gray-700"
                    >
                      {wl.name}
                    </button>
                    <button
                      onClick={() => deleteWatchlist(wl.id)}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedWatchlist?.symbols?.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {selectedWatchlist.symbols.map((symbol: any, index: number) => {
                const ltp = symbol.instrument_token ? getLTP(symbol.instrument_token) : null;
                const tick = symbol.instrument_token ? ticks.get(symbol.instrument_token) : null;
                const price = ltp ?? 0;
                const change = tick?.close ? (price - tick.close) : 0;
                const changePercent = tick?.close ? ((price - tick.close) / tick.close) * 100 : 0;
                const isPositive = change >= 0;

                return (
                  <div
                    key={index}
                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer group relative"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 truncate">
                          {symbol.symbol}
                        </div>
                        <div className="text-xs text-gray-500">{symbol.exchange}</div>
                      </div>
                      <div className="text-right ml-3">
                        <div className="text-sm font-medium text-gray-900">
                          {price > 0 ? `₹${price.toFixed(2)}` : '-'}
                        </div>
                        <div className={`text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {change !== 0 ? `${isPositive ? '+' : ''}${change.toFixed(2)} (${isPositive ? '+' : ''}${changePercent.toFixed(2)}%)` : '-'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeInstrumentFromWatchlist(symbol.instrument_token)}
                      className="absolute right-1 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 bg-white border border-gray-200 rounded shadow-sm hover:bg-red-50 hover:border-red-300 transition"
                    >
                      <X className="w-3 h-3 text-red-600" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500 text-sm">
              <p>No instruments in this watchlist</p>
              <p className="text-xs mt-1">Search and add instruments above</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-400">
          <div className="text-lg mb-2">Select an instrument to view details</div>
          <div className="text-sm">Charts and analysis will appear here</div>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Create New Watchlist</h3>
            <input
              type="text"
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              placeholder="Enter watchlist name"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && createWatchlist()}
            />
            <div className="flex gap-3">
              <button
                onClick={createWatchlist}
                className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewWatchlistName('');
                }}
                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
