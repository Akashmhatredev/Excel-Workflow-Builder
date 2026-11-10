import { Geist, Geist_Mono } from "next/font/google";
import Toaster from "@/components/shell/Toaster";
import StorageBridge from "@/components/templates/StorageBridge";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "Excel Workflow Builder",
  description: "Turn a raw Excel or CSV dump into clean output files and shareable report images, entirely in your browser.",
};

// Sets the theme class before first paint (key: ewb:v1:theme = "light" | "dark" | "system").
const themeScript = `(function(){try{var t=localStorage.getItem("ewb:v1:theme");var d=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <Toaster />
        <StorageBridge />
      </body>
    </html>
  );
}
