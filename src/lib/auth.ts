import { FastifyRequest } from "fastify";
import { admin } from "./firebase";

export function validateAuthToken(request: FastifyRequest) {
  const auth = request.headers["authorization"];

  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  try {
    const decodedToken = admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch {
    return null;
  }
}
