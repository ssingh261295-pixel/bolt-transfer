import { memo, useState, useRef, useEffect } from 'react';
import { Edit2, Trash2, TrendingUp, MoreVertical, ArrowRightLeft } from 'lucide-react';
import { formatIndianCurrency } from '../../lib/formatters';

interface HMTGTTRowProps {
  gtt: any;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (gtt: any) => void;
  onDelete: (id: string) => void;
  onConvertToGTT: (gtt: any) => void;
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
  onConvertToGTT,
  showAccount,
  ltp,
  isConnected,
  position
}: HMTGTTRowProps) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOCO = gtt.condition_type === 'two-leg';
  const currentPrice = ltp ?? 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      <td className="px-4 py-3 text-center align-middle">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(gtt.id)}
          className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
        />
      </td>
      <td className="px-4 py-3 text-sm text-gray-900 align-middle whitespace-nowrap">
        {new Date(gtt.created_at).toLocaleDateString('en-IN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          timeZone: 'Asia/Kolkata'
        })}
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-gray-900">
            {gtt.trading_symbol || 'N/A'}
          </div>
          {showBreakeven && (
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium"
              title="Stop Loss above breakeven"
            >
              <TrendingUp className="w-3 h-3" />
            </div>
          )}
        </div>
      </td>
      {showAccount && (
        <td className="px-4 py-3 align-middle">
          <div className="text-sm text-gray-900">
            {(gtt.broker_connections?.account_holder_name || gtt.broker_connections?.account_name || 'Account')} ({gtt.broker_connections?.client_id || 'No ID'})
          </div>
        </td>
      )}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium w-fit ${
            isOCO ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {isOCO ? 'OCO' : 'SINGLE'}
          </span>
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium w-fit ${
            gtt.transaction_type === 'BUY' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
          }`}>
            {gtt.transaction_type}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 align-middle">
        {isOCO ? (
          <div className="text-sm space-y-1">
            <div className="text-gray-900">
              ₹{gtt.trigger_price_1?.toFixed(2)}
              <span className="text-xs text-gray-500 ml-1">
                {calculatePercentage(gtt.trigger_price_1, currentPrice)}
              </span>
            </div>
            <div className="text-gray-900">
              ₹{gtt.trigger_price_2?.toFixed(2)}
              <span className="text-xs text-gray-500 ml-1">
                {calculatePercentage(gtt.trigger_price_2, currentPrice)}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-900">
            ₹{gtt.trigger_price_1?.toFixed(2)}
            <span className="text-xs text-gray-500 ml-1">
              {calculatePercentage(gtt.trigger_price_1, currentPrice)}
            </span>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900 align-middle">
        ₹{currentPrice?.toFixed(2) || 'N/A'}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900 align-middle">
        {gtt.transaction_type === 'SELL' ? gtt.quantity_1 : -gtt.quantity_1}
      </td>
      <td className="px-4 py-3 align-middle">
        {position ? (
          <span className="text-sm font-medium text-gray-900">
            ₹{position.average_price?.toFixed(2)}
          </span>
        ) : (
          <span className="text-sm text-gray-400">-</span>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        {pnl === null ? (
          <span className="text-sm text-gray-400">-</span>
        ) : (
          <span className={`text-sm font-medium px-2 py-1 rounded ${pnl >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {pnl >= 0 ? '+' : ''}{formatIndianCurrency(pnl)}
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium uppercase ${
          gtt.status === 'active' ? 'bg-green-100 text-green-700' :
          gtt.status === 'triggered' ? 'bg-blue-100 text-blue-700' :
          gtt.status === 'cancelled' ? 'bg-gray-100 text-gray-700' :
          gtt.status === 'failed' ? 'bg-red-100 text-red-700' :
          'bg-yellow-100 text-yellow-700'
        }`}>
          {gtt.status}
        </span>
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition"
            title="Actions"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-[100] overflow-visible">
              <div className="py-1">
                <button
                  onClick={() => {
                    onEdit(gtt);
                    setShowMenu(false);
                  }}
                  disabled={gtt.status !== 'active'}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit HMT GTT
                </button>
                <button
                  onClick={() => {
                    onConvertToGTT(gtt);
                    setShowMenu(false);
                  }}
                  disabled={gtt.status !== 'active'}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  HMT to GTT
                </button>
                <button
                  onClick={() => {
                    onDelete(gtt.id);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-red-600 hover:bg-red-50 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          )}
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
    prevProps.gtt.quantity_1 === nextProps.gtt.quantity_1 &&
    prevProps.gtt.order_price_1 === nextProps.gtt.order_price_1 &&
    prevProps.gtt.order_price_2 === nextProps.gtt.order_price_2 &&
    prevProps.gtt.product_type_1 === nextProps.gtt.product_type_1 &&
    prevProps.gtt.product_type_2 === nextProps.gtt.product_type_2 &&
    prevProps.gtt.condition_type === nextProps.gtt.condition_type &&
    prevProps.gtt.transaction_type === nextProps.gtt.transaction_type &&
    prevProps.gtt.trading_symbol === nextProps.gtt.trading_symbol &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.ltp === nextProps.ltp &&
    prevProps.isConnected === nextProps.isConnected &&
    prevProps.showAccount === nextProps.showAccount &&
    prevProps.position?.average_price === nextProps.position?.average_price &&
    prevProps.position?.quantity === nextProps.position?.quantity
  );
});
