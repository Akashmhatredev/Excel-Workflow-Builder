// Basic web app manifest (name, colours, icon). There is deliberately no
// service worker: the app needs no offline cache and nothing is installed in
// the background.
export default function manifest() {
  return {
    name: "Excel Workflow Builder",
    short_name: "Workflow Builder",
    description:
      "Turn a raw Excel or CSV dump into clean output files and shareable report images, entirely in your browser.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f6",
    theme_color: "#047857",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
