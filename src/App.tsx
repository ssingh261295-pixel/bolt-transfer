import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { Brokers } from './pages/Brokers';
import { Strategies } from './pages/Strategies';
import { Orders } from './pages/Orders';
import { GTTOrders } from './pages/GTTOrders';
import { Positions } from './pages/Positions';
import { Watchlist } from './pages/Watchlist';
import { Settings } from './pages/Settings';
import { ZerodhaCallback } from './pages/ZerodhaCallback';
import { AdminPanel } from './pages/AdminPanel';
import TopNavigation from './components/layout/TopNavigation';
import WatchlistSidebar from './components/layout/WatchlistSidebar';
import { PlaceOrderModal } from './components/orders/PlaceOrderModal';

function ProtectedLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderDefaults, setOrderDefaults] = useState<any>({});

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

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <TopNavigation />
      <div className="flex flex-1 overflow-hidden">
        <WatchlistSidebar onBuyClick={handleBuyClick} onSellClick={handleSellClick} />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/brokers" element={<Brokers />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/gtt" element={<GTTOrders />} />
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
    </div>
  );
}

function AppContent() {
  const location = useLocation();
  const isCallbackPage = location.pathname === '/zerodha-callback';

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
