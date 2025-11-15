export interface Tick {
  instrument_token: number;
  mode: string;
  tradable: boolean;
  last_price: number;
  last_traded_quantity?: number;
  average_traded_price?: number;
  volume_traded?: number;
  total_buy_quantity?: number;
  total_sell_quantity?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  change?: number;
  last_trade_time?: Date;
  oi?: number;
  oi_day_high?: number;
  oi_day_low?: number;
  timestamp?: Date;
  depth?: {
    buy: Array<{ quantity: number; price: number; orders: number }>;
    sell: Array<{ quantity: number; price: number; orders: number }>;
  };
}

type TickCallback = (ticks: Tick[]) => void;
type ErrorCallback = (error: Error) => void;
type ConnectCallback = () => void;
type DisconnectCallback = (code: number, reason: string) => void;

export class ZerodhaWebSocket {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private accessToken: string;
  private subscribedTokens: Set<number> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private pingInterval: number | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  private onTickCallback: TickCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;
  private onConnectCallback: ConnectCallback | null = null;
  private onDisconnectCallback: DisconnectCallback | null = null;

  constructor(apiKey: string, accessToken: string) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
  }

  connect(): void {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    const url = `wss://ws.kite.trade?api_key=${this.apiKey}&access_token=${this.accessToken}`;

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        console.log('[Zerodha WS] Connected');

        this.startPing();

        if (this.subscribedTokens.size > 0) {
          this.resubscribe();
        }

        if (this.onConnectCallback) {
          this.onConnectCallback();
        }
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const ticks = this.parseBinary(event.data);
          if (ticks.length > 0 && this.onTickCallback) {
            this.onTickCallback(ticks);
          }
        }
      };

      this.ws.onerror = (error) => {
        console.error('[Zerodha WS] Error:', error);
        if (this.onErrorCallback) {
          this.onErrorCallback(new Error('WebSocket error'));
        }
      };

      this.ws.onclose = (event) => {
        this.isConnecting = false;
        console.log(`[Zerodha WS] Disconnected: ${event.code} - ${event.reason}`);

        this.stopPing();

        if (this.onDisconnectCallback) {
          this.onDisconnectCallback(event.code, event.reason);
        }

        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`[Zerodha WS] Reconnecting... Attempt ${this.reconnectAttempts}`);
          setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
        }
      };
    } catch (error) {
      this.isConnecting = false;
      console.error('[Zerodha WS] Connection error:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error as Error);
      }
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(tokens: number[]): void {
    tokens.forEach(token => this.subscribedTokens.add(token));

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendMessage({
        a: 'subscribe',
        v: tokens,
      });
    }
  }

  unsubscribe(tokens: number[]): void {
    tokens.forEach(token => this.subscribedTokens.delete(token));

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendMessage({
        a: 'unsubscribe',
        v: tokens,
      });
    }
  }

  setMode(mode: 'ltp' | 'quote' | 'full', tokens: number[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendMessage({
        a: 'mode',
        v: [mode, tokens],
      });
    }
  }

  onTick(callback: TickCallback): void {
    this.onTickCallback = callback;
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallback = callback;
  }

  onConnect(callback: ConnectCallback): void {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback: DisconnectCallback): void {
    this.onDisconnectCallback = callback;
  }

  getSubscribedTokens(): number[] {
    return Array.from(this.subscribedTokens);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private resubscribe(): void {
    const tokens = Array.from(this.subscribedTokens);
    if (tokens.length > 0) {
      this.sendMessage({
        a: 'subscribe',
        v: tokens,
      });
      this.setMode('full', tokens);
    }
  }

  private sendMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private startPing(): void {
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendMessage({ a: 'ping' });
      }
    }, 2500);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private parseBinary(buffer: ArrayBuffer): Tick[] {
    const ticks: Tick[] = [];
    const view = new DataView(buffer);
    let offset = 0;

    const packetCount = view.getUint16(offset, false);
    offset += 2;

    for (let i = 0; i < packetCount; i++) {
      const packetLength = view.getUint16(offset, false);
      offset += 2;

      if (packetLength === 0) continue;

      const tick = this.parsePacket(buffer.slice(offset, offset + packetLength));
      if (tick) {
        ticks.push(tick);
      }

      offset += packetLength;
    }

    return ticks;
  }

  private parsePacket(buffer: ArrayBuffer): Tick | null {
    const view = new DataView(buffer);
    let offset = 0;

    const instrumentToken = view.getUint32(offset, false);
    offset += 4;

    const segment = instrumentToken & 0xff;
    const tick: Tick = {
      instrument_token: instrumentToken,
      mode: '',
      tradable: segment !== 9,
      last_price: 0,
    };

    const packetLength = buffer.byteLength;

    if (packetLength === 8) {
      tick.mode = 'ltp';
      tick.last_price = view.getUint32(offset, false) / 100;
      return tick;
    }

    if (packetLength === 28 || packetLength === 32) {
      tick.mode = 'quote';

      tick.last_price = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.last_traded_quantity = view.getUint32(offset, false);
      offset += 4;

      tick.average_traded_price = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.volume_traded = view.getUint32(offset, false);
      offset += 4;

      tick.total_buy_quantity = view.getUint32(offset, false);
      offset += 4;

      tick.total_sell_quantity = view.getUint32(offset, false);
      offset += 4;

      tick.open = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.high = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.low = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.close = view.getUint32(offset, false) / 100;
      offset += 4;

      if (packetLength === 32) {
        tick.last_trade_time = new Date(view.getUint32(offset, false) * 1000);
        offset += 4;

        tick.oi = view.getUint32(offset, false);
        offset += 4;
      }

      return tick;
    }

    if (packetLength === 44 || packetLength === 184) {
      tick.mode = 'full';

      tick.last_price = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.last_traded_quantity = view.getUint32(offset, false);
      offset += 4;

      tick.average_traded_price = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.volume_traded = view.getUint32(offset, false);
      offset += 4;

      tick.total_buy_quantity = view.getUint32(offset, false);
      offset += 4;

      tick.total_sell_quantity = view.getUint32(offset, false);
      offset += 4;

      tick.open = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.high = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.low = view.getUint32(offset, false) / 100;
      offset += 4;

      tick.close = view.getUint32(offset, false) / 100;
      offset += 4;

      if (packetLength === 184) {
        tick.last_trade_time = new Date(view.getUint32(offset, false) * 1000);
        offset += 4;

        tick.oi = view.getUint32(offset, false);
        offset += 4;

        tick.oi_day_high = view.getUint32(offset, false);
        offset += 4;

        tick.oi_day_low = view.getUint32(offset, false);
        offset += 4;

        tick.timestamp = new Date(view.getUint32(offset, false) * 1000);
        offset += 4;

        tick.depth = {
          buy: [],
          sell: [],
        };

        for (let i = 0; i < 5; i++) {
          tick.depth.buy.push({
            quantity: view.getUint32(offset, false),
            price: view.getUint32(offset + 4, false) / 100,
            orders: view.getUint16(offset + 8, false),
          });
          offset += 12;
        }

        for (let i = 0; i < 5; i++) {
          tick.depth.sell.push({
            quantity: view.getUint32(offset, false),
            price: view.getUint32(offset + 4, false) / 100,
            orders: view.getUint16(offset + 8, false),
          });
          offset += 12;
        }
      }

      return tick;
    }

    return null;
  }
}
