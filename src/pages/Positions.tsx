import { useEffect, useState, useRef } from 'react';
import { LineChart, RefreshCw, ArrowUpDown, Activity, MoreVertical } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodha } from '../hooks/useZerodha';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';
import { GTTModal } from '../components/orders/GTTModal';
import { ExitPositionModal } from '../components/orders/ExitPositionModal';
import { PlaceOrderModal } from '../components/orders/PlaceOrderModal';

type SortField = 'symbol' | 'quantity' | 'average_price' | 'current_price' | 'pnl' | 'pnl_percentage';
type SortDirection = 'asc' | 'desc';

export function Positions() {
  const { user } = useAuth();
  const { syncPositions, loading: syncLoading } = useZerodha();
  const [positions, setPositions] = useState<any[]>([]);
  const [allPositions, setAllPositions] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<string>('all');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('all');
  const [syncMessage, setSyncMessage] = useState('');
  const [summary, setSummary] = useState({
    totalPnL: 0,
    totalInvested: 0,
  });
  const [gttModalOpen, setGttModalOpen] = useState(false);
  const [hmtGttModalOpen, setHmtGttModalOpen] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [addOrderModalOpen, setAddOrderModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<any>(null);
  const [sortField, setSortField] = useState<SortField>('pnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [isExiting, setIsExiting] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { isConnected, connect, disconnect, subscribe, getLTP, ticks } = useZerodhaWebSocket(selectedBroker !== 'all' ? selectedBroker : brokers[0]?.id);

  useEffect(() => {
    if (user) {
      loadPositions();
      loadBrokers();
    }
  }, [user]);

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
    filterPositions();
  }, [selectedBroker, selectedSymbol, allPositions]);

  useEffect(() => {
    const brokerId = selectedBroker !== 'all' ? selectedBroker : brokers[0]?.id;
    if (brokerId) {
      connect();
    }
    return () => disconnect();
  }, [selectedBroker, brokers, connect, disconnect]);

  useEffect(() => {
    if (isConnected && positions.length > 0) {
      const tokens = positions
        .map(p => p.instrument_token)
        .filter(Boolean);
      if (tokens.length > 0) {
        subscribe(tokens, 'full');
      }
    }
  }, [isConnected, positions, subscribe]);

  const loadPositions = async () => {
    const { data } = await supabase
      .from('positions')
      .select(`
        *,
        broker_connections!inner (
          account_name,
          broker_name,
          client_id,
          account_holder_name,
          is_active
        )
      `)
      .eq('user_id', user?.id)
      .eq('broker_connections.is_active', true)
      .neq('quantity', 0)
      .order('created_at', { ascending: false });

    if (data) {
      setAllPositions(data);
    }
  };

  const sortPositions = (data: any[]) => {
    return [...data].sort((a, b) => {
      let aVal, bVal;

      switch (sortField) {
        case 'symbol':
          aVal = a.symbol || '';
          bVal = b.symbol || '';
          break;
        case 'quantity':
          aVal = a.quantity || 0;
          bVal = b.quantity || 0;
          break;
        case 'average_price':
          aVal = a.average_price || 0;
          bVal = b.average_price || 0;
          break;
        case 'current_price':
          aVal = a.current_price || 0;
          bVal = b.current_price || 0;
          break;
        case 'pnl':
          aVal = a.pnl || 0;
          bVal = b.pnl || 0;
          break;
        case 'pnl_percentage':
        default:
          aVal = a.pnl_percentage || 0;
          bVal = b.pnl_percentage || 0;
          break;
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const filterPositions = () => {
    let filtered = allPositions;

    if (selectedBroker !== 'all') {
      filtered = filtered.filter(pos => pos.broker_connection_id === selectedBroker);
    }

    if (selectedSymbol !== 'all') {
      filtered = filtered.filter(pos => pos.symbol === selectedSymbol);
    }

    setPositions(sortPositions(filtered));
    updateSummary(filtered);
  };

  const updateSummary = (positionsToSum: any[]) => {
    const totalPnL = positionsToSum.reduce((sum, pos) => {
      const ltp = pos.instrument_token ? getLTP(pos.instrument_token) : null;
      const currentPrice = ltp ?? pos.current_price ?? pos.average_price;
      const pnl = (currentPrice - pos.average_price) * pos.quantity;
      return sum + pnl;
    }, 0);

    const totalInvested = positionsToSum.reduce((sum, pos) => {
      return sum + (Math.abs(pos.quantity) * pos.average_price);
    }, 0);

    setSummary({ totalPnL, totalInvested });
  };

  useEffect(() => {
    if (positions.length > 0) {
      const filtered = selectedBroker === 'all' ? allPositions : allPositions.filter(pos => pos.broker_connection_id === selectedBroker);
      setPositions(sortPositions(filtered));
    }
  }, [sortField, sortDirection]);

  useEffect(() => {
    if (ticks.size > 0 && positions.length > 0) {
      const filtered = selectedBroker === 'all' ? positions : positions.filter(pos => pos.broker_connection_id === selectedBroker);
      updateSummary(filtered);
    }
  }, [ticks, positions, selectedBroker]);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data) {
      setBrokers(data);
    }
  };

  const handleSync = async () => {
    if (brokers.length === 0) {
      setSyncMessage('No active broker connections found');
      setTimeout(() => setSyncMessage(''), 3000);
      return;
    }

    setSyncMessage(`Syncing positions from ${brokers.length} account(s)...`);

    // Sync all brokers in parallel for faster performance
    const syncPromises = brokers.map(async (broker) => {
      try {
        const accountName = broker.account_holder_name
          ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
          : broker.account_name || `Account (${broker.api_key.substring(0, 8)}...)`;

        const result = await syncPositions(broker.id);

        if (result.success) {
          console.log(`Successfully synced ${result.synced} positions from ${accountName}`);
          return { success: true, synced: result.synced || 0, accountName };
        } else {
          console.error(`Failed to sync ${accountName}:`, result.error);
          return { success: false, error: result.error, accountName };
        }
      } catch (err: any) {
        const accountName = broker.account_holder_name
          ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
          : broker.account_name || `Account (${broker.api_key.substring(0, 8)}...)`;
        console.error(`Error syncing ${accountName}:`, err);
        return { success: false, error: err.message || 'Unknown error', accountName };
      }
    });

    const results = await Promise.all(syncPromises);

    const successCount = results.filter(r => r.success).length;
    const totalSynced = results.reduce((sum, r) => sum + (r.synced || 0), 0);
    const errors = results.filter(r => !r.success);

    if (errors.length === 0) {
      setSyncMessage(`✓ Synced ${totalSynced} positions from ${successCount} account(s) successfully`);
    } else if (successCount > 0) {
      setSyncMessage(`Synced ${totalSynced} positions from ${successCount} account(s), ${errors.length} failed. Check console for details.`);
    } else {
      setSyncMessage(`Failed to sync all accounts. Check console for details.`);
    }

    await loadPositions();
    setTimeout(() => setSyncMessage(''), 6000);
  };

  const handleOpenExitModal = (position?: any) => {
    if (position) {
      setExitModalOpen(true);
      setSelectedPosition(position);
    } else if (selectedPositions.size > 0) {
      setExitModalOpen(true);
    }
    setOpenMenuId(null);
  };

  const handleExitSuccess = () => {
    setSyncMessage('✓ Position(s) exited successfully');
    setSelectedPositions(new Set());
    loadPositions();
    setTimeout(() => setSyncMessage(''), 5000);
  };

  const getPositionsToExit = () => {
    if (selectedPositions.size > 0) {
      return positions.filter(p => selectedPositions.has(p.id));
    }
    if (selectedPosition) {
      return [selectedPosition];
    }
    return [];
  };

  const handleOpenGTT = (position: any) => {
    setSelectedPosition(position);
    setGttModalOpen(true);
    setOpenMenuId(null);
  };

  const handleCloseGTTModal = () => {
    setGttModalOpen(false);
    setSelectedPosition(null);
  };

  const handleOpenHMTGTT = (position: any) => {
    setSelectedPosition(position);
    setHmtGttModalOpen(true);
    setOpenMenuId(null);
  };

  const handleCloseHMTGTTModal = () => {
    setHmtGttModalOpen(false);
    setSelectedPosition(null);
  };

  const toggleMenu = (positionId: string) => {
    setOpenMenuId(openMenuId === positionId ? null : positionId);
  };

  const handleSelectAll = () => {
    if (selectedPositions.size === positions.length) {
      setSelectedPositions(new Set());
    } else {
      setSelectedPositions(new Set(positions.map(p => p.id)));
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Open Positions</h2>
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
        <div className="flex items-center gap-3">
          <select
            value={selectedBroker}
            onChange={(e) => setSelectedBroker(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
          >
            <option value="all">All Accounts</option>
            {brokers.map((broker) => (
              <option key={broker.id} value={broker.id}>
                {broker.account_holder_name
                  ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
                  : broker.account_name || `Zerodha (${broker.api_key.substring(0, 8)}...)`}
              </option>
            ))}
          </select>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
          >
            <option value="all">All Instruments</option>
            {Array.from(new Set(allPositions.map(p => p.symbol))).sort().map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
          <button
            onClick={handleSync}
            disabled={syncLoading || brokers.length === 0}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-5 h-5 ${syncLoading ? 'animate-spin' : ''}`} />
            Sync Positions
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
          {syncMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm text-gray-600 mb-1">Total P&L</h3>
          <p className={`text-3xl font-bold ${summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {summary.totalPnL >= 0 ? '+' : ''}₹{summary.totalPnL.toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm text-gray-600 mb-1">Total Invested</h3>
          <p className="text-3xl font-bold text-gray-900">₹{summary.totalInvested.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm text-gray-600 mb-1">Open Positions</h3>
          <p className="text-3xl font-bold text-gray-900">{positions.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {positions.length === 0 ? (
          <div className="text-center py-12">
            <LineChart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No open positions</h3>
            <p className="text-gray-600">Your active positions will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={positions.length > 0 && selectedPositions.size === positions.length}
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
                {positions.map((position) => {
                  const ltp = position.instrument_token ? getLTP(position.instrument_token) : null;
                  const currentPrice = ltp ?? position.current_price ?? position.average_price;
                  const pnl = (currentPrice - position.average_price) * position.quantity;
                  const pnlPercentage = ((currentPrice - position.average_price) / position.average_price) * 100;

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
                          {position.broker_connections?.account_holder_name || position.broker_connections?.account_name || 'Default Account'}
                          {position.broker_connections?.client_id && (
                            <span className="text-gray-600"> ({position.broker_connections.client_id})</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm font-medium">
                        <span className={position.quantity < 0 ? 'text-red-600' : 'text-gray-900'}>
                          {position.quantity}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                        ₹{position.average_price?.toFixed(2)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                        ₹{currentPrice.toFixed(2)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`text-sm font-medium ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
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
                          onClick={() => toggleMenu(position.id)}
                          className="p-2 hover:bg-gray-100 rounded-lg transition"
                        >
                          <MoreVertical className="w-5 h-5 text-gray-600" />
                        </button>

                        {openMenuId === position.id && (
                          <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
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
        }}
        positions={getPositionsToExit()}
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
