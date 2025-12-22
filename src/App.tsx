import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { supabase } from './lib/supabase';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { Brokers } from './pages/Brokers';
import { Strategies } from './pages/Strategies';
import { Orders } from './pages/Orders';
import { GTTOrders } from './pages/GTTOrders';
import { HMTGTTOrders } from './pages/HMTGTTOrders';
import { Positions } from './pages/Positions';
import { Watchlist } from './pages/Watchlist';
import { Settings } from './pages/Settings';
import { ZerodhaCallback } from './pages/ZerodhaCallback';
import { AdminPanel } from './pages/AdminPanel';
import TopNavigation from './components/layout/TopNavigation';
import WatchlistSidebar from './components/layout/WatchlistSidebar';
import { PlaceOrderModal } from './components/orders/PlaceOrderModal';
import { GTTModal } from './components/orders/GTTModal';

function ProtectedLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showGTTModal, setShowGTTModal] = useState(false);
  const [orderDefaults, setOrderDefaults] = useState<any>({});
  const [gttDefaults, setGttDefaults] = useState<any>({});
  const [brokers, setBrokers] = useState<any[]>([]);
  const [brokerId, setBrokerId] = useState<string>('');

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
      .eq('broker_name', 'zerodha');

    if (data && data.length > 0) {
      setBrokers(data);
      setBrokerId(data[0].id);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const handleBuyClick = (symbol: string, exchange: string, token: number) => {
    setOrderDefaults({
      symbol,
      exchange,
      instrumentToken: token,
      transactionType: 'BUY'
    });
    setShowOrderModal(true);
  };

  const handleSellClick = (symbol: string, exchange: string, token: number) => {
    setOrderDefaults({
      symbol,
      exchange,
      instrumentToken: token,
      transactionType: 'SELL'
    });
    setShowOrderModal(true);
  };

  const handleGTTClick = (symbol: string, exchange: string, token: number) => {
    setGttDefaults({
      symbol,
      exchange,
      instrumentToken: token
    });
    setShowGTTModal(true);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <TopNavigation />
      <div className="flex flex-1 overflow-hidden">
        <WatchlistSidebar
          onBuyClick={handleBuyClick}
          onSellClick={handleSellClick}
          onGTTClick={handleGTTClick}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/brokers" element={<Brokers />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/gtt" element={<GTTOrders />} />
            <Route path="/hmt-gtt" element={<HMTGTTOrders />} />
            <Route path="/positions" element={<Positions />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>

      {showOrderModal && (
        <PlaceOrderModal
          isOpen={showOrderModal}
          onClose={() => {
            setShowOrderModal(false);
            setOrderDefaults({});
          }}
          initialSymbol={orderDefaults.symbol}
          initialExchange={orderDefaults.exchange}
          initialTransactionType={orderDefaults.transactionType}
        />
      )}

      {showGTTModal && (
        <GTTModal
          isOpen={showGTTModal}
          onClose={() => {
            setShowGTTModal(false);
            setGttDefaults({});
          }}
          brokerConnectionId={brokerId || 'all'}
          initialSymbol={gttDefaults.symbol}
          initialExchange={gttDefaults.exchange}
          allBrokers={brokers}
        />
      )}
    </div>
  );
}

function AppContent() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const hasRequestToken = searchParams.has('request_token');
  const isCallbackPage = location.pathname === '/zerodha-callback' || (hasRequestToken && searchParams.get('status') === 'success');

  if (isCallbackPage) {
    return <ZerodhaCallback />;
  }

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/zerodha-callback" element={<ZerodhaCallback />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
