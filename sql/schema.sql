-- ============================================================
-- Khare Family Tree — Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- 1. ENUMS
create type gender_type as enum ('M', 'F', 'Other');
create type relationship_type as enum ('parent_child', 'spouse', 'sibling');
create type status_type as enum ('pending', 'approved', 'rejected');

-- 2. PERSONS
create table persons (
  id              text primary key,              -- e.g. P001, P002
  name            text not null,
  gender          gender_type,
  birth_date      date,
  death_date      date,
  birth_place     text,
  current_location text,
  is_alive        boolean default true,
  generation      integer,
  blood_member    boolean default true,          -- true = Khare bloodline, false = married in
  birth_order     integer,                       -- order among siblings
  profile_photo_url text,
  needs_review    boolean default false,         -- flagged for data verification
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 3. RELATIONSHIPS
create table relationships (
  id              uuid primary key default gen_random_uuid(),
  person1_id      text references persons(id) on delete cascade,
  person2_id      text references persons(id) on delete cascade,
  type            relationship_type not null,
  marriage_date   date,
  marriage_place  text,
  is_divorced     boolean default false,
  notes           text,
  created_at      timestamptz default now()
);

-- 4. PHOTOS
create table photos (
  id              uuid primary key default gen_random_uuid(),
  person_id       text references persons(id) on delete cascade,
  uploaded_by_name  text,
  uploaded_by_email text,
  photo_url       text not null,
  caption         text,
  status          status_type default 'approved',  -- auto-approve per user choice
  created_at      timestamptz default now()
);

-- 5. COMMENTS
create table comments (
  id              uuid primary key default gen_random_uuid(),
  person_id       text references persons(id) on delete cascade,
  commenter_name  text,
  commenter_email text,
  content         text not null,
  status          status_type default 'approved',  -- auto-approve per user choice
  created_at      timestamptz default now()
);

-- 6. CHANGE REQUESTS
create table change_requests (
  id                  uuid primary key default gen_random_uuid(),
  person_id           text references persons(id) on delete cascade,
  requested_by_name   text,
  requested_by_email  text,
  field_name          text not null,
  old_value           text,
  new_value           text,
  status              status_type default 'pending',
  admin_notes         text,
  created_at          timestamptz default now()
);

-- 7. ADMIN SESSIONS
create table admin_sessions (
  id          uuid primary key default gen_random_uuid(),
  token       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table persons          enable row level security;
alter table relationships    enable row level security;
alter table photos           enable row level security;
alter table comments         enable row level security;
alter table change_requests  enable row level security;
alter table admin_sessions   enable row level security;

-- PUBLIC: read persons and relationships
create policy "Public can read persons"
  on persons for select using (true);

create policy "Public can read relationships"
  on relationships for select using (true);

-- PUBLIC: read approved photos and comments
create policy "Public can read approved photos"
  on photos for select using (status = 'approved');

create policy "Public can read approved comments"
  on comments for select using (status = 'approved');

-- PUBLIC: submit photos, comments, change requests (insert only)
create policy "Public can submit photos"
  on photos for insert with check (true);

create policy "Public can submit comments"
  on comments for insert with check (true);

create policy "Public can submit change requests"
  on change_requests for insert with check (true);

-- NOTE: Admin operations (insert/update/delete on persons, relationships,
-- approving submissions) are done via Supabase service role key in Streamlit.
-- The anon key is read-only + insert for public submissions.

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index idx_persons_generation on persons(generation);
create index idx_relationships_person1 on relationships(person1_id);
create index idx_relationships_person2 on relationships(person2_id);
create index idx_photos_person on photos(person_id);
create index idx_comments_person on comments(person_id);
create index idx_change_requests_person on change_requests(person_id);
create index idx_change_requests_status on change_requests(status);

-- ============================================================
-- AUTO-UPDATE updated_at on persons
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger persons_updated_at
  before update on persons
  for each row execute function update_updated_at();
