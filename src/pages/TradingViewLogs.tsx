import { useState, useEffect, useMemo } from 'react';
import { Search, Filter, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight, Play, Download, Trash2 } from 'lucide-react';
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
  response_message?: string;
  accounts_executed?: any[];
}

export function TradingViewLogs() {
  const { user, session } = useAuth();
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [allLogsForFilters, setAllLogsForFilters] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [symbolFilter, setSymbolFilter] = useState<string>('all');
  const [entryPhaseFilter, setEntryPhaseFilter] = useState<string>('all');
  const [tradeGradeFilter, setTradeGradeFilter] = useState<string>('all');
  const [tradeScoreFilter, setTradeScoreFilter] = useState<string>('all');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;
  const [executingLogId, setExecutingLogId] = useState<string | null>(null);
  const [executeMessage, setExecuteMessage] = useState('');
  const [executeError, setExecuteError] = useState('');
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [logToDelete, setLogToDelete] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      loadLogs();
      loadFilterOptions();
    }
  }, [user, dateFilter, statusFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, symbolFilter, entryPhaseFilter, tradeGradeFilter, tradeScoreFilter, tradeTypeFilter]);

  const loadFilterOptions = async () => {
    try {
      const { data } = await supabase
        .from('tradingview_webhook_logs')
        .select(`
          payload,
          webhook_keys!inner(user_id)
        `)
        .eq('webhook_keys.user_id', user?.id)
        .limit(1000);

      if (data) {
        setAllLogsForFilters(data as any[]);
      }
    } catch (err) {
      console.error('Error loading filter options:', err);
    }
  };

  const loadLogs = async () => {
    setLoading(true);

    try {
      console.log('Loading logs for user:', user?.id);

      const { data: userWebhookKeys } = await supabase
        .from('webhook_keys')
        .select('id')
        .eq('user_id', user?.id);

      const webhookKeyIds = userWebhookKeys?.map(k => k.id) || [];

      if (webhookKeyIds.length === 0) {
        console.log('No webhook keys found for user');
        setLogs([]);
        setLoading(false);
        return;
      }

      let query = supabase
        .from('tradingview_webhook_logs')
        .select(`
          *,
          webhook_keys(
            user_id,
            name
          )
        `)
        .in('webhook_key_id', webhookKeyIds)
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

      query = query.limit(1000);

      const { data, error } = await query;

      console.log('Query result:', { data, error, count: data?.length });

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
      } else {
        setLogs([]);
      }
    } catch (err) {
      console.error('Exception loading logs:', err);
      setLogs([]);
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
        body: JSON.stringify({
          ...log.payload,
          _execution_mode: 'MANUAL'
        })
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

  const handleDeleteConfirm = (logId: string) => {
    setLogToDelete(logId);
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    if (!logToDelete) return;

    setDeletingLogId(logToDelete);
    setDeleteError('');
    setDeleteMessage('');

    try {
      const { error } = await supabase
        .from('tradingview_webhook_logs')
        .delete()
        .eq('id', logToDelete);

      if (error) throw error;

      setDeleteMessage('Log deleted successfully');
      setTimeout(() => setDeleteMessage(''), 3000);
      loadLogs();
      setSelectedLogs(prev => {
        const newSet = new Set(prev);
        newSet.delete(logToDelete);
        return newSet;
      });
    } catch (err: any) {
      console.error('Error deleting log:', err);
      setDeleteError(`Failed to delete: ${err.message}`);
      setTimeout(() => setDeleteError(''), 5000);
    } finally {
      setDeletingLogId(null);
      setShowDeleteConfirm(false);
      setLogToDelete(null);
    }
  };

  const handleBulkDeleteConfirm = () => {
    setShowBulkDeleteConfirm(true);
  };

  const handleBulkDelete = async () => {
    if (selectedLogs.size === 0) return;

    setDeleteError('');
    setDeleteMessage('');

    try {
      const { error } = await supabase
        .from('tradingview_webhook_logs')
        .delete()
        .in('id', Array.from(selectedLogs));

      if (error) throw error;

      setDeleteMessage(`Successfully deleted ${selectedLogs.size} log(s)`);
      setTimeout(() => setDeleteMessage(''), 3000);
      setSelectedLogs(new Set());
      loadLogs();
    } catch (err: any) {
      console.error('Error deleting logs:', err);
      setDeleteError(`Failed to delete: ${err.message}`);
      setTimeout(() => setDeleteError(''), 5000);
    } finally {
      setShowBulkDeleteConfirm(false);
    }
  };

  const toggleSelectLog = (logId: string) => {
    setSelectedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedLogs.size === paginatedLogs.length) {
      setSelectedLogs(new Set());
    } else {
      setSelectedLogs(new Set(paginatedLogs.map(log => log.id)));
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch =
        log.payload?.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.webhook_key_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.payload?.trade_type?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesSymbol = symbolFilter === 'all' || log.payload?.symbol === symbolFilter;
      const matchesEntryPhase = entryPhaseFilter === 'all' || log.payload?.entry_phase === entryPhaseFilter;
      const matchesTradeGrade = tradeGradeFilter === 'all' || log.payload?.trade_grade === tradeGradeFilter;
      const matchesTradeScore = tradeScoreFilter === 'all' || log.payload?.trade_score?.toString() === tradeScoreFilter;
      const matchesTradeType = tradeTypeFilter === 'all' || log.payload?.trade_type === tradeTypeFilter;

      return matchesSearch && matchesSymbol && matchesEntryPhase && matchesTradeGrade && matchesTradeScore && matchesTradeType;
    });
  }, [logs, searchTerm, symbolFilter, entryPhaseFilter, tradeGradeFilter, tradeScoreFilter, tradeTypeFilter]);

  const uniqueSymbols = useMemo(() => {
    const symbols = new Set(allLogsForFilters.map(log => log.payload?.symbol).filter(Boolean));
    return Array.from(symbols).sort();
  }, [allLogsForFilters]);

  const uniqueEntryPhases = useMemo(() => {
    const phases = new Set(allLogsForFilters.map(log => log.payload?.entry_phase).filter(Boolean));
    return Array.from(phases).sort();
  }, [allLogsForFilters]);

  const uniqueTradeGrades = useMemo(() => {
    const grades = new Set(allLogsForFilters.map(log => log.payload?.trade_grade).filter(Boolean));
    return Array.from(grades).sort();
  }, [allLogsForFilters]);

  const uniqueTradeScores = useMemo(() => {
    const scores = new Set(allLogsForFilters.map(log => log.payload?.trade_score).filter(Boolean));
    return Array.from(scores).sort((a, b) => Number(a) - Number(b));
  }, [allLogsForFilters]);

  const uniqueTradeTypes = useMemo(() => {
    const types = new Set(allLogsForFilters.map(log => log.payload?.trade_type).filter(Boolean));
    return Array.from(types).sort();
  }, [allLogsForFilters]);

  const exportToCSV = () => {
    const headers = [
      'Date',
      'Time',
      'adx',
      'atr',
      'ema21',
      'event',
      'price',
      'reason',
      'symbol',
      'volume',
      'di_plus',
      'adx_prev',
      'di_minus',
      'strategy',
      'sl_points',
      'trade_type',
      'vol_avg_5d',
      'entry_phase',
      'trade_grade',
      'trade_score',
      'target_points',
      'dist_ema21_atr'
    ];

    const rows = filteredLogs.map(log => {
      const date = new Date(log.received_at);
      const dateStr = date.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const timeStr = date.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      return [
        dateStr,
        timeStr,
        log.payload?.adx || '',
        log.payload?.atr || '',
        log.payload?.ema21 || '',
        log.payload?.event || '',
        log.payload?.price || '',
        log.payload?.reason || '',
        log.payload?.symbol || '',
        log.payload?.volume || '',
        log.payload?.di_plus || '',
        log.payload?.adx_prev || '',
        log.payload?.di_minus || '',
        log.payload?.strategy || '',
        log.payload?.sl_points || '',
        log.payload?.trade_type || '',
        log.payload?.vol_avg_5d || '',
        log.payload?.entry_phase || '',
        log.payload?.trade_grade || '',
        log.payload?.trade_score || '',
        log.payload?.target_points || '',
        log.payload?.dist_ema21_atr || ''
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => {
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `tradingview_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredLogs.slice(startIndex, endIndex);
  }, [filteredLogs, currentPage, pageSize]);

  const stats = useMemo(() => ({
    total: filteredLogs.length,
    success: filteredLogs.filter(l => l.status === 'success').length,
    failed: filteredLogs.filter(l => l.status === 'failed').length,
    rejected: filteredLogs.filter(l => l.status === 'rejected' || l.status === 'rejected_time_window').length
  }), [filteredLogs]);

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

      {deleteMessage && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          {deleteMessage}
        </div>
      )}

      {deleteError && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
          {deleteError}
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
        <div className="p-4 border-b border-gray-200 space-y-3">
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

            <button
              onClick={exportToCSV}
              disabled={filteredLogs.length === 0}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>

            {selectedLogs.size > 0 && (
              <button
                onClick={handleBulkDeleteConfirm}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                Delete ({selectedLogs.size})
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
            </select>

            <select
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="all">All Symbols</option>
              {uniqueSymbols.map(symbol => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>

            <select
              value={tradeTypeFilter}
              onChange={(e) => setTradeTypeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="all">All Trade Types</option>
              {uniqueTradeTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <select
              value={entryPhaseFilter}
              onChange={(e) => setEntryPhaseFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="all">All Entry Phases</option>
              {uniqueEntryPhases.map(phase => (
                <option key={phase} value={phase}>{phase}</option>
              ))}
            </select>

            <select
              value={tradeGradeFilter}
              onChange={(e) => setTradeGradeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="all">All Trade Grades</option>
              {uniqueTradeGrades.map(grade => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>

            <select
              value={tradeScoreFilter}
              onChange={(e) => setTradeScoreFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="all">All Trade Scores</option>
              {uniqueTradeScores.map(score => (
                <option key={score} value={score.toString()}>{score}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
            Loading webhook logs...
          </div>
        ) : paginatedLogs.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Filter className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium">No logs found</p>
            <p className="text-sm mt-1">Try adjusting your filters or search criteria</p>
          </div>
        ) : (
          <>
            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {paginatedLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                      <input
                        type="checkbox"
                        checked={selectedLogs.has(log.id)}
                        onChange={() => toggleSelectLog(log.id)}
                        className="w-4 h-4 mt-1 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 text-sm">{log.payload?.symbol || '-'}</div>
                        {log.payload?.strategy && (
                          <div className="text-xs text-blue-600 font-medium mt-0.5">{log.payload.strategy}</div>
                        )}
                        <div className="text-xs text-gray-500 mt-0.5">{formatDate(log.received_at)}</div>
                      </div>
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

                  {log.response_message && (
                    <div className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded">
                      {log.response_message}
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
                    <button
                      onClick={() => handleDeleteConfirm(log.id)}
                      disabled={deletingLogId === log.id}
                      className="py-2 px-4 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-sm font-medium transition disabled:opacity-50"
                      title="Delete log"
                    >
                      {deletingLogId === log.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
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
                  <th className="px-4 py-3 w-12">
                    <input
                      type="checkbox"
                      checked={paginatedLogs.length > 0 && selectedLogs.size === paginatedLogs.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Webhook Key</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Strategy</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trade Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accounts</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedLogs.has(log.id)}
                        onChange={() => toggleSelectLog(log.id)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </td>
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
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {log.payload?.strategy || '-'}
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
                        </button>
                        <button
                          onClick={() => handleDeleteConfirm(log.id)}
                          disabled={deletingLogId === log.id}
                          className="text-red-600 hover:text-red-700 disabled:opacity-50"
                          title="Delete log"
                        >
                          {deletingLogId === log.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
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

        {!loading && filteredLogs.length > pageSize && (
          <div className="px-4 py-3 border-t border-gray-200 flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="text-xs md:text-sm text-gray-600 text-center md:text-left">
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} results
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
                Page {currentPage} of {Math.ceil(filteredLogs.length / pageSize)}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(Math.ceil(filteredLogs.length / pageSize), currentPage + 1))}
                disabled={currentPage >= Math.ceil(filteredLogs.length / pageSize)}
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
                  <label className="text-sm font-medium text-gray-500">Symbol</label>
                  <p className="text-gray-900 font-medium mt-1">{selectedLog.payload?.symbol || '-'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Strategy</label>
                  <p className="text-gray-900 font-medium mt-1">{selectedLog.payload?.strategy || '-'}</p>
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

              {selectedLog.response_message && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-green-900">Response Message</h3>
                      <p className="text-green-700 text-sm mt-1">{selectedLog.response_message}</p>
                    </div>
                  </div>
                </div>
              )}

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
                          <div className="flex gap-2 flex-wrap justify-end">
                            {account.filter_passed === false && (
                              <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded">
                                Filtered
                              </span>
                            )}
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
                          {account.filter_passed === false && account.filter_reason && (
                            <div className="col-span-2 bg-orange-50 border border-orange-200 rounded p-2">
                              <span className="text-orange-800 text-sm font-medium">Signal Filtered: </span>
                              <span className="text-orange-700 text-sm">{account.filter_reason}</span>
                            </div>
                          )}
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

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-bold text-gray-900">Confirm Delete</h2>
            </div>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this webhook log? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setLogToDelete(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-bold text-gray-900">Confirm Bulk Delete</h2>
            </div>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete {selectedLogs.size} selected log(s)? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Delete {selectedLogs.size} Log(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
