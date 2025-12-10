import { customAlphabet } from "nanoid";

export function uuid() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return customAlphabet(chars, 10)();
}
