import { customAlphabet } from "nanoid";
import { BIT_EMAILS } from "../constants";

export function uuid() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return customAlphabet(chars, 15)();
}

export class HttpError extends Error {
  statusCode: number;
  error: object;

  constructor(statusCode: number, message: string, error: object = {}) {
    super();
    this.statusCode = statusCode;
    this.message = message;
    this.error = error;
  }
}

export function isBitEmail(email: string): boolean {
  const regexpMatch = /^[a-z]+15[0-9]{3}\.[12][0-9]@bitmesra\.ac\.in$/.test(
    email
  );
  if (regexpMatch) return true;

  return BIT_EMAILS.includes(email);
}
