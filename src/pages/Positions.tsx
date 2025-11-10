import { useEffect, useState } from 'react';
import { LineChart, X, RefreshCw, Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useZerodha } from '../hooks/useZerodha';
import { GTTModal } from '../components/orders/GTTModal';

export function Positions() {
  const { user } = useAuth();
  const { syncPositions, loading: syncLoading } = useZerodha();
  const [positions, setPositions] = useState<any[]>([]);
  const [allPositions, setAllPositions] = useState<any[]>([]);
  const [brokers, setBrokers] = useState<any[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<string>('all');
  const [syncMessage, setSyncMessage] = useState('');
  const [summary, setSummary] = useState({
    totalPnL: 0,
    totalInvested: 0,
  });
  const [gttModalOpen, setGttModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<any>(null);

  useEffect(() => {
    if (user) {
      loadPositions();
      loadBrokers();
    }
  }, [user]);

  useEffect(() => {
    filterPositions();
  }, [selectedBroker, allPositions]);

  const loadPositions = async () => {
    const { data } = await supabase
      .from('positions')
      .select(`
        *,
        broker_connections (
          account_name,
          broker_name,
          client_id,
          account_holder_name
        )
      `)
      .eq('user_id', user?.id)
      .neq('quantity', 0)
      .order('created_at', { ascending: false });

    if (data) {
      setAllPositions(data);
    }
  };

  const filterPositions = () => {
    let filtered = allPositions;

    if (selectedBroker !== 'all') {
      filtered = allPositions.filter(pos => pos.broker_connection_id === selectedBroker);
    }

    setPositions(filtered);

    const totalPnL = filtered.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
    const totalInvested = filtered.reduce((sum, pos) => sum + (pos.quantity * pos.average_price), 0);

    setSummary({ totalPnL, totalInvested });
  };

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('user_id', user?.id)
      .eq('is_active', true)
      .eq('broker_name', 'zerodha');

    if (data) {
      setBrokers(data);
    }
  };

  const handleSync = async () => {
    if (brokers.length === 0) {
      setSyncMessage('No active broker connections found');
      setTimeout(() => setSyncMessage(''), 3000);
      return;
    }

    setSyncMessage(`Syncing positions from ${brokers.length} account(s)...`);
    let totalSynced = 0;
    let successCount = 0;
    let errors: string[] = [];

    for (const broker of brokers) {
      try {
        const accountName = broker.account_holder_name
          ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
          : broker.account_name || `Account (${broker.api_key.substring(0, 8)}...)`;
        const result = await syncPositions(broker.id);

        if (result.success) {
          totalSynced += result.synced || 0;
          successCount++;
          console.log(`Successfully synced ${result.synced} positions from ${accountName}`);
        } else {
          errors.push(`${accountName}: ${result.error}`);
          console.error(`Failed to sync ${accountName}:`, result.error);
        }
      } catch (err: any) {
        const accountName = broker.account_holder_name
          ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
          : broker.account_name || `Account (${broker.api_key.substring(0, 8)}...)`;
        errors.push(`${accountName}: ${err.message || 'Unknown error'}`);
        console.error(`Error syncing ${accountName}:`, err);
      }
    }

    if (errors.length === 0) {
      setSyncMessage(`✓ Synced ${totalSynced} positions from ${successCount} account(s) successfully`);
    } else if (successCount > 0) {
      setSyncMessage(`Synced ${totalSynced} positions from ${successCount} account(s), ${errors.length} failed. Check console for details.`);
    } else {
      setSyncMessage(`Failed to sync all accounts. Check console for details.`);
    }

    await loadPositions();
    setTimeout(() => setSyncMessage(''), 6000);
  };

  const handleClosePosition = async (id: string) => {
    const { error } = await supabase
      .from('positions')
      .delete()
      .eq('id', id);

    if (!error) {
      loadPositions();
    }
  };

  const handleOpenGTT = (position: any) => {
    setSelectedPosition(position);
    setGttModalOpen(true);
  };

  const handleCloseGTTModal = () => {
    setGttModalOpen(false);
    setSelectedPosition(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Open Positions</h2>
          <p className="text-sm text-gray-600 mt-1">Monitor your active trading positions</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedBroker}
            onChange={(e) => setSelectedBroker(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="all">All Accounts</option>
            {brokers.map((broker) => (
              <option key={broker.id} value={broker.id}>
                {broker.account_holder_name
                  ? `${broker.account_holder_name} (${broker.client_id || 'No Client ID'})`
                  : broker.account_name || `Zerodha (${broker.api_key.substring(0, 8)}...)`}
              </option>
            ))}
          </select>
          <button
            onClick={handleSync}
            disabled={syncLoading || brokers.length === 0}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-5 h-5 ${syncLoading ? 'animate-spin' : ''}`} />
            Sync Positions
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
          {syncMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm text-gray-600 mb-1">Total P&L</h3>
          <p className={`text-3xl font-bold ${summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {summary.totalPnL >= 0 ? '+' : ''}₹{summary.totalPnL.toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm text-gray-600 mb-1">Total Invested</h3>
          <p className="text-3xl font-bold text-gray-900">₹{summary.totalInvested.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm text-gray-600 mb-1">Open Positions</h3>
          <p className="text-3xl font-bold text-gray-900">{positions.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {positions.length === 0 ? (
          <div className="text-center py-12">
            <LineChart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No open positions</h3>
            <p className="text-gray-600">Your active positions will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Symbol
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Account
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Quantity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Avg. Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Current Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    P&L
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    P&L %
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {positions.map((position) => (
                  <tr key={position.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="font-medium text-gray-900">{position.symbol}</div>
                        <div className="text-sm text-gray-600">{position.exchange}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-medium">
                        {position.broker_connections?.account_holder_name || position.broker_connections?.account_name || 'Default Account'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {position.broker_connections?.client_id && `Client ID: ${position.broker_connections.client_id}`}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {position.quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ₹{position.average_price?.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ₹{position.current_price?.toFixed(2) || position.average_price?.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-medium ${position.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {position.pnl >= 0 ? '+' : ''}₹{position.pnl?.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-medium ${position.pnl_percentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {position.pnl_percentage >= 0 ? '+' : ''}{position.pnl_percentage?.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenGTT(position)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Create GTT"
                        >
                          <Bell className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleClosePosition(position.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Close position"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedPosition && (
        <GTTModal
          isOpen={gttModalOpen}
          onClose={handleCloseGTTModal}
          brokerConnectionId={selectedPosition.broker_connection_id}
          initialSymbol={selectedPosition.symbol}
          initialExchange={selectedPosition.exchange}
        />
      )}
    </div>
  );
}
