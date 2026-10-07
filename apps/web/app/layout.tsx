import { config } from "@fortawesome/fontawesome-svg-core";
import type { Metadata } from "next";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";
import { SessionProvider } from "../src/features/session/SessionProvider";

config.autoAddCss = false;
export const metadata: Metadata = {
  title: "Jarvis · Central de operações",
  description: "Sua casa e seus assistentes em uma plataforma.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
