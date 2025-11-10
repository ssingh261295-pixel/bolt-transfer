import {
  LayoutDashboard,
  Link as LinkIcon,
  TrendingUp,
  ShoppingCart,
  LineChart,
  List,
  Settings,
  LogOut,
  Target,
  Shield
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { signOut, profile } = useAuth();

  console.log('=== SIDEBAR DEBUG ===');
  console.log('Profile:', profile);
  console.log('Profile keys:', profile ? Object.keys(profile) : 'null');
  console.log('Is Admin value:', profile?.is_admin);
  console.log('Is Admin Type:', typeof profile?.is_admin);
  console.log('Is Admin Strict Check:', profile?.is_admin === true);
  console.log('Full profile JSON:', JSON.stringify(profile, null, 2));
  console.log('====================');

  const baseMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'brokers', label: 'Brokers', icon: LinkIcon },
    { id: 'strategies', label: 'Strategies', icon: TrendingUp },
    { id: 'orders', label: 'Orders', icon: ShoppingCart },
    { id: 'gtt', label: 'GTT Orders', icon: Target },
    { id: 'positions', label: 'Positions', icon: LineChart },
    { id: 'watchlist', label: 'Watchlist', icon: List },
  ];

  const adminMenuItem = { id: 'admin', label: 'Admin Panel', icon: Shield };
  const settingsMenuItem = { id: 'settings', label: 'Settings', icon: Settings };

  const isAdmin = Boolean(profile?.is_admin);
  console.log('Sidebar - Computed isAdmin:', isAdmin);
  console.log('Sidebar - Boolean conversion:', profile?.is_admin, '->', isAdmin);

  const menuItems = isAdmin
    ? [...baseMenuItems, adminMenuItem, settingsMenuItem]
    : [...baseMenuItems, settingsMenuItem];

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Helpme Trade</h1>
            {isAdmin && (
              <div className="text-xs text-purple-600 font-medium">Admin Mode</div>
            )}
          </div>
        </div>
        {/* Debug Panel - Remove after testing */}
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
          <div className="font-bold text-yellow-900">Debug:</div>
          <div className="text-yellow-800">Profile: {profile ? 'Yes' : 'No'}</div>
          <div className="text-yellow-800">is_admin: {String(profile?.is_admin)}</div>
          <div className="text-yellow-800">isAdmin: {String(isAdmin)}</div>
          <div className="text-yellow-800">Menu items: {menuItems.length}</div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition ${
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
      </nav>

      <div className="p-4 border-t border-gray-200">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-red-600 hover:bg-red-50 transition"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
