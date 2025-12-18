import { FastifyPluginAsync } from "fastify";
import Sentry from "@sentry/node";
import { TiQR, BookingResponse } from "../lib/tiqr";
import { EventMappings, Tickets } from "../constants";
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
    const ticketId = Number(tiqrData.ticket.id);
    const collectionName = EventMappings[ticketId];

    switch (ticketId) {
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

    reply.status(204).send();
  });
};

interface WebhookPayload {
  booking_uid: string;
  booking_status: string;
}

export default Webhook;
