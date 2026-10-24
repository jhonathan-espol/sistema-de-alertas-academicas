-- Ejecutar una vez en Supabase SQL Editor para habilitar el historial de análisis.
create table if not exists public.training_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id) on delete restrict,
  dataset_name text not null,
  dataset_rows integer not null check (dataset_rows > 0),
  dataset_bytes integer not null check (dataset_bytes > 0),
  validation_summary jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  stage text not null default 'En cola',
  result_summary jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists training_runs_created_at_idx
  on public.training_runs (created_at desc);

alter table public.training_runs enable row level security;
revoke all on public.training_runs from anon, authenticated;
grant all on public.training_runs to service_role;
