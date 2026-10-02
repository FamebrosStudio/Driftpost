// Older browser builds sent identity fields twice. Accept identical scalar
// values, but reject conflicting values rather than choosing an account.
export function scheduleIdentity(body = {}) {
  const scalar = (value) => {
    const values = Array.isArray(value) ? value : [value ?? ''];
    if (!values.length || values.some((item) => typeof item !== 'string') || values.some((item) => item !== values[0])) {
      throw new Error('Conflicting scheduling fields. Refresh the page and select the account again.');
    }
    return values[0];
  };
  return { platform: scalar(body.platform), connection_id: scalar(body.connection_id) };
}
