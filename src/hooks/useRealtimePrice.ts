import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface PriceUpdate {
  symbol: string;
  price: number;
  exchange: string;
}

interface RealtimePriceConfig {
  symbols: Array<{ symbol: string; exchange: string; instrument_token?: number }>;
  brokerId?: string;
  enabled?: boolean;
  interval?: number;
}

export function useRealtimePrice({ symbols, brokerId, enabled = true, interval = 3000 }: RealtimePriceConfig) {
  const { session } = useAuth();
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);

  const fetchPrices = useCallback(async () => {
    if (!enabled || !brokerId || symbols.length === 0 || !session?.access_token) {
      return;
    }

    setLoading(true);
    try {
      const symbolsParam = symbols
        .map(s => `${s.exchange}:${s.symbol}`)
        .join(',');

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-ltp?broker_id=${brokerId}&symbols=${encodeURIComponent(symbolsParam)}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch LTP:', response.status);
        return;
      }

      const result = await response.json();

      if (result.success && result.data) {
        const newPrices = new Map<string, number>();

        Object.entries(result.data).forEach(([key, value]: [string, any]) => {
          const symbol = key.split(':')[1];
          if (value?.last_price) {
            newPrices.set(symbol, value.last_price);
          }
        });

        setPrices(newPrices);
      }
    } catch (error) {
      console.error('Error fetching real-time prices:', error);
    } finally {
      setLoading(false);
    }
  }, [symbols, brokerId, enabled, session]);

  useEffect(() => {
    if (!enabled) return;

    fetchPrices();

    const intervalId = setInterval(fetchPrices, interval);

    return () => clearInterval(intervalId);
  }, [fetchPrices, enabled, interval]);

  const getPrice = useCallback((symbol: string): number | undefined => {
    return prices.get(symbol);
  }, [prices]);

  return {
    prices,
    getPrice,
    loading,
    refresh: fetchPrices,
  };
}
