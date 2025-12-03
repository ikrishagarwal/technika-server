import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import { PaymentStatus, Tickets } from "../lib/enums";
import { BASE_URL, WebhookSecret } from "../constants";
import TiQR, { BookingResponse } from "../lib/tiqr";

const alumni: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.post("/alumni/register", async function (request, reply) {
    try {
      const user = await validateAuthToken(request);
      if (!user) {
        reply.status(401);
        return { error: "Unauthorized" };
      }

      const { name, email, phone, yearOfPassing, size, merchName } =
        request.body as AlumniBodyData;

      const existingSnapshot = await db
        .collection("alumni_registrations")
        .where("firebaseUid", "==", user.uid)
        .get();

      if (!existingSnapshot.empty) {
        // delete the document to allow re-registration assuming the previous attempt failed
        await existingSnapshot.docs[0].ref.delete();
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
        tShirtSize: size,
        merchName,
        paymentStatus: PaymentStatus.PENDING,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await alumniRef.set(alumniData);

      const [firstName, ...lastName] = name.trim().split(" ");

      const bookingPayload = {
        first_name: firstName,
        last_name: lastName.join(" "),
        email: email,
        quantity: 1,
        ticket: Tickets.Alumni,
        meta_data: {
          alumniId: alumniRef.id,
        },
        callback_url: BASE_URL + "/alumni/callback",
      };

      const tiqrResponse = await TiQR.createBooking(bookingPayload);
      const tiqrData = (await tiqrResponse.json()) as BookingResponse;

      fastify.log.info(tiqrData);

      if (!tiqrData?.payment?.url_to_redirect)
        throw new Error("Failed to obtain payment URL from TiQR");

      await alumniRef.update({
        tiqrBookingUid: tiqrData.booking.uid,
      });

      if (tiqrData.booking.status === "confirmed") {
        // It's a free ticket
        await alumniRef.update({
          paymentStatus: PaymentStatus.SUCCESS,
          updatedAt: new Date().toISOString(),
        });

        reply.status(200);
        return {
          status: PaymentStatus.SUCCESS,
          message: "Registration confirmed",
        };
      }

      reply.status(200);
      return {
        status: PaymentStatus.PENDING,
        paymentUrl: tiqrData.payment.url_to_redirect,
      };
    } catch (err: any) {
      fastify.log.error("Error in /alumni/register:", err);
      reply.status(500);
      return {
        error: true,
        message: "Internal Server Error",
        details: err.message || String(err),
      };
    }
  });
  fastify.get("/alumni/status", async function (request, reply) {
    try {
      const user = await validateAuthToken(request);
      if (!user) {
        reply.status(401);
        return { error: "Unauthorized" };
      }

      const snapshot = await db
        .collection("alumni_registrations")
        .where("firebaseUid", "==", user.uid)
        .get();

      if (snapshot.empty) {
        reply.status(404);
        return { status: "unregistered" };
      }

      // const doc = snapshot.docs
      //   .map((doc) => doc.data())
      //   .sort(
      //     (a, b) =>
      //       new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      //   )
      //   .at(0)!;

      const doc = snapshot.docs[0].data();

      reply.status(200);

      return {
        status: doc.paymentStatus,
        details: {
          name: doc.fullName,
          merchName: doc.merchName,
          size: doc.tShirtSize,
        },
      };
    } catch (err: any) {
      reply.status(500);
      fastify.log.error("Error in /alumni/status:", err);
      return {
        error: true,
        message: "Internal Server Error",
      };
    }
  });
  fastify.post("/alumni/callback", async function (request, reply) {
    try {
      fastify.log.info("Received alumni callback:");
      fastify.log.info(request.body);
      fastify.log.info("Received alumni headers:");
      fastify.log.info(request.headers);
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

      if (meta_data.booking_status === "confirmed") {
        newStatus = PaymentStatus.SUCCESS;
      } else if (
        meta_data.booking_status === "cancelled" ||
        meta_data.booking_status === "failed"
      ) {
        newStatus = PaymentStatus.FAILED;
      }

      if (newStatus !== undefined && newStatus !== doc.data().paymentStatus) {
        await doc.ref.update({
          paymentStatus: newStatus,
          updatedAt:
            newStatus == PaymentStatus.SUCCESS
              ? new Date().toISOString()
              : doc.data().updatedAt,
        });
      }

      reply.status(200);
      return {
        status: "Callback processed",
        success: true,
      };
    } catch (err: any) {
      reply.status(500);
      fastify.log.error("Error in /alumni/callback:", err);
      return {
        error: true,
        message: "Internal Server Error",
        details: err.message || String(err),
      };
    }
  });
};

export default alumni;

interface AlumniBodyData {
  name: string;
  email: string;
  phone: string;
  yearOfPassing: string;
  size: string;
  merchName: string;
}

interface AlumniCallbackData {
  message: string;
  meta_data: {
    booking_uid: string;
    booking_status: string;
  };
}
