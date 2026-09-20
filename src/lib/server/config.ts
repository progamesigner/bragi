import "server-only";

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function sessionVersion(): string {
  return process.env.BRAGI_SESSION_VERSION?.trim() || "1";
}
