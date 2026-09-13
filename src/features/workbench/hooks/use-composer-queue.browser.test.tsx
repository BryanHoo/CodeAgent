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

test("reuses the queue start key after a lost response", async () => {
  const onError = vi.fn();
  const startQueuedSubmission = vi.fn()
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValue({ taskId:"task-a", turn:{ id:"turn-a" } });
  const client = {
    getTaskAttachmentUrl: () => "asset:attachment",
    listQueuedSubmissions: async () => ({ data:[queuedSubmission] }),
    startQueuedSubmission,
  } as unknown as NativeMutationClient;
  function Harness() {
    const queue = useComposerQueue({ activeTurnId:undefined, client,
      handleAttachmentsChange:vi.fn(), projectId:"project-a", replacePromptContent:vi.fn(),
      routeScope:"project-a:task-a", runtime:undefined, skillEditorRef:{current:null}, skills:[], taskId:"task-a" });
    return queue.queuedPrompts.map((prompt) => <button key={prompt.id}
      onClick={() => void queue.sendQueuedPrompt(prompt, async () => false).catch(onError)}>启动排队消息</button>);
  }
  const screen = await render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>);
  await screen.getByRole("button", {name:"启动排队消息"}).click();
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  await screen.getByRole("button", {name:"启动排队消息"}).click();
  await vi.waitFor(() => expect(startQueuedSubmission).toHaveBeenCalledTimes(2));
  expect(startQueuedSubmission.mock.calls[0]).toEqual(startQueuedSubmission.mock.calls[1]);
  expect(startQueuedSubmission.mock.calls[0]?.[3]).toEqual({idempotencyKey:expect.any(String)});
});

test.each(["moved", "unchanged", "failed"])("sends a move intent and refreshes stale cache after %s", async (outcome) => {
  let attempted = false;
  const error = new Error("queue changed");
  const onError = vi.fn();
  const moveQueuedSubmission = vi.fn(async () => {
    attempted = true;
    if (outcome === "failed") throw error;
    return { moved: outcome === "moved" };
  });
  const listQueuedSubmissions = vi.fn(async () => ({
    data: attempted ? [] : [queuedSubmission],
  }));
  const client = {
    getTaskAttachmentUrl: () => "asset:attachment",
    listQueuedSubmissions,
    moveQueuedSubmission,
  } as unknown as NativeMutationClient;
  function Harness() {
    const queue = useComposerQueue({
      activeTurnId: undefined,
      client,
      handleAttachmentsChange: vi.fn(),
      projectId: "project-a",
      replacePromptContent: vi.fn(),
      routeScope: "project-a:task-a:/work",
      runtime: undefined,
      skillEditorRef: { current: null },
      skills: [],
      taskId: "task-a",
    });
    return queue.queuedPrompts.map((prompt) => (
      <button key={prompt.id} onClick={() => void queue.moveQueuedPrompt(prompt.id, -1).catch(onError)}>
        移动排队消息
      </button>
    ));
  }
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "移动排队消息" }).click();
  await vi.waitFor(() => expect(moveQueuedSubmission).toHaveBeenCalledWith(
    "project-a", "task-a", "queue-a", -1,
  ));
  await vi.waitFor(() => expect(listQueuedSubmissions).toHaveBeenCalledTimes(2));
  expect(listQueuedSubmissions).toHaveBeenNthCalledWith(1, "project-a", "task-a", { signal: expect.any(AbortSignal) });
  await vi.waitFor(() => expect(onError.mock.calls).toEqual(outcome === "failed" ? [[error]] : []));
});

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
