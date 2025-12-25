import Sentry from "@sentry/node";

const sentryEnabled =
  !!process.env.SENTRY_DSN &&
  process.env.NODE_ENV === "production" &&
  process.env.SENTRY_DISABLED !== "true";

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: true,
    tracesSampleRate: 1.0,
    enableLogs: true,
  });

  console.log("Sentry initialized");
}
