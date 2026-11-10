"use client";

import { Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { IconButton, Input } from "@/components/ui";
import { normalizeTags } from "@/lib/schema";

/** Limits applied by normalizeTags (lib/schema.js). */
export const MAX_TAGS = 12;
export const TAG_MAX_LENGTH = 30;

/**
 * Tag editor: a text box plus the chosen tags as removable chips.
 *   { id, "aria-describedby", value: string[], onChange(next: string[]), suggestions?: string[], label? }
 * Pass the Field render props (id, aria-describedby) straight through.
 * Enter or a comma adds what was typed (a pasted "a, b, c" adds three tags); leaving the box
 * adds it too, so a typed tag is never lost on Save. Tags go through normalizeTags: trimmed,
 * case-insensitively unique, at most 12 of 30 characters.
 */
export default function TagInput({ id, "aria-describedby": describedBy, value, onChange, suggestions = [], label = "Tags" }) {
  const listId = useId();
  const [draft, setDraft] = useState("");
  const tags = useMemo(() => normalizeTags(value), [value]);
  const full = tags.length >= MAX_TAGS;
  const options = useMemo(() => {
    const taken = new Set(tags.map((tag) => tag.toLowerCase()));
    return suggestions.filter((tag) => !taken.has(tag.toLowerCase()));
  }, [suggestions, tags]);

  const commit = (text = draft) => {
    const parts = String(text).split(",");
    const next = normalizeTags([...tags, ...parts]);
    setDraft("");
    if (next.length !== tags.length || next.some((tag, index) => tag !== tags[index])) onChange(next);
  };

  const remove = (tag) => onChange(tags.filter((item) => item !== tag));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          aria-describedby={describedBy}
          value={draft}
          list={options.length ? listId : undefined}
          maxLength={TAG_MAX_LENGTH * 4}
          autoComplete="off"
          disabled={full}
          placeholder={full ? `${MAX_TAGS} tags is the most` : "Type a tag, then press Enter"}
          onChange={(event) => {
            const text = event.target.value;
            if (text.includes(",")) commit(text);
            else setDraft(text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault(); // never submit the surrounding form
              if (draft.trim()) commit();
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit();
          }}
        />
        <IconButton
          label="Add tag"
          icon={Plus}
          variant="secondary"
          disabled={full || !draft.trim()}
          onClick={() => commit()}
        />
        {options.length ? (
          <datalist id={listId}>
            {options.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        ) : null}
      </div>
      {tags.length ? (
        <ul aria-label={`${label} added`} className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag} className="inline-flex h-8 items-center rounded-md bg-brand-soft pl-2.5 text-sm text-brand-soft-fg">
              <span className="max-w-[14rem] truncate">{tag}</span>
              <IconButton label={`Remove tag ${tag}`} icon={X} size="sm" variant="soft" className="tap-target" onClick={() => remove(tag)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
