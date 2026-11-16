const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

const norm = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const compact = (value) => norm(value).replace(/\s/g, '');

// Famebros Studio | Instagram Tagging List:
// Canonical per-brand Instagram handles automatically applied on relevant
// brand posts and reels in the automated Drive and team workflows.
export const FAMEBROS_INSTAGRAM_TAGGING_LIST = Object.freeze([
  Object.freeze({
    number: 1,
    brandId: 'hair_match_salon',
    brandName: 'Hair Match Salon',
    aliases: Object.freeze(['hair match salon', 'hairmatch.salon', '@hairmatch.salon']),
    handles: Object.freeze(['kuldeepmaurya1209', 'akshadparvalkar', 'nikkpawar00057']),
  }),
  Object.freeze({
    number: 2,
    brandId: 'reshine_clinic',
    brandName: 'Reshine Skin Clinic',
    aliases: Object.freeze(['reshine clinic', 'reshine skin clinic', 're.shine skin clinic', 'reshine_skin_clinic', 're.shineskinclinic', '@re.shineskinclinic']),
    handles: Object.freeze(['browsbyavani']),
  }),
  Object.freeze({
    number: 3,
    brandId: 'shree_mahalaxmi_kurla',
    brandName: 'Shree Mahalaxmi Jewellers (SMJ)',
    aliases: Object.freeze(['shree mahalaxmi jewellers', 'shree mahalaxmi jewellers kurla', 'shree mahalaxmi jewellers (smj)', 'shree mahalaxmi jewellers smj', 'smj', 'shree_mahalaxmi_jewellers_kurla', 'mahalaxmi.jewellers.kurla', '@mahalaxmi.jewellers.kurla']),
    handles: Object.freeze(['mahalaxmi.jewellers.ghatla']),
  }),
  Object.freeze({
    number: 4,
    brandId: 'kanchanmala_chembur',
    brandName: 'Kanchanmala Jewellers (KMJ)',
    aliases: Object.freeze(['kanchanmala jewellers', 'kanchanmala jewellers chembur', 'kanchanmala jewellers (kmj)', 'kanchanmala jewellers kmj', 'kmj', 'kanchanmala_jewellers_chembur', 'kanchanmala.jewellers.chembur', '@kanchanmala.jewellers.chembur']),
    handles: Object.freeze(['mahalaxmi.jewellers.ghatla']),
  }),
  Object.freeze({
    number: 5,
    brandId: 'ali_salon',
    brandName: 'Ali Salon',
    aliases: Object.freeze(['ali salon', 'ali and hussain salon', 'ali.and.hussain.salon', '@ali.and.hussain.salon']),
    handles: Object.freeze(['hussainshaikh_13_']),
  }),
  Object.freeze({
    number: 6,
    brandId: 'roopali_saree',
    brandName: 'Roopali Sarees',
    aliases: Object.freeze(['roopali saree', 'roopali sarees', 'roopali sarees mira road', 'roopali_sarees', 'roopalisarees', '@roopalisarees']),
    handles: Object.freeze(['abhi19rpl', 'upadhyaynayna']),
  }),
  Object.freeze({
    number: 7,
    brandId: 'vj_jewels',
    brandName: 'Infinity Silver / VJ Jewels',
    aliases: Object.freeze(['vj jewels', 'infinity silver', 'infinity silver / vj jewels', 'infinity silver by vj jewels', 'infinity silver vj jewels', 'infinity_silver_vj_jewels', 'infinitysilver._', '@infinitysilver._']),
    handles: Object.freeze(['vjjewels_916']),
  }),
  Object.freeze({
    number: 8,
    brandId: 'bhanu_designer',
    brandName: 'Bhanu Designer',
    aliases: Object.freeze(['bhanu designer', 'orange bhanu designer', 'orange bhanu designer by sanjay bhanushali', 'bhanu.designer', '@bhanu.designer']),
    handles: Object.freeze(['viralbhanu09']),
  }),
  Object.freeze({
    number: 9,
    brandId: 'zivara_salon',
    brandName: 'Zivara Salon',
    aliases: Object.freeze(['zivara salon', 'zivara salon & wellness', 'zivara salon wellness', 'zivara salon thane', 'salon.zivara', '@salon.zivara', 'zivarasalon']),
    handles: Object.freeze(['salon.zivara']),
  }),
]);

export function getAssignedInstagramTagsForBrand({ brandId = '', brandName = '', accountName = '', accounts = [] } = {}) {
  const cleanId = String(brandId || '').trim().toLowerCase();
  if (cleanId) {
    const byId = FAMEBROS_INSTAGRAM_TAGGING_LIST.find((entry) => entry.brandId === cleanId || entry.aliases.some((a) => a.replace(/\s+/g, '_') === cleanId));
    if (byId) return [...byId.handles];
  }
  const candidates = [
    brandName,
    accountName,
    ...(Array.isArray(accounts) ? accounts.flatMap((acc) => [acc?.account_name, acc?.username, acc?.handle, acc?.platform_account_id]) : []),
  ].map((v) => String(v || '').trim()).filter(Boolean);

  for (const raw of candidates) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    for (const part of [raw, ...parts]) {
      const c = compact(part.replace(/@/g, ' '));
      if (!c) continue;
      for (const entry of FAMEBROS_INSTAGRAM_TAGGING_LIST) {
        const aliases = [entry.brandId, entry.brandName, ...entry.aliases].map((a) => compact(a.replace(/@/g, ' ')));
        if (aliases.some((a) => a && (a === c || (Math.min(a.length, c.length) >= 6 && (a.includes(c) || c.includes(a)))))) {
          return [...entry.handles];
        }
      }
    }
  }
  return [];
}

export function formatAssignedInstagramTags(target = {}) {
  const handles = getAssignedInstagramTagsForBrand(target);
  return handles.map((h) => `@${String(h).replace(/^@+/, '')}`).join(', ');
}

export function parseInstagramCollaborators(value) {
  const entries = String(value || '')
    .split(/[\s,;]+/)
    .map((name) => name.trim().replace(/^@+/, ''))
    .filter(Boolean);
  const seen = new Set();
  const usernames = [];
  for (const username of entries) {
    if (!USERNAME.test(username) || username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
      return { usernames: [], error: `“${username}” is not a valid Instagram username. Use letters, numbers, periods or underscores.` };
    }
    const key = username.toLowerCase();
    if (!seen.has(key)) { seen.add(key); usernames.push(username); }
  }
  if (usernames.length > 3) return { usernames: [], error: 'Instagram allows up to 3 collaborators.' };
  return { usernames, error: '' };
}
