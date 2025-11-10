import { useState, useEffect } from 'react';
import { X, Search, Info } from 'lucide-react';
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
  initialSymbol?: string;
  initialExchange?: string;
  allBrokers?: any[];
}

export function GTTModal({ isOpen, onClose, brokerConnectionId, editingGTT, initialSymbol, initialExchange, allBrokers }: GTTModalProps) {
  const { session } = useAuth();
  const [symbol, setSymbol] = useState(initialSymbol || '');
  const [exchange, setExchange] = useState(initialExchange || 'NFO');
  const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>('BUY');
  const [gttType, setGttType] = useState<'single' | 'two-leg'>('single');
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<string[]>([brokerConnectionId]);

  // Leg 1 (Stoploss for OCO, single order for Single)
  const [triggerPrice1, setTriggerPrice1] = useState('');
  const [triggerPercent1, setTriggerPercent1] = useState('');
  const [useTriggerPercent1, setUseTriggerPercent1] = useState(false);
  const [quantity1, setQuantity1] = useState(200);
  const [orderType1, setOrderType1] = useState('LIMIT');
  const [price1, setPrice1] = useState('');
  const [pricePercent1, setPricePercent1] = useState('');
  const [usePricePercent1, setUsePricePercent1] = useState(false);
  const [product1, setProduct1] = useState('NRML');

  // Leg 2 (Target for OCO)
  const [triggerPrice2, setTriggerPrice2] = useState('');
  const [triggerPercent2, setTriggerPercent2] = useState('');
  const [useTriggerPercent2, setUseTriggerPercent2] = useState(false);
  const [quantity2, setQuantity2] = useState(200);
  const [orderType2, setOrderType2] = useState('LIMIT');
  const [price2, setPrice2] = useState('');
  const [pricePercent2, setPricePercent2] = useState('');
  const [usePricePercent2, setUsePricePercent2] = useState(false);
  const [product2, setProduct2] = useState('NRML');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [instruments, setInstruments] = useState<any[]>([]);
  const [filteredInstruments, setFilteredInstruments] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<any>(null);
  const [currentLTP, setCurrentLTP] = useState<number | null>(null);
  const [fetchingLTP, setFetchingLTP] = useState(false);
  const [ltpRefreshInterval, setLtpRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen && exchange) {
      loadInstruments();
    }
  }, [isOpen, exchange]);

  // Auto-refresh LTP during market hours (9:15 AM to 3:30 PM IST)
  useEffect(() => {
    if (!isOpen || !selectedInstrument || !selectedBrokerIds[0]) {
      if (ltpRefreshInterval) {
        clearInterval(ltpRefreshInterval);
        setLtpRefreshInterval(null);
      }
      return;
    }

    const checkAndRefreshLTP = () => {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istTime = new Date(now.getTime() + istOffset);
      const hours = istTime.getUTCHours();
      const minutes = istTime.getUTCMinutes();
      const currentMinutes = hours * 60 + minutes;
      const marketStart = 9 * 60 + 15;
      const marketEnd = 15 * 60 + 30;

      if (currentMinutes >= marketStart && currentMinutes <= marketEnd) {
        if (selectedInstrument.instrument_token) {
          fetchLTP(selectedInstrument.instrument_token, selectedInstrument.tradingsymbol, selectedInstrument.exchange || exchange);
        }
      }
    };

    checkAndRefreshLTP();
    const interval = setInterval(checkAndRefreshLTP, 3000);
    setLtpRefreshInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen, selectedInstrument, selectedBrokerIds]);

  useEffect(() => {
    const setupGTT = async () => {
      if (editingGTT) {
        const tradingsymbol = editingGTT.condition?.tradingsymbol || '';
        const exchangeValue = editingGTT.condition?.exchange || 'NFO';

        setSymbol(tradingsymbol);
        setExchange(exchangeValue);
        setTransactionType(editingGTT.orders?.[0]?.transaction_type || 'BUY');
        setGttType(editingGTT.type || 'single');
        setTriggerPrice1(editingGTT.condition?.trigger_values?.[0]?.toString() || '');
        setQuantity1(editingGTT.orders?.[0]?.quantity || 200);
        setOrderType1(editingGTT.orders?.[0]?.order_type || 'LIMIT');
        setPrice1(editingGTT.orders?.[0]?.price?.toString() || '');
        setProduct1(editingGTT.orders?.[0]?.product || 'NRML');

        if (editingGTT.condition?.instrument_token) {
          const instrument = {
            instrument_token: editingGTT.condition.instrument_token,
            tradingsymbol: editingGTT.condition.tradingsymbol,
            exchange: editingGTT.condition.exchange,
          };
          setSelectedInstrument(instrument);

          // Fetch LTP for the instrument
          if (instrument.instrument_token) {
            await fetchLTP(instrument.instrument_token, instrument.tradingsymbol, instrument.exchange);
          }
        }

        if (editingGTT.type === 'two-leg') {
          setTriggerPrice2(editingGTT.condition?.trigger_values?.[1]?.toString() || '');
          setQuantity2(editingGTT.orders?.[1]?.quantity || 200);
          setOrderType2(editingGTT.orders?.[1]?.order_type || 'LIMIT');
          setPrice2(editingGTT.orders?.[1]?.price?.toString() || '');
          setProduct2(editingGTT.orders?.[1]?.product || 'NRML');
        }
      } else if (isOpen) {
        setSymbol(initialSymbol || '');
        setExchange(initialExchange || 'NFO');
        setTransactionType('BUY');
        setGttType('single');
        setTriggerPrice1('');
        setTriggerPercent1('');
        setUseTriggerPercent1(false);
        setQuantity1(200);
        setOrderType1('LIMIT');
        setPrice1('');
        setPricePercent1('');
        setUsePricePercent1(false);
        setProduct1('NRML');
        setTriggerPrice2('');
        setTriggerPercent2('');
        setUseTriggerPercent2(false);
        setQuantity2(200);
        setOrderType2('LIMIT');
        setPrice2('');
        setPricePercent2('');
        setUsePricePercent2(false);
        setProduct2('NRML');
        setError('');
        setSuccess(false);
        setSelectedInstrument(null);
        setCurrentLTP(null);
      }
    };

    setupGTT();
  }, [editingGTT, isOpen, initialSymbol, initialExchange]);

  // Fetch LTP when symbol is pre-filled from position
  useEffect(() => {
    const fetchInitialLTP = async () => {
      if (isOpen && initialSymbol && !editingGTT && instruments.length > 0) {
        const instrument = instruments.find(
          (i) => i.tradingsymbol === initialSymbol
        );
        if (instrument) {
          setSelectedInstrument(instrument);
          if (instrument.instrument_token) {
            const ltp = await fetchLTP(instrument.instrument_token, instrument.tradingsymbol, initialExchange || exchange);
            if (ltp) {
              prefillPricesBasedOnLTP(ltp);
            }
          }
        }
      }
    };
    fetchInitialLTP();
  }, [instruments, initialSymbol, initialExchange, isOpen, editingGTT]);

  // Re-calculate prefilled values when GTT type or transaction type changes
  useEffect(() => {
    if (currentLTP && !editingGTT) {
      prefillPricesBasedOnLTP(currentLTP);
    }
  }, [gttType, transactionType]);

  const prefillPricesBasedOnLTP = (ltp: number) => {
    if (gttType === 'single') {
      // Single GTT: Pre-fill with +2% for trigger and price
      const triggerValue = (ltp * 1.02).toFixed(2);
      setTriggerPrice1(triggerValue);
      setPrice1(triggerValue);
      setTriggerPercent1('2');
      setPricePercent1('2');
    } else if (gttType === 'two-leg') {
      if (transactionType === 'BUY') {
        // Buy OCO: Stoploss at -2%, Target at +2%
        const stoploss = (ltp * 0.98).toFixed(2);
        const target = (ltp * 1.02).toFixed(2);
        setTriggerPrice1(stoploss);
        setPrice1(stoploss);
        setTriggerPercent1('-2');
        setPricePercent1('-2');
        setTriggerPrice2(target);
        setPrice2(target);
        setTriggerPercent2('2');
        setPricePercent2('2');
      } else {
        // Sell OCO: Stoploss at +2%, Target at -2%
        const stoploss = (ltp * 1.02).toFixed(2);
        const target = (ltp * 0.98).toFixed(2);
        setTriggerPrice1(stoploss);
        setPrice1(stoploss);
        setTriggerPercent1('2');
        setPricePercent1('2');
        setTriggerPrice2(target);
        setPrice2(target);
        setTriggerPercent2('-2');
        setPricePercent2('-2');
      }
    }
  };

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

  const handleSymbolSearch = (value: string) => {
    setSymbol(value);

    if (!editingGTT && value !== selectedInstrument?.tradingsymbol) {
      setSelectedInstrument(null);
    }

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

  const fetchLTP = async (instrumentToken: string, tradingsymbol?: string, exchangeValue?: string) => {
    try {
      setFetchingLTP(true);
      const symbolToUse = tradingsymbol || symbol;
      const exchangeToUse = exchangeValue || exchange;
      const instrumentKey = `${exchangeToUse}:${symbolToUse}`;
      const brokerId = selectedBrokerIds[0] || brokerConnectionId;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-ltp?broker_id=${brokerId}&instruments=${instrumentKey}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (data.success && data.data && data.data[instrumentKey]) {
        const ltp = data.data[instrumentKey].last_price;
        setCurrentLTP(ltp);
        return ltp;
      }
    } catch (err) {
      console.error('Failed to fetch LTP:', err);
    } finally {
      setFetchingLTP(false);
    }
    return null;
  };

  const selectInstrument = async (instrument: any) => {
    setSymbol(instrument.tradingsymbol);
    setSelectedInstrument(instrument);
    const lotSize = parseInt(instrument.lot_size) || 1;
    setQuantity1(lotSize);
    setQuantity2(lotSize);
    setShowSuggestions(false);
    setFilteredInstruments([]);

    if (instrument.instrument_token) {
      const ltp = await fetchLTP(instrument.instrument_token, instrument.tradingsymbol, instrument.exchange);
      if (ltp) {
        prefillPricesBasedOnLTP(ltp);
      }
    }
  };

  const calculatePercentFromLTP = (price: string) => {
    if (!currentLTP || !price) return '';
    const priceNum = parseFloat(price);
    const percentDiff = ((priceNum - currentLTP) / currentLTP) * 100;
    return percentDiff.toFixed(2);
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
        throw new Error('Please select a valid instrument from the dropdown list');
      }

      if (selectedBrokerIds.length === 0) {
        throw new Error('Please select at least one account');
      }

      if (!triggerPrice1) {
        throw new Error('Please enter trigger price');
      }

      if (gttType === 'two-leg' && !triggerPrice2) {
        throw new Error('Please enter both trigger prices for OCO');
      }

      const ltp = await fetchLTP(selectedInstrument.instrument_token);

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

        if (!price2) {
          throw new Error('Please enter limit price for order 2');
        }
        gttData['orders[1][price]'] = parseFloat(price2);
      } else {
        gttData['condition[trigger_values][0]'] = parseFloat(triggerPrice1);
      }

      if (!price1) {
        throw new Error('Please enter limit price for order 1');
      }
      gttData['orders[0][price]'] = parseFloat(price1);

      const firstTriggerValue = gttData['condition[trigger_values][0]'];
      let lastPrice = ltp || selectedInstrument.last_price;
      if (!lastPrice || lastPrice === firstTriggerValue) {
        lastPrice = Math.round((firstTriggerValue + 5) * 100) / 100;
      }
      gttData['condition[last_price]'] = lastPrice;

      const brokersToProcess = editingGTT ? [brokerConnectionId] : selectedBrokerIds;
      const results = [];

      for (const brokerId of brokersToProcess) {
        try {
          const method = editingGTT ? 'PUT' : 'POST';
          const gttIdParam = editingGTT ? `&gtt_id=${editingGTT.id}` : '';
          const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${brokerId}${gttIdParam}`;

          const response = await fetch(apiUrl, {
            method: method,
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(gttData),
          });

          const result = await response.json();

          if (result.success) {
            results.push({ brokerId, success: true });
          } else {
            results.push({ brokerId, success: false, error: result.error });
          }
        } catch (err: any) {
          results.push({ brokerId, success: false, error: err.message });
        }
      }

      const failedCount = results.filter(r => !r.success).length;
      if (failedCount === results.length) {
        throw new Error('Failed to create GTT orders for all accounts');
      }

      if (failedCount > 0) {
        setError(`Created GTT for ${results.length - failedCount} accounts. Failed for ${failedCount} accounts.`);
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);

    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {editingGTT ? 'Edit GTT Order' : 'New GTT Order'}
            </h2>
            {selectedInstrument && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-medium text-gray-900">{symbol}</span>
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{exchange}</span>
                {currentLTP && (
                  <span className="text-sm font-semibold text-gray-700">{currentLTP.toFixed(2)}</span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded text-sm">
              GTT order {editingGTT ? 'updated' : 'created'} successfully!
            </div>
          )}

          {/* Multi-Account Selection */}
          {!editingGTT && allBrokers && allBrokers.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Select Accounts ({selectedBrokerIds.length} selected)
              </label>
              <div className="grid grid-cols-2 gap-3">
                {allBrokers.map((broker) => {
                  const isSelected = selectedBrokerIds.includes(broker.id);
                  return (
                    <label
                      key={broker.id}
                      className={`flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBrokerIds([...selectedBrokerIds, broker.id]);
                          } else {
                            setSelectedBrokerIds(selectedBrokerIds.filter(id => id !== broker.id));
                          }
                        }}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {broker.account_holder_name || broker.account_name || 'Account'}
                        </div>
                        {broker.client_id && (
                          <div className="text-xs text-gray-600">ID: {broker.client_id}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Symbol Search */}
          {!editingGTT && (
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Symbol
              </label>
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
                  className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Search symbol (e.g., NIFTY, BANKNIFTY)"
                  required
                />
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>

              {showSuggestions && filteredInstruments.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredInstruments.map((instrument, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => selectInstrument(instrument)}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition"
                    >
                      <div className="font-medium text-gray-900 text-sm">{instrument.tradingsymbol}</div>
                      {instrument.name && (
                        <div className="text-xs text-gray-600 mt-0.5">{instrument.name}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* Transaction and Trigger Type */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Transaction type</label>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="BUY"
                    checked={transactionType === 'BUY'}
                    onChange={(e) => setTransactionType(e.target.value as 'BUY')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-2 text-sm text-gray-900">Buy</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="SELL"
                    checked={transactionType === 'SELL'}
                    onChange={(e) => setTransactionType(e.target.value as 'SELL')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-2 text-sm text-gray-900">Sell</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Trigger type</label>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="single"
                    checked={gttType === 'single'}
                    onChange={(e) => setGttType(e.target.value as 'single')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-2 text-sm text-gray-900">Single</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="two-leg"
                    checked={gttType === 'two-leg'}
                    onChange={(e) => setGttType(e.target.value as 'two-leg')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-2 text-sm text-gray-900">OCO</span>
                </label>
              </div>
              {gttType === 'two-leg' && (
                <div className="mt-2 text-xs text-gray-600 leading-relaxed">
                  One Cancels Other: Either the stoploss or the target order is placed when the Last Traded Price (LTP) crosses the respective trigger. Can be used to set target and stoploss for a position/holding.
                </div>
              )}
            </div>
          </div>

          {/* Stoploss Leg */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="mb-4">
              <span className="inline-block px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded">
                {gttType === 'two-leg' ? 'Stoploss' : 'Order'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Trigger price</label>
                <div className="flex gap-2 mb-2">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      checked={!useTriggerPercent1}
                      onChange={() => setUseTriggerPercent1(false)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-1 text-xs text-gray-700">Price</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      checked={useTriggerPercent1}
                      onChange={() => setUseTriggerPercent1(true)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-1 text-xs text-gray-700">%</span>
                  </label>
                </div>
                {!useTriggerPercent1 ? (
                  <div>
                    <input
                      type="number"
                      step="0.05"
                      value={triggerPrice1}
                      onChange={(e) => setTriggerPrice1(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="0.00"
                      required
                    />
                    {currentLTP && triggerPrice1 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {calculatePercentFromLTP(triggerPrice1)}% of LTP
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      value={triggerPercent1}
                      onChange={(e) => {
                        setTriggerPercent1(e.target.value);
                        if (currentLTP && e.target.value) {
                          const calculatedPrice = currentLTP * (1 + parseFloat(e.target.value) / 100);
                          setTriggerPrice1(calculatedPrice.toFixed(2));
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="2.5"
                      required
                    />
                    {triggerPercent1 && currentLTP && (
                      <div className="text-xs text-gray-500 mt-1">
                        = ₹{(currentLTP * (1 + parseFloat(triggerPercent1) / 100)).toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Qty.</label>
                <input
                  type="number"
                  value={quantity1}
                  onChange={(e) => setQuantity1(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  min="1"
                  required
                />
              </div>
            </div>

            <div className="flex gap-4 mb-3">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  checked={product1 === 'NRML'}
                  onChange={() => setProduct1('NRML')}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="ml-2 text-sm text-gray-900">NRML</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  checked={product1 === 'MIS'}
                  onChange={() => setProduct1('MIS')}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="ml-2 text-sm text-gray-900">MIS</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Price</label>
              <div className="flex gap-2 mb-2">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={!usePricePercent1}
                    onChange={() => setUsePricePercent1(false)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1 text-xs text-gray-700">Price</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={usePricePercent1}
                    onChange={() => setUsePricePercent1(true)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1 text-xs text-gray-700">%</span>
                </label>
              </div>
              {!usePricePercent1 ? (
                <div>
                  <input
                    type="number"
                    step="0.05"
                    value={price1}
                    onChange={(e) => setPrice1(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="0.00"
                    required
                  />
                  {currentLTP && price1 && (
                    <div className="text-xs text-gray-500 mt-1">
                      {calculatePercentFromLTP(price1)}% of LTP
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    type="number"
                    step="0.01"
                    value={pricePercent1}
                    onChange={(e) => {
                      setPricePercent1(e.target.value);
                      if (currentLTP && e.target.value) {
                        const calculatedPrice = currentLTP * (1 + parseFloat(e.target.value) / 100);
                        setPrice1(calculatedPrice.toFixed(2));
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="2.5"
                    required
                  />
                  {pricePercent1 && currentLTP && (
                    <div className="text-xs text-gray-500 mt-1">
                      = ₹{(currentLTP * (1 + parseFloat(pricePercent1) / 100)).toFixed(2)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Target Leg (Only for OCO) */}
          {gttType === 'two-leg' && (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="mb-4">
                <span className="inline-block px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded">
                  Target
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Trigger price</label>
                  <div className="flex gap-2 mb-2">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        checked={!useTriggerPercent2}
                        onChange={() => setUseTriggerPercent2(false)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="ml-1 text-xs text-gray-700">Price</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        checked={useTriggerPercent2}
                        onChange={() => setUseTriggerPercent2(true)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="ml-1 text-xs text-gray-700">%</span>
                    </label>
                  </div>
                  {!useTriggerPercent2 ? (
                    <div>
                      <input
                        type="number"
                        step="0.05"
                        value={triggerPrice2}
                        onChange={(e) => setTriggerPrice2(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        placeholder="0.00"
                        required
                      />
                      {currentLTP && triggerPrice2 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {calculatePercentFromLTP(triggerPrice2)}% of LTP
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <input
                        type="number"
                        step="0.01"
                        value={triggerPercent2}
                        onChange={(e) => {
                          setTriggerPercent2(e.target.value);
                          if (currentLTP && e.target.value) {
                            const calculatedPrice = currentLTP * (1 + parseFloat(e.target.value) / 100);
                            setTriggerPrice2(calculatedPrice.toFixed(2));
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        placeholder="2.5"
                        required
                      />
                      {triggerPercent2 && currentLTP && (
                        <div className="text-xs text-gray-500 mt-1">
                          = ₹{(currentLTP * (1 + parseFloat(triggerPercent2) / 100)).toFixed(2)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Qty.</label>
                  <input
                    type="number"
                    value={quantity2}
                    onChange={(e) => setQuantity2(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    min="1"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-4 mb-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={product2 === 'NRML'}
                    onChange={() => setProduct2('NRML')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-2 text-sm text-gray-900">NRML</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={product2 === 'MIS'}
                    onChange={() => setProduct2('MIS')}
                    className="w-4 h-4 text-blue-600"
                />
                  <span className="ml-2 text-sm text-gray-900">MIS</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Price</label>
                <div className="flex gap-2 mb-2">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      checked={!usePricePercent2}
                      onChange={() => setUsePricePercent2(false)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-1 text-xs text-gray-700">Price</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      checked={usePricePercent2}
                      onChange={() => setUsePricePercent2(true)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-1 text-xs text-gray-700">%</span>
                  </label>
                </div>
                {!usePricePercent2 ? (
                  <div>
                    <input
                      type="number"
                      step="0.05"
                      value={price2}
                      onChange={(e) => setPrice2(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="0.00"
                      required
                    />
                    {currentLTP && price2 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {calculatePercentFromLTP(price2)}% of LTP
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      value={pricePercent2}
                      onChange={(e) => {
                        setPricePercent2(e.target.value);
                        if (currentLTP && e.target.value) {
                          const calculatedPrice = currentLTP * (1 + parseFloat(e.target.value) / 100);
                          setPrice2(calculatedPrice.toFixed(2));
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="2.5"
                      required
                    />
                    {pricePercent2 && currentLTP && (
                      <div className="text-xs text-gray-500 mt-1">
                        = ₹{(currentLTP * (1 + parseFloat(pricePercent2) / 100)).toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div className="text-xs text-gray-600">
              By {editingGTT ? 'modifying' : 'creating'}, I agree that trigger executions are not guaranteed.
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !selectedInstrument}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processing...' : editingGTT ? 'Modify' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
