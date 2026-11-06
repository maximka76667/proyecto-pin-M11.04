// There is no login yet, so the screens that need "who am I" and "which apartment" use these
// fixed ids (the same ones as the seed data). Replace them when authentication exists.
const storedApartmentId =
  typeof window !== 'undefined' ? window.localStorage.getItem('room8_apartment_id') : null;
const storedUserId =
  typeof window !== 'undefined' ? window.localStorage.getItem('room8_user_id') : null;

export let APARTMENT_ID = storedApartmentId ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export let USER_ID = storedUserId ?? '22222222-2222-2222-2222-222222222222';

export function setCurrentSessionIds(userId: string, apartmentId?: string) {
  USER_ID = userId;
  if (apartmentId) APARTMENT_ID = apartmentId;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('room8_user_id', userId);
    if (apartmentId) window.localStorage.setItem('room8_apartment_id', apartmentId);
  }
}
