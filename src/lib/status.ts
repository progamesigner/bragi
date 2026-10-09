import type { ErrorDetails } from "./api";
import { describeError } from "./network";

export type StatusTone = "info" | "success" | "error";

export type StatusMessage = {
  message: string;
  tone: StatusTone;
  /** Shown behind a disclosure so the message itself stays about cause and next step. */
  details?: ErrorDetails;
};

export type StatusReporter = (message: string, tone?: StatusTone, details?: ErrorDetails) => void;

/** Reports a caught error as cause-and-next-step text, with any API details attached. */
export function reportError(report: StatusReporter, error: unknown, fallback: string): string {
  const { message, details } = describeError(error, fallback);
  report(message, "error", details);
  return message;
}
