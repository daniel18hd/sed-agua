// Genera public/qr.png → https://wa.me/<numero_sin_+>?text=Hola desde TWILIO_WHATSAPP_NUMBER (.env.local o env).
// Uso: pnpm qr   (o TWILIO_WHATSAPP_NUMBER=+5215512345678 pnpm qr)
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

for (const f of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*)/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const raw = process.env.TWILIO_WHATSAPP_NUMBER ?? "";
const num = raw.replace(/^whatsapp:/, "").replace(/[^\d]/g, "");
if (num.length < 10) {
  console.error("Falta TWILIO_WHATSAPP_NUMBER (formato internacional, p. ej. +5215512345678). Daniel confirma cuál número.");
  process.exit(1);
}
const url = `https://wa.me/${num}?text=Hola`;
const out = path.join(process.cwd(), "public", "qr.png");
await QRCode.toFile(out, url, { width: 720, margin: 1, errorCorrectionLevel: "M", color: { dark: "#05070b", light: "#ffffff" } });
console.log(`QR → ${out}\n${url}`);
