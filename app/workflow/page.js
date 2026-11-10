import Wizard from "@/components/Wizard";

export const metadata = { title: "Workflow | Excel Workflow Builder" };

// Wizard page (owner: Agent E).
export default function WorkflowPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Wizard />
    </main>
  );
}
