import { FastifyPluginAsync } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";

const websocketPlugin: FastifyPluginAsync = async (fastify) => {
  const wss = new WebSocketServer({ server: fastify.server, path: "/ws" });

  wss.on("connection", (socket: WebSocket) => {
    socket.on("message", (msg: any) => {
      const text = msg instanceof Buffer ? msg.toString() : String(msg);
      socket.send(`echo: ${text}`);
    });
  });

  fastify.addHook("onClose", async () => {
    wss.close();
  });
};

export default websocketPlugin;
