import { customAlphabet } from "nanoid";

export function uuid() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return customAlphabet(chars, 15)();
}

export function httpError(statusCode: number, message: object) {
  const err = new Error();
  (err as any).error = message;
  (err as any).statusCode = statusCode;
  return err;
}
