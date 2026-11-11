-- Owner-only direct candidates let the phone discover LAN and mesh-VPN routes
-- before falling back to the encrypted internet relay.
create function public.aether_valid_network_endpoints(value jsonb) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare
  raw text;
  address inet;
begin
  if pg_catalog.jsonb_typeof(value) <> 'array' or pg_catalog.jsonb_array_length(value) > 16 then
    return false;
  end if;
  for raw in select * from pg_catalog.jsonb_array_elements_text(value) loop
    begin
      address := raw::inet;
    exception when others then
      return false;
    end;
    if pg_catalog.family(address) <> 4 or pg_catalog.masklen(address) <> 32 or
       address << inet '0.0.0.0/8' or address << inet '127.0.0.0/8' or
       address << inet '169.254.0.0/16' or address << inet '224.0.0.0/4' then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.aether_devices
  add column network_endpoints jsonb not null default '[]'::jsonb
    check (public.aether_valid_network_endpoints(network_endpoints)),
  add constraint aether_phone_has_no_network_endpoints
    check (kind = 'host' or network_endpoints = '[]'::jsonb);

create or replace function public.aether_guard_directory() returns trigger
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
    if tg_table_name = 'aether_devices' then
      if (to_jsonb(new) - array['name','lan_ip','network_endpoints','port','last_seen_at','revoked_at']) is distinct from
         (to_jsonb(old) - array['name','lan_ip','network_endpoints','port','last_seen_at','revoked_at']) or
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
