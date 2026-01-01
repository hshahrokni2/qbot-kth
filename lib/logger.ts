// Conditional logging utility for development vs production
const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  debug: (...args: any[]) => {
    if (isDev) console.log(...args)
  },
  info: (...args: any[]) => {
    console.log(...args)
  },
  warn: (...args: any[]) => {
    console.warn(...args)
  },
  error: (...args: any[]) => {
    console.error(...args)
  },
}

// User-friendly error messages
export const ErrorMessages = {
  EMBEDDING_FAILED: 'Unable to process your question. Please try again.',
  SEARCH_FAILED: 'Search temporarily unavailable. Please try again shortly.',
  LLM_FAILED: 'Unable to generate response. Please try again.',
  NETWORK_ERROR: 'Network connection issue. Please check your connection.',
  RATE_LIMIT: 'Too many requests. Please wait a moment and try again.',
}
