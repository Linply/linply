import { describe, expect, it } from "vitest";
import { summarizeWorkerError } from "./workerError";

describe("summarizeWorkerError", () => {
  it("reports the database root cause without leaking the failed query", () => {
    const cause = Object.assign(
      new Error(
        'null value in column "workspaceId" of relation "knowledge_base" violates not-null constraint'
      ),
      { name: "PostgresError", code: "23502" }
    );
    const error = new Error(
      "Failed query: insert into knowledge_base values (...) params: private document text",
      { cause }
    );

    expect(summarizeWorkerError(error)).toEqual({
      name: "PostgresError",
      code: "23502",
      message:
        'null value in column "workspaceId" of relation "knowledge_base" violates not-null constraint',
    });
    expect(JSON.stringify(summarizeWorkerError(error))).not.toContain(
      "private document text"
    );
  });

  it("keeps parser errors actionable", () => {
    expect(
      summarizeWorkerError(new Error("CSV 缺少必需的表头列：title、content"))
    ).toEqual({
      name: "Error",
      message: "CSV 缺少必需的表头列：title、content",
    });
  });
});
