export type Project = Readonly<{
  createdAt: string;
  id: string;
  name: string;
  rootPath: string;
}>;

export type AgentTask = Readonly<{
  id: string;
  pinned: boolean;
  projectId: string;
  title: string;
  updatedAt: string;
}>;

// 本地 Runtime 校验根路径后将其作为项目上下文返回，供工作台明确展示当前目录。
export const ProjectSchema = {
  additionalProperties: false,
  properties: {
    createdAt: { format: "date-time", type: "string" },
    id: { minLength: 1, type: "string" },
    name: { minLength: 1, type: "string" },
    rootPath: { minLength: 1, type: "string" },
  },
  required: ["id", "name", "rootPath", "createdAt"],
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
