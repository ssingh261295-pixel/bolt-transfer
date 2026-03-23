import { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Search, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';
import { PlaceOrderModal } from '../components/orders/PlaceOrderModal';
import { GTTModal } from '../components/orders/GTTModal';

export function Watchlist() {
  const { user } = useAuth();
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] = useState<any>(null);
  const [brokerId, setBrokerId] = useState<string>('');
  const [brokers, setBrokers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showGTTModal, setShowGTTModal] = useState(false);
  const [showHMTGTTModal, setShowHMTGTTModal] = useState(false);
  const [orderDefaults, setOrderDefaults] = useState<any>({});
  const [gttDefaults, setGttDefaults] = useState<any>({});
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [vixCachePrice, setVixCachePrice] = useState<number | null>(null);
  const [showInlineCreate, setShowInlineCreate] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const { isConnected, connect, disconnect, subscribe, getLTP, ticks } = useZerodhaWebSocket(brokerId);

  useEffect(() => {
    if (user) {
      loadWatchlists();
      loadBrokerConnection();
    }
  }, [user]);

  useEffect(() => {
    const fetchVix = async () => {
      if (brokerId) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const resp = await fetch(
              `${supabaseUrl}/functions/v1/zerodha-ltp?broker_id=${brokerId}&instruments=NSE:INDIA+VIX`,
              { headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } }
            );
            if (resp.ok) {
              const json = await resp.json();
              const price = json?.data?.['NSE:INDIA VIX']?.last_price;
              if (price) { setVixCachePrice(price); return; }
            }
          }
        } catch (_) { /* fall through to cache */ }
      }

      const { data } = await supabase
        .from('vix_cache')
        .select('vix_value')
        .eq('id', 1)
        .maybeSingle();
      if (data?.vix_value) setVixCachePrice(parseFloat(data.vix_value));
    };
    fetchVix();
    const interval = setInterval(fetchVix, 30000);
    return () => clearInterval(interval);
  }, [brokerId]);

  useEffect(() => {
    if (brokerId) {
      connect();
    }
    return () => disconnect();
  }, [brokerId, connect, disconnect]);

  useEffect(() => {
    if (isConnected && selectedWatchlist?.symbols) {
      const allSymbols = selectedWatchlist.symbols.filter((s: any) => s.instrument_token);
      const indexTokens = allSymbols
        .map((s: any) => s.instrument_token)
        .filter((t: number) => (t & 0xff) === 9);
      const tradableTokens = allSymbols
        .map((s: any) => s.instrument_token)
        .filter((t: number) => (t & 0xff) !== 9);

      if (tradableTokens.length > 0) subscribe(tradableTokens, 'full');
      if (indexTokens.length > 0) subscribe(indexTokens, 'quote');
    }
    setCurrentPage(1);
  }, [isConnected, selectedWatchlist, subscribe]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (showInlineCreate && inlineInputRef.current) {
      inlineInputRef.current.focus();
    }
  }, [showInlineCreate]);

  const loadBrokerConnection = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data && data.length > 0) {
      setBrokers(data);
      setBrokerId(data[0].id);
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
        .order('created_at', { ascending: true });

      if (fetchError) {
        setError(`Failed to load watchlists: ${fetchError.message}`);
        return;
      }

      if (data) {
        setWatchlists(data);
        if (data.length > 0 && !selectedWatchlist) {
          setSelectedWatchlist(data[0]);
        } else if (selectedWatchlist) {
          const updated = data.find((w: any) => w.id === selectedWatchlist.id);
          if (updated) setSelectedWatchlist(updated);
        }
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWatchlist = async () => {
    if (!newWatchlistName.trim()) return;
    if (watchlists.length >= 7) return;

    try {
      setError('');
      const { error: createError } = await supabase.from('watchlists').insert({
        user_id: user?.id,
        name: newWatchlistName.trim(),
        symbols: [],
      });

      if (createError) {
        setError(`Failed to create watchlist: ${createError.message}`);
        return;
      }

      setShowInlineCreate(false);
      setNewWatchlistName('');
      await loadWatchlists();
    } catch (err) {
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
        const remaining = watchlists.filter(w => w.id !== id);
        setSelectedWatchlist(remaining.length > 0 ? remaining[0] : null);
      }
      loadWatchlists();
    }
  };

  const searchInstruments = async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
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

      if (result.success) {
        setSearchResults(result.instruments || []);
        setShowSearchDropdown(true);
      } else {
        setError(result.error || 'Failed to search instruments');
      }
    } catch (error) {
      setError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    try {
      const updatedSymbols = [newSymbol, ...currentSymbols];
      const { error: updateError } = await supabase
        .from('watchlists')
        .update({ symbols: updatedSymbols })
        .eq('id', selectedWatchlist.id);

      if (updateError) {
        setError(`Failed to add instrument: ${updateError.message}`);
        return;
      }

      setSelectedWatchlist({ ...selectedWatchlist, symbols: updatedSymbols });
      await loadWatchlists();
    } catch (err) {
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
      setSelectedWatchlist({ ...selectedWatchlist, symbols: updatedSymbols });
      loadWatchlists();
    }
  };

  const handleBuyClick = (symbol: string, exchange: string, token: number) => {
    setOrderDefaults({ symbol, exchange, instrumentToken: token, transactionType: 'BUY' });
    setShowOrderModal(true);
  };

  const handleSellClick = (symbol: string, exchange: string, token: number) => {
    setOrderDefaults({ symbol, exchange, instrumentToken: token, transactionType: 'SELL' });
    setShowOrderModal(true);
  };

  const handleGTTClick = (symbol: string, exchange: string, token: number) => {
    setGttDefaults({ symbol, exchange, instrumentToken: token });
    setShowGTTModal(true);
  };

  const handleHMTGTTClick = (symbol: string, exchange: string, token: number) => {
    setGttDefaults({ symbol, exchange, instrumentToken: token });
    setShowHMTGTTModal(true);
  };

  const symbols = selectedWatchlist?.symbols || [];
  const totalPages = Math.ceil(symbols.length / itemsPerPage);
  const pagedSymbols = symbols.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const symbolTokens = new Set(symbols.map((s: any) => s.instrument_token));

  return (
    <div className="flex flex-col" style={{ minHeight: '70vh' }}>
      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg flex items-center justify-between text-sm">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-700 hover:text-red-900 ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col flex-1" style={{ minHeight: '70vh' }}>
        {loading && watchlists.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-sm text-gray-500 mt-2">Loading...</p>
            </div>
          </div>
        ) : watchlists.length === 0 && !showInlineCreate ? (
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">No Watchlists</span>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center py-12">
                <p className="text-sm text-gray-500 mb-3">No watchlists yet</p>
                <button
                  onClick={() => setShowInlineCreate(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Create Watchlist
                </button>
              </div>
            </div>
            <div className="border-t border-gray-100 px-2 py-2 flex items-center gap-1">
              <button
                onClick={() => setShowInlineCreate(true)}
                className="flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600 transition text-lg font-light"
                title="Add watchlist"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              {selectedWatchlist ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{selectedWatchlist.name}</span>
                  <span className="text-xs text-gray-400 font-normal">
                    ({Array.isArray(selectedWatchlist.symbols) ? selectedWatchlist.symbols.length : 0})
                  </span>
                  {isConnected && (
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" title="Live"></span>
                  )}
                </div>
              ) : (
                <span className="text-sm font-semibold text-gray-700">Watchlist</span>
              )}
              {selectedWatchlist && (
                <button
                  onClick={() => {
                    if (confirm(`Delete watchlist "${selectedWatchlist.name}"?`)) {
                      handleDelete(selectedWatchlist.id);
                    }
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 rounded transition"
                  title="Delete watchlist"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Inline create input */}
            {showInlineCreate && (
              <div className="px-3 py-2 border-b border-gray-100 bg-blue-50">
                <input
                  ref={inlineInputRef}
                  type="text"
                  value={newWatchlistName}
                  onChange={(e) => setNewWatchlistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateWatchlist();
                    if (e.key === 'Escape') { setShowInlineCreate(false); setNewWatchlistName(''); }
                  }}
                  placeholder="Watchlist name, press Enter"
                  className="w-full text-sm px-2 py-1.5 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
                />
              </div>
            )}

            {/* Search */}
            {selectedWatchlist && (
              <div className="px-3 py-2 border-b border-gray-100" ref={searchRef}>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      searchInstruments(e.target.value);
                    }}
                    onFocus={() => { if (searchResults.length > 0) setShowSearchDropdown(true); }}
                    placeholder="Search F&O instruments..."
                    className="w-full pl-8 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-gray-50"
                  />
                  {searching && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <div className="w-3 h-3 border-b border-blue-500 rounded-full animate-spin"></div>
                    </div>
                  )}

                  {showSearchDropdown && searchResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 max-h-48 overflow-y-auto">
                      {searchResults.map((inst: any) => {
                        const alreadyAdded = symbolTokens.has(parseInt(inst.instrument_token));
                        return (
                          <div
                            key={inst.instrument_token}
                            className={`flex items-center justify-between px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm ${alreadyAdded ? 'opacity-60' : ''}`}
                            onClick={() => { if (!alreadyAdded) addInstrumentToWatchlist(inst); }}
                          >
                            <div>
                              <span className="font-medium text-gray-900">{inst.tradingsymbol}</span>
                              <span className="text-xs text-gray-500 ml-2">{inst.instrument_type} {inst.expiry ? `· ${inst.expiry}` : ''}</span>
                            </div>
                            {alreadyAdded ? (
                              <span className="text-xs text-green-600 font-medium">✓</span>
                            ) : (
                              <Plus className="w-3.5 h-3.5 text-blue-500" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Instrument list */}
            <div className="flex-1 overflow-y-auto">
              {!selectedWatchlist ? (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                  Select a watchlist
                </div>
              ) : pagedSymbols.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                  No instruments. Search above to add.
                </div>
              ) : (
                pagedSymbols.map((symbol: any, index: number) => {
                  const ltp = symbol.instrument_token ? getLTP(symbol.instrument_token) : null;
                  const isVix = symbol.instrument_token === 264969;
                  const tick = symbol.instrument_token ? ticks.get(symbol.instrument_token) : null;
                  const price = ltp ?? (isVix ? vixCachePrice : null) ?? symbol.price ?? 0;
                  const change = tick?.close ? (price - tick.close) : 0;
                  const changePercent = tick?.close ? ((price - tick.close) / tick.close) * 100 : 0;
                  const isPositive = change >= 0;
                  const isIndex = (symbol.instrument_token & 0xff) === 9;
                  const colorClass = change === 0 ? 'text-gray-700' : isPositive ? 'text-green-600' : 'text-red-600';
                  const isHovered = hoveredIndex === index;

                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0 cursor-default group"
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <div className={`text-sm font-medium truncate ${colorClass}`}>{symbol.symbol}</div>
                        {isIndex && (
                          <div className="text-xs text-gray-400 uppercase tracking-wide">INDEX</div>
                        )}
                      </div>

                      {isHovered ? (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleBuyClick(symbol.symbol, symbol.exchange, symbol.instrument_token)}
                            className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition"
                            title="Buy"
                          >
                            B
                          </button>
                          <button
                            onClick={() => handleSellClick(symbol.symbol, symbol.exchange, symbol.instrument_token)}
                            className="px-2 py-1 text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 rounded transition"
                            title="Sell"
                          >
                            S
                          </button>
                          <button
                            onClick={() => handleHMTGTTClick(symbol.symbol, symbol.exchange, symbol.instrument_token)}
                            className="px-2 py-1 text-xs font-semibold bg-violet-100 text-violet-700 hover:bg-violet-200 rounded transition"
                            title="HMT GTT"
                          >
                            H
                          </button>
                          <button
                            onClick={() => handleGTTClick(symbol.symbol, symbol.exchange, symbol.instrument_token)}
                            className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 rounded transition"
                            title="GTT"
                          >
                            G
                          </button>
                          <button
                            onClick={() => removeInstrumentFromWatchlist(symbol.instrument_token)}
                            className="px-2 py-1 text-xs font-semibold bg-red-50 text-red-500 hover:bg-red-100 rounded transition"
                            title="Remove"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className={`flex items-center gap-2 text-right flex-shrink-0 ${colorClass}`}>
                          <div className="text-xs tabular-nums">
                            <span>{change >= 0 ? '+' : ''}{change.toFixed(2)}</span>
                            <span className="ml-1">{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>
                          </div>
                          <div>
                            {isPositive ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="text-sm font-semibold tabular-nums w-16 text-right">
                            {price > 0 ? price.toFixed(2) : '-'}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="border-t border-gray-100 px-3 py-2 flex items-center justify-center gap-3 text-xs text-gray-500">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 hover:bg-gray-100 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span>{currentPage}/{totalPages}</span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="p-1 hover:bg-gray-100 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Bottom tabs */}
            <div className="border-t border-gray-100 px-2 py-2 flex items-center gap-1">
              {watchlists.map((wl, idx) => (
                <button
                  key={wl.id}
                  onClick={() => { setSelectedWatchlist(wl); setCurrentPage(1); }}
                  className={`flex items-center justify-center w-8 h-8 rounded text-xs font-semibold transition ${
                    selectedWatchlist?.id === wl.id
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title={wl.name}
                >
                  {idx + 1}
                </button>
              ))}
              <button
                onClick={() => { if (watchlists.length < 7) setShowInlineCreate(true); }}
                disabled={watchlists.length >= 7}
                className="flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-blue-600 hover:bg-gray-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
                title={watchlists.length >= 7 ? 'Maximum 7 watchlists' : 'Add watchlist'}
              >
                <Plus className="w-4 h-4" />
              </button>
              {selectedWatchlist && (
                <button
                  onClick={() => {
                    if (confirm(`Delete watchlist "${selectedWatchlist.name}"?`)) {
                      handleDelete(selectedWatchlist.id);
                    }
                  }}
                  className="ml-auto flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-red-500 hover:bg-gray-100 transition"
                  title="Delete current watchlist"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {showOrderModal && (
        <PlaceOrderModal
          isOpen={showOrderModal}
          onClose={() => { setShowOrderModal(false); setOrderDefaults({}); }}
          initialSymbol={orderDefaults.symbol}
          initialExchange={orderDefaults.exchange}
          initialTransactionType={orderDefaults.transactionType}
        />
      )}

      {showGTTModal && (
        <GTTModal
          isOpen={showGTTModal}
          onClose={() => { setShowGTTModal(false); setGttDefaults({}); }}
          brokerConnectionId={brokerId || 'all'}
          initialSymbol={gttDefaults.symbol}
          initialExchange={gttDefaults.exchange}
          allBrokers={brokers}
        />
      )}

      {showHMTGTTModal && (
        <GTTModal
          isOpen={showHMTGTTModal}
          onClose={() => { setShowHMTGTTModal(false); setGttDefaults({}); }}
          brokerConnectionId={brokerId || 'all'}
          initialSymbol={gttDefaults.symbol}
          initialExchange={gttDefaults.exchange}
          allBrokers={brokers}
          isHMTMode={true}
        />
      )}
    </div>
  );
}
