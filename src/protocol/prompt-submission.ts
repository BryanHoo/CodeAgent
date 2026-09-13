import { Type, type Static } from "@sinclair/typebox";
import { AgentTaskSchema } from "./agent-attachments.js";
import { AgentPromptInputSchema } from "./agent-task.js";
import { AgentTurnOptionsSchema } from "./project-settings.js";
import { StartAgentTurnResponseSchema } from "./agent-actions.js";

const KeySchema = Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" });
export const SubmitPromptRequestSchema = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 1024 }),
  taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  input: AgentPromptInputSchema,
  turnOptions: AgentTurnOptionsSchema,
  idempotencyKeys: Type.Object({ startTask: Type.Optional(KeySchema), startTurn: KeySchema }, { additionalProperties: false }),
}, { additionalProperties: false });
export type SubmitPromptRequest = Readonly<Static<typeof SubmitPromptRequestSchema>>;

export const SubmitPromptResponseSchema = Type.Object({
  createdTask: Type.Union([AgentTaskSchema, Type.Null()]),
  outcome: Type.Union([
    Type.Object({ type: Type.Literal("started"), result: StartAgentTurnResponseSchema }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal("failed"), error: Type.Unknown() }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false });
export type SubmitPromptResponse = Readonly<Static<typeof SubmitPromptResponseSchema>>;
