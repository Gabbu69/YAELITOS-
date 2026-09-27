-- Staff intake, recorded replies, and owner-published website content.

create type public.booking_source as enum ('web', 'messenger', 'phone', 'walk_in');
create type public.booking_contact_route as enum ('phone', 'messenger', 'in_person');
create type public.booking_reply_channel as enum ('phone', 'sms', 'messenger', 'in_person');

alter type public.activity_action add value if not exists 'booking_reply_recorded';
alter type public.activity_action add value if not exists 'booking_follow_up_updated';
alter type public.activity_action add value if not exists 'content_draft_saved';
alter type public.activity_action add value if not exists 'content_published';
alter type public.activity_action add value if not exists 'content_unpublished';

alter table public.bookings
  add column source public.booking_source not null default 'web',
  add column contact_route public.booking_contact_route not null default 'phone',
  add column messenger_name text check (messenger_name is null or char_length(trim(messenger_name)) between 1 and 100),
  add column follow_up_notes text check (follow_up_notes is null or char_length(follow_up_notes) <= 1000),
  add column created_by uuid references auth.users(id) on delete set null;

alter table public.bookings drop constraint active_booking_customer_details;
alter table public.bookings add constraint active_booking_customer_details check (
  anonymized_at is not null
  or (
    customer_name is not null
    and char_length(trim(customer_name)) between 1 and 100
    and (
      (contact_route = 'phone' and contact_number is not null and char_length(trim(contact_number)) between 1 and 30)
      or (contact_route = 'messenger' and messenger_name is not null and char_length(trim(messenger_name)) between 1 and 100)
      or contact_route = 'in_person'
    )
  )
);

create table public.booking_replies (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  channel public.booking_reply_channel not null,
  replied_at timestamptz not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index booking_replies_booking_created_idx
  on public.booking_replies (booking_id, created_at desc);

create table public.site_content (
  section text primary key check (section in ('menu', 'hours', 'announcement')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null
);

create table public.content_drafts (
  section text primary key check (section in ('menu', 'hours', 'announcement')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create or replace function private.prepare_booking_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and current_setting('app.booking_transition', true) is distinct from 'allowed' then
    raise exception 'Use the staff booking workflow to change status' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
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
    values ('booking_created', coalesce(auth.uid(), new.created_by), new.id, new.status);
  elsif old.status is distinct from new.status then
    insert into public.activity_log (
      action, actor_user_id, booking_id, old_status, new_status
    ) values (
      'booking_status_changed', coalesce(auth.uid(), new.updated_by), new.id, old.status, new.status
    );
  end if;

  if tg_op = 'UPDATE'
    and old.follow_up_notes is distinct from new.follow_up_notes
    and new.anonymized_at is null then
    insert into public.activity_log (action, actor_user_id, booking_id)
    values ('booking_follow_up_updated', coalesce(auth.uid(), new.updated_by), new.id);
  end if;

  if tg_op = 'UPDATE'
    and old.anonymized_at is null
    and new.anonymized_at is not null then
    insert into public.activity_log (action, actor_user_id, booking_id)
    values ('booking_anonymized', coalesce(auth.uid(), new.updated_by), new.id);
  end if;

  return new;
end;
$$;

create or replace function private.record_booking_reply_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_log (action, actor_user_id, booking_id, metadata)
  values ('booking_reply_recorded', new.actor_user_id, new.booking_id,
    jsonb_build_object('channel', new.channel, 'replied_at', new.replied_at));
  return new;
end;
$$;

create or replace function private.validate_booking_reply()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  received_at timestamptz;
begin
  select created_at into received_at
  from public.bookings
  where id = new.booking_id and anonymized_at is null
  for update;
  if not found then
    raise exception 'Active booking required for reply' using errcode = '22023';
  end if;
  if new.replied_at > now() + interval '10 minutes'
    or new.replied_at < received_at - interval '30 days' then
    raise exception 'Reply time is outside this request' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger booking_replies_validate
before insert on public.booking_replies
for each row execute function private.validate_booking_reply();

create trigger booking_replies_record_activity
after insert on public.booking_replies
for each row execute function private.record_booking_reply_activity();

create or replace function private.record_site_content_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'content_drafts' then
    insert into public.activity_log (action, actor_user_id, metadata)
    values ('content_draft_saved', new.updated_by, jsonb_build_object('section', new.section));
  else
    insert into public.activity_log (action, actor_user_id, metadata)
    values ('content_published', new.published_by, jsonb_build_object('section', new.section));
  end if;
  return new;
end;
$$;

create trigger content_drafts_record_activity
after insert or update on public.content_drafts
for each row execute function private.record_site_content_activity();

create trigger site_content_record_activity
after insert or update on public.site_content
for each row execute function private.record_site_content_activity();

-- Called only by the authenticated Edge Function with service-role credentials.
-- The reply insert and status change share one transaction.
create or replace function public.transition_booking(
  p_booking_id uuid,
  p_expected_updated_at timestamptz,
  p_status public.booking_status,
  p_actor_user_id uuid,
  p_reply_channel public.booking_reply_channel default null,
  p_replied_at timestamptz default null,
  p_reply_note text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_booking public.bookings;
  changed_booking public.bookings;
begin
  if not exists (
    select 1 from public.staff_profiles
    where user_id = p_actor_user_id and active = true
  ) then
    raise exception 'Active staff access required' using errcode = '42501';
  end if;

  select * into current_booking
  from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if current_booking.anonymized_at is not null then
    raise exception 'Anonymized booking cannot be changed' using errcode = '22023';
  end if;
  if current_booking.updated_at is distinct from p_expected_updated_at then
    raise exception 'Booking changed; refresh before saving' using errcode = '40001';
  end if;
  if current_booking.status = p_status then
    raise exception 'Choose a different status' using errcode = '22023';
  end if;
  if (p_reply_channel is null) <> (p_replied_at is null) then
    raise exception 'Reply channel and time must be supplied together' using errcode = '22023';
  end if;
  if p_status in ('confirmed', 'rejected')
    and (p_reply_channel is null or p_replied_at is null) then
    raise exception 'Record how and when the customer was informed' using errcode = '22023';
  end if;
  if p_reply_note is not null and char_length(p_reply_note) > 500 then
    raise exception 'Reply note is too long' using errcode = '22023';
  end if;
  if p_replied_at is not null and (p_replied_at > now() + interval '10 minutes'
    or p_replied_at < current_booking.created_at - interval '30 days') then
    raise exception 'Reply time is outside this request' using errcode = '22023';
  end if;

  if p_reply_channel is not null then
    insert into public.booking_replies (booking_id, actor_user_id, channel, replied_at, note)
    values (p_booking_id, p_actor_user_id, p_reply_channel, p_replied_at, nullif(trim(p_reply_note), ''));
  end if;

  perform set_config('app.booking_transition', 'allowed', true);
  update public.bookings
  set status = p_status, updated_by = p_actor_user_id
  where id = p_booking_id
  returning * into changed_booking;
  perform set_config('app.booking_transition', '', true);
  return changed_booking;
end;
$$;

create or replace function public.unpublish_site_content(
  p_section text,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if p_section not in ('menu', 'hours', 'announcement') then
    raise exception 'Unknown website section' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.staff_profiles
    where user_id = p_actor_user_id and active = true and role = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  delete from public.site_content where section = p_section;
  get diagnostics changed_count = row_count;
  if changed_count = 1 then
    insert into public.activity_log (action, actor_user_id, metadata)
    values ('content_unpublished', p_actor_user_id, jsonb_build_object('section', p_section));
  end if;
  return changed_count = 1;
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
      messenger_name = null,
      occasion = null,
      notes = null,
      follow_up_notes = null,
      anonymized_at = now()
  where id = p_booking_id
    and anonymized_at is null;

  get diagnostics changed_count = row_count;
  if changed_count = 1 then
    update public.booking_replies set note = null where booking_id = p_booking_id;
  end if;
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
  update public.booking_replies as reply
  set note = null
  from public.bookings as booking
  where reply.booking_id = booking.id
    and booking.anonymized_at is null
    and booking.requested_date < (
      (now() at time zone 'Asia/Manila')::date - interval '12 months'
    )::date;

  update public.bookings
  set customer_name = null,
      contact_number = null,
      messenger_name = null,
      occasion = null,
      notes = null,
      follow_up_notes = null,
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

alter table public.booking_replies enable row level security;
alter table public.site_content enable row level security;
alter table public.content_drafts enable row level security;

revoke all on table public.booking_replies from public, anon, authenticated;
revoke all on table public.site_content from public, anon, authenticated;
revoke all on table public.content_drafts from public, anon, authenticated;
revoke update on table public.bookings from authenticated;
revoke update (status) on table public.bookings from authenticated;
drop policy "Active staff can change booking status" on public.bookings;

grant select, insert, update, delete on table public.booking_replies to service_role;
grant select, insert, update, delete on table public.site_content to service_role;
grant select, insert, update, delete on table public.content_drafts to service_role;
grant select on table public.booking_replies to authenticated;
grant select (section, content, published_at) on table public.site_content to anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

create policy "Active staff can read reply records"
on public.booking_replies for select to authenticated
using ((select private.is_active_staff()));

create policy "Everyone can read published website content"
on public.site_content for select to anon, authenticated
using (true);

revoke all on function public.transition_booking(uuid, timestamptz, public.booking_status, uuid, public.booking_reply_channel, timestamptz, text) from public, anon, authenticated;
grant execute on function public.transition_booking(uuid, timestamptz, public.booking_status, uuid, public.booking_reply_channel, timestamptz, text) to service_role;
revoke all on function public.unpublish_site_content(text, uuid) from public, anon, authenticated;
grant execute on function public.unpublish_site_content(text, uuid) to service_role;
revoke all on function private.record_booking_reply_activity() from public, anon, authenticated;
revoke all on function private.validate_booking_reply() from public, anon, authenticated;
revoke all on function private.record_site_content_activity() from public, anon, authenticated;
