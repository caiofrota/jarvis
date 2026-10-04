import './globals.css';
export const metadata = { title: 'Jarvis Studio', description: 'Seu espaço de comando' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
