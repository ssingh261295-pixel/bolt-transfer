import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface PlaceOrderParams {
  broker_connection_id: string;
  symbol: string;
  exchange: string;
  transaction_type: 'BUY' | 'SELL';
  quantity: number;
  order_type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  product: 'MIS' | 'CNC' | 'NRML';
  price?: number;
  trigger_price?: number;
  validity?: 'DAY' | 'IOC';
  strategy_id?: string;
}

export function useZerodha() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeOrder = async (params: PlaceOrderParams) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession?.access_token) {
        throw new Error('Session expired. Please sign in again.');
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders/place`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${freshSession.access_token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to place order');
      }

      return { success: true, orderId: data.order_id };
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to place order';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const syncOrders = async (brokerId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession?.access_token) {
        throw new Error('Session expired. Please sign in again.');
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-orders/sync?broker_id=${brokerId}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${freshSession.access_token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to sync orders');
      }

      return { success: true, synced: data.synced };
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to sync orders';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const syncPositions = async (brokerId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession?.access_token) {
        throw new Error('Session expired. Please sign in again.');
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-positions/sync?broker_id=${brokerId}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${freshSession.access_token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to sync positions');
      }

      return { success: true, synced: data.synced };
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to sync positions';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const getHoldings = async (brokerId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession?.access_token) {
        throw new Error('Session expired. Please sign in again.');
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-positions/holdings?broker_id=${brokerId}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${freshSession.access_token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to get holdings');
      }

      return { success: true, holdings: data.holdings };
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to get holdings';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  return {
    placeOrder,
    syncOrders,
    syncPositions,
    getHoldings,
    loading,
    error,
  };
}
