import type {
  PendingApprovalDecision,
  PendingRequest,
  ResolvePendingRequestRequest,
} from "@code-agent/protocol";
import { useState } from "react";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  type ConfirmationState,
} from "../../../shared/ai-elements/confirmation.js";

export type PendingRequestResolution = ResolvePendingRequestRequest["resolution"];

export type PendingRequestResolutionAttempt = Readonly<{
  fingerprint: string;
  key: string;
}>;

export function resolvePendingRequestAttempt(
  attempt: PendingRequestResolutionAttempt | undefined,
  resolution: PendingRequestResolution,
  createKey: () => string = () => globalThis.crypto.randomUUID(),
): PendingRequestResolutionAttempt {
  const fingerprint = JSON.stringify(resolution);
  return attempt?.fingerprint === fingerprint ? attempt : { fingerprint, key: createKey() };
}

type PendingRequestCardProps = Readonly<{
  interactive: boolean;
  onResolve: (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  request: PendingRequest;
}>;

type ApprovalRequest = Extract<
  PendingRequest,
  { type: "command_approval" | "file_change_approval" }
>;
type CommandApprovalRequest = Extract<PendingRequest, { type: "command_approval" }>;

function approvalState(request: PendingRequest, submitting: boolean): ConfirmationState {
  if (request.status === "expired") return "approval-expired";
  if (request.status === "resolved") return "approval-resolved";
  return submitting ? "approval-submitting" : "approval-requested";
}

function formatNetworkProtocol(
  protocol: NonNullable<CommandApprovalRequest["networkAccess"]>["protocol"],
) {
  switch (protocol) {
    case "http":
      return "HTTP";
    case "https":
      return "HTTPS";
    case "socks5Tcp":
      return "SOCKS5 TCP";
    case "socks5Udp":
      return "SOCKS5 UDP";
  }
}

function ApprovalRequestCard({
  interactive,
  onResolve,
  request,
}: Omit<PendingRequestCardProps, "request"> & { request: ApprovalRequest }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<PendingRequestResolutionAttempt>();
  const networkAccess = request.type === "command_approval" ? request.networkAccess : null;
  const title =
    networkAccess !== null
      ? "网络访问审批"
      : request.type === "command_approval"
        ? "命令审批"
        : "文件变更审批";
  const detail =
    networkAccess !== null
      ? `${formatNetworkProtocol(networkAccess.protocol)}\n${networkAccess.host}`
      : request.type === "command_approval"
        ? [request.command, request.cwd].filter(Boolean).join("\n")
        : (request.grantRoot ?? "待确认文件变更");
  const canSubmit = interactive && request.status === "pending" && !submitting;

  const resolve = async (decision: PendingApprovalDecision) => {
    if (!canSubmit) return;
    const resolution = { decision } as const;
    // 同一决策失败重试时保留原 Key，用户改选决策后才创建新 Key。
    const nextAttempt = resolvePendingRequestAttempt(attempt, resolution);
    setAttempt(nextAttempt);
    setSubmitting(true);
    setError(null);
    try {
      await onResolve(request, resolution, nextAttempt.key);
    } catch {
      setError("请求处理失败，请重试");
      setSubmitting(false);
    }
  };

  return (
    <Confirmation approval={{ id: request.requestId }} state={approvalState(request, submitting)}>
      <ConfirmationTitle>{title}</ConfirmationTitle>
      <ConfirmationRequest>
        <pre className="whitespace-pre-wrap font-mono text-meta">{detail}</pre>
        {request.reason === null ? null : (
          <p className="mt-2 text-label text-muted-foreground">{request.reason}</p>
        )}
      </ConfirmationRequest>
      {request.status === "expired" ? (
        <ConfirmationRejected>请求已过期</ConfirmationRejected>
      ) : request.status === "resolved" ? (
        <p className="mt-2 text-label text-muted-foreground">请求已处理</p>
      ) : (
        <>
          {!interactive ? (
            <p className="mt-2 text-label text-muted-foreground">等待处理前一项</p>
          ) : null}
          {error === null ? null : (
            <p className="mt-2 text-label text-danger" role="alert">
              {error}
            </p>
          )}
          <ConfirmationActions>
            {request.availableDecisions.includes("deny") ? (
              <ConfirmationAction disabled={!canSubmit} onClick={() => void resolve("deny")}>
                拒绝
              </ConfirmationAction>
            ) : null}
            {request.availableDecisions.includes("allow_for_session") ? (
              <ConfirmationAction
                disabled={!canSubmit}
                onClick={() => void resolve("allow_for_session")}
              >
                本次会话允许
              </ConfirmationAction>
            ) : null}
            {request.availableDecisions.includes("allow") ? (
              <ConfirmationAction
                className="bg-foreground text-raised hover:opacity-90"
                disabled={!canSubmit}
                onClick={() => void resolve("allow")}
              >
                允许
              </ConfirmationAction>
            ) : null}
          </ConfirmationActions>
        </>
      )}
    </Confirmation>
  );
}

type Answers = Record<string, string>;

function UserInputRequestCard({ interactive, onResolve, request }: PendingRequestCardProps) {
  if (request.type !== "user_input") return null;
  const [answers, setAnswers] = useState<Answers>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<PendingRequestResolutionAttempt>();
  const complete = request.questions.every(
    (question) => (answers[question.id] ?? "").trim() !== "",
  );
  const canSubmit = interactive && request.status === "pending" && complete && !submitting;
  const controlsDisabled = !interactive || submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const mappedAnswers = Object.fromEntries(
      request.questions.map((question) => [question.id, [(answers[question.id] ?? "").trim()]]),
    );
    const resolution = { answers: mappedAnswers };
    const nextAttempt = resolvePendingRequestAttempt(attempt, resolution);
    setAttempt(nextAttempt);
    try {
      await onResolve(request, resolution, nextAttempt.key);
    } catch {
      setError("回答提交失败，请重试");
      setSubmitting(false);
    }
  };

  if (request.status !== "pending") {
    return (
      <section className="w-full rounded-surface bg-control px-3.5 py-3 text-label text-muted-foreground">
        {request.status === "expired" ? "请求已过期" : "请求已处理"}
      </section>
    );
  }

  return (
    <form
      className="w-full rounded-surface bg-control px-3.5 py-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="text-label font-semibold text-foreground">需要你的输入</h3>
      <div className="mt-3 space-y-4">
        {request.questions.map((question) => (
          <fieldset key={question.id}>
            <legend className="text-body-small font-medium text-foreground">
              {question.prompt}
            </legend>
            <p className="mt-0.5 text-meta text-muted-foreground">{question.header}</p>
            {question.type === "choice" ? (
              <div className="mt-2 space-y-1.5">
                {question.options.map((option) => (
                  <label
                    className="flex cursor-pointer items-start gap-2 rounded-control bg-raised px-2.5 py-2 text-label"
                    key={option.label}
                  >
                    <input
                      checked={answers[question.id] === option.label}
                      disabled={controlsDisabled}
                      name={question.id}
                      onChange={() => {
                        setAnswers((value) => ({ ...value, [question.id]: option.label }));
                      }}
                      type="radio"
                      value={option.label}
                    />
                    <span>
                      <span className="block font-medium text-foreground">{option.label}</span>
                      <span className="block text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
                {question.isOther ? (
                  <input
                    aria-label={`${question.header}其他回答`}
                    className="h-8 w-full rounded-control bg-raised px-2.5 text-label text-foreground shadow-sm outline-none"
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      setAnswers((value) => ({ ...value, [question.id]: event.target.value }));
                    }}
                    placeholder="其他"
                    type="text"
                    value={
                      question.options.some((option) => option.label === answers[question.id])
                        ? ""
                        : (answers[question.id] ?? "")
                    }
                  />
                ) : null}
              </div>
            ) : question.type === "confirmation" ? (
              <div className="mt-2 grid grid-cols-2 rounded-control bg-raised p-0.5">
                {question.options.map((option) => (
                  <button
                    aria-pressed={answers[question.id] === option.label}
                    className="h-8 rounded-control text-label font-medium text-foreground aria-pressed:bg-foreground aria-pressed:text-raised"
                    disabled={controlsDisabled}
                    key={option.label}
                    onClick={() => {
                      setAnswers((value) => ({ ...value, [question.id]: option.label }));
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <input
                aria-label={question.prompt}
                className="mt-2 h-8 w-full rounded-control bg-raised px-2.5 text-label text-foreground shadow-sm outline-none"
                disabled={controlsDisabled}
                onChange={(event) => {
                  setAnswers((value) => ({ ...value, [question.id]: event.target.value }));
                }}
                type={question.isSecret ? "password" : "text"}
                value={answers[question.id] ?? ""}
              />
            )}
          </fieldset>
        ))}
      </div>
      {!interactive ? (
        <p className="mt-3 text-label text-muted-foreground">等待处理前一项</p>
      ) : null}
      {error === null ? null : (
        <p className="mt-3 text-label text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          className="h-8 rounded-control bg-foreground px-3 text-label font-medium text-raised disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canSubmit}
          type="submit"
        >
          提交回答
        </button>
      </div>
    </form>
  );
}

export function PendingRequestCard(props: PendingRequestCardProps) {
  if (props.request.type === "user_input") {
    return <UserInputRequestCard {...props} />;
  }
  return (
    <ApprovalRequestCard
      interactive={props.interactive}
      onResolve={props.onResolve}
      request={props.request}
    />
  );
}
