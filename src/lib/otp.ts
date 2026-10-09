export const OTP_LENGTH = 6;

/**
 * Keeps digits only, so pasted codes like "123 456", autofilled values and full-width digits from
 * an input method still work.
 */
export function sanitizeOtp(raw: string): string {
  return raw.normalize("NFKC").replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export type OtpState = {
  code: string;
  /** A code the server rejected; it stays blocked until the input changes. */
  rejected?: string;
};

/** The next state after the input changes; any real change unblocks sending again. */
export function editOtp(state: OtpState, raw: string): OtpState {
  const code = sanitizeOtp(raw);
  return code === state.code ? state : { code };
}

/** Whether this code may be sent now, automatically or by the button. */
export function canSendOtp(state: OtpState, busy: boolean): boolean {
  return state.code.length === OTP_LENGTH && !busy && state.code !== state.rejected;
}
