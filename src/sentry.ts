import Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
  enableLogs: true,
});
