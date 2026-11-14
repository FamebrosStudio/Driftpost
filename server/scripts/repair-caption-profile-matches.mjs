import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../src/brand-memory/', import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const write = (f, v) => fs.writeFileSync(path.join(root, f), `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const compact = read('brands.compact.json');
const archive = read('source-data/Famebros_user_supplied_brand_captions_2026-11-14.json');
const idsByCaptionName = {
  'MAP for Men': 'map_clothing',
  'Re.Shine Skin Clinic': 'reshine_clinic',
  'SK Furniture Market': 'sk_furniture',
  'Infinity Silver by VJ Jewels': 'vj_jewels',
  'Charan Singh Sapra': 'charan_singh_sapra',
  'Roopali Sarees': 'roopali_saree',
  'Zam Zam Motors': 'zam_zam_motors',
  'Paak Pehnawa': 'paak_pehnawa_mens',
  'Parrfums Vault': 'perfume_vault',
  'Cotton Plus': 'cotton_plus',
  'Chinese N Grill': 'chinese_and_grill',
};
for (const item of archive.brands) item.brand_id ||= idsByCaptionName[item.caption_name];
const captionExamples = {
  map_clothing: { hashtags: ['#MAPForMen', '#MensTailoring', '#MensFashion'], keywords: ["Men's Trouser Stitching", 'Custom Tailoring Mumbai', 'Perfect Trouser Fit', 'Trouser Measurement', "Men's Fashion Tips"] },
  reshine_clinic: { hashtags: ['#ChemicalPeel', '#BridalSkincare', '#ReShineSkinClinic'], keywords: ['Chemical peel treatment', 'bridal skincare', 'pigmentation treatment', 'acne marks', 'dark spots', 'uneven skin tone', 'pre bridal skin treatment', 'skin clinic Powai', 'ReShine Skin Clinic'] },
  sk_furniture: { hashtags: ['#SKFurnitureMarket', '#CupboardDesign', '#FurnitureThane'], keywords: ['Metal Cupboard Thane', 'Steel Wardrobe Thane', 'Combination Cupboard', 'Modern Cupboard Designs', 'Bedroom Furniture Thane', 'Mirror Wardrobe Designs', 'Furniture Shop in Thane', 'Wardrobe on EMI', 'Free Delivery Furniture Thane'] },
  vj_jewels: { hashtags: ['#InfinitySilver', '#SilverJewellery', '#WholesaleJewellery'], keywords: ['Silver Jewellery', 'Silver Bracelet Designs', 'Silver Jewellery Manufacturer', 'Silver Jewellery Wholesaler', 'Silver Jewellery Exporter', 'Wholesale Silver Bracelets', 'Mumbai Silver Jewellery'] },
  charan_singh_sapra: { hashtags: ['#PoliticalAccountability', '#SaveConstitution', '#IndianDemocracy'], keywords: ['Charan Singh Sapra', 'Indian politics', 'political debate', 'constitutional values', 'democracy in India', 'government accountability', 'questions to government', 'political analysis'] },
  roopali_saree: { hashtags: ['#RoopaliSarees', '#HappyCustomer', '#MiraRoadShopping'], keywords: ['Roopali Sarees Mira Road', 'Happy Customer Review', 'Saree Shopping Mira Road', 'Ethnic Wear Collection', 'Ladies Dresses Thane'] },
  zam_zam_motors: { hashtags: ['#MahindraXUV500', '#UsedCarsMumbai', '#SUVForSale'], keywords: ['Mahindra XUV500 W11 for Sale', 'Used Mahindra XUV500 Mumbai', 'Second Hand SUV Mumbai', 'Diesel SUV', '7 Seater SUV', 'Used Cars Mulund West', 'Cars for Sale Mumbai'] },
  paak_pehnawa_mens: { hashtags: ['#EthnicWear', '#PakistaniStyle', '#FashionInspiration'], keywords: ['Pakistani inspired outfits', 'Pakistani suits', 'ethnic wear', 'embroidered kurta', 'designer suits', 'festive wear', 'salwar suit', 'women ethnic fashion', 'elegant Indian wear'] },
  perfume_vault: { hashtags: ['#ParrfumsVault', '#LuxuryPerfume', '#LeatherFragrance'], keywords: ['Parrfums Vault', 'Leather Perfume', 'Luxury Perfumes India', 'Premium Fragrances', 'Quiet Luxury Fragrance', 'Sophisticated Scents', 'Elegant Perfumes', 'Unisex Fragrance', 'Perfume Shopping India'] },
  cotton_plus: { hashtags: ['#CottonPlus', '#CustomerLove', '#ShoppingRewards'], keywords: ['Cotton Plus Clothing Store', "Women's Fashion", 'Family Shopping', 'Clothing Store Navi Mumbai', 'Seawoods Shopping', 'Kharghar Shopping', 'Kalamboli Shopping', 'Instagram Followers Gifts'] },
  chinese_and_grill: { hashtags: ['#ChineseNGrill', '#ThaiSizzler', '#MumbaiFoodies', '#MohammedAliRoad', '#FoodReview'], keywords: ['Chinese N Grill Mumbai', 'Thai Sizzler review', 'Thai Sizzler Mumbai', 'Mohammed Ali Road restaurants', 'Mumbai food reviews', 'spicy sizzler', 'food lovers Mumbai'] },
};
for (const item of archive.brands) item.caption_examples = captionExamples[item.brand_id];
write('source-data/Famebros_user_supplied_brand_captions_2026-11-14.json', archive);
const profileFiles = {
  reshine_clinic: 'reshine_skin_clinic.json',
  sk_furniture: 'sk_furniture_market.json',
  paak_pehnawa_mens: 'paak_pehnawa.json',
};
for (const [id, filename] of Object.entries(profileFiles)) {
  const item = archive.brands.find((b) => b.brand_id === id);
  const profile = read(`brands/${filename}`);
  profile.latest_user_caption_update = item;
  profile.aliases = [...new Set([...(profile.aliases || []), ...(item.aliases || [])])];
  profile.sources = [...(profile.sources || []).filter((s) => !(s?.type === 'user_supplied_caption' && s?.received_on === item.received_on)), { type: 'user_supplied_caption', received_on: item.received_on, supports: 'The details in latest_user_caption_update.' }];
  if (id === 'reshine_clinic') {
    profile.contact.caption_supplied_address = item.location;
    profile.contact.caption_address_received_on = item.received_on;
    profile.contact.previously_stored_address_conflict ||= profile.contact.full_address;
    profile.contact.full_address = item.location;
    profile.contact.full_address_preferred = item.location;
    profile.contact.primary_phone_display = item.phones[0];
    profile.contact.primary_phone_e164 = '+919960401016';
    profile.contact.caption_source_status = `User-supplied caption, ${item.received_on}. It lists Shop 501; the earlier saved profile listed Shop 504. Confirm the unit number if there is any doubt.`;
    profile.business.location_area = 'Hiranandani, Powai, Mumbai (user-supplied caption; building/unit conflicts with earlier stored record)';
    profile.accuracy_rules = [...(profile.accuracy_rules || []), 'A user-supplied 2026-11-14 caption lists Shop 501, while the earlier profile listed Shop 504. Prefer the current caption only for the corresponding post; confirm before treating the suite as evergreen.'];
  }
  if (id === 'sk_furniture') {
    profile.contact.address_full = item.location;
    profile.contact.address_short = item.location_short;
    profile.contact.phone_display = item.phones.join(' | ');
    profile.contact.phone_e164 = null;
    profile.contact.email = item.email;
    profile.contact.caption_source_status = `User-supplied caption, ${item.received_on}; confirm phone-number mapping if used for individual store locations.`;
    profile.business.location_area = item.location_short;
  }
  const entry = compact.brands.find((b) => b.id === id);
  if (item.location || item.phones?.length) profile.fixed_footer = { ...(profile.fixed_footer || {}), lines: entry.footer };
  write(`brands/${filename}`, profile);
  const accidental = path.join(root, 'brands', `${id}.json`);
  if (fs.existsSync(accidental)) fs.unlinkSync(accidental);
}
for (const b of archive.brands) {
  const entry = compact.brands.find((x) => x.id === b.brand_id);
  const examples = captionExamples[b.brand_id];
  entry.aliases = [...new Set([...(entry.aliases || []), ...(b.aliases || [])])];
  entry.kw = [...new Set([...(entry.kw || []), ...examples.keywords])].slice(0, 30);
  entry.caption_hashtag_examples = examples.hashtags;
  for (const dataName of ['brands.full.json', 'source-data/Famebros_Brand_Caption_Dataset.json']) {
    const data = read(dataName);
    const record = data.brands.find((x) => x.brand_id === b.brand_id);
    record.latest_user_caption_update = b;
    record.aliases = entry.aliases;
    record.caption_keyword_examples = examples.keywords;
    record.caption_hashtag_examples = examples.hashtags;
    record.keyword_bank = [...new Set([...(record.keyword_bank || []), ...examples.keywords])];
    record.caption_direction = { ...(record.caption_direction || {}), caption_examples_note: 'Hashtag/keyword examples from a user-supplied caption; choose only when relevant to the current post.' };
    if (b.location || b.phones?.length) record.footer_lines = entry.footer;
    record.contacts = record.contacts || {};
    if (b.phones?.length) record.contacts.phone = b.phones;
    if (b.location) record.contacts.address = Array.isArray(b.location) ? b.location.join('\n') : b.location;
    if (b.email) record.contacts.email = b.email;
    write(dataName, data);
  }
  if (b.brand_id === 'map_clothing') continue;
  const deepFile = b.brand_id === 'reshine_clinic' ? 'brands/reshine_skin_clinic.json' : b.brand_id === 'sk_furniture' ? 'brands/sk_furniture_market.json' : b.brand_id === 'paak_pehnawa_mens' ? 'brands/paak_pehnawa.json' : `brands/${b.brand_id}.json`;
  if (!fs.existsSync(path.join(root, deepFile))) continue;
  const deep = read(deepFile);
  deep.latest_user_caption_update = b;
  deep.caption_keyword_examples = examples.keywords;
  deep.caption_hashtag_examples = examples.hashtags;
  if (b.location || b.phones?.length) deep.fixed_footer = { ...(deep.fixed_footer || {}), lines: entry.footer };
  if (b.phones?.length && deep.contact) {
    deep.contact.phone_display = b.phones.join(' | ');
    deep.contact.phone_e164 = b.phones.length === 1 ? `+${b.phones[0].replace(/\D/g, '')}` : null;
    deep.contact.primary_phone_display = b.phones.join(' | ');
    deep.contact.caption_source_status = `User-supplied caption, ${b.received_on}.`;
  }
  if (b.brand_id === 'perfume_vault') {
    deep.contact.whatsapp = b.phones[0];
    deep.contact.whatsapp_status = `WhatsApp CTA explicitly stated in the user-supplied caption, ${b.received_on}.`;
    deep.social_media.instagram_handle = '@parrfums.vault';
  }
  write(deepFile, deep);
}
for (const misplaced of ['map_clothing.json', 'reshine_clinic.json', 'sk_furniture.json', 'paak_pehnawa_mens.json']) {
  const misplacedProfile = path.join(root, 'brands', misplaced);
  if (fs.existsSync(misplacedProfile)) fs.unlinkSync(misplacedProfile);
}
write('brands.compact.json', compact);
console.log('Merged Reshine and SK Furniture caption updates into existing deep profiles; corrected preferred footers.');
