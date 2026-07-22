import { describe, it, expect } from "vitest";
import { parseCsv, parseMarkdown } from "./parse";

describe("parseCsv", () => {
  it("maps columns by header and parses simple rows", () => {
    const csv = [
      "title,content,category,keywords",
      "退货政策,7天无理由退货,政策,退货|退款",
      "保修范围,主板保修2年,保修,",
    ].join("\n");

    const entries = parseCsv(csv);
    expect(entries).toEqual([
      { title: "退货政策", content: "7天无理由退货", category: "政策", keywords: "退货|退款" },
      { title: "保修范围", content: "主板保修2年", category: "保修", keywords: undefined },
    ]);
  });

  it("handles quoted fields with commas, escaped quotes and embedded newlines", () => {
    const csv =
      'title,content,category,keywords\r\n' +
      '"配送, 时间","下单后,\n3-5天送达。含""加急""选项",物流,配送\r\n';

    const entries = parseCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("配送, 时间");
    expect(entries[0].content).toBe('下单后,\n3-5天送达。含"加急"选项');
    expect(entries[0].category).toBe("物流");
  });

  it("tolerates reordered columns and falls back to default category", () => {
    const csv = ["content,title", "内容A,标题A"].join("\n");
    const entries = parseCsv(csv, "默认类");
    expect(entries).toEqual([
      { title: "标题A", content: "内容A", category: "默认类", keywords: undefined },
    ]);
  });

  it("skips rows missing title or content", () => {
    const csv = [
      "title,content,category",
      "有标题无内容,,政策",
      ",有内容无标题,政策",
      "完整,内容,政策",
    ].join("\n");
    const entries = parseCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("完整");
  });

  it("returns empty for empty input or header-only file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("title,content,category")).toEqual([]);
  });

  it("throws when required headers are missing", () => {
    expect(() => parseCsv("name,body\na,b")).toThrow();
  });
});

describe("parseMarkdown", () => {
  it("splits by level 1-2 headings and keeps deeper headings in the body", () => {
    const md = [
      "导言文字。",
      "",
      "# 第一节",
      "第一节内容。",
      "### 子标题",
      "子内容。",
      "## 第二节",
      "第二节内容。",
    ].join("\n");

    const entries = parseMarkdown(md, { category: "手册" });
    expect(entries.map(e => e.title)).toEqual(["概述", "第一节", "第二节"]);
    expect(entries[0]).toMatchObject({ content: "导言文字。", category: "手册" });
    expect(entries[1].content).toContain("### 子标题");
    expect(entries[2].content).toBe("第二节内容。");
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = [
      "# 安装",
      "运行：",
      "```sh",
      "# 这是注释，不是标题",
      "npm install",
      "```",
      "完成。",
    ].join("\n");

    const entries = parseMarkdown(md, { category: "文档" });
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("安装");
    expect(entries[0].content).toContain("# 这是注释，不是标题");
  });

  it("uses each section's explicit category metadata", () => {
    const entries = parseMarkdown(
      "# 退货规则\n分类：售后政策；关键词：退货、退款\n正文。",
      { category: "文件名不应成为分类" }
    );

    expect(entries[0].category).toBe("售后政策");
  });

  it("drops sections with no body and returns empty for blank input", () => {
    const md = ["# 只有标题", "## 也只有标题"].join("\n");
    expect(parseMarkdown(md, { category: "x" })).toEqual([]);
    expect(parseMarkdown("", { category: "x" })).toEqual([]);
  });
});
