import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Edit2, Trash2, ArrowUpDown, Activity, Power, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GTTModal } from '../components/orders/GTTModal';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';
import { MultiSelectFilter } from '../components/common/MultiSelectFilter';
import { HMTGTTRow } from '../components/hmt-gtt/HMTGTTRow';

type SortField = 'symbol' | 'trigger_price' | 'created_at' | 'status';
type SortDirection = 'asc' | 'desc';

export function HMTGTTOrders() {
  const { user, session } = useAuth();
  const [hmtGttOrders, setHmtGttOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);
  const { isConnected, connect, disconnect, subscribe, getLTP } = useZerodhaWebSocket(selectedBrokerId !== 'all' ? selectedBrokerId : brokers[0]?.id);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGTT, setEditingGTT] = useState<any>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [filterStateBeforeEdit, setFilterStateBeforeEdit] = useState<{ brokerId: string; instruments: string[] } | null>(null);
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
      loadPositions();
      loadEngineStatus();
    }
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadEngineStatus();
    }, 30000);
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

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('hmt_gtt_changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'hmt_gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, async (payload) => {
        const newOrder = payload.new as any;
        const broker = brokers.find(b => b.id === newOrder.broker_connection_id);

        if (broker) {
          newOrder.broker_connections = {
            id: broker.id,
            account_name: broker.account_name,
            account_holder_name: broker.account_holder_name,
            client_id: broker.client_id
          };
          setHmtGttOrders(prev => sortHMTGTTOrders([...prev, newOrder]));
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'hmt_gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const updatedFields = payload.new as any;
        setHmtGttOrders(prev => {
          const updated = prev.map(order => {
            if (order.id === updatedFields.id) {
              return {
                ...order,
                status: updatedFields.status,
                trigger_price_1: updatedFields.trigger_price_1,
                trigger_price_2: updatedFields.trigger_price_2,
                quantity_1: updatedFields.quantity_1,
                quantity_2: updatedFields.quantity_2,
                transaction_type: updatedFields.transaction_type,
                updated_at: updatedFields.updated_at
              };
            }
            return order;
          });
          return sortHMTGTTOrders(updated);
        });
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'hmt_gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const deletedId = payload.old.id;
        setHmtGttOrders(prev => prev.filter(order => order.id !== deletedId));
        setSelectedOrders(prev => {
          const newSet = new Set(prev);
          newSet.delete(deletedId);
          return newSet;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, sortField, sortDirection, brokers]);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data && data.length > 0) {
      // Filter out expired tokens
      const now = new Date();
      const activeBrokers = data.filter(broker => {
        if (!broker.token_expires_at) return true;
        const expiryDate = new Date(broker.token_expires_at);
        return expiryDate > now;
      });

      // Mark expired brokers as inactive
      const expiredBrokers = data.filter(broker => {
        if (!broker.token_expires_at) return false;
        const expiryDate = new Date(broker.token_expires_at);
        return expiryDate <= now;
      });

      if (expiredBrokers.length > 0) {
        expiredBrokers.forEach(async (broker) => {
          await supabase
            .from('broker_connections')
            .update({ is_active: false })
            .eq('id', broker.id);
        });
      }

      setBrokers(activeBrokers);
    }
  };

  const loadPositions = async () => {
    const { data } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user?.id)
      .neq('quantity', 0);

    if (data) {
      setPositions(data);
    }
  };

  const getPositionForGTT = useCallback((gtt: any) => {
    return positions.find(pos =>
      pos.symbol === gtt.trading_symbol &&
      pos.exchange === gtt.exchange &&
      pos.broker_connection_id === gtt.broker_connection_id
    );
  }, [positions]);

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

  const toggleOrderSelection = useCallback((orderId: string) => {
    setSelectedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  }, []);

  const uniqueInstruments = useMemo(() =>
    Array.from(new Set(hmtGttOrders.map(order => order.trading_symbol).filter(Boolean))).sort(),
    [hmtGttOrders]
  );

  const filteredHmtGttOrders = useMemo(() =>
    selectedInstruments.length === 0
      ? hmtGttOrders
      : hmtGttOrders.filter(order => selectedInstruments.includes(order.trading_symbol)),
    [hmtGttOrders, selectedInstruments]
  );

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
      setDeleteMessage(`Successfully deleted ${successCount} HMT GTT order(s).${failedCount > 0 ? ` ${failedCount} failed.` : ''}`);
      setDeleteError('');
      setTimeout(() => setDeleteMessage(''), 5000);
      loadHMTGTTOrders(true);
    } else {
      const firstError = results.find(r => !r.success)?.error || 'Unknown error';
      setDeleteError(`Failed to delete HMT GTT orders: ${firstError}`);
      setTimeout(() => setDeleteError(''), 5000);
    }
    setDeleting(false);
  };

  const handleDelete = useCallback((orderId: string) => {
    setDeleteType('single');
    setDeleteTarget(orderId);
    setShowDeleteConfirm(true);
  }, []);

  const handleEdit = useCallback((gtt: any) => {
    setFilterStateBeforeEdit({
      brokerId: selectedBrokerId,
      instruments: selectedInstruments
    });
    setEditingGTT(gtt);
    setShowCreateModal(true);
  }, [selectedBrokerId, selectedInstruments]);

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
      loadHMTGTTOrders(true);
    } catch (err: any) {
      setDeleteError('Failed to delete HMT GTT order: ' + err.message);
      setTimeout(() => setDeleteError(''), 5000);
    } finally {
      setDeleting(false);
    }
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

  const handleRestartEngine = async () => {
    setLoadingEngine(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmt-trigger-engine/start`,
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
      console.error('Failed to restart engine:', error);
    } finally {
      setLoadingEngine(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">HMT GTT ({filteredHmtGttOrders.length})</h2>
          <div className="flex items-center gap-3 mt-2">
            {engineStatus ? (
              <>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                  engineStatus.status === 'running' && engineStatus.stats?.websocket_status === 'connected'
                    ? 'bg-green-100 text-green-800 border border-green-300'
                    : engineStatus.status === 'stale'
                    ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                    : engineStatus.status === 'running' && engineStatus.error
                    ? 'bg-red-100 text-red-800 border border-red-300'
                    : engineStatus.status === 'running'
                    ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                    : 'bg-gray-100 text-gray-800 border border-gray-300'
                }`}>
                  {engineStatus.status === 'running' && engineStatus.stats?.websocket_status === 'connected' ? (
                    <>
                      <Activity className="w-4 h-4 animate-pulse" />
                      <span>Engine Running</span>
                    </>
                  ) : engineStatus.status === 'stale' ? (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      <span>Engine Stale - Auto-Reconnecting</span>
                    </>
                  ) : engineStatus.status === 'running' && engineStatus.error ? (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      <span>Engine Error</span>
                    </>
                  ) : engineStatus.status === 'running' ? (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Power className="w-4 h-4" />
                      <span>Engine Stopped</span>
                    </>
                  )}
                </div>
                {engineStatus.heartbeat && engineStatus.heartbeat.seconds_since_update !== null && (
                  <div className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded">
                    Heartbeat: {engineStatus.heartbeat.seconds_since_update}s ago
                  </div>
                )}
                {engineStatus.error && engineStatus.status !== 'stale' && (
                  <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                    {engineStatus.error}
                  </div>
                )}
                {(engineStatus.status === 'stopped' || engineStatus.status === 'stale') && (
                  <button
                    onClick={handleRestartEngine}
                    disabled={loadingEngine}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"
                  >
                    <Power className="w-4 h-4" />
                    {loadingEngine ? 'Restarting...' : 'Restart Engine'}
                  </button>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-500">Loading engine status...</div>
            )}
            {isConnected && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
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
                  {(broker.account_holder_name || broker.account_name || 'Account')} ({broker.client_id || 'No ID'})
                </option>
              ))}
            </select>
          )}
          {uniqueInstruments.length > 0 && (
            <MultiSelectFilter
              label="Instruments"
              options={uniqueInstruments}
              selectedValues={selectedInstruments}
              onChange={setSelectedInstruments}
              placeholder="All Instruments"
            />
          )}
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
          <div className="flex gap-2">
            <button
              onClick={() => {
                const selectedGTTs = filteredHmtGttOrders.filter(gtt => selectedOrders.has(gtt.id));
                const symbols = new Set(selectedGTTs.map(g => g.trading_symbol));
                const brokers = new Set(selectedGTTs.map(g => g.broker_connection_id));

                if (symbols.size === 1 && brokers.size >= 1) {
                  setFilterStateBeforeEdit({
                    brokerId: selectedBrokerId,
                    instruments: selectedInstruments
                  });
                  setEditingGTT({ bulkEdit: true, orders: selectedGTTs });
                  setShowCreateModal(true);
                } else {
                  alert('Please select orders for the same instrument');
                }
              }}
              disabled={selectedOrders.size === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Edit2 className="w-4 h-4" />
              Edit Selected
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
            >
              <Trash2 className="w-4 h-4" />
              Delete Selected
            </button>
          </div>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Avg. Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  P&L
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
              {filteredHmtGttOrders.map((gtt) => (
                <HMTGTTRow
                  key={gtt.id}
                  gtt={gtt}
                  isSelected={selectedOrders.has(gtt.id)}
                  onToggleSelect={toggleOrderSelection}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  showAccount={selectedBrokerId === 'all'}
                  ltp={getLTP(gtt.instrument_token)}
                  isConnected={isConnected}
                  position={getPositionForGTT(gtt)}
                />
              ))}
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
              setSelectedInstruments(filterStateBeforeEdit.instruments);
              setFilterStateBeforeEdit(null);
            }
          }}
          onSuccess={() => {
            loadHMTGTTOrders(true);
          }}
          brokerConnectionId={editingGTT ? editingGTT.broker_connection_id : selectedBrokerId}
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
