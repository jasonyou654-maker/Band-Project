import type { Metadata } from "next";
import "./globals.css";
import "./studio17.css";

export const metadata: Metadata = {
  title: "Studio17 — Music starts here",
  description: "Upload, discover, save and manage sheet music and private AI transcription drafts.",
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
