-- Cloud rows are an owner-only directory, never authority to control a PC.
create table public.aether_devices (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('host', 'phone')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  public_key_spki text not null check (public_key_spki ~ '^[A-Za-z0-9+/]{122}==$'),
  tls_fingerprint text check (tls_fingerprint ~ '^[0-9a-f]{64}$'),
  lan_ip inet check (family(lan_ip) = 4 and masklen(lan_ip) = 32 and
    (lan_ip << inet '10.0.0.0/8' or lan_ip << inet '172.16.0.0/12' or lan_ip << inet '192.168.0.0/16')),
  port integer not null default 8080 check (port between 1 and 65535),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (owner_id, id),
  check (id = encode(sha256(decode(public_key_spki, 'base64')), 'hex')),
  check ((kind = 'host' and tls_fingerprint is not null) or
    (kind = 'phone' and tls_fingerprint is null and lan_ip is null))
);

create table public.aether_grants (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  host_id text not null,
  phone_id text not null,
  revision integer not null check (revision between 1 and 2147483647),
  phone_public_key_spki text not null check (char_length(phone_public_key_spki) = 124),
  host_tls_fingerprint text not null check (host_tls_fingerprint ~ '^[0-9a-f]{64}$'),
  issued_at bigint not null check (issued_at > 0),
  signature text not null check (signature ~ '^[A-Za-z0-9_-]{90,100}$'),
  revoked_at timestamptz,
  primary key (owner_id, id),
  foreign key (owner_id, host_id) references public.aether_devices(owner_id, id),
  foreign key (owner_id, phone_id) references public.aether_devices(owner_id, id),
  unique (owner_id, host_id, phone_id, revision),
  check (host_id <> phone_id)
);
create index aether_grants_phone_idx on public.aether_grants(owner_id, phone_id);

create table public.aether_sessions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  host_id text not null,
  phone_id text not null,
  state text not null default 'pending' check (state in ('pending', 'accepted', 'closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  primary key (owner_id, id),
  foreign key (owner_id, host_id) references public.aether_devices(owner_id, id),
  foreign key (owner_id, phone_id) references public.aether_devices(owner_id, id),
  check (host_id <> phone_id),
  check (expires_at > created_at and expires_at <= created_at + interval '90 seconds')
);
create index aether_sessions_host_idx on public.aether_sessions(owner_id, host_id, expires_at);
create index aether_sessions_phone_idx on public.aether_sessions(owner_id, phone_id);

create function public.aether_guard_directory() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  host_row public.aether_devices;
  phone_row public.aether_devices;
begin
  if new.owner_id is distinct from (select auth.uid()) then
    raise exception 'account_owner_required' using errcode = '42501';
  end if;
  -- Serialize per owner: parallel inserts cannot bypass resource limits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text, 714));
  if tg_op = 'UPDATE' then
    if tg_table_name = 'aether_devices' then
      if (to_jsonb(new) - array['name','lan_ip','port','last_seen_at','revoked_at']) is distinct from
         (to_jsonb(old) - array['name','lan_ip','port','last_seen_at','revoked_at']) or
         (old.revoked_at is not null and to_jsonb(new) is distinct from to_jsonb(old)) then
        raise exception 'device_identity_or_revocation_immutable' using errcode = '23514';
      end if;
    elsif tg_table_name = 'aether_grants' then
      if (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') or
         (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
        raise exception 'grant_immutable' using errcode = '23514';
      end if;
    else
      if (to_jsonb(new) - 'state') is distinct from (to_jsonb(old) - 'state') or
         (old.state = 'closed' and new.state <> 'closed') or
         (old.state = 'accepted' and new.state = 'pending') or
         (new.state <> 'closed' and new.expires_at <= now()) then
        raise exception 'invalid_session_transition' using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'aether_devices' then
    if (select count(*) from public.aether_devices where owner_id = new.owner_id) >= 256 then
      raise exception 'device_limit' using errcode = '23514';
    end if;
    new.created_at := now();
  elsif tg_table_name = 'aether_grants' then
    if (select count(*) from public.aether_grants where owner_id = new.owner_id) >= 2048 then
      raise exception 'grant_limit' using errcode = '23514';
    end if;
  else
    if new.state <> 'pending' then raise exception 'session_must_start_pending' using errcode = '23514'; end if;
    delete from public.aether_sessions where owner_id = new.owner_id and expires_at <= now();
    if (select count(*) from public.aether_sessions where owner_id = new.owner_id) >= 8 then
      raise exception 'session_limit' using errcode = '23514';
    end if;
    new.created_at := now();
    new.expires_at := now() + interval '90 seconds';
  end if;
  if tg_table_name = 'aether_devices' then
    new.last_seen_at := now();
    if new.revoked_at is not null and (tg_op = 'INSERT' or old.revoked_at is null) then new.revoked_at := now(); end if;
  elsif tg_op = 'INSERT' or (tg_table_name = 'aether_sessions' and to_jsonb(new)->>'state' <> 'closed') then
    select * into host_row from public.aether_devices where owner_id = new.owner_id and id = new.host_id;
    select * into phone_row from public.aether_devices where owner_id = new.owner_id and id = new.phone_id;
    if host_row.kind is distinct from 'host' or phone_row.kind is distinct from 'phone' or
       host_row.revoked_at is not null or phone_row.revoked_at is not null then
      raise exception 'active_host_phone_required' using errcode = '23514';
    end if;
    if tg_table_name = 'aether_grants' then
      if new.phone_public_key_spki <> phone_row.public_key_spki or new.host_tls_fingerprint <> host_row.tls_fingerprint then
        raise exception 'grant_identity_mismatch' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.aether_guard_directory() from public, anon, authenticated;

create trigger aether_devices_guard before insert or update on public.aether_devices
  for each row execute function public.aether_guard_directory();
create trigger aether_grants_guard before insert or update on public.aether_grants
  for each row execute function public.aether_guard_directory();
create trigger aether_sessions_guard before insert or update on public.aether_sessions
  for each row execute function public.aether_guard_directory();

alter table public.aether_devices enable row level security;
alter table public.aether_grants enable row level security;
alter table public.aether_sessions enable row level security;
revoke all on public.aether_devices, public.aether_grants, public.aether_sessions from anon, authenticated;
grant select, insert, update on public.aether_devices, public.aether_grants to authenticated;
grant select, insert, update, delete on public.aether_sessions to authenticated;

create policy device_read on public.aether_devices for select to authenticated using ((select auth.uid()) = owner_id);
create policy device_create on public.aether_devices for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy device_update on public.aether_devices for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy grant_read on public.aether_grants for select to authenticated using ((select auth.uid()) = owner_id);
create policy grant_create on public.aether_grants for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy grant_update on public.aether_grants for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy session_read on public.aether_sessions for select to authenticated using ((select auth.uid()) = owner_id);
create policy session_create on public.aether_sessions for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy session_update on public.aether_sessions for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy session_delete on public.aether_sessions for delete to authenticated using ((select auth.uid()) = owner_id);
