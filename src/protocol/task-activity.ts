import { Type, type Static } from "@sinclair/typebox";

export const TaskActivitySnapshotSchema = Type.Object(
  {
    projectId: Type.String({ maxLength: 128, minLength: 1 }),
    rootPath: Type.Optional(Type.String({ maxLength: 4096, minLength: 1 })),
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("running"),
      Type.Literal("waiting"),
    ]),
    taskId: Type.String({ maxLength: 128, minLength: 1 }),
    taskName: Type.String({ maxLength: 512, minLength: 1 }),
  },
  { additionalProperties: false },
);

export type TaskActivitySnapshot = Readonly<Static<typeof TaskActivitySnapshotSchema>>;
