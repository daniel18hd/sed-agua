-- Sed · reportes en tiempo real + discrepancias vecinos vs datos oficiales (panel de atención para gobierno).
-- Privacidad: el cliente anónimo del OS solo lee reportes_publicos y casos_atencion (sin teléfono, sin hash, sin texto libre).

-- Reportes privados (escritura solo service role)
alter table public.reportes drop constraint if exists reportes_tipo_check;
alter table public.reportes add constraint reportes_tipo_check check (tipo in ('sin_agua','baja_presion','mala_calidad','turbia','fuga'));
alter table public.reportes add column if not exists alcaldia text;
alter table public.reportes add column if not exists colonia  text;
alter table public.reportes add column if not exists folio    text;
alter table public.reportes add column if not exists contacto text;            -- whatsapp:+52… solo para el aviso de alerta (se borra al avisar)
alter table public.reportes add column if not exists avisado  bool not null default false;
alter table public.reportes add column if not exists demo     bool not null default false;
create index if not exists reportes_created_idx on public.reportes (created_at desc);

-- Copia pública (coordenadas redondeadas ~110 m; sin phone_hash, contacto, folio ni texto)
create table if not exists public.reportes_publicos (
  id          uuid primary key,
  created_at  timestamptz not null,
  lat         float8,
  lon         float8,
  cve_mun     text,
  alcaldia    text,
  cve_col     text,
  colonia     text,
  tipo        text not null check (tipo in ('sin_agua','baja_presion','mala_calidad')),
  demo        bool not null default false
);
create index if not exists reportes_publicos_created_idx on public.reportes_publicos (created_at desc);

create or replace function public.copiar_reporte_publico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo in ('sin_agua','baja_presion','mala_calidad') then
    insert into public.reportes_publicos (id, created_at, lat, lon, cve_mun, alcaldia, cve_col, colonia, tipo, demo)
    values (new.id, new.created_at, round(new.lat::numeric, 3)::float8, round(new.lon::numeric, 3)::float8,
            new.cve_mun, new.alcaldia, new.cve_col, new.colonia, new.tipo, new.demo)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists reportes_publicos_trg on public.reportes;
create trigger reportes_publicos_trg after insert on public.reportes for each row execute function public.copiar_reporte_publico();

-- Casos que requieren atención (discrepancias). Escritura solo service role (API del panel); el OS los lee.
create table if not exists public.casos_atencion (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  zona_key         text not null,
  cve_mun          text,
  alcaldia         text,
  cve_col          text,
  colonia          text,
  lat              float8,
  lon              float8,
  estado           text not null,       -- aislado | posible_problema | alerta | explicado
  severidad        int  not null default 0,
  n                int  not null default 0,
  ventana_min      int  not null default 60,
  primero          timestamptz,
  ultimo           timestamptz,
  razones          jsonb,
  fuentes          jsonb,
  oficial          text,                -- normal | corte | riesgo
  discrepancia     bool not null default false,
  atencion         text not null default 'nuevo' check (atencion in ('nuevo','en_revision','atendido')),
  historial        jsonb not null default '[]'::jsonb,
  atendido_at      timestamptz,
  archivado        bool not null default false,
  archivado_at     timestamptz,
  archivado_motivo text,
  demo             bool not null default false
);
create index if not exists casos_atencion_activos_idx on public.casos_atencion (archivado, zona_key);
create index if not exists casos_atencion_updated_idx on public.casos_atencion (updated_at desc);

alter table public.reportes_publicos enable row level security;
alter table public.casos_atencion   enable row level security;
revoke all on public.reportes_publicos from anon, authenticated;
revoke all on public.casos_atencion   from anon, authenticated;
grant select on public.reportes_publicos to anon;
grant select on public.casos_atencion   to anon;
drop policy if exists reportes_publicos_select on public.reportes_publicos;
create policy reportes_publicos_select on public.reportes_publicos for select to anon using (true);
drop policy if exists casos_atencion_select on public.casos_atencion;
create policy casos_atencion_select on public.casos_atencion for select to anon using (true);

do $$ begin
  begin alter publication supabase_realtime add table public.reportes_publicos; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.casos_atencion;   exception when duplicate_object then null; end;
end $$;
alter table public.casos_atencion replica identity full;
