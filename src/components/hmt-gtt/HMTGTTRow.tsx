import { memo } from 'react';
import { Edit2, Trash2, TrendingUp } from 'lucide-react';
import { formatIndianCurrency } from '../../lib/formatters';

interface HMTGTTRowProps {
  gtt: any;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (gtt: any) => void;
  onDelete: (id: string) => void;
  showAccount: boolean;
  ltp: number | undefined;
  isConnected: boolean;
  position: any;
}

const HMTGTTRowComponent = ({
  gtt,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
  showAccount,
  ltp,
  isConnected,
  position
}: HMTGTTRowProps) => {
  const isOCO = gtt.condition_type === 'two-leg';
  const currentPrice = ltp ?? 0;

  const calculatePercentage = (triggerValue: number, currentPrice: number): string => {
    if (!currentPrice || currentPrice === 0) return '0% of LTP';
    const percentOfLTP = ((triggerValue - currentPrice) / currentPrice) * 100;
    const absPercent = Math.abs(percentOfLTP);
    const sign = percentOfLTP > 0 ? '+' : '-';
    return `${sign}${absPercent.toFixed(2)}% of LTP`;
  };

  const calculatePnL = () => {
    if (!position || !currentPrice) return null;
    const pnl = (currentPrice - position.average_price) * position.quantity;
    return pnl;
  };

  const isStopLossAboveBreakeven = (): boolean => {
    if (!position || !isOCO) return false;

    const trigger1 = parseFloat(gtt.trigger_price_1) || 0;
    const trigger2 = parseFloat(gtt.trigger_price_2) || 0;

    if (gtt.transaction_type === 'SELL' && position.quantity > 0) {
      // For SELL orders (exiting long), stop loss is the lower trigger
      const stopLoss = Math.min(trigger1, trigger2);
      return stopLoss > position.average_price;
    } else if (gtt.transaction_type === 'BUY' && position.quantity < 0) {
      // For BUY orders (exiting short), stop loss is the higher trigger
      const stopLoss = Math.max(trigger1, trigger2);
      return stopLoss < position.average_price;
    }

    return false;
  };

  const pnl = calculatePnL();
  const showBreakeven = isStopLossAboveBreakeven();

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-2 py-3 text-center align-middle">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(gtt.id)}
          className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
        />
      </td>
      <td className="px-2 py-3 text-xs text-gray-900 align-middle whitespace-nowrap">
        {new Date(gtt.created_at).toLocaleDateString('en-IN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          timeZone: 'Asia/Kolkata'
        })}
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex items-center gap-1.5">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1">
              {isConnected && ltp && (
                <span className="text-[10px] text-green-600 flex-shrink-0">●</span>
              )}
              <span className="text-sm font-medium text-gray-900 truncate">
                {gtt.trading_symbol || 'N/A'}
              </span>
            </div>
            <span className="text-[10px] text-gray-500 uppercase">
              {gtt.exchange}
            </span>
          </div>
          {showBreakeven && (
            <div
              className="flex items-center px-1 py-0.5 bg-green-100 text-green-700 rounded flex-shrink-0"
              title="Stop Loss above breakeven"
            >
              <TrendingUp className="w-3 h-3" />
            </div>
          )}
        </div>
      </td>
      {showAccount && (
        <td className="px-2 py-3 align-middle">
          <div className="text-xs text-gray-900 truncate max-w-[180px]">
            {(gtt.broker_connections?.account_holder_name || gtt.broker_connections?.account_name || 'Account')}
            <span className="text-gray-500 ml-1">({gtt.broker_connections?.client_id || 'No ID'})</span>
          </div>
        </td>
      )}
      <td className="px-2 py-3 align-middle">
        <div className="flex flex-col gap-0.5">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium w-fit ${
            isOCO ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {isOCO ? 'OCO' : 'SINGLE'}
          </span>
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium w-fit ${
            gtt.transaction_type === 'BUY' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
          }`}>
            {gtt.transaction_type}
          </span>
        </div>
      </td>
      <td className="px-2 py-2 align-middle">
        {isOCO ? (
          <div className="space-y-1.5">
            <div className="flex flex-col">
              <span className="text-sm text-gray-900 tabular-nums">₹{gtt.trigger_price_1?.toFixed(2)}</span>
              <span className="text-[10px] text-gray-500 whitespace-nowrap">
                {calculatePercentage(gtt.trigger_price_1, currentPrice)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-gray-900 tabular-nums">₹{gtt.trigger_price_2?.toFixed(2)}</span>
              <span className="text-[10px] text-gray-500 whitespace-nowrap">
                {calculatePercentage(gtt.trigger_price_2, currentPrice)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <span className="text-sm text-gray-900 tabular-nums">₹{gtt.trigger_price_1?.toFixed(2)}</span>
            <span className="text-[10px] text-gray-500 whitespace-nowrap">
              {calculatePercentage(gtt.trigger_price_1, currentPrice)}
            </span>
          </div>
        )}
      </td>
      <td className="px-2 py-3 text-sm text-gray-900 tabular-nums align-middle whitespace-nowrap">
        ₹{currentPrice?.toFixed(2) || 'N/A'}
      </td>
      <td className="px-2 py-3 text-sm text-gray-900 align-middle">
        {gtt.quantity_1}
      </td>
      <td className="px-2 py-3 align-middle">
        {position ? (
          <span className={`text-xs font-medium px-1.5 py-1 rounded tabular-nums whitespace-nowrap ${pnl !== null && pnl >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            ₹{position.average_price?.toFixed(2)}
          </span>
        ) : (
          <span className="text-sm text-gray-400">-</span>
        )}
      </td>
      <td className="px-2 py-3 align-middle">
        {pnl === null ? (
          <span className="text-sm text-gray-400">-</span>
        ) : (
          <span className={`text-sm font-medium tabular-nums whitespace-nowrap ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {pnl >= 0 ? '+' : ''}{formatIndianCurrency(pnl)}
          </span>
        )}
      </td>
      <td className="px-2 py-3 align-middle">
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium uppercase whitespace-nowrap ${
          gtt.status === 'active' ? 'bg-green-100 text-green-700' :
          gtt.status === 'triggered' ? 'bg-blue-100 text-blue-700' :
          gtt.status === 'cancelled' ? 'bg-gray-100 text-gray-700' :
          gtt.status === 'failed' ? 'bg-red-100 text-red-700' :
          'bg-yellow-100 text-yellow-700'
        }`}>
          {gtt.status}
        </span>
      </td>
      <td className="px-2 py-3 align-middle">
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(gtt)}
            disabled={gtt.status !== 'active'}
            className="p-1 text-blue-600 hover:bg-blue-50 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
            title="Edit HMT GTT"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(gtt.id)}
            className="p-1 text-red-600 hover:bg-red-50 rounded transition"
            title="Delete HMT GTT"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
};

export const HMTGTTRow = memo(HMTGTTRowComponent, (prevProps, nextProps) => {
  return (
    prevProps.gtt.id === nextProps.gtt.id &&
    prevProps.gtt.status === nextProps.gtt.status &&
    prevProps.gtt.trigger_price_1 === nextProps.gtt.trigger_price_1 &&
    prevProps.gtt.trigger_price_2 === nextProps.gtt.trigger_price_2 &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.ltp === nextProps.ltp &&
    prevProps.isConnected === nextProps.isConnected &&
    prevProps.showAccount === nextProps.showAccount &&
    prevProps.position?.average_price === nextProps.position?.average_price &&
    prevProps.position?.quantity === nextProps.position?.quantity
  );
});
