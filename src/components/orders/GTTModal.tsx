import { useState, useEffect } from 'react';
import { X, Search, RefreshCw } from 'lucide-react';
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
  positionData?: {
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    transactionType: 'BUY' | 'SELL';
  };
}

export function GTTModal({ isOpen, onClose, brokerConnectionId, editingGTT, initialSymbol, initialExchange, allBrokers, positionData }: GTTModalProps) {
  const { session } = useAuth();
  const [symbol, setSymbol] = useState(initialSymbol || '');
  const [exchange, setExchange] = useState(initialExchange || 'NFO');
  const [transactionType, setTransactionType] = useState<'BUY' | 'SELL'>(positionData?.transactionType || 'BUY');
  const [gttType, setGttType] = useState<'single' | 'two-leg'>(positionData ? 'two-leg' : 'single');
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<string[]>(
    brokerConnectionId && brokerConnectionId !== 'all' ? [brokerConnectionId] : []
  );

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
  const [initialLTPCaptured, setInitialLTPCaptured] = useState(false);
  const [tickSize, setTickSize] = useState<number>(0.05);

  // Round price to proper tick size based on instrument
  const roundToTickSize = (price: number): string => {
    const rounded = Math.round(price / tickSize) * tickSize;
    // Calculate decimal places based on tick size
    const decimalPlaces = tickSize < 1 ? Math.max(0, -Math.floor(Math.log10(tickSize))) : 0;
    return rounded.toFixed(decimalPlaces);
  };

  // Validate price input to only allow valid tick sizes
  const validatePriceInput = (value: string): string => {
    if (!value || value === '') return value;

    const numValue = parseFloat(value);
    if (isNaN(numValue)) return value;

    // Round to nearest 0.05
    return roundToTickSize(numValue);
  };

  useEffect(() => {
    if (isOpen && exchange) {
      loadInstruments();
    }
  }, [isOpen, exchange]);

  // Don't auto-select any account - let user choose

  useEffect(() => {
    const setupGTT = async () => {
      if (editingGTT) {
        const tradingsymbol = editingGTT.condition?.tradingsymbol || '';
        const exchangeValue = editingGTT.condition?.exchange || 'NFO';
        const transType = editingGTT.orders?.[0]?.transaction_type || 'BUY';

        setSymbol(tradingsymbol);
        setExchange(exchangeValue);
        setTransactionType(transType);
        setGttType(editingGTT.type || 'single');

        if (editingGTT.condition?.instrument_token) {
          const instrument = {
            instrument_token: editingGTT.condition.instrument_token,
            tradingsymbol: editingGTT.condition.tradingsymbol,
            exchange: editingGTT.condition.exchange,
          };
          setSelectedInstrument(instrument);

          // Fetch LTP for the instrument (non-blocking)
          if (instrument.instrument_token) {
            fetchLTP(instrument.instrument_token, instrument.tradingsymbol, instrument.exchange).catch(console.error);
          }
        }

        if (editingGTT.type === 'two-leg') {
          const trigger0 = editingGTT.condition?.trigger_values?.[0];
          const trigger1 = editingGTT.condition?.trigger_values?.[1];

          // For BUY: Stoploss is higher, Target is lower
          // For SELL: Stoploss is lower, Target is higher
          // trigger_values are always sorted [lower, higher]

          if (transType === 'BUY') {
            // Stoploss = higher price = trigger1
            setTriggerPrice1(trigger1 ? roundToTickSize(trigger1) : '');
            setPrice1(editingGTT.orders?.[1]?.price ? roundToTickSize(editingGTT.orders[1].price) : '');
            setQuantity1(editingGTT.orders?.[1]?.quantity || 200);
            setOrderType1(editingGTT.orders?.[1]?.order_type || 'LIMIT');
            setProduct1(editingGTT.orders?.[1]?.product || 'NRML');

            // Target = lower price = trigger0
            setTriggerPrice2(trigger0 ? roundToTickSize(trigger0) : '');
            setPrice2(editingGTT.orders?.[0]?.price ? roundToTickSize(editingGTT.orders[0].price) : '');
            setQuantity2(editingGTT.orders?.[0]?.quantity || 200);
            setOrderType2(editingGTT.orders?.[0]?.order_type || 'LIMIT');
            setProduct2(editingGTT.orders?.[0]?.product || 'NRML');
          } else {
            // SELL: Stoploss = lower, Target = higher
            setTriggerPrice1(trigger0 ? roundToTickSize(trigger0) : '');
            setPrice1(editingGTT.orders?.[0]?.price ? roundToTickSize(editingGTT.orders[0].price) : '');
            setQuantity1(editingGTT.orders?.[0]?.quantity || 200);
            setOrderType1(editingGTT.orders?.[0]?.order_type || 'LIMIT');
            setProduct1(editingGTT.orders?.[0]?.product || 'NRML');

            setTriggerPrice2(trigger1 ? roundToTickSize(trigger1) : '');
            setPrice2(editingGTT.orders?.[1]?.price ? roundToTickSize(editingGTT.orders[1].price) : '');
            setQuantity2(editingGTT.orders?.[1]?.quantity || 200);
            setOrderType2(editingGTT.orders?.[1]?.order_type || 'LIMIT');
            setProduct2(editingGTT.orders?.[1]?.product || 'NRML');
          }
        } else {
          setTriggerPrice1(editingGTT.condition?.trigger_values?.[0] ? roundToTickSize(editingGTT.condition.trigger_values[0]) : '');
          setQuantity1(editingGTT.orders?.[0]?.quantity || 200);
          setOrderType1(editingGTT.orders?.[0]?.order_type || 'LIMIT');
          setPrice1(editingGTT.orders?.[0]?.price ? roundToTickSize(editingGTT.orders[0].price) : '');
          setProduct1(editingGTT.orders?.[0]?.product || 'NRML');
        }
      } else if (isOpen) {
        setSymbol(initialSymbol || '');
        setExchange(initialExchange || 'NFO');
        // If opened from position page, keep transaction type and GTT type from initial state
        if (!positionData) {
          setTransactionType('BUY');
          setGttType('single');
        } else {
          setTransactionType(positionData.transactionType);
          setGttType('two-leg');
        }
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
        setInitialLTPCaptured(false);
      }
    };

    setupGTT();
  }, [editingGTT, isOpen, initialSymbol, initialExchange, positionData]);

  // Fetch LTP when symbol is pre-filled from position
  useEffect(() => {
    if (isOpen && initialSymbol && !editingGTT && instruments.length > 0) {
      const instrument = instruments.find(
        (i) => i.tradingsymbol === initialSymbol
      );
      if (instrument) {
        setSelectedInstrument(instrument);

        const lotSize = parseInt(instrument.lot_size) || 1;
        const qty = positionData?.quantity || lotSize;
        setQuantity1(qty);
        setQuantity2(qty);

        if (instrument.instrument_token) {
          // Fetch LTP and prefill immediately without blocking
          fetchLTP(instrument.instrument_token, instrument.tradingsymbol, initialExchange || exchange).then(ltp => {
            if (ltp) {
              prefillPricesBasedOnLTP(ltp);
            }
          }).catch(console.error);
        }
      }
    }
  }, [instruments, initialSymbol, initialExchange, isOpen, editingGTT, positionData]);

  // Re-calculate prefilled values when GTT type or transaction type changes
  useEffect(() => {
    if (currentLTP && !editingGTT) {
      // For two-leg, if target fields are empty but stoploss has value, fill ONLY target
      if (gttType === 'two-leg' && !triggerPrice2 && triggerPrice1) {
        // Only populate target fields, don't touch stoploss fields
        const isClosingPosition = positionData !== undefined;

        if (isClosingPosition) {
          if (transactionType === 'SELL') {
            // Closing long: Target at +2%
            const target = roundToTickSize(currentLTP * 1.02);
            setTriggerPrice2(target);
            setPrice2(target);
            setTriggerPercent2('2.00');
            setPricePercent2('2.00');
          } else {
            // Closing short: Target at -2%
            const target = roundToTickSize(currentLTP * 0.98);
            setTriggerPrice2(target);
            setPrice2(target);
            setTriggerPercent2('-2.00');
            setPricePercent2('-2.00');
          }
        } else {
          // Opening new position
          if (transactionType === 'BUY') {
            // Buy OCO: Target at -2%
            const target = roundToTickSize(currentLTP * 0.98);
            setTriggerPrice2(target);
            setPrice2(target);
            setTriggerPercent2('-2.00');
            setPricePercent2('-2.00');
          } else {
            // Sell OCO: Target at +2%
            const target = roundToTickSize(currentLTP * 1.02);
            setTriggerPrice2(target);
            setPrice2(target);
            setTriggerPercent2('2.00');
            setPricePercent2('2.00');
          }
        }
      }
      // For initial load when nothing is filled yet
      else if (!initialLTPCaptured && !triggerPrice1 && !triggerPrice2) {
        prefillPricesBasedOnLTP(currentLTP);
        setInitialLTPCaptured(true);
      }
    }
  }, [gttType, transactionType, currentLTP, editingGTT, initialLTPCaptured, triggerPrice1, triggerPrice2, positionData]);

  // Calculate percentages for editing GTT when LTP becomes available (one time only)
  useEffect(() => {
    if (editingGTT && currentLTP && !initialLTPCaptured) {
      if (triggerPrice1) {
        const triggerPct = ((parseFloat(triggerPrice1) - currentLTP) / currentLTP * 100).toFixed(2);
        setTriggerPercent1(triggerPct);
      }
      if (price1) {
        const pricePct = ((parseFloat(price1) - currentLTP) / currentLTP * 100).toFixed(2);
        setPricePercent1(pricePct);
      }
      if (triggerPrice2) {
        const triggerPct = ((parseFloat(triggerPrice2) - currentLTP) / currentLTP * 100).toFixed(2);
        setTriggerPercent2(triggerPct);
      }
      if (price2) {
        const pricePct = ((parseFloat(price2) - currentLTP) / currentLTP * 100).toFixed(2);
        setPricePercent2(pricePct);
      }
      setInitialLTPCaptured(true);
    }
  }, [editingGTT, currentLTP, initialLTPCaptured]);

  // Recalculate prices when transaction type or GTT type changes
  useEffect(() => {
    if (currentLTP && !editingGTT) {
      prefillPricesBasedOnLTP(currentLTP);
    }
  }, [transactionType, gttType]);

  const prefillPricesBasedOnLTP = (ltp: number) => {
    if (gttType === 'single') {
      // Single GTT: BUY = +2%, SELL = -2%
      if (transactionType === 'BUY') {
        const triggerValue = roundToTickSize(ltp * 1.02);
        setTriggerPrice1(triggerValue);
        setPrice1(triggerValue);
        setTriggerPercent1('2.00');
        setPricePercent1('2.00');
      } else {
        const triggerValue = roundToTickSize(ltp * 0.98);
        setTriggerPrice1(triggerValue);
        setPrice1(triggerValue);
        setTriggerPercent1('-2.00');
        setPricePercent1('-2.00');
      }
    } else if (gttType === 'two-leg') {
      // OCO GTT: Consistent logic for all cases
      if (transactionType === 'BUY') {
        // Buy OCO: Stoploss at +2% (above), Target at -2% (below)
        const stoploss = roundToTickSize(ltp * 1.02);
        const target = roundToTickSize(ltp * 0.98);
        setTriggerPrice1(stoploss);
        setPrice1(stoploss);
        setTriggerPercent1('2.00');
        setPricePercent1('2.00');
        setTriggerPrice2(target);
        setPrice2(target);
        setTriggerPercent2('-2.00');
        setPricePercent2('-2.00');
      } else {
        // Sell OCO: Stoploss at -2% (below), Target at +2% (above)
        const stoploss = roundToTickSize(ltp * 0.98);
        const target = roundToTickSize(ltp * 1.02);
        setTriggerPrice1(stoploss);
        setPrice1(stoploss);
        setTriggerPercent1('-2.00');
        setPricePercent1('-2.00');
        setTriggerPrice2(target);
        setPrice2(target);
        setTriggerPercent2('2.00');
        setPricePercent2('2.00');
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

  const fetchLTP = async (instrumentToken: string, tradingsymbol?: string, exchangeValue?: string, manualRefresh = false) => {
    try {
      setFetchingLTP(true);
      const symbolToUse = tradingsymbol || symbol;
      const exchangeToUse = exchangeValue || exchange;
      const instrumentKey = `${exchangeToUse}:${symbolToUse}`;

      // Use selected broker, or fallback to first available broker for LTP fetch
      let brokerId = selectedBrokerIds[0] || brokerConnectionId;
      if (!brokerId || brokerId === 'all') {
        brokerId = allBrokers && allBrokers.length > 0 ? allBrokers[0].id : null;
      }

      if (!brokerId) {
        console.error('No broker available for LTP fetch');
        return null;
      }

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

        // Only update prices if this is a manual refresh
        if (manualRefresh && ltp) {
          prefillPricesBasedOnLTP(ltp);
        }

        return ltp;
      }
    } catch (err) {
      console.error('Failed to fetch LTP:', err);
    } finally {
      setFetchingLTP(false);
    }
    return null;
  };

  const handleManualLTPRefresh = async () => {
    if (selectedInstrument?.instrument_token) {
      await fetchLTP(selectedInstrument.instrument_token, selectedInstrument.tradingsymbol, selectedInstrument.exchange || exchange, true);
    }
  };

  const selectInstrument = (instrument: any) => {
    setSymbol(instrument.tradingsymbol);
    setSelectedInstrument(instrument);
    const lotSize = parseInt(instrument.lot_size) || 1;
    setQuantity1(lotSize);
    setQuantity2(lotSize);

    // Set tick size from instrument data
    const instrumentTickSize = parseFloat(instrument.tick_size);
    if (!isNaN(instrumentTickSize) && instrumentTickSize > 0) {
      setTickSize(instrumentTickSize);
    } else {
      setTickSize(0.05); // Default fallback
    }

    setShowSuggestions(false);
    setFilteredInstruments([]);

    if (instrument.instrument_token) {
      // Fetch LTP immediately without blocking UI
      fetchLTP(instrument.instrument_token, instrument.tradingsymbol, instrument.exchange).then(ltp => {
        if (ltp) {
          prefillPricesBasedOnLTP(ltp);
        }
      }).catch(console.error);
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

      // Validate and round all prices to proper tick sizes before submission
      const roundedTriggerPrice1 = validatePriceInput(triggerPrice1);
      setTriggerPrice1(roundedTriggerPrice1);

      if (price1) {
        const roundedPrice1 = validatePriceInput(price1);
        setPrice1(roundedPrice1);
      }

      if (gttType === 'two-leg') {
        const roundedTriggerPrice2 = validatePriceInput(triggerPrice2);
        setTriggerPrice2(roundedTriggerPrice2);

        if (price2) {
          const roundedPrice2 = validatePriceInput(price2);
          setPrice2(roundedPrice2);
        }
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
        // Round all prices to proper tick size before submission
        const trigger1 = parseFloat(roundToTickSize(parseFloat(triggerPrice1)));
        const trigger2 = parseFloat(roundToTickSize(parseFloat(triggerPrice2)));

        if (!price1 || !price2) {
          throw new Error('Please enter limit prices for both orders');
        }

        const limitPrice1 = parseFloat(roundToTickSize(parseFloat(price1)));
        const limitPrice2 = parseFloat(roundToTickSize(parseFloat(price2)));

        // Zerodha requires trigger_values in ascending order (lower price first)
        // For BUY: trigger1 (stoploss) is higher, trigger2 (target) is lower
        // For SELL: trigger1 (stoploss) is lower, trigger2 (target) is higher

        if (transactionType === 'BUY') {
          // trigger1 > trigger2, so sortedTriggers = [trigger2, trigger1]
          gttData['condition[trigger_values][0]'] = trigger2;  // lower (target)
          gttData['condition[trigger_values][1]'] = trigger1;  // higher (stoploss)

          // Order 0 corresponds to lower trigger (target - leg 2)
          gttData['orders[0][price]'] = limitPrice2;

          // Order 1 corresponds to higher trigger (stoploss - leg 1)
          gttData['orders[1][exchange]'] = exchange;
          gttData['orders[1][tradingsymbol]'] = symbol;
          gttData['orders[1][transaction_type]'] = transactionType;
          gttData['orders[1][quantity]'] = quantity1;
          gttData['orders[1][order_type]'] = orderType1;
          gttData['orders[1][product]'] = product1;
          gttData['orders[1][price]'] = limitPrice1;
        } else {
          // SELL: trigger1 < trigger2, so sortedTriggers = [trigger1, trigger2]
          gttData['condition[trigger_values][0]'] = trigger1;  // lower (stoploss)
          gttData['condition[trigger_values][1]'] = trigger2;  // higher (target)

          // Order 0 corresponds to lower trigger (stoploss - leg 1)
          gttData['orders[0][price]'] = limitPrice1;

          // Order 1 corresponds to higher trigger (target - leg 2)
          gttData['orders[1][exchange]'] = exchange;
          gttData['orders[1][tradingsymbol]'] = symbol;
          gttData['orders[1][transaction_type]'] = transactionType;
          gttData['orders[1][quantity]'] = quantity2;
          gttData['orders[1][order_type]'] = orderType2;
          gttData['orders[1][product]'] = product2;
          gttData['orders[1][price]'] = limitPrice2;
        }
      } else {
        const trigger1 = parseFloat(roundToTickSize(parseFloat(triggerPrice1)));
        gttData['condition[trigger_values][0]'] = trigger1;
      }

      if (gttType !== 'two-leg') {
        if (!price1) {
          throw new Error('Please enter limit price for order 1');
        }
        const limitPrice1 = parseFloat(roundToTickSize(parseFloat(price1)));
        gttData['orders[0][price]'] = limitPrice1;
      }

      const firstTriggerValue = gttData['condition[trigger_values][0]'];
      let lastPrice = ltp || selectedInstrument.last_price;
      if (!lastPrice || lastPrice === firstTriggerValue) {
        lastPrice = Math.round((firstTriggerValue + 5) * 100) / 100;
      }
      gttData['condition[last_price]'] = lastPrice;

      const brokersToProcess = editingGTT ? [brokerConnectionId] : selectedBrokerIds;

      // Process all brokers in parallel for better performance
      const results = await Promise.all(
        brokersToProcess.map(async (brokerId) => {
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
            console.log(`GTT creation result for broker ${brokerId}:`, result);

            if (result.success) {
              return { brokerId, success: true };
            } else {
              console.error(`Failed for broker ${brokerId}:`, result.error);
              return { brokerId, success: false, error: result.error || 'Unknown error' };
            }
          } catch (err: any) {
            console.error(`Exception for broker ${brokerId}:`, err);
            return { brokerId, success: false, error: err.message };
          }
        })
      );

      console.log('All GTT creation results:', results);

      const failedCount = results.filter(r => !r.success).length;
      if (failedCount === results.length) {
        const errorDetails = results.map(r => r.error).filter(Boolean).join('; ');
        throw new Error(`Failed to create GTT orders for all accounts. Errors: ${errorDetails}`);
      }

      if (failedCount > 0) {
        const failedErrors = results.filter(r => !r.success).map(r => r.error).join('; ');
        setError(`Created GTT for ${results.length - failedCount} of ${results.length} accounts. Failed accounts: ${failedErrors}`);
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {editingGTT ? 'Edit GTT Order' : 'New GTT Order'}
            </h2>
            {selectedInstrument && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-medium text-gray-900">{symbol}</span>
                <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{exchange}</span>
                {currentLTP && (
                  <>
                    <span className="text-sm font-semibold text-gray-700">LTP: {currentLTP.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={handleManualLTPRefresh}
                      disabled={fetchingLTP}
                      className="p-1 hover:bg-gray-100 rounded transition disabled:opacity-50"
                      title="Refresh LTP"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${fetchingLTP ? 'animate-spin' : ''}`} />
                    </button>
                  </>
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

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Select Accounts ({selectedBrokerIds.length} selected)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedBrokerIds.length === allBrokers.length) {
                      setSelectedBrokerIds([]);
                    } else {
                      setSelectedBrokerIds(allBrokers.map(b => b.id));
                    }
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  {selectedBrokerIds.length === allBrokers.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {allBrokers.map((broker) => {
                  const isSelected = selectedBrokerIds.includes(broker.id);
                  return (
                    <label
                      key={broker.id}
                      className={`flex items-center gap-2 p-2 border-2 rounded cursor-pointer transition ${
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
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900 truncate">
                          {broker.account_holder_name || broker.account_name || 'Account'}
                          {broker.client_id && (
                            <span className="text-gray-600"> ({broker.client_id})</span>
                          )}
                        </div>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Transaction type</label>
              <div className="flex gap-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="BUY"
                    checked={transactionType === 'BUY'}
                    onChange={(e) => setTransactionType(e.target.value as 'BUY')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1.5 text-sm text-gray-900">Buy</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="SELL"
                    checked={transactionType === 'SELL'}
                    onChange={(e) => setTransactionType(e.target.value as 'SELL')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1.5 text-sm text-gray-900">Sell</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Trigger type</label>
              <div className="flex gap-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="single"
                    checked={gttType === 'single'}
                    onChange={(e) => setGttType(e.target.value as 'single')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1.5 text-sm text-gray-900">Single</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="two-leg"
                    checked={gttType === 'two-leg'}
                    onChange={(e) => setGttType(e.target.value as 'two-leg')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1.5 text-sm text-gray-900">OCO</span>
                </label>
              </div>
              {gttType === 'two-leg' && (
                <div className="mt-1.5 text-xs text-gray-600 leading-relaxed">
                  One Cancels Other: Either the stoploss or the target order is placed when the Last Traded Price (LTP) crosses the respective trigger. Can be used to set target and stoploss for a position/holding.
                </div>
              )}
            </div>
          </div>

          {/* Stoploss Leg */}
          <div className="bg-gray-50 border border-gray-200 rounded p-3">
            <div className="mb-3">
              <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-semibold rounded">
                {gttType === 'two-leg' ? 'Stoploss' : 'Order'}
              </span>
            </div>

            <div className="flex items-center gap-4 mb-3">
              <div className="flex gap-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={product1 === 'NRML'}
                    onChange={() => setProduct1('NRML')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1.5 text-sm text-gray-900">NRML</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={product1 === 'MIS'}
                    onChange={() => setProduct1('MIS')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1.5 text-sm text-gray-900">MIS</span>
                </label>
              </div>
              <div className="ml-auto flex gap-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    checked={orderType1 === 'LIMIT'}
                    onChange={() => setOrderType1('LIMIT')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="ml-1.5 text-sm text-gray-900">LIMIT</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-start">
              {/* Trigger Price */}
              <div>
                <label className="block text-sm text-gray-700 mb-1.5">Trigger price</label>
                <input
                  type="number"
                  step="0.05"
                  value={triggerPrice1}
                  onChange={(e) => {
                    const value = e.target.value;
                    setTriggerPrice1(value);
                    if (currentLTP && value) {
                      const percent = ((parseFloat(value) - currentLTP) / currentLTP * 100).toFixed(2);
                      setTriggerPercent1(percent);
                    }
                  }}
                  onBlur={(e) => {
                    const value = e.target.value;
                    if (value && value !== '') {
                      const rounded = validatePriceInput(value);
                      setTriggerPrice1(rounded);
                      if (currentLTP) {
                        const percent = ((parseFloat(rounded) - currentLTP) / currentLTP * 100).toFixed(2);
                        setTriggerPercent1(percent);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="0.00"
                  required
                />
                {currentLTP && (
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      step="0.01"
                      value={triggerPercent1}
                      onChange={(e) => {
                        setTriggerPercent1(e.target.value);
                        if (currentLTP && e.target.value) {
                          const price = roundToTickSize(currentLTP * (1 + parseFloat(e.target.value) / 100));
                          setTriggerPrice1(price);
                        }
                      }}
                      className="w-16 px-2 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="0"
                    />
                    <span className="text-xs text-gray-500">% of LTP</span>
                  </div>
                )}
              </div>

              {/* Arrow */}
              <div className="flex items-center pt-7 text-gray-400 text-sm">
                →
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm text-gray-700 mb-1.5">Qty.</label>
                <input
                  type="number"
                  value={quantity1}
                  onChange={(e) => setQuantity1(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  min={selectedInstrument?.lot_size || 1}
                  step={selectedInstrument?.lot_size || 1}
                  required
                />
              </div>

              {/* Arrow */}
              <div className="flex items-center pt-7 text-gray-400 text-sm">
                →
              </div>

              {/* Price */}
              <div>
                <label className="block text-sm text-gray-700 mb-1.5">Price</label>
                <input
                  type="number"
                  step="0.05"
                  value={price1}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPrice1(value);
                    if (currentLTP && value) {
                      const percent = ((parseFloat(value) - currentLTP) / currentLTP * 100).toFixed(2);
                      setPricePercent1(percent);
                    }
                  }}
                  onBlur={(e) => {
                    const value = e.target.value;
                    if (value && value !== '') {
                      const rounded = validatePriceInput(value);
                      setPrice1(rounded);
                      if (currentLTP) {
                        const percent = ((parseFloat(rounded) - currentLTP) / currentLTP * 100).toFixed(2);
                        setPricePercent1(percent);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="0.00"
                  required
                />
                {currentLTP && (
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      step="0.01"
                      value={pricePercent1}
                      onChange={(e) => {
                        setPricePercent1(e.target.value);
                        if (currentLTP && e.target.value) {
                          const price = roundToTickSize(currentLTP * (1 + parseFloat(e.target.value) / 100));
                          setPrice1(price);
                        }
                      }}
                      className="w-16 px-2 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="0"
                    />
                    <span className="text-xs text-gray-500">% of LTP</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Target Leg (Only for OCO) */}
          {gttType === 'two-leg' && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3">
              <div className="mb-3">
                <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-semibold rounded">
                  Target
                </span>
              </div>

              <div className="flex items-center gap-4 mb-3">
                <div className="flex gap-3">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      checked={product2 === 'NRML'}
                      onChange={() => setProduct2('NRML')}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-1.5 text-sm text-gray-900">NRML</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      checked={product2 === 'MIS'}
                      onChange={() => setProduct2('MIS')}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-1.5 text-sm text-gray-900">MIS</span>
                  </label>
                </div>
                <div className="ml-auto flex gap-3">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      checked={orderType2 === 'LIMIT'}
                      onChange={() => setOrderType2('LIMIT')}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-1.5 text-sm text-gray-900">LIMIT</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-start">
                {/* Trigger Price */}
                <div>
                  <label className="block text-sm text-gray-700 mb-1.5">Trigger price</label>
                  <input
                    type="number"
                    step="0.05"
                    value={triggerPrice2}
                    onChange={(e) => {
                      const value = e.target.value;
                      setTriggerPrice2(value);
                      if (currentLTP && value) {
                        const percent = ((parseFloat(value) - currentLTP) / currentLTP * 100).toFixed(2);
                        setTriggerPercent2(percent);
                      }
                    }}
                    onBlur={(e) => {
                      const value = e.target.value;
                      if (value && value !== '') {
                        const rounded = validatePriceInput(value);
                        setTriggerPrice2(rounded);
                        if (currentLTP) {
                          const percent = ((parseFloat(rounded) - currentLTP) / currentLTP * 100).toFixed(2);
                          setTriggerPercent2(percent);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="0.00"
                    required
                  />
                  {currentLTP && (
                    <div className="flex items-center gap-1 mt-1">
                      <input
                        type="number"
                        step="0.01"
                        value={triggerPercent2}
                        onChange={(e) => {
                          setTriggerPercent2(e.target.value);
                          if (currentLTP && e.target.value) {
                            const price = roundToTickSize(currentLTP * (1 + parseFloat(e.target.value) / 100));
                            setTriggerPrice2(price);
                          }
                        }}
                        className="w-16 px-2 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        placeholder="0"
                      />
                      <span className="text-xs text-gray-500">% of LTP</span>
                    </div>
                  )}
                </div>

                {/* Arrow */}
                <div className="flex items-center pt-7 text-gray-400 text-sm">
                  →
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-sm text-gray-700 mb-1.5">Qty.</label>
                  <input
                    type="number"
                    value={quantity2}
                    onChange={(e) => setQuantity2(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    min={selectedInstrument?.lot_size || 1}
                    step={selectedInstrument?.lot_size || 1}
                    required
                  />
                </div>

                {/* Arrow */}
                <div className="flex items-center pt-7 text-gray-400 text-sm">
                  →
                </div>

                {/* Price */}
                <div>
                  <label className="block text-sm text-gray-700 mb-1.5">Price</label>
                  <input
                    type="number"
                    step="0.05"
                    value={price2}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPrice2(value);
                      if (currentLTP && value) {
                        const percent = ((parseFloat(value) - currentLTP) / currentLTP * 100).toFixed(2);
                        setPricePercent2(percent);
                      }
                    }}
                    onBlur={(e) => {
                      const value = e.target.value;
                      if (value && value !== '') {
                        const rounded = validatePriceInput(value);
                        setPrice2(rounded);
                        if (currentLTP) {
                          const percent = ((parseFloat(rounded) - currentLTP) / currentLTP * 100).toFixed(2);
                          setPricePercent2(percent);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="0.00"
                    required
                  />
                  {currentLTP && (
                    <div className="flex items-center gap-1 mt-1">
                      <input
                        type="number"
                        step="0.01"
                        value={pricePercent2}
                        onChange={(e) => {
                          setPricePercent2(e.target.value);
                          if (currentLTP && e.target.value) {
                            const price = roundToTickSize(currentLTP * (1 + parseFloat(e.target.value) / 100));
                            setPrice2(price);
                          }
                        }}
                        className="w-16 px-2 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        placeholder="0"
                      />
                      <span className="text-xs text-gray-500">% of LTP</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <div className="text-xs text-gray-600">
              By {editingGTT ? 'modifying' : 'creating'}, I agree that trigger executions are not guaranteed.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 border border-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !selectedInstrument}
                className="px-5 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
