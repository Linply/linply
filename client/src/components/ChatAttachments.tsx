import { FileText, Paperclip, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { MessageAttachment } from "@shared/attachments";

/**
 * Attachments never travel through our API: the browser asks the server to sign
 * an upload, PUTs the bytes straight to object storage, and the message carries
 * only the resulting key.
 */

export type PendingAttachment = MessageAttachment & {
  /** Local object URL for the thumbnail, revoked once the chip goes away. */
  previewUrl?: string;
};

/**
 * Downscales before upload when the workspace asked for it. The server enforces
 * the same ceiling, but doing it here means a 12MB phone screenshot never
 * crosses the network in the first place.
 */
const downscaleImage = async (file: File, maxDimension: number) => {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const longestEdge = Math.max(bitmap.width, bitmap.height);
  if (longestEdge <= maxDimension) {
    bitmap.close();
    return file;
  }

  const scale = maxDimension / longestEdge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
    type: "image/jpeg",
  });
};

export const useChatAttachments = () => {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsQuery = trpc.chat.attachmentSettings.useQuery(undefined, {
    staleTime: 60_000,
  });
  const createUpload = trpc.chat.createAttachmentUpload.useMutation();

  const settings = settingsQuery.data;

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!settings?.enabled || files.length === 0) return;
      setIsUploading(true);
      setError(null);

      for (const original of files) {
        try {
          const file = settings.images.autoResize
            ? await downscaleImage(original, settings.images.maxDimension)
            : original;

          const signed = await createUpload.mutateAsync({
            fileName: file.name,
            mimeType: file.type,
            bytes: file.size,
          });

          const response = await fetch(signed.url, {
            method: "PUT",
            headers: { "content-type": file.type },
            body: file,
          });
          if (!response.ok) throw new Error("上传失败，请稍后重试");

          setAttachments(current => [
            ...current,
            {
              ...signed.attachment,
              bytes: file.size,
              mimeType: file.type,
              previewUrl: file.type.startsWith("image/")
                ? URL.createObjectURL(file)
                : undefined,
            },
          ]);
        } catch (uploadError) {
          setError(
            uploadError instanceof Error
              ? uploadError.message
              : "附件上传失败，请重试。"
          );
        }
      }

      setIsUploading(false);
    },
    [createUpload, settings]
  );

  const remove = useCallback((id: string) => {
    setAttachments(current => {
      const target = current.find(item => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter(item => item.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments(current => {
      for (const item of current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  }, []);

  const accept = settings
    ? [
        ...settings.images.allowedMimeTypes,
        ...settings.files.allowedMimeTypes,
      ].join(",")
    : "";

  return {
    attachments,
    addFiles,
    remove,
    clear,
    isUploading,
    error,
    accept,
    /** Storage may simply not be configured for this deployment. */
    enabled: Boolean(settings?.enabled),
  };
};

export const AttachmentButton = ({
  accept,
  disabled,
  isUploading,
  onSelect,
}: {
  accept: string;
  disabled?: boolean;
  isUploading: boolean;
  onSelect: (files: File[]) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={event => {
          onSelect(Array.from(event.target.files ?? []));
          // Reset so picking the same file twice still fires a change.
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled || isUploading}
        onClick={() => inputRef.current?.click()}
        className="absolute bottom-2.5 right-14 rounded-full"
        aria-label="添加图片或文件"
        title="添加图片或文件"
      >
        {isUploading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
      </Button>
    </>
  );
};

export const AttachmentTray = ({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) => {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className="group relative flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-1 pr-6"
        >
          {attachment.previewUrl ? (
            <img
              src={attachment.previewUrl}
              alt={attachment.fileName}
              className="h-10 w-10 rounded object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded bg-background">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          <span className="max-w-[10rem] truncate text-xs text-muted-foreground">
            {attachment.fileName}
          </span>
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="absolute right-1 top-1 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label={`移除 ${attachment.fileName}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
};

/** One stored attachment on a sent message, fetched through a signed URL. */
const StoredAttachment = ({
  attachment,
}: {
  attachment: MessageAttachment;
}) => {
  const preview = trpc.chat.attachmentPreviewUrl.useQuery(
    { storageKey: attachment.storageKey },
    { enabled: attachment.kind === "image", staleTime: 4 * 60_000 }
  );

  if (attachment.kind !== "image") {
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2 py-1 text-xs">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        {attachment.fileName}
      </span>
    );
  }

  return preview.data?.url ? (
    <a href={preview.data.url} target="_blank" rel="noreferrer">
      <img
        src={preview.data.url}
        alt={attachment.fileName}
        className="max-h-48 rounded-lg border border-border object-cover"
      />
    </a>
  ) : (
    <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-border">
      <Spinner className="h-4 w-4" />
    </span>
  );
};

export const MessageAttachments = ({
  attachments,
}: {
  attachments?: MessageAttachment[];
}) => {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map(attachment => (
        <StoredAttachment key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
};
