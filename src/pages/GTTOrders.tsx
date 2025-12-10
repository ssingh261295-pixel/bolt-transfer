import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Edit2, Trash2, ArrowUpDown, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GTTModal } from '../components/orders/GTTModal';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';

type SortField = 'symbol' | 'trigger_price' | 'created_at' | 'status';
type SortDirection = 'asc' | 'desc';

export function GTTOrders() {
  const { user, session } = useAuth();
  const [gttOrders, setGttOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [selectedInstrument, setSelectedInstrument] = useState<string>('all');
  const { isConnected, connect, disconnect, subscribe, getLTP, ticks } = useZerodhaWebSocket(selectedBrokerId !== 'all' ? selectedBrokerId : brokers[0]?.id);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGTT, setEditingGTT] = useState<any>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteType, setDeleteType] = useState<'bulk' | 'single'>('bulk');
  const [deleteTarget, setDeleteTarget] = useState<{ gttId?: number; brokerId?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user) {
      loadBrokers();
    }
  }, [user]);

  useEffect(() => {
    if (brokers.length > 0 && (!selectedBrokerId || selectedBrokerId === '')) {
      setSelectedBrokerId('all');
    }
  }, [brokers]);

  useEffect(() => {
    if (selectedBrokerId && brokers.length > 0) {
      loadGTTOrders();
    }
  }, [selectedBrokerId, brokers]);

  useEffect(() => {
    const brokerId = selectedBrokerId !== 'all' ? selectedBrokerId : brokers[0]?.id;
    if (brokerId) {
      connect();
    }
    return () => disconnect();
  }, [selectedBrokerId, brokers, connect, disconnect]);

  useEffect(() => {
    if (isConnected && gttOrders.length > 0) {
      const tokens = gttOrders
        .map(order => order.condition?.instrument_token)
        .filter(Boolean);
      if (tokens.length > 0) {
        subscribe(tokens, 'full');
      }
    }
  }, [isConnected, gttOrders, subscribe]);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data && data.length > 0) {
      setBrokers(data);
    }
  };

  const loadGTTOrders = async (throwOnError = false) => {
    if (!selectedBrokerId || brokers.length === 0) return;

    setLoading(true);
    try {
      if (selectedBrokerId === 'all') {
        const fetchPromises = brokers.map(async (broker) => {
          try {
            const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${broker.id}`;
            const response = await fetch(apiUrl, {
              headers: {
                'Authorization': `Bearer ${session?.access_token}`,
                'Content-Type': 'application/json',
              },
            });
            const result = await response.json();
            if (result.success && result.data) {
              return result.data.map((order: any) => ({
                ...order,
                broker_info: {
                  id: broker.id,
                  account_name: broker.account_name,
                  account_holder_name: broker.account_holder_name,
                  client_id: broker.client_id
                }
              }));
            }
            return [];
          } catch (err) {
            console.error(`Failed to fetch GTT orders for broker ${broker.id}:`, err);
            if (throwOnError) throw err;
            return [];
          }
        });

        const results = await Promise.all(fetchPromises);
        const allOrders = results.flat();
        // Filter out triggered orders
        const activeOrders = allOrders.filter(order => order.status !== 'triggered');
        setGttOrders(sortGTTOrders(activeOrders));
      } else {
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${selectedBrokerId}`;
        const response = await fetch(apiUrl, {
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        });
        const result = await response.json();
        if (result.success && result.data) {
          const broker = brokers.find(b => b.id === selectedBrokerId);
          const ordersWithBroker = result.data.map((order: any) => ({
            ...order,
            broker_info: {
              id: broker?.id,
              account_name: broker?.account_name,
              account_holder_name: broker?.account_holder_name,
              client_id: broker?.client_id
            }
          }));
          // Filter out triggered orders
          const activeOrders = ordersWithBroker.filter((order: any) => order.status !== 'triggered');
          setGttOrders(sortGTTOrders(activeOrders));
        } else {
          setGttOrders([]);
        }
      }
    } catch (err) {
      console.error('Failed to load GTT orders:', err);
      if (throwOnError) throw err;
      setGttOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const sortGTTOrders = (data: any[]) => {
    return [...data].sort((a, b) => {
      let aVal, bVal;

      switch (sortField) {
        case 'symbol':
          aVal = a.condition?.tradingsymbol || '';
          bVal = b.condition?.tradingsymbol || '';
          break;
        case 'trigger_price':
          aVal = a.condition?.trigger_values?.[0] || 0;
          bVal = b.condition?.trigger_values?.[0] || 0;
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'created_at':
        default:
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
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

  useEffect(() => {
    if (gttOrders.length > 0) {
      setGttOrders(sortGTTOrders(gttOrders));
    }
  }, [sortField, sortDirection]);

  const handleSync = async () => {
    setSyncing(true);
    await loadGTTOrders();
    setSyncing(false);
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const uniqueInstruments = Array.from(
    new Set(gttOrders.map(order => order.condition?.tradingsymbol).filter(Boolean))
  ).sort();

  const filteredGttOrders = selectedInstrument === 'all'
    ? gttOrders
    : gttOrders.filter(order => order.condition?.tradingsymbol === selectedInstrument);

  const toggleSelectAll = () => {
    if (selectedOrders.size === filteredGttOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredGttOrders.map(order => order.id.toString())));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedOrders.size === 0) return;
    setDeleteType('bulk');
    setShowDeleteConfirm(true);
  };

  const confirmBulkDelete = async () => {
    setShowDeleteConfirm(false);
    setDeleting(true);

    console.log('Starting bulk delete:', {
      ordersCount: selectedOrders.size,
      hasSession: !!session,
      hasToken: !!session?.access_token,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      hasAnonKey: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
    });

    const deletePromises = Array.from(selectedOrders).map(async (orderId) => {
      const order = gttOrders.find(o => o.id.toString() === orderId);
      if (!order) return { success: false, error: 'Order not found', orderId };

      try {
        const brokerId = order.broker_info?.id || selectedBrokerId;

        if (!brokerId) {
          return { success: false, error: 'No broker ID available', orderId };
        }

        if (!session?.access_token) {
          console.error('No session access token available');
          return { success: false, error: 'Not authenticated', orderId };
        }

        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${brokerId}&gtt_id=${order.id}`;

        console.log(`Deleting GTT ${order.id} with broker ${brokerId}, URL: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        });

        if (!response.ok) {
          const error = await response.text();
          console.error(`Failed to delete GTT ${order.id}:`, error);
          return { success: false, error: `HTTP ${response.status}`, orderId };
        }

        const result = await response.json();
        return { success: result.success === true, orderId, error: result.error };
      } catch (err: any) {
        console.error(`Error deleting GTT ${order.id}:`, err);
        return { success: false, orderId, error: err.message || 'Network error' };
      }
    });

    const results = await Promise.all(deletePromises);
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    if (successCount > 0) {
      setSelectedOrders(new Set());
      try {
        await loadGTTOrders(true);
        setDeleteMessage(`Successfully deleted ${successCount} GTT order(s).${failedCount > 0 ? ` ${failedCount} failed.` : ''}`);
        setDeleteError('');
        setTimeout(() => setDeleteMessage(''), 5000);
      } catch (err: any) {
        setDeleteMessage('');
        setDeleteError(`Deleted ${successCount} order(s) but failed to refresh list. Please reload the page.`);
        setTimeout(() => setDeleteError(''), 5000);
      }
    } else {
      const firstError = results.find(r => !r.success)?.error || 'Unknown error';
      setDeleteError(`Failed to delete GTT orders: ${firstError}`);
      setTimeout(() => setDeleteError(''), 5000);
    }
    setDeleting(false);
  };

  const handleDelete = async (gttId: number, brokerId?: string) => {
    setDeleteType('single');
    setDeleteTarget({ gttId, brokerId });
    setShowDeleteConfirm(true);
  };

  const confirmSingleDelete = async () => {
    if (!deleteTarget?.gttId) return;
    setShowDeleteConfirm(false);
    setDeleting(true);

    const { gttId, brokerId } = deleteTarget;

    try {
      const brokerIdToUse = brokerId || selectedBrokerId;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${brokerIdToUse}&gtt_id=${gttId}`;

      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
        },
      });

      const result = await response.json();

      if (result.success) {
        setDeleteMessage('Successfully deleted GTT order');
        setTimeout(() => setDeleteMessage(''), 5000);
        await loadGTTOrders();
      } else {
        setDeleteError('Failed to delete GTT order: ' + result.error);
        setTimeout(() => setDeleteError(''), 5000);
      }
    } catch (err: any) {
      setDeleteError('Failed to delete GTT order: ' + err.message);
      setTimeout(() => setDeleteError(''), 5000);
    } finally {
      setDeleting(false);
    }
  };

  const calculatePercentage = (triggerValue: number, currentPrice: number): string => {
    if (!currentPrice || currentPrice === 0) return '0% of LTP';
    const percentOfLTP = ((triggerValue - currentPrice) / currentPrice) * 100;
    const absPercent = Math.abs(percentOfLTP);
    const sign = percentOfLTP > 0 ? '+' : '-';
    return `${sign}${absPercent.toFixed(1)}% of LTP`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">GTT ({filteredGttOrders.length})</h2>
          {isConnected && (
            <div className="flex items-center gap-1.5 mt-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs w-fit">
              <Activity className="w-3 h-3 animate-pulse" />
              Live
            </div>
          )}
        </div>
        <div className="flex gap-3">
          {brokers.length > 0 && (
            <select
              value={selectedBrokerId}
              onChange={(e) => setSelectedBrokerId(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
            >
              <option value="all">All Accounts</option>
              {brokers.map((broker) => (
                <option key={broker.id} value={broker.id}>
                  {broker.account_holder_name || broker.account_name || 'Account'}
                  {broker.client_id && ` (${broker.client_id})`}
                </option>
              ))}
            </select>
          )}
          {uniqueInstruments.length > 0 && (
            <select
              value={selectedInstrument}
              onChange={(e) => setSelectedInstrument(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
            >
              <option value="all">All Instruments</option>
              {uniqueInstruments.map((instrument) => (
                <option key={instrument} value={instrument}>
                  {instrument}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleSync}
            disabled={syncing || !selectedBrokerId}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </button>
          <button
            onClick={() => {
              setEditingGTT(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
          >
            <Plus className="w-4 h-4" />
            New GTT
          </button>
        </div>
      </div>

      {deleteMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800 font-medium">{deleteMessage}</p>
        </div>
      )}

      {deleteError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium">{deleteError}</p>
        </div>
      )}

      {deleting && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800 font-medium">Deleting GTT order(s)...</p>
        </div>
      )}

      {selectedOrders.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
          <span className="text-sm text-blue-800 font-medium">
            {selectedOrders.size} order(s) selected
          </span>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
          >
            <Trash2 className="w-4 h-4" />
            Delete Selected
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <div className="text-gray-600 font-medium">Loading GTT orders...</div>
            <div className="text-sm text-gray-500">Fetching data from Zerodha</div>
          </div>
        </div>
      ) : !selectedBrokerId ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Broker Connected</h3>
          <p className="text-gray-600">Please connect a broker account first to view GTT orders</p>
        </div>
      ) : gttOrders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No GTT orders</h3>
          <p className="text-gray-600 mb-4">Create your first GTT order to automate your trading</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-center w-12">
                  <input
                    type="checkbox"
                    checked={selectedOrders.size === filteredGttOrders.length && filteredGttOrders.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </th>
                <th
                  onClick={() => handleSort('created_at')}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1">
                    Created on
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'created_at' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('symbol')}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1">
                    Instrument
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'symbol' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                {selectedBrokerId === 'all' && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Account
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Type
                </th>
                <th
                  onClick={() => handleSort('trigger_price')}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1">
                    Trigger
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'trigger_price' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  LTP
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Qty.
                </th>
                <th
                  onClick={() => handleSort('status')}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1">
                    Status
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'status' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredGttOrders.map((gtt) => {
                const isOCO = gtt.type === 'two-leg';
                const transactionType = gtt.orders?.[0]?.transaction_type;
                const quantity = gtt.orders?.[0]?.quantity || 0;
                const instrumentToken = gtt.condition?.instrument_token;
                const ltp = instrumentToken ? getLTP(instrumentToken) : null;
                const currentPrice = ltp ?? gtt.condition?.last_price ?? 0;

                return (
                  <tr key={gtt.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(gtt.id.toString())}
                        onChange={() => toggleOrderSelection(gtt.id.toString())}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {new Date(gtt.created_at).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {gtt.condition?.tradingsymbol || 'N/A'}
                        {isConnected && ltp && (
                          <span className="ml-1 text-xs text-green-600">●</span>
                        )}
                        <span className="text-xs text-gray-500 ml-1">
                          {gtt.condition?.exchange}
                        </span>
                      </div>
                    </td>
                    {selectedBrokerId === 'all' && (
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">
                          {gtt.broker_info?.account_holder_name || gtt.broker_info?.account_name || 'Account'}
                        </div>
                        {gtt.broker_info?.client_id && (
                          <div className="text-xs text-gray-500">
                            ID: {gtt.broker_info.client_id}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium w-fit ${
                          isOCO ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {isOCO ? 'OCO' : 'SINGLE'}
                        </span>
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium w-fit ${
                          transactionType === 'BUY' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {transactionType}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isOCO ? (
                        <div className="text-sm space-y-1">
                          <div className="text-gray-900">
                            ₹{gtt.condition?.trigger_values?.[0]?.toFixed(2)}
                            <span className="text-xs text-gray-500 ml-1">
                              {calculatePercentage(gtt.condition?.trigger_values?.[0], currentPrice)}
                            </span>
                          </div>
                          <div className="text-gray-900">
                            ₹{gtt.condition?.trigger_values?.[1]?.toFixed(2)}
                            <span className="text-xs text-gray-500 ml-1">
                              {calculatePercentage(gtt.condition?.trigger_values?.[1], currentPrice)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900">
                          ₹{gtt.condition?.trigger_values?.[0]?.toFixed(2)}
                          <span className="text-xs text-gray-500 ml-1">
                            {calculatePercentage(gtt.condition?.trigger_values?.[0], currentPrice)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      ₹{currentPrice?.toFixed(2) || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {quantity}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded text-xs font-medium uppercase ${
                        gtt.status === 'active' ? 'bg-green-100 text-green-700' :
                        gtt.status === 'triggered' ? 'bg-blue-100 text-blue-700' :
                        gtt.status === 'cancelled' ? 'bg-gray-100 text-gray-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {gtt.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            if (gtt.broker_info?.id) {
                              setSelectedBrokerId(gtt.broker_info.id);
                            }
                            setEditingGTT(gtt);
                            setShowCreateModal(true);
                          }}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                          title="Edit GTT"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(gtt.id, gtt.broker_info?.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition"
                          title="Delete GTT"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {showCreateModal && (
        <GTTModal
          isOpen={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setEditingGTT(null);
            handleSync();
          }}
          brokerConnectionId={selectedBrokerId}
          editingGTT={editingGTT}
          allBrokers={brokers}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">
              Confirm Delete
            </h3>
            <p className="text-gray-600 mb-6">
              {deleteType === 'bulk'
                ? `Are you sure you want to delete ${selectedOrders.size} GTT order(s)? This action cannot be undone.`
                : 'Are you sure you want to delete this GTT order? This action cannot be undone.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteType === 'bulk') {
                    confirmBulkDelete();
                  } else {
                    confirmSingleDelete();
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
