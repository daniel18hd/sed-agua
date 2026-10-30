import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sed · ¿hoy hay agua?",
  description: "Tu llave no avisa. Sed sí: por WhatsApp te dice si hay agua en tu colonia, cuándo llega y si hay aviso de calidad.",
};
export const viewport: Viewport = { themeColor: "#05070b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
