// PII scrubbing for anything we persist beyond the request.
//
// Two categories, treated differently on purpose:
//  - The USER's brief is free text they typed. It can contain their own phone,
//    email or a customer's name, none of which we need in order to learn their
//    writing style. Scrub it.
//  - A generated caption legitimately contains the BRAND's public contact
//    details, which come from an approved record and are meant to be published.
//    Redacting those would corrupt the example and teach the model to drop the
//    footer. So an allow-list of confirmed brand numbers survives; anything
//    else numeric is scrubbed.
//
// This is defence in depth, not a guarantee: name detection is a heuristic and
// personal names in free text are not reliably detectable without a model.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Indian mobile/landline, with the separators people actually type.
const PHONE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g;
// Long digit runs: card-like, bank-account-like, order ids.
const LONGDIGITS = /\b\d{9,}\b/g;
// Anything that looks like a credential the user pasted in by mistake.
const SECRET = /\b(?:sk|pk|api|key|token|secret|password|passwd|bearer)[-_ ]?[A-Za-z0-9]{8,}\b/gi;

const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

// Build the allow-list once per call from the brand's own record.
function allowedNumbers(brand) {
  const out = new Set();
  const add = (v) => {
    for (const one of Array.isArray(v) ? v : [v]) {
      const d = digits(one);
      if (d.length >= 10) out.add(d);
    }
  };
  const b = brand && typeof brand === 'object' ? brand : {};
  add(b.phone); add(b.phone_display); add(b.contacts?.phone);
  add(b.contact?.phone_display); add(b.contact?.phones);
  if (Array.isArray(b.business?.phone)) add(b.business.phone);
  for (const l of b.fixed_footer?.lines || []) add(l);
  for (const l of b.footer_lines || []) add(l);
  for (const l of b.footer || []) add(l);
  for (const l of b.fixed_footer?.full_lines || []) add(l);
  return out;
}

// Returns the text with personal identifiers replaced by a type marker, so the
// stored record still shows that something was there.
export function redactPii(text, { brand = null } = {}) {
  let s = String(text || '');
  if (!s.trim()) return '';
  s = s.replace(EMAIL, '[email removed]');
  s = s.replace(SECRET, '[credential removed]');
  const allowed = allowedNumbers(brand);
  s = s.replace(PHONE, (m) => (allowed.has(digits(m)) ? m : '[phone removed]'));
  s = s.replace(LONGDIGITS, (m) => (allowed.has(digits(m)) ? m : '[number removed]'));
  return s;
}

// Scrub a record's fields. `body` keeps confirmed brand contacts; everything
// the user typed is scrubbed.
export function redactRecord(rec, brand) {
  return {
    ...rec,
    brief: rec.brief ? redactPii(rec.brief, { brand }) : rec.brief,
    body: rec.body ? redactPii(rec.body, { brand }) : rec.body,
  };
}

export const __test = { digits, allowedNumbers };
