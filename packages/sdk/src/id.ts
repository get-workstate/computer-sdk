import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function createId(prefix: string): string {
  const bytes = randomBytes(12);
  let body = "";
  for (let i = 0; i < 12; i += 1) {
    body += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${body}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
