import { Type, type Static } from "@sinclair/typebox";

export const TrayTaskUpdateSchema = Type.Object(
  {
    isRunning: Type.Boolean(),
    projectId: Type.String({ maxLength: 128, minLength: 1 }),
    taskId: Type.String({ maxLength: 128, minLength: 1 }),
    taskName: Type.String({ maxLength: 512, minLength: 1 }),
  },
  { additionalProperties: false },
);

export type TrayTaskUpdate = Readonly<Static<typeof TrayTaskUpdateSchema>>;
