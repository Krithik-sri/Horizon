-- Ride photos live in a PRIVATE Storage bucket (docs/ADR/ADR-018.md).
--
-- Private, not public: a photo carries the place and time a rider was somewhere, which
-- is the same class of data SYSTEM_DESIGN.md §12 protects everywhere else. Reads go
-- through createSignedUrl with a short TTL rather than a permanent public URL.

insert into storage.buckets (id, name, public)
values ('ride-photos', 'ride-photos', false)
on conflict (id) do nothing;

-- Ownership is encoded in the object path: '<user_id>/<ride_id>/<file>.jpg', so the
-- first folder segment IS the access check. That is why core/photos.ts's path format is
-- load-bearing rather than cosmetic — change it there and this policy silently stops
-- matching, which fails closed (nobody can read anything) rather than open.
--
-- One `for all` policy rather than four: unlike the tables in 0001, every operation here
-- has the identical condition, and splitting it would be four copies of one predicate.
create policy ride_photos_own on storage.objects for all to authenticated
  using      (bucket_id = 'ride-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'ride-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
