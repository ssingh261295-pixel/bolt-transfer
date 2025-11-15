import {
  RSI,
  EMA,
  BollingerBands,
  ADX,
  MACD,
  SMA,
  Stochastic,
  ATR
} from 'technicalindicators';

export interface CandleData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HeikinAshiCandle {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface IndicatorResult {
  timestamp: string;
  rsi?: number;
  ema20?: number;
  ema50?: number;
  sma20?: number;
  sma50?: number;
  adx?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  stochK?: number;
  stochD?: number;
  atr?: number;
  haOpen?: number;
  haHigh?: number;
  haLow?: number;
  haClose?: number;
}

export function calculateRSI(closes: number[], period = 14): number[] {
  return RSI.calculate({ period, values: closes });
}

export function calculateEMA(closes: number[], period = 20): number[] {
  return EMA.calculate({ period, values: closes });
}

export function calculateSMA(closes: number[], period = 20): number[] {
  return SMA.calculate({ period, values: closes });
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2
): Array<{ upper: number; middle: number; lower: number }> {
  return BollingerBands.calculate({
    period,
    values: closes,
    stdDev,
  });
}

export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): Array<{ adx: number; pdi: number; mdi: number }> {
  return ADX.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
  });
}

export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): Array<{ MACD: number; signal: number; histogram: number }> {
  return MACD.calculate({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
}

export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
  signalPeriod = 3
): Array<{ k: number; d: number }> {
  return Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
    signalPeriod,
  });
}

export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number[] {
  return ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
  });
}

export function calculateHeikinAshi(candles: CandleData[]): HeikinAshiCandle[] {
  const ha: HeikinAshiCandle[] = [];
  let prevHaOpen = candles[0].open;
  let prevHaClose = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    const { open, high, low, close } = candles[i];

    const haClose = (open + high + low + close) / 4;
    const haOpen = (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(high, haOpen, haClose);
    const haLow = Math.min(low, haOpen, haClose);

    ha.push({ open: haOpen, high: haHigh, low: haLow, close: haClose });

    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }

  return ha;
}

export function calculateAllIndicators(candles: CandleData[]): IndicatorResult[] {
  const opens = candles.map(c => c.open);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  // Calculate all indicators
  const rsi = calculateRSI(closes, 14);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const adx = calculateADX(highs, lows, closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);
  const stoch = calculateStochastic(highs, lows, closes);
  const atr = calculateATR(highs, lows, closes);
  const ha = calculateHeikinAshi(candles);

  // Combine all results
  return candles.map((candle, i) => ({
    timestamp: candle.timestamp,
    rsi: rsi[i] || undefined,
    ema20: ema20[i] || undefined,
    ema50: ema50[i] || undefined,
    sma20: sma20[i] || undefined,
    sma50: sma50[i] || undefined,
    adx: adx[i]?.adx || undefined,
    macd: macd[i]?.MACD || undefined,
    macdSignal: macd[i]?.signal || undefined,
    macdHistogram: macd[i]?.histogram || undefined,
    bbUpper: bb[i]?.upper || undefined,
    bbMiddle: bb[i]?.middle || undefined,
    bbLower: bb[i]?.lower || undefined,
    stochK: stoch[i]?.k || undefined,
    stochD: stoch[i]?.d || undefined,
    atr: atr[i] || undefined,
    haOpen: ha[i]?.open || undefined,
    haHigh: ha[i]?.high || undefined,
    haLow: ha[i]?.low || undefined,
    haClose: ha[i]?.close || undefined,
  }));
}

// Helper function to get specific indicator
export function getIndicator(
  candles: CandleData[],
  indicatorName: string,
  params: Record<string, number> = {}
): number[] {
  const opens = candles.map(c => c.open);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  switch (indicatorName.toLowerCase()) {
    case 'rsi':
      return calculateRSI(closes, params.period || 14);
    case 'ema':
      return calculateEMA(closes, params.period || 20);
    case 'sma':
      return calculateSMA(closes, params.period || 20);
    case 'atr':
      return calculateATR(highs, lows, closes, params.period || 14);
    default:
      return [];
  }
}
