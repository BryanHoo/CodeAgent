import type { AgentQueuedSubmission } from "@/protocol/index.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { NativeMutationClient } from "../../projects/project-queries.js";
import { useComposerQueue } from "./use-composer-queue.js";

const queuedSubmission: AgentQueuedSubmission = {
  attachments: [
    {
      detail: "auto",
      id: "/attachments/guide.png",
      kind: "image",
      mediaType: "image/png",
      name: "guide.png",
      size: 128,
    },
    {
      id: "/attachments/context.txt",
      kind: "file",
      mediaType: "text/plain",
      name: "context.txt",
      size: 64,
    },
  ],
  clientUserMessageId: "message-a",
  id: "queue-a",
  skills: [],
  status: "queued",
  text: "检查引导信息",
};

test("withdraws the complete queued message into the composer before editing", async () => {
  let deleted = false;
  const deleteQueuedSubmission = vi.fn(async () => {
    deleted = true;
    return { deleted: true };
  });
  const updateQueuedSubmission = vi.fn(async () => ({ queuedSubmission }));
  const client = {
    deleteQueuedSubmission,
    getTaskAttachmentUrl: (_projectId: string, _taskId: string, attachmentId: string) =>
      `asset:${attachmentId}`,
    listQueuedSubmissions: vi.fn(async () => ({
      data: deleted ? [] : [queuedSubmission],
      nextCursor: null,
    })),
    updateQueuedSubmission,
  } as unknown as NativeMutationClient;
  const handleAttachmentsChange = vi.fn();
  const replacePromptContent = vi.fn();

  function Harness() {
    const queue = useComposerQueue({
      activeTurnId: "turn-a",
      client,
      handleAttachmentsChange,
      projectId: "project-a",
      replacePromptContent,
      routeScope: "project-a:task-a:/work",
      runtime: undefined,
      skillEditorRef: { current: null },
      skills: [],
      taskId: "task-a",
    });
    return queue.queuedPrompts.map((prompt) => (
      <button key={prompt.id} onClick={() => void queue.editQueuedPrompt(prompt)}>
        编辑排队消息
      </button>
    ));
  }

  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "编辑排队消息" }).click();

  await vi.waitFor(() => {
    expect(deleteQueuedSubmission).toHaveBeenCalledWith(
      "project-a",
      "task-a",
      "queue-a",
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(handleAttachmentsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "/attachments/guide.png", source: "host" }),
      expect.objectContaining({ id: "/attachments/context.txt", source: "host" }),
    ]);
  });
  expect(replacePromptContent).toHaveBeenCalled();
  expect(updateQueuedSubmission).not.toHaveBeenCalled();
});
