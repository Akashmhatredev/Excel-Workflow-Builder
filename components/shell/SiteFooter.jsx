import PrivacyNote from "./PrivacyNote";

/** Compact footer: the privacy promise and where saved work lives. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1.5 px-4 py-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <PrivacyNote />
        <p>Templates and drafts are saved on this device only.</p>
      </div>
    </footer>
  );
}
