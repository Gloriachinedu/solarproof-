import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
  /**
   * Attach the X-Correlation-ID header to every Sentry event so that
   * Sentry errors can be cross-referenced with structured log entries
   * (issue #33).
   */
  beforeSend(event, hint) {
    // Pull the correlation ID off the active scope tags if set by
    // createRequestLogger(), and surface it as a top-level extra field
    // so it's easily searchable in the Sentry UI.
    const correlationId = event.tags?.correlationId
    if (correlationId) {
      event.extra = {
        ...event.extra,
        correlationId,
      }
    }
    // Suppress noisy non-errors in production
    if (process.env.NODE_ENV === 'production' && hint?.originalException === null) {
      return null
    }
    return event
  },
})
