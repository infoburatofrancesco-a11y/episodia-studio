import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EPISODIA — AI Series Studio',
  description:
    'Studio di produzione AI per creare serie TV social (Reels/TikTok) con personaggi ricorrenti ad altissima fedeltà visiva.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-violet-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}

