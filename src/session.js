import { useEffect, useState } from 'react';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const authConfigured = !!(url && key);

// Supabase is loaded lazily so the public landing page ships zero
// Supabase JS. The client is created once and reused everywhere.
let clientPromise = null;
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = authConfigured
      ? import('@supabase/supabase-js').then(({ createClient }) => createClient(url, key))
      : Promise.resolve(null);
  }
  return clientPromise;
}

const listeners = new Set();
const attached = new Set();

// Wire a client into every mounted useSession hook (once per client).
function attach(client) {
  if (!client || attached.has(client)) return;
  attached.add(client);
  client.auth.getSession().then(({ data }) => {
    listeners.forEach((fn) => fn(data.session));
  });
  const { data } = client.auth.onAuthStateChange((_e, s) => {
    listeners.forEach((fn) => fn(s));
  });
  void data;
}

// Called after a sign-in that happened without an active subscription
// (e.g. a first-time visitor who just logged in on the Auth screen).
export function pokeSession() {
  getSupabase().then(attach);
}

export function useSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const update = (s) => {
      if (!alive) return;
      setSession(s);
      setLoading(false);
    };
    listeners.add(update);
    // Only download the auth library when it can possibly do something:
    // a returning visitor with a stored session, an OAuth redirect carrying
    // tokens in the URL hash, or a PKCE ?code= exchange waiting to happen.
    // Pure landing visitors get nothing.
    let mayHaveSession = false;
    try {
      mayHaveSession =
        window.location.hash.includes('access_token') ||
        /[?&]code=/.test(window.location.search) ||
        Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    } catch {}
    if (!mayHaveSession) {
      setLoading(false);
    } else {
      getSupabase().then((client) => { if (alive) attach(client); });
    }
    return () => { alive = false; listeners.delete(update); };
  }, []);
  return { session, loading };
}
