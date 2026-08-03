export type ProjectFileReferenceKind = "image" | "source" | "system";

const IMAGE_PREVIEW_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "webp"]);

const SYSTEM_OPEN_EXTENSIONS = new Set([
  "7z",
  "avi",
  "dmg",
  "doc",
  "docm",
  "docx",
  "exe",
  "gz",
  "key",
  "mov",
  "mp3",
  "mp4",
  "numbers",
  "odp",
  "ods",
  "odt",
  "pages",
  "pdf",
  "pkg",
  "ppt",
  "pptm",
  "pptx",
  "rar",
  "tar",
  "tgz",
  "wav",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "zip",
]);

export function classifyProjectFileReference(path: string): ProjectFileReferenceKind {
  const fileName = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  const extension = fileName.includes(".") ? (fileName.split(".").at(-1) ?? "") : "";
  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (SYSTEM_OPEN_EXTENSIONS.has(extension)) {
    return "system";
  }
  // 未知文本格式仍交给受控源文件读取，Server 会拒绝二进制内容。
  return "source";
}
