import { createHash } from "node:crypto";

export const AGENT_POLICY_PARSER_VERSION = "agent-write-authorization/v1";
export const AGENT_POLICY_DENIED_CODE = "agent_policy_denied";
export const AGENT_POLICY_DENIED_MESSAGE =
  "POLICY_DENIED: 当前用户请求未明确授权此写操作，未执行任何更改。";

export type AgentWriteAuthorization = {
  parserVersion: typeof AGENT_POLICY_PARSER_VERSION;
  promptHash: string;
  createTicket: { allowed: boolean };
  addTicketNote: { allowedTicketIds: number[] };
};

export class AgentPolicyDeniedError extends Error {
  readonly code = AGENT_POLICY_DENIED_CODE;
  readonly retryable = false;

  constructor() {
    super(AGENT_POLICY_DENIED_MESSAGE);
    this.name = "AgentPolicyDeniedError";
  }
}

export const hashAgentUserPrompt = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

const normalize = (content: string) => content.normalize("NFKC").trim();

const hasQuotedOrExampleContext = (content: string) =>
  /```|`[^`]+`|(?:例如|示例|假设|比如|转述|引用|他说|她说|用户说|客服说|example|quoted?|someone\s+said)/i.test(
    content
  );

const hasQuestionContext = (content: string) =>
  /[?？]|(?:能否|可以吗|可不可以|是否|怎么|如何|要不要|会不会|what\s+if|can\s+(?:you|i)|could\s+(?:you|i)|would\s+(?:you|i)|should\s+(?:you|i))/i.test(
    content
  );

const hasNegationContext = (content: string) =>
  /(?:不要|不用|无需|别|禁止|不允许|不需要|暂时不|先不|取消|撤销|并非|不是要|not\s+authorized|do\s+not|don't|dont|never|without\s+(?:creating|adding))/i.test(
    content
  );

const isDeclarativeAuthorization = (content: string) => {
  const value = normalize(content);
  return Boolean(value) &&
    !hasQuotedOrExampleContext(value) &&
    !hasQuestionContext(value) &&
    !hasNegationContext(value);
};

const hasCreateTicketDirective = (content: string) =>
  /(?:请|现在|立即|马上|帮我|同意|授权|确认)?\s*(?:创建|新建|提交|开|生成)(?:一个|一条|这张|该)?\s*(?:客服|支持)?工单|(?:please\s+)?(?:create|open|file|submit)\s+(?:a\s+)?(?:support\s+)?ticket/i.test(
    content
  );

const extractNoteTicketIds = (content: string) => {
  const ids = new Set<number>();
  const patterns = [
    /(?:工单|ticket)\s*(?:id|编号|#|号|：|:)?\s*#?\s*(\d+)/gi,
    /#(\d+)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
};

const hasAddNoteDirective = (content: string) =>
  /(?:请|现在|立即|马上|帮我|同意|授权|确认)?\s*(?:添加|新增|写入|补充|追加|记录)(?:一条|这个|该)?\s*(?:工单)?(?:备注|评论|留言|note)|(?:please\s+)?(?:add|append|write)\s+(?:a\s+)?(?:comment|note)\s+(?:to|on)/i.test(
    content
  );

export function deriveAgentWriteAuthorization(
  currentUserMessage: string
): AgentWriteAuthorization {
  const content = normalize(currentUserMessage);
  const declarative = isDeclarativeAuthorization(content);
  const allowedTicketIds =
    declarative && hasAddNoteDirective(content) ? extractNoteTicketIds(content) : [];

  return {
    parserVersion: AGENT_POLICY_PARSER_VERSION,
    promptHash: hashAgentUserPrompt(currentUserMessage),
    createTicket: {
      allowed: declarative && hasCreateTicketDirective(content),
    },
    addTicketNote: { allowedTicketIds },
  };
}

export function parseAgentWriteAuthorization(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<AgentWriteAuthorization>;
  if (
    data.parserVersion !== AGENT_POLICY_PARSER_VERSION ||
    typeof data.promptHash !== "string" ||
    typeof data.createTicket?.allowed !== "boolean" ||
    !Array.isArray(data.addTicketNote?.allowedTicketIds)
  ) {
    return null;
  }
  return data as AgentWriteAuthorization;
}

export function assertAgentWriteAuthorized(input: {
  authorization: AgentWriteAuthorization | null | undefined;
  currentUserMessage: string | undefined;
  toolName: "createTicket" | "addTicketNote";
  ticketId?: number;
}) {
  const authorization = input.authorization;
  const hashMatches =
    typeof input.currentUserMessage === "string" &&
    authorization?.promptHash === hashAgentUserPrompt(input.currentUserMessage);
  const allowed =
    Boolean(hashMatches) &&
    (input.toolName === "createTicket"
      ? authorization?.createTicket.allowed === true
      : Number.isSafeInteger(input.ticketId) &&
        authorization?.addTicketNote.allowedTicketIds.includes(input.ticketId!) ===
          true);

  if (!allowed) throw new AgentPolicyDeniedError();
}
