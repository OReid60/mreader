-- Run once in the managed Supabase project's SQL editor. No server to host on devices.
create table if not exists public.mreader_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  document jsonb not null default '{"schemaVersion":1,"books":{},"progress":{},"extensions":{},"deletions":{}}'::jsonb check(jsonb_typeof(document)='object' and coalesce(document->>'schemaVersion','')='1'),
  updated_at timestamptz not null default now()
);
alter table public.mreader_sync_state enable row level security;
drop policy if exists "Own sync state only" on public.mreader_sync_state;
create policy "Own sync state only" on public.mreader_sync_state
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.mreader_sync_state from anon, authenticated;
grant select, insert, update on public.mreader_sync_state to authenticated;

create or replace function public.mreader_sync_commit(expected_revision bigint, incoming_document jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare result_revision bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if octet_length(incoming_document::text) > 8388608 or coalesce(incoming_document->>'schemaVersion','') <> '1'
    then raise exception 'Invalid sync document'; end if;
  insert into public.mreader_sync_state(user_id) values(auth.uid()) on conflict do nothing;
  update public.mreader_sync_state set document=incoming_document, revision=revision+1, updated_at=now()
    where user_id=auth.uid() and revision=expected_revision returning revision into result_revision;
  return coalesce(result_revision, 0);
end $$;
revoke execute on function public.mreader_sync_commit(bigint,jsonb) from public, anon;
grant execute on function public.mreader_sync_commit(bigint,jsonb) to authenticated;
