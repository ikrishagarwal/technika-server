import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { DecodedIdToken } from "firebase-admin/auth";
import z from "zod";
import TiQR, { BookingResponse } from "../lib/tiqr";
import { db } from "../lib/firebase";
import { FieldValue } from "firebase-admin/firestore";
import { PaymentStatus, Tickets } from "../constants";
import { isBitEmail } from "../lib/utils";

const Event: FastifyPluginAsync = async (fastify): Promise<any> => {
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

    if (body.data.isBitStudent && user.email && isBitEmail(user.email)) {
      const payload = {
        isBitStudent: true,
        status: PaymentStatus.Confirmed,
        paymentUrl: "",
        type: body.data.type,
        members: body.data.members || FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      } as Partial<EventSchema["events"][number]>;

      body.data.type === "group" && (payload.members = body.data.members);

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

      const payload = {
        isDelegate: true,
        status: PaymentStatus.Confirmed,
        paymentUrl: "",
        type: body.data.type,
        members: body.data.members || FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      } as Partial<EventSchema["events"][number]>;

      body.data.type === "group" && (payload.members = body.data.members);

      await userSnap.ref.update({
        [`events.${body.data.eventId}`]: payload,
      });

      return {
        success: true,
        message: "Booking created successfully",
      };
    }

    const tiqrResponse = await TiQR.createBooking({
      first_name: body.data.name.split(" ")[0],
      last_name: body.data.name.split(" ").slice(1).join(" "),
      phone_number: body.data.phone,
      email: user.email!,
      ticket:
        body.data.eventId < 100
          ? body.data.type === "solo"
            ? Tickets.TechnicalSolo
            : Tickets.TechnicalGroup
          : body.data.type === "solo"
          ? Tickets.CulturalSolo
          : Tickets.CulturalGroup,
      meta_data: {
        eventId: body.data.eventId,
        members: body.data.members || [],
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    const payload = {
      tiqrBookingUid: tiqrData.booking.uid,
      status: tiqrData.booking.status,
      paymentUrl: tiqrData.payment.url_to_redirect || "",
      type: body.data.type,
      members: body.data.members || FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    } as EventSchema["events"][number];

    body.data.type === "group" && (payload.members = body.data.members);

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
      isBitStudent: userData.isBitStudent || false,
      isDelegate: userData.isDelegate || false,
      status: tiqrData.booking.status,
      phone: userData.phone,
      college: userData.college,
      name: userData.name,
      members: userData.events[eventId].members,
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
  isBitStudent?: boolean;
  isDelegate?: boolean;
  events: Record<
    number,
    {
      tiqrBookingUid: string;
      status: string;
      paymentUrl: string;
      type: string;
      members?: Array<{
        name: string;
        phone: string;
        email: string;
      }>;
    }
  >;
}

export default Event;
