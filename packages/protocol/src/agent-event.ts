import { Type, type Static, type TProperties, type TSchema } from "@sinclair/typebox";

import {
  ActivePendingRequestSchema,
  AgentItemSchema,
  AgentTaskSnapshotSchema,
  AgentTurnSchema,
  ExpiredPendingRequestSchema,
  ResolvedPendingRequestSchema,
} from "./project.js";

const SessionIdSchema = Type.String({ minLength: 1 });
const SequenceSchema = Type.Integer({ minimum: 0 });
const DateTimeSchema = Type.String({ format: "date-time" });

const eventEnvelopeProperties = {
  provider: Type.String({ minLength: 1 }),
  sequence: SequenceSchema,
  sessionId: SessionIdSchema,
  taskId: Type.String({ minLength: 1 }),
  timestamp: DateTimeSchema,
  version: Type.Literal(1),
};

function createEventSchema<T extends TProperties>(properties: T) {
  return Type.Object(
    { ...eventEnvelopeProperties, ...properties },
    { additionalProperties: false },
  );
}

export const TurnStartedEventSchema = createEventSchema({
  payload: Type.Object({ turn: AgentTurnSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("turn.started"),
});

export const MessageDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ delta: Type.String() }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("message.delta"),
});

export const ReasoningDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object(
    {
      delta: Type.String(),
      field: Type.Union([Type.Literal("content"), Type.Literal("summary")]),
    },
    { additionalProperties: false },
  ),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("reasoning.delta"),
});

export const CommandOutputDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ delta: Type.String() }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("command.output_delta"),
});

export const ItemCompletedEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ item: AgentItemSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("item.completed"),
});

export const TurnCompletedEventSchema = createEventSchema({
  payload: Type.Object({ turn: AgentTurnSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("turn.completed"),
});

export const ProviderErrorEventSchema = createEventSchema({
  payload: Type.Object(
    { message: Type.String({ minLength: 1 }), willRetry: Type.Boolean() },
    { additionalProperties: false },
  ),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("provider.error"),
});

function createPendingRequestEventSchema<TType extends string, TRequestSchema extends TSchema>(
  type: TType,
  requestSchema: TRequestSchema,
) {
  return createEventSchema({
    itemId: Type.String({ minLength: 1 }),
    payload: Type.Object({ request: requestSchema }, { additionalProperties: false }),
    turnId: Type.String({ minLength: 1 }),
    type: Type.Literal(type),
  });
}

export const PendingRequestCreatedEventSchema = createPendingRequestEventSchema(
  "pending_request.created",
  ActivePendingRequestSchema,
);
export const PendingRequestResolvedEventSchema = createPendingRequestEventSchema(
  "pending_request.resolved",
  ResolvedPendingRequestSchema,
);
export const PendingRequestExpiredEventSchema = createPendingRequestEventSchema(
  "pending_request.expired",
  ExpiredPendingRequestSchema,
);

export const AgentEventSchema = Type.Union([
  TurnStartedEventSchema,
  MessageDeltaEventSchema,
  ReasoningDeltaEventSchema,
  CommandOutputDeltaEventSchema,
  ItemCompletedEventSchema,
  TurnCompletedEventSchema,
  ProviderErrorEventSchema,
  PendingRequestCreatedEventSchema,
  PendingRequestResolvedEventSchema,
  PendingRequestExpiredEventSchema,
]);

export type AgentEvent = Readonly<Static<typeof AgentEventSchema>>;

export const ConnectionReadySchema = Type.Object(
  {
    latestSequence: SequenceSchema,
    sessionId: SessionIdSchema,
    type: Type.Literal("connection.ready"),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type ConnectionReady = Readonly<Static<typeof ConnectionReadySchema>>;

export const ResyncRequiredSchema = Type.Object(
  {
    latestSequence: SequenceSchema,
    reason: Type.Union([
      Type.Literal("event_retention_exceeded"),
      Type.Literal("session_changed"),
      Type.Literal("sequence_gap"),
    ]),
    sessionId: SessionIdSchema,
    type: Type.Literal("resync.required"),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type ResyncRequired = Readonly<Static<typeof ResyncRequiredSchema>>;

export const EventStreamMessageSchema = Type.Union([
  ConnectionReadySchema,
  ResyncRequiredSchema,
  AgentEventSchema,
]);

export type EventStreamMessage = Readonly<Static<typeof EventStreamMessageSchema>>;

export const EventCheckpointSchema = Type.Object(
  { sequence: SequenceSchema, sessionId: SessionIdSchema },
  { additionalProperties: false },
);

export type EventCheckpoint = Readonly<Static<typeof EventCheckpointSchema>>;

export const AgentTaskSnapshotResponseSchema = Type.Object(
  {
    checkpoint: EventCheckpointSchema,
    snapshot: AgentTaskSnapshotSchema,
  },
  { additionalProperties: false },
);

export type AgentTaskSnapshotResponse = Readonly<Static<typeof AgentTaskSnapshotResponseSchema>>;
