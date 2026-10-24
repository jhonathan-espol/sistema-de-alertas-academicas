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
  ('administrador', 'administrador@alertas.local', 'pbkdf2_sha256$100000$alertas-admin-seed-v1$63004680e14dda4c70e101f524a0081a35696fdaa4d2f44acd3a58b026a4093c', 'administrador'),
  ('invitado', 'invitado@alertas.local', 'pbkdf2_sha256$100000$alertas-invitado-seed-v1$892f6486c556c084e11a1bb1f05a0a2d560db9529609900dcd7518b2436cce1f', 'invitado')
on conflict (username) do nothing;

-- No se crean políticas anon/authenticated: todas las operaciones pasan
-- por la API y su clave de servicio privada, nunca por el navegador.
