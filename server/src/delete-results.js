// A deletion request can contain several platform posts. Any upstream
// platform refusal is a per-item result, not an API outage (5xx).
export function deleteResultsStatus(results) {
  return (results || []).some((item) => !item?.ok) ? 207 : 200;
}
