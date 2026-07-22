// Durable identity + per-tab session, shared by the game (App) and the club/menu (Club) so a
// queue-created seat matches what App later sends on join. See HOLLOWFALL_match_session_architecture.md.
const uuid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

// Durable guest seat id — persists across reloads/routes so a guest re-claims the same seat.
// (Authenticated users get their seat from the server via their JWT; this is the guest fallback.)
function getGuestSeatId(): string {
  let id = localStorage.getItem('hollowfall_guest_seat_id');
  if (!id) { id = `guest_${uuid()}`; localStorage.setItem('hollowfall_guest_seat_id', id); }
  return id;
}

// Per-tab session id (fencing token). sessionStorage = one per browser tab, survives reload and
// same-tab navigation between /club and /lobby; a second tab gets its own id and takes over.
function getSessionId(): string {
  let id = sessionStorage.getItem('hollowfall_session_id');
  if (!id) { id = uuid(); sessionStorage.setItem('hollowfall_session_id', id); }
  return id;
}

export const GUEST_SEAT_ID = getGuestSeatId();
export const SESSION_ID = getSessionId();
