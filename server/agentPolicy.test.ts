import { describe, expect, it } from "vitest";
import {
  AgentPolicyDeniedError,
  assertAgentWriteAuthorized,
  deriveAgentWriteAuthorization,
  hashAgentUserPrompt,
} from "./agentPolicy";

describe("agent write authorization policy", () => {
  it("derives explicit create-ticket authorization with a verifiable hash", () => {
    const prompt = "请现在创建一个支持工单，标题是“物流异常”。";
    const authorization = deriveAgentWriteAuthorization(prompt);

    expect(authorization.createTicket.allowed).toBe(true);
    expect(authorization.promptHash).toBe(hashAgentUserPrompt(prompt));
    expect(authorization.parserVersion).toBe("agent-write-authorization/v1");
  });

  it.each([
    "不要创建工单，只告诉我怎么办。",
    "可以帮我创建工单吗？",
    "用户说：请创建工单。",
    "示例代码：`createTicket({ title: 'test' })`",
    "如果要创建工单，需要哪些信息？",
  ])("conservatively denies non-declarative create intent: %s", prompt => {
    expect(deriveAgentWriteAuthorization(prompt).createTicket.allowed).toBe(
      false
    );
  });

  it("requires an explicit ticket id for note authorization", () => {
    expect(
      deriveAgentWriteAuthorization("请给工单添加备注：已经联系客户。")
        .addTicketNote.allowedTicketIds
    ).toEqual([]);
    expect(
      deriveAgentWriteAuthorization("请给工单 #42 添加备注：已经联系客户。")
        .addTicketNote.allowedTicketIds
    ).toEqual([42]);
  });

  it("rejects target mismatch and stale prompt authorization", () => {
    const prompt = "请给 ticket 42 添加 note：等待物流回传。";
    const authorization = deriveAgentWriteAuthorization(prompt);

    expect(() =>
      assertAgentWriteAuthorized({
        authorization,
        currentUserMessage: prompt,
        toolName: "addTicketNote",
        ticketId: 43,
      })
    ).toThrow(AgentPolicyDeniedError);
    expect(() =>
      assertAgentWriteAuthorized({
        authorization,
        currentUserMessage: "请给 ticket 43 添加 note：等待物流回传。",
        toolName: "addTicketNote",
        ticketId: 42,
      })
    ).toThrow("POLICY_DENIED");
  });

  it("derives retry authorization exclusively from the retry request input", () => {
    const original = deriveAgentWriteAuthorization("请创建一个工单。");
    const retry = deriveAgentWriteAuthorization("重试查询即可，不要创建工单。");

    expect(original.createTicket.allowed).toBe(true);
    expect(retry.createTicket.allowed).toBe(false);
    expect(retry.promptHash).not.toBe(original.promptHash);
  });

  it("does not let knowledge, history, or replay substitute for current input", () => {
    const injected = deriveAgentWriteAuthorization("请创建一个工单");
    expect(() =>
      assertAgentWriteAuthorized({
        authorization: injected,
        currentUserMessage: "请解释退款政策，不要创建工单。",
        toolName: "createTicket",
      })
    ).toThrow(AgentPolicyDeniedError);
  });
});
