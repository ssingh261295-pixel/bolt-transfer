import { useState, useEffect } from 'react';
import { Bell, CheckCheck, Trash2, RefreshCw, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Notification {
  id: string;
  source: string;
  broker_account_id?: string;
  strategy_name?: string;
  symbol?: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  metadata?: any;
}

interface BrokerAccount {
  id: string;
  broker_name: string;
  account_name?: string;
  client_id?: string;
  account_holder_name?: string;
}

export function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadNotifications();
      loadBrokerAccounts();
      subscribeToNotifications();
    }

    return () => {
      unsubscribeFromNotifications();
    };
  }, [user]);

  const loadNotifications = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setNotifications(data);
    }
    setLoading(false);
  };

  const loadBrokerAccounts = async () => {
    const { data, error } = await supabase
      .from('broker_connections')
      .select('id, broker_name, account_name, client_id, account_holder_name')
      .eq('user_id', user?.id)
      .eq('is_active', true);

    if (!error && data) {
      setBrokerAccounts(data);
    }
  };

  const subscribeToNotifications = () => {
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user?.id}`
        },
        (payload) => {
          const newNotification = payload.new as Notification;
          setNotifications(prev => [newNotification, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user?.id}`
        },
        (payload) => {
          const updatedNotification = payload.new as Notification;
          setNotifications(prev =>
            prev.map(n => n.id === updatedNotification.id ? updatedNotification : n)
          );
        }
      )
      .subscribe();

    return channel;
  };

  const unsubscribeFromNotifications = () => {
    supabase.channel('notifications').unsubscribe();
  };

  const markAsRead = async (notificationId: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', user?.id);

    if (!error) {
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
    }
  };

  const markAllAsRead = async () => {
    const { error } = await supabase.rpc('mark_all_notifications_read', {
      p_user_id: user?.id
    });

    if (!error) {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    }
  };

  const clearAll = async () => {
    if (!confirm('Are you sure you want to delete all notifications? This action cannot be undone.')) {
      return;
    }

    const { error } = await supabase.rpc('clear_all_notifications', {
      p_user_id: user?.id
    });

    if (!error) {
      setNotifications([]);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', user?.id);

    if (!error) {
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'trade':
        return '📈';
      case 'trade_blocked':
        return '🚫';
      case 'order':
        return '📊';
      case 'alert':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return 'ℹ️';
    }
  };

  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case 'tradingview':
      case 'tradingview_webhook':
        return 'bg-purple-100 text-purple-700';
      case 'hmt_engine':
        return 'bg-blue-100 text-blue-700';
      case 'zerodha':
        return 'bg-green-100 text-green-700';
      case 'system':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const uniqueSymbols = Array.from(
    new Set(notifications.map(n => n.symbol).filter(Boolean))
  ).sort();

  const uniqueTypes = Array.from(
    new Set(notifications.map(n => n.type))
  ).sort();

  const filteredNotifications = notifications.filter(notification => {
    if (selectedAccount !== 'all' && notification.broker_account_id !== selectedAccount) {
      return false;
    }
    if (selectedSymbol !== 'all' && notification.symbol !== selectedSymbol) {
      return false;
    }
    if (typeFilter !== 'all' && notification.type !== typeFilter) {
      return false;
    }
    if (statusFilter === 'unread' && notification.is_read) {
      return false;
    }
    if (statusFilter === 'read' && !notification.is_read) {
      return false;
    }
    return true;
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-gray-600 mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up!'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <CheckCheck className="w-4 h-4" />
              Mark All Read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
          )}
          <button
            onClick={loadNotifications}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Accounts</option>
              {brokerAccounts.map(account => {
                const displayName = account.account_name ||
                                   account.client_id ||
                                   account.account_holder_name ||
                                   `${account.broker_name} Account`;
                return (
                  <option key={account.id} value={account.id}>
                    {displayName}
                  </option>
                );
              })}
            </select>

            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Symbols</option>
              {uniqueSymbols.map(symbol => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Types</option>
              {uniqueTypes.map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="unread">Unread Only</option>
              <option value="read">Read Only</option>
            </select>

            {(selectedAccount !== 'all' || selectedSymbol !== 'all' || typeFilter !== 'all' || statusFilter !== 'all') && (
              <button
                onClick={() => {
                  setSelectedAccount('all');
                  setSelectedSymbol('all');
                  setTypeFilter('all');
                  setStatusFilter('all');
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        <div>
          {loading ? (
            <div className="p-12 text-center text-gray-500">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
              Loading notifications...
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <Bell className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">
                {notifications.length === 0 ? 'No notifications yet' : 'No notifications match filters'}
              </p>
              {notifications.length > 0 && filteredNotifications.length === 0 && (
                <button
                  onClick={() => {
                    setSelectedAccount('all');
                    setSelectedSymbol('all');
                    setTypeFilter('all');
                    setStatusFilter('all');
                  }}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-700"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-gray-50 transition ${
                    !notification.is_read ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="text-2xl flex-shrink-0">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900">
                          {notification.title}
                        </span>
                        {!notification.is_read && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-2 whitespace-pre-line">
                        {notification.message}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getSourceBadgeColor(notification.source)}`}>
                          {notification.source === 'tradingview' || notification.source === 'tradingview_webhook' ? 'TradingView' :
                           notification.source === 'hmt_engine' ? 'HMT Engine' :
                           notification.source === 'zerodha' ? 'Zerodha' :
                           notification.source}
                        </span>
                        {notification.symbol && (
                          <span className="text-xs text-gray-500 font-medium">
                            {notification.symbol}
                          </span>
                        )}
                        {notification.strategy_name && (
                          <span className="text-xs text-gray-500">
                            {notification.strategy_name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {formatTime(notification.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!notification.is_read && (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Mark as read"
                        >
                          <CheckCheck className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteNotification(notification.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
