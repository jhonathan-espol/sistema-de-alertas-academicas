-- Ejecutar una sola vez en el SQL Editor del proyecto Supabase db_alertas.
-- Las tablas usan RLS sin políticas públicas. La API Python accede con la
-- SUPABASE_SERVICE_ROLE_KEY guardada como secreto de Cloudflare.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text not null unique,
  password_hash text not null,
  role text not null default 'invitado' check (role in ('administrador', 'invitado')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  severity text not null default 'media' check (severity in ('baja', 'media', 'alta', 'critica')),
  status text not null default 'activa' check (status in ('activa', 'resuelta', 'archivada')),
  created_by uuid references public.users(id) on delete set null,
  assigned_to uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.alerts enable row level security;
revoke all on public.users, public.alerts from anon, authenticated;
grant all on public.users, public.alerts to service_role;

-- PBKDF2-SHA256; formato: pbkdf2_sha256$iteraciones$sal$hash_hex.
-- Cambie estas contraseñas temporales después del primer inicio de sesión.
insert into public.users (username, email, password_hash, role)
values
  ('administrador', 'administrador@alertas.local', 'pbkdf2_sha256$310000$alertas-admin-seed-v1$126979746cc41241e96343fd7f6bb53f95b62829a7e03c0ea04716266072ae64', 'administrador'),
  ('invitado', 'invitado@alertas.local', 'pbkdf2_sha256$310000$alertas-invitado-seed-v1$6ca5045cbbdd5f615b779bb780fe980271213ed6180aa22621fbb3e48e7351da', 'invitado')
on conflict (username) do nothing;

-- No se crean políticas anon/authenticated: todas las operaciones pasan
-- por la API y su clave de servicio privada, nunca por el navegador.
