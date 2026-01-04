import { useState, useEffect } from 'react';
import { User, Bell, Shield, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export function Settings() {
  const { profile, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [riskLimits, setRiskLimits] = useState<any>(null);
  const [loadingRiskLimits, setLoadingRiskLimits] = useState(false);
  const [savingRiskLimits, setSavingRiskLimits] = useState(false);
  const [riskMessage, setRiskMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    if (activeTab === 'risk') {
      loadRiskLimits();
    }
  }, [activeTab, profile?.id]);

  const loadRiskLimits = async () => {
    if (!profile?.id) return;

    setLoadingRiskLimits(true);
    try {
      const { data, error } = await supabase
        .from('risk_limits')
        .select('*')
        .eq('user_id', profile.id)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setRiskLimits(data);
      }
    } catch (error) {
      console.error('Error loading risk limits:', error);
    } finally {
      setLoadingRiskLimits(false);
    }
  };

  const handleSaveRiskLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRiskLimits(true);
    setRiskMessage('');

    try {
      const { error } = await supabase
        .from('risk_limits')
        .update({
          max_trades_per_day: riskLimits.max_trades_per_day,
          max_loss_per_day: riskLimits.max_loss_per_day,
          auto_square_off_time: riskLimits.auto_square_off_time,
          kill_switch_enabled: riskLimits.kill_switch_enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', profile?.id);

      if (error) throw error;

      setRiskMessage('Risk limits updated successfully');
      await loadRiskLimits();
    } catch (error: any) {
      setRiskMessage('Failed to update risk limits: ' + error.message);
    } finally {
      setSavingRiskLimits(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: formData.full_name,
        phone: formData.phone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile?.id);

    if (!error) {
      setMessage('Profile updated successfully');
      await refreshProfile();
    } else {
      setMessage('Failed to update profile');
    }

    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    setPasswordMessage('');

    if (newPassword.length < 6) {
      setPasswordMessage('Password must be at least 6 characters long');
      setChangingPassword(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage('Passwords do not match');
      setChangingPassword(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setPasswordMessage('Password changed successfully');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setPasswordMessage('Failed to change password: ' + error.message);
    } finally {
      setChangingPassword(false);
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'risk', label: 'Risk Management', icon: AlertTriangle },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-600 mt-1">Manage your account settings and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            {activeTab === 'profile' && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Information</h3>
                {message && (
                  <div className={`mb-4 p-3 rounded-lg ${
                    message.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {message}
                  </div>
                )}
                <form onSubmit={handleSave} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="Enter your full name"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="Enter your phone number"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </form>
              </div>
            )}

            {activeTab === 'risk' && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Risk Management</h3>
                <p className="text-sm text-gray-600 mb-6">
                  Configure safety limits for HMT GTT orders. These limits protect your account from excessive losses.
                </p>

                {loadingRiskLimits ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : riskLimits ? (
                  <>
                    {riskMessage && (
                      <div className={`mb-4 p-3 rounded-lg ${
                        riskMessage.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {riskMessage}
                      </div>
                    )}

                    <form onSubmit={handleSaveRiskLimits} className="space-y-6">
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-yellow-900 mb-1">Emergency Kill Switch</p>
                            <p className="text-sm text-yellow-700 mb-3">
                              Instantly stop all HMT GTT order executions. Use this in emergencies to prevent further trades.
                            </p>
                            <label className="flex items-center gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={riskLimits.kill_switch_enabled}
                                onChange={(e) => setRiskLimits({
                                  ...riskLimits,
                                  kill_switch_enabled: e.target.checked
                                })}
                                className="w-5 h-5 text-red-600 rounded focus:ring-red-500"
                              />
                              <span className="text-sm font-medium text-gray-900">
                                {riskLimits.kill_switch_enabled ? 'Kill Switch ACTIVE - All trades blocked' : 'Kill Switch Disabled'}
                              </span>
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Max Trades Per Day
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={riskLimits.max_trades_per_day}
                            onChange={(e) => setRiskLimits({
                              ...riskLimits,
                              max_trades_per_day: parseInt(e.target.value)
                            })}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Current: {riskLimits.daily_trades_count} / {riskLimits.max_trades_per_day}
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Max Loss Per Day (₹)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={riskLimits.max_loss_per_day}
                            onChange={(e) => setRiskLimits({
                              ...riskLimits,
                              max_loss_per_day: parseFloat(e.target.value)
                            })}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Current P&L: ₹{parseFloat(riskLimits.daily_pnl).toFixed(2)}
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Auto Square-Off Time
                          </label>
                          <input
                            type="time"
                            value={riskLimits.auto_square_off_time}
                            onChange={(e) => setRiskLimits({
                              ...riskLimits,
                              auto_square_off_time: e.target.value
                            })}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            No new trades after this time
                          </p>
                        </div>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-900">
                          <strong>Daily counters reset at midnight (00:00 IST).</strong> Risk limits are checked before every HMT GTT order execution.
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={savingRiskLimits}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                      >
                        {savingRiskLimits ? 'Saving...' : 'Save Risk Limits'}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-600">
                    No risk limits found. They will be created automatically when you place your first HMT GTT order.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notifications' && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Notification Preferences</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Order Notifications</p>
                      <p className="text-sm text-gray-600">Get notified when orders are executed</p>
                    </div>
                    <input type="checkbox" className="w-5 h-5" defaultChecked />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Strategy Alerts</p>
                      <p className="text-sm text-gray-600">Alerts when strategies trigger</p>
                    </div>
                    <input type="checkbox" className="w-5 h-5" defaultChecked />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">P&L Updates</p>
                      <p className="text-sm text-gray-600">Daily profit and loss summaries</p>
                    </div>
                    <input type="checkbox" className="w-5 h-5" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Security Settings</h3>
                <div className="space-y-6">
                  <div className="p-6 bg-gray-50 rounded-lg">
                    <p className="font-medium text-gray-900 mb-2">Change Password</p>
                    <p className="text-sm text-gray-600 mb-4">Update your password regularly for security</p>

                    {passwordMessage && (
                      <div className={`mb-4 p-3 rounded-lg ${
                        passwordMessage.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {passwordMessage}
                      </div>
                    )}

                    <form onSubmit={handleChangePassword} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          New Password
                        </label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          placeholder="Enter new password"
                          required
                          minLength={6}
                        />
                        <p className="text-xs text-gray-600 mt-1">Must be at least 6 characters</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Confirm New Password
                        </label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          placeholder="Confirm new password"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={changingPassword}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                      >
                        {changingPassword ? 'Changing Password...' : 'Change Password'}
                      </button>
                    </form>
                  </div>

                  <div className="p-6 bg-gray-50 rounded-lg">
                    <p className="font-medium text-gray-900 mb-2">Two-Factor Authentication</p>
                    <p className="text-sm text-gray-600 mb-4">Add an extra layer of security to your account</p>
                    <button
                      disabled
                      className="px-4 py-2 bg-gray-200 text-gray-500 rounded-lg cursor-not-allowed"
                    >
                      Coming Soon
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
