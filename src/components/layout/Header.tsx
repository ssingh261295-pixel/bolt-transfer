import { User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { NotificationBell } from './NotificationBell';

export function Header() {
  const { profile } = useAuth();

  return (
    <header className="bg-white border-b border-gray-200 px-8 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Welcome back, {profile?.full_name || 'Trader'}!</h2>
          <p className="text-sm text-gray-600">Here's what's happening with your trades today</p>
        </div>

        <div className="flex items-center gap-4">
          <NotificationBell />

          <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
