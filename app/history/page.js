import HistoryView from "@/components/history/HistoryView";

// The root layout's title template appends the product name.
export const metadata = {
  title: "History",
  description: "The downloads you made on this device: names, dates and row counts only, never the data.",
};

// Run history page (owner: X5). The log lives in localStorage, so the list is a Client Component.
export default function HistoryPage() {
  return (
    <main className="flex flex-1 flex-col">
      <HistoryView />
    </main>
  );
}
