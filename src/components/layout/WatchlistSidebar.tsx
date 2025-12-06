import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
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
}

export default function WatchlistSidebar({ onBuyClick, onSellClick }: WatchlistSidebarProps) {
  const { user } = useAuth();
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [prices, setPrices] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    if (user) {
      loadWatchlist();
      const interval = setInterval(updatePrices, 3000);
      return () => clearInterval(interval);
    }
  }, [user]);

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
        updatePrices();
      }
    } catch (error) {
      console.error('Error loading watchlist:', error);
    } finally {
      setLoading(false);
    }
  };

  const updatePrices = async () => {
    const tokens = watchlistItems.map(item => item.instrument_token);
    if (tokens.length === 0) return;

    try {
      const session = await supabase.auth.getSession();
      const { data: brokers } = await supabase
        .from('broker_connections')
        .select('id')
        .eq('user_id', user?.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!brokers) return;

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-ltp?broker_id=${brokers.id}&instruments=${tokens.join(',')}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${session.data.session?.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPrices(data);
      }
    } catch (error) {
      console.error('Error fetching prices:', error);
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
        >
          <ChevronDown className="w-5 h-5 rotate-90" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Watchlist</h2>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <ChevronUp className="w-4 h-4 rotate-90" />
        </button>
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
              const priceData = prices[item.instrument_token];
              const lastPrice = priceData?.last_price || 0;
              const change = priceData?.change || 0;
              const changePercent = priceData?.change_percent || 0;

              return (
                <div
                  key={item.id}
                  className={`px-4 py-3 hover:bg-gray-50 cursor-pointer relative group ${
                    getPriceBgColor(change)
                  }`}
                  onMouseEnter={() => setHoveredItem(item.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  {/* Symbol and Exchange */}
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">
                        {item.tradingsymbol}
                      </div>
                      <div className="text-xs text-gray-500">{item.exchange}</div>
                    </div>

                    {hoveredItem === item.id && (
                      <button
                        onClick={() => removeFromWatchlist(item.id)}
                        className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3 text-gray-600" />
                      </button>
                    )}
                  </div>

                  {/* Price and Change */}
                  <div className="flex items-center justify-between">
                    <div className={`font-semibold text-sm ${getPriceColor(change)}`}>
                      ₹{lastPrice.toFixed(2)}
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${getPriceColor(change)}`}>
                      {change !== 0 && (
                        <>
                          {change > 0 ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          <span>
                            {change > 0 ? '+' : ''}
                            {changePercent.toFixed(2)}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quick Action Buttons */}
                  {hoveredItem === item.id && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => onBuyClick(item.tradingsymbol, item.exchange, item.instrument_token)}
                        className="flex-1 px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                      >
                        B
                      </button>
                      <button
                        onClick={() => onSellClick(item.tradingsymbol, item.exchange, item.instrument_token)}
                        className="flex-1 px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 transition-colors"
                      >
                        S
                      </button>
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
