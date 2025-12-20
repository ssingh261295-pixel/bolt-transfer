import { useEffect, useState } from 'react';
import { Users, CheckCircle, XCircle, Clock, Shield, Database, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface UserProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  plan_type: string;
  account_status: string;
  is_admin: boolean;
  created_at: string;
  approved_at: string | null;
  email?: string;
}

export function AdminPanel() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'disabled'>('all');
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState('');
  const [syncingInstruments, setSyncingInstruments] = useState(false);
  const [instrumentCount, setInstrumentCount] = useState<number | null>(null);

  useEffect(() => {
    if (user) {
      checkAdminStatus();
    }
  }, [user]);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
      loadInstrumentCount();
    }
  }, [isAdmin, filter]);

  const checkAdminStatus = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user?.id)
      .single();

    if (data?.is_admin) {
      setIsAdmin(true);
    } else {
      setIsAdmin(false);
    }
    setLoading(false);
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_users_admin');

      if (error) {
        console.error('Failed to load users:', error);
        throw error;
      }

      if (data) {
        let filteredUsers = data;

        if (filter !== 'all') {
          filteredUsers = data.filter((u: any) => u.account_status === filter);
        }

        setUsers(filteredUsers);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
      setMessage('Failed to load users. Please check console for details.');
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const loadInstrumentCount = async () => {
    try {
      const { count, error } = await supabase
        .from('nfo_instruments')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;
      setInstrumentCount(count || 0);
    } catch (err) {
      console.error('Failed to load instrument count:', err);
    }
  };

  const syncInstruments = async () => {
    setSyncingInstruments(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-nfo-instruments`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();

      if (result.success) {
        setMessage(`Successfully synced ${result.total} NFO instruments`);
        await loadInstrumentCount();
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (err: any) {
      setMessage(`Failed to sync instruments: ${err.message}`);
    } finally {
      setSyncingInstruments(false);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  const updateUserStatus = async (userId: string, newStatus: 'active' | 'disabled') => {
    try {
      const updateData: any = {
        account_status: newStatus,
        updated_at: new Date().toISOString()
      };

      if (newStatus === 'active') {
        updateData.approved_at = new Date().toISOString();
        updateData.approved_by = user?.id;
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId);

      if (error) throw error;

      setMessage(`User ${newStatus === 'active' ? 'activated' : 'disabled'} successfully`);
      setTimeout(() => setMessage(''), 3000);
      await loadUsers();
    } catch (err: any) {
      setMessage(`Failed to update user: ${err.message}`);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle className="w-3 h-3" />
            Active
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        );
      case 'disabled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">
            <XCircle className="w-3 h-3" />
            Disabled
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <Shield className="w-16 h-16 text-red-500" />
        <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
        <p className="text-gray-600">You do not have permission to access the admin panel.</p>
      </div>
    );
  }

  const stats = {
    total: users.length,
    pending: users.filter(u => u.account_status === 'pending').length,
    active: users.filter(u => u.account_status === 'active').length,
    disabled: users.filter(u => u.account_status === 'disabled').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-blue-600" />
            Admin Panel
          </h2>
          <p className="text-sm text-gray-600 mt-1">Manage user accounts and permissions</p>
        </div>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm ${
          message.includes('success')
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Users</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
            </div>
            <Users className="w-8 h-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Approval</p>
              <p className="text-2xl font-bold text-yellow-600 mt-1">{stats.pending}</p>
            </div>
            <Clock className="w-8 h-8 text-yellow-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Users</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{stats.active}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Disabled</p>
              <p className="text-2xl font-bold text-red-600 mt-1">{stats.disabled}</p>
            </div>
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl border border-blue-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <Database className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">NFO Instruments Database</h3>
              <p className="text-sm text-gray-600 mt-1">
                {instrumentCount === null ? 'Loading...' :
                 instrumentCount === 0 ? 'No instruments synced yet. Click sync to get started.' :
                 `${instrumentCount.toLocaleString()} instruments available for trading`}
              </p>
            </div>
          </div>
          <button
            onClick={syncInstruments}
            disabled={syncingInstruments}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
          >
            <RefreshCw className={`w-5 h-5 ${syncingInstruments ? 'animate-spin' : ''}`} />
            {syncingInstruments ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">User Management</h3>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
          >
            <option value="all">All Users</option>
            <option value="pending">Pending Approval</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        {users.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No users found</h3>
            <p className="text-gray-600">
              {filter === 'all' ? 'No registered users yet' : `No ${filter} users found`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Plan
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Registered
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((userProfile) => (
                  <tr key={userProfile.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">
                          {userProfile.full_name || 'N/A'}
                        </div>
                        {userProfile.is_admin && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                            <Shield className="w-3 h-3" />
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {userProfile.email || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {userProfile.phone || 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex px-2 py-1 rounded text-xs font-medium uppercase bg-blue-100 text-blue-700">
                        {userProfile.plan_type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(userProfile.account_status)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(userProfile.created_at).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td className="px-6 py-4">
                      {!userProfile.is_admin && (
                        <div className="flex gap-2">
                          {userProfile.account_status === 'pending' && (
                            <button
                              onClick={() => updateUserStatus(userProfile.id, 'active')}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition"
                            >
                              Approve
                            </button>
                          )}
                          {userProfile.account_status === 'disabled' && (
                            <button
                              onClick={() => updateUserStatus(userProfile.id, 'active')}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition"
                            >
                              Activate
                            </button>
                          )}
                          {userProfile.account_status === 'active' && (
                            <button
                              onClick={() => updateUserStatus(userProfile.id, 'disabled')}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition"
                            >
                              Disable
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
