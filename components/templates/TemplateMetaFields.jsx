"use client";

import { useId, useMemo } from "react";
import TagInput, { MAX_TAGS } from "@/components/templates/TagInput";
import { Field, Input } from "@/components/ui";
import { templateFolders, templateTags } from "@/lib/templates";
import { useTemplateStore } from "@/store/useTemplateStore";

export const FOLDER_MAX_LENGTH = 40;

/**
 * The "Tags" and "Folder" fields of the Save-as-template and Edit-details dialogs.
 *   { tags: string[], onTagsChange(next), folder: string, onFolderChange(next) }
 * Suggests the tags and folders the saved templates already use, so spellings stay consistent.
 */
export default function TemplateMetaFields({ tags, onTagsChange, folder, onFolderChange }) {
  const folderListId = useId();
  const templates = useTemplateStore((state) => state.templates);
  const tagSuggestions = useMemo(() => templateTags(templates).map((entry) => entry.tag), [templates]);
  const folderSuggestions = useMemo(() => templateFolders(templates), [templates]);

  return (
    <>
      <Field label="Tags" hint={`Optional. Press Enter or type a comma to add a tag (up to ${MAX_TAGS}). Tags filter the Templates page.`}>
        {(props) => <TagInput {...props} value={tags} onChange={onTagsChange} suggestions={tagSuggestions} />}
      </Field>

      <Field label="Folder" hint="Optional. Templates in the same folder are grouped together on the Templates page.">
        {(props) => (
          <>
            <Input
              {...props}
              value={folder}
              list={folderSuggestions.length ? folderListId : undefined}
              maxLength={FOLDER_MAX_LENGTH}
              autoComplete="off"
              placeholder="For example: Finance"
              onChange={(event) => onFolderChange(event.target.value)}
            />
            {folderSuggestions.length ? (
              <datalist id={folderListId}>
                {folderSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            ) : null}
          </>
        )}
      </Field>
    </>
  );
}
