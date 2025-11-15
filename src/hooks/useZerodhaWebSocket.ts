import { useEffect, useRef, useState, useCallback } from 'react';
import { ZerodhaWebSocket, Tick } from '../lib/zerodhaWebSocket';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface WebSocketState {
  isConnected: boolean;
  ticks: Map<number, Tick>;
  subscribedTokens: number[];
  error: string | null;
}

export function useZerodhaWebSocket(brokerId?: string) {
  const { user } = useAuth();
  const wsRef = useRef<ZerodhaWebSocket | null>(null);
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    ticks: new Map(),
    subscribedTokens: [],
    error: null,
  });

  const updateTick = useCallback((token: number, tick: Tick) => {
    setState(prev => {
      const newTicks = new Map(prev.ticks);
      newTicks.set(token, tick);
      return { ...prev, ticks: newTicks };
    });
  }, []);

  const connect = useCallback(async () => {
    if (!user || !brokerId) return;

    try {
      const { data: broker, error } = await supabase
        .from('broker_connections')
        .select('api_key, access_token')
        .eq('id', brokerId)
        .eq('user_id', user.id)
        .single();

      if (error || !broker) {
        setState(prev => ({ ...prev, error: 'Broker connection not found' }));
        return;
      }

      if (!broker.access_token) {
        setState(prev => ({ ...prev, error: 'Broker not authorized' }));
        return;
      }

      if (wsRef.current) {
        wsRef.current.disconnect();
      }

      const ws = new ZerodhaWebSocket(broker.api_key, broker.access_token);

      ws.onConnect(() => {
        setState(prev => ({ ...prev, isConnected: true, error: null }));
      });

      ws.onDisconnect(() => {
        setState(prev => ({ ...prev, isConnected: false }));
      });

      ws.onError((error) => {
        setState(prev => ({ ...prev, error: error.message }));
      });

      ws.onTick((ticks) => {
        ticks.forEach(tick => {
          updateTick(tick.instrument_token, tick);
        });
      });

      wsRef.current = ws;
      ws.connect();
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Connection failed'
      }));
    }
  }, [user, brokerId, updateTick]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
      setState({
        isConnected: false,
        ticks: new Map(),
        subscribedTokens: [],
        error: null,
      });
    }
  }, []);

  const subscribe = useCallback((tokens: number[], mode: 'ltp' | 'quote' | 'full' = 'full') => {
    if (wsRef.current && wsRef.current.isConnected()) {
      wsRef.current.subscribe(tokens);
      wsRef.current.setMode(mode, tokens);
      setState(prev => ({
        ...prev,
        subscribedTokens: [...new Set([...prev.subscribedTokens, ...tokens])],
      }));
    }
  }, []);

  const unsubscribe = useCallback((tokens: number[]) => {
    if (wsRef.current) {
      wsRef.current.unsubscribe(tokens);
      setState(prev => ({
        ...prev,
        subscribedTokens: prev.subscribedTokens.filter(t => !tokens.includes(t)),
        ticks: new Map(Array.from(prev.ticks).filter(([token]) => !tokens.includes(token))),
      }));
    }
  }, []);

  const getTick = useCallback((token: number): Tick | undefined => {
    return state.ticks.get(token);
  }, [state.ticks]);

  const getLTP = useCallback((token: number): number | null => {
    const tick = state.ticks.get(token);
    return tick?.last_price ?? null;
  }, [state.ticks]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect();
      }
    };
  }, []);

  return {
    isConnected: state.isConnected,
    subscribedTokens: state.subscribedTokens,
    error: state.error,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    getTick,
    getLTP,
    ticks: state.ticks,
  };
}
