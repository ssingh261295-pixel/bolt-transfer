import { useEffect, useState } from 'react';
import { ShoppingCart, Filter, Plus, ArrowUpDown, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PlaceOrderModal } from '../components/orders/PlaceOrderModal';

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

  useEffect(() => {
    if (user) {
      loadBrokers();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadOrders();
    }
  }, [user, filter, selectedBrokerId]);

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
        await loadOrders();
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
      setBrokers(data);
    }
  };

  const fetchInitialOrders = async () => {
    if (brokers.length === 0) return;

    setInitialLoadDone(true);

    try {
      const fetchPromises = brokers.map(async (broker) => {
        try {
          const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders?broker_id=${broker.id}`;
          const response = await fetch(apiUrl, {
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
          });
          const result = await response.json();

          if (result.success) {
            console.log(`Fetched ${result.data?.length || 0} orders from broker ${broker.id}`);
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

      {cancelMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {cancelMessage}
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
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
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
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
                      {new Date(order.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
