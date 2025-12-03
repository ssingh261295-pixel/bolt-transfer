import { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ExitPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  positions: any[];
  onSuccess: () => void;
}

export function ExitPositionModal({ isOpen, onClose, positions, onSuccess }: ExitPositionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  if (!isOpen || !positions || positions.length === 0) return null;

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
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
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
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                {error}
              </div>
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
                            <div className="text-xs text-gray-500 mt-0.5">{position.exchange}</div>
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

          <div className="p-6 border-t bg-white">
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
