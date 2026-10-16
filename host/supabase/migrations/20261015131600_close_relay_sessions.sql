-- Sessions that reached accepted or closed are not pending connection attempts and
-- must not consume the per-account pending-session limit.
create function public.aether_guard_session() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  host_row public.aether_devices;
  phone_row public.aether_devices;
begin
  if new.owner_id is distinct from (select auth.uid()) then
    raise exception 'account_owner_required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text, 714));

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'state') is distinct from (to_jsonb(old) - 'state') or
       (old.state = 'closed' and new.state <> 'closed') or
       (old.state = 'accepted' and new.state = 'pending') or
       (new.state <> 'closed' and new.expires_at <= now()) then
      raise exception 'invalid_session_transition' using errcode = '23514';
    end if;
  else
    if new.state <> 'pending' then
      raise exception 'session_must_start_pending' using errcode = '23514';
    end if;
    delete from public.aether_sessions where owner_id = new.owner_id and expires_at <= now();
    if (select count(*) from public.aether_sessions
        where owner_id = new.owner_id and state = 'pending' and expires_at > now()) >= 8 then
      raise exception 'session_limit' using errcode = '23514';
    end if;
    new.created_at := now();
    new.expires_at := now() + interval '90 seconds';
  end if;

  if tg_op = 'INSERT' or new.state <> 'closed' then
    select * into host_row from public.aether_devices where owner_id = new.owner_id and id = new.host_id;
    select * into phone_row from public.aether_devices where owner_id = new.owner_id and id = new.phone_id;
    if host_row.kind is distinct from 'host' or phone_row.kind is distinct from 'phone' or
       host_row.revoked_at is not null or phone_row.revoked_at is not null then
      raise exception 'active_host_phone_required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.aether_guard_session() from public, anon, authenticated;

drop trigger aether_sessions_guard on public.aether_sessions;
create trigger aether_sessions_guard before insert or update on public.aether_sessions
  for each row execute function public.aether_guard_session();
