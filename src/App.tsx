import { useState, useEffect } from 'react';
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
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';

function AppContent() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isCallbackPage, setIsCallbackPage] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('request_token') && params.get('status')) {
      setIsCallbackPage(true);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return isCallbackPage ? <ZerodhaCallback /> : <AuthPage />;
  }

  if (isCallbackPage) {
    return <ZerodhaCallback />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'brokers':
        return <Brokers />;
      case 'strategies':
        return <Strategies />;
      case 'orders':
        return <Orders />;
      case 'gtt':
        return <GTTOrders />;
      case 'positions':
        return <Positions />;
      case 'watchlist':
        return <Watchlist />;
      case 'admin':
        return <AdminPanel />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-8">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
