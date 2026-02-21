import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: "#f9fafb", // Match bg-gray-50
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Prevents zooming on inputs for mobile native feel
};

export const metadata: Metadata = {
  title: "InsulHub UI",
  description: "InsulMAX CRM — mobile-first sales interface",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "InsulHub",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased bg-gray-50`}>
        {children}
      </body>
    </html>
  );
}
