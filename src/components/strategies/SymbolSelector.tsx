import { useState, useEffect } from 'react';
import { Search, X, List, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface SymbolSelectorProps {
  value: string;
  exchange: string;
  onChange: (symbol: string, exchange: string) => void;
}

const EXCHANGES = [
  { value: 'NSE', label: 'NSE' },
  { value: 'NFO', label: 'NFO' },
  { value: 'BSE', label: 'BSE' },
];

export function SymbolSelector({ value, exchange, onChange }: SymbolSelectorProps) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'watchlist'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] = useState<any>(null);
  const [selectedExchange, setSelectedExchange] = useState(exchange || 'NFO');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen && activeTab === 'watchlist') {
      loadWatchlists();
    }
  }, [isOpen, activeTab]);

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
        setError('Not authenticated');
        return;
      }

      console.log('Searching for:', query, 'in exchange:', selectedExchange);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=${selectedExchange}&search=${encodeURIComponent(query)}`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        }
      );

      if (response.ok) {
        const result = await response.json();
        console.log('Search result:', result);
        if (result.success) {
          setSearchResults(result.instruments || []);
          if (result.instruments.length === 0) {
            setError('No instruments found');
          }
        } else {
          setError(result.error || 'Search failed');
        }
      } else {
        const errorText = await response.text();
        console.error('Search error response:', errorText);
        setError(`Search failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Error searching instruments:', error);
      setError(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const selectSymbol = (symbol: string, symbolExchange: string) => {
    onChange(symbol, symbolExchange);
    setIsOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Symbol
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onClick={() => setIsOpen(true)}
          readOnly
          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
          placeholder="Click to select symbol"
        />
        {value && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange('', 'NSE');
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-25 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-50 mt-2 w-full max-w-md bg-white rounded-lg shadow-xl border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setActiveTab('search')}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
                    activeTab === 'search'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Search className="w-4 h-4 inline mr-2" />
                  Search
                </button>
                <button
                  onClick={() => setActiveTab('watchlist')}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
                    activeTab === 'watchlist'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <List className="w-4 h-4 inline mr-2" />
                  Watchlist
                </button>
              </div>

              {activeTab === 'search' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {EXCHANGES.map((ex) => (
                      <button
                        key={ex.value}
                        onClick={() => {
                          setSelectedExchange(ex.value);
                          if (searchQuery.length >= 2) {
                            searchInstruments(searchQuery);
                          }
                        }}
                        className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                          selectedExchange === ex.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        searchInstruments(e.target.value);
                      }}
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Search instruments..."
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {activeTab === 'watchlist' && watchlists.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {watchlists.map((wl) => (
                    <button
                      key={wl.id}
                      onClick={() => setSelectedWatchlist(wl)}
                      className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition ${
                        selectedWatchlist?.id === wl.id
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <Eye className="w-3 h-3 inline mr-1" />
                      {wl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {error && (
                <div className="mx-2 mb-2 p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
                  {error}
                </div>
              )}

              {activeTab === 'search' && (
                <>
                  {searching && (
                    <div className="text-center py-8 text-sm text-gray-600">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                      Searching...
                    </div>
                  )}

                  {!searching && searchQuery && searchResults.length === 0 && !error && (
                    <div className="text-center py-8 text-sm text-gray-600">
                      No instruments found
                    </div>
                  )}

                  {!searching && searchQuery === '' && (
                    <div className="text-center py-8 text-sm text-gray-500">
                      Type at least 2 characters to search
                    </div>
                  )}

                  {!searching && searchResults.length > 0 && searchResults.map((inst) => (
                    <button
                      key={inst.instrument_token}
                      onClick={() => selectSymbol(inst.tradingsymbol, inst.exchange)}
                      className="w-full text-left p-3 hover:bg-gray-50 rounded-lg transition"
                    >
                      <div className="font-medium text-gray-900">{inst.tradingsymbol}</div>
                      <div className="text-xs text-gray-600">
                        {inst.name} | {inst.exchange} | {inst.instrument_type}
                        {inst.expiry && ` | Exp: ${inst.expiry}`}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {activeTab === 'watchlist' && (
                <>
                  {watchlists.length === 0 && (
                    <div className="text-center py-8 text-sm text-gray-500">
                      No watchlists available
                    </div>
                  )}

                  {selectedWatchlist && Array.isArray(selectedWatchlist.symbols) && selectedWatchlist.symbols.length > 0 ? (
                    selectedWatchlist.symbols.map((symbol: any, index: number) => (
                      <button
                        key={index}
                        onClick={() => selectSymbol(symbol.symbol, symbol.exchange)}
                        className="w-full text-left p-3 hover:bg-gray-50 rounded-lg transition"
                      >
                        <div className="font-medium text-gray-900">{symbol.symbol}</div>
                        <div className="text-xs text-gray-600">
                          {symbol.name || symbol.symbol} | {symbol.exchange}
                          {symbol.instrument_type && ` | ${symbol.instrument_type}`}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-8 text-sm text-gray-500">
                      {selectedWatchlist ? 'No symbols in this watchlist' : 'Select a watchlist'}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
