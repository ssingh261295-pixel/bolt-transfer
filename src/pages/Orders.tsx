import { useEffect, useState } from 'react';
import { ShoppingCart, Filter, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodha } from '../hooks/useZerodha';
import { PlaceOrderModal } from '../components/orders/PlaceOrderModal';

export function Orders() {
  const { user } = useAuth();
  const { syncOrders, loading: syncLoading } = useZerodha();
  const [orders, setOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [filter, setFilter] = useState('all');
  const [showPlaceOrder, setShowPlaceOrder] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

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

  const loadOrders = async () => {
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
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (filter === 'all') {
      // Show only active orders (exclude completed, rejected, cancelled)
      query = query.not('status', 'in', '("COMPLETE","REJECTED","CANCELLED")');
    } else {
      query = query.eq('status', filter.toUpperCase());
    }

    if (selectedBrokerId !== 'all') {
      query = query.eq('broker_connection_id', selectedBrokerId);
    }

    const { data } = await query;

    if (data) {
      setOrders(data);
    }
  };

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

    setSyncMessage(`Syncing orders from ${brokers.length} account(s)...`);

    // Sync all brokers in parallel for faster performance
    const syncPromises = brokers.map(async (broker) => {
      try {
        const accountName = broker.account_name || broker.account_holder_name || `Account (${broker.api_key.substring(0, 8)}...)`;
        const result = await syncOrders(broker.id);

        if (result.success) {
          console.log(`Successfully synced ${result.synced} orders from ${accountName}`);
          return { success: true, synced: result.synced || 0, accountName, tokenExpired: false };
        } else {
          const errorMsg = result.error || 'Unknown error';
          const tokenExpired = errorMsg.includes('Token expired') || errorMsg.includes('403');
          console.error(`Failed to sync ${accountName}:`, errorMsg);
          return { success: false, error: errorMsg, accountName, tokenExpired };
        }
      } catch (err: any) {
        const accountName = broker.account_name || broker.account_holder_name || `Account (${broker.api_key.substring(0, 8)}...)`;
        const errorMsg = err.message || 'Unknown error';
        const tokenExpired = errorMsg.includes('Token expired') || errorMsg.includes('403');
        console.error(`Error syncing ${accountName}:`, err);
        return { success: false, error: errorMsg, accountName, tokenExpired };
      }
    });

    const results = await Promise.all(syncPromises);

    const successCount = results.filter(r => r.success).length;
    const totalSynced = results.reduce((sum, r) => sum + (r.synced || 0), 0);
    const errors = results.filter(r => !r.success);
    const hasTokenExpired = results.some(r => r.tokenExpired);

    if (hasTokenExpired) {
      await loadBrokers();
    }

    if (errors.length === 0) {
      setSyncMessage(`✓ Synced ${totalSynced} orders from ${successCount} account(s) successfully`);
    } else if (successCount > 0) {
      setSyncMessage(`Synced ${totalSynced} orders from ${successCount} account(s), ${errors.length} failed. ${hasTokenExpired ? 'Some tokens expired - please reconnect.' : ''}`);
    } else {
      setSyncMessage(`Failed to sync all accounts. ${hasTokenExpired ? 'Tokens expired - please reconnect your broker accounts.' : 'Check console for details.'}`);
    }

    await loadOrders();
    setTimeout(() => setSyncMessage(''), 8000);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Order History</h2>
          <p className="text-sm text-gray-600 mt-1">View and track all your orders</p>
        </div>
        <div className="flex items-center gap-3">
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
          <button
            onClick={() => setShowPlaceOrder(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            <Plus className="w-5 h-5" />
            Place Order
          </button>
          <button
            onClick={handleSync}
            disabled={syncLoading || brokers.length === 0}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-5 h-5 ${syncLoading ? 'animate-spin' : ''}`} />
            Sync
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
        </div>
      </div>

      {syncMessage && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
          {syncMessage}
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Symbol
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Qty.
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Date
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
