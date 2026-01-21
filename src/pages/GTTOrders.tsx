import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, ArrowUpDown, Activity, RefreshCw, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GTTModal } from '../components/orders/GTTModal';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';
import { formatIndianCurrency } from '../lib/formatters';
import { MultiSelectFilter } from '../components/common/MultiSelectFilter';

type SortField = 'symbol' | 'trigger_price' | 'created_at' | 'status';
type SortDirection = 'asc' | 'desc';

const formatTimestamp = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
};

export function GTTOrders() {
  const { user, session } = useAuth();
  const [gttOrders, setGttOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);
  const { isConnected, connect, disconnect, subscribe, getLTP, ticks } = useZerodhaWebSocket(selectedBrokerId !== 'all' ? selectedBrokerId : brokers[0]?.id);
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
  const [deleteTarget, setDeleteTarget] = useState<{ gttId?: number; brokerId?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  useEffect(() => {
    if (user) {
      loadBrokers();
      loadPositions();
    }
  }, [user]);

  useEffect(() => {
    if (brokers.length > 0 && (!selectedBrokerId || selectedBrokerId === '')) {
      setSelectedBrokerId('all');
    }
  }, [brokers]);

  useEffect(() => {
    if (selectedBrokerId && brokers.length > 0) {
      loadCachedGTTOrders();
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
    if (!user?.id) return;

    const channel = supabase
      .channel('gtt_orders_changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const updatedOrder = payload.new as any;
        setGttOrders(prev => {
          const updated = prev.map(order => {
            if (order.id === updatedOrder.zerodha_gtt_id && order.broker_info?.id === updatedOrder.broker_connection_id) {
              return {
                ...updatedOrder.raw_data,
                broker_info: order.broker_info
              };
            }
            return order;
          });
          return sortGTTOrders(updated.filter(o => o.status !== 'triggered'));
        });
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const deletedOrder = payload.old as any;
        setGttOrders(prev => prev.filter(order =>
          !(order.id === deletedOrder.zerodha_gtt_id && order.broker_info?.id === deletedOrder.broker_connection_id)
        ));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, sortField, sortDirection]);

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

  const getPositionForGTT = (gtt: any) => {
    return positions.find(pos =>
      pos.symbol === gtt.condition?.tradingsymbol &&
      pos.exchange === gtt.condition?.exchange &&
      pos.broker_connection_id === gtt.broker_info?.id
    );
  };

  const calculatePnL = (gtt: any, currentPrice: number) => {
    const position = getPositionForGTT(gtt);
    if (!position) return null;

    const pnl = (currentPrice - position.average_price) * position.quantity;
    return pnl;
  };

  const loadCachedGTTOrders = async () => {
    if (!selectedBrokerId || brokers.length === 0) return;

    setLoading(true);
    try {
      let query = supabase
        .from('gtt_orders')
        .select(`
          *,
          broker_connections!inner(
            id,
            account_name,
            account_holder_name,
            client_id
          )
        `)
        .eq('user_id', user?.id)
        .neq('status', 'triggered');

      if (selectedBrokerId !== 'all') {
        query = query.eq('broker_connection_id', selectedBrokerId);
      }

      const { data, error } = await query;

      if (!error && data) {
        const formattedOrders = data.map(order => {
          if (order.raw_data) {
            return {
              ...order.raw_data,
              broker_info: {
                id: order.broker_connections.id,
                account_name: order.broker_connections.account_name,
                account_holder_name: order.broker_connections.account_holder_name,
                client_id: order.broker_connections.client_id
              }
            };
          }
          return null;
        }).filter(Boolean);

        setGttOrders(sortGTTOrders(formattedOrders));

        if (data.length > 0) {
          const mostRecentSync = data.reduce((latest, order) => {
            const syncTime = new Date(order.synced_at || order.updated_at);
            return syncTime > latest ? syncTime : latest;
          }, new Date(0));
          setLastSyncTime(mostRecentSync);
        }
      }

      syncWithZerodha();
    } catch (err) {
      console.error('Failed to load cached GTT orders:', err);
    } finally {
      setLoading(false);
    }
  };

  const syncWithZerodha = async () => {
    if (!selectedBrokerId || brokers.length === 0) return;

    setSyncing(true);
    try {
      await loadGTTOrders(false, true);
    } finally {
      setSyncing(false);
    }
  };

  const loadGTTOrders = async (throwOnError = false, silent = false) => {
    if (!selectedBrokerId || brokers.length === 0) return;

    if (!silent) {
      setLoading(true);
    }
    try {
      const syncTime = new Date().toISOString();

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
              await syncGTTOrdersToDatabase(result.data, broker.id, syncTime);
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
        const activeOrders = allOrders.filter(order => order.status !== 'triggered');
        setGttOrders(sortGTTOrders(activeOrders));
        setLastSyncTime(new Date(syncTime));
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
          await syncGTTOrdersToDatabase(result.data, selectedBrokerId, syncTime);
          const ordersWithBroker = result.data.map((order: any) => ({
            ...order,
            broker_info: {
              id: broker?.id,
              account_name: broker?.account_name,
              account_holder_name: broker?.account_holder_name,
              client_id: broker?.client_id
            }
          }));
          const activeOrders = ordersWithBroker.filter((order: any) => order.status !== 'triggered');
          setGttOrders(sortGTTOrders(activeOrders));
          setLastSyncTime(new Date(syncTime));
        } else {
          setGttOrders([]);
        }
      }
    } catch (err) {
      console.error('Failed to load GTT orders:', err);
      if (throwOnError) throw err;
      setGttOrders([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const syncGTTOrdersToDatabase = async (orders: any[], brokerId: string, syncTime: string) => {
    try {
      const upsertPromises = orders.map(async (order) => {
        const { data: existing } = await supabase
          .from('gtt_orders')
          .select('id')
          .eq('zerodha_gtt_id', order.id)
          .eq('broker_connection_id', brokerId)
          .maybeSingle();

        const gttData = {
          user_id: user?.id,
          broker_connection_id: brokerId,
          zerodha_gtt_id: order.id,
          symbol: order.condition?.tradingsymbol || '',
          exchange: order.condition?.exchange || '',
          transaction_type: order.orders?.[0]?.transaction_type || 'BUY',
          quantity: order.orders?.[0]?.quantity || 0,
          gtt_type: order.type === 'two-leg' ? 'oco' : 'single',
          trigger_price: order.condition?.trigger_values?.[0] || null,
          stop_loss: order.type === 'two-leg' ? order.condition?.trigger_values?.[1] : null,
          target: order.type === 'two-leg' ? order.condition?.trigger_values?.[0] : null,
          status: order.status,
          instrument_token: order.condition?.instrument_token,
          last_price: order.condition?.last_price,
          raw_data: order,
          synced_at: syncTime,
          updated_at: new Date().toISOString()
        };

        if (existing) {
          await supabase
            .from('gtt_orders')
            .update(gttData)
            .eq('id', existing.id);
        } else {
          await supabase
            .from('gtt_orders')
            .insert(gttData);
        }
      });

      await Promise.all(upsertPromises);

      const zerodhaGttIds = orders.map(o => o.id);
      await supabase
        .from('gtt_orders')
        .delete()
        .eq('broker_connection_id', brokerId)
        .not('zerodha_gtt_id', 'in', `(${zerodhaGttIds.join(',')})`);
    } catch (err) {
      console.error('Failed to sync GTT orders to database:', err);
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

  const filteredGttOrders = selectedInstruments.length === 0
    ? gttOrders
    : gttOrders.filter(order => selectedInstruments.includes(order.condition?.tradingsymbol));

  useEffect(() => {
    if (selectedInstruments.length === 0 && selectedOrders.size > 0) {
      setSelectedOrders(new Set());
      return;
    }

    if (selectedOrders.size > 0) {
      const filteredOrderIds = new Set(filteredGttOrders.map(order => order.id.toString()));
      const updatedSelectedOrders = new Set<string>();

      selectedOrders.forEach(orderId => {
        if (filteredOrderIds.has(orderId)) {
          updatedSelectedOrders.add(orderId);
        }
      });

      if (updatedSelectedOrders.size !== selectedOrders.size) {
        setSelectedOrders(updatedSelectedOrders);
      }
    }
  }, [filteredGttOrders, selectedInstruments]);

  const isStopLossAboveBreakeven = (gtt: any, currentPrice: number): boolean => {
    const position = getPositionForGTT(gtt);
    if (!position) return false;

    const isOCO = gtt.type === 'two-leg';
    if (!isOCO) return false;

    const trigger1 = gtt.condition?.trigger_values?.[0] || 0;
    const trigger2 = gtt.condition?.trigger_values?.[1] || 0;

    const transactionType = gtt.orders?.[0]?.transaction_type;
    if (transactionType === 'SELL' && position.quantity > 0) {
      // For SELL orders (exiting long), stop loss is the lower trigger
      const stopLoss = Math.min(trigger1, trigger2);
      return stopLoss > position.average_price;
    } else if (transactionType === 'BUY' && position.quantity < 0) {
      // For BUY orders (exiting short), stop loss is the higher trigger
      const stopLoss = Math.max(trigger1, trigger2);
      return stopLoss < position.average_price;
    }

    return false;
  };

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
      setDeleteMessage(`Successfully deleted ${successCount} GTT order(s).${failedCount > 0 ? ` ${failedCount} failed.` : ''}`);
      setDeleteError('');
      setTimeout(() => setDeleteMessage(''), 5000);
      syncWithZerodha();
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
        syncWithZerodha();
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
    if (!currentPrice || currentPrice === 0) return '0%';
    const percentOfLTP = ((triggerValue - currentPrice) / currentPrice) * 100;
    const absPercent = Math.abs(percentOfLTP);
    const sign = percentOfLTP > 0 ? '+' : '-';
    return `${sign}${absPercent.toFixed(2)}%`;
  };

  return (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">GTT ({filteredGttOrders.length})</h2>
          <div className="flex items-center gap-3 mt-1">
            {isConnected && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs w-fit">
                <Activity className="w-3 h-3 animate-pulse" />
                Live
              </div>
            )}
            {lastSyncTime && (
              <div className="text-xs text-gray-500">
                {syncing ? 'Syncing...' : `Updated ${formatTimestamp(lastSyncTime)}`}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={syncWithZerodha}
            disabled={syncing || loading}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
            title="Refresh from Zerodha"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {brokers.length > 0 && (
            <select
              value={selectedBrokerId}
              onChange={(e) => setSelectedBrokerId(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm w-full sm:w-auto"
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
            <div className="w-full sm:w-auto">
              <MultiSelectFilter
                label="Instruments"
                options={uniqueInstruments}
                selectedValues={selectedInstruments}
                onChange={setSelectedInstruments}
                placeholder="All Instruments"
              />
            </div>
          )}
          <button
            onClick={() => {
              setEditingGTT(null);
              setShowCreateModal(true);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm w-full sm:w-auto"
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
          <div className="flex gap-2">
            <button
              onClick={() => {
                const selectedGTTs = filteredGttOrders.filter(gtt => selectedOrders.has(gtt.id.toString()));
                const symbols = new Set(selectedGTTs.map(g => g.condition?.tradingsymbol));
                const brokers = new Set(selectedGTTs.map(g => g.broker_info?.id));

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
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
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
          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-gray-200">
            {filteredGttOrders.map((gtt) => {
              const isOCO = gtt.type === 'two-leg';
              const transactionType = gtt.orders?.[0]?.transaction_type;
              const quantity = gtt.orders?.[0]?.quantity || 0;
              const instrumentToken = gtt.condition?.instrument_token;
              const ltp = instrumentToken ? getLTP(instrumentToken) : null;
              const currentPrice = ltp ?? gtt.condition?.last_price ?? 0;

              return (
                <div key={gtt.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(gtt.id.toString())}
                        onChange={() => toggleOrderSelection(gtt.id.toString())}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 mt-1"
                      />
                      <div>
                        <div className="font-medium text-gray-900">{gtt.condition?.tradingsymbol || 'N/A'}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(gtt.created_at).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            timeZone: 'Asia/Kolkata'
                          })}
                        </div>
                      </div>
                    </div>
                    <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                      gtt.status === 'active' ? 'bg-green-100 text-green-700' :
                      gtt.status === 'triggered' ? 'bg-blue-100 text-blue-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {gtt.status?.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      isOCO ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {isOCO ? 'OCO' : 'SINGLE'}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      transactionType === 'BUY' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {transactionType}
                    </span>
                  </div>

                  {selectedBrokerId === 'all' && (
                    <div className="text-xs text-gray-600">
                      Account: {(gtt.broker_info?.account_holder_name || gtt.broker_info?.account_name || 'Account')}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-gray-500">Trigger Price</div>
                      {isOCO ? (
                        <div className="space-y-1 mt-1">
                          <div className="font-medium">₹{gtt.condition?.trigger_values?.[0]?.toFixed(2)}</div>
                          <div className="font-medium">₹{gtt.condition?.trigger_values?.[1]?.toFixed(2)}</div>
                        </div>
                      ) : (
                        <div className="font-medium mt-1">₹{gtt.condition?.trigger_values?.[0]?.toFixed(2)}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Current Price</div>
                      <div className="font-medium mt-1">₹{currentPrice?.toFixed(2) || 'N/A'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Quantity</div>
                      <div className="font-medium mt-1">{quantity}</div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        setFilterStateBeforeEdit({
                          brokerId: selectedBrokerId,
                          instruments: selectedInstruments
                        });
                        if (gtt.broker_info?.id) {
                          setSelectedBrokerId(gtt.broker_info.id);
                        }
                        setEditingGTT(gtt);
                        setShowCreateModal(true);
                      }}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-blue-600 border border-blue-300 hover:bg-blue-50 rounded transition"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(gtt.id, gtt.broker_info?.id)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-red-600 border border-red-300 hover:bg-red-50 rounded transition"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
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
                        day: '2-digit',
                        timeZone: 'Asia/Kolkata'
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">
                          {gtt.condition?.tradingsymbol || 'N/A'}
                        </div>
                        {isStopLossAboveBreakeven(gtt, currentPrice) && (
                          <div
                            className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium"
                            title="Stop Loss above breakeven"
                          >
                            <TrendingUp className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </td>
                    {selectedBrokerId === 'all' && (
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">
                          {(gtt.broker_info?.account_holder_name || gtt.broker_info?.account_name || 'Account')} ({gtt.broker_info?.client_id || 'No ID'})
                        </div>
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
                      {(() => {
                        const position = getPositionForGTT(gtt);
                        const pnl = calculatePnL(gtt, currentPrice);
                        if (!position) {
                          return <span className="text-sm text-gray-400">-</span>;
                        }
                        return (
                          <span className={`text-sm font-medium px-2 py-1 rounded ${pnl !== null && pnl >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            ₹{position.average_price?.toFixed(2)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const pnl = calculatePnL(gtt, currentPrice);
                        if (pnl === null) {
                          return <span className="text-sm text-gray-400">-</span>;
                        }
                        return (
                          <span className={`text-sm font-medium ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {pnl >= 0 ? '+' : ''}{formatIndianCurrency(pnl)}
                          </span>
                        );
                      })()}
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
                            setFilterStateBeforeEdit({
                              brokerId: selectedBrokerId,
                              instruments: selectedInstruments
                            });
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
            syncWithZerodha();
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
