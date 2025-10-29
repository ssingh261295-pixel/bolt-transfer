import { useEffect, useState } from 'react';
import { Wallet, TrendingUp, Activity, Target } from 'lucide-react';
import { StatCard } from '../components/dashboard/StatCard';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalValue: '₹0.00',
    todayPnL: '₹0.00',
    activePositions: '0',
    activeStrategies: '0',
  });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  const loadDashboardData = async () => {
    const [ordersResult, positionsResult, strategiesResult] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('positions')
        .select('*')
        .eq('user_id', user?.id),
      supabase
        .from('strategies')
        .select('*')
        .eq('user_id', user?.id)
        .eq('is_active', true),
    ]);

    if (ordersResult.data) {
      setRecentOrders(ordersResult.data);
    }

    if (positionsResult.data) {
      setPositions(positionsResult.data);
      const totalPnL = positionsResult.data.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
      const totalValue = positionsResult.data.reduce((sum, pos) =>
        sum + (pos.quantity * (pos.current_price || pos.average_price)), 0);

      setStats({
        totalValue: `₹${totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        todayPnL: `₹${totalPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        activePositions: positionsResult.data.length.toString(),
        activeStrategies: strategiesResult.data?.length.toString() || '0',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Portfolio Value"
          value={stats.totalValue}
          icon={Wallet}
          iconColor="bg-blue-600"
        />
        <StatCard
          title="Today's P&L"
          value={stats.todayPnL}
          change="+2.5%"
          changeType="positive"
          icon={TrendingUp}
          iconColor="bg-green-600"
        />
        <StatCard
          title="Active Positions"
          value={stats.activePositions}
          icon={Activity}
          iconColor="bg-orange-600"
        />
        <StatCard
          title="Active Strategies"
          value={stats.activeStrategies}
          icon={Target}
          iconColor="bg-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Orders</h3>
          {recentOrders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No orders yet</p>
              <p className="text-sm mt-1">Connect a broker to start trading</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{order.symbol}</p>
                    <p className="text-sm text-gray-600">
                      {order.transaction_type} · {order.quantity} qty
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900">₹{order.price?.toFixed(2)}</p>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        order.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-700'
                          : order.status === 'PENDING'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Open Positions</h3>
          {positions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No open positions</p>
              <p className="text-sm mt-1">Start trading to see your positions here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {positions.map((position) => (
                <div key={position.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{position.symbol}</p>
                    <p className="text-sm text-gray-600">
                      {position.quantity} qty @ ₹{position.average_price?.toFixed(2)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-medium ${position.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {position.pnl >= 0 ? '+' : ''}₹{position.pnl?.toFixed(2)}
                    </p>
                    <p className={`text-sm ${position.pnl_percentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {position.pnl_percentage >= 0 ? '+' : ''}{position.pnl_percentage?.toFixed(2)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold mb-2">Ready to automate your trading?</h3>
            <p className="text-blue-100">Connect your broker and create your first strategy</p>
          </div>
          <button className="bg-white text-blue-600 px-6 py-3 rounded-lg font-medium hover:bg-blue-50 transition">
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
