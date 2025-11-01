import { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface GTTModalProps {
  isOpen: boolean;
  onClose: () => void;
  brokerConnectionId: string;
  editingGTT?: any;
  orderId?: string;
  symbol?: string;
  quantity?: number;
}

export function GTTModal({ isOpen, onClose, brokerConnectionId, editingGTT }: GTTModalProps) {
  const { session } = useAuth();
  const [symbol, setSymbol] = useState('');
  const [exchange, setExchange] = useState('NFO');
  const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>('BUY');
  const [gttType, setGttType] = useState<'single' | 'two-leg'>('single');

  // Leg 1 (Stoploss for OCO, single order for Single)
  const [triggerPrice1, setTriggerPrice1] = useState('');
  const [quantity1, setQuantity1] = useState(1);
  const [orderType1, setOrderType1] = useState('LIMIT');
  const [price1, setPrice1] = useState('');
  const [product1, setProduct1] = useState('NRML');

  // Leg 2 (Target for OCO)
  const [triggerPrice2, setTriggerPrice2] = useState('');
  const [quantity2, setQuantity2] = useState(1);
  const [orderType2, setOrderType2] = useState('LIMIT');
  const [price2, setPrice2] = useState('');
  const [product2, setProduct2] = useState('NRML');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [instruments, setInstruments] = useState<any[]>([]);
  const [filteredInstruments, setFilteredInstruments] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (isOpen && exchange) {
      loadInstruments();
    }
  }, [isOpen, exchange]);

  useEffect(() => {
    if (editingGTT) {
      setSymbol(editingGTT.condition?.tradingsymbol || '');
      setExchange(editingGTT.condition?.exchange || 'NFO');
      setTransactionType(editingGTT.orders?.[0]?.transaction_type || 'BUY');
      setGttType(editingGTT.type || 'single');
      setTriggerPrice1(editingGTT.condition?.trigger_values?.[0]?.toString() || '');
      setQuantity1(editingGTT.orders?.[0]?.quantity || 1);
      setOrderType1(editingGTT.orders?.[0]?.order_type || 'LIMIT');
      setPrice1(editingGTT.orders?.[0]?.price?.toString() || '');
      setProduct1(editingGTT.orders?.[0]?.product || 'NRML');

      if (editingGTT.type === 'two-leg') {
        setTriggerPrice2(editingGTT.condition?.trigger_values?.[1]?.toString() || '');
        setQuantity2(editingGTT.orders?.[1]?.quantity || 1);
        setOrderType2(editingGTT.orders?.[1]?.order_type || 'LIMIT');
        setPrice2(editingGTT.orders?.[1]?.price?.toString() || '');
        setProduct2(editingGTT.orders?.[1]?.product || 'NRML');
      }
    } else if (isOpen) {
      setSymbol('');
      setExchange('NFO');
      setTransactionType('BUY');
      setGttType('single');
      setTriggerPrice1('');
      setQuantity1(1);
      setOrderType1('LIMIT');
      setPrice1('');
      setProduct1('NRML');
      setTriggerPrice2('');
      setQuantity2(1);
      setOrderType2('LIMIT');
      setPrice2('');
      setProduct2('NRML');
      setError('');
      setSuccess(false);
    }
  }, [editingGTT, isOpen]);

  const loadInstruments = async () => {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-instruments?exchange=${exchange}`;

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
    }
  };

  const [selectedInstrument, setSelectedInstrument] = useState<any>(null);

  const handleSymbolSearch = (value: string) => {
    setSymbol(value);

    if (!value || value.length < 1) {
      setFilteredInstruments([]);
      setShowSuggestions(false);
      return;
    }

    const searchLower = value.toLowerCase();
    const filtered = instruments.filter(
      (inst) =>
        inst.tradingsymbol?.toLowerCase().includes(searchLower) ||
        inst.name?.toLowerCase().includes(searchLower)
    ).slice(0, 30);

    setFilteredInstruments(filtered);
    setShowSuggestions(filtered.length > 0);
  };

  const selectInstrument = (instrument: any) => {
    setSymbol(instrument.tradingsymbol);
    setSelectedInstrument(instrument);
    const lotSize = parseInt(instrument.lot_size) || 1;
    setQuantity1(lotSize);
    setQuantity2(lotSize);
    setShowSuggestions(false);
    setFilteredInstruments([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!symbol) {
        throw new Error('Please enter a symbol');
      }

      if (!selectedInstrument || !selectedInstrument.instrument_token) {
        throw new Error('Please select a valid instrument from the list');
      }

      if (!triggerPrice1) {
        throw new Error('Please enter trigger price');
      }

      if (gttType === 'two-leg' && !triggerPrice2) {
        throw new Error('Please enter both trigger prices for OCO');
      }

      const gttData: any = {
        type: gttType,
        'condition[exchange]': exchange,
        'condition[tradingsymbol]': symbol,
        'condition[instrument_token]': selectedInstrument.instrument_token,
        'orders[0][exchange]': exchange,
        'orders[0][tradingsymbol]': symbol,
        'orders[0][transaction_type]': transactionType,
        'orders[0][quantity]': quantity1,
        'orders[0][order_type]': orderType1,
        'orders[0][product]': product1,
      };

      if (gttType === 'two-leg') {
        gttData['condition[trigger_values][0]'] = parseFloat(triggerPrice1);
        gttData['condition[trigger_values][1]'] = parseFloat(triggerPrice2);

        gttData['orders[1][exchange]'] = exchange;
        gttData['orders[1][tradingsymbol]'] = symbol;
        gttData['orders[1][transaction_type]'] = transactionType;
        gttData['orders[1][quantity]'] = quantity2;
        gttData['orders[1][order_type]'] = orderType2;
        gttData['orders[1][product]'] = product2;

        if (orderType2 === 'LIMIT' && price2) {
          gttData['orders[1][price]'] = parseFloat(price2);
        }
      } else {
        gttData['condition[trigger_values][0]'] = parseFloat(triggerPrice1);
      }

      if (orderType1 === 'LIMIT' && price1) {
        gttData['orders[0][price]'] = parseFloat(price1);
      }

      console.log('GTT Data being sent:', gttData);

      const method = editingGTT ? 'PUT' : 'POST';
      const gttIdParam = editingGTT ? `&gtt_id=${editingGTT.id}` : '';
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${brokerConnectionId}${gttIdParam}`;

      const response = await fetch(apiUrl, {
        method: method,
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gttData),
      });

      const result = await response.json();
      console.log('GTT API Response:', result);

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        const errorMsg = result.error || result.details || 'Failed to create GTT order';
        console.error('GTT Error:', errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create GTT');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {editingGTT ? 'Edit GTT Order' : 'New GTT Order'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">
              GTT order {editingGTT ? 'updated' : 'created'} successfully!
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Exchange</label>
              <select
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={!!editingGTT}
              >
                <option value="NFO">NFO</option>
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
                <option value="MCX">MCX</option>
              </select>
            </div>

            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Symbol</label>
              <div className="relative">
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => handleSymbolSearch(e.target.value)}
                  onFocus={() => {
                    if (filteredInstruments.length > 0) {
                      setShowSuggestions(true);
                    }
                  }}
                  className="w-full px-3 py-2 pr-8 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Search symbol"
                  required
                  disabled={!!editingGTT}
                />
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>

              {showSuggestions && filteredInstruments.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-60 overflow-y-auto">
                  {filteredInstruments.map((instrument, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => selectInstrument(instrument)}
                      className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition text-sm"
                    >
                      <div className="font-medium text-gray-900">{instrument.tradingsymbol}</div>
                      {instrument.name && (
                        <div className="text-xs text-gray-600 mt-0.5">{instrument.name}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transaction</label>
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value as 'BUY' | 'SELL')}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GTT Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setGttType('single')}
                className={`px-3 py-2 rounded border text-sm transition ${
                  gttType === 'single'
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => setGttType('two-leg')}
                className={`px-3 py-2 rounded border text-sm transition ${
                  gttType === 'two-leg'
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                OCO (Two-leg)
              </button>
            </div>
          </div>

          {/* Single leg or first leg (Stoploss) */}
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <div className="text-xs font-semibold text-purple-600 mb-2">
              {gttType === 'two-leg' ? 'STOPLOSS' : 'ORDER'}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Trigger Price</label>
                <input
                  type="number"
                  step="0.05"
                  value={triggerPrice1}
                  onChange={(e) => setTriggerPrice1(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Trigger"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                <input
                  type="number"
                  value={quantity1}
                  onChange={(e) => setQuantity1(parseInt(e.target.value) || 1)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  min="1"
                  placeholder="Quantity"
                  required
                />
                {selectedInstrument && selectedInstrument.lot_size && (
                  <div className="text-xs text-gray-500 mt-1">
                    Lot Size: {selectedInstrument.lot_size} (Total: {quantity1})
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Product</label>
                <select
                  value={product1}
                  onChange={(e) => setProduct1(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="NRML">NRML</option>
                  <option value="MIS">MIS</option>
                  <option value="CNC">CNC</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Order Type</label>
                <select
                  value={orderType1}
                  onChange={(e) => setOrderType1(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="LIMIT">LIMIT</option>
                  <option value="MARKET">MARKET</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Price</label>
                <input
                  type="number"
                  step="0.05"
                  value={price1}
                  onChange={(e) => setPrice1(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Price"
                  required={orderType1 === 'LIMIT'}
                  disabled={orderType1 === 'MARKET'}
                />
              </div>
            </div>
          </div>

          {/* Second leg (Target) - Only for OCO */}
          {gttType === 'two-leg' && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="text-xs font-semibold text-blue-600 mb-2">TARGET</div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Trigger Price</label>
                  <input
                    type="number"
                    step="0.05"
                    value={triggerPrice2}
                    onChange={(e) => setTriggerPrice2(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="Trigger"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={quantity2}
                    onChange={(e) => setQuantity2(parseInt(e.target.value) || 1)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    min="1"
                    placeholder="Quantity"
                    required
                  />
                  {selectedInstrument && selectedInstrument.lot_size && (
                    <div className="text-xs text-gray-500 mt-1">
                      Lot Size: {selectedInstrument.lot_size} (Total: {quantity2})
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Product</label>
                  <select
                    value={product2}
                    onChange={(e) => setProduct2(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    <option value="NRML">NRML</option>
                    <option value="MIS">MIS</option>
                    <option value="CNC">CNC</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Order Type</label>
                  <select
                    value={orderType2}
                    onChange={(e) => setOrderType2(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    <option value="LIMIT">LIMIT</option>
                    <option value="MARKET">MARKET</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Price</label>
                  <input
                    type="number"
                    step="0.05"
                    value={price2}
                    onChange={(e) => setPrice2(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="Price"
                    required={orderType2 === 'LIMIT'}
                    disabled={orderType2 === 'MARKET'}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-2 rounded font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm"
            >
              {loading ? 'Processing...' : editingGTT ? 'Update GTT' : 'Create GTT'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 bg-gray-100 text-gray-700 py-2 rounded font-medium hover:bg-gray-200 transition text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
