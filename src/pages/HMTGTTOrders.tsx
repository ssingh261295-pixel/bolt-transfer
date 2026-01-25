import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, CreditCard as Edit2, Trash2, ArrowUpDown, Activity, Power, AlertCircle, CheckCircle, MoreVertical, ArrowRightLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { GTTModal } from '../components/orders/GTTModal';
import { useZerodhaWebSocket } from '../hooks/useZerodhaWebSocket';
import { MultiSelectFilter } from '../components/common/MultiSelectFilter';
import { HMTGTTRow } from '../components/hmt-gtt/HMTGTTRow';

type SortField = 'symbol' | 'trigger_price' | 'created_at' | 'status';
type SortDirection = 'asc' | 'desc';

export function HMTGTTOrders() {
  const { user, session } = useAuth();
  const [hmtGttOrders, setHmtGttOrders] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>('all');
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);
  const { isConnected, connect, disconnect, subscribe, getLTP } = useZerodhaWebSocket(selectedBrokerId !== 'all' ? selectedBrokerId : brokers[0]?.id);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGTT, setEditingGTT] = useState<any>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [filterStateBeforeEdit, setFilterStateBeforeEdit] = useState<{ brokerId: string; instruments: string[] } | null>(null);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteType, setDeleteType] = useState<'bulk' | 'single'>('bulk');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [loadingEngine, setLoadingEngine] = useState(false);
  const [convertMessage, setConvertMessage] = useState('');
  const [convertError, setConvertError] = useState('');
  const [converting, setConverting] = useState(false);
  const [openMobileMenu, setOpenMobileMenu] = useState<string | null>(null);
  const [menuOpenUpward, setMenuOpenUpward] = useState(false);

  useEffect(() => {
    if (user) {
      loadBrokers();
      loadPositions();
      loadEngineStatus();
    }
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadEngineStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (brokers.length > 0 && (!selectedBrokerId || selectedBrokerId === '')) {
      setSelectedBrokerId('all');
    }
  }, [brokers]);

  useEffect(() => {
    if (selectedBrokerId && brokers.length > 0) {
      loadHMTGTTOrders();
    }
  }, [selectedBrokerId, brokers]);

  useEffect(() => {
    const brokerId = selectedBrokerId !== 'all' ? selectedBrokerId : brokers[0]?.id;
    if (brokerId) {
      connect();
    }
    return () => disconnect();
  }, [selectedBrokerId, brokers, connect, disconnect]);

  useEffect(() => {
    if (isConnected && hmtGttOrders.length > 0) {
      const tokens = hmtGttOrders
        .map(order => order.instrument_token)
        .filter(Boolean);
      if (tokens.length > 0) {
        subscribe(tokens, 'full');
      }
    }
  }, [isConnected, hmtGttOrders, subscribe]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('hmt_gtt_changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'hmt_gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, async (payload) => {
        const newOrder = payload.new as any;
        const broker = brokers.find(b => b.id === newOrder.broker_connection_id);

        if (broker) {
          newOrder.broker_connections = {
            id: broker.id,
            account_name: broker.account_name,
            account_holder_name: broker.account_holder_name,
            client_id: broker.client_id
          };
          setHmtGttOrders(prev => sortHMTGTTOrders([...prev, newOrder]));
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'hmt_gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const updatedFields = payload.new as any;
        setHmtGttOrders(prev => {
          const updated = prev.map(order => {
            if (order.id === updatedFields.id) {
              return {
                ...order,
                ...updatedFields,
                broker_connections: order.broker_connections
              };
            }
            return order;
          });
          return sortHMTGTTOrders(updated);
        });
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'hmt_gtt_orders',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const deletedId = payload.old.id;
        setHmtGttOrders(prev => prev.filter(order => order.id !== deletedId));
        setSelectedOrders(prev => {
          const newSet = new Set(prev);
          newSet.delete(deletedId);
          return newSet;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, sortField, sortDirection, brokers]);

  useEffect(() => {
    if (!user?.id) return;

    const positionsChannel = supabase
      .channel('positions_changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'positions',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const newPosition = payload.new as any;
        setPositions(prev => {
          const exists = prev.find(p => p.id === newPosition.id);
          if (exists) return prev;
          return [...prev, newPosition];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'positions',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const updatedPosition = payload.new as any;
        setPositions(prev => {
          if (updatedPosition.quantity === 0) {
            return prev.filter(p => p.id !== updatedPosition.id);
          }
          return prev.map(p => p.id === updatedPosition.id ? updatedPosition : p);
        });
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'positions',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const deletedId = payload.old.id;
        setPositions(prev => prev.filter(p => p.id !== deletedId));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(positionsChannel);
    };
  }, [user?.id]);

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data && data.length > 0) {
      // Filter out expired tokens
      const now = new Date();
      const activeBrokers = data.filter(broker => {
        if (!broker.token_expires_at) return true;
        const expiryDate = new Date(broker.token_expires_at);
        return expiryDate > now;
      });

      // Mark expired brokers as inactive
      const expiredBrokers = data.filter(broker => {
        if (!broker.token_expires_at) return false;
        const expiryDate = new Date(broker.token_expires_at);
        return expiryDate <= now;
      });

      if (expiredBrokers.length > 0) {
        expiredBrokers.forEach(async (broker) => {
          await supabase
            .from('broker_connections')
            .update({ is_active: false })
            .eq('id', broker.id);
        });
      }

      setBrokers(activeBrokers);
    }
  };

  const loadPositions = async () => {
    const { data } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user?.id)
      .neq('quantity', 0);

    if (data) {
      setPositions(data);
    }
  };

  const getPositionForGTT = useCallback((gtt: any) => {
    return positions.find(pos =>
      pos.symbol === gtt.trading_symbol &&
      pos.exchange === gtt.exchange &&
      pos.broker_connection_id === gtt.broker_connection_id
    );
  }, [positions]);

  const loadHMTGTTOrders = async (silent = false) => {
    if (!selectedBrokerId || brokers.length === 0) return;

    if (!silent) {
      setLoading(true);
    }
    try {
      let query = supabase
        .from('hmt_gtt_orders')
        .select(`
          *,
          broker_connections!inner (
            id,
            account_name,
            account_holder_name,
            client_id
          )
        `)
        .eq('user_id', user?.id)
        .in('status', ['active', 'triggered']);

      if (selectedBrokerId !== 'all') {
        query = query.eq('broker_connection_id', selectedBrokerId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        setHmtGttOrders(sortHMTGTTOrders(data));
      }
    } catch (err) {
      console.error('Failed to load HMT GTT orders:', err);
      setHmtGttOrders([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const sortHMTGTTOrders = (data: any[]) => {
    return [...data].sort((a, b) => {
      const statusPriority = { 'active': 0, 'triggered': 1 };
      const aStatus = statusPriority[a.status as keyof typeof statusPriority] ?? 2;
      const bStatus = statusPriority[b.status as keyof typeof statusPriority] ?? 2;

      if (aStatus !== bStatus) {
        return aStatus - bStatus;
      }

      let aVal, bVal;

      switch (sortField) {
        case 'symbol':
          aVal = a.trading_symbol || '';
          bVal = b.trading_symbol || '';
          break;
        case 'trigger_price':
          aVal = a.trigger_price_1 || 0;
          bVal = b.trigger_price_1 || 0;
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'created_at':
        default:
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          break;
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  useEffect(() => {
    if (hmtGttOrders.length > 0) {
      setHmtGttOrders(sortHMTGTTOrders(hmtGttOrders));
    }
  }, [sortField, sortDirection]);

  const toggleOrderSelection = useCallback((orderId: string) => {
    setSelectedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  }, []);

  const uniqueInstruments = useMemo(() =>
    Array.from(new Set(hmtGttOrders.map(order => order.trading_symbol).filter(Boolean))).sort(),
    [hmtGttOrders]
  );

  const filteredHmtGttOrders = useMemo(() =>
    selectedInstruments.length === 0
      ? hmtGttOrders
      : hmtGttOrders.filter(order => selectedInstruments.includes(order.trading_symbol)),
    [hmtGttOrders, selectedInstruments]
  );

  useEffect(() => {
    if (selectedInstruments.length === 0 && selectedOrders.size > 0) {
      setSelectedOrders(new Set());
      return;
    }

    if (selectedOrders.size > 0) {
      const filteredOrderIds = new Set(filteredHmtGttOrders.map(order => order.id));
      const updatedSelectedOrders = new Set<string>();

      selectedOrders.forEach(orderId => {
        if (filteredOrderIds.has(orderId)) {
          updatedSelectedOrders.add(orderId);
        }
      });

      if (updatedSelectedOrders.size !== selectedOrders.size) {
        setSelectedOrders(updatedSelectedOrders);
      }
    }
  }, [filteredHmtGttOrders, selectedInstruments]);

  const toggleSelectAll = () => {
    if (selectedOrders.size === filteredHmtGttOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredHmtGttOrders.map(order => order.id)));
    }
  };

  const toggleMobileMenu = (gttId: string, event: React.MouseEvent) => {
    if (openMobileMenu === gttId) {
      setOpenMobileMenu(null);
      setMenuOpenUpward(false);
    } else {
      setOpenMobileMenu(gttId);

      const buttonElement = event.currentTarget as HTMLElement;
      const rect = buttonElement.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuHeight = 180;

      setMenuOpenUpward(spaceBelow < menuHeight);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedOrders.size === 0) return;
    setDeleteType('bulk');
    setShowDeleteConfirm(true);
  };

  const confirmBulkDelete = async () => {
    setShowDeleteConfirm(false);
    setDeleting(true);

    const deletePromises = Array.from(selectedOrders).map(async (orderId) => {
      try {
        const { error } = await supabase
          .from('hmt_gtt_orders')
          .delete()
          .eq('id', orderId)
          .eq('user_id', user?.id);

        if (error) throw error;
        return { success: true, orderId };
      } catch (err: any) {
        console.error(`Error deleting HMT GTT ${orderId}:`, err);
        return { success: false, orderId, error: err.message || 'Unknown error' };
      }
    });

    const results = await Promise.all(deletePromises);
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    if (successCount > 0) {
      setSelectedOrders(new Set());
      setDeleteMessage(`Successfully deleted ${successCount} HMT GTT order(s).${failedCount > 0 ? ` ${failedCount} failed.` : ''}`);
      setDeleteError('');
      setTimeout(() => setDeleteMessage(''), 5000);
      loadHMTGTTOrders(true);
    } else {
      const firstError = results.find(r => !r.success)?.error || 'Unknown error';
      setDeleteError(`Failed to delete HMT GTT orders: ${firstError}`);
      setTimeout(() => setDeleteError(''), 5000);
    }
    setDeleting(false);
  };

  const handleDelete = useCallback((orderId: string) => {
    setDeleteType('single');
    setDeleteTarget(orderId);
    setShowDeleteConfirm(true);
  }, []);

  const handleEdit = useCallback((gtt: any) => {
    setFilterStateBeforeEdit({
      brokerId: selectedBrokerId,
      instruments: selectedInstruments
    });
    setEditingGTT(gtt);
    setShowCreateModal(true);
  }, [selectedBrokerId, selectedInstruments]);

  const handleConvertToGTT = useCallback(async (hmtGtt: any) => {
    if (!session?.access_token) {
      setConvertError('Not authenticated');
      setTimeout(() => setConvertError(''), 5000);
      return;
    }

    if (hmtGtt.status !== 'active') {
      setConvertError('Can only convert active HMT GTT orders');
      setTimeout(() => setConvertError(''), 5000);
      return;
    }

    setConverting(true);
    setConvertError('');
    setConvertMessage('');

    try {
      const isOCO = hmtGtt.condition_type === 'two-leg';

      // Fetch the current LTP (Last Traded Price) for the instrument
      const ltpUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-ltp?broker_id=${hmtGtt.broker_connection_id}`;
      const ltpResponse = await fetch(ltpUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruments: [`${hmtGtt.exchange}:${hmtGtt.trading_symbol}`]
        })
      });

      const ltpResult = await ltpResponse.json();

      let lastPrice: number;
      const instrumentKey = `${hmtGtt.exchange}:${hmtGtt.trading_symbol}`;

      if (ltpResult.success && ltpResult.data && ltpResult.data[instrumentKey]) {
        lastPrice = ltpResult.data[instrumentKey].last_price;
      } else {
        // Fallback: Calculate last_price to be at least 0.5% away from trigger prices
        const triggerPrice1 = parseFloat(hmtGtt.trigger_price_1);
        const triggerPrice2 = isOCO ? parseFloat(hmtGtt.trigger_price_2) : null;

        if (isOCO && triggerPrice2) {
          // For two-leg, use midpoint between the two triggers
          lastPrice = (triggerPrice1 + triggerPrice2) / 2;
        } else {
          // For single, place last_price 1% away from trigger
          lastPrice = triggerPrice1 * 0.99; // 1% below trigger
        }
      }

      // Ensure last_price is at least 0.5% different from all trigger prices
      const triggerPrice1 = parseFloat(hmtGtt.trigger_price_1);
      const diff1Percent = Math.abs((lastPrice - triggerPrice1) / triggerPrice1) * 100;

      if (diff1Percent < 0.5) {
        // Adjust last_price to be 0.5% away
        lastPrice = triggerPrice1 * (triggerPrice1 > lastPrice ? 0.995 : 1.005);
      }

      if (isOCO) {
        const triggerPrice2 = parseFloat(hmtGtt.trigger_price_2);
        const diff2Percent = Math.abs((lastPrice - triggerPrice2) / triggerPrice2) * 100;

        if (diff2Percent < 0.5) {
          // For two-leg, position last_price between the two triggers
          lastPrice = (triggerPrice1 + triggerPrice2) / 2;
        }
      }

      // Build payload in the format expected by zerodha-gtt edge function
      const gttPayload: any = {
        type: isOCO ? 'two-leg' : 'single',
        'condition[exchange]': hmtGtt.exchange,
        'condition[tradingsymbol]': hmtGtt.trading_symbol,
        'condition[instrument_token]': hmtGtt.instrument_token,
        'condition[trigger_values][0]': triggerPrice1,
        'condition[last_price]': lastPrice,
      };

      if (isOCO) {
        gttPayload['condition[trigger_values][1]'] = parseFloat(hmtGtt.trigger_price_2);

        // First order
        gttPayload['orders[0][transaction_type]'] = hmtGtt.transaction_type;
        gttPayload['orders[0][quantity]'] = parseInt(hmtGtt.quantity_1);
        gttPayload['orders[0][price]'] = parseFloat(hmtGtt.order_price_1) || 0;
        gttPayload['orders[0][order_type]'] = hmtGtt.order_type_1 || 'LIMIT';
        gttPayload['orders[0][product]'] = hmtGtt.product_type_1 || 'CNC';

        // Second order
        gttPayload['orders[1][transaction_type]'] = hmtGtt.transaction_type;
        gttPayload['orders[1][quantity]'] = parseInt(hmtGtt.quantity_2 || hmtGtt.quantity_1);
        gttPayload['orders[1][price]'] = parseFloat(hmtGtt.order_price_2) || 0;
        gttPayload['orders[1][order_type]'] = hmtGtt.order_type_2 || 'LIMIT';
        gttPayload['orders[1][product]'] = hmtGtt.product_type_2 || 'CNC';
      } else {
        gttPayload['orders[0][transaction_type]'] = hmtGtt.transaction_type;
        gttPayload['orders[0][quantity]'] = parseInt(hmtGtt.quantity_1);
        gttPayload['orders[0][price]'] = parseFloat(hmtGtt.order_price_1) || 0;
        gttPayload['orders[0][order_type]'] = hmtGtt.order_type_1 || 'LIMIT';
        gttPayload['orders[0][product]'] = hmtGtt.product_type_1 || 'CNC';
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${hmtGtt.broker_connection_id}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gttPayload)
      });

      const result = await response.json();

      if (result.success) {
        const { error: deleteError } = await supabase
          .from('hmt_gtt_orders')
          .delete()
          .eq('id', hmtGtt.id)
          .eq('user_id', user?.id);

        if (deleteError) {
          setConvertError('GTT created but failed to delete HMT GTT: ' + deleteError.message);
          setTimeout(() => setConvertError(''), 5000);
        } else {
          setConvertMessage('Successfully converted HMT GTT to regular GTT');
          setTimeout(() => setConvertMessage(''), 5000);
        }
        loadHMTGTTOrders(true);
      } else {
        setConvertError('Failed to create GTT: ' + (result.error || 'Unknown error'));
        setTimeout(() => setConvertError(''), 5000);
      }
    } catch (err: any) {
      console.error('Error converting to GTT:', err);
      setConvertError('Failed to convert: ' + err.message);
      setTimeout(() => setConvertError(''), 5000);
    } finally {
      setConverting(false);
    }
  }, [session, user, loadHMTGTTOrders]);

  const handleBulkConvertToGTT = useCallback(async () => {
    if (selectedOrders.size === 0) return;

    if (!session?.access_token) {
      setConvertError('Not authenticated');
      setTimeout(() => setConvertError(''), 5000);
      return;
    }

    setConverting(true);
    setConvertError('');
    setConvertMessage('');

    const convertPromises = Array.from(selectedOrders).map(async (orderId) => {
      const hmtGtt = hmtGttOrders.find(o => o.id === orderId);
      if (!hmtGtt) return { success: false, error: 'Order not found', orderId };

      if (hmtGtt.status !== 'active') {
        return { success: false, error: 'Only active orders can be converted', orderId };
      }

      try {
        const isOCO = hmtGtt.condition_type === 'two-leg';

        // Fetch the current LTP (Last Traded Price) for the instrument
        const ltpUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-ltp?broker_id=${hmtGtt.broker_connection_id}`;
        const ltpResponse = await fetch(ltpUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instruments: [`${hmtGtt.exchange}:${hmtGtt.trading_symbol}`]
          })
        });

        const ltpResult = await ltpResponse.json();

        let lastPrice: number;
        const instrumentKey = `${hmtGtt.exchange}:${hmtGtt.trading_symbol}`;

        if (ltpResult.success && ltpResult.data && ltpResult.data[instrumentKey]) {
          lastPrice = ltpResult.data[instrumentKey].last_price;
        } else {
          // Fallback: Calculate last_price to be at least 0.5% away from trigger prices
          const triggerPrice1 = parseFloat(hmtGtt.trigger_price_1);
          const triggerPrice2 = isOCO ? parseFloat(hmtGtt.trigger_price_2) : null;

          if (isOCO && triggerPrice2) {
            // For two-leg, use midpoint between the two triggers
            lastPrice = (triggerPrice1 + triggerPrice2) / 2;
          } else {
            // For single, place last_price 1% away from trigger
            lastPrice = triggerPrice1 * 0.99; // 1% below trigger
          }
        }

        // Ensure last_price is at least 0.5% different from all trigger prices
        const triggerPrice1 = parseFloat(hmtGtt.trigger_price_1);
        const diff1Percent = Math.abs((lastPrice - triggerPrice1) / triggerPrice1) * 100;

        if (diff1Percent < 0.5) {
          // Adjust last_price to be 0.5% away
          lastPrice = triggerPrice1 * (triggerPrice1 > lastPrice ? 0.995 : 1.005);
        }

        if (isOCO) {
          const triggerPrice2 = parseFloat(hmtGtt.trigger_price_2);
          const diff2Percent = Math.abs((lastPrice - triggerPrice2) / triggerPrice2) * 100;

          if (diff2Percent < 0.5) {
            // For two-leg, position last_price between the two triggers
            lastPrice = (triggerPrice1 + triggerPrice2) / 2;
          }
        }

        // Build payload in the format expected by zerodha-gtt edge function
        const gttPayload: any = {
          type: isOCO ? 'two-leg' : 'single',
          'condition[exchange]': hmtGtt.exchange,
          'condition[tradingsymbol]': hmtGtt.trading_symbol,
          'condition[instrument_token]': hmtGtt.instrument_token,
          'condition[trigger_values][0]': triggerPrice1,
          'condition[last_price]': lastPrice,
        };

        if (isOCO) {
          gttPayload['condition[trigger_values][1]'] = parseFloat(hmtGtt.trigger_price_2);

          // First order
          gttPayload['orders[0][transaction_type]'] = hmtGtt.transaction_type;
          gttPayload['orders[0][quantity]'] = parseInt(hmtGtt.quantity_1);
          gttPayload['orders[0][price]'] = parseFloat(hmtGtt.order_price_1) || 0;
          gttPayload['orders[0][order_type]'] = hmtGtt.order_type_1 || 'LIMIT';
          gttPayload['orders[0][product]'] = hmtGtt.product_type_1 || 'CNC';

          // Second order
          gttPayload['orders[1][transaction_type]'] = hmtGtt.transaction_type;
          gttPayload['orders[1][quantity]'] = parseInt(hmtGtt.quantity_2 || hmtGtt.quantity_1);
          gttPayload['orders[1][price]'] = parseFloat(hmtGtt.order_price_2) || 0;
          gttPayload['orders[1][order_type]'] = hmtGtt.order_type_2 || 'LIMIT';
          gttPayload['orders[1][product]'] = hmtGtt.product_type_2 || 'CNC';
        } else {
          gttPayload['orders[0][transaction_type]'] = hmtGtt.transaction_type;
          gttPayload['orders[0][quantity]'] = parseInt(hmtGtt.quantity_1);
          gttPayload['orders[0][price]'] = parseFloat(hmtGtt.order_price_1) || 0;
          gttPayload['orders[0][order_type]'] = hmtGtt.order_type_1 || 'LIMIT';
          gttPayload['orders[0][product]'] = hmtGtt.product_type_1 || 'CNC';
        }

        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${hmtGtt.broker_connection_id}`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gttPayload)
        });

        const result = await response.json();

        if (result.success) {
          const { error: deleteError } = await supabase
            .from('hmt_gtt_orders')
            .delete()
            .eq('id', hmtGtt.id)
            .eq('user_id', user?.id);

          if (deleteError) {
            return { success: false, error: 'GTT created but failed to delete HMT GTT', orderId };
          }
          return { success: true, orderId };
        } else {
          return { success: false, error: result.error || 'Unknown error', orderId };
        }
      } catch (err: any) {
        console.error(`Error converting HMT GTT ${hmtGtt.id}:`, err);
        return { success: false, orderId, error: err.message || 'Unknown error' };
      }
    });

    const results = await Promise.all(convertPromises);
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    if (successCount > 0) {
      setSelectedOrders(new Set());
      setConvertMessage(`Successfully converted ${successCount} HMT GTT order(s) to regular GTT.${failedCount > 0 ? ` ${failedCount} failed.` : ''}`);
      setConvertError('');
      setTimeout(() => setConvertMessage(''), 5000);
      loadHMTGTTOrders(true);
    } else {
      const firstError = results.find(r => !r.success)?.error || 'Unknown error';
      setConvertError(`Failed to convert HMT GTT orders: ${firstError}`);
      setTimeout(() => setConvertError(''), 5000);
    }
    setConverting(false);
  }, [session, user, selectedOrders, hmtGttOrders, loadHMTGTTOrders]);

  const confirmSingleDelete = async () => {
    if (!deleteTarget) return;
    setShowDeleteConfirm(false);
    setDeleting(true);

    try {
      const { error } = await supabase
        .from('hmt_gtt_orders')
        .delete()
        .eq('id', deleteTarget)
        .eq('user_id', user?.id);

      if (error) throw error;

      setDeleteMessage('Successfully deleted HMT GTT order');
      setTimeout(() => setDeleteMessage(''), 5000);
      loadHMTGTTOrders(true);
    } catch (err: any) {
      setDeleteError('Failed to delete HMT GTT order: ' + err.message);
      setTimeout(() => setDeleteError(''), 5000);
    } finally {
      setDeleting(false);
    }
  };


  const loadEngineStatus = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmt-trigger-engine/health`,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setEngineStatus(data);
      }
    } catch (error) {
      console.error('Failed to load engine status:', error);
    }
  };

  const handleRestartEngine = async () => {
    setLoadingEngine(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hmt-trigger-engine/start`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (response.ok) {
        await loadEngineStatus();
      }
    } catch (error) {
      console.error('Failed to restart engine:', error);
    } finally {
      setLoadingEngine(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl lg:text-2xl font-bold text-gray-900 truncate">HMT GTT ({filteredHmtGttOrders.length})</h2>
          <div className="min-h-[40px] flex flex-wrap items-center gap-2 lg:gap-3 mt-2">
            {engineStatus ? (
              <>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  engineStatus.status === 'running' && engineStatus.stats?.websocket_status === 'connected'
                    ? 'bg-green-100 text-green-800 border border-green-300'
                    : engineStatus.status === 'stale'
                    ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                    : engineStatus.status === 'running' && engineStatus.error
                    ? 'bg-red-100 text-red-800 border border-red-300'
                    : engineStatus.status === 'running'
                    ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                    : 'bg-gray-100 text-gray-800 border border-gray-300'
                }`}>
                  {engineStatus.status === 'running' && engineStatus.stats?.websocket_status === 'connected' ? (
                    <>
                      <Activity className="w-4 h-4 animate-pulse flex-shrink-0" />
                      <span className="whitespace-nowrap">Engine Running</span>
                    </>
                  ) : engineStatus.status === 'stale' ? (
                    <>
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span className="whitespace-nowrap">Auto-Reconnecting</span>
                    </>
                  ) : engineStatus.status === 'running' && engineStatus.error ? (
                    <>
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span className="whitespace-nowrap">Engine Error</span>
                    </>
                  ) : engineStatus.status === 'running' ? (
                    <>
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span className="whitespace-nowrap">Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Power className="w-4 h-4 flex-shrink-0" />
                      <span className="whitespace-nowrap">Engine Stopped</span>
                    </>
                  )}
                </div>
                {engineStatus.heartbeat && engineStatus.heartbeat.seconds_since_update !== null && (
                  <div className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded whitespace-nowrap">
                    Heartbeat: {engineStatus.heartbeat.seconds_since_update}s ago
                  </div>
                )}
                {engineStatus.error && engineStatus.status !== 'stale' && (
                  <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200 max-w-xs truncate">
                    {engineStatus.error}
                  </div>
                )}
                {(engineStatus.status === 'stopped' || engineStatus.status === 'stale') && (
                  <button
                    onClick={handleRestartEngine}
                    disabled={loadingEngine}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                  >
                    <Power className="w-4 h-4" />
                    {loadingEngine ? 'Restarting...' : 'Restart Engine'}
                  </button>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-500">Loading engine status...</div>
            )}
            {isConnected && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium whitespace-nowrap">
                <CheckCircle className="w-3 h-3" />
                UI Live Prices
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:gap-3 items-center">
          {brokers.length > 0 && (
            <select
              value={selectedBrokerId}
              onChange={(e) => setSelectedBrokerId(e.target.value)}
              className="flex-1 min-w-[200px] lg:flex-none px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
            >
              <option value="all">All Accounts</option>
              {brokers.map((broker) => (
                <option key={broker.id} value={broker.id}>
                  {(broker.account_holder_name || broker.account_name || 'Account')} ({broker.client_id || 'No ID'})
                </option>
              ))}
            </select>
          )}
          {uniqueInstruments.length > 0 && (
            <div className="flex-1 min-w-[200px] lg:flex-none">
              <MultiSelectFilter
                label="Instruments"
                options={uniqueInstruments}
                selectedValues={selectedInstruments}
                onChange={setSelectedInstruments}
                placeholder="All Instruments"
              />
            </div>
          )}
          <button
            onClick={() => {
              setEditingGTT(null);
              setShowCreateModal(true);
            }}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New HMT GTT</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>


      {deleteMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800 font-medium">{deleteMessage}</p>
        </div>
      )}

      {deleteError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium">{deleteError}</p>
        </div>
      )}

      {deleting && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800 font-medium">Deleting HMT GTT order(s)...</p>
        </div>
      )}

      {convertMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800 font-medium">{convertMessage}</p>
        </div>
      )}

      {convertError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium">{convertError}</p>
        </div>
      )}

      {converting && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800 font-medium">Converting HMT GTT to regular GTT...</p>
        </div>
      )}

      {selectedOrders.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 lg:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="text-sm text-blue-800 font-medium">
            {selectedOrders.size} order(s) selected
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                const selectedGTTs = filteredHmtGttOrders.filter(gtt => selectedOrders.has(gtt.id));
                const symbols = new Set(selectedGTTs.map(g => g.trading_symbol));
                const brokers = new Set(selectedGTTs.map(g => g.broker_connection_id));

                if (symbols.size === 1 && brokers.size >= 1) {
                  setFilterStateBeforeEdit({
                    brokerId: selectedBrokerId,
                    instruments: selectedInstruments
                  });
                  setEditingGTT({ bulkEdit: true, orders: selectedGTTs });
                  setShowCreateModal(true);
                } else {
                  alert('Please select orders for the same instrument');
                }
              }}
              disabled={selectedOrders.size === 0}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Edit2 className="w-4 h-4" />
              <span className="hidden sm:inline">Edit Selected</span>
              <span className="sm:hidden">Edit</span>
            </button>
            <button
              onClick={handleBulkConvertToGTT}
              disabled={converting || selectedOrders.size === 0}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span className="hidden sm:inline">HMT to GTT</span>
              <span className="sm:hidden">To GTT</span>
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={deleting || selectedOrders.size === 0}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Delete Selected</span>
              <span className="sm:hidden">Delete</span>
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <div className="text-gray-600 font-medium">Loading HMT GTT orders...</div>
          </div>
        </div>
      ) : !selectedBrokerId ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Broker Connected</h3>
          <p className="text-gray-600">Please connect a broker account first to view HMT GTT orders</p>
        </div>
      ) : hmtGttOrders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No HMT GTT orders</h3>
          <p className="text-gray-600 mb-4">Create your first Host-Monitored GTT order</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          {/* Mobile Card View */}
          <div className="md:hidden">
            {/* Mobile Select All Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedOrders.size === filteredHmtGttOrders.length && filteredHmtGttOrders.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">Select All</span>
              </label>
              {selectedOrders.size > 0 && (
                <span className="text-xs text-blue-600 font-medium">
                  {selectedOrders.size} selected
                </span>
              )}
            </div>

            <div className="divide-y divide-gray-200">
            {filteredHmtGttOrders.map((gtt) => {
              const ltp = getLTP(gtt.instrument_token);
              const position = getPositionForGTT(gtt);
              const currentPrice = ltp ?? 0;
              const pnl = position && currentPrice ? (currentPrice - position.average_price) * position.quantity : null;
              const showMobileMenu = openMobileMenu === gtt.id;

              return (
                <div key={gtt.id} className="p-4 space-y-3 transition-colors relative">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(gtt.id)}
                        onChange={() => toggleOrderSelection(gtt.id)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer mt-1 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {isConnected && ltp && (
                            <span className="text-xs text-green-600 mr-1">●</span>
                          )}
                          {gtt.trading_symbol}
                        </div>
                        <div className="text-xs text-gray-600">{gtt.exchange}</div>
                        {selectedBrokerId === 'all' && (
                          <div className="text-xs text-gray-600 mt-1 truncate">
                            {gtt.broker_connections?.account_holder_name || gtt.broker_connections?.account_name || 'Account'}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap flex-shrink-0 ml-2 ${
                      gtt.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {gtt.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm min-h-[120px]">
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">Type</div>
                      <div className="font-medium text-gray-900 truncate">
                        {gtt.condition_type === 'two-leg' ? 'OCO' : 'Single'} / {gtt.transaction_type}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">Created</div>
                      <div className="text-xs text-gray-900">
                        {new Date(gtt.created_at).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">Trigger SL</div>
                      <div className="font-medium text-gray-900">
                        <div className="truncate">₹{gtt.trigger_price_1?.toFixed(2)}</div>
                        {ltp && (
                          <div className="text-xs text-gray-500 font-normal mt-0.5 truncate">
                            {(() => {
                              const percentOfLTP = ((gtt.trigger_price_1 - ltp) / ltp) * 100;
                              const absPercent = Math.abs(percentOfLTP);
                              const sign = percentOfLTP > 0 ? '+' : '-';
                              return `${sign}${absPercent.toFixed(2)}% of LTP`;
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                    {gtt.condition_type === 'two-leg' && (
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">Trigger TG</div>
                        <div className="font-medium text-gray-900">
                          <div className="truncate">₹{gtt.trigger_price_2?.toFixed(2)}</div>
                          {ltp && (
                            <div className="text-xs text-gray-500 font-normal mt-0.5 truncate">
                              {(() => {
                                const percentOfLTP = ((gtt.trigger_price_2 - ltp) / ltp) * 100;
                                const absPercent = Math.abs(percentOfLTP);
                                const sign = percentOfLTP > 0 ? '+' : '-';
                                return `${sign}${absPercent.toFixed(2)}% of LTP`;
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">LTP</div>
                      <div className="font-medium text-gray-900 tabular-nums">
                        {ltp ? `₹${ltp.toFixed(2)}` : '-'}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">Qty.</div>
                      <div className="font-medium text-gray-900">{gtt.quantity_1}</div>
                    </div>
                    {position && (
                      <>
                        <div className="min-w-0">
                          <div className="text-xs text-gray-500">Avg. Price</div>
                          <div className="font-medium text-gray-900 tabular-nums">₹{position.average_price?.toFixed(2)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-gray-500">P&L</div>
                          <div className={`font-semibold tabular-nums ${pnl !== null && pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {pnl !== null ? `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}` : '-'}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex justify-end pt-2">
                    <div className="relative">
                      <button
                        onClick={(e) => toggleMobileMenu(gtt.id, e)}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                        title="Actions"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>

                      {showMobileMenu && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setOpenMobileMenu(null)}
                          />
                          <div className={`absolute right-0 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-[100] overflow-visible ${
                            menuOpenUpward ? 'bottom-full mb-1' : 'mt-1'
                          }`}>
                            <div className="py-1">
                              <button
                                onClick={() => {
                                  handleEdit(gtt);
                                  setOpenMobileMenu(null);
                                }}
                                disabled={gtt.status !== 'active'}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                              >
                                <Edit2 className="w-4 h-4" />
                                Edit HMT GTT
                              </button>
                              <button
                                onClick={() => {
                                  handleConvertToGTT(gtt);
                                  setOpenMobileMenu(null);
                                }}
                                disabled={gtt.status !== 'active'}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                              >
                                <ArrowRightLeft className="w-4 h-4" />
                                HMT to GTT
                              </button>
                              <button
                                onClick={() => {
                                  handleDelete(gtt.id);
                                  setOpenMobileMenu(null);
                                }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-red-600 hover:bg-red-50 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto overflow-y-visible">
            <table className="w-full min-w-[1400px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-2 py-3 text-center w-12">
                  <input
                    type="checkbox"
                    checked={selectedOrders.size === filteredHmtGttOrders.length && filteredHmtGttOrders.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </th>
                <th
                  onClick={() => handleSort('created_at')}
                  className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    Created
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'created_at' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('symbol')}
                  className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    Instrument
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'symbol' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                {selectedBrokerId === 'all' && (
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Account
                  </th>
                )}
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Type
                </th>
                <th
                  onClick={() => handleSort('trigger_price')}
                  className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    Trigger
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'trigger_price' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  LTP
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Qty.
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider whitespace-nowrap">
                  Avg. Price
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  P&L
                </th>
                <th
                  onClick={() => handleSort('status')}
                  className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    Status
                    <ArrowUpDown className={`w-3 h-3 ${sortField === 'status' ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredHmtGttOrders.map((gtt) => (
                <HMTGTTRow
                  key={gtt.id}
                  gtt={gtt}
                  isSelected={selectedOrders.has(gtt.id)}
                  onToggleSelect={toggleOrderSelection}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onConvertToGTT={handleConvertToGTT}
                  showAccount={selectedBrokerId === 'all'}
                  ltp={getLTP(gtt.instrument_token)}
                  isConnected={isConnected}
                  position={getPositionForGTT(gtt)}
                />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showCreateModal && (
        <GTTModal
          isOpen={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setEditingGTT(null);
            if (filterStateBeforeEdit) {
              setSelectedBrokerId(filterStateBeforeEdit.brokerId);
              setSelectedInstruments(filterStateBeforeEdit.instruments);
              setFilterStateBeforeEdit(null);
            }
          }}
          onSuccess={() => {
            loadHMTGTTOrders(true);
          }}
          brokerConnectionId={editingGTT ? editingGTT.broker_connection_id : selectedBrokerId}
          editingGTT={editingGTT}
          allBrokers={brokers}
          isHMTMode={true}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">
              Confirm Delete
            </h3>
            <p className="text-gray-600 mb-6">
              {deleteType === 'bulk'
                ? `Are you sure you want to delete ${selectedOrders.size} HMT GTT order(s)? This action cannot be undone.`
                : 'Are you sure you want to delete this HMT GTT order? This action cannot be undone.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteType === 'bulk') {
                    confirmBulkDelete();
                  } else {
                    confirmSingleDelete();
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
