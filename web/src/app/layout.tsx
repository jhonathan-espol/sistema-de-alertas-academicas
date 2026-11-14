import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alertas Académicas",
  description: "Sistema de alertas tempranas de no continuidad en la carrera - primer nivel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
