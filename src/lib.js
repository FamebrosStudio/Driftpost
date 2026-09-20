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
