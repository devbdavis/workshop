/** Hex chars of the session UUID used in dev hostnames and tmux names: 48 bits, so prefix collisions are not handled. */
export const SID_LENGTH = 12;

/** Short, hostname-safe session id: the first 12 hex chars of the UUID. */
export function devSid(sessionId: string): string {
  return sessionId.replace(/-/g, '').slice(0, SID_LENGTH).toLowerCase();
}
