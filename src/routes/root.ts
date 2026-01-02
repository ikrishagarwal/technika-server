import { FastifyPluginAsync } from "fastify";
import { isBitEmail } from "../lib/utils";

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.get("/", async function (request, reply) {
    return { message: "Welcome to the root of the API" };
  });

  fastify.get<{
    Params: {
      email: string;
    };
  }>("/isBitEmail/:email", async function (request, reply) {
    const email = (request.params.email ?? "").trim().toLowerCase();

    return { success: true, isBitEmail: isBitEmail(email) };
  });
};

export default root;
