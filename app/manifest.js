// Web app manifest. Together with public/sw.js (registered by
// components/shell/ServiceWorkerRegistration.jsx in production builds) it makes
// the app installable and lets it open offline once it has been loaded.
//
// Colours are the light theme tokens from app/globals.css: --brand for the
// theme colour, --bg for the splash background. The PNG icons are renders of
// app/icon.svg (regenerate them together if the mark changes).
export default function manifest() {
  return {
    id: "/",
    name: "Excel Workflow Builder",
    short_name: "Workflow Builder",
    description:
      "Turn a raw Excel or CSV dump into clean output files and shareable report images, entirely in your browser.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    background_color: "#f5f7f6",
    theme_color: "#047857",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
