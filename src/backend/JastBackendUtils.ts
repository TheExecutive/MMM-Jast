import * as Log from 'logger'
import * as yahooFinance2Module from 'yahoo-finance2'
import type { Quote } from 'yahoo-finance2/modules/quote'
import { Config } from '../types/Config'
import { StockResponse } from '../types/StockResponse'

interface QuoteRequestOptions {
  fetchOptions?: RequestInit
  validateResult?: boolean
}

// TypeScript sees the namespace import, but Rollup provides the correct format at runtime
const YahooFinance = ('default' in yahooFinance2Module
  ? yahooFinance2Module.default
  : yahooFinance2Module) as unknown as new (options: { suppressNotices: string[] }) => {
  quoteCombine: (
    symbol: string,
    options: { fields: string[] },
    requestOptions?: QuoteRequestOptions
  ) => Promise<Quote | undefined>
}

// Yahoo can occasionally accept a connection but never respond; abort rather than hang the whole update.
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 3_000

// Reused across polls, since yahoo-finance2 v4 no longer shares cookie/crumb state across instances.
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

// quoteCombine() debounces and batches all symbols requested within the same tick into a single
// Yahoo request, instead of one request per stock like quoteSummary() would.
const QUOTE_FIELDS = [
  'currency',
  'longName',
  'regularMarketChange',
  'regularMarketChangePercent',
  'regularMarketPreviousClose',
  'regularMarketPrice',
  'regularMarketTime'
]

const JastBackendUtils = {
  async requestStocks(config: Config): Promise<StockResponse[]> {
    const stocks = []
    // Yahoo intermittently returns a payload that fails schema validation, which fails every symbol in
    // the batch at once. Retrying after a short delay (still batched together) almost always succeeds.
    const requestWithRetry = async (symbol: string) => {
      let validateResult = true
      for (let attempt = 0; ; attempt++) {
        try {
          return await yahooFinance.quoteCombine(
            symbol,
            { fields: QUOTE_FIELDS },
            { fetchOptions: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, validateResult }
          )
        } catch (e) {
          // Validation failures (seen on weekends) usually concern fields we don't request; the required
          // fields are still checked in node_helper, so accept the unvalidated payload right away.
          if (validateResult && e instanceof Error && e.name === 'FailedYahooValidationError') {
            validateResult = false
            continue
          }
          if (attempt >= MAX_RETRIES) throw e
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)))
        }
      }
    }
    const apiResponses = await Promise.all(config.stocks.map((stock) => requestWithRetry(stock.symbol).catch((e) => e)))

    for (const [index, response] of apiResponses.entries()) {
      if (response instanceof Error) {
        Log.warn(`API request for ${config.stocks[index].symbol} failed:`, response.message)
      } else if (response) {
        const meta = {
          symbol: config.stocks[index].symbol,
          name: config.stocks[index].name,
          quantity: config.stocks[index].quantity,
          hidden: config.stocks[index].hidden,
          purchasePrice: config.stocks[index].purchasePrice
        }
        // quoteCombine() returns changePercent as a percent number (2.86 for 2.86%), but the rest of
        // this module expects a fraction (0.0286), matching Intl.NumberFormat's percent style input.
        if (response.regularMarketChangePercent !== undefined) {
          response.regularMarketChangePercent /= 100
        }

        // Manually convert GBp to GBP
        if (response.currency === 'GBp') {
          if (response.regularMarketPrice !== undefined) {
            response.regularMarketPrice /= 100
          }
          if (response.regularMarketChange !== undefined) {
            response.regularMarketChange /= 100
          }
          response.currency = 'GBP'
        }

        // Override changes if they are older than maxChangeAge
        if (config.maxChangeAge > 0) {
          const maxChangeAge = new Date().getTime() - config.maxChangeAge
          try {
            const lastChange = response.regularMarketTime ? new Date(response.regularMarketTime).getTime() : Number.NaN

            if (maxChangeAge > lastChange) {
              response.regularMarketPreviousClose = response.regularMarketPrice
              response.regularMarketChange = 0
              response.regularMarketChangePercent = 0
            }
          } catch (err) {
            Log.warn('Could not parse lastChange date', err)
          }
        }

        stocks.push({ price: response, meta })
      } else {
        Log.warn(`Response for ${config.stocks[index].symbol} does not satisfy expected payload.`)
      }
    }

    return stocks
  }
}

export default JastBackendUtils
