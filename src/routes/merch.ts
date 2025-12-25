import { FastifyPluginAsync } from "fastify";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import z from "zod";
import { PaymentStatus, Tickets } from "../constants";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import TiQR, { BookingResponse, FetchBookingResponse } from "../lib/tiqr";

const MERCH_COLLECTION = "merchandise";

const Merch: FastifyPluginAsync = async (fastify): Promise<void> => {
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

  fastify.post("/merch/order", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = MerchOrderPayload.safeParse(request.body);

    if (!body.success) {
      reply.status(400);
      return {
        error: true,
        message: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }

    let ticketId;

    switch (body.data.item.type) {
      case "tee":
        ticketId = Tickets.MerchTee;
        break;
      case "jacket":
        ticketId = Tickets.MerchJacket;
        break;
      case "combo":
        ticketId = Tickets.MerchCombo;
        break;
      default:
        reply.status(400);
        return {
          error: true,
          message: "Invalid merch item type",
        };
    }

    const tiqrResponse = await TiQR.createBooking({
      first_name: body.data.name.split(" ")[0],
      last_name: body.data.name.split(" ").slice(1).join(" "),
      phone_number: body.data.phone,
      email: user.email!,
      ticket: ticketId,
      quantity: body.data.item.quantity,
      meta_data: {
        merch: {
          items: body.data.item,
        },
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;
    fastify.log.info(tiqrData);
    const orderId = tiqrData.booking.uid;

    const orderDoc: MerchOrderDocument = {
      userId: user.uid,
      email: user.email || "",
      name: body.data.name,
      phone: body.data.phone,
      college: body.data.college,
      item: body.data.item,
      tiqrBookingUid: orderId,
      paymentStatus: tiqrData.booking.status as PaymentStatus,
      paymentUrl: tiqrData.payment.url_to_redirect || "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.collection(MERCH_COLLECTION).doc(orderId).set(orderDoc);

    reply.code(200);
    return {
      success: true,
      message: "Created merch order successfully",
      orderId,
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.get("/merch/orders", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const ordersSnap = await db
      .collection(MERCH_COLLECTION)
      .where("userId", "==", user.uid)
      .get();

    const orders = ordersSnap.docs.map((doc) => {
      const order = doc.data() as MerchOrderDocument;

      return {
        id: doc.id,
        item: order.item,
        paymentStatus: order.paymentStatus,
        paymentUrl: order.paymentUrl,
      };
    });

    reply.code(200);
    return { success: true, orders };
  });

  fastify.get("/merch/order/:id", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const params = request.params as { id?: string };
    const id = (params?.id || "").trim();

    if (!id) {
      reply.code(400);
      return { error: true, message: "Missing order id" };
    }

    const orderRef = db.collection(MERCH_COLLECTION).doc(id);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      reply.code(404);
      return { error: true, message: "Order not found" };
    }

    const order = orderSnap.data() as MerchOrderDocument;

    if (order.userId !== user.uid) {
      reply.code(403);
      return { error: true, message: "Forbidden" };
    }

    if (order.paymentStatus === PaymentStatus.Confirmed) {
      reply.code(200);
      return {
        success: true,
        orderId: id,
        status: PaymentStatus.Confirmed,
        paymentUrl: order.paymentUrl,
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(id);

    const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

    if (tiqrData.status && tiqrData.status !== order.paymentStatus) {
      await orderRef.update({
        paymentStatus: tiqrData.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    reply.code(200);
    return {
      success: true,
      orderId: id,
      status: tiqrData.status,
      paymentUrl: order.paymentUrl,
      checksum:
        tiqrData.status === PaymentStatus.Confirmed ? tiqrData.checksum : null,
    };
  });
};

const MerchItemPayload = z.object({
  type: z.enum(["tee", "jacket", "combo"]),
  quantity: z.number().int().min(1).default(1),
  size: z.string().min(1).optional(),
});

const MerchOrderPayload = z.object({
  name: z.string().min(1),
  phone: z.string().min(10),
  college: z.string().min(1),
  item: MerchItemPayload,
});

interface MerchOrderDocument extends Record<string, any> {
  userId: string;
  name: string;
  email: string;
  phone: string;
  college: string;
  item: { type: string; quantity: number; size?: string };
  tiqrBookingUid: string;
  paymentStatus: PaymentStatus | string;
  paymentUrl: string;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

export default Merch;
