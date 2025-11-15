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

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (data) {
      setBrokers(data);
      if (data.length > 0) {
        fetchAccountsData(data);
      }
    }
  };

  const fetchAccountsData = async (brokersToFetch: any[]) => {
    setLoading(true);
    setError('');
    const accountResults: AccountData[] = [];

    for (const broker of brokersToFetch) {
      if (broker.broker_name === 'zerodha') {
        try {
          const [positionsResponse, gttResponse] = await Promise.all([
            fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-positions?broker_id=${broker.id}`,
              {
                headers: {
                  'Authorization': `Bearer ${session?.access_token}`,
                },
              }
            ),
            fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-gtt?broker_id=${broker.id}`,
              {
                headers: {
                  'Authorization': `Bearer ${session?.access_token}`,
                },
              }
            ),
          ]);

          const gttResult = await gttResponse.json();
          console.log(`GTT API Response for broker ${broker.id}:`, gttResult);

          if (positionsResponse.ok) {
            const result = await positionsResponse.json();
            console.log('Positions API Response for broker', broker.id, ':', result);

            if (result.success) {
              const equity = result.margins?.equity || {};
              const positions = result.positions || [];

              const todayPnl = positions.reduce((sum: number, pos: any) => {
                return sum + (pos.pnl || 0);
              }, 0);

              const activeTrades = positions.filter((pos: any) => pos.quantity !== 0).length;
              const gttOrders = gttResult.success ? (gttResult.data || []) : [];
              const activeGtt = gttOrders.filter((gtt: any) => gtt.status === 'active').length;

              console.log(`Broker ${broker.id} - Active GTT count:`, activeGtt, 'Total GTT:', gttOrders.length);

              accountResults.push({
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
              });
            }
          }
        } catch (err) {
          console.error(`Error fetching data for broker ${broker.id}:`, err);
          setError(`Failed to fetch data for some accounts`);
        }
      }
    }

    setAccountsData(accountResults);
    setLoading(false);
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
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {brokers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Wallet className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No broker connections</h3>
          <p className="text-gray-600 mb-4">Connect a broker to view your account details</p>
          <a
            href="/brokers"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Connect Broker
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
            {filteredAccountsData.length === 0 && !loading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-gray-600">No account data available</p>
                <p className="text-sm text-gray-500 mt-1">Click refresh to fetch latest data</p>
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
