import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GTTModal } from '../components/orders/GTTModal';

export function GTTOrders() {
  const { user, session } = useAuth();
  const [gttOrders, setGttOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGTT, setEditingGTT] = useState<any>(null);

  useEffect(() => {
    if (user) {
      loadBrokers();
    }
  }, [user]);

  useEffect(() => {
    if (brokers.length > 0 && (!selectedBrokerId || selectedBrokerId === '')) {
      setSelectedBrokerId(brokers[0].id);
    }
  }, [brokers]);

  useEffect(() => {
    if (selectedBrokerId) {
      loadGTTOrders();
    }
  }, [selectedBrokerId]);

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

  const loadGTTOrders = async () => {
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
            return [];
          }
        });

        const results = await Promise.all(fetchPromises);
        const allOrders = results.flat();
        setGttOrders(allOrders);
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
          setGttOrders(ordersWithBroker);
        } else {
          setGttOrders([]);
        }
      }
    } catch (err) {
      console.error('Failed to load GTT orders:', err);
      setGttOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    await loadGTTOrders();
    setSyncing(false);
  };

  const handleDelete = async (gttId: number, brokerId?: string) => {
    if (!confirm('Are you sure you want to delete this GTT order?')) return;

    try {
      const brokerIdToUse = brokerId || selectedBrokerId;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${brokerIdToUse}&gtt_id=${gttId}`;

      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (result.success) {
        await loadGTTOrders();
      } else {
        alert('Failed to delete GTT order: ' + result.error);
      }
    } catch (err: any) {
      alert('Failed to delete GTT order: ' + err.message);
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
          <h2 className="text-2xl font-bold text-gray-900">GTT ({gttOrders.length})</h2>
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

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-gray-600">Loading GTT orders...</div>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Created on
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Instrument
                </th>
                {selectedBrokerId === 'all' && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Account
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Trigger
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  LTP
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Qty.
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {gttOrders.map((gtt) => {
                const isOCO = gtt.type === 'two-leg';
                const transactionType = gtt.orders?.[0]?.transaction_type;
                const quantity = gtt.orders?.[0]?.quantity || 0;

                return (
                  <tr key={gtt.id} className="hover:bg-gray-50 transition">
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
                              {calculatePercentage(gtt.condition?.trigger_values?.[0], gtt.condition?.last_price)}
                            </span>
                          </div>
                          <div className="text-gray-900">
                            ₹{gtt.condition?.trigger_values?.[1]?.toFixed(2)}
                            <span className="text-xs text-gray-500 ml-1">
                              {calculatePercentage(gtt.condition?.trigger_values?.[1], gtt.condition?.last_price)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900">
                          ₹{gtt.condition?.trigger_values?.[0]?.toFixed(2)}
                          <span className="text-xs text-gray-500 ml-1">
                            {calculatePercentage(gtt.condition?.trigger_values?.[0], gtt.condition?.last_price)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      ₹{gtt.condition?.last_price?.toFixed(2) || 'N/A'}
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
    </div>
  );
}
