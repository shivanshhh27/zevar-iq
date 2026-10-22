import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zevar IQ",
  description: "Track your jewellery purchases, sales and inventory. See which designs sell, which are stuck, and what to reorder from your karigars.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
