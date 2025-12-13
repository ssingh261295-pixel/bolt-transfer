# HMT Trigger Engine - Server-Side Event-Driven GTT System

## Overview

The HMT (Host-Monitored Trigger) Engine is a fully server-side, event-driven trigger system that monitors live market prices via WebSocket and automatically executes orders when trigger conditions are met. This system operates independently of the browser and runs 24/7 on Supabase Edge Functions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HMT Trigger Engine                        │
│                  (Supabase Edge Function)                    │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Trigger    │  │   WebSocket  │  │    Order     │     │
│  │   Manager    │  │   Manager    │  │  Executor    │     │
│  │              │  │              │  │              │     │
│  │ • In-memory  │  │ • Zerodha WS │  │ • API calls  │     │
│  │   storage    │  │ • Auto       │  │ • Retry      │     │
│  │ • O(1)       │  │   reconnect  │  │   logic      │     │
│  │   lookup     │  │ • Tick dist. │  │ • Async      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │            │
│         └──────────────────┴──────────────────┘            │
│                            │                               │
└────────────────────────────┼───────────────────────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │   Supabase Postgres     │
                │  • hmt_gtt_orders       │
                │  • Real-time changes    │
                └─────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │   Browser UI   │
                    │  • Read-only   │
                    │  • CRUD ops    │
                    │  • Live prices │
                    └────────────────┘
```

## Key Features

### 1. **Event-Driven Architecture**
- No polling or timers
- Reacts to WebSocket ticks in real-time
- Sub-100ms execution target

### 2. **In-Memory Trigger Storage**
- O(1) lookup by instrument_token
- Grouped by instrument for fast processing
- Automatic synchronization with database

### 3. **OCO (One-Cancels-Other) Support**
- Two-leg triggers (stop-loss + target)
- Atomic execution (only one leg executes)
- Automatic cancellation of opposite leg

### 4. **High Performance**
- Handles 100+ concurrent triggers
- Non-blocking database writes
- Efficient WebSocket subscription management

### 5. **Reliability**
- Automatic WebSocket reconnection
- Retry logic with exponential backoff
- Idempotent execution (prevents duplicates)
- Health monitoring and stats tracking

## Components

### 1. **Trigger Manager** (`trigger-manager.ts`)
- Maintains in-memory trigger storage
- Provides O(1) lookup by instrument_token
- Tracks OCO groups and processing state

### 2. **WebSocket Manager** (`websocket-manager.ts`)
- Manages Zerodha WebSocket connection
- Handles automatic reconnection
- Distributes ticks to handler (non-blocking)

### 3. **Trigger Evaluator** (`trigger-evaluator.ts`)
- Evaluates trigger conditions against live prices
- Supports SINGLE and OCO trigger types
- Fast, pure function evaluation

### 4. **Order Executor** (`order-executor.ts`)
- Places orders via Zerodha API
- Implements retry logic with exponential backoff
- Handles non-retryable errors intelligently

## Trigger Types

### SINGLE Trigger
A simple trigger with one condition:
- **BUY**: Triggers when LTP >= trigger_price
- **SELL**: Triggers when LTP <= trigger_price

### TWO-LEG (OCO) Trigger
An OCO trigger with two conditions (typically stop-loss + target):
- **Leg 1** (usually stop-loss):
  - BUY: Triggers when LTP >= trigger_price_1
  - SELL: Triggers when LTP <= trigger_price_1
- **Leg 2** (usually target):
  - BUY: Triggers when LTP <= trigger_price_2
  - SELL: Triggers when LTP >= trigger_price_2

When one leg triggers, the other is automatically cancelled.

## Database Schema

The system uses the existing `hmt_gtt_orders` table with optimized indexes:

```sql
-- Critical index for O(1) lookup
CREATE INDEX idx_hmt_gtt_orders_instrument_status
  ON hmt_gtt_orders(instrument_token, status)
  WHERE status = 'active';
```

## API Endpoints

### Health Check
```
GET /hmt-trigger-engine/health
```
Returns engine status, stats, and configuration.

### Start Engine
```
POST /hmt-trigger-engine/start
```
Starts the trigger engine if not already running.

### Stop Engine
```
POST /hmt-trigger-engine/stop
```
Gracefully stops the trigger engine.

### Stats
```
GET /hmt-trigger-engine/stats
```
Returns real-time statistics:
- Active triggers count
- Subscribed instruments
- Processed ticks
- Triggered orders
- Failed orders
- Uptime

## Configuration

Set these environment variables in Supabase:

```bash
HMT_ENGINE_ENABLED=true           # Enable/disable engine (kill switch)
HMT_MAX_RETRIES=2                 # Max order placement retries
HMT_RETRY_BACKOFF_MS=1000        # Retry delay (exponential backoff)
HMT_HEALTH_CHECK_INTERVAL_MS=30000  # Health check interval
HMT_RECONNECT_DELAY_MS=5000      # WebSocket reconnect delay
```

## Execution Flow

### On Startup
1. Load all active triggers from database into memory
2. Get active broker connection (API key + access token)
3. Connect to Zerodha WebSocket
4. Subscribe to all instrument tokens
5. Start health check monitor
6. Subscribe to database changes for real-time CRUD

### On Tick Received
1. **O(1) Lookup**: Get all triggers for this instrument
2. **Evaluate**: Check trigger conditions
3. **Mark Processing**: Prevent duplicate execution
4. **Execute**: Place order via Zerodha API (async)
5. **Update Database**: Save result (non-blocking)
6. **Handle OCO**: Cancel sibling trigger if applicable
7. **Remove**: Clean up from memory

### On Trigger Created (from UI)
1. Database INSERT triggers real-time subscription
2. Engine adds trigger to in-memory storage
3. Subscribe to new instrument token if needed

### On Trigger Updated (from UI)
1. Database UPDATE triggers real-time subscription
2. Engine removes old version, adds new if still active

### On Trigger Deleted (from UI)
1. Database DELETE triggers real-time subscription
2. Engine removes trigger from memory

## Performance Characteristics

- **Tick Processing**: < 1ms per tick (hot path)
- **Condition Evaluation**: < 0.1ms per trigger
- **Order Placement**: 50-200ms (network dependent)
- **Database Writes**: Async, non-blocking
- **Memory Usage**: ~1KB per trigger
- **Scalability**: 100+ triggers without degradation

## Error Handling

### Retryable Errors
- Network timeouts
- API rate limits
- Temporary broker errors

### Non-Retryable Errors
- Insufficient funds
- Invalid symbol
- Market closed
- Order parameters invalid

### Failure Recovery
- Failed orders marked as 'failed' with error message
- Logs structured for debugging
- Engine continues processing other triggers

## Security

- All secrets stored in Supabase environment variables
- API calls authenticated with service role key
- RLS policies enforce user isolation
- Idempotent execution prevents duplicates

## Browser UI

The UI is now **read-only** for monitoring:
- Displays triggers from database
- Shows real-time engine status
- Live price updates for display only
- CRUD operations update database only
- Engine handles all execution

## Deployment

The edge function is deployed automatically to Supabase. To manually deploy:

```bash
# Deploy using Supabase CLI (if available)
supabase functions deploy hmt-trigger-engine

# Or use the deploy tool in your project
```

## Monitoring

Monitor the engine using:
1. **Health Endpoint**: Check `/health` for status
2. **Stats Endpoint**: Get real-time metrics
3. **Database Logs**: Check `hmt_gtt_orders` table
4. **Browser UI**: View engine status card

## Troubleshooting

### Engine Not Starting
- Check `HMT_ENGINE_ENABLED` environment variable
- Verify broker connection is active
- Check logs for errors

### No Ticks Received
- Verify WebSocket connection status
- Check if instruments are subscribed
- Ensure market is open

### Orders Not Executing
- Check trigger conditions
- Verify broker API key and access token
- Check order placement logs
- Verify sufficient funds/margin

## Future Enhancements

Potential improvements:
- Redis/KV storage for distributed triggers
- Multiple broker support
- Advanced order types (limit, SL-M)
- Backtesting capability
- Performance metrics dashboard
