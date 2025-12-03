import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import { readdirSync } from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";

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

const dirs = ["./plugins", "./routes"];

for (const dir of dirs) {
  for (const file of readdirSync(path.join(__dirname, dir))) {
    if (file.endsWith(".ts") || file.endsWith(".js")) {
      app.register(require(path.join(__dirname, dir, file)));
    }
  }
}

export default app;
export { app, options };
