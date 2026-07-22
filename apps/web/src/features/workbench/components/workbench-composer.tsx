import { Folder, GitBranch, Paperclip } from "lucide-react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../../../shared/ai-elements/prompt-input.js";

type WorkbenchComposerProps = Readonly<{
  hasTask: boolean;
  projectPath: string;
}>;

export function WorkbenchComposer({ hasTask, projectPath }: WorkbenchComposerProps) {
  return (
    <section className="shrink-0 bg-content px-3 pb-2 sm:px-5" aria-label="Composer">
      <PromptInput
        className="mx-auto w-full max-w-content"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="任务输入"
            disabled
            placeholder={hasTask ? "连接 Runtime 后继续任务" : "连接 Runtime 后创建任务"}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputButton aria-label="添加附件" disabled title="添加附件">
              <Paperclip className="size-3.5" aria-hidden="true" />
            </PromptInputButton>
            <PromptInputSelect aria-label="批准模式" defaultValue="on-request" disabled>
              <option value="on-request">请求批准</option>
            </PromptInputSelect>
          </PromptInputTools>
          <div className="flex min-w-0 items-center gap-1">
            <PromptInputSelect aria-label="选择模型" defaultValue="gpt-5.6-sol" disabled>
              <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
            </PromptInputSelect>
            <PromptInputSubmit aria-label="提交" disabled status="ready" />
          </div>
        </PromptInputFooter>
      </PromptInput>
      <div className="mx-auto mt-1.5 flex w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
        <span className="inline-flex shrink-0 items-center gap-1">
          <GitBranch className="size-3" aria-hidden="true" /> main
        </span>
        <span
          aria-label="项目路径"
          className="inline-flex min-w-0 items-center gap-1"
          title={projectPath}
        >
          <Folder className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{projectPath}</span>
        </span>
      </div>
    </section>
  );
}
