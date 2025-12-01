import { FastifyPluginAsync } from "fastify";
import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage } from "http";

const websocketPlugin: FastifyPluginAsync = async (fastify) => {
  const wss = new WebSocketServer({ server: fastify.server, path: "/ws" });

  // Map bookingId -> Set of read-only WebSocket connections
  const bookingMap = new Map<string, WebSocket>();

  const registerSocketForBooking = (bookingId: string, sock: WebSocket) => {
    let wsConnection = bookingMap.get(bookingId);
    if (!wsConnection) {
      bookingMap.set(bookingId, sock);
    }
  };

  const unregisterSocket = (sock: WebSocket) => {
    for (const [bookingId, wsConn] of bookingMap.entries()) {
      if (wsConn === sock) {
        bookingMap.delete(bookingId);
        break;
      }
    }
  };

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const headerToken = (req.headers["x-webhook-token"] as string) || undefined;
    const configuredToken = process.env.WEBHOOK_TOKEN || "";

    const isWritable = configuredToken
      ? headerToken === configuredToken
      : false;

    if (isWritable) {
      fastify.log.info("ws: writable connection accepted");

      socket.on("message", (msg: any) => {
        const text = msg instanceof Buffer ? msg.toString() : String(msg);
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          // not JSON, ignore or optionally broadcast raw
          fastify.log.debug("ws: writable sent non-json message");
          return;
        }

        const bookingId = parsed["meta_data"]?.["booking_uid"];
        if (!bookingId) {
          fastify.log.debug("ws: writable message without bookingId; ignoring");
          return;
        }

        // forward the original message to all read-only sockets registered for this bookingId
        const target = bookingMap.get(bookingId);
        if (target) {
          if (target.readyState === WebSocket.OPEN) {
            target.send(text);
          }
        }
      });

      socket.on("close", () => {
        // nothing specific for writable sockets
      });
    } else {
      // read-only connection: allow a registration message containing bookingId
      fastify.log.debug("ws: read-only connection (can register bookingId)");

      socket.on("message", (msg: any) => {
        const text = msg instanceof Buffer ? msg.toString() : String(msg);
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          // ignore non-json messages from read-only
          return;
        }

        const bookingId = parsed["bookingId"];
        if (!bookingId) {
          // ignore messages without bookingId
          return;
        }

        registerSocketForBooking(bookingId, socket);
        // optional ack
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ registered: true, bookingId }));
        }
      });

      socket.on("close", () => {
        unregisterSocket(socket);
      });
    }
  });

  fastify.addHook("onClose", async () => {
    wss.close();
  });
};

export default websocketPlugin;
