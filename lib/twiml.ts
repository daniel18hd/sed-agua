const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Uno o más mensajes de WhatsApp en la misma respuesta TwiML. */
export const twiml = (...msgs: (string | undefined)[]) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${msgs.filter(Boolean).map((m) => `<Message>${esc(m!)}</Message>`).join("")}</Response>`,
    { headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
