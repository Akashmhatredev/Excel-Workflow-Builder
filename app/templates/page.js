"use client";

import TemplateCard from "@/components/TemplateCard";
import { useTemplateStore } from "@/store/useTemplateStore";

// Templates page (owner: Agent D). Minimal version.
export default function TemplatesPage() {
  const templates = useTemplateStore((state) => state.templates);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Templates</h1>
      {templates.map((template) => (
        <TemplateCard key={template.id} template={template} />
      ))}
    </main>
  );
}
