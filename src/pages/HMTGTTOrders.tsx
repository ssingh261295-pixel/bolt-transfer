import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Edit2, Trash2, ArrowUpDown, Activity, Power, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GTTModal } from '../components/orders/GTTModal';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';

type SortField = 'symbol' | 'trigger_price' | 'created_at' | 'status';
type SortDirection = 'asc' | 'desc';

export function HMTGTTOrders() {
  const { user, session } = useAuth();
  const [hmtGttOrders, setHmtGttOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [selectedInstrument, setSelectedInstrument] = useState<string>('all');
  const { isConnected, connect, disconnect, subscribe, getLTP } = useZerodhaWebSocket(selectedBrokerId !== 'all' ? selectedBrokerId : brokers[0]?.id);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGTT, setEditingGTT] = useState<any>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [filterStateBeforeEdit, setFilterStateBeforeEdit] = useState<{ brokerId: string; instrument: string } | null>(null);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteType, setDeleteType] = useState<'bulk' | 'single'>('bulk');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [loadingEngine, setLoadingEngine] = useState(false);

  useEffect(() => {
    if (user) {
      loadBrokers();
      loadEngineStatus();
    }
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadEngineStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (brokers.length > 0 && (!selectedBrokerId || selectedBrokerId === '')) {
      setSelectedBrokerId('all');
    }
  }, [brokers]);

  useEffect(() => {
    if (selectedBrokerId && brokers.length > 0) {
      loadHMTGTTOrders();
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
    if (isConnected && hmtGttOrders.length > 0) {
      const tokens = hmtGttOrders
        .map(order => order.instrument_token)
        .filter(Boolean);
      if (tokens.length > 0) {
        subscribe(tokens, 'full');
      }
    }
  }, [isConnected, hmtGttOrders, subscribe]);

  // Server-side engine handles all monitoring - UI just displays data
  // Listen to real-time database changes for automatic updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('hmt_gtt_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hmt_gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, () => {
        loadHMTGTTOrders(true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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

  const loadHMTGTTOrders = async (silent = false) => {
    if (!selectedBrokerId || brokers.length === 0) return;

    if (!silent) {
      setLoading(true);
    }
    try {
      let query = supabase
        .from('hmt_gtt_orders')
        .select(`
          *,
          broker_connections!inner (
            id,
            account_name,
            account_holder_name,
            client_id
          )
        `)
        .eq('user_id', user?.id)
        .in('status', ['active', 'triggered']);

      if (selectedBrokerId !== 'all') {
        query = query.eq('broker_connection_id', selectedBrokerId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        setHmtGttOrders(sortHMTGTTOrders(data));
      }
    } catch (err) {
      console.error('Failed to load HMT GTT orders:', err);
      setHmtGttOrders([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const sortHMTGTTOrders = (data: any[]) => {
    return [...data].sort((a, b) => {
      let aVal, bVal;

      switch (sortField) {
        case 'symbol':
          aVal = a.trading_symbol || '';
          bVal = b.trading_symbol || '';
          break;
        case 'trigger_price':
          aVal = a.trigger_price_1 || 0;
          bVal = b.trigger_price_1 || 0;
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
    if (hmtGttOrders.length > 0) {
      setHmtGttOrders(sortHMTGTTOrders(hmtGttOrders));
    }
  }, [sortField, sortDirection]);

  const handleSync = async () => {
    await loadHMTGTTOrders();
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
    new Set(hmtGttOrders.map(order => order.trading_symbol).filter(Boolean))
  ).sort();

  const filteredHmtGttOrders = selectedInstrument === 'all'
    ? hmtGttOrders
    : hmtGttOrders.filter(order => order.trading_symbol === selectedInstrument);

  const toggleSelectAll = () => {
    if (selectedOrders.size === filteredHmtGttOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredHmtGttOrders.map(order => order.id)));
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

    const deletePromises = Array.from(selectedOrders).map(async (orderId) => {
      try {
        const { error } = await supabase
          .from('hmt_gtt_orders')
          .delete()
          .eq('id', orderId)
          .eq('user_id', user?.id);

        if (error) throw error;
        return { success: true, orderId };
      } catch (err: any) {
        console.error(`Error deleting HMT GTT ${orderId}:`, err);
        return { success: false, orderId, error: err.message || 'Unknown error' };
      }
    });

    const results = await Promise.all(deletePromises);
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    if (successCount > 0) {
      setSelectedOrders(new Set());
      await loadHMTGTTOrders(true);
      setDeleteMessage(`Successfully deleted ${successCount} HMT GTT order(s).${failedCount > 0 ? ` ${failedCount} failed.` : ''}`);
      setDeleteError('');
      setTimeout(() => setDeleteMessage(''), 5000);
    } else {
      const firstError = results.find(r => !r.success)?.error || 'Unknown error';
      setDeleteError(`Failed to delete HMT GTT orders: ${firstError}`);
      setTimeout(() => setDeleteError(''), 5000);
    }
    setDeleting(false);
  };

  const handleDelete = async (orderId: string) => {
    setDeleteType('single');
    setDeleteTarget(orderId);
    setShowDeleteConfirm(true);
  };

  const confirmSingleDelete = async () => {
    if (!deleteTarget) return;
    setShowDeleteConfirm(false);
    setDeleting(true);

    try {
      const { error } = await supabase
        .from('hmt_gtt_orders')
        .delete()
        .eq('id', deleteTarget)
        .eq('user_id', user?.id);

      if (error) throw error;

      setDeleteMessage('Successfully deleted HMT GTT order');
      setTimeout(() => setDeleteMessage(''), 5000);
      await loadHMTGTTOrders(true);
    } catch (err: any) {
      setDeleteError('Failed to delete HMT GTT order: ' + err.message);
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

  const loadEngineStatus = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmt-trigger-engine/health`,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setEngineStatus(data);
      }
    } catch (error) {
      console.error('Failed to load engine status:', error);
    }
  };

  const handleEngineToggle = async () => {
    setLoadingEngine(true);
    try {
      const endpoint = engineStatus?.status === 'running' ? 'stop' : 'start';
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmt-trigger-engine/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (response.ok) {
        await loadEngineStatus();
      }
    } catch (error) {
      console.error('Failed to toggle engine:', error);
    } finally {
      setLoadingEngine(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">HMT GTT ({filteredHmtGttOrders.length})</h2>
          <p className="text-sm text-gray-600 mt-1">Server-Side Trigger Engine - Monitors 24/7</p>
          <div className="flex items-center gap-3 mt-2">
            {engineStatus && (
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs w-fit ${
                engineStatus.status === 'running' && engineStatus.stats?.websocket_status === 'connected'
                  ? 'bg-green-100 text-green-700'
                  : engineStatus.status === 'running'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-700'
              }`}>
                {engineStatus.status === 'running' && engineStatus.stats?.websocket_status === 'connected' ? (
                  <>
                    <Activity className="w-3 h-3 animate-pulse" />
                    Engine Running
                  </>
                ) : engineStatus.status === 'running' ? (
                  <>
                    <AlertCircle className="w-3 h-3" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Power className="w-3 h-3" />
                    Engine Stopped
                  </>
                )}
              </div>
            )}
            {isConnected && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs w-fit">
                <CheckCircle className="w-3 h-3" />
                UI Live Prices
              </div>
            )}
          </div>
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
            onClick={handleEngineToggle}
            disabled={loadingEngine}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition text-sm ${
              engineStatus?.status === 'running'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-green-600 text-white hover:bg-green-700'
            } disabled:opacity-50`}
          >
            <Power className="w-4 h-4" />
            {loadingEngine ? 'Loading...' : engineStatus?.status === 'running' ? 'Stop Engine' : 'Start Engine'}
          </button>
          <button
            onClick={handleSync}
            disabled={!selectedBrokerId}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
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
            New HMT GTT
          </button>
        </div>
      </div>

      {engineStatus && engineStatus.status === 'running' && engineStatus.stats && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-600">Active Triggers</p>
              <p className="text-lg font-semibold text-gray-900">{engineStatus.stats.active_triggers}</p>
            </div>
            <div>
              <p className="text-gray-600">Subscribed Instruments</p>
              <p className="text-lg font-semibold text-gray-900">{engineStatus.stats.subscribed_instruments}</p>
            </div>
            <div>
              <p className="text-gray-600">Processed Ticks</p>
              <p className="text-lg font-semibold text-gray-900">{engineStatus.stats.processed_ticks.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-600">Triggered Orders</p>
              <p className="text-lg font-semibold text-green-700">{engineStatus.stats.triggered_orders}</p>
            </div>
          </div>
        </div>
      )}

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
          <p className="text-sm text-blue-800 font-medium">Deleting HMT GTT order(s)...</p>
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
            <div className="text-gray-600 font-medium">Loading HMT GTT orders...</div>
          </div>
        </div>
      ) : !selectedBrokerId ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Broker Connected</h3>
          <p className="text-gray-600">Please connect a broker account first to view HMT GTT orders</p>
        </div>
      ) : hmtGttOrders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No HMT GTT orders</h3>
          <p className="text-gray-600 mb-4">Create your first Host-Monitored GTT order</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-center w-12">
                  <input
                    type="checkbox"
                    checked={selectedOrders.size === filteredHmtGttOrders.length && filteredHmtGttOrders.length > 0}
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
              {filteredHmtGttOrders.map((gtt) => {
                const isOCO = gtt.condition_type === 'two-leg';
                const ltp = getLTP(gtt.instrument_token);
                const currentPrice = ltp ?? 0;

                return (
                  <tr key={gtt.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(gtt.id)}
                        onChange={() => toggleOrderSelection(gtt.id)}
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
                        {gtt.trading_symbol || 'N/A'}
                        {isConnected && ltp && (
                          <span className="ml-1 text-xs text-green-600">●</span>
                        )}
                        <span className="text-xs text-gray-500 ml-1">
                          {gtt.exchange}
                        </span>
                      </div>
                    </td>
                    {selectedBrokerId === 'all' && (
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">
                          {gtt.broker_connections?.account_holder_name || gtt.broker_connections?.account_name || 'Account'}
                        </div>
                        {gtt.broker_connections?.client_id && (
                          <div className="text-xs text-gray-500">
                            ID: {gtt.broker_connections.client_id}
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
                          gtt.transaction_type === 'BUY' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {gtt.transaction_type}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isOCO ? (
                        <div className="text-sm space-y-1">
                          <div className="text-gray-900">
                            ₹{gtt.trigger_price_1?.toFixed(2)}
                            <span className="text-xs text-gray-500 ml-1">
                              {calculatePercentage(gtt.trigger_price_1, currentPrice)}
                            </span>
                          </div>
                          <div className="text-gray-900">
                            ₹{gtt.trigger_price_2?.toFixed(2)}
                            <span className="text-xs text-gray-500 ml-1">
                              {calculatePercentage(gtt.trigger_price_2, currentPrice)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900">
                          ₹{gtt.trigger_price_1?.toFixed(2)}
                          <span className="text-xs text-gray-500 ml-1">
                            {calculatePercentage(gtt.trigger_price_1, currentPrice)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      ₹{currentPrice?.toFixed(2) || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {gtt.quantity_1}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded text-xs font-medium uppercase ${
                        gtt.status === 'active' ? 'bg-green-100 text-green-700' :
                        gtt.status === 'triggered' ? 'bg-blue-100 text-blue-700' :
                        gtt.status === 'cancelled' ? 'bg-gray-100 text-gray-700' :
                        gtt.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {gtt.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setFilterStateBeforeEdit({
                              brokerId: selectedBrokerId,
                              instrument: selectedInstrument
                            });
                            setEditingGTT(gtt);
                            setShowCreateModal(true);
                          }}
                          disabled={gtt.status !== 'active'}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Edit HMT GTT"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(gtt.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition"
                          title="Delete HMT GTT"
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
            if (filterStateBeforeEdit) {
              setSelectedBrokerId(filterStateBeforeEdit.brokerId);
              setSelectedInstrument(filterStateBeforeEdit.instrument);
              setFilterStateBeforeEdit(null);
            }
          }}
          onSuccess={() => {
            loadHMTGTTOrders(true);
          }}
          brokerConnectionId={selectedBrokerId}
          editingGTT={editingGTT}
          allBrokers={brokers}
          isHMTMode={true}
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
                ? `Are you sure you want to delete ${selectedOrders.size} HMT GTT order(s)? This action cannot be undone.`
                : 'Are you sure you want to delete this HMT GTT order? This action cannot be undone.'}
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
