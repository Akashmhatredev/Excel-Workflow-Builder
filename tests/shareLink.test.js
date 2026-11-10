import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefinition, createField, createOutput, createTemplate } from "@/lib/schema";
import {
  SHARE_PARAM,
  SHARE_URL_WARN_LENGTH,
  buildShareUrl,
  compressToUrl,
  createTemplateShareUrl,
  decompressFromUrl,
  hashWithoutSharePayload,
  readSharePayload,
  readSharedTemplate,
} from "@/lib/shareLink";

function sampleTemplate(overrides = {}) {
  return createTemplate({
    name: "Monthly sales",
    description: "Cleans the dump and adds a summary.",
    tags: ["Sales", "Monthly"],
    folder: "Finance",
    definition: createDefinition({
      fields: [
        createField({ name: "Customer", source: { kind: "column", column: "Cust Name" } }),
        createField({ name: "Total", source: { kind: "formula", expression: "{Qty} * {Price}" } }),
      ],
      outputs: [createOutput({ name: "Detail" }), createOutput({ name: "Summary", fileType: "csv" })],
    }),
    ...overrides,
  });
}

describe("share links: payloads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips text through the compressed form", async () => {
    const text = JSON.stringify({ name: "Ünïcode ✓ 日本", list: Array.from({ length: 300 }, (_, i) => `field ${i}`) });
    const payload = await compressToUrl(text);
    expect(payload.startsWith("c.")).toBe(true);
    expect(payload).toMatch(/^c\.[A-Za-z0-9_-]+$/);
    expect(await decompressFromUrl(payload)).toBe(text);
  });

  it("falls back to the uncompressed form when CompressionStream is missing", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const payload = await compressToUrl("héllo");
    expect(payload.startsWith("u.")).toBe(true);
    expect(await decompressFromUrl(payload)).toBe("héllo");
  });

  it("says so when a compressed link cannot be opened in this browser", async () => {
    const payload = await compressToUrl("hello");
    vi.stubGlobal("DecompressionStream", undefined);
    await expect(decompressFromUrl(payload)).rejects.toThrow(/cannot open compressed/);
  });

  it("tolerates a link that was wrapped or had punctuation glued to its end", async () => {
    const text = "a template";
    const payload = await compressToUrl(text);
    const wrapped = `${payload.slice(0, 5)}\n  ${payload.slice(5)}).`;
    expect(await decompressFromUrl(wrapped)).toBe(text);
  });

  it("rejects broken payloads with a readable message", async () => {
    await expect(decompressFromUrl("")).rejects.toThrow(/not valid/);
    await expect(decompressFromUrl("x.abc")).rejects.toThrow(/not valid/);
    await expect(decompressFromUrl("c.")).rejects.toThrow(/not valid/);
    await expect(decompressFromUrl("c.AAAA")).rejects.toThrow(/damaged/);
    const payload = await compressToUrl("x".repeat(5000));
    await expect(decompressFromUrl(payload.slice(0, Math.floor(payload.length / 2)))).rejects.toThrow(/damaged|incomplete/);
    await expect(decompressFromUrl("u.__-_")).rejects.toThrow(/damaged/);
  });

  it("refuses payloads that unpack to something huge", async () => {
    const payload = await compressToUrl("x".repeat(2_500_000));
    expect(payload.length).toBeLessThan(10_000);
    await expect(decompressFromUrl(payload)).rejects.toThrow(/too large/);
  });
});

describe("share links: URLs and hashes", () => {
  it("builds a /templates URL whatever the origin looks like", () => {
    expect(buildShareUrl("https://example.com", "c.abc")).toBe(`https://example.com/templates#${SHARE_PARAM}=c.abc`);
    expect(buildShareUrl("https://example.com///", "c.abc")).toBe("https://example.com/templates#template=c.abc");
    expect(buildShareUrl("http://localhost:3000", "u.x", "/elsewhere")).toBe("http://localhost:3000/elsewhere#template=u.x");
  });

  it("reads the payload from a hash", () => {
    expect(readSharePayload("#template=c.abc")).toBe("c.abc");
    expect(readSharePayload("template=c.abc")).toBe("c.abc");
    expect(readSharePayload("#x=1&template=c.abc&y=2")).toBe("c.abc");
    expect(readSharePayload("#template%3Dc.abc")).toBe("c.abc");
    expect(readSharePayload("#template=")).toBeNull();
    expect(readSharePayload("#templates=c.abc")).toBeNull();
    expect(readSharePayload("")).toBeNull();
    expect(readSharePayload(null)).toBeNull();
    expect(readSharePayload("#%E0%A4%A")).toBeNull(); // malformed escapes do not throw
  });

  it("removes only the payload from a hash", () => {
    expect(hashWithoutSharePayload("#template=c.abc")).toBe("");
    expect(hashWithoutSharePayload("#x=1&template=c.abc")).toBe("#x=1");
    expect(hashWithoutSharePayload("#column-aliases")).toBe("#column-aliases");
    expect(hashWithoutSharePayload("")).toBe("");
  });
});

describe("share links: templates", () => {
  it("shares a template and reads it back with its tags, folder, fields and outputs", async () => {
    const template = sampleTemplate();
    const { url, length, tooLong } = await createTemplateShareUrl(template, "https://app.example/");
    expect(url.startsWith("https://app.example/templates#template=c.")).toBe(true);
    expect(length).toBe(url.length);
    expect(tooLong).toBe(false);

    const parsed = await readSharedTemplate(readSharePayload(new URL(url).hash));
    expect(parsed.ok).toBe(true);
    expect(parsed.templates).toHaveLength(1);
    const [shared] = parsed.templates;
    expect(shared).toMatchObject({ name: "Monthly sales", tags: ["Sales", "Monthly"], folder: "Finance" });
    expect(shared.definition.fields.map((field) => field.name)).toEqual(["Customer", "Total"]);
    expect(shared.definition.outputs.map((output) => output.name)).toEqual(["Detail", "Summary"]);
    expect(shared.definition).toEqual(template.definition);
  });

  it("flags links that are too long for chat apps", async () => {
    // a long description of random-looking text does not compress well
    let seed = 7;
    const noise = Array.from({ length: 9000 }, () => {
      seed = (seed * 48271) % 2147483647;
      return String.fromCharCode(33 + (seed % 90));
    }).join("");
    const template = sampleTemplate();
    template.definition.fields[0].name = noise;
    const { tooLong, length } = await createTemplateShareUrl(template, "https://app.example");
    expect(length).toBeGreaterThan(SHARE_URL_WARN_LENGTH);
    expect(tooLong).toBe(true);
  });

  it("explains what is wrong with a broken or foreign link instead of throwing", async () => {
    expect(await readSharedTemplate("nope")).toEqual({ ok: false, errors: ["This share link is not valid."] });
    expect((await readSharedTemplate("c.AAAA")).ok).toBe(false);
    const notTemplate = await readSharedTemplate(await compressToUrl(JSON.stringify({ app: "other-app", kind: "template", template: {} })));
    expect(notTemplate.ok).toBe(false);
    expect(notTemplate.errors.join(" ")).toMatch(/not made by Excel Workflow Builder/);
    const notJson = await readSharedTemplate(await compressToUrl("hello"));
    expect(notJson.ok).toBe(false);
    expect(notJson.errors[0]).toMatch(/not valid JSON/);
  });
});
