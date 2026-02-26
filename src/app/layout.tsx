import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Treadmagotchi',
  description: 'Your pixel pet that trades for you',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-pixel-bg text-white min-h-screen font-pixel">
        {children}
      </body>
    </html>
  );
}
