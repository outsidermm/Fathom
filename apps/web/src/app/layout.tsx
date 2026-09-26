import type { Metadata } from "next";
import { Darumadrop_One, JetBrains_Mono, Sen } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const display = Darumadrop_One({
  weight: "400",
  variable: "--font-darumadrop",
  subsets: ["latin"],
});

const body = Sen({
  variable: "--font-sen",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Interpretability Observatory",
  description: "Oracle of the Deep — HackGT 13",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
