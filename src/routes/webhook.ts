import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import Sentry from "@sentry/node";
import { TiQR, BookingResponse } from "../lib/tiqr";
import { EventMappings, EventTickets, Tickets } from "../constants";
import { db } from "../lib/firebase";
import { FieldValue } from "firebase-admin/firestore";

const Webhook: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook("onRequest", async (request, reply) => {
    const tokenHeader = request.headers["x-webhook-token"];
    const token =
      (Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader) || "";
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

    if (token.length !== webhookToken.length) {
      fastify.log.warn("Unauthorized webhook access attempt");
      return reply //
        .code(401)
        .send({
          error: true,
          message: "Unauthorized",
        });
    }

    if (
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(webhookToken))
    ) {
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

    const safeLogBody: Record<string, any> = {};
    const allowedFields = [
      "booking_status",
      "booking_uid",
      "email",
      "event_name",
      "first_name",
      "last_name",
      "name",
      "phone_number",
      "quantity",
      "ticket_type",
      "ticket_price",
    ];

    for (const key of allowedFields) {
      if (key in body) {
        // @ts-ignore
        safeLogBody[key] = body[key];
      }
    }

    fastify.log.info({
      msg: "Received webhook",
      payload: safeLogBody,
    });

    Sentry.captureMessage("Received webhook", {
      level: "info",
      extra: {
        payload: safeLogBody,
      },
    });

    const tiqrResponse = await TiQR.fetchBooking(body.booking_uid);
    if (!tiqrResponse.ok) {
      fastify.log.error("Failed to fetch booking data from TiQR");
      return reply.code(500).send();
    }

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;
    const ticketId = Number(tiqrData.ticket.id);
    const collectionName = EventMappings[ticketId];

    switch (ticketId) {
      case Tickets.MerchTee:
      case Tickets.MerchJacket:
      case Tickets.MerchCombo:
        const merchRef = db.collection(collectionName).doc(body.booking_uid);
        const merchSnap = await merchRef.get();

        if (merchSnap.exists) {
          await merchRef.update({
            paymentStatus: body.booking_status,
            updatedAt: FieldValue.serverTimestamp(),
          });
          break;
        }

        const merchEntry = await db
          .collection(collectionName)
          .where("tiqrBookingUid", "==", body.booking_uid)
          .get();

        if (merchEntry.empty) {
          fastify.log.warn(
            `No matching merch order found for booking UID: ${body.booking_uid}`
          );
          return reply.code(204).send();
        }

        await merchEntry.docs[0].ref.update({
          paymentStatus: body.booking_status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        break;

      case Tickets.Alumni:
        const alumniEntry = await db
          .collection(collectionName)
          .where("tiqrBookingUid", "==", body.booking_uid)
          .get();

        if (alumniEntry.empty) {
          fastify.log.warn(
            `No matching entry found for booking UID: ${body.booking_uid}`
          );
          return reply.code(204).send();
        }

        await alumniEntry.docs[0].ref.update({
          paymentStatus: body.booking_status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        break;

      case Tickets.Accommodation:
        const accommodationEntry = await db
          .collection(collectionName)
          .where("tiqrBookingUid", "==", body.booking_uid)
          .get();

        if (accommodationEntry.empty) {
          fastify.log.warn(
            `No matching accommodation entry found for booking UID: ${body.booking_uid}`
          );
          return reply.code(204).send();
        }

        await accommodationEntry.docs[0].ref.update({
          paymentStatus: body.booking_status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        break;

      case Tickets.Delegate:
      case Tickets.DelegateComplimentary:
        const delegateEntry = await db
          .collection(collectionName)
          .where("tiqrBookingUid", "==", body.booking_uid)
          .get();

        if (delegateEntry.empty) {
          fastify.log.warn(
            `No matching delegate entry found for booking UID: ${body.booking_uid}`
          );
          return reply.code(204).send();
        }

        await delegateEntry.docs[0].ref.update({
          paymentStatus: body.booking_status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        break;

      // LEGACY CODE FOR OLD WAY OF HANDLING DELEGATE REGISTRATIONS
      // KEEPING IT COMMENTED FOR NOW IN CASE WE NEED TO REVERT

      // case Tickets.Delegate:
      //   const selfQuery = await db
      //     .collection(collectionName)
      //     .where("self.tiqrBookingUid", "==", body.booking_uid)
      //     .get();

      //   if (!selfQuery.empty) {
      //     await selfQuery.docs[0].ref.update({
      //       "self.paymentStatus": body.booking_status,
      //       updatedAt: FieldValue.serverTimestamp(),
      //     });
      //     break;
      //   } else {
      //     const groupQuery = await db
      //       .collection(collectionName)
      //       .where("group.tiqrBookingUid", "==", body.booking_uid)
      //       .get();

      //     if (groupQuery.empty) break;

      //     const groupData = groupQuery.docs[0].data() as DelegateSchema;

      //     if (body.booking_status === "confirmed") {
      //       if (
      //         groupData.group?.members &&
      //         groupData.group.members.length >= 5
      //       ) {
      //         const tiqrResponse = await TiQR.bookComplimentary(
      //           EventIds.Delegate,
      //           {
      //             first_name: groupData.name.split(" ")[0],
      //             last_name: groupData.name.split(" ").slice(1).join(" "),
      //             email: groupData.email,
      //             phone_number: groupData.phone,
      //             ticket: Tickets.Delegate,
      //             meta_data: {
      //               members: groupData.group?.members || [],
      //             },
      //             quantity:
      //               Math.floor((groupData.group?.members?.length + 1) / 6) || 0,
      //           }
      //         );

      //         const tiqrData = (await tiqrResponse.json()) as BookingResponse;

      //         await groupQuery.docs[0].ref.update({
      //           "group.complimentaryTiqrBookingUid": tiqrData.uid,
      //           "group.paymentStatus": "confirmed",
      //           updatedAt: FieldValue.serverTimestamp(),
      //         });
      //       } else {
      //         await groupQuery.docs[0].ref.update({
      //           "group.paymentStatus": "confirmed",
      //           updatedAt: FieldValue.serverTimestamp(),
      //         });
      //       }
      //     }
      //   }
      //   break;
    }

    if (EventTickets.includes(ticketId)) {
      const collectionName = "event_registrations";

      if (!tiqrData.meta_data || !tiqrData.meta_data.eventId) {
        fastify.log.warn(
          `No eventId found in meta_data for booking UID: ${body.booking_uid}`
        );
        return reply.code(204).send();
      }

      const eventUser = await db
        .collection(collectionName)
        .where(
          `events.${tiqrData.meta_data.eventId}.tiqrBookingUid`,
          "==",
          body.booking_uid
        )
        .get();

      if (eventUser.empty) {
        fastify.log.warn(
          `No matching event entry found for booking UID: ${body.booking_uid}`
        );
        return reply.code(204).send();
      }

      await eventUser.docs[0].ref.update({
        [`events.${tiqrData.meta_data.eventId}.status`]: body.booking_status,
      });
    }

    reply.status(204).send();
  });
};

interface WebhookPayload {
  booking_uid: string;
  booking_status: string;
}

export default Webhook;
