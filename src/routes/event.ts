import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { DecodedIdToken } from "firebase-admin/auth";
import z from "zod";
import TiQR, { BookingResponse } from "../lib/tiqr";
import { db } from "../lib/firebase";
import { FieldValue } from "firebase-admin/firestore";
import { PaymentStatus } from "../constants";

const Event: FastifyPluginAsync = async (fastify): Promise<any> => {
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

  fastify.post("/event/book", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = EventBookingPayload.safeParse(request.body);

    if (!body.success) {
      reply.status(400);
      return {
        error: true,
        message: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }

    let userSnap = await db
      .collection("event_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      await userSnap.ref.set({
        email: user.email,
        name: body.data.name,
        phone: body.data.phone,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      userSnap = await userSnap.ref.get();
    }

    const tiqrResponse = await TiQR.createBooking({
      first_name: body.data.name.split(" ")[0],
      last_name: body.data.name.split(" ").slice(1).join(" "),
      phone_number: body.data.phone,
      email: user.email!,
      ticket: 2398,
      meta_data: {
        eventId: body.data.eventId,
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    fastify.log.info(JSON.stringify(tiqrData, null, 2));

    await userSnap.ref.update({
      [`events.${body.data.eventId}`]: {
        tiqrBookingUid: tiqrData.booking.uid,
        status: tiqrData.booking.status,
        paymentUrl: tiqrData.payment.url_to_redirect || "",
        updatedAt: FieldValue.serverTimestamp(),
      },
    });

    return {
      success: true,
      message: "Booking created successfully",
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.get("/event/status/:eventId", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const eventId = Number((request.params as { eventId: string }).eventId);

    if (!eventId || isNaN(eventId)) {
      reply.code(400);
      return {
        error: true,
        message: "Invalid or missing event ID",
      };
    }

    const userSnap = await db
      .collection("event_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        message: "No registration found for this user",
      };
    }

    const userData = userSnap.data() as EventSchema;

    if (
      !userData.events ||
      !userData.events[eventId] ||
      !userData.events[eventId].tiqrBookingUid
    ) {
      reply.code(404);
      return {
        error: true,
        message: "No booking found for this event",
      };
    }

    if (userData.events[eventId].status === PaymentStatus.Confirmed) {
      reply.code(200);
      return {
        success: true,
        status: PaymentStatus.Confirmed,
        message: "Registration confirmed",
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(
      userData.events[eventId].tiqrBookingUid
    );
    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    if (
      tiqrData.booking.status &&
      tiqrData.booking.status !== userData.events[eventId].status
    ) {
      await userSnap.ref.update({
        [`events.${eventId}.status`]: tiqrData.booking.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      success: true,
      status: tiqrData.booking.status,
      message: "Status fetched successfully",
    };
  });

  fastify.get("/event/registered", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const userSnap = await db
      .collection("event_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        message: "No registration found for this user",
      };
    }

    const userData = userSnap.data() as EventSchema;
    const events = {} as any;

    for (const [key, value] of Object.entries(userData.events || {})) {
      events[key] = value.status;
    }

    return {
      success: true,
      events,
    };
  });
};

const EventBookingPayload = z.object({
  eventId: z.coerce.number(),
  name: z.string().min(1),
  phone: z.string().min(10),
});

interface EventSchema extends Record<string, any> {
  name: string;
  phone: string;
  email: string;
  events: Record<
    number,
    {
      tiqrBookingUid: string;
      status: string;
      paymentUrl: string;
    }
  >;
}

export default Event;
