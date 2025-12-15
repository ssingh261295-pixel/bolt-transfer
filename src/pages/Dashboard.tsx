import { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Filter, TrendingUp, Activity, ListChecks } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface AccountData {
  broker_id: string;
  broker_name: string;
  account_name: string;
  account_holder_name: string;
  client_id: string;
  available_margin: number;
  used_margin: number;
  available_cash: number;
  today_pnl: number;
  active_trades: number;
  active_gtt: number;
  last_updated: Date;
}

export function Dashboard() {
  const { user, session } = useAuth();
  const [brokers, setBrokers] = useState<any[]>([]);
  const [accountsData, setAccountsData] = useState<AccountData[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (user) {
      loadBrokers();
    }
  }, [user]);

  const fetchWithTimeout = async (url: string, options: RequestInit, timeout = 10000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (data) {
      setBrokers(data);
    }
  };

  const fetchAccountsData = async (brokersToFetch: any[]) => {
    setLoading(true);
    setError('');

    const failedAccounts: string[] = [];

    try {
      const accountPromises = brokersToFetch.map(async (broker) => {
        if (broker.broker_name !== 'zerodha') return null;

        try {
          const headers = {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          };

          const [positionsResponse, gttResponse] = await Promise.all([
            fetchWithTimeout(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-positions?broker_id=${broker.id}`,
              { headers },
              15000
            ),
            fetchWithTimeout(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${broker.id}`,
              { headers },
              15000
            ),
          ]);

          const [result, gttResult] = await Promise.all([
            positionsResponse.json(),
            gttResponse.json(),
          ]);

          if (result.success) {
            const equity = result.margins?.equity || {};
            const positions = result.positions || [];

            const todayPnl = positions.reduce((sum: number, pos: any) => {
              return sum + (pos.pnl || 0);
            }, 0);

            const activeTrades = positions.filter((pos: any) => pos.quantity !== 0).length;
            const gttOrders = gttResult.success ? (gttResult.data || []) : [];
            const activeGtt = gttOrders.filter((gtt: any) => gtt.status === 'active').length;

            return {
              broker_id: broker.id,
              broker_name: broker.broker_name,
              account_name: broker.account_name || '',
              account_holder_name: broker.account_holder_name || '',
              client_id: broker.client_id || '',
              available_margin: parseFloat(equity.available?.live_balance || equity.available?.adhoc_margin || 0),
              used_margin: parseFloat(equity.utilised?.debits || 0),
              available_cash: parseFloat(equity.available?.cash || 0),
              today_pnl: todayPnl,
              active_trades: activeTrades,
              active_gtt: activeGtt,
              last_updated: new Date(),
            };
          } else {
            const accountName = broker.account_holder_name || broker.client_id || broker.id;
            console.error(`API error for ${accountName}:`, result.error || result.message);
            failedAccounts.push(accountName);
            return null;
          }
        } catch (err: any) {
          const accountName = broker.account_holder_name || broker.client_id || broker.id;
          failedAccounts.push(accountName);

          if (err.name === 'AbortError') {
            console.error(`Timeout fetching data for ${accountName}`);
          } else {
            console.error(`Error fetching data for ${accountName}:`, err);
          }
          return null;
        }
      });

      const results = await Promise.all(accountPromises);
      const accountResults = results.filter((result): result is AccountData => result !== null);

      setAccountsData(accountResults);

      if (failedAccounts.length > 0) {
        const accountList = failedAccounts.join(', ');
        setError(`Failed to fetch data for: ${accountList}. Token may have expired - reconnect accounts from Brokers page.`);
      }
    } catch (err) {
      console.error('Error fetching accounts data:', err);
      setError('Failed to fetch account data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (brokers.length > 0) {
      fetchAccountsData(brokers);
    }
  };

  const filteredAccountsData = selectedBroker === 'all'
    ? accountsData
    : accountsData.filter(a => a.broker_id === selectedBroker);

  const totalAvailableMargin = filteredAccountsData.reduce((sum, a) => sum + a.available_margin, 0);
  const totalUsedMargin = filteredAccountsData.reduce((sum, a) => sum + a.used_margin, 0);
  const totalAvailableCash = filteredAccountsData.reduce((sum, a) => sum + a.available_cash, 0);
  const totalTodayPnl = filteredAccountsData.reduce((sum, a) => sum + a.today_pnl, 0);
  const totalActiveTrades = filteredAccountsData.reduce((sum, a) => sum + a.active_trades, 0);
  const totalActiveGtt = filteredAccountsData.reduce((sum, a) => sum + a.active_gtt, 0);

  const formatCurrency = (value: number) => {
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Account Overview</h2>
          <p className="text-sm text-gray-600 mt-1">View margin, P&L, and trading activity by account</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading || brokers.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm text-red-700 font-medium">{error}</p>
              {error.includes('Token may have expired') && (
                <a
                  href="/brokers"
                  className="inline-flex items-center gap-1 mt-2 text-sm text-red-800 font-medium hover:text-red-900 underline"
                >
                  Go to Brokers Page
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {brokers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <RefreshCw className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No active broker connections</h3>
          <p className="text-gray-600 mb-1">Your broker tokens may have expired</p>
          <p className="text-sm text-gray-500 mb-4">Zerodha tokens expire daily and need to be reconnected</p>
          <a
            href="/brokers"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Go to Brokers Page
          </a>
        </div>
      ) : (
        <>
          {brokers.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                <Filter className="w-5 h-5 text-gray-600" />
                <label className="text-sm font-medium text-gray-700">Filter by Account:</label>
                <select
                  value={selectedBroker}
                  onChange={(e) => setSelectedBroker(e.target.value)}
                  className="flex-1 max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="all">All Accounts</option>
                  {brokers.map((broker) => (
                    <option key={broker.id} value={broker.id}>
                      {broker.account_holder_name || broker.account_name || broker.client_id || broker.broker_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {selectedBroker === 'all' && accountsData.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-blue-100">Total Available Margin</h3>
                  <Wallet className="w-5 h-5 text-blue-200" />
                </div>
                <p className="text-3xl font-bold">{formatCurrency(totalAvailableMargin)}</p>
                <p className="text-xs text-blue-100 mt-1">Across all accounts</p>
              </div>

              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-orange-100">Total Used Margin</h3>
                  <Wallet className="w-5 h-5 text-orange-200" />
                </div>
                <p className="text-3xl font-bold">{formatCurrency(totalUsedMargin)}</p>
                <p className="text-xs text-orange-100 mt-1">Across all accounts</p>
              </div>

              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-green-100">Total Opening Balance</h3>
                  <Wallet className="w-5 h-5 text-green-200" />
                </div>
                <p className="text-3xl font-bold">{formatCurrency(totalAvailableCash)}</p>
                <p className="text-xs text-green-100 mt-1">Across all accounts</p>
              </div>

              <div className={`bg-gradient-to-br ${totalTodayPnl >= 0 ? 'from-emerald-500 to-emerald-600' : 'from-red-500 to-red-600'} rounded-xl p-6 text-white`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-white/80">Today's P&L</h3>
                  <TrendingUp className="w-5 h-5 text-white/70" />
                </div>
                <p className="text-3xl font-bold">{totalTodayPnl >= 0 ? '+' : ''}{formatCurrency(totalTodayPnl)}</p>
                <p className="text-xs text-white/80 mt-1">Across all accounts</p>
              </div>

              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-purple-100">Active Trades</h3>
                  <Activity className="w-5 h-5 text-purple-200" />
                </div>
                <p className="text-3xl font-bold">{totalActiveTrades}</p>
                <p className="text-xs text-purple-100 mt-1">Open positions</p>
              </div>

              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-indigo-100">Active GTT</h3>
                  <ListChecks className="w-5 h-5 text-indigo-200" />
                </div>
                <p className="text-3xl font-bold">{totalActiveGtt}</p>
                <p className="text-xs text-indigo-100 mt-1">Pending orders</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6">
            {loading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="animate-pulse">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <div className="h-6 bg-gray-200 rounded w-48 mb-2"></div>
                      <div className="h-4 bg-gray-200 rounded w-32"></div>
                    </div>
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-gray-100 rounded-lg p-4 h-24"></div>
                    <div className="bg-gray-100 rounded-lg p-4 h-24"></div>
                    <div className="bg-gray-100 rounded-lg p-4 h-24"></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gray-100 rounded-lg p-4 h-24"></div>
                    <div className="bg-gray-100 rounded-lg p-4 h-24"></div>
                    <div className="bg-gray-100 rounded-lg p-4 h-24"></div>
                  </div>
                </div>
              </div>
            ) : accountsData.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <Activity className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to view account data</h3>
                <p className="text-gray-600 mb-4">Click the Refresh button above to fetch your latest account information</p>
                <button
                  onClick={handleRefresh}
                  disabled={loading || brokers.length === 0}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-5 h-5" />
                  Fetch Account Data
                </button>
              </div>
            ) : filteredAccountsData.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-gray-600">No data available for selected account</p>
                <p className="text-sm text-gray-500 mt-1">Try selecting a different account or refresh the data</p>
              </div>
            ) : (
              filteredAccountsData.map((account) => (
                <div key={account.broker_id} className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {account.account_holder_name || account.account_name || account.client_id}
                      </h3>
                      {account.client_id && (
                        <p className="text-sm text-gray-600">Client ID: {account.client_id}</p>
                      )}
                      {account.account_name && account.account_holder_name && (
                        <p className="text-xs text-gray-500">{account.account_name}</p>
                      )}
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>Last updated</p>
                      <p>{account.last_updated.toLocaleTimeString()}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                      <p className="text-sm font-medium text-blue-900 mb-1">Available Margin</p>
                      <p className="text-2xl font-bold text-blue-600">
                        {formatCurrency(account.available_margin)}
                      </p>
                    </div>

                    <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
                      <p className="text-sm font-medium text-orange-900 mb-1">Used Margin</p>
                      <p className="text-2xl font-bold text-orange-600">
                        {formatCurrency(account.used_margin)}
                      </p>
                    </div>

                    <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                      <p className="text-sm font-medium text-green-900 mb-1">Opening Balance</p>
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(account.available_cash)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className={`${account.today_pnl >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'} rounded-lg p-4 border`}>
                      <p className={`text-sm font-medium ${account.today_pnl >= 0 ? 'text-emerald-900' : 'text-red-900'} mb-1`}>Today's P&L</p>
                      <p className={`text-2xl font-bold ${account.today_pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {account.today_pnl >= 0 ? '+' : ''}{formatCurrency(account.today_pnl)}
                      </p>
                    </div>

                    <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                      <p className="text-sm font-medium text-purple-900 mb-1">Active Trades</p>
                      <p className="text-2xl font-bold text-purple-600">
                        {account.active_trades}
                      </p>
                    </div>

                    <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-100">
                      <p className="text-sm font-medium text-indigo-900 mb-1">Active GTT</p>
                      <p className="text-2xl font-bold text-indigo-600">
                        {account.active_gtt}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
