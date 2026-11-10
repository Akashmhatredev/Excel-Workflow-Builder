import Wizard from "@/components/Wizard";

// The root layout's title template appends the product name.
export const metadata = {
  title: "Workflow",
  description: "Upload a spreadsheet, map its columns, define the outputs and export them. Nothing leaves your browser.",
};

// Wizard page (owner: Agent E).
export default function WorkflowPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Wizard />
    </main>
  );
}
