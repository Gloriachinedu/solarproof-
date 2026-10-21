-- Migration: notifications
-- Adds notification preferences, in-app notification history, and delivery/retry state.

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  cooperative_id uuid primary key references public.cooperatives (id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  webhook_enabled boolean not null default false,
  email_address text,
  webhook_url text,
  webhook_secret text,
  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-cooperative notification channel configuration.';

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references public.cooperatives (id) on delete cascade,
  event_type text not null check (
    event_type in ('issued', 'verified', 'failed', 'retired')
  ),
  certificate_id uuid references public.certificates (id) on delete set null,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'In-app notification history for certificate status changes.';

-- ---------------------------------------------------------------------------
-- notification_deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'webhook')),
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'failed', 'exhausted')
  ),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_deliveries is
  'Per-channel delivery state and retry bookkeeping for notifications.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists notification_preferences_cooperative_id_idx
  on public.notification_preferences (cooperative_id);

create index if not exists notifications_cooperative_id_idx
  on public.notifications (cooperative_id);

create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

create index if not exists notifications_cooperative_created_at_idx
  on public.notifications (cooperative_id, created_at desc);

create index if not exists notification_deliveries_notification_id_idx
  on public.notification_deliveries (notification_id);

create index if not exists notification_deliveries_created_at_idx
  on public.notification_deliveries (created_at desc);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (next_attempt_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists notification_deliveries_set_updated_at on public.notification_deliveries;
create trigger notification_deliveries_set_updated_at
  before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;

-- notification_preferences: cooperative-scoped access
drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
  for select
  using (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

drop policy if exists notification_preferences_insert on public.notification_preferences;
create policy notification_preferences_insert on public.notification_preferences
  for insert
  with check (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_update on public.notification_preferences
  for update
  using (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  )
  with check (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

drop policy if exists notification_preferences_delete on public.notification_preferences;
create policy notification_preferences_delete on public.notification_preferences
  for delete
  using (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

-- notifications: cooperative-scoped access
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select
  using (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert
  with check (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update
  using (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  )
  with check (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete
  using (
    cooperative_id in (
      select cooperative_id from public.cooperative_members where user_id = auth.uid()
    )
  );

-- notification_deliveries: cooperative-scoped via parent notification
drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select on public.notification_deliveries
  for select
  using (
    exists (
      select 1
      from public.notifications n
      join public.cooperative_members cm on cm.cooperative_id = n.cooperative_id
      where n.id = notification_deliveries.notification_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists notification_deliveries_insert on public.notification_deliveries;
create policy notification_deliveries_insert on public.notification_deliveries
  for insert
  with check (
    exists (
      select 1
      from public.notifications n
      join public.cooperative_members cm on cm.cooperative_id = n.cooperative_id
      where n.id = notification_deliveries.notification_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists notification_deliveries_update on public.notification_deliveries;
create policy notification_deliveries_update on public.notification_deliveries
  for update
  using (
    exists (
      select 1
      from public.notifications n
      join public.cooperative_members cm on cm.cooperative_id = n.cooperative_id
      where n.id = notification_deliveries.notification_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.notifications n
      join public.cooperative_members cm on cm.cooperative_id = n.cooperative_id
      where n.id = notification_deliveries.notification_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists notification_deliveries_delete on public.notification_deliveries;
create policy notification_deliveries_delete on public.notification_deliveries
  for delete
  using (
    exists (
      select 1
      from public.notifications n
      join public.cooperative_members cm on cm.cooperative_id = n.cooperative_id
      where n.id = notification_deliveries.notification_id
        and cm.user_id = auth.uid()
    )
  );