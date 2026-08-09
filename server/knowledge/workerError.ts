const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_CAUSE_DEPTH = 8;

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
};

const isErrorLike = (value: unknown): value is ErrorLike =>
  typeof value === "object" && value !== null;

const truncate = (value: string) =>
  value.length <= MAX_ERROR_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`;

/** Keeps worker logs useful without serializing SQL parameters or document text. */
export function summarizeWorkerError(error: unknown) {
  let current = error;
  let deepest = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!isErrorLike(current) || current.cause === undefined) break;
    deepest = current.cause;
    current = current.cause;
  }

  const source = isErrorLike(deepest) ? deepest : null;
  const message =
    typeof source?.message === "string"
      ? source.message
      : error instanceof Error
        ? error.message
        : String(error);
  const name =
    typeof source?.name === "string"
      ? source.name
      : error instanceof Error
        ? error.name
        : "Error";
  const code =
    typeof source?.code === "string" || typeof source?.code === "number"
      ? String(source.code)
      : undefined;

  return {
    name,
    message: truncate(message),
    ...(code ? { code } : {}),
  };
}
