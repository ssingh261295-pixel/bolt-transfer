import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ExitPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: any;
  onSuccess: () => void;
}

export function ExitPositionModal({ isOpen, onClose, position, onSuccess }: ExitPositionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !position) return null;

  const exitTransactionType = position.quantity > 0 ? 'SELL' : 'BUY';
  const exitQuantity = Math.abs(position.quantity);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();

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

        onSuccess();
        onClose();
      } else {
        setError(result.error || 'Failed to exit position');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to exit position');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{position.symbol}</h2>
            <p className="text-sm text-gray-600">{position.exchange} ₹{position.current_price?.toFixed(2)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
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

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Product</span>
              <span className="text-sm font-medium text-gray-900">{position.product_type || 'NRML'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Quantity</span>
              <span className="text-sm font-medium text-gray-900">{exitQuantity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Transaction Type</span>
              <span className={`text-sm font-medium ${exitTransactionType === 'BUY' ? 'text-blue-600' : 'text-red-600'}`}>
                {exitTransactionType}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Order Type</span>
              <span className="text-sm font-medium text-gray-900">MARKET</span>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-xs text-yellow-800">
              This will place a market order to exit your position immediately at the current market price.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Placing...' : 'Exit Position'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
