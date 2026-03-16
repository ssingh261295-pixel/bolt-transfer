import { useState, useEffect } from 'react';
import { User, Bell, Shield, AlertTriangle, Calendar, Activity, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
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

  const [vixCache, setVixCache] = useState<any>(null);
  const [loadingVix, setLoadingVix] = useState(false);
  const [manualVixInput, setManualVixInput] = useState('');
  const [savingVix, setSavingVix] = useState(false);
  const [vixMessage, setVixMessage] = useState('');

  useEffect(() => {
    if (activeTab === 'risk') {
      loadRiskLimits();
    }
    if (activeTab === 'vix') {
      loadVixCache();
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
          next_month_day_threshold: riskLimits.next_month_day_threshold ?? 15,
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

  const loadVixCache = async () => {
    setLoadingVix(true);
    try {
      const { data } = await supabase
        .from('vix_cache')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      setVixCache(data);
      if (data?.manual_vix_value !== null && data?.manual_vix_value !== undefined) {
        setManualVixInput(String(data.manual_vix_value));
      }
    } catch (err) {
      console.error('Error loading VIX cache:', err);
    } finally {
      setLoadingVix(false);
    }
  };

  const handleSaveManualVix = async () => {
    const val = parseFloat(manualVixInput);
    if (isNaN(val) || val <= 0 || val > 100) {
      setVixMessage('Enter a valid VIX value between 0.01 and 100');
      return;
    }
    setSavingVix(true);
    setVixMessage('');
    try {
      const { error } = await supabase.from('vix_cache').upsert({
        id: 1,
        manual_override: true,
        manual_vix_value: val,
        manual_set_at: new Date().toISOString(),
        manual_set_by: profile?.id
      }, { onConflict: 'id' });
      if (error) throw error;
      setVixMessage(`Manual VIX set to ${val}. Webhook will use this value until auto-fetch succeeds or override is disabled.`);
      await loadVixCache();
    } catch (err: any) {
      setVixMessage('Failed to save: ' + err.message);
    } finally {
      setSavingVix(false);
    }
  };

  const handleDisableManualVix = async () => {
    setSavingVix(true);
    setVixMessage('');
    try {
      const { error } = await supabase.from('vix_cache').upsert({
        id: 1,
        manual_override: false
      }, { onConflict: 'id' });
      if (error) throw error;
      setVixMessage('Manual override disabled. Webhook will now use live Zerodha VIX fetch.');
      await loadVixCache();
    } catch (err: any) {
      setVixMessage('Failed: ' + err.message);
    } finally {
      setSavingVix(false);
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'risk', label: 'Risk Management', icon: AlertTriangle },
    { id: 'vix', label: 'VIX Override', icon: Activity },
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

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
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

                      <div className="border border-gray-200 rounded-lg p-4 col-span-1 md:col-span-2">
                        <div className="flex items-center gap-2 mb-3">
                          <Calendar className="w-4 h-4 text-blue-600" />
                          <h4 className="font-medium text-gray-900">Next-Month Futures Rollover Threshold</h4>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">
                          When the current calendar day exceeds this value, TradingView webhook signals will automatically use the <strong>next month's futures contract</strong> instead of the current month.
                        </p>
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Rollover Day (1–28)
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="28"
                              value={riskLimits.next_month_day_threshold ?? 15}
                              onChange={(e) => setRiskLimits({
                                ...riskLimits,
                                next_month_day_threshold: Math.min(28, Math.max(1, parseInt(e.target.value) || 15))
                              })}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                            />
                          </div>
                          <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-sm text-blue-800">
                              <strong>Current setting:</strong> On day {(riskLimits.next_month_day_threshold ?? 15) + 1} and beyond, next-month contract is used. Days 1–{riskLimits.next_month_day_threshold ?? 15} use the current month.
                            </p>
                          </div>
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

            {activeTab === 'vix' && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">India VIX Override</h3>
                <p className="text-sm text-gray-600 mb-6">
                  The webhook fetches India VIX live from Zerodha every 2 minutes. When the access token is expired or market is closed, use a manual override to ensure regime-based signal filters work correctly.
                </p>

                {loadingVix ? (
                  <div className="flex items-center gap-2 text-gray-500 py-4">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading VIX status...</span>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Live Cache Value</p>
                        <p className="text-3xl font-bold text-gray-900">
                          {vixCache?.vix_value ? parseFloat(vixCache.vix_value).toFixed(2) : '—'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {vixCache?.fetched_at
                            ? `Last fetched: ${new Date(vixCache.fetched_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`
                            : 'Never fetched'}
                        </p>
                        {vixCache?.is_stale && (
                          <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3 h-3" /> Stale
                          </span>
                        )}
                      </div>

                      <div className={`border-2 rounded-xl p-4 ${vixCache?.manual_override ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Manual Override</p>
                          {vixCache?.manual_override
                            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full"><CheckCircle className="w-3 h-3" /> ACTIVE</span>
                            : <span className="text-xs text-gray-400">OFF</span>
                          }
                        </div>
                        <p className="text-3xl font-bold text-blue-900">
                          {vixCache?.manual_vix_value ? parseFloat(vixCache.manual_vix_value).toFixed(2) : '—'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {vixCache?.manual_set_at
                            ? `Set: ${new Date(vixCache.manual_set_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`
                            : 'Not set'}
                        </p>
                      </div>
                    </div>

                    {vixCache?.manual_override && (
                      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <CheckCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-blue-900">Manual Override is Active</p>
                          <p className="text-sm text-blue-700 mt-0.5">
                            The webhook is using VIX = <strong>{parseFloat(vixCache.manual_vix_value).toFixed(2)}</strong> for all regime evaluations.
                            Live Zerodha fetch is bypassed. Disable when the token is refreshed.
                          </p>
                        </div>
                      </div>
                    )}

                    {!vixCache?.manual_override && vixCache?.is_stale && (
                      <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-lg p-4">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-amber-900">Live VIX fetch is stale</p>
                          <p className="text-sm text-amber-700 mt-0.5">
                            Zerodha VIX could not be refreshed (token may be expired or market closed).
                            Set a manual override below to ensure regimes work with the correct VIX.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="border border-gray-200 rounded-xl p-5 space-y-4">
                      <h4 className="font-semibold text-gray-900">Set Manual VIX Value</h4>
                      <p className="text-sm text-gray-600">
                        Enter today's India VIX value (e.g. 24.21). When override is enabled, the webhook uses this instead of live fetch.
                      </p>
                      <div className="flex gap-3 items-end">
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700 mb-1">India VIX Value</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="100"
                            placeholder="e.g. 24.21"
                            value={manualVixInput}
                            onChange={(e) => setManualVixInput(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          />
                        </div>
                        <button
                          onClick={handleSaveManualVix}
                          disabled={savingVix || !manualVixInput}
                          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 font-medium"
                        >
                          {savingVix ? 'Saving...' : 'Enable Override'}
                        </button>
                        {vixCache?.manual_override && (
                          <button
                            onClick={handleDisableManualVix}
                            disabled={savingVix}
                            className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 font-medium"
                          >
                            Disable Override
                          </button>
                        )}
                      </div>

                      {vixMessage && (
                        <div className={`p-3 rounded-lg text-sm ${
                          vixMessage.includes('Failed') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
                        }`}>
                          {vixMessage}
                        </div>
                      )}
                    </div>

                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <p className="text-xs font-semibold text-gray-600 mb-2">How it works</p>
                      <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                        <li>Webhook first checks if manual override is ON — if yes, uses that value immediately.</li>
                        <li>If override is OFF, fetches live VIX from Zerodha using the active broker access token.</li>
                        <li>If live fetch fails (expired token, market closed), falls back to the last cached value.</li>
                        <li>If cache is also empty, VIX is treated as unknown and regimes may not match correctly.</li>
                      </ol>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={loadVixCache}
                        disabled={loadingVix}
                        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <RefreshCw className={`w-4 h-4 ${loadingVix ? 'animate-spin' : ''}`} />
                        Refresh Status
                      </button>
                    </div>
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
