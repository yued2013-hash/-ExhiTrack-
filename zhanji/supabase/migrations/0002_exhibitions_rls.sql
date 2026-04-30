-- Migration 0002 — exhibitions RLS owner-only policy
--
-- Why: Supabase enables RLS on public.* by default, so 0001's `disable row level security`
-- gets re-asserted at INSERT time, blocking writes. Even for a single-user app, a one-line
-- "owner-only" policy is the cleanest way to satisfy this without losing simplicity.
--
-- Run this in Supabase Studio → SQL Editor.

alter table exhibitions enable row level security;

drop policy if exists "exhibitions_owner" on exhibitions;

create policy "exhibitions_owner"
  on exhibitions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
