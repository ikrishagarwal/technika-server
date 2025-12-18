import { FastifyPluginAsync } from "fastify";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import z from "zod";
import { PaymentStatus, Tickets } from "../constants";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import TiQR, { BookingResponse } from "../lib/tiqr";

const Accommodation: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request).catch(() => null);

    if (!user) {
      return reply.code(401).send({
        error: true,
        message: "unauthorized",
      });
    }

    request.setDecorator("user", user);
  });

  fastify.post("/accommodation/book", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = AccommodationBookingPayload.safeParse(request.body);

    if (!body.success) {
      reply.status(400);
      return {
        error: true,
        message: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }

    let userSnap = await db.collection("accommodation").doc(user.uid).get();

    if (!userSnap.exists) {
      await userSnap.ref.set({
        email: user.email,
        name: body.data.name,
        phone: body.data.phone,
        college: body.data.college,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      userSnap = await userSnap.ref.get();
    }

    const userData = userSnap.data() as AccommodationSchema;

    if (userData.paymentStatus === PaymentStatus.Confirmed) {
      reply.status(400);
      return {
        error: true,
        message: "You have already registered for accommodation",
      };
    }

    const tiqrResponse = await TiQR.createBooking({
      first_name: body.data.name.split(" ")[0],
      last_name: body.data.name.split(" ").slice(1).join(" "),
      phone_number: body.data.phone,
      email: user.email!,
      ticket: Tickets.Accommodation,
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    const payload = {
      tiqrBookingUid: tiqrData.booking.uid,
      paymentStatus: tiqrData.booking.status,
      paymentUrl: tiqrData.payment.url_to_redirect || "",
      updatedAt: FieldValue.serverTimestamp(),
    } as AccommodationSchema["events"][number];

    await userSnap.ref.update(payload);

    return {
      success: true,
      message: "Booked accommodation successfully",
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.get("/accommodation/status", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const userSnap = await db.collection("accommodation").doc(user.uid).get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        message: "No registration found for this user",
      };
    }

    const userData = userSnap.data() as AccommodationSchema;

    if (!userData.tiqrBookingUid) {
      reply.code(404);
      return {
        error: true,
        message: "No booking found for this event",
      };
    }

    if (userData.paymentStatus === PaymentStatus.Confirmed) {
      reply.code(200);
      return {
        success: true,
        status: PaymentStatus.Confirmed,
        message: "Registration confirmed",
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(userData.tiqrBookingUid);
    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    if (
      tiqrData.booking.status &&
      tiqrData.booking.status !== userData.paymentStatus
    ) {
      await userSnap.ref.update({
        paymentStatus: tiqrData.booking.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      success: true,
      status: tiqrData.booking.status,
      phone: userData.phone,
      college: userData.college,
      name: userData.name,
      message: "Status fetched successfully",
    };
  });
};

const AccommodationBookingPayload = z.object({
  name: z.string().min(1),
  phone: z.string().min(10),
  college: z.string().min(1),
});

interface AccommodationSchema extends Record<string, any> {
  name: string;
  email: string;
  phone: string;
  college: string;
  tiqrBookingUid?: string;
  paymentStatus?: PaymentStatus;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

export default Accommodation;
