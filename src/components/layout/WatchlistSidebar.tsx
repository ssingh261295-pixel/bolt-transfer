import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Plus, X, ChevronUp, Search, ArrowUpDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useZerodhaWebSocket } from '../../hooks/useZerodhaWebSocket';

interface WatchlistSidebarProps {
  onBuyClick: (symbol: string, exchange: string, token: number) => void;
  onSellClick: (symbol: string, exchange: string, token: number) => void;
  onGTTClick: (symbol: string, exchange: string, token: number) => void;
  onHMTGTTClick?: (symbol: string, exchange: string, token: number) => void;
}

export default function WatchlistSidebar({ onBuyClick, onSellClick, onGTTClick, onHMTGTTClick }: WatchlistSidebarProps) {
  const { user } = useAuth();
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [vixCachePrice, setVixCachePrice] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [sortAZ, setSortAZ] = useState(false);

  const { isConnected, connect, subscribe, unsubscribe, getTick } = useZerodhaWebSocket(brokerId || undefined);

  const watchlistItems = useMemo(() => {
    if (!selectedWatchlist?.symbols) return [];
    const items = selectedWatchlist.symbols.map((s: any) => ({
      id: s.instrument_token?.toString() || s.symbol,
      instrument_token: s.instrument_token,
      tradingsymbol: s.symbol,
      exchange: s.exchange,
    }));
    if (sortAZ) {
      return [...items].sort((a: any, b: any) => a.tradingsymbol.localeCompare(b.tradingsymbol));
    }
    return items;
  }, [selectedWatchlist, sortAZ]);

  useEffect(() => {
    if (user) {
      loadWatchlists();
      loadBrokerConnection();
    }
  }, [user]);

  useEffect(() => {
    if (brokerId && !isConnected) {
      connect();
    }
  }, [brokerId, isConnected, connect]);

  useEffect(() => {
    if (isConnected && watchlistItems.length > 0) {
      const indexTokens = watchlistItems
        .map((item: any) => item.instrument_token)
        .filter((token: number) => (token & 0xff) === 9);
      const tradableTokens = watchlistItems
        .map((item: any) => item.instrument_token)
        .filter((token: number) => (token & 0xff) !== 9);

      if (tradableTokens.length > 0) subscribe(tradableTokens, 'full');
      if (indexTokens.length > 0) subscribe(indexTokens, 'quote');

      const allTokens = watchlistItems.map((item: any) => item.instrument_token);
      return () => {
        unsubscribe(allTokens);
      };
    }
  }, [isConnected, watchlistItems, subscribe, unsubscribe]);

  useEffect(() => {
    const hasVix = watchlistItems.some((item: any) => item.instrument_token === 264969);
    if (!hasVix) return;

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
  }, [watchlistItems, brokerId]);

  const loadBrokerConnection = async () => {
    try {
      const { data: broker } = await supabase
        .from('broker_connections')
        .select('id')
        .eq('user_id', user?.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (broker) setBrokerId(broker.id);
    } catch (error) {
      console.error('Error loading broker:', error);
    }
  };

  const loadWatchlists = async () => {
    try {
      const { data } = await supabase
        .from('watchlists')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: true });

      if (data && data.length > 0) {
        setWatchlists(data);
        setSelectedWatchlist((prev: any) => {
          if (!prev) return data[0];
          const updated = data.find((w: any) => w.id === prev.id);
          return updated || data[0];
        });
      } else {
        setWatchlists([]);
      }
    } catch (error) {
      console.error('Error loading watchlists:', error);
    } finally {
      setLoading(false);
    }
  };

  const createWatchlist = async () => {
    if (!newWatchlistName.trim() || watchlists.length >= 7) return;
    await supabase.from('watchlists').insert({
      user_id: user?.id,
      name: newWatchlistName.trim(),
      symbols: [],
    });
    setNewWatchlistName('');
    setShowCreateForm(false);
    await loadWatchlists();
  };

  const searchInstruments = async (query: string) => {
    if (!query || query.length < 2) { setSearchResults([]); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const [nfoResp, nseResp] = await Promise.all([
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=NFO&search=${encodeURIComponent(query)}`,
          { headers: { 'Authorization': `Bearer ${session.access_token}` } }
        ),
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=NSE&search=${encodeURIComponent(query)}`,
          { headers: { 'Authorization': `Bearer ${session.access_token}` } }
        ),
      ]);
      const [nfoResult, nseResult] = await Promise.all([nfoResp.json(), nseResp.json()]);
      const nfoInstruments = nfoResult.success ? (nfoResult.instruments || []).filter((i: any) => i.instrument_type === 'FUT') : [];
      const nseInstruments = nseResult.success ? (nseResult.instruments || []).filter((i: any) =>
        i.instrument_type === 'EQ' || i.instrument_type === 'INDICES' || i.instrument_token === 264969
      ) : [];
      setSearchResults([...nseInstruments.slice(0, 5), ...nfoInstruments.slice(0, 15)]);
    } catch (_) { /* ignore */ }
  };

  const addInstrument = async (inst: any) => {
    if (!selectedWatchlist) return;
    const current = selectedWatchlist.symbols || [];
    if (current.some((s: any) => s.instrument_token === parseInt(inst.instrument_token))) return;
    const newSym = {
      symbol: inst.tradingsymbol,
      exchange: inst.exchange,
      instrument_token: parseInt(inst.instrument_token),
      name: inst.name,
      instrument_type: inst.instrument_type,
      expiry: inst.expiry,
      strike: inst.strike,
      lot_size: inst.lot_size,
    };
    const updated = [newSym, ...current];
    await supabase.from('watchlists').update({ symbols: updated }).eq('id', selectedWatchlist.id);
    setSelectedWatchlist({ ...selectedWatchlist, symbols: updated });
  };

  const removeInstrument = async (token: number) => {
    if (!selectedWatchlist) return;
    const updated = (selectedWatchlist.symbols || []).filter((s: any) => s.instrument_token !== token);
    await supabase.from('watchlists').update({ symbols: updated }).eq('id', selectedWatchlist.id);
    setSelectedWatchlist({ ...selectedWatchlist, symbols: updated });
  };

  const getPriceColor = (change?: number) => {
    if (!change) return 'text-gray-600';
    return change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-600';
  };

  if (isCollapsed) {
    return (
      <div className="hidden md:flex w-12 bg-white border-r border-gray-200 flex-col items-center py-4">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 hover:bg-gray-100 rounded"
          aria-label="Expand watchlist"
        >
          <ChevronUp className="w-5 h-5 rotate-90" />
        </button>
      </div>
    );
  }

  return (
    <div className="hidden md:flex w-full md:w-72 bg-white border-r border-gray-200 flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm text-gray-900">
              {selectedWatchlist?.name || 'Watchlist'}{' '}
              <span className="text-gray-400 font-normal">({watchlistItems.length})</span>
            </h2>
            {brokerId && (
              <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                <span className="text-gray-500">{isConnected ? 'Live' : 'Connecting...'}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSortAZ(v => !v)}
              className={`p-1 rounded transition-colors ${sortAZ ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
              title={sortAZ ? 'Sort: A to Z (click to reset)' : 'Sort A to Z'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-gray-100 rounded"
              aria-label="Collapse watchlist"
            >
              <ChevronUp className="w-4 h-4 rotate-90" />
            </button>
          </div>
        </div>
      </div>

      {/* Inline create form */}
      {showCreateForm && (
        <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
          <input
            type="text"
            value={newWatchlistName}
            onChange={(e) => setNewWatchlistName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createWatchlist();
              if (e.key === 'Escape') { setShowCreateForm(false); setNewWatchlistName(''); }
            }}
            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="Name"
            autoFocus
          />
          <button onClick={createWatchlist} className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">OK</button>
          <button onClick={() => { setShowCreateForm(false); setNewWatchlistName(''); }} className="text-gray-400 hover:text-gray-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search */}
      {selectedWatchlist && (
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); searchInstruments(e.target.value); }}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-gray-50"
              placeholder="Search instruments (NSE / F&O)..."
            />
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded bg-white shadow-sm">
              {searchResults.map((inst: any) => {
                const alreadyAdded = (selectedWatchlist?.symbols || []).some(
                  (s: any) => s.instrument_token === parseInt(inst.instrument_token)
                );
                return (
                  <div
                    key={inst.instrument_token}
                    className={`flex items-center justify-between px-2.5 py-1.5 text-xs ${
                      alreadyAdded ? 'bg-green-50' : 'hover:bg-gray-50 cursor-pointer'
                    }`}
                    onClick={() => !alreadyAdded && addInstrument(inst)}
                  >
                    <span className="font-medium text-gray-900 truncate">{inst.tradingsymbol}</span>
                    {alreadyAdded ? (
                      <span className="text-green-600 text-[10px] ml-1 flex-shrink-0">✓</span>
                    ) : (
                      <Plus className="w-3 h-3 text-blue-600 flex-shrink-0 ml-1" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Items List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
        ) : watchlistItems.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            <p>No items</p>
            <p className="mt-1 text-xs">Search above to add instruments</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {watchlistItems.map((item: any) => {
              const tick = getTick(item.instrument_token);
              const isVix = item.instrument_token === 264969;
              const lastPrice = tick?.last_price || (isVix ? vixCachePrice : null) || 0;
              const previousClose = tick?.close || 0;
              const change = tick?.change !== undefined && tick.change !== 0
                ? tick.change
                : (previousClose > 0 ? (lastPrice - previousClose) : 0);
              const changePercent = previousClose > 0 ? ((change / previousClose) * 100) : 0;

              return (
                <div
                  key={item.id}
                  className="px-3 py-2 cursor-pointer relative group border-b border-gray-100 min-h-[44px]"
                  onMouseEnter={() => setHoveredItem(item.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  {hoveredItem === item.id ? (
                    <div className="flex items-center justify-between gap-2 h-[28px]">
                      <div className="font-medium text-[13px] text-gray-900 truncate flex-1 min-w-0">
                        {item.tradingsymbol}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => onBuyClick(item.tradingsymbol, item.exchange, item.instrument_token)}
                          className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 transition-colors"
                        >
                          B
                        </button>
                        <button
                          onClick={() => onSellClick(item.tradingsymbol, item.exchange, item.instrument_token)}
                          className="px-2.5 py-1 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700 transition-colors"
                        >
                          S
                        </button>
                        {onHMTGTTClick && (
                          <button
                            onClick={() => onHMTGTTClick(item.tradingsymbol, item.exchange, item.instrument_token)}
                            className="px-2.5 py-1 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700 transition-colors"
                            title="HMT GTT"
                          >
                            H
                          </button>
                        )}
                        <button
                          onClick={() => onGTTClick(item.tradingsymbol, item.exchange, item.instrument_token)}
                          className="px-2.5 py-1 bg-gray-600 text-white text-xs font-semibold rounded hover:bg-gray-700 transition-colors"
                          title="GTT"
                        >
                          G
                        </button>
                        <button
                          onClick={() => removeInstrument(item.instrument_token)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                        >
                          <X className="w-3.5 h-3.5 text-gray-600" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-1.5 h-[28px]">
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="font-medium text-[13px] text-gray-900 truncate leading-tight">
                          {item.tradingsymbol}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <div className={`font-bold text-[13px] ${getPriceColor(change)} text-right`}>
                          {lastPrice > 0 ? `₹${lastPrice.toFixed(2)}` : '₹0.00'}
                        </div>
                        {change !== 0 && (
                          <div className={`flex items-center gap-0.5 text-[10px] font-semibold ${getPriceColor(change)}`}>
                            {change > 0 ? (
                              <TrendingUp className="w-2.5 h-2.5 flex-shrink-0" />
                            ) : (
                              <TrendingDown className="w-2.5 h-2.5 flex-shrink-0" />
                            )}
                            <span className="whitespace-nowrap">
                              {change > 0 ? '+' : ''}₹{Math.abs(change).toFixed(2)} ({changePercent.toFixed(2)}%)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom numbered tabs */}
      <div className="flex items-center border-t border-gray-200">
        {watchlists.map((wl, i) => (
          <button
            key={wl.id}
            onClick={() => setSelectedWatchlist(wl)}
            className={`flex-1 py-2.5 text-xs font-medium transition ${
              selectedWatchlist?.id === wl.id
                ? 'text-blue-600 border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-700'
            }`}
            title={wl.name}
          >
            {i + 1}
          </button>
        ))}
        {watchlists.length < 7 && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-2.5 text-gray-400 hover:text-blue-600 text-sm transition"
            title="New watchlist"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
