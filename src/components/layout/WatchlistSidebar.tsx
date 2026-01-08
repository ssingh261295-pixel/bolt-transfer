import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Plus, X, ChevronUp, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useZerodhaWebSocket } from '../../hooks/useZerodhaWebSocket';
import AddToWatchlistModal from '../watchlist/AddToWatchlistModal';

interface WatchlistItem {
  id: string;
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  last_price?: number;
  change?: number;
  change_percent?: number;
}

interface WatchlistSidebarProps {
  onBuyClick: (symbol: string, exchange: string, token: number) => void;
  onSellClick: (symbol: string, exchange: string, token: number) => void;
  onGTTClick: (symbol: string, exchange: string, token: number) => void;
}

export default function WatchlistSidebar({ onBuyClick, onSellClick, onGTTClick }: WatchlistSidebarProps) {
  const { user } = useAuth();
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [brokerId, setBrokerId] = useState<string | null>(null);

  const { isConnected, connect, subscribe, unsubscribe, getTick } = useZerodhaWebSocket(brokerId || undefined);

  useEffect(() => {
    if (user) {
      loadWatchlist();
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
      const tokens = watchlistItems.map(item => item.instrument_token);
      subscribe(tokens, 'full');

      return () => {
        unsubscribe(tokens);
      };
    }
  }, [isConnected, watchlistItems, subscribe, unsubscribe]);

  const loadBrokerConnection = async () => {
    try {
      const { data: broker } = await supabase
        .from('broker_connections')
        .select('id')
        .eq('user_id', user?.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (broker) {
        setBrokerId(broker.id);
      }
    } catch (error) {
      console.error('Error loading broker:', error);
    }
  };

  const loadWatchlist = async () => {
    try {
      const { data: watchlists } = await supabase
        .from('watchlists')
        .select('id')
        .eq('user_id', user?.id)
        .limit(1)
        .maybeSingle();

      if (!watchlists) {
        const { data: newWatchlist } = await supabase
          .from('watchlists')
          .insert({ user_id: user?.id, name: 'Default' })
          .select()
          .single();

        if (newWatchlist) {
          setLoading(false);
        }
        return;
      }

      const { data: items } = await supabase
        .from('watchlist_items')
        .select('*')
        .eq('watchlist_id', watchlists.id)
        .order('sort_order');

      if (items) {
        setWatchlistItems(items);
      }
    } catch (error) {
      console.error('Error loading watchlist:', error);
    } finally {
      setLoading(false);
    }
  };

  const removeFromWatchlist = async (itemId: string) => {
    try {
      await supabase
        .from('watchlist_items')
        .delete()
        .eq('id', itemId);

      setWatchlistItems(prev => prev.filter(item => item.id !== itemId));
    } catch (error) {
      console.error('Error removing item:', error);
    }
  };

  const getPriceColor = (change?: number) => {
    if (!change) return 'text-gray-600';
    return change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-600';
  };

  const getPriceBgColor = (change?: number) => {
    if (!change) return 'bg-gray-50';
    return change > 0 ? 'bg-green-50' : change < 0 ? 'bg-red-50' : 'bg-gray-50';
  };

  if (isCollapsed) {
    return (
      <div className="w-12 bg-white border-r border-gray-200 flex flex-col items-center py-4">
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
    <div className="w-full sm:w-80 lg:w-72 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-900">Watchlist</h2>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 hover:bg-gray-100 rounded"
            aria-label="Collapse watchlist"
          >
            <ChevronDown className="w-4 h-4 rotate-90" />
          </button>
        </div>
        {brokerId && (
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`}></div>
            <span className="text-gray-600">
              {isConnected ? 'Live' : 'Connecting...'}
            </span>
          </div>
        )}
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
        ) : watchlistItems.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            <p>No items in watchlist</p>
            <p className="mt-2 text-xs">Add instruments from the search</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {watchlistItems.map((item) => {
              const tick = getTick(item.instrument_token);
              const lastPrice = tick?.last_price || 0;
              const previousClose = tick?.close || 0;
              const change = previousClose > 0 ? (lastPrice - previousClose) : 0;
              const changePercent = previousClose > 0 ? ((change / previousClose) * 100) : 0;

              return (
                <div
                  key={item.id}
                  className="px-3 py-2 cursor-pointer relative group border-b border-gray-100 min-h-[44px]"
                  onMouseEnter={() => setHoveredItem(item.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  {hoveredItem === item.id ? (
                    // Hover state: Show action buttons in single row (Zerodha style)
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
                        <button
                          onClick={() => onGTTClick(item.tradingsymbol, item.exchange, item.instrument_token)}
                          className="px-2.5 py-1 bg-gray-600 text-white text-xs font-semibold rounded hover:bg-gray-700 transition-colors"
                          title="GTT"
                        >
                          G
                        </button>
                        <button
                          onClick={() => removeFromWatchlist(item.id)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                        >
                          <X className="w-3.5 h-3.5 text-gray-600" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Normal state: Show price info (Zerodha style)
                    <div className="flex items-center justify-between gap-1.5 h-[28px]">
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="font-medium text-[13px] text-gray-900 truncate leading-tight">
                          {item.tradingsymbol}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        {change !== 0 ? (
                          <div className={`flex items-center gap-0.5 text-[11px] font-semibold ${getPriceColor(change)} min-w-[50px]`}>
                            {change > 0 ? (
                              <TrendingUp className="w-3 h-3 flex-shrink-0" />
                            ) : (
                              <TrendingDown className="w-3 h-3 flex-shrink-0" />
                            )}
                            <span className="whitespace-nowrap">
                              {change > 0 ? '+' : ''}
                              {changePercent.toFixed(2)}%
                            </span>
                          </div>
                        ) : (
                          <div className="w-[50px]" />
                        )}
                        <div className={`font-bold text-[13px] ${getPriceColor(change)} text-right min-w-[55px]`}>
                          {lastPrice > 0 ? lastPrice.toFixed(2) : '0.00'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer - Add Symbol */}
      <div className="p-4 border-t border-gray-200">
        <button
          onClick={() => setShowAddModal(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Instruments
        </button>
      </div>

      <AddToWatchlistModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => {
          loadWatchlist();
          setShowAddModal(false);
        }}
      />
    </div>
  );
}
