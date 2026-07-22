import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Trash2, Upload } from "lucide-react";
import type { KnowledgeDocumentStatus } from "@shared/knowledge";

const STATUS_META: Record<
  KnowledgeDocumentStatus,
  { label: string; className: string }
> = {
  pending: { label: "等待中", className: "border-gray-200 bg-gray-100 text-gray-600" },
  parsing: { label: "解析中", className: "border-amber-200 bg-amber-50 text-amber-700" },
  indexing: { label: "索引中", className: "border-sky-200 bg-sky-50 text-sky-700" },
  completed: { label: "已完成", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  failed: { label: "失败", className: "border-red-200 bg-red-50 text-red-700" },
};

function detectFileType(name: string): "markdown" | "csv" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return null;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

export default function KnowledgeDocuments() {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents, isLoading } = trpc.knowledge.listDocuments.useQuery(
    undefined,
    {
      refetchInterval: query => {
        const docs = query.state.data;
        const active = docs?.some(
          d => d.status === "parsing" || d.status === "indexing"
        );
        return active ? 1500 : false;
      },
    }
  );

  const uploadMutation = trpc.knowledge.uploadDocument.useMutation();
  const deleteMutation = trpc.knowledge.deleteDocument.useMutation();

  const resetForm = () => {
    setFile(null);
    setCategory("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file) return;
    const fileType = detectFileType(file.name);
    if (!fileType) {
      toast.error("仅支持 .md / .markdown / .csv 文件");
      return;
    }

    try {
      const content = await readFileAsText(file);
      if (!content.trim()) {
        toast.error("文件内容为空");
        return;
      }

      const result = await uploadMutation.mutateAsync({
        filename: file.name,
        fileType,
        content,
        category: category.trim() || undefined,
      });

      await utils.knowledge.listDocuments.invalidate();
      await utils.knowledge.list.invalidate();

      if (result.status === "failed") {
        toast.error("文档解析失败，请检查文件格式");
      } else if (!result.embeddingEnabled) {
        toast.success(
          `已解析 ${result.totalChunks} 条（嵌入服务未启用，使用关键词检索）`
        );
      } else {
        toast.success(`已解析 ${result.totalChunks} 条，正在构建索引…`);
      }

      setDialogOpen(false);
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败";
      toast.error(message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      await utils.knowledge.listDocuments.invalidate();
      await utils.knowledge.list.invalidate();
      toast.success("已删除文档及其知识条目");
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      toast.error(message);
    }
  };

  const renderDeleteButton = (doc: NonNullable<typeof documents>[number], total: number) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-gray-500 hover:text-red-600"
          aria-label={`删除文档 ${doc.filename}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除文档？</AlertDialogTitle>
          <AlertDialogDescription>
            将删除「{doc.filename}」及其生成的 {total} 条知识条目，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handleDelete(doc.id)}
            className="bg-red-600 hover:bg-red-700"
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <Card className="mb-6 gap-0">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <CardTitle className="text-sm">文档导入</CardTitle>
          <p className="mt-1 text-xs text-gray-500">
            上传 Markdown / CSV，自动解析为知识条目并构建向量索引
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={open => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Upload className="size-4" />
              上传文档
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>上传文档</DialogTitle>
              <DialogDescription>
                支持 .md / .markdown（按 # / ## 标题切分）与 .csv（表头：
                title, content, category, keywords）。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">文件</label>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.csv"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  分类（可选）
                </label>
                <Input
                  placeholder="可选：统一指定分类；留空则读取 Markdown 的分类字段或自动归纳"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                取消
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!file || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? "上传中…" : "开始上传"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : !documents || documents.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            暂无上传文档
          </p>
        ) : (
          <>
            <div className="divide-y divide-gray-100 md:hidden">
              {documents.map(doc => {
                const status = doc.status as KnowledgeDocumentStatus;
                const meta = STATUS_META[status] ?? STATUS_META.pending;
                const total = doc.totalChunks ?? 0;
                const embedded = doc.embeddedCount ?? 0;
                const failed = doc.failedCount ?? 0;
                const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
                return (
                  <div key={doc.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{doc.filename}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{doc.fileType === "csv" ? "CSV" : "MD"}</Badge>
                          <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                          <span className="text-xs text-gray-400">
                            {formatDistanceToNow(new Date(doc.createdAt), { locale: zhCN, addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      {renderDeleteButton(doc, total)}
                    </div>
                    {total > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        <Progress value={pct} className="h-1.5" />
                        <p className="text-xs text-gray-500">
                          已索引 {embedded} / {total}{failed > 0 ? `，失败 ${failed}` : ""}
                        </p>
                      </div>
                    ) : null}
                    {status === "failed" && doc.error ? (
                      <p className="mt-2 whitespace-pre-wrap text-xs text-red-600">{doc.error}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead className="w-20">类型</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-48">索引进度</TableHead>
                <TableHead className="w-28">上传时间</TableHead>
                <TableHead className="w-16 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map(doc => {
                const status = doc.status as KnowledgeDocumentStatus;
                const meta = STATUS_META[status] ?? STATUS_META.pending;
                const total = doc.totalChunks ?? 0;
                const embedded = doc.embeddedCount ?? 0;
                const failed = doc.failedCount ?? 0;
                const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium max-w-[16rem] truncate">
                      {doc.filename}
                      {status === "failed" && doc.error && (
                        <p className="text-xs text-red-500 mt-1 whitespace-pre-wrap">
                          {doc.error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {doc.fileType === "csv" ? "CSV" : "MD"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {total > 0 ? (
                        <div className="space-y-1">
                          <Progress value={pct} className="h-2" />
                          <p className="text-xs text-gray-500">
                            {embedded} / {total}
                            {failed > 0 ? `（失败 ${failed}）` : ""}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(doc.createdAt), {
                        locale: zhCN,
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      {renderDeleteButton(doc, total)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
