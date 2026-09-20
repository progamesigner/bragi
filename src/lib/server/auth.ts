import "server-only";
import { jwtVerify, SignJWT } from "jose";
import * as OTPAuth from "otpauth";
import { requiredEnv, sessionVersion } from "./config";
import { readCookie } from "./http";

export const SESSION_COOKIE = "__Host-bragi";
const ISSUER = "bragi";
const AUDIENCE = "bragi-web";
const THIRTY_DAYS = 30 * 24 * 60 * 60;

function sessionKey(): Uint8Array {
  const secret = requiredEnv("BRAGI_SESSION_SECRET");
  if (new TextEncoder().encode(secret).byteLength < 32)
    throw new Error("BRAGI_SESSION_SECRET must be at least 32 bytes");
  return new TextEncoder().encode(secret);
}

export function verifyTotp(token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const totp = new OTPAuth.TOTP({
    issuer: "Bragi",
    label: "Bragi",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(requiredEnv("BRAGI_TOTP_SECRET").replace(/\s+/g, "")),
  });
  return totp.validate({ token, window: 1 }) !== null;
}

export async function issueSession(): Promise<string> {
  return new SignJWT({ ver: sessionVersion() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${THIRTY_DAYS}s`)
    .setJti(crypto.randomUUID())
    .sign(sessionKey());
}

export async function hasValidSession(request: Request): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload.ver === sessionVersion();
  } catch {
    return false;
  }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${THIRTY_DAYS}; HttpOnly; Secure; SameSite=Strict`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
