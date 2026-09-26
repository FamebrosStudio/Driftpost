-- Consent audit trail.
--
-- The burden of proof under the DPDP Act sits with us, so consent is recorded
-- as an append-only log, never updated in place: every decision is preserved
-- with the exact policy version the user actually saw. Revoking consent is a
-- new row (granted = false), not a deletion of the old one, so the history of
-- what was agreed and when stays auditable.
create table if not exists public.consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Version of the notice text presented at decision time. Bump when the
  -- wording changes materially; a user is never recorded against a version
  -- they did not read.
  policy_version text not null,
  -- 'service' is required to use the product and is not optional consent.
  -- 'personalisation' is the genuinely optional one: storing this user's
  -- prompts and captions so future posts match their own voice.
  purpose text not null check (purpose in ('service', 'personalisation')),
  granted boolean not null,
  created_at timestamptz not null default now()
);

alter table public.consent_log enable row level security;

drop policy if exists "Users read own consent log" on public.consent_log;
create policy "Users read own consent log"
on public.consent_log for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users append own consent log" on public.consent_log;
create policy "Users append own consent log"
on public.consent_log for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- No update or delete policy on purpose: the log is append-only from the
-- client. Account erasure removes rows server-side via the service role.
create index if not exists consent_log_user_purpose_idx
on public.consent_log (user_id, purpose, created_at desc);
