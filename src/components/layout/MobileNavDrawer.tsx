import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Link as LinkIcon,
  TrendingUp,
  ShoppingCart,
  LineChart,
  Target,
  Settings,
  LogOut,
  Shield,
  Activity,
  Bell,
  X
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface MobileNavDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNavDrawer({ isOpen, onClose }: MobileNavDrawerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, signOut } = useAuth();

  const isAdmin = Boolean(profile?.is_admin);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { id: 'brokers', label: 'Brokers', path: '/brokers', icon: LinkIcon },
    { id: 'orders', label: 'Orders', path: '/orders', icon: ShoppingCart },
    { id: 'positions', label: 'Positions', path: '/positions', icon: LineChart },
    { id: 'gtt', label: 'GTT Orders', path: '/gtt', icon: Target },
    { id: 'hmt-gtt', label: 'HMT GTT', path: '/hmt-gtt', icon: Target },
    { id: 'strategies', label: 'Strategies', path: '/strategies', icon: TrendingUp },
    { id: 'nfo-settings', label: 'NFO Settings', path: '/nfo-settings', icon: Settings },
    { id: 'tradingview-logs', label: 'TradingView Logs', path: '/tradingview-logs', icon: Activity },
  ];

  const handleNavigation = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black transition-opacity z-40 md:hidden ${
          isOpen ? 'opacity-50' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 left-0 w-64 bg-white shadow-xl transform transition-transform duration-300 ease-in-out z-50 md:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-gray-900">Helpme Trade</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigation(item.path)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-blue-700' : 'text-gray-400'}`} />
                  {item.label}
                </button>
              );
            })}

            {isAdmin && (
              <button
                onClick={() => handleNavigation('/admin')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                  location.pathname === '/admin'
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Shield className={`w-5 h-5 ${location.pathname === '/admin' ? 'text-blue-700' : 'text-gray-400'}`} />
                Admin Panel
              </button>
            )}

            <button
              onClick={() => handleNavigation('/settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                location.pathname === '/settings'
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Settings className={`w-5 h-5 ${location.pathname === '/settings' ? 'text-blue-700' : 'text-gray-400'}`} />
              Settings
            </button>
          </nav>

          {/* Sign Out */}
          <div className="p-4 border-t border-gray-200">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-600 hover:bg-red-50 transition"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
