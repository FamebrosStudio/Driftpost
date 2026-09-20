import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || '';

export const supabase = url && key ? createClient(url, key) : null;

export const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', hint: 'Video + title required' },
  { id: 'instagram', name: 'Instagram', hint: 'Photo or reel + caption' },
  { id: 'facebook', name: 'Facebook', hint: 'Text, photo or video' },
  { id: 'x', name: 'X', hint: '280 characters max' },
];

// Active client brands. Connections matching these get an "Active" badge;
// everything else can be hidden so inactive accounts stay out of the way.
export const ACTIVE_BRANDS = [
  'Hair Match Salon', 'Velvet Salon', 'UNS Creation', 'Reshine Clinic', 'AK Factor',
  'Vivid Resort', 'Cocos Inn Resort', 'SK Furniture', 'Shree Mahalaxmi Jewellers (Kurla)',
  'Kanchanmala Jewellers (Chembur)', 'Mahalaxmi Jewellers (Ghatla)', 'Synergic Interior',
  'Ali Salon', 'Jolly Tailor', 'Pardesi Sneakers', 'VJ Jewels', 'Charan Singh Sapra',
  'Roopali Saree', 'MAP Clothing', 'Luxxe Nail Studio', 'Bhanu Designer', 'Smietz Beauty Hub',
  'Carrara Trouser Manufacturer', 'Rajlaxmi Jewellers (Sangli)', 'Devi & Company (Kanpur)',
  'Hazel Dryfruits', 'The Creamy Layer', 'Zam Zam Motors', 'Avnikk Collection',
  'Laxya Lel Fitness', 'Qash Makeover', 'Asma Women Clothing', 'Paak Pehnawa Mens',
  'Pixi Grow', 'Sarang Hospital', 'GS Shetty School Bhandup', 'Seven Cube Footwear',
  'Sarama Furniture', 'OLVKIIXK', 'Anand Furniture',
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function isActiveBrand(accountName) {
  const a = norm(accountName);
  if (!a) return false;
  return ACTIVE_BRANDS.some((b) => {
    const n = norm(b);
    return a.includes(n) || n.includes(a);
  });
}

export async function api(path, token, options = {}) {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
