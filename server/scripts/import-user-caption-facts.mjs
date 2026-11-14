import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'brand-memory');
const day = '2026-11-14';
const brands = [
  ['map_clothing', 'MAP for Men', 'Shop No. 3, Shyam Apt., Tambe Nagar, Ashok Nagar, Mulund West, Mumbai 400080', ['+91 98925 65737'], null, ['MAP for Men'], 'Trouser-stitching informational caption; testimonial-like fit/wash claims are post-specific, not a general guarantee.'],
  ['reshine_clinic', 'Re.Shine Skin Clinic', '501, Sorrento Building, Hiranandani, Powai - 400076', ['+91 99604 01016'], null, ['Re.Shine Skin Clinic', 'ReShine Skin Clinic'], 'Chemical-peel caption advises consultation and notes multiple sessions/downtime may apply; do not present as individual medical advice.'],
  ['sk_furniture', 'SK Furniture Market', 'Shop No. 50 & 51, Purna Shanti Heights, Khartan Road, Thane 400601', ['8433870901', '9167870901'], 'skfurnituremarket@gmail.com', ['SK Furniture Market'], 'Caption features metal/combination cupboards. Free delivery, zero down payment and EMI are time-sensitive offers; reconfirm before reuse.'],
  ['vj_jewels', 'Infinity Silver by VJ Jewels', 'Bharat Industrial Estate, T J Road, Gala No. 305, Near Ashok Garden, Sewri, Mumbai 400015', ['+91 89283 53255'], null, ['Infinity Silver by VJ Jewels', 'Infinity Silver'], 'Caption says silver jewellery exporter, manufacturer and wholesaler. User-supplied positioning; do not infer purity or hallmarking.'],
  ['charan_singh_sapra', 'Charan Singh Sapra', null, [], null, [], 'Hindi political-accountability caption; no physical location or contact details supplied. Follow handle: @charansinghsapra_official.'],
  ['roopali_saree', 'Roopali Sarees', 'Shop No. 1, B-49, Chaitali Bldg., Sector-1, Shanti Nagar, Mira Road (E), Thane - 401107', ['+91 90225 61477'], null, ['Roopali Sarees'], 'Customer-appreciation caption; treat the customer experience as post-specific and do not invent or generalize a testimonial.'],
  ['zam_zam_motors', 'Zam Zam Motors', 'Runwal Greens BMC Parking B1 Basement, Mulund West, Mumbai 400080, India', ['8369160734'], null, [], 'Caption lists one 2021 Mahindra XUV500 W11. Individual listing is not current inventory; reconfirm availability/specifications. Non-accidental statement is attributed, not independently verified.'],
  ['paak_pehnawa_mens', 'Paak Pehnawa', null, [], null, [], 'Ethnicwear style showcase with Pakistani-inspired styling language and DM-to-order CTA; no location/contact supplied.'],
  ['perfume_vault', 'Parrfums Vault', null, ['+91 85919 35352'], null, ['Perfume Vault', 'Parrfum Vault', '@parrfums.vault'], 'User confirms display spelling Parrfums Vault. Caption-specific product: LEATHER. WhatsApp CTA is stated. Do not generalize authenticity, longevity or performance claims.'],
  ['cotton_plus', 'Cotton Plus', ['Seawoods: Shop No. 1/2, Neelkanth Plaza, Plot No. 53, Sector 40, Seawoods, Nerul (W), Navi Mumbai 400706', 'Kharghar: Shop No. 9/10/11, Sai Moksh, Plot No. 48, Sector 15, Kharghar, Navi Mumbai 410210', 'Kalamboli: Shop No. G9/F9, Plot No. 4, Neelsiddhi Amrante Phase 2, Sector 9E, Near D-Mart, Roadpali, Kalamboli, Panvel 410218'], ['7666632979', '9892461454', '022 31939258'], null, [], 'Caption identifies three stores and a follower-gift promotion. Phone numbers are not mapped to individual branches; do not infer. Reconfirm offer terms.'],
  ['chinese_and_grill', 'Chinese N Grill', 'Mohammed Ali Road, Near Minara Masjid, Mumbai 400003', ['79001 22468', '8423999299'], null, ['Chinese N Grill'], 'Caption identifies a Thai Sizzler and customer rating 8.5/10; post-specific, not a permanent rating or availability guarantee.'],
];

const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const write = (name, data) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
const sourcePath = path.join(root, 'source-data', `Famebros_user_supplied_brand_captions_${day}.json`);
if (fs.existsSync(sourcePath)) throw new Error('Caption archive already exists; refusing to overwrite.');
const compact = read('brands.compact.json');
const full = read('brands.full.json');
const portable = read('source-data/Famebros_Brand_Caption_Dataset.json');
if (![compact.brands.length, full.brands.length, portable.brands.length].every((n) => n === 47)) throw new Error('Expected 47-brand catalogue.');

const updates = [];
for (const [id, captionName, location, phones, email, aliases, notes] of brands) {
  const c = compact.brands.find((x) => x.id === id);
  const records = [full.brands.find((x) => x.brand_id === id), portable.brands.find((x) => x.brand_id === id)];
  const file = path.join(root, 'brands', `${id}.json`);
  if (!c || records.some((x) => !x)) throw new Error(`Missing catalogue entry for ${id}`);
  const deep = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
    schema_version: '1.0', brand_id: id, brand_name: c.name, aliases: c.aliases || [],
    business: { category: c.cat, city: null, location_area: null, location: null },
    contact: { primary_phone_display: null, primary_phone_e164: null, full_address_preferred: null },
    social_media: { instagram_handle: c.ig || null },
    established_content_knowledge: { confirmed: [], unconfirmed: [] },
    writing_direction: { brand_voice: c.tone, primary_language: c.lang },
    fixed_footer: { lines: c.footer || ['💫 Managed by: @famebrosstudio'] },
    accuracy_rules: c.avoid || [], missing_information: [],
  };
  if (deep.latest_user_caption_update) throw new Error(`Existing user caption update for ${id}`);
  const update = {
    brand_id: id,
    caption_name: captionName, location, location_short: id === 'map_clothing' ? 'Mulund West, Mumbai' : id === 'reshine_clinic' ? 'Hiranandani, Powai, Mumbai' : id === 'sk_furniture' ? 'Khartan Road, Thane' : id === 'vj_jewels' ? 'Sewri, Mumbai' : id === 'roopali_saree' ? 'Mira Road East, Thane' : id === 'zam_zam_motors' ? 'Mulund West, Mumbai' : id === 'chinese_and_grill' ? 'Mohammed Ali Road, Mumbai' : null,
    phones, email, aliases, notes, received_on: day,
    source: 'Caption supplied directly by the user in this conversation; not independently verified.',
  };
  deep.latest_user_caption_update = update;
  deep.sources = Array.isArray(deep.sources) ? deep.sources : [];
  deep.sources.push({ type: 'user_supplied_caption', received_on: day, supports: 'The details in latest_user_caption_update; transient claims remain caption-specific.' });
  deep.aliases = [...new Set([...(deep.aliases || []), ...aliases])];
  if (id === 'perfume_vault') {
    deep.brand_name = 'Parrfums Vault';
    deep.aliases = [...new Set(['Perfume Vault', 'Parrfum Vault', '@parrfums.vault', ...deep.aliases])];
    deep.knowledge_scope.identity_note = `User confirmed the public spelling Parrfums Vault in a caption supplied ${day}. Use this spelling; Perfume Vault is a legacy alias.`;
    deep.social_media.instagram_handle = '@parrfums.vault';
    deep.contact.phone = phones[0];
    deep.contact.whatsapp = phones[0];
    deep.contact.caption_source_status = `Phone and WhatsApp CTA explicitly present in user-supplied caption ${day}.`;
  }
  if (location && typeof location === 'string') {
    if (deep.business) {
      if (deep.business.category === 'Political public figure') { /* A topic location is not an office address. */ }
      else {
        if ('city' in deep.business) deep.business.city = update.location_short?.includes('Thane') ? 'Thane' : 'Mumbai';
        if ('locality' in deep.business) deep.business.locality = update.location_short;
        if ('location_area' in deep.business) deep.business.location_area = update.location_short;
        if (deep.business.location && typeof deep.business.location === 'object') {
          deep.business.location.city = update.location_short?.split(', ').at(-1) || null;
          deep.business.location.exact_address = location;
        }
      }
    }
    if (deep.contact) {
      for (const key of ['full_address_preferred', 'address_full', 'address']) if (key in deep.contact) deep.contact[key] = location;
      if ('address_short' in deep.contact) deep.contact.address_short = update.location_short || location;
      if ('office_address' in deep.contact && id !== 'charan_singh_sapra') deep.contact.office_address = location;
      if (phones.length) {
        for (const key of ['primary_phone_display', 'phone_display', 'public_phone']) if (key in deep.contact) deep.contact[key] = phones.join(' | ');
        if ('phone_e164' in deep.contact && phones.length === 1) deep.contact.phone_e164 = `+${phones[0].replace(/\D/g, '')}`;
        if ('primary_phone_e164' in deep.contact && phones.length === 1) deep.contact.primary_phone_e164 = `+${phones[0].replace(/\D/g, '')}`;
        if ('phone' in deep.contact && (deep.contact.phone === null || typeof deep.contact.phone === 'string')) deep.contact.phone = phones.join(' | ');
        deep.contact.caption_source_status = `User-supplied caption, ${day}; not independently verified.`;
      }
      if (email) deep.contact.email = email;
    }
  } else if (Array.isArray(location)) {
    deep.business.location = { ...(deep.business.location || {}), city: 'Navi Mumbai and Panvel', stores_from_user_caption: location };
    deep.contact.address = location.join('\n');
    deep.contact.phone = phones.join(' | ');
    deep.contact.caption_source_status = `Three store addresses and three unassigned phone numbers from user-supplied caption, ${day}.`;
    deep.business.genre = 'Clothing retail';
    deep.established_content_knowledge.confirmed = [...(deep.established_content_knowledge.confirmed || []), 'User-supplied caption identifies three Cotton Plus stores in Seawoods, Kharghar and Kalamboli/Panvel.'];
  }
  fs.writeFileSync(file, `${JSON.stringify(deep, null, 2)}\n`, 'utf8');

  if (id === 'perfume_vault') { c.name = 'Parrfums Vault'; c.ig = '@parrfums.vault'; c.ready = 'ready_with_post_brief'; c.cat = 'Fragrance brand'; }
  if (id === 'sk_furniture') c.name = 'SK Furniture Market';
  if (id === 'reshine_clinic') c.aliases = [...new Set([...c.aliases, ...aliases])];
  c.loc = Array.isArray(location) ? 'Seawoods, Kharghar, Kalamboli/Panvel' : (update.location_short || c.loc || '');
  c.kw = [...new Set([...(c.kw || []), ...(id === 'vj_jewels' ? ['Infinity Silver', 'silver bracelet wholesale', 'silver jewellery manufacturer'] : []), ...(id === 'cotton_plus' ? ['Seawoods', 'Kharghar', 'Kalamboli', 'Navi Mumbai clothing store'] : []), ...(id === 'chinese_and_grill' ? ['Mohammed Ali Road', 'Thai Sizzler', 'Minara Masjid'] : [])])].slice(0, 20);
  const locationLines = Array.isArray(location) ? location.map((x) => `📍 ${x}`) : location ? [`📍 ${location}`] : [];
  const contactLines = phones.length ? [`📞 ${phones.join(' | ')}`] : [];
  if (email) contactLines.push(`📧 ${email}`);
  c.footer = [...locationLines, ...contactLines, '💫 Managed by: @famebrosstudio'];
  for (const record of records) {
    record.name = id === 'perfume_vault' ? 'Parrfums Vault' : id === 'sk_furniture' ? 'SK Furniture Market' : record.name;
    record.aliases = [...new Set([...(record.aliases || []), ...aliases])];
    record.location = c.loc || null;
    record.contacts = record.contacts || {};
    if (phones.length) record.contacts.phone = phones;
    if (location) record.contacts.address = Array.isArray(location) ? location.join('\n') : location;
    if (email) record.contacts.email = email;
    record.footer_lines = c.footer;
    record.latest_user_caption_update = update;
    record.sources = [...new Set([...(record.sources || []), `User-supplied caption received ${day}`])];
    if (id === 'perfume_vault') {
      record.category = 'Fragrance brand (claims remain caption-specific)';
      record.instagram = { ...(record.instagram || {}), handle: '@parrfums.vault', status: `user_supplied_caption_${day}` };
      record.readiness = 'ready_with_post_brief';
      record.contacts.whatsapp = phones[0];
    }
    if (id === 'cotton_plus' || id === 'chinese_and_grill') record.readiness = 'ready_with_post_brief';
  }
  updates.push(update);
}

const archive = { received_on: day, source: 'User-supplied captions in conversation', note: 'No brands removed. Facts are attributed to captions, not independently verified. Active offers, one-off inventory, product claims, testimonials and ratings are not evergreen guarantees.', brands: updates };
fs.writeFileSync(sourcePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
for (const f of [full, portable]) {
  f.brands = f.brands.map((record) => {
    const c = compact.brands.find((x) => x.id === record.brand_id);
    return c ? { ...record, name: c.name, aliases: c.aliases, location: c.loc || null, contacts: { ...(record.contacts || {}), phone: c.footer.filter((x) => x.startsWith('📞 ')).map((x) => x.slice(3)), address: Array.isArray(updates.find((x) => x.brand_id === record.brand_id)?.location) ? updates.find((x) => x.brand_id === record.brand_id).location.join('\n') : updates.find((x) => x.brand_id === record.brand_id)?.location || record.contacts?.address || null }, footer_lines: c.footer, caption_direction: { ...(record.caption_direction || {}), caption_source_update: `User-supplied caption update ${day}; transient claims are caption-specific.` } } : record;
  });
}
fs.writeFileSync(path.join(root, 'source-data', 'Famebros_user_supplied_brand_captions_2026-11-14.json'), `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
write('brands.compact.json', compact);
write('brands.full.json', full);
write('source-data/Famebros_Brand_Caption_Dataset.json', portable);
console.log(`Imported ${updates.length} captions; retained all ${compact.brands.length} brands.`);
