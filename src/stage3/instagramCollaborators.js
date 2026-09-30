const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

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
