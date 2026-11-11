-- Run as the project SQL administrator. Every fixture is rolled back.
begin;
do $$
declare u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
begin
  perform set_config('aether.test_owner', u1::text, true);
  perform set_config('aether.test_other', u2::text, true);
  insert into auth.users(id) values (u1), (u2);
end $$;
set local role authenticated;
do $$
declare
  u1 uuid := current_setting('aether.test_owner')::uuid;
  u2 uuid := current_setting('aether.test_other')::uuid;
  host_key text := repeat('A',122) || '==';
  phone_key text := repeat('B',120) || 'AA==';
  host_id text := encode(sha256(decode(host_key,'base64')),'hex');
  phone_id text := encode(sha256(decode(phone_key,'base64')),'hex');
  sid uuid := gen_random_uuid(); gid uuid := gen_random_uuid();
  limit_sid uuid;
  i integer;
  affected integer;
begin
  perform set_config('request.jwt.claim.sub', u1::text, true);
  insert into public.aether_devices(owner_id,id,kind,name,public_key_spki,tls_fingerprint)
    values(u1,host_id,'host','Test PC',host_key,repeat('a',64));
  insert into public.aether_devices(owner_id,id,kind,name,public_key_spki)
    values(u1,phone_id,'phone','Test Phone',phone_key);
  if (select count(*) from public.aether_devices) <> 2 then raise exception 'owner_read_failed'; end if;
  update public.aether_devices set name='Renamed' where id=host_id;
  if not exists(select 1 from public.aether_devices where name='Renamed') then raise exception 'owner_update_failed'; end if;
  update public.aether_devices set network_endpoints='["192.168.1.2","100.84.2.10"]'::jsonb where id=host_id;
  if not exists(select 1 from public.aether_devices where network_endpoints @> '["100.84.2.10"]'::jsonb) then
    raise exception 'network_endpoint_update_failed';
  end if;
  begin
    update public.aether_devices set network_endpoints='["127.0.0.1"]'::jsonb where id=host_id;
    raise exception 'unsafe_network_endpoint_allowed';
  exception when check_violation then null; end;
  begin
    update public.aether_devices set network_endpoints='["10.0.0.1"]'::jsonb where id=phone_id;
    raise exception 'phone_endpoint_allowed';
  exception when check_violation then null; end;
  begin
    update public.aether_devices set public_key_spki=phone_key where id=host_id;
    raise exception 'key_mutation_allowed';
  exception when check_violation then null; end;
  begin
    update public.aether_devices set owner_id=u2 where id=host_id;
    raise exception 'owner_mutation_allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',u2::text,true);
  if exists(select 1 from public.aether_devices) then raise exception 'cross_account_read'; end if;
  update public.aether_devices set name='Stolen' where id=host_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'cross_account_write'; end if;
  begin
    insert into public.aether_devices(owner_id,id,kind,name,public_key_spki)
      values(u1,phone_id,'phone','Forbidden',phone_key);
    raise exception 'cross_account_insert';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',u1::text,true);
  insert into public.aether_grants(owner_id,id,host_id,phone_id,revision,phone_public_key_spki,host_tls_fingerprint,issued_at,signature)
    values(u1,gid,host_id,phone_id,1,phone_key,repeat('a',64),1000,repeat('A',96));
  insert into public.aether_sessions(owner_id,id,host_id,phone_id) values(u1,sid,host_id,phone_id);
  update public.aether_sessions set state='accepted' where id=sid;
  begin
    update public.aether_sessions set state='pending' where id=sid;
    raise exception 'session_rollback_allowed';
  exception when check_violation then null; end;
  begin
    update public.aether_sessions set expires_at=now()+interval '1 day' where id=sid;
    raise exception 'expiry_extension_allowed';
  exception when check_violation then null; end;
  update public.aether_sessions set state='closed' where id=sid;
  begin
    update public.aether_sessions set state='accepted' where id=sid;
    raise exception 'closed_session_reopened';
  exception when check_violation then null; end;
  for i in 1..8 loop
    limit_sid := gen_random_uuid();
    insert into public.aether_sessions(owner_id,id,host_id,phone_id) values(u1,limit_sid,host_id,phone_id);
    update public.aether_sessions set state='closed' where id=limit_sid;
  end loop;
  for i in 1..8 loop
    insert into public.aether_sessions(owner_id,id,host_id,phone_id) values(u1,gen_random_uuid(),host_id,phone_id);
  end loop;
  begin
    insert into public.aether_sessions(owner_id,id,host_id,phone_id) values(u1,gen_random_uuid(),host_id,phone_id);
    raise exception 'pending_session_limit_not_enforced';
  exception when check_violation then null; end;
  delete from public.aether_sessions where owner_id=u1;
  begin
    insert into public.aether_sessions(owner_id,id,host_id,phone_id) values(u1,gen_random_uuid(),phone_id,host_id);
    raise exception 'wrong_device_roles_allowed';
  exception when check_violation then null; end;
  update public.aether_grants set revoked_at=now() where id=gid;
  begin
    update public.aether_grants set revoked_at=null where id=gid;
    raise exception 'grant_unrevoked';
  exception when check_violation then null; end;
  update public.aether_devices set revoked_at=now() where id=phone_id;
  begin
    update public.aether_devices set revoked_at=null where id=phone_id;
    raise exception 'device_unrevoked';
  exception when check_violation then null; end;
  begin
    insert into public.aether_sessions(owner_id,id,host_id,phone_id) values(u1,gen_random_uuid(),host_id,phone_id);
    raise exception 'revoked_device_session_allowed';
  exception when check_violation then null; end;
  begin
    delete from public.aether_devices where id=phone_id;
    raise exception 'tombstone_delete_allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',u2::text,true);
  if exists(select 1 from public.aether_grants) or exists(select 1 from public.aether_sessions) then
    raise exception 'cross_account_grant_or_session_read';
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.aether_devices;
    raise exception 'anonymous_read_allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'account directory: 23 checks passed; fixtures rolled back' as result;
rollback;
