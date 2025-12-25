import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { DecodedIdToken } from "firebase-admin/auth";
import z from "zod";
import TiQR, { BookingResponse, FetchBookingResponse } from "../lib/tiqr";
import { db } from "../lib/firebase";
import { FieldValue } from "firebase-admin/firestore";
import {
  EventIdToPriceMap,
  PaymentStatus,
  SoloEvents,
  TicketPriceToIdMap,
} from "../constants";
import { isBitEmail } from "../lib/utils";

const Event: FastifyPluginAsync = async (fastify): Promise<any> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request).catch(() => null);

    if (!user) {
      return await reply.code(401).send({
        error: true,
        message: "unauthorized",
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

    if (
      body.data.type === "group" &&
      (!body.data.members || body.data.members.length < 1)
    ) {
      reply.status(400);
      return {
        error: true,
        message: "Group bookings require at least 2 members",
      };
    }

    const eventPrice =
      EventIdToPriceMap[body.data.eventId as keyof typeof EventIdToPriceMap];

    if (!eventPrice) {
      reply.status(400);
      return {
        error: true,
        message: "This event doesn't need a ticket",
      };
    }

    const eventTicketId =
      TicketPriceToIdMap[eventPrice as keyof typeof TicketPriceToIdMap];

    if (!eventTicketId) {
      reply.status(400);
      return {
        error: true,
        message: "This event isn't open for registrations",
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
        college: body.data.college,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      userSnap = await userSnap.ref.get();
    }

    const userData = userSnap.data() as EventSchema;

    if (
      userData.events &&
      userData.events[body.data.eventId]?.status === PaymentStatus.Confirmed
    ) {
      reply.status(400);
      return {
        error: true,
        message: "You have already registered for this event",
      };
    }

    const payload = {
      type: body.data.type,
      updatedAt: FieldValue.serverTimestamp(),
    } as Partial<EventSchema["events"][number]>;

    if (
      body.data.members &&
      body.data.type === "group" &&
      body.data.members.length > 0
    )
      payload.members = body.data.members;

    if (body.data.isBitStudent && user.email && isBitEmail(user.email)) {
      payload.isBitStudent = true;
      payload.status = PaymentStatus.Confirmed;
      payload.paymentUrl = "";

      await userSnap.ref.update({
        [`events.${body.data.eventId}`]: payload,
      });

      return {
        success: true,
        message: "Booking created successfully",
      };
    } else if (body.data.isBitStudent) {
      reply.status(403);
      return {
        error: true,
        message: "Invalid BIT email address",
      };
    }

    if (body.data.isDelegate) {
      const delegateUser = await db.collection("delegate").doc(user.uid).get();

      if (!delegateUser.exists) {
        reply.status(403);
        return {
          error: true,
          message: "You are not registered as a delegate",
        };
      }

      if (delegateUser.data()!.paymentStatus != PaymentStatus.Confirmed) {
        reply.status(403);
        return {
          error: true,
          message: "Your delegate registration is not confirmed",
        };
      }

      payload.isDelegate = true;

      // Delegates get free bookings only for solo events.
      if (SoloEvents.includes(body.data.eventId)) {
        payload.status = PaymentStatus.Confirmed;
        payload.paymentUrl = "";

        await userSnap.ref.update({
          [`events.${body.data.eventId}`]: payload,
        });

        return {
          success: true,
          message: "Booking created successfully",
        };
      }
    }

    const tiqrResponse = await TiQR.createBooking({
      first_name: body.data.name.split(" ")[0],
      last_name: body.data.name.split(" ").slice(1).join(" "),
      phone_number: body.data.phone,
      email: user.email!,
      ticket: eventTicketId,
      meta_data: {
        eventId: body.data.eventId,
        members: body.data.members || [],
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    payload.tiqrBookingUid = tiqrData.booking.uid;
    payload.status = tiqrData.booking.status;
    payload.paymentUrl = tiqrData.payment.url_to_redirect || "";

    await userSnap.ref.update({
      [`events.${body.data.eventId}`]: payload,
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
        isBitStudent: userData.isBitStudent || false,
        isDelegate: userData.isDelegate || false,
        phone: userData.phone,
        college: userData.college,
        name: userData.name,
        members: userData.events[eventId].members,
        status: PaymentStatus.Confirmed,
        message: "Registration confirmed",
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(
      userData.events[eventId].tiqrBookingUid
    );
    const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

    if (
      tiqrData.status &&
      tiqrData.status !== userData.events[eventId].status
    ) {
      await userSnap.ref.update({
        [`events.${eventId}.status`]: tiqrData.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      success: true,
      isBitStudent: userData.isBitStudent || false,
      isDelegate: userData.isDelegate || false,
      status: tiqrData.status,
      phone: userData.phone,
      college: userData.college,
      name: userData.name,
      members: userData.events[eventId].members,
      message: "Status fetched successfully",
    };
  });

  fastify.get("/event/qr/:eventId", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const eventId = Number((request.params as { eventId: string }).eventId);

    if (!eventId || isNaN(eventId)) {
      reply.code(400);
      return { error: true, message: "Invalid or missing event ID" };
    }

    const userSnap = await db
      .collection("event_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      reply.code(404);
      return { error: true, message: "No registration found for this user" };
    }

    const userData = userSnap.data() as EventSchema;

    if (
      !userData.events ||
      !userData.events[eventId] ||
      !userData.events[eventId].tiqrBookingUid
    ) {
      reply.code(404);
      return { error: true, message: "No booking found for this event" };
    }

    try {
      const tiqrResponse = await TiQR.fetchBooking(
        userData.events[eventId].tiqrBookingUid
      );

      if (!tiqrResponse.ok) {
        reply.code(502);
        return { error: true, message: "Failed to fetch booking from TiQR" };
      }

      const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

      if (tiqrData.status === PaymentStatus.Confirmed) {
        return { success: true, checksum: tiqrData.checksum };
      }

      reply.code(403);
      return {
        error: true,
        message: "Payment not confirmed",
        status: tiqrData.status,
      };
    } catch (err) {
      reply.code(500);
      return { error: true, message: "Internal server error" };
    }
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
  college: z.string().min(1),
  type: z.enum(["solo", "group"]),
  isBitStudent: z.boolean().optional(),
  isDelegate: z.boolean().optional(),
  members: z
    .array(
      z.object({
        name: z.string().min(1),
        phone: z.string().min(10),
        email: z.string().email(),
      })
    )
    .optional(),
});

interface EventSchema extends Record<string, any> {
  name: string;
  email: string;
  phone: string;
  college: string;
  events: Record<
    number,
    {
      tiqrBookingUid: string;
      status: string;
      paymentUrl: string;
      type: string;
      isBitStudent?: boolean;
      isDelegate?: boolean;
      members?: Array<{
        name: string;
        phone: string;
        email: string;
      }>;
    }
  >;
}

export default Event;
