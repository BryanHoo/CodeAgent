export type Project = Readonly<{
  createdAt: string;
  id: string;
  name: string;
}>;

export type AgentTask = Readonly<{
  id: string;
  pinned: boolean;
  projectId: string;
  title: string;
  updatedAt: string;
}>;

// Web 只获得可导航的项目信息，本地绝对路径始终留在 Server 边界内。
export const ProjectSchema = {
  additionalProperties: false,
  properties: {
    createdAt: { format: "date-time", type: "string" },
    id: { minLength: 1, type: "string" },
    name: { minLength: 1, type: "string" },
  },
  required: ["id", "name", "createdAt"],
  type: "object",
} as const;

export const AgentTaskSchema = {
  additionalProperties: false,
  properties: {
    id: { minLength: 1, type: "string" },
    pinned: { type: "boolean" },
    projectId: { minLength: 1, type: "string" },
    title: { minLength: 1, type: "string" },
    updatedAt: { format: "date-time", type: "string" },
  },
  required: ["id", "projectId", "title", "updatedAt", "pinned"],
  type: "object",
} as const;
