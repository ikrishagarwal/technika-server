import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import TiQR, { BookingPayload } from "../lib/tiqr";

// MFD: I don't think we actually need a route for this, will delete later
const booking: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.post("/booking", async function (request, reply) {
    if (!(await validateAuthToken(request))) {
      reply.status(401);
      return {
        error: true,
        message: "Unauthorized",
      };
    }

    const body = request.body as BookingRequestBody;

    if (!body) {
      reply.status(400);
      return {
        error: true,
        message: "Missing booking data",
      };
    }

    if (request.headers["x-private-secret"] !== process.env.TESTING_SECRET) {
      reply.status(403);
      return {
        error: true,
        message: "Forbidden",
      };
    }

    try {
      const tiqrResponse = await TiQR.createBooking(body as BookingPayload);
      reply.status(tiqrResponse.status);
      return await tiqrResponse.json();
    } catch (err: any) {
      reply.status(500);
      return {
        error: true,
        message: err.message || String(err),
      };
    }
  });

  fastify.get("/booking/:uid", async function (request, reply) {
    const params = request.params as { uid: string };
    const uid = params.uid || "";

    if (!uid) {
      reply.status(400);
      return {
        error: true,
        message: "Missing booking UID",
      };
    }

    if (!(await validateAuthToken(request))) {
      reply.status(401);
      return {
        error: true,
        message: "Unauthorized",
      };
    }

    if (request.headers["x-private-secret"] !== process.env.TESTING_SECRET) {
      reply.status(403);
      return {
        error: true,
        message: "Forbidden",
      };
    }

    try {
      const tiqrResponse = await TiQR.fetchBooking(uid);
      reply.status(tiqrResponse.status);
      return await tiqrResponse.json();
    } catch (err: any) {
      return {
        error: true,
        message: err.message || String(err),
      };
    }
  });
};

export default booking;

interface BookingRequestBody {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  ticket: number;
  meta_data?: Record<string, any>;
  callback_url?: string;
}
