# TradingView Webhook Integration Guide

## Overview

The platform now acts as a **secure execution gateway** for TradingView signals. TradingView owns the strategy logic, and this platform handles automated order execution with automatic stop-loss and target management.

## Architecture

```
TradingView Strategy → Webhook Signal → Platform Gateway → MARKET Order + HMT GTT (SL + Target)
```

### Execution Flow

1. **TradingView sends signal** with symbol, action, price, and ATR
2. **Platform validates webhook_key** and logs request (audit trail)
3. **Resolves NFO FUT symbol** (e.g., NIFTY → NIFTY25JANFUT)
4. **Places MARKET order** at broker (MANDATORY FIRST)
5. **Creates HMT GTT** with SL and Target (ONLY after order success)
6. **Notifies user** in real-time via notifications

## Security Features

- **Webhook Key Authentication**: Each key is unique and can be disabled instantly
- **Account Mapping**: Control which broker accounts execute signals
- **Audit Trail**: All requests logged with IP, payload, and execution results
- **Kill Switch**: Disable key immediately to stop all executions

## Database Tables

### webhook_keys
- User-managed authentication keys
- Account mappings (which accounts execute)
- Risk parameters (lot multiplier, SL/Target ATR multipliers)
- Activity tracking (last_used_at)

### tradingview_webhook_logs
- Complete audit trail
- Source IP logging
- Full payload storage
- Execution results per account
- Success/failure status

## UI Features (Strategies Page)

### Webhook Key Management
- **Create Key**: Generate secure webhook key with custom config
- **Account Selection**: Choose which broker accounts execute
- **Risk Config**:
  - Lot Multiplier (e.g., 1x, 2x, 3x lot size)
  - SL Multiplier (e.g., 1.5x ATR)
  - Target Multiplier (e.g., 2.0x ATR)
- **Enable/Disable**: Instant kill switch
- **Regenerate**: Invalidate old key, generate new one
- **Activity Monitoring**: See last used timestamp
- **Copy Key**: One-click copy to clipboard

### Compact UI Design
- Similar to GTT/HMT GTT account selection
- Expandable cards for details
- Inline payload examples
- Quick actions (enable/disable/delete)

## TradingView Setup

### Webhook URL
```
https://[YOUR-PROJECT].supabase.co/functions/v1/tradingview-webhook
```

### Payload Format
```json
{
  "webhook_key": "wk_...",
  "symbol": "NIFTY",
  "exchange": "NSE",
  "action": "BUY",
  "price": 24500.50,
  "atr": 120.75,
  "timeframe": "60"
}
```

### TradingView Alert Setup
1. Create alert on your strategy
2. Set Webhook URL
3. Message body: Use JSON format above
4. Replace `webhook_key` with your generated key
5. Set `symbol`, `action`, `price`, `atr` from strategy variables

### Pine Script Example
```pinescript
// In your strategy
if (buy_signal)
    alert('{"webhook_key":"wk_...","symbol":"NIFTY","exchange":"NSE","action":"BUY","price":' + str.tostring(close) + ',"atr":' + str.tostring(atr_value) + ',"timeframe":"60"}', alert.freq_once_per_bar)
```

## Execution Logic

### NFO FUT Symbol Resolution
- Input: CASH symbol (e.g., "NIFTY")
- Logic: Current month if day ≤ 15, else next month
- Output: NFO FUT tradingsymbol (e.g., "NIFTY25JANFUT")
- Lookup: Fetches from `nfo_instruments` table

### Quantity Calculation
```
Quantity = lot_size × lot_multiplier
```

Example:
- NIFTY lot size = 50
- Lot multiplier = 2
- Quantity = 100

### SL and Target Calculation

**For BUY Signal:**
```
Stop Loss = Entry Price - (ATR × SL Multiplier)
Target = Entry Price + (ATR × Target Multiplier)
```

**For SELL Signal:**
```
Stop Loss = Entry Price + (ATR × SL Multiplier)
Target = Entry Price - (ATR × Target Multiplier)
```

Example (BUY):
- Entry: 24500
- ATR: 120
- SL Multiplier: 1.5
- Target Multiplier: 2.0
- **Stop Loss**: 24500 - (120 × 1.5) = 24320
- **Target**: 24500 + (120 × 2.0) = 24740

### Order Placement (MANDATORY FIRST)
- Type: MARKET
- Product: MIS
- Exchange: NFO
- Symbol: Resolved FUT symbol
- Quantity: Calculated lots
- Records order_id in `orders` table

### HMT GTT Creation (ONLY AFTER ORDER SUCCESS)
- Type: TWO-LEG (OCO)
- Transaction: Opposite of entry (BUY entry → SELL exit)
- Leg 1: Stop Loss trigger
- Leg 2: Target trigger
- Status: Active (monitored 24/7 by HMT engine)
- Linked to order via metadata

## Notifications

Users receive real-time notifications for:
1. **Signal Received**: TradingView alert processed
2. **Order Placed**: MARKET order executed per account
3. **HMT GTT Created**: Stop-loss and target active

Notification includes:
- Symbol and action
- Entry price
- Stop-loss and target prices
- ATR value
- Account name

## Error Handling

### Validation Errors (HTTP 400)
- Missing required fields
- Invalid action (not BUY/SELL)
- No accounts mapped
- Instrument not found

### Authentication Errors (HTTP 401)
- Invalid webhook_key
- Disabled webhook_key

### Execution Errors (HTTP 500)
- Order placement failure (broker API error)
- Network issues
- Database errors

**All errors are logged** in `tradingview_webhook_logs` for debugging.

## Per-Account Execution

If webhook key is mapped to multiple accounts, the platform executes on each:

```json
{
  "success": true,
  "message": "Executed on 2/2 account(s)",
  "accounts": [
    {
      "account_id": "uuid1",
      "account_name": "Account 1",
      "order_placed": true,
      "order_id": "240123000123456",
      "hmt_gtt_created": true,
      "stop_loss": 24320.00,
      "target": 24740.00
    },
    {
      "account_id": "uuid2",
      "account_name": "Account 2",
      "order_placed": true,
      "order_id": "240123000123457",
      "hmt_gtt_created": true,
      "stop_loss": 24320.00,
      "target": 24740.00
    }
  ]
}
```

## Best Practices

### Security
- Never share webhook keys publicly
- Use different keys for live vs paper trading
- Disable keys when not in use
- Monitor `tradingview_webhook_logs` regularly
- Regenerate keys periodically

### Risk Management
- Start with small lot multipliers (1x)
- Test with paper trading first
- Use appropriate SL/Target multipliers for strategy
- Monitor HMT engine health
- Check notifications after each signal

### Testing
1. Create test webhook key
2. Map to paper trading account
3. Send manual test payload using cURL/Postman
4. Verify order placement and HMT GTT creation
5. Check logs for any errors

### Example Test Request
```bash
curl -X POST https://[YOUR-PROJECT].supabase.co/functions/v1/tradingview-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_key": "wk_your_test_key",
    "symbol": "NIFTY",
    "exchange": "NSE",
    "action": "BUY",
    "price": 24500.50,
    "atr": 120.75,
    "timeframe": "60"
  }'
```

## Monitoring

### Check Execution Logs
Query `tradingview_webhook_logs` to see:
- All incoming signals
- Execution success/failure
- Error messages
- Response times

### Check Notifications
- Real-time notifications in UI
- Filter by type = 'trade'
- See full execution details

### Check HMT Engine
- Verify engine is running (HMT GTT page)
- Check active triggers
- Monitor trigger execution

## Limitations

### Current Implementation
- Only supports NFO FUT contracts
- Only MARKET orders (no LIMIT support)
- ATR must be calculated in TradingView
- No position size optimization (fixed lots)

### Future Enhancements
- Support for OPTIONS trading
- Dynamic position sizing based on account balance
- Multiple exit strategies (trailing SL, partial exits)
- Advanced order types (LIMIT, SL-M)
- Backtesting integration

## Troubleshooting

### Order Not Placed
1. Check webhook key is active
2. Verify accounts are mapped and active
3. Check broker token hasn't expired
4. Verify sufficient margin
5. Check market hours

### HMT GTT Not Created
1. Verify order was placed successfully
2. Check HMT engine is running
3. Verify instrument token exists
4. Check error_message in logs

### Symbol Not Found
1. Verify NFO instruments are synced
2. Check symbol spelling (must be exact)
3. Verify current/next month FUT exists
4. Check expiry date logic (day 15 cutoff)

## Migration from Old Strategy System

The old `strategies` table with `webhook_key` column is **deprecated**. New system uses:
- `webhook_keys` table (managed separately)
- Direct account mapping
- Simplified configuration
- Better audit trail

Old TradingView alerts will NOT work. You must:
1. Create new webhook keys
2. Update TradingView alerts with new keys
3. Configure account mappings

---

## Summary

✅ **Secure**: Webhook authentication, audit trail, instant disable
✅ **Automated**: MARKET order + HMT GTT (SL + Target)
✅ **Flexible**: Per-key account mapping and risk config
✅ **Monitored**: Real-time notifications, complete logs
✅ **Production-Ready**: Server-side execution, no browser needed
