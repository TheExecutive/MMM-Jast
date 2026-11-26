import { describe, it, expect, vi } from 'vitest'
vi.mock('logger', () => ({ warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() }))
import JastFrontendUtils from './JastFrontendUtils'
import type { Config } from '../types/Config'
import type { StockResponse } from '../types/StockResponse'

const config = {
  locale: 'en-US',
  showCurrency: true,
  showChangeValueCurrency: false,
  useGrouping: false,
  currencyStyle: 'symbol',
  numberDecimalsValues: 'auto'
} as unknown as Config
const stock = (price: number, change: number, decimals?: number): StockResponse =>
  ({
    price: { regularMarketPrice: price, regularMarketChange: change, currency: 'USD' },
    meta: { symbol: 'X', decimals }
  }) as unknown as StockResponse

describe('per-stock decimals', () => {
  it('"auto" uses 2 decimals for normal prices', () => {
    expect(JastFrontendUtils.getCurrentValueAsString(stock(246.37, -3.23), config)).toBe('$246.37')
    expect(JastFrontendUtils.getStockChangeAsString(stock(246.37, -3.23), config)).toBe('-3.23')
  })
  it('"auto" keeps tiny prices meaningful, and the change matches', () => {
    expect(JastFrontendUtils.getCurrentValueAsString(stock(0.000004, -0.0000002), config)).toBe('$0.0000040')
    expect(JastFrontendUtils.getStockChangeAsString(stock(0.000004, -0.0000002), config)).toBe('-0.0000002')
    expect(JastFrontendUtils.getCurrentValueAsString(stock(0.053, 0.001), config)).toBe('$0.053')
  })
  it('a stock can set its own decimals', () => {
    expect(JastFrontendUtils.getCurrentValueAsString(stock(58826.123, 1, 0), config)).toBe('$58826')
  })
  it('a fixed number still applies to every stock', () => {
    expect(
      JastFrontendUtils.getCurrentValueAsString(stock(246.37, 1), { ...config, numberDecimalsValues: 6 } as Config)
    ).toBe('$246.370000')
  })
})
