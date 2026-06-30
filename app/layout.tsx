import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { Toaster } from "@/components/Toaster";
import { notoSansMono } from "./fonts";

export const metadata: Metadata = {
  title: "Next-Step",
  description: "多 Agent 软件工厂（基于 pi-web 改造）",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={notoSansMono.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
      </head>
      <body style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
