import { FastifyRequest } from "fastify";
import { admin } from "./firebase";

export async function validateAuthToken(request: FastifyRequest) {
  const auth = request.headers["authorization"];

  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  try {
    const checkRevoked = process.env.NODE_ENV !== "development";
    return await admin.auth().verifyIdToken(token, checkRevoked);
  } catch {
    return null;
  }
}
