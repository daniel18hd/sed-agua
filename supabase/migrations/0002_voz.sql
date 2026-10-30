-- Fase 6 · llamada de alerta (ElevenLabs). Estado de opt-in por sesión y bitácora de llamadas.
alter table public.sesiones add column if not exists voz jsonb;  -- {pending:{to,vars,exp,consulta_id}, declined_at, opt_out, last_inbound_at}

create table if not exists public.voice_calls (
  id              uuid primary key default gen_random_uuid(),
  at              timestamptz not null default now(),
  phone_hash      text not null,
  to_masked       text,          -- +52******1234 (el número completo solo vive 10 min en sesiones.voz.pending)
  colonia         text,
  nivel           text,
  motivo          text,
  es_demo         bool,
  ok              bool,
  dry_run         bool not null default true,
  conversation_id text,
  call_sid        text,
  error           text,
  consulta_id     uuid
);
create index if not exists voice_calls_phone_idx on public.voice_calls (phone_hash, at);
alter table public.voice_calls enable row level security;
revoke all on public.voice_calls from anon, authenticated;
-- consultas_publicas ya está en supabase_realtime: los UPDATE (badge 📞) también se emiten al OS.
