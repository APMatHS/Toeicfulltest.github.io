-- TOEIC Full Test V1.11
-- Password recovery for staff + teacher-issued temporary passwords for students.
-- Apply before deploying the V1.11 Edge Functions/frontend.

begin;

alter table public.profiles
  add column if not exists email text,
  add column if not exists must_change_password boolean not null default false;

-- Backfill email for existing accounts. Auth emails are unique in Supabase Auth.
update public.profiles p
set email=lower(u.email)
from auth.users u
where u.id=p.id
  and u.email is not null
  and p.email is distinct from lower(u.email);

create unique index if not exists profiles_email_lower_uidx
  on public.profiles (lower(email))
  where email is not null;

-- Keep profile email synchronized and clear the temporary-password flag when
-- the user themselves changes the Auth password. The manage-user Edge Function
-- sets must_change_password=true AFTER an admin reset, so that reset remains forced.
create or replace function public.sync_profile_from_auth_update()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
      set email=case when new.email is null then null else lower(new.email) end
    where id=new.id;
  end if;

  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles
      set must_change_password=false
    where id=new.id;
  end if;

  return new;
end
$$;

revoke all on function public.sync_profile_from_auth_update() from public, anon, authenticated;

drop trigger if exists toeic_sync_profile_from_auth_update on auth.users;
create trigger toeic_sync_profile_from_auth_update
after update of email, encrypted_password on auth.users
for each row execute function public.sync_profile_from_auth_update();

commit;
