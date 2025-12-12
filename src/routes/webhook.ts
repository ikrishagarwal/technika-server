import { FastifyPluginAsync } from "fastify";
import Sentry from "@sentry/node";
import { TiQR, BookingResponse } from "../lib/tiqr";
import { EventMappings } from "../constants";
import { db } from "../lib/firebase";
import { FieldValue } from "firebase-admin/firestore";

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

    const tiqrResponse = await TiQR.fetchBooking(body.booking_uid);
    if (!tiqrResponse.ok) {
      fastify.log.error("Failed to fetch booking data from TiQR");
      return reply.code(500).send();
    }

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;
    const ticketId = String(tiqrData.ticket.id);

    if (!Object.keys(EventMappings).includes(ticketId)) {
      return reply.code(204).send();
    }

    const collectionName = EventMappings[ticketId];

    const entry = await db
      .collection(collectionName)
      .where("tiqrBookingUid", "==", body.booking_uid)
      .get();

    if (entry.empty) {
      fastify.log.warn(
        `No matching entry found for booking UID: ${body.booking_uid}`
      );
      return reply.code(204).send();
    }

    await entry.docs[0].ref.update({
      paymentStatus: body.booking_status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    reply.status(204).send();
  });
};

interface WebhookPayload {
  booking_uid: string;
  booking_status: string;
}

export default Webhook;
