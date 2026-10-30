-- Sed · esquema inicial. Escritura solo con service role (webhook). El OS (anon) solo lee consultas_publicas.
create extension if not exists pgcrypto;

create table if not exists public.consultas (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  phone_hash  text,
  canal       text,
  texto       text,
  lat         float8,
  lon         float8,
  geo_fuente  text,          -- ubicacion | direccion | cp | colonia | demo
  cve_mun     text,
  alcaldia    text,
  cve_col     text,
  colonia     text,
  nivel       text,
  resultado   jsonb,         -- incluye llegada, calidad, reply
  demo        bool not null default false
);

create table if not exists public.reportes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  phone_hash  text not null,
  tipo        text not null check (tipo in ('sin_agua','turbia','fuga')),
  lat         float8,
  lon         float8,
  cve_mun     text,
  cve_col     text
  -- sin columnas de media: solo texto/ubicación
);

create table if not exists public.sesiones (
  phone_hash          text primary key,
  estado              text not null default 'esperando_direccion', -- esperando_direccion | esperando_tipo_reporte | idle
  ultima_consulta_id  uuid,
  ctx                 jsonb,   -- {lat, lon, cve_mun, cve_col} de la última consulta (para REPORTAR)
  updated_at          timestamptz not null default now()
);

create index if not exists consultas_col_idx on public.consultas (cve_col, created_at);
create index if not exists consultas_mun_idx on public.consultas (cve_mun, created_at);
create index if not exists reportes_col_idx  on public.reportes  (cve_col, created_at);
create index if not exists reportes_mun_idx  on public.reportes  (cve_mun, created_at);

-- Copia pública (sin phone_hash ni texto; lat/lon redondeados ~110 m) llenada por trigger.
-- Es TABLA y no vista porque Realtime postgres_changes no emite cambios de vistas, y con RLS el anon
-- no recibiría los INSERT de `consultas`. El OS escucha esta tabla.
create table if not exists public.consultas_publicas (
  id          uuid primary key,
  created_at  timestamptz not null,
  canal       text,
  lat         float8,
  lon         float8,
  geo_fuente  text,
  cve_mun     text,
  alcaldia    text,
  cve_col     text,
  colonia     text,
  nivel       text,
  resultado   jsonb,
  demo        bool not null default false
);
create index if not exists consultas_publicas_created_idx on public.consultas_publicas (created_at desc);

create or replace function public.copiar_consulta_publica() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.consultas_publicas (id, created_at, canal, lat, lon, geo_fuente, cve_mun, alcaldia, cve_col, colonia, nivel, resultado, demo)
  values (new.id, new.created_at, new.canal, round(new.lat::numeric, 3)::float8, round(new.lon::numeric, 3)::float8, new.geo_fuente,
          new.cve_mun, new.alcaldia, new.cve_col, new.colonia, new.nivel, new.resultado, new.demo)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists consultas_publicas_trg on public.consultas;
create trigger consultas_publicas_trg after insert on public.consultas
  for each row execute function public.copiar_consulta_publica();

-- RLS: escritura solo service role (bypassa RLS). anon solo lee consultas_publicas.
alter table public.consultas          enable row level security;
alter table public.reportes           enable row level security;
alter table public.sesiones           enable row level security;
alter table public.consultas_publicas enable row level security;

drop policy if exists "anon lee consultas_publicas" on public.consultas_publicas;
create policy "anon lee consultas_publicas" on public.consultas_publicas for select to anon, authenticated using (true);

revoke all on public.consultas, public.reportes, public.sesiones from anon, authenticated;
revoke insert, update, delete on public.consultas_publicas from anon, authenticated;
grant select on public.consultas_publicas to anon, authenticated;

-- Realtime
do $$ begin
  begin alter publication supabase_realtime add table public.consultas;          exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.reportes;           exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.consultas_publicas; exception when duplicate_object then null; end;
end $$;
