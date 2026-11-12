create table if not exists public.daily_caption_generation_usage (
  usage_date date primary key,
  generation_count integer not null default 0 check (generation_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.daily_caption_generation_usage enable row level security;
revoke all on public.daily_caption_generation_usage from public, anon, authenticated;
grant all on public.daily_caption_generation_usage to service_role;

create or replace function public.reserve_daily_caption_generations(
  p_count integer default 1,
  p_limit integer default 50
)
returns table(allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_count integer;
begin
  if p_count is null or p_count < 1 or p_limit is null or p_limit < 1 or p_count > p_limit then
    return query select false, 0;
    return;
  end if;

  insert into public.daily_caption_generation_usage as quota (usage_date, generation_count, updated_at)
  values (v_day, p_count, now())
  on conflict (usage_date) do update
    set generation_count = quota.generation_count + excluded.generation_count,
        updated_at = now()
    where quota.generation_count + excluded.generation_count <= p_limit
  returning generation_count into v_count;

  if found then
    return query select true, greatest(0, p_limit - v_count);
    return;
  end if;

  select generation_count into v_count
    from public.daily_caption_generation_usage
    where usage_date = v_day;
  return query select false, greatest(0, p_limit - coalesce(v_count, p_limit));
end;
$$;

revoke all on function public.reserve_daily_caption_generations(integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_daily_caption_generations(integer, integer) to service_role;
