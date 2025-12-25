import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import Sentry from "@sentry/node";
import { readdirSync } from "node:fs";
import path from "node:path";
import { DecodedIdToken } from "firebase-admin/auth";

export interface AppOptions extends FastifyServerOptions {}

const options: AppOptions = {
  routerOptions: {
    ignoreTrailingSlash: true,
  },
  logger: {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        singleLine: false,
        ignore: "pid,hostname,reqId,responseTime,level",
      },
    },
  },
};

const app: FastifyInstance = Fastify(options);

app.register(cors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
});

app.setErrorHandler((error, request, reply) => {
  const err = error as any;
  const code = Number(err.statusCode) || 500;
  const sentryEnabled =
    !!process.env.SENTRY_DSN &&
    process.env.NODE_ENV === "production" &&
    process.env.SENTRY_DISABLED !== "true";
  // workaround cause fastify devs were real high while making getDecorator
  const user = (request as any).user as DecodedIdToken | null;
  const headers = request.headers;
  headers.authorization = "";

  if (code >= 400 && code < 500) {
    request.log.info(err);
  } else {
    request.log.error(err);

    if (sentryEnabled) {
      Sentry.captureException(error, {
        extra: {
          route: request.url,
          method: request.method,
          headers: request.headers,
          query: request.query,
          params: request.params,
          body: request.body,
          user: {
            uid: user?.uid || "unauthenticated",
            email: user?.email || "unauthenticated",
          },
        },
      });
    }
  }

  return reply.code(err.statusCode || 500).send({
    error: true,
    message: err.message || "Internal Server Error",
    details: err.error || {},
  });
});

const dirs = ["./plugins", "./routes"];

for (const dir of dirs) {
  for (const file of readdirSync(path.join(__dirname, dir))) {
    if (file.endsWith(".ts") || file.endsWith(".js")) {
      app.register(require(path.join(__dirname, dir, file)));
    }
  }
}

if (
  !!process.env.SENTRY_DSN &&
  process.env.NODE_ENV === "production" &&
  process.env.SENTRY_DISABLED !== "true"
) {
  Sentry.setupFastifyErrorHandler(app);
}

export default app;
export { app, options };
