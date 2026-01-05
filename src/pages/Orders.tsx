import { useEffect, useState } from 'react';
import { ShoppingCart, Filter, Plus, ArrowUpDown, X, RefreshCw, Edit } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PlaceOrderModal } from '../components/orders/PlaceOrderModal';
import { EditOrderModal } from '../components/orders/EditOrderModal';

type SortField = 'created_at' | 'symbol' | 'quantity' | 'price' | 'status';
type SortDirection = 'asc' | 'desc';

export function Orders() {
  const { user, session } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [filter, setFilter] = useState('all');
  const [showPlaceOrder, setShowPlaceOrder] = useState(false);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [cancellingOrders, setCancellingOrders] = useState<Set<string>>(new Set());
  const [cancelMessage, setCancelMessage] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [showEditOrder, setShowEditOrder] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  useEffect(() => {
    if (user) {
      loadBrokers();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadOrders();
      setCurrentPage(1);
      setSelectedOrders(new Set());
    }
  }, [user, filter, selectedBrokerId]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('orders_changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
        filter: `user_id=eq.${user.id}`
      }, async (payload) => {
        const newOrder = payload.new as any;
        const broker = brokers.find(b => b.id === newOrder.broker_connection_id);

        if (broker && shouldShowOrder(newOrder.status)) {
          newOrder.broker_connections = {
            account_name: broker.account_name,
            broker_name: broker.broker_name,
            account_holder_name: broker.account_holder_name,
            client_id: broker.client_id
          };

          if (selectedBrokerId === 'all' || newOrder.broker_connection_id === selectedBrokerId) {
            setOrders(prev => sortOrders([newOrder, ...prev]));
          }
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const updatedFields = payload.new as any;

        setOrders(prev => {
          if (!shouldShowOrder(updatedFields.status)) {
            return prev.filter(order => order.id !== updatedFields.id);
          }

          const updated = prev.map(order => {
            if (order.id === updatedFields.id) {
              return {
                ...order,
                status: updatedFields.status,
                executed_quantity: updatedFields.executed_quantity,
                executed_price: updatedFields.executed_price,
                updated_at: updatedFields.updated_at
              };
            }
            return order;
          });

          const exists = prev.some(order => order.id === updatedFields.id);
          if (!exists && (selectedBrokerId === 'all' || updatedFields.broker_connection_id === selectedBrokerId)) {
            const broker = brokers.find(b => b.id === updatedFields.broker_connection_id);
            if (broker) {
              updatedFields.broker_connections = {
                account_name: broker.account_name,
                broker_name: broker.broker_name,
                account_holder_name: broker.account_holder_name,
                client_id: broker.client_id
              };
              return sortOrders([updatedFields, ...prev]);
            }
          }

          return sortOrders(updated);
        });
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const deletedId = payload.old.id;
        setOrders(prev => prev.filter(order => order.id !== deletedId));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, filter, selectedBrokerId, sortField, sortDirection, brokers]);

  const shouldShowOrder = (status: string) => {
    if (filter === 'all') {
      return !['COMPLETE', 'REJECTED', 'CANCELLED'].includes(status);
    }
    return status === filter.toUpperCase();
  };

  useEffect(() => {
    if (brokers.length > 0 && !initialLoadDone) {
      fetchInitialOrders();
    }
  }, [brokers]);

  const loadOrders = async () => {
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          broker_connections (
            account_name,
            broker_name,
            account_holder_name,
            client_id
          )
        `)
        .eq('user_id', user?.id);

      if (filter === 'all') {
        query = query.not('status', 'in', '("COMPLETE","REJECTED","CANCELLED")');
      } else {
        query = query.eq('status', filter.toUpperCase());
      }

      if (selectedBrokerId !== 'all') {
        query = query.eq('broker_connection_id', selectedBrokerId);
      }

      const { data } = await query;

      if (data) {
        setOrders(sortOrders(data));
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const sortOrders = (data: any[]) => {
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
        case 'price':
          aVal = a.price || 0;
          bVal = b.price || 0;
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

  const handleCancelOrder = async (order: any) => {
    if (!order.order_id || !order.broker_connection_id) {
      setCancelError('Invalid order data');
      setTimeout(() => setCancelError(''), 3000);
      return;
    }

    const confirmCancel = window.confirm(`Are you sure you want to cancel order for ${order.symbol}?`);
    if (!confirmCancel) return;

    setCancellingOrders(prev => new Set(prev).add(order.id));
    setCancelError('');
    setCancelMessage('');

    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders?broker_id=${order.broker_connection_id}&order_id=${order.order_id}&variety=${order.variety || 'regular'}`;

      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (result.success) {
        setCancelMessage(`Order for ${order.symbol} cancelled successfully`);
        setTimeout(() => setCancelMessage(''), 3000);
      } else {
        throw new Error(result.error || 'Failed to cancel order');
      }
    } catch (error: any) {
      setCancelError(`Failed to cancel order: ${error.message}`);
      setTimeout(() => setCancelError(''), 5000);
    } finally {
      setCancellingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(order.id);
        return newSet;
      });
    }
  };

  const canCancelOrder = (status: string) => {
    const cancellableStatuses = ['OPEN', 'TRIGGER PENDING', 'PENDING'];
    return cancellableStatuses.includes(status);
  };

  const canEditOrder = (status: string) => {
    const editableStatuses = ['OPEN', 'TRIGGER PENDING', 'PENDING'];
    return editableStatuses.includes(status);
  };

  const handleEditOrder = (order: any) => {
    setEditingOrder(order);
    setShowEditOrder(true);
  };

  const handleSyncOrders = async () => {
    if (syncing || brokers.length === 0) return;

    setSyncing(true);
    setSyncMessage('');
    setCancelError('');

    try {
      let totalSynced = 0;
      let expiredCount = 0;

      const syncPromises = brokers.map(async (broker) => {
        try {
          // Check if token is expired before attempting sync
          if (broker.token_expires_at) {
            const expiryDate = new Date(broker.token_expires_at);
            if (expiryDate <= new Date()) {
              expiredCount++;
              return;
            }
          }

          const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders/sync?broker_id=${broker.id}`;
          const response = await fetch(apiUrl, {
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
          });
          const result = await response.json();

          if (result.success) {
            totalSynced += result.synced || 0;
          } else if (result.error?.includes('Token expired') || result.error?.includes('403')) {
            expiredCount++;
            // Mark broker as inactive
            await supabase
              .from('broker_connections')
              .update({ is_active: false })
              .eq('id', broker.id);
          } else if (result.error) {
            throw new Error(result.error);
          }
        } catch (err) {
          console.error(`Error syncing orders for broker ${broker.id}:`, err);
          throw err;
        }
      });

      await Promise.all(syncPromises);
      await loadOrders();

      if (expiredCount > 0) {
        setSyncMessage(`Synced ${totalSynced} order(s). ${expiredCount} account(s) skipped due to expired tokens.`);
      } else {
        setSyncMessage(`Successfully synced ${totalSynced} order(s)`);
      }
      setTimeout(() => setSyncMessage(''), 5000);
    } catch (error: any) {
      setCancelError(`Failed to sync orders: ${error.message}`);
      setTimeout(() => setCancelError(''), 5000);
    } finally {
      setSyncing(false);
    }
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
    if (orders.length > 0) {
      setOrders(sortOrders(orders));
    }
  }, [sortField, sortDirection]);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data) {
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
        // Update expired brokers to inactive in background
        expiredBrokers.forEach(async (broker) => {
          await supabase
            .from('broker_connections')
            .update({ is_active: false })
            .eq('id', broker.id);
        });

        // Show message to user
        if (activeBrokers.length === 0) {
          setCancelError('All broker tokens have expired. Please reconnect your accounts.');
        } else {
          setSyncMessage(`${expiredBrokers.length} account(s) expired. Showing data from ${activeBrokers.length} active account(s).`);
          setTimeout(() => setSyncMessage(''), 5000);
        }
      }

      setBrokers(activeBrokers);
    }
  };

  const fetchInitialOrders = async () => {
    if (brokers.length === 0) return;

    setInitialLoadDone(true);

    try {
      const fetchPromises = brokers.map(async (broker) => {
        try {
          // Check if token is expired before attempting sync
          if (broker.token_expires_at) {
            const expiryDate = new Date(broker.token_expires_at);
            if (expiryDate <= new Date()) {
              console.log(`Skipping expired broker ${broker.id}`);
              return;
            }
          }

          const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders/sync?broker_id=${broker.id}`;
          const response = await fetch(apiUrl, {
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
          });
          const result = await response.json();

          if (result.success) {
            console.log(`Synced ${result.synced || 0} orders from broker ${broker.id}`);
          } else if (result.error?.includes('Token expired') || result.error?.includes('403')) {
            // Mark broker as inactive
            await supabase
              .from('broker_connections')
              .update({ is_active: false })
              .eq('id', broker.id);
          }
        } catch (err) {
          console.error(`Error fetching orders for broker ${broker.id}:`, err);
        }
      });

      await Promise.all(fetchPromises);
      await loadOrders();
    } catch (error) {
      console.error('Error in initial orders fetch:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-700';
      case 'PENDING':
      case 'OPEN':
        return 'bg-yellow-100 text-yellow-700';
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-700';
      case 'REJECTED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleSelectAll = () => {
    const currentPageOrders = paginatedOrders.map(o => o.id);
    if (currentPageOrders.every(id => selectedOrders.has(id))) {
      setSelectedOrders(new Set([...selectedOrders].filter(id => !currentPageOrders.includes(id))));
    } else {
      setSelectedOrders(new Set([...selectedOrders, ...currentPageOrders]));
    }
  };

  const handleSelectOrder = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const handleBulkCancel = async () => {
    const ordersToCancel = orders.filter(o =>
      selectedOrders.has(o.id) && canCancelOrder(o.status)
    );

    if (ordersToCancel.length === 0) {
      setCancelError('No cancellable orders selected');
      setTimeout(() => setCancelError(''), 3000);
      return;
    }

    const confirmCancel = window.confirm(
      `Are you sure you want to cancel ${ordersToCancel.length} order(s)?`
    );
    if (!confirmCancel) return;

    let successCount = 0;
    let failCount = 0;

    for (const order of ordersToCancel) {
      try {
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders?broker_id=${order.broker_connection_id}&order_id=${order.order_id}&variety=${order.variety || 'regular'}`;

        const response = await fetch(apiUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        });

        const result = await response.json();

        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
    }

    setSelectedOrders(new Set());

    if (successCount > 0) {
      setCancelMessage(`Successfully cancelled ${successCount} order(s)`);
      if (failCount > 0) {
        setCancelMessage(prev => `${prev}. Failed to cancel ${failCount} order(s)`);
      }
      setTimeout(() => setCancelMessage(''), 5000);
    } else {
      setCancelError(`Failed to cancel all ${failCount} order(s)`);
      setTimeout(() => setCancelError(''), 5000);
    }

    await loadOrders();
  };

  const totalPages = Math.ceil(orders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedOrders = orders.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedOrders(new Set());
  };

  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
    setSelectedOrders(new Set());
  };

  if (loading && orders.length === 0 && brokers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Order History</h2>
          <p className="text-sm text-gray-600 mt-1">View and track all your orders</p>
        </div>
        <div className="flex items-center gap-3">
          {brokers.length === 0 ? (
            <div className="text-sm text-gray-600 bg-yellow-50 px-4 py-2 rounded-lg border border-yellow-200">
              No active broker connections. Please connect a broker first.
            </div>
          ) : (
            <>
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
              <button
                onClick={handleSyncOrders}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Sync orders from Zerodha"
              >
                <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
              <button
                onClick={() => setShowPlaceOrder(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                <Plus className="w-5 h-5" />
                Place Order
              </button>
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-gray-600" />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  <option value="all">All Orders</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="open">Open</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {(cancelMessage || syncMessage) && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {cancelMessage || syncMessage}
        </div>
      )}

      {cancelError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {cancelError}
        </div>
      )}

      <PlaceOrderModal
        isOpen={showPlaceOrder}
        onClose={() => setShowPlaceOrder(false)}
        onSuccess={loadOrders}
      />

      <EditOrderModal
        isOpen={showEditOrder}
        onClose={() => {
          setShowEditOrder(false);
          setEditingOrder(null);
        }}
        onSuccess={() => {
          loadOrders();
          setSyncMessage('Order updated successfully');
          setTimeout(() => setSyncMessage(''), 3000);
        }}
        order={editingOrder}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {orders.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
            <p className="text-gray-600">
              {filter === 'all'
                ? 'Place your first order to see it here'
                : `No ${filter} orders found`}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={paginatedOrders.length > 0 && paginatedOrders.every(o => selectedOrders.has(o.id))}
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Side
                  </th>
                  <th
                    onClick={() => handleSort('quantity')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Qty.
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'quantity' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('price')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Price
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'price' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('status')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Status
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'status' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('created_at')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                  >
                    <div className="flex items-center gap-1">
                      Date
                      <ArrowUpDown className={`w-3 h-3 ${sortField === 'created_at' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(order.id)}
                        onChange={() => handleSelectOrder(order.id)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="font-medium text-gray-900">{order.symbol}</div>
                        <div className="text-sm text-gray-600">{order.exchange}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-medium">
                        {order.broker_connections?.account_holder_name || order.broker_connections?.account_name || 'Default Account'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {order.broker_connections?.client_id && `${order.broker_connections.client_id}`}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {order.order_type}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${
                          order.transaction_type === 'BUY'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {order.transaction_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {order.executed_quantity || 0} / {order.quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ₹{order.executed_price?.toFixed(2) || order.price?.toFixed(2) || '0.00'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(order.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {canEditOrder(order.status) && (
                          <button
                            onClick={() => handleEditOrder(order)}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded transition"
                            title="Edit Order"
                          >
                            <Edit className="w-4 h-4" />
                            Edit
                          </button>
                        )}
                        {canCancelOrder(order.status) && (
                          <button
                            onClick={() => handleCancelOrder(order)}
                            disabled={cancellingOrders.has(order.id)}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Cancel Order"
                          >
                            <X className="w-4 h-4" />
                            {cancellingOrders.has(order.id) ? 'Cancelling...' : 'Cancel'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {selectedOrders.size > 0 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50">
                <div className="text-sm text-gray-700">
                  {selectedOrders.size} order(s) selected
                </div>
                <button
                  onClick={handleBulkCancel}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
                >
                  Cancel Selected Orders
                </button>
              </div>
            )}

            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
              <div className="flex items-center gap-4">
                <div className="text-sm text-gray-700">
                  Showing {orders.length === 0 ? 0 : startIndex + 1} to {Math.min(endIndex, orders.length)} of {orders.length} orders
                </div>
                <select
                  value={itemsPerPage}
                  onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  <option value={10}>10 per page</option>
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (currentPage <= 4) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = currentPage - 3 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-3 py-1.5 rounded-lg text-sm transition ${
                          currentPage === pageNum
                            ? 'bg-blue-600 text-white'
                            : 'border border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
