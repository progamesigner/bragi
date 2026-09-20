export type StatusTone = "info" | "success" | "error";

export type StatusMessage = {
  message: string;
  tone: StatusTone;
};

export type StatusReporter = (message: string, tone?: StatusTone) => void;
