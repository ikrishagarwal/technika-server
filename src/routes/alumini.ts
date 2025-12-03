import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import { PaymentStatus, Tickets } from "../lib/enums";
import { BASE_URL, WebhookSecret } from "../constants";
import TiQR from "../lib/tiqr";

const alumini: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.post("/alumini/register", async function (request, reply) {
    try {
      const user = await validateAuthToken(request);
      if (!user) {
        reply.status(401);
        return { error: "Unauthorized" };
      }

      const { name, email, phone, yearOfPassing, size, merchName } =
        request.body as AluminiBodyData;

      const aluminiRef = db.collection("alumni_registrations").doc();

      let finalPhone = phone.replace(/ /g, "");
      if (!finalPhone.startsWith("+")) {
        if (finalPhone.length === 10) {
          finalPhone = "+91" + finalPhone;
        } else if (finalPhone.length === 12 && finalPhone.startsWith("91")) {
          finalPhone = "+" + finalPhone;
        }
      }

      const aluminiData = {
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

      await aluminiRef.set(aluminiData);

      const [firstName, ...lastName] = name.trim().split(" ");

      const bookingPayload = {
        first_name: firstName,
        last_name: lastName.join(" "),
        email: email,
        quantity: 1,
        ticket: Tickets.Alumini,
        meta_data: {
          aluminiId: aluminiRef.id,
        },
        callback_url: BASE_URL + "/alumini/callback",
      };

      const tiqrResponse = await TiQR.createBooking(bookingPayload);

      if (!tiqrResponse?.payment?.url_to_redirect)
        throw new Error("Failed to obtain payment URL from TiQR");

      await aluminiRef.update({
        tiqrBookingUid: tiqrResponse.booking.uid,
      });

      if (tiqrResponse.booking.status === "confirmed") {
        // It's a free ticket
        await aluminiRef.update({
          paymentStatus: PaymentStatus.SUCCESS,
          updatedAt: new Date().toISOString(),
        });

        reply.status(200);
        return {
          status: "registered",
          message: "Registration confirmed",
        };
      }
    } catch (err: any) {
      fastify.log.error("Error in /alumini/register:", err);
      reply.status(500);
      return {
        error: true,
        message: "Internal Server Error",
        details: err.message || String(err),
      };
    }
  });
  fastify.get("/alumini/status", async function (request, reply) {
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
        return { status: "Not registered" };
      }

      const doc = snapshot.docs
        .map((doc) => doc.data())
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .at(0)!;

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
      fastify.log.error("Error in /alumini/status:", err);
      return {
        error: true,
        message: "Internal Server Error",
      };
    }
  });
  fastify.post("/alumini/callback", async function (request, reply) {
    try {
      const authToken = request.headers["x-webhook-token"];
      if (authToken !== WebhookSecret) {
        reply.status(401);
        return { error: "Unauthorized" };
      }

      const { meta_data } = request.body as AluminiCallbackData;

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
      fastify.log.error("Error in /alumini/callback:", err);
      return {
        error: true,
        message: "Internal Server Error",
        details: err.message || String(err),
      };
    }
  });
};

export default alumini;

interface AluminiBodyData {
  name: string;
  email: string;
  phone: string;
  yearOfPassing: string;
  size: string;
  merchName: string;
}

interface AluminiCallbackData {
  message: string;
  meta_data: {
    booking_uid: string;
    booking_status: string;
  };
}
