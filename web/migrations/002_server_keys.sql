-- Keys the service creates for itself (the update signing key), so they
-- never have to be copied by hand.
create table if not exists server_keys (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

insert into schema_migrations (version) values (2) on conflict do nothing;
