import { FastifyPluginAsync } from "fastify";
import * as z from "zod";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import {
  FRONT_END_BASE_URL,
  PaymentBaseUrl,
  PaymentStatus,
  Tickets,
  WebhookSecret,
} from "../constants";
import TiQR, { FetchBookingResponse, BookingResponse } from "../lib/tiqr";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";

const alumni: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request).catch(() => null);

    if (!user) {
      return reply.code(401).send({
        error: true,
        message: "Unauthorized",
      });
    }

    request.setDecorator("user", user);
  });

  fastify.post("/alumni/register", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const parsedBody = AlumniBodyData.safeParse(request.body);

    if (!parsedBody.success) {
      reply.status(400);
      return {
        error: "Invalid request body",
        details: parsedBody.error.type,
      };
    }

    const { name, email, phone, yearOfPassing, size } = parsedBody.data;

    const existingSnapshot = await db
      .collection("alumni_registrations")
      .where("firebaseUid", "==", user.uid)
      .get();

    if (!existingSnapshot.empty) {
      const doc = existingSnapshot.docs[0];
      switch (doc.data().paymentStatus) {
        case PaymentStatus.Confirmed:
          reply.status(200);
          return {
            status: PaymentStatus.Confirmed,
            message: "Already registered successfully",
          };

        case PaymentStatus.PendingPayment:
        case PaymentStatus.Failed:
          const paymentUrl = doc.data().paymentUrl;
          if (paymentUrl) {
            reply.status(200);
            return {
              status: PaymentStatus.PendingPayment,
              paymentUrl: paymentUrl,
            };
          } else {
            const tiqrResponse = await TiQR.fetchBooking(
              doc.data().tiqrBookingUid
            );
            const tiqrData =
              (await tiqrResponse.json()) as FetchBookingResponse;
            const paymentId = tiqrData.payment?.payment_id;

            if (!paymentId) {
              doc.ref.delete();
              break;
            }

            reply.status(200);
            return {
              status: PaymentStatus.PendingPayment,
              paymentUrl: PaymentBaseUrl + paymentId,
            };
          }

        default:
          doc.ref.delete();
          break;
      }
    }

    const alumniRef = db.collection("alumni_registrations").doc();

    let finalPhone = phone.replace(/ /g, "");
    if (!finalPhone.startsWith("+")) {
      if (finalPhone.length === 10) {
        finalPhone = "+91" + finalPhone;
      } else if (finalPhone.length === 12 && finalPhone.startsWith("91")) {
        finalPhone = "+" + finalPhone;
      }
    }

    const alumniData = {
      firebaseUid: user.uid,
      fullName: name,
      email,
      phone: finalPhone,
      yearOfPassing,
      tShirtSize: size || "",
      paymentStatus: PaymentStatus.PendingPayment,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await alumniRef.set(alumniData);

    const [firstName, ...lastName] = name.trim().split(" ");

    const tiqrResponse = await TiQR.createBooking({
      first_name: firstName,
      last_name: lastName.join(" "),
      email: email,
      phone_number: finalPhone,
      ticket: Tickets.Alumni,
      meta_data: {
        alumniId: alumniRef.id,
      },
      callback_url: `${FRONT_END_BASE_URL}/alumni`,
    });
    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    if (!tiqrData?.payment?.url_to_redirect)
      throw new Error("Failed to obtain payment URL from TiQR");

    await alumniRef.update({
      tiqrBookingUid: tiqrData.booking.uid,
      paymentUrl: tiqrData.payment.url_to_redirect,
    });

    if (tiqrData.booking.status === PaymentStatus.Confirmed) {
      // It's a free ticket
      await alumniRef.update({
        paymentStatus: PaymentStatus.Confirmed,
        updatedAt: FieldValue.serverTimestamp(),
      });

      reply.status(200);
      return {
        status: PaymentStatus.Confirmed,
        message: "Registration confirmed",
      };
    }

    reply.status(200);
    return {
      status: PaymentStatus.PendingPayment,
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.get("/alumni/status", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const snapshot = await db
      .collection("alumni_registrations")
      .where("firebaseUid", "==", user.uid)
      .get();

    if (snapshot.empty) {
      reply.status(404);
      return { status: "unregistered" };
    }

    const docRef = snapshot.docs[0].ref;
    const doc = snapshot.docs[0].data();

    const tiqrResponse = await TiQR.fetchBooking(doc.tiqrBookingUid);
    const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

    const currentStatus = tiqrData.status;

    if (currentStatus && currentStatus != doc.paymentStatus) {
      docRef.update({
        paymentStatus: currentStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    reply.status(200);

    return {
      status: currentStatus,
      details: {
        name: doc.fullName,
        merchName: doc.merchName,
        size: doc.tShirtSize,
      },
    };
  });

  fastify.get("/alumni/qr", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const snapshot = await db
      .collection("alumni_registrations")
      .where("firebaseUid", "==", user.uid)
      .get();

    if (snapshot.empty) {
      reply.status(404);
      return { error: "Registration not found" };
    }

    const doc = snapshot.docs[0].data();

    if (!doc.tiqrBookingUid) {
      reply.status(404);
      return { error: "No booking found for this user" };
    }

    try {
      const tiqrResponse = await TiQR.fetchBooking(doc.tiqrBookingUid);

      if (!tiqrResponse.ok) {
        reply.status(502);
        return { error: "Failed to fetch booking from TiQR" };
      }

      const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

      if (tiqrData.status === PaymentStatus.Confirmed) {
        reply.status(200);
        return { success: true, checksum: tiqrData.checksum };
      }

      reply.status(403);
      return { error: "Payment not confirmed", status: tiqrData.status };
    } catch (err) {
      reply.status(500);
      return { error: "Internal server error" };
    }
  });

  // Not sure about this endpoint, if it's actually put to use..???
  fastify.post("/alumni/callback", async function (request, reply) {
    const authToken = request.headers["x-webhook-token"];
    if (authToken !== WebhookSecret) {
      reply.status(401);
      return { error: "Unauthorized" };
    }

    const { meta_data } = request.body as AlumniCallbackData;

    if (!meta_data) {
      reply.status(400);
      return { error: "Invalid Payload" };
    }

    const snapshot = await db
      .collection("alumni_registrations")
      .where("tiqrBookingUid", "==", meta_data.booking_uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      reply.status(404);
      return { error: "Registration not found" };
    }

    const doc = snapshot.docs[0];
    let newStatus;

    if (meta_data.booking_status === PaymentStatus.Confirmed) {
      newStatus = PaymentStatus.Confirmed;
    } else if (
      meta_data.booking_status === "cancelled" ||
      meta_data.booking_status === "failed"
    ) {
      newStatus = PaymentStatus.Failed;
    }

    if (newStatus !== undefined && newStatus !== doc.data().paymentStatus) {
      await doc.ref.update({
        paymentStatus: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    reply.status(200);
    return {
      status: "Callback processed",
      success: true,
    };
  });
};

const AlumniBodyData = z.object({
  name: z.string().min(2),
  email: z.email(),
  phone: z.string().min(10),
  yearOfPassing: z.coerce.number().min(1950).max(2026),
  size: z.string().min(1),
  merchName: z.string().optional().nullable(),
});

interface AlumniCallbackData {
  message: string;
  meta_data: {
    booking_uid: string;
    booking_status: string;
  };
}

export default alumni;
