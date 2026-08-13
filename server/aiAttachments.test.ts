import { describe, expect, it } from "vitest";

import { DEFAULT_AI_SETTINGS, mergeAiSettings } from "../shared/aiSettings";
import {
  kindForMimeType,
  type MessageAttachment,
  parseMessageAttachments,
  partitionAttachments,
} from "../shared/attachments";

const attachment = (
  overrides: Partial<MessageAttachment> = {}
): MessageAttachment => ({
  id: "att-1",
  kind: "image",
  storageKey: "chat-attachments/3/abc/shot.png",
  mimeType: "image/png",
  fileName: "shot.png",
  bytes: 1_024,
  ...overrides,
});

describe("attachment classification", () => {
  it("classifies by mime type rather than by file extension", () => {
    expect(kindForMimeType("image/PNG")).toBe("image");
    expect(kindForMimeType("application/pdf")).toBe("file");
  });
});

describe("attachment limits", () => {
  it("accepts an attachment that satisfies the settings", () => {
    const { accepted, rejected } = partitionAttachments(
      [attachment()],
      DEFAULT_AI_SETTINGS
    );

    expect(accepted).toHaveLength(1);
    expect(rejected).toEqual([]);
  });

  it("drops every image when the kill switch is on", () => {
    const settings = mergeAiSettings(DEFAULT_AI_SETTINGS, {
      images: { blockImages: true },
    });
    const { accepted, rejected } = partitionAttachments(
      [attachment()],
      settings
    );

    expect(accepted).toEqual([]);
    expect(rejected[0]?.reason).toBe("blocked");
  });

  it("rejects a mime type the settings do not allow", () => {
    const { accepted, rejected } = partitionAttachments(
      [attachment({ mimeType: "image/svg+xml", fileName: "logo.svg" })],
      DEFAULT_AI_SETTINGS
    );

    expect(accepted).toEqual([]);
    expect(rejected[0]?.reason).toBe("mime_type");
    expect(rejected[0]?.message).toContain("logo.svg");
  });

  it("rejects an attachment above the size ceiling", () => {
    const { accepted, rejected } = partitionAttachments(
      [attachment({ bytes: DEFAULT_AI_SETTINGS.images.maxBytes + 1 })],
      DEFAULT_AI_SETTINGS
    );

    expect(accepted).toEqual([]);
    expect(rejected[0]?.reason).toBe("too_large");
  });

  it("keeps the first N images and reports the rest", () => {
    const settings = mergeAiSettings(DEFAULT_AI_SETTINGS, {
      images: { maxPerMessage: 2 },
    });
    const { accepted, rejected } = partitionAttachments(
      [
        attachment({ id: "a", fileName: "1.png" }),
        attachment({ id: "b", fileName: "2.png" }),
        attachment({ id: "c", fileName: "3.png" }),
      ],
      settings
    );

    expect(accepted.map(item => item.fileName)).toEqual(["1.png", "2.png"]);
    expect(rejected[0]?.reason).toBe("too_many");
    expect(rejected[0]?.message).toContain("3.png");
  });

  it("counts images and files against their own limits", () => {
    const settings = mergeAiSettings(DEFAULT_AI_SETTINGS, {
      images: { maxPerMessage: 1 },
      files: { maxPerMessage: 1 },
    });
    const { accepted, rejected } = partitionAttachments(
      [
        attachment({ id: "a", fileName: "1.png" }),
        attachment({
          id: "b",
          kind: "file",
          mimeType: "application/pdf",
          fileName: "order.pdf",
        }),
      ],
      settings
    );

    expect(accepted).toHaveLength(2);
    expect(rejected).toEqual([]);
  });
});

describe("attachment parsing", () => {
  it("drops values that do not match the stored shape", () => {
    expect(parseMessageAttachments(undefined)).toEqual([]);
    expect(parseMessageAttachments([{ id: "x" }])).toEqual([]);
    expect(parseMessageAttachments([attachment()])).toHaveLength(1);
  });
});
