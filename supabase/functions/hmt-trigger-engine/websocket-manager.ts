/**
 * WebSocket Manager - Manages Zerodha WebSocket connection
 * Handles connection, reconnection, and tick distribution
 */

import { WebSocketTick } from './types.ts';

type TickHandler = (tick: WebSocketTick) => void;

export class WebSocketManager {
  private apiKey: string;
  private accessToken: string;
  private ws: WebSocket | null = null;
  private subscribedTokens: Set<number> = new Set();
  private tickHandler: TickHandler | null = null;
  private reconnectDelay: number;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private reconnectTimer: number | null = null;
  private lastTickTime: Date | null = null;
  private tickCount: number = 0;

  constructor(
    apiKey: string,
    accessToken: string,
    reconnectDelay: number = 5000
  ) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
    this.reconnectDelay = reconnectDelay;
  }

  /**
   * Set the handler for incoming ticks
   */
  setTickHandler(handler: TickHandler): void {
    this.tickHandler = handler;
  }

  /**
   * Connect to Zerodha WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;
    console.log('[WebSocketManager] Connecting to Zerodha WebSocket...');

    try {
      const wsUrl = `wss://ws.kite.trade/?api_key=${this.apiKey}&access_token=${this.accessToken}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocketManager] Connected to Zerodha WebSocket');
        this.isConnecting = false;

        // Resubscribe to all tokens after reconnection
        if (this.subscribedTokens.size > 0) {
          this.resubscribe();
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocketManager] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('[WebSocketManager] WebSocket connection closed');
        this.isConnecting = false;
        this.ws = null;

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('[WebSocketManager] Connection error:', error);
      this.isConnecting = false;
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Subscribe to instrument tokens
   */
  subscribe(tokens: number[]): void {
    if (tokens.length === 0) return;

    tokens.forEach(token => this.subscribedTokens.add(token));

    if (this.ws?.readyState === WebSocket.OPEN) {
      const message = {
        a: 'subscribe',
        v: tokens
      };
      this.ws.send(JSON.stringify(message));
      console.log(`[WebSocketManager] Subscribed to ${tokens.length} instruments`);

      // Set mode to full for detailed data
      const modeMessage = {
        a: 'mode',
        v: ['full', tokens]
      };
      this.ws.send(JSON.stringify(modeMessage));
    }
  }

  /**
   * Unsubscribe from instrument tokens
   */
  unsubscribe(tokens: number[]): void {
    if (tokens.length === 0) return;

    tokens.forEach(token => this.subscribedTokens.delete(token));

    if (this.ws?.readyState === WebSocket.OPEN) {
      const message = {
        a: 'unsubscribe',
        v: tokens
      };
      this.ws.send(JSON.stringify(message));
      console.log(`[WebSocketManager] Unsubscribed from ${tokens.length} instruments`);
    }
  }

  /**
   * Resubscribe to all tokens (after reconnection)
   */
  private resubscribe(): void {
    const tokens = Array.from(this.subscribedTokens);
    if (tokens.length > 0) {
      this.subscribe(tokens);
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: any): void {
    try {
      // Handle binary data (more efficient)
      if (data instanceof ArrayBuffer || data instanceof Blob) {
        // Zerodha sends binary tick data - parse accordingly
        // For simplicity, we'll handle JSON for now
        return;
      }

      // Handle JSON data
      const message = typeof data === 'string' ? JSON.parse(data) : data;

      if (message.type === 'order') {
        // Ignore order updates
        return;
      }

      // Process tick data
      if (Array.isArray(message)) {
        message.forEach(tick => this.processTick(tick));
      } else if (message.instrument_token && message.last_price) {
        this.processTick(message);
      }
    } catch (error) {
      console.error('[WebSocketManager] Error handling message:', error);
    }
  }

  /**
   * Process individual tick
   */
  private processTick(tickData: any): void {
    if (!tickData.instrument_token || !tickData.last_price) {
      return;
    }

    const tick: WebSocketTick = {
      instrument_token: tickData.instrument_token,
      last_price: tickData.last_price,
      timestamp: new Date()
    };

    this.lastTickTime = tick.timestamp!;
    this.tickCount++;

    if (this.tickHandler) {
      // Async, non-blocking tick processing
      Promise.resolve(this.tickHandler(tick)).catch(error => {
        console.error('[WebSocketManager] Error in tick handler:', error);
      });
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    console.log(`[WebSocketManager] Scheduling reconnect in ${this.reconnectDelay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log('[WebSocketManager] Disconnected');
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get last tick time
   */
  getLastTickTime(): Date | null {
    return this.lastTickTime;
  }

  /**
   * Get tick count
   */
  getTickCount(): number {
    return this.tickCount;
  }

  /**
   * Get subscribed instrument count
   */
  getSubscribedCount(): number {
    return this.subscribedTokens.size;
  }
}
