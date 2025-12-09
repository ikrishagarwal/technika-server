import { FastifyPluginAsync } from "fastify";
import * as z from "zod";
import { AllowedTicketIds, PaymentBaseUrl, PaymentStatus } from "../constants";
import { validateAuthToken } from "../lib/auth";
import TiQR, {
  BookingData,
  BookingPayload,
  BookingResponse,
} from "../lib/tiqr";
import { db } from "../lib/firebase";

const book: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.post("/book/:uid", async function (request, reply) {
    try {
      const uid = Number((request.params as { uid: string })["uid"]);

      if (!uid || isNaN(uid) || !AllowedTicketIds.includes(uid)) {
        reply.status(400);
        return {
          error: true,
          message: "Invalid or missing event ID",
        };
      }

      const user = await validateAuthToken(request);

      if (!user || !user.email) {
        reply.status(401);
        return {
          error: true,
          message: "Unauthorized",
        };
      }

      const parsedBody = EventBody.safeParse(request.body);

      if (!parsedBody.success) {
        reply.status(400);
        return {
          error: true,
          message: "Invalid request body",
        };
      }

      let phone = parsedBody.data.phone.replace(/ /g, "");
      if (!phone.startsWith("+")) {
        if (phone.length === 10) {
          phone = "+91" + phone;
        } else if (phone.length === 12 && phone.startsWith("91")) {
          phone = "+" + phone;
        }
      }

      let dbUser = await db
        .collection("paid_users")
        .where("firebaseUid", "==", user.uid)
        .get();

      if (dbUser.empty) {
        const userRef = db.collection("paid_users").doc();
        await userRef.set({
          name: parsedBody.data.name,
          email: user.email,
          phone: phone,
          firebaseUid: user.uid,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as PaidUserPayload);

        dbUser = await db
          .collection("paid_users")
          .where("firebaseUid", "==", user.uid)
          .get();
      } else {
        const data = dbUser.docs[0].data();
        const updatePayload: PaidUserPayload = {};

        parsedBody.data.name !== data.name &&
          (updatePayload["name"] = parsedBody.data.name);
        phone !== data.phone && (updatePayload["phone"] = phone);

        if (Object.keys(updatePayload).length > 0) {
          updatePayload["updatedAt"] = new Date().toISOString();
          await dbUser.docs[0].ref.update(updatePayload);
        }

        const userOptedEvents = data.events || {};
        if (userOptedEvents[uid]) {
          switch (userOptedEvents[uid].status) {
            case PaymentStatus.Confirmed:
              reply.status(200);
              return {
                success: true,
                message: "Already booked successfully",
                status: PaymentStatus.Confirmed,
              };
              break;

            case PaymentStatus.PendingPayment:
            case PaymentStatus.Failed:
              const tiqrResponse = await TiQR.fetchBooking(
                userOptedEvents[uid].bookingUid
              );
              const tiqrData = (await tiqrResponse.json()) as BookingData;
              const paymentId = tiqrData.payment.payment_id;

              if (paymentId) {
                reply.status(200);
                return {
                  success: true,
                  status: PaymentStatus.PendingPayment,
                  message: "Need to complete payment",
                  paymentUrl: PaymentBaseUrl + paymentId,
                };
              }
          }
        }
      }

      const payload: BookingPayload = {
        first_name: parsedBody.data.name.split(" ")[0],
        last_name: parsedBody.data.name.split(" ").slice(1).join(" ") || "",
        phone_number: phone,
        email: user.email,
        callback_url: parsedBody.data.callbackUrl,
        ticket: uid,
        meta_data: {
          firebaseUid: user.uid,
        },
      };

      const tiqrResponse = await TiQR.createBooking(payload);
      const tiqrData = (await tiqrResponse.json()) as BookingResponse;

      if (!tiqrData.payment.url_to_redirect) {
        throw new Error("Failed to obtain payment URL");
      }

      await dbUser.docs[0].ref.update({
        [`events.${uid}`]: {
          bookingUid: tiqrData.booking.uid,
          status: PaymentStatus.PendingPayment,
        },
      });

      reply.status(200);
      return {
        success: true,
        message: "Booking created successfully",
        status: PaymentStatus.PendingPayment,
        paymentUrl: tiqrData.payment.url_to_redirect,
      };
    } catch (err: any) {
      fastify.log.error("Error in /book/:eventId:");
      fastify.log.error(err);
      reply.status(500);
      return {
        error: true,
        message: err.message || String(err),
      };
    }
  });
};

const EventBody = z.object({
  name: z.string().min(1),
  phone: z.string().trim().min(10),
  callbackUrl: z.url().optional().nullable(),
});

interface PaidUserPayload extends Record<string, any> {
  name?: string;
  phone?: string;
  email?: string;
  firebaseUid?: string;
  createdAt?: string;
  updatedAt?: string;
  events?: {
    [eventId: number]: {
      bookingUid: string;
      status: PaymentStatus;
    };
  };
}

export default book;
