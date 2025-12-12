import { FastifyPluginAsync } from "fastify";
import Sentry from "@sentry/node";

const Webhook: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.headers["x-webhook-token"];
    const webhookToken = process.env.WEBHOOK_TOKEN;

    if (!webhookToken) {
      fastify.log.error("Webhook secret not configured");
      return reply //
        .code(500)
        .send({
          error: true,
          message: "Internal Server Error",
        });
    }

    if (token !== webhookToken) {
      fastify.log.warn("Unauthorized webhook access attempt");
      return reply //
        .code(401)
        .send({
          error: true,
          message: "Unauthorized",
        });
    }
  });

  fastify.post("/webhook", async function (request, reply) {
    const body = request.body as WebhookPayload;

    fastify.log.info("Received webhook:");
    fastify.log.info(body);

    Sentry.captureMessage("Received webhook", {
      level: "info",
      extra: {
        payload: body,
      },
    });

    reply.status(204).send();
  });
};

interface WebhookPayload {
  message: string;
  meta_data: {
    booking_uid: string;
    booking_status: string;
    booking_quantity: number;
    booking_id: string;
  };
}

export default Webhook;
