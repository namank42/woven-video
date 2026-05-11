import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://www.woven.video";
const siteName = "Woven";
const siteTitle = "Woven — The AI video editor";
const siteDescription =
  "Woven is the AI video editor. A native macOS app to script, edit, and assemble short-form video by asking. Bring your own keys, or use Woven-hosted models on a prepaid balance.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: "%s — Woven",
  },
  description: siteDescription,
  applicationName: siteName,
  authors: [{ name: "Woven" }],
  creator: "Woven",
  publisher: "Woven",
  keywords: [
    "AI video app",
    "short form video",
    "short-form video",
    "AI video maker",
    "generative AI video",
    "Instagram Reels",
    "TikTok",
    "YouTube Shorts",
    "macOS video app",
    "AI b-roll",
    "AI lip sync",
    "AI voiceover",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName,
    title: siteTitle,
    description: siteDescription,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "Multimedia",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
