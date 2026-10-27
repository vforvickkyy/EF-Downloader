-- Eastape Downloader cloud: initial schema.

create table if not exists schema_migrations (
  version    int primary key,
  applied_at timestamptz not null default now()
);

-- People who registered in the app (name + email asked on first start).
create table if not exists users (
  id          bigserial primary key,
  name        text not null,
  email       text not null,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

-- One row per installed copy (random install ID created by the app).
create table if not exists installs (
  id               text primary key,
  user_id          bigint references users(id) on delete set null,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  installed_at     timestamptz,
  app_version      text,
  os               text,
  source           text,              -- installer, portable, app
  stats_enabled    boolean not null default true,
  last_state       text,              -- idle, downloading, paused
  last_bps         bigint not null default 0,
  sessions         int not null default 0,
  active_seconds   bigint not null default 0,
  links_scanned    int not null default 0,
  jobs             int not null default 0,
  files_downloaded bigint not null default 0,
  bytes_downloaded bigint not null default 0,
  rl_window        timestamptz,
  rl_count         int not null default 0
);
create index if not exists installs_last_seen_idx on installs (last_seen desc);
create index if not exists installs_user_idx on installs (user_id);

-- Raw usage events, kept for 180 days (daily totals are kept forever).
create table if not exists events (
  id          bigserial primary key,
  install_id  text not null,
  type        text not null,
  ts          timestamptz not null,
  received_at timestamptz not null default now(),
  app_version text,
  props       jsonb not null default '{}'::jsonb
);
create index if not exists events_ts_idx on events (ts desc);
create index if not exists events_type_ts_idx on events (type, ts desc);
create index if not exists events_install_ts_idx on events (install_id, ts desc);

create table if not exists daily_stats (
  day    date not null,
  metric text not null,
  value  numeric not null,
  primary key (day, metric)
);

create table if not exists support_tickets (
  id          bigserial primary key,
  install_id  text,
  name        text not null,
  email       text not null,
  topic       text,
  message     text not null,
  details     text,
  app_version text,
  os          text,
  status      text not null default 'open',  -- open, answered, closed
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists support_status_idx on support_tickets (status, created_at desc);

-- App updates offered in the app.
create table if not exists releases (
  id            bigserial primary key,
  version       text not null,
  channel       text not null default 'stable',
  file_url      text not null,
  file_name     text,
  size          bigint not null,
  sha256        text not null,
  signature     text not null,
  notes         text not null default '',
  mandatory     boolean not null default false,
  min_supported text,
  rollout       int not null default 100 check (rollout between 0 and 100),
  status        text not null default 'draft',  -- draft, published, paused
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  unique (channel, version)
);

-- Messages shown in the app (bell + banners).
create table if not exists announcements (
  id          bigserial primary key,
  title       text not null,
  body        text not null default '',
  level       text not null default 'info',  -- info, success, warning, critical
  cta_label   text,
  cta_url     text,
  min_version text,
  max_version text,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  dismissible boolean not null default true,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Dashboard accounts.
create table if not exists admin_users (
  id            bigserial primary key,
  email         text not null,
  name          text not null default '',
  password_hash text not null,
  role          text not null default 'admin',  -- owner, admin, viewer
  created_at    timestamptz not null default now(),
  last_login    timestamptz
);
create unique index if not exists admin_users_email_key on admin_users (lower(email));

create table if not exists admin_sessions (
  token_hash text primary key,
  user_id    bigint not null references admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists login_attempts (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0
);

insert into schema_migrations (version) values (1) on conflict do nothing;
