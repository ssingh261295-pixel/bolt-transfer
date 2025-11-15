import { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface MarginData {
  broker_id: string;
  broker_name: string;
  account_name: string;
  account_holder_name: string;
  client_id: string;
  available_margin: number;
  used_margin: number;
  available_cash: number;
  last_updated: Date;
}

export function Dashboard() {
  const { user, session } = useAuth();
  const [brokers, setBrokers] = useState<any[]>([]);
  const [marginData, setMarginData] = useState<MarginData[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<string>('all');
  const [loading, setLoading] = useState(false);

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
        fetchMarginData(data);
      }
    }
  };

  const fetchMarginData = async (brokersToFetch: any[]) => {
    setLoading(true);
    const marginResults: MarginData[] = [];

    for (const broker of brokersToFetch) {
      if (broker.broker_name === 'zerodha') {
        try {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-positions?broker_id=${broker.id}`,
            {
              headers: {
                'Authorization': `Bearer ${session?.access_token}`,
              },
            }
          );

          if (response.ok) {
            const result = await response.json();
            if (result.success && result.margins) {
              const equity = result.margins.equity || {};
              marginResults.push({
                broker_id: broker.id,
                broker_name: broker.broker_name,
                account_name: broker.account_name || '',
                account_holder_name: broker.account_holder_name || '',
                client_id: broker.client_id || '',
                available_margin: parseFloat(equity.available?.live_balance || 0),
                used_margin: parseFloat(equity.utilised?.debits || 0),
                available_cash: parseFloat(equity.available?.cash || 0),
                last_updated: new Date(),
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching margin for broker ${broker.id}:`, error);
        }
      }
    }

    setMarginData(marginResults);
    setLoading(false);
  };

  const handleRefresh = () => {
    if (brokers.length > 0) {
      fetchMarginData(brokers);
    }
  };

  const filteredMarginData = selectedBroker === 'all'
    ? marginData
    : marginData.filter(m => m.broker_id === selectedBroker);

  const totalAvailableMargin = filteredMarginData.reduce((sum, m) => sum + m.available_margin, 0);
  const totalUsedMargin = filteredMarginData.reduce((sum, m) => sum + m.used_margin, 0);
  const totalAvailableCash = filteredMarginData.reduce((sum, m) => sum + m.available_cash, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Account Overview</h2>
          <p className="text-sm text-gray-600 mt-1">View margin and cash details by account</p>
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

      {brokers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Wallet className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No broker connections</h3>
          <p className="text-gray-600 mb-4">Connect a broker to view your margin details</p>
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

          {selectedBroker === 'all' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-blue-100">Total Available Margin</h3>
                  <Wallet className="w-5 h-5 text-blue-200" />
                </div>
                <p className="text-3xl font-bold">₹{totalAvailableMargin.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-blue-100 mt-1">Across all accounts</p>
              </div>

              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-orange-100">Total Used Margin</h3>
                  <Wallet className="w-5 h-5 text-orange-200" />
                </div>
                <p className="text-3xl font-bold">₹{totalUsedMargin.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-orange-100 mt-1">Across all accounts</p>
              </div>

              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-green-100">Total Available Cash</h3>
                  <Wallet className="w-5 h-5 text-green-200" />
                </div>
                <p className="text-3xl font-bold">₹{totalAvailableCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-green-100 mt-1">Across all accounts</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6">
            {filteredMarginData.length === 0 && !loading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-gray-600">No margin data available</p>
                <p className="text-sm text-gray-500 mt-1">Click refresh to fetch latest data</p>
              </div>
            ) : (
              filteredMarginData.map((margin) => (
                <div key={margin.broker_id} className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {margin.account_holder_name || margin.account_name || margin.client_id}
                      </h3>
                      {margin.client_id && (
                        <p className="text-sm text-gray-600">Client ID: {margin.client_id}</p>
                      )}
                      {margin.account_name && margin.account_holder_name && (
                        <p className="text-xs text-gray-500">{margin.account_name}</p>
                      )}
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>Last updated</p>
                      <p>{margin.last_updated.toLocaleTimeString()}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                      <p className="text-sm font-medium text-blue-900 mb-1">Available Margin</p>
                      <p className="text-2xl font-bold text-blue-600">
                        ₹{margin.available_margin.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                    </div>

                    <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
                      <p className="text-sm font-medium text-orange-900 mb-1">Used Margin</p>
                      <p className="text-2xl font-bold text-orange-600">
                        ₹{margin.used_margin.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                    </div>

                    <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                      <p className="text-sm font-medium text-green-900 mb-1">Available Cash</p>
                      <p className="text-2xl font-bold text-green-600">
                        ₹{margin.available_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
