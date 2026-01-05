import { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, CheckCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

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

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('all');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const loadNotifications = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.is_read).length);
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
          setUnreadCount(prev => prev + 1);
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
          setUnreadCount(prev => {
            const oldNotif = notifications.find(n => n.id === updatedNotification.id);
            if (oldNotif && !oldNotif.is_read && updatedNotification.is_read) {
              return Math.max(0, prev - 1);
            }
            return prev;
          });
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
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  };

  const markAllAsRead = async () => {
    const { error } = await supabase.rpc('mark_all_notifications_read', {
      p_user_id: user?.id
    });

    if (!error) {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    }
  };

  const clearAll = async () => {
    if (!confirm('Are you sure you want to delete all notifications?')) {
      return;
    }

    const { error } = await supabase.rpc('clear_all_notifications', {
      p_user_id: user?.id
    });

    if (!error) {
      setNotifications([]);
      setUnreadCount(0);
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
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
  };

  const uniqueSymbols = Array.from(
    new Set(notifications.map(n => n.symbol).filter(Boolean))
  ).sort();

  const filteredNotifications = notifications.filter(notification => {
    if (selectedAccount !== 'all' && notification.broker_account_id !== selectedAccount) {
      return false;
    }
    if (selectedSymbol !== 'all' && notification.symbol !== selectedSymbol) {
      return false;
    }
    return true;
  });

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <CheckCheck className="w-3 h-3" />
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear all
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex gap-2">
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All Symbols</option>
                {uniqueSymbols.map(symbol => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-500">
                Loading notifications...
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Bell className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <p>{notifications.length === 0 ? 'No notifications yet' : 'No notifications match filters'}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-gray-50 transition cursor-pointer ${
                      !notification.is_read ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => !notification.is_read && markAsRead(notification.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-2xl flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900 text-sm">
                            {notification.title}
                          </span>
                          {!notification.is_read && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
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
                          <span className="text-xs text-gray-400 ml-auto">
                            {formatTime(notification.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-200 text-center">
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/notifications');
                }}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
