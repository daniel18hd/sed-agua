const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const twiml = (msg: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(msg)}</Message></Response>`, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
