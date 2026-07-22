import { Folder, GitBranch, Paperclip, WifiOff } from "lucide-react";

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
  hasThread: boolean;
}>;

export function WorkbenchComposer({ hasThread }: WorkbenchComposerProps) {
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
            placeholder={hasThread ? "连接 Runtime 后继续任务" : "连接 Runtime 后创建任务"}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputButton aria-label="添加附件" disabled title="添加附件">
              <Paperclip className="size-3.5" aria-hidden="true" />
            </PromptInputButton>
            <PromptInputButton disabled>
              <Folder className="size-3.5" aria-hidden="true" />
              本地
            </PromptInputButton>
          </PromptInputTools>
          <div className="flex min-w-0 items-center gap-1">
            <PromptInputSelect aria-label="选择模型" defaultValue="gpt-5.6-sol" disabled>
              <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
            </PromptInputSelect>
            <PromptInputSubmit aria-label="提交" disabled status="ready" />
          </div>
        </PromptInputFooter>
      </PromptInput>
      <div className="mx-auto mt-1.5 flex w-full max-w-content items-center gap-3 px-1 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-3" aria-hidden="true" /> main
        </span>
        <span className="inline-flex items-center gap-1">
          <WifiOff className="size-3" aria-hidden="true" /> This Mac
        </span>
      </div>
    </section>
  );
}
