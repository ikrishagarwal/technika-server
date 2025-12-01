import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import websocketPlugin from "./plugins/websocket";
import root from "./routes/root";

export interface AppOptions extends FastifyServerOptions {}

const options: AppOptions = {};

const app: FastifyInstance = Fastify(options);

app.register(websocketPlugin);
app.register(root);

// app.listen({
//   port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
// });

export default app;
export { app, options };
