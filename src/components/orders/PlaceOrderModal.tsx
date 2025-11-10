import { useState, useEffect, useRef } from 'react';
import { X, Target, Search } from 'lucide-react';
import { useZerodha } from '../../hooks/useZerodha';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { GTTModal } from './GTTModal';

interface PlaceOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PlaceOrderModal({ isOpen, onClose, onSuccess }: PlaceOrderModalProps) {
  const { user, session } = useAuth();
  const { placeOrder, loading, error } = useZerodha();
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<string[]>([]);
  const [showGTT, setShowGTT] = useState(false);
  const [lastOrderDetails, setLastOrderDetails] = useState<any>(null);
  const [instruments, setInstruments] = useState<any[]>([]);
  const [filteredInstruments, setFilteredInstruments] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeoutRef = useRef<any>(null);
  const [formData, setFormData] = useState({
    symbol: '',
    exchange: 'NFO',
    transaction_type: 'BUY' as 'BUY' | 'SELL',
    quantity: 1,
    order_type: 'MARKET' as 'MARKET' | 'LIMIT' | 'SL' | 'SL-M',
    product: 'NRML' as 'MIS' | 'CNC' | 'NRML',
    price: '',
    trigger_price: '',
  });

  useEffect(() => {
    if (isOpen && user) {
      loadBrokers();
      setFormData({
        symbol: '',
        exchange: 'NFO',
        transaction_type: 'BUY',
        quantity: 1,
        order_type: 'MARKET',
        product: 'NRML',
        price: '',
        trigger_price: '',
      });
      setInstruments([]);
      setFilteredInstruments([]);
      setLastOrderDetails(null);
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (formData.exchange && selectedBrokerIds.length > 0 && !searchLoading) {
      loadInstruments();
    }
  }, [formData.exchange, selectedBrokerIds]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.symbol-autocomplete')) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data) {
      setBrokers(data);
      if (data.length > 0) {
        setSelectedBrokerIds([data[0].id]);
      }
    }
  };

  const loadInstruments = async () => {
    if (selectedBrokerIds.length === 0) return;

    setSearchLoading(true);
    try {
      const brokerId = selectedBrokerIds[0];
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=${formData.exchange}&broker_id=${brokerId}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (data.success && data.instruments) {
        setInstruments(data.instruments);
      }
    } catch (err) {
      console.error('Failed to load instruments:', err);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSymbolSearch = (value: string) => {
    setFormData({ ...formData, symbol: value });

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!value || value.length < 2) {
      setFilteredInstruments([]);
      setShowSuggestions(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      const searchLower = value.toLowerCase();
      const filtered = instruments.filter(
        (inst) =>
          inst.tradingsymbol?.toLowerCase().includes(searchLower) ||
          inst.name?.toLowerCase().includes(searchLower)
      ).slice(0, 20);

      setFilteredInstruments(filtered);
      setShowSuggestions(true);
    }, 300);
  };

  const selectInstrument = (instrument: any) => {
    setFormData({ ...formData, symbol: instrument.tradingsymbol });
    setShowSuggestions(false);
    setFilteredInstruments([]);
  };

  const handleBrokerToggle = (brokerId: string) => {
    setSelectedBrokerIds(prev => {
      if (prev.includes(brokerId)) {
        return prev.filter(id => id !== brokerId);
      } else {
        return [...prev, brokerId];
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedBrokerIds.length === 0) {
      return;
    }

    const baseOrderParams: any = {
      symbol: formData.symbol.toUpperCase(),
      exchange: formData.exchange,
      transaction_type: formData.transaction_type,
      quantity: formData.quantity,
      order_type: formData.order_type,
      product: formData.product,
    };

    if (formData.order_type === 'LIMIT' && formData.price) {
      baseOrderParams.price = parseFloat(formData.price);
    }

    if ((formData.order_type === 'SL' || formData.order_type === 'SL-M') && formData.trigger_price) {
      baseOrderParams.trigger_price = parseFloat(formData.trigger_price);
    }

    // Place orders in parallel for faster execution
    const orderPromises = selectedBrokerIds.map(async (brokerId) => {
      const orderParams = {
        ...baseOrderParams,
        broker_connection_id: brokerId,
      };

      try {
        const result = await placeOrder(orderParams);
        const broker = brokers.find(b => b.id === brokerId);
        const accountName = broker?.account_holder_name
          ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
          : broker?.account_name || 'Account';

        if (result.success) {
          return {
            success: true,
            orderId: result.orderId,
            brokerId,
            accountName,
          };
        } else {
          return {
            success: false,
            error: result.error,
            accountName,
          };
        }
      } catch (err: any) {
        const broker = brokers.find(b => b.id === brokerId);
        const accountName = broker?.account_holder_name
          ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
          : broker?.account_name || 'Account';

        return {
          success: false,
          error: err.message || 'Unknown error',
          accountName,
        };
      }
    });

    const results = await Promise.all(orderPromises);

    const successfulOrders = results.filter(r => r.success);
    const successCount = successfulOrders.length;
    const errorMessages = results.filter(r => !r.success).map(r => `${r.accountName}: ${r.error}`);
    const firstSuccessfulOrder = successfulOrders.length > 0 ? {
      orderId: successfulOrders[0].orderId,
      brokerId: successfulOrders[0].brokerId,
      symbol: formData.symbol.toUpperCase(),
      quantity: formData.quantity,
    } : null;

    if (successCount > 0) {
      onSuccess();
      setLastOrderDetails(firstSuccessfulOrder);
      if (errorMessages.length === 0) {
        // Don't close immediately, show GTT option
      }
      setFormData({
        ...formData,
        symbol: '',
        quantity: 1,
        price: '',
        trigger_price: '',
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Place Order</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {brokers.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg text-sm">
              No active Zerodha connection found. Please connect your broker first.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Select Accounts</label>
            <div className="space-y-2 bg-gray-50 p-4 rounded-lg border border-gray-200 max-h-40 overflow-y-auto">
              {brokers.map((broker) => (
                <label
                  key={broker.id}
                  className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-400 cursor-pointer transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedBrokerIds.includes(broker.id)}
                    onChange={() => handleBrokerToggle(broker.id)}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {broker.account_holder_name || broker.account_name || `Zerodha Account`}
                    </div>
                    <div className="text-xs text-gray-500">
                      {broker.client_id ? `Client ID: ${broker.client_id}` : `${broker.api_key.substring(0, 8)}...`}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {selectedBrokerIds.length === 0 ? 'Select at least one account' : `${selectedBrokerIds.length} account(s) selected`}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Exchange</label>
            <select
              value={formData.exchange}
              onChange={(e) => setFormData({ ...formData, exchange: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="NFO">NFO (Derivatives)</option>
              <option value="NSE">NSE (Equity)</option>
              <option value="BSE">BSE</option>
              <option value="BFO">BFO</option>
              <option value="MCX">MCX (Commodity)</option>
            </select>
          </div>

          <div className="relative symbol-autocomplete">
            <label className="block text-sm font-medium text-gray-700 mb-2">Symbol</label>
            <div className="relative">
              <input
                type="text"
                value={formData.symbol}
                onChange={(e) => handleSymbolSearch(e.target.value)}
                onFocus={() => {
                  if (filteredInstruments.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder={searchLoading ? "Loading instruments..." : "Search symbol (e.g., NIFTY, BANKNIFTY)"}
                required
                disabled={searchLoading}
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            </div>

            {showSuggestions && filteredInstruments.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredInstruments.map((instrument, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => selectInstrument(instrument)}
                    className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition"
                  >
                    <div className="font-medium text-gray-900">{instrument.tradingsymbol}</div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {instrument.name && <span>{instrument.name} • </span>}
                      {instrument.instrument_type && <span>{instrument.instrument_type}</span>}
                      {instrument.expiry && <span> • Expiry: {instrument.expiry}</span>}
                      {instrument.strike && <span> • Strike: {instrument.strike}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {formData.symbol && filteredInstruments.length === 0 && !searchLoading && formData.symbol.length >= 2 && (
              <p className="text-xs text-gray-500 mt-1">No instruments found. Try a different search term.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Transaction</label>
              <select
                value={formData.transaction_type}
                onChange={(e) => setFormData({ ...formData, transaction_type: e.target.value as 'BUY' | 'SELL' })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                min="1"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Order Type</label>
              <select
                value={formData.order_type}
                onChange={(e) => setFormData({ ...formData, order_type: e.target.value as any })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
                <option value="SL">SL</option>
                <option value="SL-M">SL-M</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Product</label>
              <select
                value={formData.product}
                onChange={(e) => setFormData({ ...formData, product: e.target.value as any })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="NRML">NRML (F&O)</option>
                <option value="MIS">MIS (Intraday)</option>
                <option value="CNC">CNC (Delivery)</option>
              </select>
            </div>
          </div>

          {formData.order_type === 'LIMIT' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Price</label>
              <input
                type="number"
                step="0.05"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="Enter limit price"
                required
              />
            </div>
          )}

          {(formData.order_type === 'SL' || formData.order_type === 'SL-M') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Trigger Price</label>
              <input
                type="number"
                step="0.05"
                value={formData.trigger_price}
                onChange={(e) => setFormData({ ...formData, trigger_price: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="Enter trigger price"
                required
              />
            </div>
          )}

          {lastOrderDetails && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="text-sm text-green-800">
                  <div className="font-medium mb-1">Order Placed Successfully!</div>
                  <div>Would you like to set a GTT (Good Till Triggered) order for this position?</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowGTT(true);
                }}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition"
              >
                <Target className="w-4 h-4" />
                Set GTT Order
              </button>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={loading || brokers.length === 0 || selectedBrokerIds.length === 0}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Placing Order...' : selectedBrokerIds.length > 1 ? `Place Order on ${selectedBrokerIds.length} Accounts` : 'Place Order'}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                setLastOrderDetails(null);
              }}
              disabled={loading}
              className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition"
            >
              {lastOrderDetails ? 'Done' : 'Cancel'}
            </button>
          </div>
        </form>
      </div>

      {lastOrderDetails && (
        <GTTModal
          isOpen={showGTT}
          onClose={() => {
            setShowGTT(false);
            setLastOrderDetails(null);
            onClose();
          }}
          orderId={lastOrderDetails.orderId}
          symbol={lastOrderDetails.symbol}
          quantity={lastOrderDetails.quantity}
          brokerConnectionId={lastOrderDetails.brokerId}
        />
      )}
    </div>
  );
}
