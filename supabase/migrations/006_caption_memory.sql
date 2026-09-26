-- Generated caption memory: every caption the model produces, plus whether the
-- user actually approved or published it.
--
-- This is the learning loop. Brand research (server/src/brand-memory/*.json)
-- tells the model what a brand IS; this table teaches it how THAT user wants
-- that brand written, from their own approved output. Rows are scoped to
-- user_id + brand_key so one account's preferences never leak into another
-- account's captions.
create table if not exists public.caption_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Normalised brand identity (slug). Independent of brand-memory ids so a
  -- brand that has no research file still accumulates history.
  brand_key text not null,
  brand_label text,
  platform text not null check (platform in ('youtube', 'instagram', 'facebook', 'x')),
  brief text,
  settings jsonb not null default '{}'::jsonb,
  body text not null,
  -- 0 = generated only, 1 = user approved/published. Only approved rows are
  -- fed back to the model as examples.
  used boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.caption_memory enable row level security;

drop policy if exists "Users read own caption memory" on public.caption_memory;
create policy "Users read own caption memory"
on public.caption_memory for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own caption memory" on public.caption_memory;
create policy "Users insert own caption memory"
on public.caption_memory for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own caption memory" on public.caption_memory;
create policy "Users update own caption memory"
on public.caption_memory for update
to authenticated
using ((select auth.uid()) = user_id);

-- The read path is always "my captions for this brand, newest first".
create index if not exists caption_memory_user_brand_idx
on public.caption_memory (user_id, brand_key, created_at desc);

create index if not exists caption_memory_approved_idx
on public.caption_memory (user_id, brand_key, used)
where used;
