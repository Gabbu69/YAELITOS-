create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$
begin
  create type public.booking_status as enum (
    'pending',
    'confirmed',
    'rejected',
    'completed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.booking_inquiry_type as enum (
    'table',
    'private',
    'catering',
    'general'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.staff_role as enum ('owner', 'staff');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.activity_action as enum (
    'booking_created',
    'booking_status_changed',
    'booking_anonymized',
    'staff_invited',
    'staff_deactivated',
    'staff_reactivated',
    'csv_exported'
  );
exception
  when duplicate_object then null;
end
$$;

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (char_length(email) between 3 and 254),
  display_name text not null check (char_length(trim(display_name)) between 1 and 100),
  role public.staff_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  submission_id uuid not null unique,
  inquiry_type public.booking_inquiry_type not null,
  customer_name text,
  contact_number text,
  requested_date date not null,
  requested_time time without time zone not null,
  guest_count integer not null check (guest_count > 0),
  occasion text check (occasion is null or char_length(occasion) <= 100),
  notes text check (notes is null or char_length(notes) <= 1000),
  status public.booking_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  anonymized_at timestamptz,
  constraint active_booking_customer_details check (
    anonymized_at is not null
    or (
      customer_name is not null
      and char_length(trim(customer_name)) between 1 and 100
      and contact_number is not null
      and char_length(trim(contact_number)) between 1 and 30
    )
  )
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  action public.activity_action not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  old_status public.booking_status,
  new_status public.booking_status,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint status_change_has_values check (
    action <> 'booking_status_changed'
    or (old_status is not null and new_status is not null and old_status <> new_status)
  )
);

create table private.submission_rate_limits (
  id bigint generated always as identity primary key,
  ip_hash text not null check (char_length(ip_hash) = 64),
  attempted_at timestamptz not null default now()
);

create index bookings_requested_date_time_idx
  on public.bookings (requested_date, requested_time);
create index bookings_status_requested_date_idx
  on public.bookings (status, requested_date);
create index bookings_created_at_idx
  on public.bookings (created_at desc);
create index activity_log_booking_created_idx
  on public.activity_log (booking_id, created_at desc);
create index activity_log_created_idx
  on public.activity_log (created_at desc);
create index submission_rate_limits_hash_time_idx
  on private.submission_rate_limits (ip_hash, attempted_at desc);

create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.active = true
  );
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.active = true
      and profile.role = 'owner'
  );
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.prepare_booking_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function private.record_booking_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (action, actor_user_id, booking_id, new_status)
    values ('booking_created', auth.uid(), new.id, new.status);
  elsif old.status is distinct from new.status then
    insert into public.activity_log (
      action,
      actor_user_id,
      booking_id,
      old_status,
      new_status
    ) values (
      'booking_status_changed',
      auth.uid(),
      new.id,
      old.status,
      new.status
    );
  end if;

  if tg_op = 'UPDATE'
    and old.anonymized_at is null
    and new.anonymized_at is not null then
    insert into public.activity_log (action, actor_user_id, booking_id)
    values ('booking_anonymized', auth.uid(), new.id);
  end if;

  return new;
end;
$$;

create trigger staff_profiles_touch_updated_at
before update on public.staff_profiles
for each row execute function private.touch_updated_at();

create trigger bookings_prepare_update
before update on public.bookings
for each row execute function private.prepare_booking_update();

create trigger bookings_record_activity
after insert or update on public.bookings
for each row execute function private.record_booking_activity();

create or replace function public.consume_submission_quota(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if p_ip_hash is null or char_length(p_ip_hash) <> 64 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));

  delete from private.submission_rate_limits
  where attempted_at < now() - interval '24 hours';

  select count(*)
    into recent_count
  from private.submission_rate_limits
  where ip_hash = p_ip_hash
    and attempted_at >= now() - interval '15 minutes';

  if recent_count >= 5 then
    return false;
  end if;

  insert into private.submission_rate_limits (ip_hash)
  values (p_ip_hash);

  return true;
end;
$$;

create or replace function public.anonymize_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if not private.is_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  update public.bookings
  set customer_name = null,
      contact_number = null,
      occasion = null,
      notes = null,
      anonymized_at = now()
  where id = p_booking_id
    and anonymized_at is null;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function private.anonymize_expired_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  update public.bookings
  set customer_name = null,
      contact_number = null,
      occasion = null,
      notes = null,
      anonymized_at = now(),
      updated_by = null
  where anonymized_at is null
    and requested_date < (
      (now() at time zone 'Asia/Manila')::date - interval '12 months'
    )::date;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

alter table public.staff_profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.activity_log enable row level security;

revoke all on table public.staff_profiles from anon, authenticated;
revoke all on table public.bookings from anon, authenticated;
revoke all on table public.activity_log from anon, authenticated;
revoke all on table private.submission_rate_limits from public, anon, authenticated;

grant select, insert, update, delete on table public.staff_profiles to service_role;
grant select, insert, update, delete on table public.bookings to service_role;
grant select, insert, update, delete on table public.activity_log to service_role;
grant usage, select on all sequences in schema public to service_role;

grant usage on schema private to authenticated;
grant execute on function private.is_active_staff() to authenticated;
grant execute on function private.is_owner() to authenticated;

grant select on table public.staff_profiles to authenticated;
grant select on table public.bookings to authenticated;
grant update (status) on table public.bookings to authenticated;
grant select on table public.activity_log to authenticated;

create policy "Active staff can read bookings"
on public.bookings
for select
to authenticated
using ((select private.is_active_staff()));

create policy "Active staff can change booking status"
on public.bookings
for update
to authenticated
using ((select private.is_active_staff()))
with check ((select private.is_active_staff()));

create policy "Staff can read their profile and owners can read all profiles"
on public.staff_profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_owner())
);

create policy "Staff can read booking activity and owners can read all activity"
on public.activity_log
for select
to authenticated
using (
  (booking_id is not null and (select private.is_active_staff()))
  or (select private.is_owner())
);

revoke all on function public.consume_submission_quota(text) from public, anon, authenticated;
grant execute on function public.consume_submission_quota(text) to service_role;

revoke all on function public.anonymize_booking(uuid) from public, anon;
grant execute on function public.anonymize_booking(uuid) to authenticated;

revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.prepare_booking_update() from public, anon, authenticated;
revoke all on function private.record_booking_activity() from public, anon, authenticated;
revoke all on function private.anonymize_expired_bookings() from public, anon, authenticated;

select cron.schedule(
  'yaelitos-anonymize-expired-bookings',
  '0 19 * * *',
  $$select private.anonymize_expired_bookings();$$
);
