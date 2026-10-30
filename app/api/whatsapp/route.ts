// Alias del webhook de Twilio: https://<dominio>/api/whatsapp (mismo handler que /api/twilio/webhook).
// La firma se valida contra PUBLIC_BASE_URL + "/api/whatsapp" (usa el path real de la petición).
export { POST } from "../twilio/webhook/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
