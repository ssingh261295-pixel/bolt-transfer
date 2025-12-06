import { useState, useEffect } from 'react';
import { X, Search, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface AddToWatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

export default function AddToWatchlistModal({ isOpen, onClose, onAdded }: AddToWatchlistModalProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [filteredInstruments, setFilteredInstruments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const delaySearch = setTimeout(() => {
      if (search.trim() && search.length >= 2) {
        loadInstruments(search.trim());
      } else {
        setFilteredInstruments([]);
      }
    }, 300);

    return () => clearTimeout(delaySearch);
  }, [search]);

  const loadInstruments = async (searchTerm: string) => {
    setLoading(true);
    try {
      const session = await supabase.auth.getSession();

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=NFO&search=${encodeURIComponent(searchTerm)}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${session.data.session?.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.instruments) {
          const sortedInstruments = data.instruments.sort((a: any, b: any) => {
            return a.tradingsymbol.localeCompare(b.tradingsymbol);
          });
          setFilteredInstruments(sortedInstruments.slice(0, 50));
        }
      }
    } catch (error) {
      console.error('Error loading instruments:', error);
    } finally {
      setLoading(false);
    }
  };

  const addToWatchlist = async (instrument: any) => {
    if (!user) return;

    setAdding(instrument.instrument_token);
    try {
      const { data: watchlists } = await supabase
        .from('watchlists')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      let watchlistId = watchlists?.id;

      if (!watchlistId) {
        const { data: newWatchlist } = await supabase
          .from('watchlists')
          .insert({ user_id: user.id, name: 'Default' })
          .select()
          .single();

        watchlistId = newWatchlist?.id;
      }

      if (watchlistId) {
        await supabase.from('watchlist_items').insert({
          watchlist_id: watchlistId,
          instrument_token: instrument.instrument_token,
          tradingsymbol: instrument.tradingsymbol,
          exchange: instrument.exchange || 'NFO',
          sort_order: 0,
        });

        if (onAdded) {
          onAdded();
        }
      }
    } catch (error: any) {
      if (error?.code === '23505') {
        alert('This instrument is already in your watchlist');
      } else {
        console.error('Error adding to watchlist:', error);
        alert('Failed to add to watchlist');
      }
    } finally {
      setAdding(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Add to Watchlist</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search instruments (min 2 chars, e.g., NIFTY, BANKNIFTY)"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Searching instruments...</div>
          ) : filteredInstruments.length === 0 && search.length >= 2 ? (
            <div className="text-center py-8 text-gray-500">
              No instruments found for "{search}"
            </div>
          ) : filteredInstruments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Start typing to search FNO instruments (minimum 2 characters)
            </div>
          ) : (
            <div className="space-y-2">
              {filteredInstruments.map((instrument) => (
                <div
                  key={instrument.instrument_token}
                  className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {instrument.tradingsymbol}
                    </div>
                    {instrument.name && (
                      <div className="text-sm text-gray-500">{instrument.name}</div>
                    )}
                    <div className="text-xs text-gray-400">{instrument.exchange}</div>
                  </div>
                  <button
                    onClick={() => addToWatchlist(instrument)}
                    disabled={adding === instrument.instrument_token}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    {adding === instrument.instrument_token ? 'Adding...' : 'Add'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
