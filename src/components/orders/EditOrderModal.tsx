import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface EditOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  order: any;
}

export function EditOrderModal({ isOpen, onClose, onSuccess, order }: EditOrderModalProps) {
  const { session } = useAuth();
  const [quantity, setQuantity] = useState(order?.quantity || 0);
  const [price, setPrice] = useState(order?.price || 0);
  const [triggerPrice, setTriggerPrice] = useState(order?.trigger_price || 0);
  const [orderType, setOrderType] = useState(order?.order_type || 'MARKET');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (order) {
      setQuantity(order.quantity || 0);
      setPrice(order.price || 0);
      setTriggerPrice(order.trigger_price || 0);
      setOrderType(order.order_type || 'MARKET');
    }
  }, [order]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const modifyData: any = {
        order_id: order.order_id,
        variety: order.variety || 'regular',
        quantity,
        order_type: orderType,
      };

      if (orderType === 'LIMIT' || orderType === 'SL') {
        if (!price || price <= 0) {
          setError('Price is required for LIMIT and SL orders');
          setLoading(false);
          return;
        }
        modifyData.price = price;
      }

      if (orderType === 'SL' || orderType === 'SL-M') {
        if (!triggerPrice || triggerPrice <= 0) {
          setError('Trigger price is required for SL orders');
          setLoading(false);
          return;
        }
        modifyData.trigger_price = triggerPrice;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders/modify?broker_id=${order.broker_connection_id}`;

      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(modifyData),
      });

      const result = await response.json();

      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error || 'Failed to modify order');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to modify order');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Edit Order</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Symbol:</span>
              <span className="font-medium text-gray-900">{order?.symbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Transaction:</span>
              <span className={`font-medium ${order?.transaction_type === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                {order?.transaction_type}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Exchange:</span>
              <span className="font-medium text-gray-900">{order?.exchange}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Order Type
            </label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="SL">Stop Loss</option>
              <option value="SL-M">Stop Loss Market</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quantity
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value))}
              min="1"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          {(orderType === 'LIMIT' || orderType === 'SL') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Price
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(parseFloat(e.target.value))}
                step="0.05"
                min="0"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          )}

          {(orderType === 'SL' || orderType === 'SL-M') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trigger Price
              </label>
              <input
                type="number"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(parseFloat(e.target.value))}
                step="0.05"
                min="0"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Updating...' : 'Update Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
