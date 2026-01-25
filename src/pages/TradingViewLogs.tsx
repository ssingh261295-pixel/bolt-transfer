import { useState, useEffect } from 'react';
import { Search, Filter, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface WebhookLog {
  id: string;
  webhook_key_id: string;
  webhook_key_name?: string;
  source_ip: string;
  payload: any;
  received_at: string;
  status: string;
  error_message?: string;
  accounts_executed?: any[];
}

export function TradingViewLogs() {
  const { user, session } = useAuth();
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 50;
  const [executingLogId, setExecutingLogId] = useState<string | null>(null);
  const [executeMessage, setExecuteMessage] = useState('');
  const [executeError, setExecuteError] = useState('');

  useEffect(() => {
    if (user) {
      loadLogs();
    }
  }, [user, dateFilter, statusFilter, currentPage]);

  const loadLogs = async () => {
    setLoading(true);

    try {
      console.log('Loading logs for user:', user?.id);

      let query = supabase
        .from('tradingview_webhook_logs')
        .select(`
          *,
          webhook_keys!inner(
            user_id,
            name
          )
        `, { count: 'exact' })
        .eq('webhook_keys.user_id', user?.id)
        .order('received_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (dateFilter !== 'all') {
        let startDate: Date;

        switch (dateFilter) {
          case 'today':
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            break;
          case 'week':
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            break;
          case 'month':
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
            break;
          default:
            startDate = new Date(0);
        }

        console.log('Date filter:', dateFilter, 'Start date:', startDate.toISOString());
        query = query.gte('received_at', startDate.toISOString());
      }

      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query.range(from, to);

      console.log('Query result:', { data, error, count: data?.length, totalCount: count });

      if (error) {
        console.error('Error loading logs:', error);
      }

      if (data) {
        const formattedLogs = data.map((log: any) => ({
          ...log,
          webhook_key_name: log.webhook_keys?.name || 'Unknown'
        }));
        console.log('Formatted logs:', formattedLogs.length);
        setLogs(formattedLogs);
        setTotalCount(count || 0);
      } else {
        setLogs([]);
        setTotalCount(0);
      }
    } catch (err) {
      console.error('Exception loading logs:', err);
      setLogs([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'rejected':
      case 'rejected_time_window':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { bg: string; text: string; label: string }> = {
      success: { bg: 'bg-green-100', text: 'text-green-800', label: 'Success' },
      failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
      rejected: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Rejected' },
      rejected_time_window: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Outside Trading Hours' }
    };

    const config = statusMap[status] || { bg: 'bg-gray-100', text: 'text-gray-800', label: status };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleExecute = async (log: WebhookLog) => {
    if (!session?.access_token) {
      setExecuteError('Not authenticated');
      setTimeout(() => setExecuteError(''), 5000);
      return;
    }

    const isExitSignal = log.payload?.trade_type === 'EXIT_LONG' || log.payload?.trade_type === 'EXIT_SHORT';
    if (isExitSignal) {
      setExecuteError('Cannot execute EXIT signals manually');
      setTimeout(() => setExecuteError(''), 5000);
      return;
    }

    setExecutingLogId(log.id);
    setExecuteError('');
    setExecuteMessage('');

    try {
      const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tradingview-webhook`;

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(log.payload)
      });

      const result = await response.json();

      if (result.success) {
        setExecuteMessage(`Successfully executed trade: ${result.message}`);
        setTimeout(() => setExecuteMessage(''), 5000);
        loadLogs();
      } else {
        setExecuteError(`Execution failed: ${result.error || result.message || 'Unknown error'}`);
        setTimeout(() => setExecuteError(''), 5000);
      }
    } catch (err: any) {
      console.error('Error executing trade:', err);
      setExecuteError(`Failed to execute: ${err.message}`);
      setTimeout(() => setExecuteError(''), 5000);
    } finally {
      setExecutingLogId(null);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.payload?.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.webhook_key_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.payload?.trade_type?.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesSearch;
  });

  const stats = {
    total: logs.length,
    success: logs.filter(l => l.status === 'success').length,
    failed: logs.filter(l => l.status === 'failed').length,
    rejected: logs.filter(l => l.status === 'rejected' || l.status === 'rejected_time_window').length
  };

  return (
    <div className="space-y-4 md:space-y-6 max-w-full overflow-x-hidden">
      {executeMessage && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          {executeMessage}
        </div>
      )}

      {executeError && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
          {executeError}
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">TradingView Webhook Logs</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">Monitor all incoming webhook signals and execution status</p>
          {user && (
            <p className="text-xs text-gray-500 mt-1">User ID: {user.id}</p>
          )}
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 w-full md:w-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Webhooks</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
            </div>
            <Clock className="w-8 h-8 text-gray-400" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Executed</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{stats.success}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Failed</p>
              <p className="text-2xl font-bold text-red-600 mt-1">{stats.failed}</p>
            </div>
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Rejected</p>
              <p className="text-2xl font-bold text-yellow-600 mt-1">{stats.rejected}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by symbol, webhook key, trade type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 md:flex-none px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="rejected">Rejected</option>
                <option value="rejected_time_window">Outside Trading Hours</option>
              </select>

              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="flex-1 md:flex-none px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
            Loading webhook logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Filter className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium">No logs found</p>
            <p className="text-sm mt-1">Try adjusting your filters or search criteria</p>
          </div>
        ) : (
          <>
            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {filteredLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 text-sm">{log.payload?.symbol || '-'}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{formatDate(log.received_at)}</div>
                    </div>
                    {getStatusBadge(log.status)}
                  </div>

                  <div className="flex items-center gap-2">
                    {log.payload?.trade_type && (
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        log.payload.trade_type === 'BUY' ? 'bg-green-100 text-green-800' :
                        log.payload.trade_type === 'SELL' ? 'bg-red-100 text-red-800' :
                        log.payload.trade_type === 'EXIT_LONG' ? 'bg-yellow-100 text-yellow-800' :
                        log.payload.trade_type === 'EXIT_SHORT' ? 'bg-orange-100 text-orange-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {log.payload.trade_type}
                      </span>
                    )}
                    {log.payload?.price && (
                      <span className="text-sm text-gray-600">₹{log.payload.price.toFixed(2)}</span>
                    )}
                  </div>

                  <div className="text-xs text-gray-600">
                    <div className="font-medium text-gray-700">{log.webhook_key_name}</div>
                    <div className="text-gray-500">{log.source_ip}</div>
                  </div>

                  {log.accounts_executed && (
                    <div className="text-xs text-gray-600">
                      <span className="font-medium">
                        {log.accounts_executed.filter((a: any) => a.order_placed).length}/{log.accounts_executed.length}
                      </span>
                      <span className="ml-1">accounts executed</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="flex-1 py-2 px-4 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition"
                    >
                      View Details
                    </button>
                    <button
                      onClick={() => handleExecute(log)}
                      disabled={executingLogId === log.id || log.payload?.trade_type === 'EXIT_LONG' || log.payload?.trade_type === 'EXIT_SHORT'}
                      className="flex items-center justify-center gap-2 py-2 px-4 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title={log.payload?.trade_type === 'EXIT_LONG' || log.payload?.trade_type === 'EXIT_SHORT' ? 'Cannot execute EXIT signals' : 'Execute trade'}
                    >
                      {executingLogId === log.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Webhook Key</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trade Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accounts</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                      {formatDate(log.received_at)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="font-medium text-gray-900">{log.webhook_key_name}</span>
                      <p className="text-xs text-gray-500">{log.source_ip}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {log.payload?.symbol || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {log.payload?.trade_type ? (
                        <span className={`px-2 py-1 text-xs font-medium rounded ${
                          log.payload.trade_type === 'BUY' ? 'bg-green-100 text-green-800' :
                          log.payload.trade_type === 'SELL' ? 'bg-red-100 text-red-800' :
                          log.payload.trade_type === 'EXIT_LONG' ? 'bg-yellow-100 text-yellow-800' :
                          log.payload.trade_type === 'EXIT_SHORT' ? 'bg-orange-100 text-orange-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {log.payload.trade_type}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {log.payload?.price ? `₹${log.payload.price.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {getStatusBadge(log.status)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {log.accounts_executed ? (
                        <div>
                          <span className="font-medium">
                            {log.accounts_executed.filter((a: any) => a.order_placed).length}/{log.accounts_executed.length}
                          </span>
                          <span className="text-xs text-gray-500 ml-1">executed</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="text-blue-600 hover:text-blue-700 font-medium"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleExecute(log)}
                          disabled={executingLogId === log.id || log.payload?.trade_type === 'EXIT_LONG' || log.payload?.trade_type === 'EXIT_SHORT'}
                          className="flex items-center gap-1 px-2 py-1 text-green-600 hover:text-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          title={log.payload?.trade_type === 'EXIT_LONG' || log.payload?.trade_type === 'EXIT_SHORT' ? 'Cannot execute EXIT signals' : 'Execute trade'}
                        >
                          {executingLogId === log.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                          Execute
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && totalCount > pageSize && (
          <div className="px-4 py-3 border-t border-gray-200 flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="text-xs md:text-sm text-gray-600 text-center md:text-left">
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} results
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Previous</span>
              </button>
              <span className="px-3 py-1.5 text-xs md:text-sm text-gray-700 whitespace-nowrap">
                Page {currentPage} of {Math.ceil(totalCount / pageSize)}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(Math.ceil(totalCount / pageSize), currentPage + 1))}
                disabled={currentPage >= Math.ceil(totalCount / pageSize)}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getStatusIcon(selectedLog.status)}
                <h2 className="text-xl font-bold text-gray-900">Webhook Log Details</h2>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Received At</label>
                  <p className="text-gray-900 font-medium mt-1">{formatDate(selectedLog.received_at)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Webhook Key</label>
                  <p className="text-gray-900 font-medium mt-1">{selectedLog.webhook_key_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Source IP</label>
                  <p className="text-gray-900 font-medium mt-1">{selectedLog.source_ip}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Status</label>
                  <div className="mt-1">{getStatusBadge(selectedLog.status)}</div>
                </div>
              </div>

              {selectedLog.error_message && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-red-900">Error Message</h3>
                      <p className="text-red-700 text-sm mt-1">{selectedLog.error_message}</p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-medium text-gray-900 mb-3">Webhook Payload</h3>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm overflow-x-auto">
                  {JSON.stringify(selectedLog.payload, null, 2)}
                </pre>
              </div>

              {selectedLog.accounts_executed && selectedLog.accounts_executed.length > 0 && (
                <div>
                  <h3 className="font-medium text-gray-900 mb-3">Account Execution Results</h3>
                  <div className="space-y-3">
                    {selectedLog.accounts_executed.map((account: any, index: number) => (
                      <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-medium text-gray-900">{account.account_name || 'Unknown Account'}</p>
                            <p className="text-sm text-gray-600 capitalize">{account.broker_name || 'Unknown Broker'}</p>
                          </div>
                          <div className="flex gap-2">
                            {account.order_placed && (
                              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                                Order Placed
                              </span>
                            )}
                            {account.hmt_gtt_created && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                                HMT GTT Created
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                          {account.order_id && (
                            <div>
                              <span className="text-gray-600">Order ID:</span>
                              <span className="text-gray-900 font-medium ml-2">{account.order_id}</span>
                            </div>
                          )}
                          {account.stop_loss && (
                            <div>
                              <span className="text-gray-600">Stop Loss:</span>
                              <span className="text-gray-900 font-medium ml-2">₹{account.stop_loss.toFixed(2)}</span>
                            </div>
                          )}
                          {account.target && (
                            <div>
                              <span className="text-gray-600">Target:</span>
                              <span className="text-gray-900 font-medium ml-2">₹{account.target.toFixed(2)}</span>
                            </div>
                          )}
                          {account.order_error && (
                            <div className="col-span-2">
                              <span className="text-red-600 text-sm">{account.order_error}</span>
                            </div>
                          )}
                          {account.hmt_gtt_error && (
                            <div className="col-span-2">
                              <span className="text-orange-600 text-sm">HMT GTT Error: {account.hmt_gtt_error}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
