import { FastifyPluginAsync } from "fastify";
import { ApiEndpoints } from "../constants";
import { isAuthTokenValid } from "../lib/auth";

const booking: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.post("/booking", async function (request, reply) {
    if (!isAuthTokenValid(request)) {
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

    try {
      const data = await fetch(ApiEndpoints.createBooking(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.API_TOKEN || ""}`,
        },
        body: JSON.stringify(body),
      });

      //////////////
      // TODO: API is down for now, so text and fix this part later

      const text = await data.text();
      fastify.log.info("Booking create response:");
      fastify.log.info(text);
      // const jsonData = await data.json();
      const jsonData = JSON.parse(text);
      reply.status(data.status);
      return jsonData;
      //////////////
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

    // fastify.log.info(
    //   `Fetching booking for UID: ${uid} with token: ${token} : ${
    //     token.toString().trim() == process.env.AUTH_TOKEN
    //   }`
    // );

    // implement a custom token logic if needed
    if (!isAuthTokenValid(request)) {
      reply.status(401);
      return {
        error: true,
        message: "Unauthorized",
      };
    }

    try {
      const data = await fetch(ApiEndpoints.fetchBooking(uid), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.API_TOKEN || ""}`,
        },
      });

      ////////////////////////////
      // TODO: API is down for now, so text and fix this part later
      const text = await data.text();
      console.log("Booking fetch response:", text);
      // const jsonData = await data.json();
      const jsonData = JSON.parse(text);
      reply.status(data.status);
      return jsonData;
      ///////////////////////////
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
