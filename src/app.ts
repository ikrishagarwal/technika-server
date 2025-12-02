import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import websocketPlugin from "./plugins/websocket";
import routeList from "./routes";

export interface AppOptions extends FastifyServerOptions {}

const options: AppOptions = {
  ignoreTrailingSlash: true,
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

app.register(websocketPlugin);

routeList.forEach((route) => app.register(route));

export default app;
export { app, options };
