-- Return register: durable ride records, saved route plans, photo metadata.
--
-- Written by the rider's own device, never by the Go server (docs/ADR/ADR-018.md) —
-- ADR-008 forbids a DB driver in backend/go.mod, and the distance/duration figures only
-- exist on the phone that recorded them. Access control is Row-Level Security and
-- nothing else (docs/SYSTEM_DESIGN.md §12), so every table below enables RLS and gets
-- the full four policies. A table with RLS enabled and no policies denies everything,
-- which fails safe; a table where RLS was forgotten is readable by any anon-key holder,
-- which does not. Never add a table here without both.

create table public.rides (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- The ephemeral Go room code, kept only as a human-readable label. The room itself is
  -- long gone by the time anyone reads this row (rooms are GC'd 5 min after the last
  -- rider leaves) — this is not a foreign key to anything.
  join_code   text,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  distance_m  double precision not null default 0 check (distance_m >= 0),
  moving_s    integer          not null default 0 check (moving_s >= 0),
  -- Highest single-fix speed seen during the ride. A fact about this ride and nothing
  -- else — ADR-019 §2 ships it precisely because it requires no second ride to compute.
  max_speed_mps double precision not null default 0 check (max_speed_mps >= 0),
  -- Decimated [[lng, lat], …] — GeoJSON order, matching route.polyline and MapLibre
  -- rather than the lat/lng field convention used everywhere else (CLAUDE.md's known
  -- trap). Deliberately jsonb, not PostGIS: this column is only ever read whole, and
  -- nothing does geospatial querying. Add the extension when "rides near this point"
  -- becomes a feature (ADR-018 §4).
  track       jsonb,
  -- The planned route frame, if one was set. Null for a ride with no destination.
  route       jsonb,
  -- [{"id": …, "name": …}] — a snapshot of who THIS rider saw, owned by this rider and
  -- invisible to everyone else. Not a ride_participants table: that needs cross-user
  -- visibility, which needs consent, which is the social graph SYSTEM_DESIGN.md §1 rules
  -- out (ADR-018 §2).
  companions  jsonb not null default '[]'::jsonb,
  title       text,
  -- The journal. One reflective note per ride is what a ride journal is, so this is a
  -- column rather than a journal_entries table — no join, no second policy set, no
  -- orphan risk. Promote to a table when timestamped moments DURING a ride ship, which
  -- is a different feature (ADR-018 §4).
  note        text,
  created_at  timestamptz not null default now(),
  check (ended_at >= started_at)
);

-- The archive list's only query shape: this rider's rides, newest first.
create index rides_user_started_idx on public.rides (user_id, started_at desc);

-- No route_plans table. Saved, named, reloadable route plans were considered and
-- deliberately not built: the planner (ADR-013) builds a route for the ride you are
-- about to take, and nothing reads a stored one. A table with no reader is a migration
-- you have to keep forever to store rows nobody asks for. Add it — `{user_id, name,
-- waypoints jsonb, created_at}` with the same four RLS policies as below — when a
-- screen actually loads a plan back.

create table public.ride_photos (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid not null references public.rides(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- '<user_id>/<ride_id>/<uuid>.jpg'. The first path segment is what the Storage policy
  -- in 0002 checks ownership against, so this format is load-bearing, not cosmetic.
  path       text not null unique,
  caption    text,
  taken_at   timestamptz,
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now()
);

create index ride_photos_ride_idx on public.ride_photos (ride_id, created_at);

-- RLS ------------------------------------------------------------------------
--
-- Identical shape on all three tables: you can see, write, change and delete exactly
-- your own rows. `(select auth.uid())` rather than a bare `auth.uid()` is Supabase's
-- documented performance idiom — the subquery is evaluated once per statement instead
-- of once per row.
--
-- No is_anonymous restriction anywhere. An anonymous rider is a full rider (ADR-016) —
-- that is the whole premise, and a policy that treated them as second-class would break
-- the app for almost every user.

alter table public.rides       enable row level security;
alter table public.ride_photos enable row level security;

create policy rides_select on public.rides for select to authenticated
  using ((select auth.uid()) = user_id);
create policy rides_insert on public.rides for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy rides_update on public.rides for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy rides_delete on public.rides for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy ride_photos_select on public.ride_photos for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ride_photos_insert on public.ride_photos for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy ride_photos_update on public.ride_photos for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ride_photos_delete on public.ride_photos for delete to authenticated
  using ((select auth.uid()) = user_id);
