export function normalizeHttpOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin, configuredOrigins = [], knownOrigins = []) {
  if (!origin) return true;
  const requested = normalizeHttpOrigin(origin);
  if (!requested) return false;
  const allowed = [...configuredOrigins, ...knownOrigins]
    .map(normalizeHttpOrigin)
    .filter(Boolean);
  return allowed.includes(requested);
}
