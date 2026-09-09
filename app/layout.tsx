import type { Metadata } from "next";
import "./globals.css";

// The GitHub Pages build pre-renders this app. The interactive experience is
// client-side, so it does not need request-time rendering.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "BandProject — Play something worth sharing",
  description: "Discover, share, and create sheet music with a community of student musicians.",
  icons: {
    icon: "favicon.svg",
    shortcut: "favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
