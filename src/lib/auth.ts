import { FastifyRequest } from "fastify";

export function isAuthTokenValid(request: FastifyRequest): boolean {
  const auth = request.headers["authorization"];

  if (!auth) return false;
  if (auth.toString() !== process.env.AUTH_TOKEN) return false;

  return true;
}
