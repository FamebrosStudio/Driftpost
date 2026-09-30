import { createHash } from 'node:crypto';

// Official no-API-key flow: https://uptimerobot.com/quick-monitor-setup/
// Run once. The owner must activate the monitor from the confirmation email.
const email = process.env.UPTIMEROBOT_EMAIL?.trim();
const target = process.env.UPTIMEROBOT_URL || 'https://driftpost.onrender.com/health';

if (process.argv.includes('--help')) {
  console.log('Set UPTIMEROBOT_EMAIL, then run node scripts/setup-uptimerobot.mjs.');
  console.log('Optional UPTIMEROBOT_URL overrides the Render health URL.');
  console.log('Sends one activation request. Monitoring starts after email confirmation.');
  process.exit(0);
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Set UPTIMEROBOT_EMAIL to the owner-approved alert email before running setup.');
  process.exit(1);
}

async function requestActivation() {
  const url = new URL(target);
  if (url.protocol !== 'https:') throw new Error('Monitoring requires an HTTPS URL.');
  const challengeUrl = new URL('https://api.uptimerobot.com/agentic/agent-monitor/challenge');
  challengeUrl.searchParams.set('email', email);
  challengeUrl.searchParams.set('url', url.href);
  const response = await fetch(challengeUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`UptimeRobot challenge failed (HTTP ${response.status}).`);
  const { nonce, timestamp, difficulty, signature } = await response.json();
  if (typeof nonce !== 'string' || typeof signature !== 'string' || !Number.isFinite(timestamp)
      || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 256) {
    throw new Error('UptimeRobot returned an invalid challenge.');
  }
  const deadline = Date.now() + 60000;
  let counter = 0;
  for (;;) {
    const digest = createHash('sha256').update(`${nonce}|${counter}`).digest();
    let zeros = 0;
    for (const byte of digest) {
      if (byte === 0) zeros += 8;
      else { zeros += Math.clz32(byte) - 24; break; }
    }
    if (zeros >= difficulty) break;
    counter++;
    if (counter % 10000 === 0 && Date.now() > deadline) throw new Error('Challenge exceeded the setup time budget; no activation request was sent.');
  }
  // Do not automatically retry this write: an uncertain network result could
  // otherwise send repeated activation emails.
  const submit = await fetch('https://api.uptimerobot.com/agentic/agent-monitor', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, url: url.href, nonce, timestamp, counter, signature }),
    signal: AbortSignal.timeout(20000),
  });
  if (!submit.ok) throw new Error(`UptimeRobot submission failed (HTTP ${submit.status}).`);
  console.log('UptimeRobot returned HTTP 200 for the activation request.');
  console.log('Check the chosen inbox, open the activation link, and confirm Activate.');
  console.log('This response does not prove activation; UptimeRobot intentionally returns the same response for duplicate or rejected submissions.');
}

try {
  await requestActivation();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
