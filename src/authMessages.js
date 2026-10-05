// Convert auth-provider and browser failures into actionable messages. Keep
// implementation details (URLs, stack traces, raw gateway text) out of UI.
export function friendlyAuthError(error, action = 'sign in') {
  const message = String(error?.message || error || '').trim();
  const lower = message.toLowerCase();
  if (/invalid login credentials|invalid email or password/.test(lower)) {
    return 'That email and password do not match. Check them and try again.';
  }
  if (/email not confirmed|email_not_confirmed/.test(lower)) {
    return 'Please confirm your email using the link in your inbox, then sign in.';
  }
  if (/user already registered|user_already_exists/.test(lower)) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (/password.*(weak|short)|weak_password/.test(lower)) {
    return 'Choose a stronger password with at least 6 characters.';
  }
  if (/rate limit|too many requests|over_email_send_rate_limit/.test(lower)) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (/failed to fetch|networkerror|network request failed|load failed/.test(lower)) {
    return 'Could not reach the sign-in service. Check your internet connection and try again.';
  }
  if (/supabase is not configured/.test(lower)) {
    return 'Sign-in is not configured on this deployment. Please contact the Driftpost administrator.';
  }
  return `Driftpost could not ${action}. Check your details and try again. If it continues, contact support.`;
}
