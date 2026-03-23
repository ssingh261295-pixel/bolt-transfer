import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { LineChart, ArrowUpDown, Activity, MoreVertical, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';
import { GTTModal } from '../components/orders/GTTModal';
import { ExitPositionModal } from '../components/orders/ExitPositionModal';
import { PlaceOrderModal } from '../components/orders/PlaceOrderModal';
import { formatIndianCurrency } from '../lib/formatters';

type SortField = 'symbol' | 'quantity' | 'average_price' | 'current_price' | 'pnl' | 'pnl_percentage';
type SortDirection = 'asc' | 'desc';

export function Positions() {
  const { user, session } = useAuth();
  const [allPositions, setAllPositions] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [expiredBrokerIds, setExpiredBrokerIds] = useState<Set<string>>(new Set());
  const [selectedBroker, setSelectedBroker] = useState<string>('all');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('all');
  const [syncMessage, setSyncMessage] = useState('');
  const [gttModalOpen, setGttModalOpen] = useState(false);
  const [hmtGttModalOpen, setHmtGttModalOpen] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [addOrderModalOpen, setAddOrderModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<any>(null);
  const [sortField, setSortField] = useState<SortField>('pnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [frozenPositionsForExit, setFrozenPositionsForExit] = useState<any[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [menuOpenUpward, setMenuOpenUpward] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const firstValidBrokerId = useMemo(() => {
    if (selectedBroker !== 'all') return selectedBroker;
    return brokers[0]?.id;
  }, [selectedBroker, brokers]);

  const { isConnected, connect, disconnect, subscribe, getLTP, ticks } = useZerodhaWebSocket(firstValidBrokerId);

  useEffect(() => {
    if (user) {
      loadPositions();
      loadBrokers();
    }
  }, [user]);

  useEffect(() => {
    if (brokers.length > 0 && !initialLoadDone) {
      fetchInitialPositions();
    }
  }, [brokers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (firstValidBrokerId) { connect(); }
    return () => disconnect();
  }, [firstValidBrokerId, connect, disconnect]);

  useEffect(() => {
    if (!user?.id) return;

    const posChannel = supabase
      .channel('positions_live')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'positions', filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const newPos = payload.new as any;
        if (expiredBrokerIds.has(newPos.broker_connection_id)) return;
        setAllPositions(prev => {
          if (prev.find(p => p.id === newPos.id)) return prev;
          return [...prev, newPos];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'positions', filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const updated = payload.new as any;
        setAllPositions(prev => {
          if (updated.quantity === 0) return prev.filter(p => p.id !== updated.id);
          return prev.map(p => p.id === updated.id ? { ...p, ...updated } : p);
        });
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'positions', filter: `user_id=eq.${user.id}`
      }, (payload) => {
        setAllPositions(prev => prev.filter(p => p.id !== payload.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(posChannel); };
  }, [user?.id, expiredBrokerIds]);

  useEffect(() => {
    if (!user?.id) return;
    const brokerCh = supabase
      .channel('broker_refresh_positions')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'broker_connections', filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const updated = payload.new as any;
        if (updated.token_expires_at && new Date(updated.token_expires_at) > new Date()) {
          loadBrokers();
          loadPositions();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(brokerCh); };
  }, [user?.id]);

  const loadPositions = async () => {
    const { data } = await supabase
      .from('positions')
      .select(`
        *,
        broker_connections (
          account_name,
          broker_name,
          client_id,
          account_holder_name,
          is_active
        )
      `)
      .eq('user_id', user?.id)
      .neq('quantity', 0)
      .order('created_at', { ascending: false });

    if (data) {
      setAllPositions(data);
    }
  };

  const loadBrokers = useCallback(async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('id, account_name, account_holder_name, client_id, broker_name, is_active, token_expires_at, api_key, access_token')
      .eq('user_id', user?.id)
      .eq('broker_name', 'zerodha');

    if (data && data.length > 0) {
      const now = new Date();
      const expired = new Set<string>();
      data.forEach(broker => {
        if (broker.token_expires_at && new Date(broker.token_expires_at) <= now) {
          expired.add(broker.id);
        }
      });
      setExpiredBrokerIds(expired);
      const activeBrokers = data.filter(b => !expired.has(b.id));
      setBrokers(activeBrokers);
    }
  }, [user?.id]);

  const filteredPositions = useMemo(() => {
    let filtered = allPositions.filter(pos => !expiredBrokerIds.has(pos.broker_connection_id));
    if (selectedBroker !== 'all') {
      filtered = filtered.filter(pos => pos.broker_connection_id === selectedBroker);
    }
    if (selectedSymbol !== 'all') {
      filtered = filtered.filter(pos => pos.symbol === selectedSymbol);
    }
    return filtered;
  }, [allPositions, expiredBrokerIds, selectedBroker, selectedSymbol]);

  const sortedPositions = useMemo(() => {
    return [...filteredPositions].sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'symbol': aVal = a.symbol || ''; bVal = b.symbol || ''; break;
        case 'quantity': aVal = a.quantity || 0; bVal = b.quantity || 0; break;
        case 'average_price': aVal = a.average_price || 0; bVal = b.average_price || 0; break;
        case 'current_price': aVal = a.current_price || 0; bVal = b.current_price || 0; break;
        case 'pnl': aVal = a.pnl || 0; bVal = b.pnl || 0; break;
        case 'pnl_percentage': default: aVal = a.pnl_percentage || 0; bVal = b.pnl_percentage || 0; break;
      }
      return sortDirection === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });
  }, [filteredPositions, sortField, sortDirection]);

  useEffect(() => {
    if (isConnected && sortedPositions.length > 0) {
      const tokens = sortedPositions.map(p => p.instrument_token).filter(Boolean);
      if (tokens.length > 0) {
        subscribe(tokens, 'full');
      }
    }
  }, [isConnected, sortedPositions, subscribe]);

  const summary = useMemo(() => {
    let totalPnL = 0;
    let totalInvested = 0;
    for (const pos of filteredPositions) {
      const ltp = pos.instrument_token ? getLTP(pos.instrument_token) : null;
      const currentPrice = ltp ?? pos.current_price ?? pos.average_price;
      const dayPnl = pos.close_price
        ? (currentPrice - pos.close_price) * pos.quantity
        : (currentPrice - pos.average_price) * pos.quantity;
      totalPnL += dayPnl;
      totalInvested += Math.abs(pos.quantity) * pos.average_price;
    }
    return { totalPnL, totalInvested };
  }, [filteredPositions, ticks]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const fetchInitialPositions = async () => {
    if (brokers.length === 0) return;

    setInitialLoadDone(true);
    setIsSyncing(true);

    try {
      const fetchPromises = brokers.map(async (broker) => {
        try {
          const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-positions/sync?broker_id=${broker.id}`;
          const response = await fetch(apiUrl, {
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
          });
          const result = await response.json();

          if (!result.success && (result.error?.includes('Token expired') || result.error?.includes('403'))) {
            setExpiredBrokerIds(prev => new Set([...prev, broker.id]));
          }
        } catch (err) {
          console.error(`Error syncing positions for broker ${broker.id}:`, err);
        }
      });

      await Promise.all(fetchPromises);
      await loadPositions();
    } catch (error) {
      console.error('Error in initial positions sync:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsSyncing(true);
    try {
      await fetchInitialPositions();
      setSyncMessage('Positions refreshed successfully');
      setTimeout(() => setSyncMessage(''), 3000);
    } catch (error) {
      setSyncMessage('Failed to refresh positions');
      setTimeout(() => setSyncMessage(''), 3000);
    }
  };

  const handleOpenExitModal = (position?: any) => {
    if (position) {
      setFrozenPositionsForExit([position]);
      setSelectedPosition(position);
      setExitModalOpen(true);
    } else if (selectedPositions.size > 0) {
      const positionsToFreeze = sortedPositions.filter(p => selectedPositions.has(p.id));
      setFrozenPositionsForExit(positionsToFreeze);
      setExitModalOpen(true);
    }
    setOpenMenuId(null);
  };

  const handleExitSuccess = () => {
    setSyncMessage('Position(s) exited successfully');
    setSelectedPositions(new Set());
    setFrozenPositionsForExit([]);
    loadPositions();
    setTimeout(() => setSyncMessage(''), 5000);
  };

  const handleOpenGTT = (position: any) => {
    const ltp = position.instrument_token ? getLTP(position.instrument_token) : null;
    const capturedPrice = ltp ?? position.current_price ?? position.average_price;
    setSelectedPosition({ ...position, current_price: capturedPrice });
    setGttModalOpen(true);
    setOpenMenuId(null);
  };

  const handleCloseGTTModal = () => {
    setGttModalOpen(false);
    setSelectedPosition(null);
  };

  const handleOpenHMTGTT = (position: any) => {
    const ltp = position.instrument_token ? getLTP(position.instrument_token) : null;
    const capturedPrice = ltp ?? position.current_price ?? position.average_price;
    setSelectedPosition({ ...position, current_price: capturedPrice });
    setHmtGttModalOpen(true);
    setOpenMenuId(null);
  };

  const handleCloseHMTGTTModal = () => {
    setHmtGttModalOpen(false);
    setSelectedPosition(null);
  };

  const toggleMenu = (positionId: string, event: React.MouseEvent) => {
    if (openMenuId === positionId) {
      setOpenMenuId(null);
      setMenuOpenUpward(false);
    } else {
      setOpenMenuId(positionId);
      const buttonElement = event.currentTarget as HTMLElement;
      const rect = buttonElement.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setMenuOpenUpward(spaceBelow < 180);
    }
  };

  const handleSelectAll = () => {
    if (selectedPositions.size === sortedPositions.length) {
      setSelectedPositions(new Set());
    } else {
      setSelectedPositions(new Set(sortedPositions.map(p => p.id)));
    }
  };

  const handleSelectPosition = (positionId: string) => {
    const newSelected = new Set(selectedPositions);
    if (newSelected.has(positionId)) {
      newSelected.delete(positionId);
    } else {
      newSelected.add(positionId);
    }
    setSelectedPositions(newSelected);
  };

  return (
    <div className="space-y-4 md:space-y-6 max-w-full overflow-x-hidden">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">Open Positions</h2>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-gray-600">Monitor your active trading positions</p>
            {isConnected && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                <Activity className="w-3 h-3 animate-pulse" />
                Live
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <button
            onClick={handleManualRefresh}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh positions from Zerodha"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Refresh'}
          </button>
          <select
            value={selectedBroker}
            onChange={(e) => setSelectedBroker(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm w-full md:w-auto"
          >
            <option value="all">All Accounts</option>
            {brokers.map((broker) => (
              <option key={broker.id} value={broker.id}>
                {(broker.account_holder_name || broker.account_name || 'Account')} ({broker.client_id || 'No ID'})
              </option>
            ))}
          </select>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm w-full md:w-auto"
          >
            <option value="all">All Instruments</option>
            {Array.from(new Set(allPositions.map(p => p.symbol))).sort().map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </div>
      </div>

      {syncMessage && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
          {syncMessage}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6">
          <h3 className="text-sm text-gray-600 mb-1">Today's P&L</h3>
          <p className={`text-2xl md:text-3xl font-bold ${summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {summary.totalPnL >= 0 ? '+' : ''}{formatIndianCurrency(summary.totalPnL)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6">
          <h3 className="text-sm text-gray-600 mb-1">Total Invested</h3>
          <p className="text-2xl md:text-3xl font-bold text-gray-900">{formatIndianCurrency(summary.totalInvested)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 sm:col-span-2 md:col-span-1">
          <h3 className="text-sm text-gray-600 mb-1">Open Positions</h3>
          <p className="text-2xl md:text-3xl font-bold text-gray-900">{sortedPositions.length}</p>
        </div>
      </div>

      {expiredBrokerIds.size > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              {expiredBrokerIds.size} account{expiredBrokerIds.size > 1 ? 's' : ''} with expired tokens — positions hidden
            </p>
            <p className="text-xs text-amber-600 mt-1">
              Reconnect to see positions from expired accounts.
            </p>
          </div>
          <a href="/brokers" className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition text-sm font-medium whitespace-nowrap flex-shrink-0">
            Reconnect
          </a>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {sortedPositions.length === 0 ? (
          <div className="text-center py-12">
            <LineChart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No open positions</h3>
            <p className="text-gray-600">Your active positions will appear here</p>
          </div>
        ) : (
          <>
            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {sortedPositions.map((position) => {
                const ltp = position.instrument_token ? getLTP(position.instrument_token) : null;
                const currentPrice = ltp ?? position.current_price ?? position.average_price;
                const pnl = position.close_price
                  ? (currentPrice - position.close_price) * position.quantity
                  : (currentPrice - position.average_price) * position.quantity;
                const pnlPercentage = position.close_price
                  ? ((currentPrice - position.close_price) / position.close_price) * 100
                  : ((currentPrice - position.average_price) / position.average_price) * 100;

                return (
                  <div key={position.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedPositions.has(position.id)}
                          onChange={() => handleSelectPosition(position.id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer mt-1"
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">
                            {isConnected && ltp && (
                              <span className="text-xs text-green-600 mr-1">●</span>
                            )}
                            {position.symbol}
                          </div>
                          <div className="text-xs text-gray-600">{position.exchange}</div>
                          <div className="text-xs text-gray-600 mt-1">
                            {(position.broker_connections?.account_holder_name || position.broker_connections?.account_name || 'Account')}
                          </div>
                        </div>
                      </div>
                      <div className="relative" ref={openMenuId === position.id ? menuRef : null}>
                        <button
                          onClick={(e) => toggleMenu(position.id, e)}
                          className="p-2 hover:bg-gray-100 rounded-lg transition"
                        >
                          <MoreVertical className="w-5 h-5 text-gray-600" />
                        </button>

                        {openMenuId === position.id && (
                          <div className={`absolute right-0 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50 ${
                            menuOpenUpward ? 'bottom-full mb-1' : 'mt-1'
                          }`}>
                            <div className="py-1">
                              <button
                                onClick={() => handleOpenExitModal(position)}
                                className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                              >
                                Exit position
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedPosition(position);
                                  setAddOrderModalOpen(true);
                                  setOpenMenuId(null);
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                              >
                                Add
                              </button>
                              <button
                                onClick={() => handleOpenGTT(position)}
                                className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                              >
                                Create GTT
                              </button>
                              <button
                                onClick={() => handleOpenHMTGTT(position)}
                                className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                              >
                                Create HMT GTT
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-gray-500">Qty.</div>
                        <div className={`font-semibold ${position.quantity < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {position.quantity}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Avg. Price</div>
                        <div className="font-medium text-gray-900">
                          {formatIndianCurrency(position.average_price || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">LTP</div>
                        <div className="font-medium text-gray-900">
                          {formatIndianCurrency(currentPrice)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">P&L</div>
                        <div className={`font-semibold ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {pnl >= 0 ? '+' : ''}{formatIndianCurrency(pnl)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <span className="text-xs text-gray-500">P&L %</span>
                      <span className={`text-sm font-semibold ${pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {pnlPercentage >= 0 ? '+' : ''}{pnlPercentage.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })}

              {selectedPositions.size > 0 && (
                <div className="flex justify-start items-center p-4 border-t">
                  <button
                    onClick={() => handleOpenExitModal()}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm"
                  >
                    Exit {selectedPositions.size} position{selectedPositions.size > 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto pb-44">
              <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={sortedPositions.length > 0 && selectedPositions.size === sortedPositions.length}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th
                    onClick={() => handleSort('symbol')}
                    className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Symbol
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'symbol' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Account
                  </th>
                  <th
                    onClick={() => handleSort('quantity')}
                    className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Qty.
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'quantity' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('average_price')}
                    className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Avg.
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'average_price' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('current_price')}
                    className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      LTP
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'current_price' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('pnl')}
                    className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      P&L
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'pnl' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('pnl_percentage')}
                    className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      P&L %
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'pnl_percentage' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider w-16">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedPositions.map((position) => {
                  const ltp = position.instrument_token ? getLTP(position.instrument_token) : null;
                  const currentPrice = ltp ?? position.current_price ?? position.average_price;
                  const pnl = position.close_price
                    ? (currentPrice - position.close_price) * position.quantity
                    : (currentPrice - position.average_price) * position.quantity;
                  const pnlPercentage = position.close_price
                    ? ((currentPrice - position.close_price) / position.close_price) * 100
                    : ((currentPrice - position.average_price) / position.average_price) * 100;

                  return (
                    <tr key={position.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedPositions.has(position.id)}
                          onChange={() => handleSelectPosition(position.id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {isConnected && ltp && (
                            <span className="text-xs text-green-600 mr-1">●</span>
                          )}
                          {position.symbol} <span className="text-xs text-gray-600">({position.exchange})</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="text-xs text-gray-900 font-medium">
                          {(position.broker_connections?.account_holder_name || position.broker_connections?.account_name || 'Account')} ({position.broker_connections?.client_id || 'No ID'})
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm font-medium">
                        <span className={position.quantity < 0 ? 'text-red-600' : 'text-gray-900'}>
                          {position.quantity}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                        {formatIndianCurrency(position.average_price || 0)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                        {formatIndianCurrency(currentPrice)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`text-sm font-medium ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {pnl >= 0 ? '+' : ''}{formatIndianCurrency(pnl)}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`text-sm font-medium ${pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {pnlPercentage >= 0 ? '+' : ''}{pnlPercentage.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="relative" ref={openMenuId === position.id ? menuRef : null}>
                          <button
                            onClick={(e) => toggleMenu(position.id, e)}
                            className="p-2 hover:bg-gray-100 rounded-lg transition"
                          >
                            <MoreVertical className="w-5 h-5 text-gray-600" />
                          </button>

                          {openMenuId === position.id && (
                            <div className={`absolute right-0 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50 ${
                              menuOpenUpward ? 'bottom-full mb-1' : 'mt-1'
                            }`}>
                              <div className="py-1">
                                <button
                                  onClick={() => handleOpenExitModal(position)}
                                  className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                                >
                                  Exit position
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedPosition(position);
                                    setAddOrderModalOpen(true);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                                >
                                  Add
                                </button>
                                <button
                                  onClick={() => handleOpenGTT(position)}
                                  className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                                >
                                  Create GTT
                                </button>
                                <button
                                  onClick={() => handleOpenHMTGTT(position)}
                                  className="w-full text-left px-4 py-2 hover:bg-gray-50 transition text-sm text-gray-700 block"
                                >
                                  Create HMT GTT
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {selectedPositions.size > 0 && (
              <div className="flex justify-start items-center p-4 border-t">
                <button
                  onClick={() => handleOpenExitModal()}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm"
                >
                  Exit {selectedPositions.size} position{selectedPositions.size > 1 ? 's' : ''}
                </button>
              </div>
            )}
            </div>
          </>
        )}
      </div>

      {selectedPosition && (
        <>
          <GTTModal
            isOpen={gttModalOpen}
            onClose={handleCloseGTTModal}
            brokerConnectionId={selectedPosition.broker_connection_id}
            initialSymbol={selectedPosition.symbol}
            initialExchange={selectedPosition.exchange}
            allBrokers={brokers}
            positionData={{
              quantity: Math.abs(selectedPosition.quantity),
              averagePrice: selectedPosition.average_price,
              currentPrice: selectedPosition.current_price,
              transactionType: selectedPosition.quantity > 0 ? 'SELL' : 'BUY'
            }}
          />
          <GTTModal
            isOpen={hmtGttModalOpen}
            onClose={handleCloseHMTGTTModal}
            brokerConnectionId={selectedPosition.broker_connection_id}
            initialSymbol={selectedPosition.symbol}
            initialExchange={selectedPosition.exchange}
            allBrokers={brokers}
            isHMTMode={true}
            positionData={{
              quantity: Math.abs(selectedPosition.quantity),
              averagePrice: selectedPosition.average_price,
              currentPrice: selectedPosition.current_price,
              transactionType: selectedPosition.quantity > 0 ? 'SELL' : 'BUY'
            }}
          />
        </>
      )}

      <ExitPositionModal
        isOpen={exitModalOpen}
        onClose={() => {
          setExitModalOpen(false);
          setSelectedPosition(null);
          setFrozenPositionsForExit([]);
        }}
        positions={frozenPositionsForExit}
        onSuccess={handleExitSuccess}
      />

      {selectedPosition && (
        <PlaceOrderModal
          isOpen={addOrderModalOpen}
          onClose={() => {
            setAddOrderModalOpen(false);
            setSelectedPosition(null);
          }}
          onSuccess={() => {
            loadPositions();
            setAddOrderModalOpen(false);
            setSelectedPosition(null);
          }}
          brokerConnectionId={selectedPosition.broker_connection_id}
          prefilledSymbol={selectedPosition.symbol}
          prefilledExchange={selectedPosition.exchange}
          initialTransactionType={selectedPosition.quantity > 0 ? 'BUY' : 'SELL'}
        />
      )}
    </div>
  );
}
