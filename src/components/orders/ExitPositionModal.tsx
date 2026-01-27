import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertTriangle } from 'lucide-react';

interface ExitPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  positions: any[];
  onSuccess: () => void;
}

interface AssociatedOrder {
  id: string;
  symbol: string;
  type: 'GTT' | 'HMT GTT';
  trigger_price?: number;
  trigger_price_1?: number;
  trigger_price_2?: number;
  condition_type?: string;
}

export function ExitPositionModal({ isOpen, onClose, positions, onSuccess }: ExitPositionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [associatedOrders, setAssociatedOrders] = useState<AssociatedOrder[]>([]);
  const [deleteOrders, setDeleteOrders] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && positions && positions.length > 0) {
      loadAssociatedOrders();
    }
  }, [isOpen, positions]);

  const loadAssociatedOrders = async () => {
    setLoading(true);
    try {
      const positionIds = positions.map(p => p.id);
      const symbols = positions.map(p => p.symbol);
      const instrumentTokens = positions.map(p => p.instrument_token).filter(Boolean);
      const brokerConnectionIds = positions.map(p => p.broker_connection_id).filter(Boolean);

      const orders: AssociatedOrder[] = [];

      // Query GTT orders for the specific broker connections and symbols
      if (brokerConnectionIds.length > 0 && symbols.length > 0) {
        const { data: gttOrders } = await supabase
          .from('gtt_orders')
          .select('id, symbol, trigger_price')
          .eq('status', 'active')
          .in('broker_connection_id', brokerConnectionIds)
          .in('symbol', symbols);

        if (gttOrders) {
          orders.push(...gttOrders.map(order => ({
            id: order.id,
            symbol: order.symbol,
            type: 'GTT' as const,
            trigger_price: order.trigger_price
          })));
        }
      }

      // Query HMT GTT orders for the specific broker connections and instruments
      if (brokerConnectionIds.length > 0 && (instrumentTokens.length > 0 || symbols.length > 0)) {
        let hmtQuery = supabase
          .from('hmt_gtt_orders')
          .select('id, trading_symbol, trigger_price_1, trigger_price_2, condition_type, broker_connection_id')
          .eq('status', 'active')
          .in('broker_connection_id', brokerConnectionIds);

        if (instrumentTokens.length > 0) {
          hmtQuery = hmtQuery.in('instrument_token', instrumentTokens);
        } else if (symbols.length > 0) {
          hmtQuery = hmtQuery.in('trading_symbol', symbols);
        }

        const { data: hmtOrders, error: hmtError } = await hmtQuery;

        if (hmtError) {
          console.error('Error loading HMT GTT orders:', hmtError);
        }

        if (hmtOrders && hmtOrders.length > 0) {
          orders.push(...hmtOrders.map(order => ({
            id: order.id,
            symbol: order.trading_symbol,
            type: 'HMT GTT' as const,
            trigger_price_1: parseFloat(order.trigger_price_1),
            trigger_price_2: order.trigger_price_2 ? parseFloat(order.trigger_price_2) : undefined,
            condition_type: order.condition_type
          })));
        }
      }

      setAssociatedOrders(orders);
    } catch (err) {
      console.error('Error loading associated orders:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !positions || positions.length === 0) return null;

  const uniqueBrokerAccounts = Array.from(
    new Set(
      positions.map((p) => {
        const accountName = p.broker_connections?.account_holder_name || p.broker_connections?.account_name || p.account_holder_name || p.account_name || 'Account';
        const clientId = p.broker_connections?.client_id || p.client_id || 'No ID';
        return `${accountName} (${clientId})`;
      })
    )
  );

  const handleSubmit = async () => {
    setShowConfirm(false);
    setIsSubmitting(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      let successCount = 0;

      for (const position of positions) {
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
            console.error(`Failed to exit ${position.symbol}:`, result.error);
            setError(`Failed to exit ${position.symbol}: ${result.error || 'Unknown error'}`);
          }
        } catch (posErr: any) {
          console.error(`Error exiting ${position.symbol}:`, posErr);
          setError(`Error exiting ${position.symbol}: ${posErr.message}`);
        }
      }

      if (deleteOrders && associatedOrders.length > 0) {
        try {
          const gttOrderIds = associatedOrders.filter(o => o.type === 'GTT').map(o => o.id);
          const hmtOrderIds = associatedOrders.filter(o => o.type === 'HMT GTT').map(o => o.id);

          // Delete GTT orders from Zerodha API first, then from database
          if (gttOrderIds.length > 0) {
            // Fetch GTT orders to get their gtt_trigger_id and broker_connection_id
            const { data: gttOrders } = await supabase
              .from('gtt_orders')
              .select('id, gtt_trigger_id, broker_connection_id')
              .in('id', gttOrderIds);

            if (gttOrders) {
              // Delete each GTT from Zerodha API
              for (const gttOrder of gttOrders) {
                if (gttOrder.gtt_trigger_id && gttOrder.broker_connection_id) {
                  try {
                    await fetch(
                      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${gttOrder.broker_connection_id}&gtt_id=${gttOrder.gtt_trigger_id}`,
                      {
                        method: 'DELETE',
                        headers: {
                          'Authorization': `Bearer ${session?.access_token}`,
                          'Content-Type': 'application/json',
                        },
                      }
                    );
                  } catch (apiErr) {
                    console.error(`Failed to delete GTT ${gttOrder.gtt_trigger_id} from Zerodha:`, apiErr);
                  }
                }
              }

              // Now delete from local database
              await supabase
                .from('gtt_orders')
                .delete()
                .in('id', gttOrderIds);
            }
          }

          // Cancel HMT GTT orders
          if (hmtOrderIds.length > 0) {
            await supabase
              .from('hmt_gtt_orders')
              .update({ status: 'cancelled' })
              .in('id', hmtOrderIds);
          }
        } catch (deleteErr) {
          console.error('Error deleting associated orders:', deleteErr);
        }
      }

      if (successCount > 0) {
        onSuccess();
        onClose();
      } else {
        setError('Failed to exit positions');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to exit positions');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-900">Exit positions</h2>
            {uniqueBrokerAccounts.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {uniqueBrokerAccounts.map((accountInfo, index) => (
                  <span key={index} className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-1 rounded">
                    {accountInfo}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 overscroll-contain">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                {associatedOrders.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-yellow-900 mb-2">
                          Associated GTT/HMT GTT Orders Found
                        </h4>
                        <div className="space-y-1 mb-3">
                          {associatedOrders.map(order => (
                            <div key={order.id} className="text-xs text-yellow-800">
                              <span className="font-medium">{order.type}</span> - {order.symbol}
                              {order.trigger_price && ` (Trigger: ₹${order.trigger_price})`}
                              {order.trigger_price_1 && order.condition_type === 'single' && ` (Trigger: ₹${order.trigger_price_1})`}
                              {order.trigger_price_1 && order.trigger_price_2 && order.condition_type === 'two-leg' &&
                                ` (Leg1: ₹${order.trigger_price_1}, Leg2: ₹${order.trigger_price_2})`}
                            </div>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={deleteOrders}
                            onChange={(e) => setDeleteOrders(e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-yellow-900">
                            Delete these GTT/HMT GTT orders when exiting positions
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead className="border-b sticky top-0 bg-white">
                  <tr className="text-left text-sm text-gray-600">
                    <th className="pb-3 w-1/3"></th>
                    <th className="pb-3 w-20 text-right pr-4">Qty.</th>
                    <th className="pb-3 w-24 text-right pr-4">Price</th>
                    <th className="pb-3 w-24">Type</th>
                    <th className="pb-3 w-24">Product</th>
                    <th className="pb-3 w-20">Validity</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => {
                    const exitTransactionType = position.quantity > 0 ? 'SELL' : 'BUY';
                    const exitQuantity = Math.abs(position.quantity);

                    return (
                      <tr key={position.id} className="border-b last:border-b-0">
                        <td className="py-4 pr-4">
                          <div className="flex flex-col">
                            <span className={`text-sm font-medium mb-1 ${exitTransactionType === 'BUY' ? 'text-blue-600' : 'text-red-600'}`}>
                              {exitTransactionType}
                            </span>
                            <div className="text-sm text-gray-900 font-medium">{position.symbol}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {position.exchange}
                              {position.account_name && (
                                <span className="ml-1">• {position.account_name}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-4 text-sm text-right pr-4">{exitQuantity}</td>
                        <td className="py-4 text-sm text-right pr-4">—</td>
                        <td className="py-4 text-sm">MARKET</td>
                        <td className="py-4 text-sm">{position.product_type || 'NRML'}</td>
                        <td className="py-4 text-sm">DAY</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-6 border-t bg-white flex-shrink-0">
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded transition"
                disabled={isSubmitting}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={isSubmitting}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Exiting...' : 'Exit'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-72">
            <div className="p-6 text-center">
              <h3 className="text-lg font-normal text-gray-900 mb-6">Are you sure?</h3>
              <div className="flex gap-0 border-t">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3 text-blue-600 hover:bg-gray-50 border-r font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 py-3 text-blue-600 hover:bg-gray-50 font-medium"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
