import { Geist, Geist_Mono } from "next/font/google";
import SiteFooter from "@/components/shell/SiteFooter";
import ServiceWorkerRegistration from "@/components/shell/ServiceWorkerRegistration";
import SiteHeader from "@/components/shell/SiteHeader";
import Toaster from "@/components/shell/Toaster";
import StorageBridge from "@/components/templates/StorageBridge";
import { KEYS, storageKey } from "@/lib/storage";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const APP_NAME = "Excel Workflow Builder";

export const metadata = {
  // Child routes export a bare title ("Workflow"); the template adds the product name.
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description:
    "Turn a raw Excel or CSV dump into clean output files and shareable report images, entirely in your browser.",
  applicationName: APP_NAME,
  // Installed to an iPhone home screen: the short name under the icon (app/apple-icon.png).
  appleWebApp: { title: "Workflow Builder", statusBarStyle: "default" },
  // Spreadsheet values are not phone numbers or addresses: stop iOS from linking them.
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport = {
  // The header surface, so the browser chrome continues it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141a17" },
  ],
};

/*
 * Sets the theme class before first paint. The saved choice is the raw string
 * "light" | "dark" | "system" under ewb:v1:theme; anything else follows the OS.
 * components/shell/theme.js applies the same rule after hydration: change them together.
 */
const themeScript = `(function(){var t=null;try{t=localStorage.getItem(${JSON.stringify(
  storageKey(KEYS.theme),
)})}catch(e){}try{var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        {/* Pages render their own <main>; this wrapper is the skip link's target. */}
        <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
          {children}
        </div>
        <SiteFooter />
        <Toaster />
        <StorageBridge />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
