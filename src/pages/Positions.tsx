import { useEffect, useState } from 'react';
import { LineChart, X, RefreshCw, Bell, ArrowUpDown, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodha } from '../hooks/useZerodha';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';
import { GTTModal } from '../components/orders/GTTModal';
import { ExitPositionModal } from '../components/orders/ExitPositionModal';

type SortField = 'symbol' | 'quantity' | 'average_price' | 'current_price' | 'pnl' | 'pnl_percentage';
type SortDirection = 'asc' | 'desc';

export function Positions() {
  const { user } = useAuth();
  const { syncPositions, loading: syncLoading } = useZerodha();
  const [positions, setPositions] = useState<any[]>([]);
  const [allPositions, setAllPositions] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<string>('all');
  const [syncMessage, setSyncMessage] = useState('');
  const [summary, setSummary] = useState({
    totalPnL: 0,
    totalInvested: 0,
  });
  const [gttModalOpen, setGttModalOpen] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<any>(null);
  const [sortField, setSortField] = useState<SortField>('pnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [isExiting, setIsExiting] = useState(false);

  const { isConnected, connect, disconnect, subscribe, getLTP, ticks } = useZerodhaWebSocket(selectedBroker !== 'all' ? selectedBroker : brokers[0]?.id);

  useEffect(() => {
    if (user) {
      loadPositions();
      loadBrokers();
    }
  }, [user]);

  useEffect(() => {
    filterPositions();
  }, [selectedBroker, allPositions]);

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
      filtered = allPositions.filter(pos => pos.broker_connection_id === selectedBroker);
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

  const handleOpenExitModal = (position: any) => {
    setSelectedPosition(position);
    setExitModalOpen(true);
  };

  const handleExitSuccess = () => {
    setSyncMessage('✓ Position exited successfully');
    loadPositions();
    setTimeout(() => setSyncMessage(''), 5000);
  };

  const handleOpenGTT = (position: any) => {
    setSelectedPosition(position);
    setGttModalOpen(true);
  };

  const handleCloseGTTModal = () => {
    setGttModalOpen(false);
    setSelectedPosition(null);
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

  const handleBulkExit = async () => {
    if (selectedPositions.size === 0) return;

    const { data: gttOrders } = await supabase
      .from('gtt_orders')
      .select('id, symbol')
      .in('position_id', Array.from(selectedPositions));

    const hasGTT = gttOrders && gttOrders.length > 0;
    const gttMessage = hasGTT ? `\n\n${gttOrders.length} GTT order(s) will also be deleted.` : '';

    if (!confirm(`Are you sure you want to exit ${selectedPositions.size} position(s)?${gttMessage}`)) {
      return;
    }

    setIsExiting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const positionsToExit = positions.filter(p => selectedPositions.has(p.id));

      let successCount = 0;
      let errorCount = 0;

      for (const position of positionsToExit) {
        try {
          const exitTransactionType = position.quantity > 0 ? 'SELL' : 'BUY';
          const exitQuantity = Math.abs(position.quantity);

          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders/place`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session?.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                broker_connection_id: position.broker_connection_id,
                symbol: position.symbol,
                exchange: position.exchange,
                transaction_type: exitTransactionType,
                quantity: exitQuantity,
                order_type: 'MARKET',
                product: position.product_type || 'NRML',
                validity: 'DAY',
              }),
            }
          );

          const result = await response.json();

          if (result.success) {
            await supabase
              .from('positions')
              .update({ quantity: 0 })
              .eq('id', position.id);
            successCount++;
          } else {
            errorCount++;
          }
        } catch (err) {
          errorCount++;
        }
      }

      if (hasGTT) {
        await supabase
          .from('gtt_orders')
          .delete()
          .in('position_id', Array.from(selectedPositions));
      }

      const messages = [`✓ Successfully exited ${successCount} position(s)`];
      if (hasGTT) messages.push(`${gttOrders.length} GTT order(s) deleted`);
      if (errorCount > 0) messages.push(`${errorCount} failed`);

      setSyncMessage(messages.join(', '));
      setSelectedPositions(new Set());
      await loadPositions();
      setTimeout(() => setSyncMessage(''), 5000);
    } catch (error: any) {
      console.error('Error exiting positions:', error);
      setSyncMessage(`Error: ${error.message || 'Failed to exit positions'}`);
      setTimeout(() => setSyncMessage(''), 5000);
    } finally {
      setIsExiting(false);
    }
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
          {selectedPositions.size > 0 && (
            <button
              onClick={handleBulkExit}
              disabled={isExiting}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className={`w-5 h-5 ${isExiting ? 'animate-spin' : ''}`} />
              Exit Selected ({selectedPositions.size})
            </button>
          )}
          <select
            value={selectedBroker}
            onChange={(e) => setSelectedBroker(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
                  <th className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={positions.length > 0 && selectedPositions.size === positions.length}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th
                    onClick={() => handleSort('symbol')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Symbol
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'symbol' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Account
                  </th>
                  <th
                    onClick={() => handleSort('quantity')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Quantity
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'quantity' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('average_price')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Avg. Price
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'average_price' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('current_price')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Current Price
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'current_price' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('pnl')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      P&L
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'pnl' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('pnl_percentage')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      P&L %
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'pnl_percentage' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedPositions.has(position.id)}
                          onChange={() => handleSelectPosition(position.id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="font-medium text-gray-900">
                            {position.symbol}
                            {isConnected && ltp && (
                              <span className="ml-1 text-xs text-green-600">●</span>
                            )}
                          </div>
                          <div className="text-sm text-gray-600">{position.exchange}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 font-medium">
                          {position.broker_connections?.account_holder_name || position.broker_connections?.account_name || 'Default Account'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {position.broker_connections?.client_id && `Client ID: ${position.broker_connections.client_id}`}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {position.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ₹{position.average_price?.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ₹{currentPrice.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`font-medium ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`font-medium ${pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {pnlPercentage >= 0 ? '+' : ''}{pnlPercentage.toFixed(2)}%
                        </span>
                      </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenGTT(position)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Create GTT"
                        >
                          <Bell className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleOpenExitModal(position)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Exit position"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
          <ExitPositionModal
            isOpen={exitModalOpen}
            onClose={() => setExitModalOpen(false)}
            position={selectedPosition}
            onSuccess={handleExitSuccess}
          />
        </>
      )}
    </div>
  );
}
