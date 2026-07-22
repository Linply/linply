const INLINE_CATEGORY_RE = /^\s*分类\s*[:：]\s*([^;；|\n]+?)(?:\s*[;；|]|\s*$)/m;

const CATEGORY_RULES = [
  { label: "售后政策", terms: ["售后", "退货", "退款", "换货", "维修", "质保", "无理由"] },
  { label: "物流履约", terms: ["物流", "发货", "配送", "快递", "揽收", "签收"] },
  { label: "订单交易", terms: ["订单", "付款", "支付", "交易", "下单", "收款"] },
  { label: "账户与隐私", terms: ["账户", "账号", "登录", "隐私", "个人信息", "授权"] },
  { label: "客服服务", terms: ["客服", "咨询", "服务规范", "工单", "人工介入"] },
  { label: "平台合规", terms: ["违禁", "禁售", "违规", "合规", "保证金", "监管"] },
  { label: "平台协议", terms: ["服务协议", "平台协议", "平台规则", "争议处理"] },
] as const;

/** Read an explicit `分类：...` metadata line from a Markdown section. */
export function extractKnowledgeCategory(content: string): string | null {
  const match = content.match(INLINE_CATEGORY_RE);
  const category = match?.[1]?.trim();
  return category ? category.slice(0, 100) : null;
}

/** Infer a short, reusable category when an import has no category metadata. */
export function inferKnowledgeCategory(
  title: string,
  content: string,
  fallback = "未分类"
): string {
  const searchable = `${title}\n${content}`.toLowerCase();
  let best: { label: string; score: number; order: number } | null = null;

  for (let order = 0; order < CATEGORY_RULES.length; order += 1) {
    const rule = CATEGORY_RULES[order];
    const score = rule.terms.reduce(
      (total, term) => total + (searchable.includes(term) ? 1 : 0),
      0
    );
    if (score > 0 && (!best || score > best.score || (score === best.score && order < best.order))) {
      best = { label: rule.label, score, order };
    }
  }

  return best?.label ?? fallback;
}

/** Prefer metadata, then an inferred category, while preserving an explicit fallback. */
export function resolveKnowledgeCategory(
  title: string,
  content: string,
  fallback = "未分类"
): string {
  return extractKnowledgeCategory(content) ?? inferKnowledgeCategory(title, content, fallback);
}
