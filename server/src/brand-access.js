// Private client profiles contain approved brand voice, facts, and contact
// details. Keep access tied to verified identities; never trust a client-side
// account selector or a brand name embedded in a prompt as authorization.
const PRIVATE_BRAND_EMAILS = new Set([
  'famebros.studio@gmail.com',
  'kabirsayed.k@gmail.com',
]);

export function canUsePrivateBrandData(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return Boolean(user?.email_confirmed_at) && PRIVATE_BRAND_EMAILS.has(email);
}
