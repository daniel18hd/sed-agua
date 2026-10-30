// Notas de voz de WhatsApp → texto. ElevenLabs STT (scribe) o, si no hay, Whisper (OpenAI). Solo audio; imágenes nunca se descargan.
// La media de Twilio requiere auth básica y redirige a un URL firmado: se pide sin seguir el redirect y luego sin credenciales.
const TIMEOUT = 6000;

export const esAudio = (e: { NumMedia?: string | number; MediaContentType0?: string }) =>
  Number(e.NumMedia ?? 0) > 0 && /^audio\//.test(e.MediaContentType0 ?? "");

async function bajarMedia(url: string, signal: AbortSignal): Promise<Blob | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok || !/^https:\/\/api\.twilio\.com\//.test(url)) return null;
  const auth = "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64");
  let r = await fetch(url, { headers: { Authorization: auth }, redirect: "manual", signal });
  if (r.status >= 300 && r.status < 400 && r.headers.get("location")) r = await fetch(r.headers.get("location")!, { signal });
  if (!r.ok) return null;
  const b = await r.blob();
  return b.size > 0 && b.size < 8_000_000 ? b : null;
}

export async function transcribir(e: { MediaUrl0?: string; MediaContentType0?: string }): Promise<string | null> {
  if (!e.MediaUrl0) return null;
  const el = process.env.ELEVENLABS_API_KEY, oa = process.env.OPENAI_API_KEY;
  if (!el && !oa) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const audio = await bajarMedia(e.MediaUrl0, ctl.signal);
    if (!audio) return null;
    const fd = new FormData();
    const nombre = `nota.${(e.MediaContentType0 ?? "audio/ogg").split("/")[1].split(";")[0]}`;
    if (el) {
      fd.append("model_id", "scribe_v1");
      fd.append("language_code", "spa");
      fd.append("file", audio, nombre);
      const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": el }, body: fd, signal: ctl.signal });
      const j = await r.json().catch(() => null);
      return r.ok && j?.text ? String(j.text).trim() : null;
    }
    fd.append("model", "whisper-1");
    fd.append("language", "es");
    fd.append("file", audio, nombre);
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${oa}` }, body: fd, signal: ctl.signal });
    const j = await r.json().catch(() => null);
    return r.ok && j?.text ? String(j.text).trim() : null;
  } catch (err) {
    console.warn("[stt] no se pudo transcribir:", (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}
