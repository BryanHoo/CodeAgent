export type AgentItemView =
  | TextItemView
  | ReasoningItemView
  | ToolItemView
  | CommandItemView
  | DiffItemView
  | ApprovalItemView
  | ErrorItemView;

type ItemBase = {
  id: string;
  threadId: string;
  createdAt: string;
};

export type TextItemView = ItemBase & {
  type: "text";
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
};

export type ReasoningItemView = ItemBase & {
  type: "reasoning";
  summary: string;
  streaming: boolean;
};

export type ToolItemView = ItemBase & {
  type: "tool";
  name: string;
  status: "pending" | "running" | "completed" | "failed";
};

export type CommandItemView = ItemBase & {
  type: "command";
  command: string;
  output: string;
  status: "running" | "completed" | "failed";
};

export type DiffItemView = ItemBase & {
  type: "diff";
  path: string;
  patch: string;
};

export type ApprovalItemView = ItemBase & {
  type: "approval";
  requestId: string;
  title: string;
  status: "pending" | "accepted" | "declined" | "expired";
};

export type ErrorItemView = ItemBase & {
  type: "error";
  message: string;
  recoverable: boolean;
};
