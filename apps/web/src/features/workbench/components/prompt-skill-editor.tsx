import type { AgentSkill } from "@code-agent/protocol";
import { Box } from "lucide-react";
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import type { PromptSlashCommand } from "./prompt-command.js";
import { skillTokenClassName } from "./skill-token.js";

export type PromptSkillContentPart =
  Readonly<{ text: string; type: "text" }> | Readonly<{ skill: AgentSkill; type: "skill" }>;

export type PromptSkillContent = readonly PromptSkillContentPart[];

export type PromptSkillSubmission = Readonly<{
  skills: readonly AgentSkill[];
  text: string;
}>;

export function createPromptSkillContent(text = ""): PromptSkillContent {
  return text === "" ? [] : [{ text, type: "text" }];
}

function normalizePromptSkillContent(parts: readonly PromptSkillContentPart[]): PromptSkillContent {
  const normalized: PromptSkillContentPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text === "") {
        continue;
      }
      const previous = normalized.at(-1);
      if (previous?.type === "text") {
        normalized[normalized.length - 1] = {
          text: previous.text + part.text,
          type: "text",
        };
      } else {
        normalized.push(part);
      }
      continue;
    }
    normalized.push(part);
  }
  return normalized;
}

function skillPlainText(skill: Pick<AgentSkill, "name">): string {
  return `$${skill.name}`;
}

function partLength(part: PromptSkillContentPart): number {
  return part.type === "text" ? part.text.length : skillPlainText(part.skill).length;
}

function splitPromptSkillContent(
  content: PromptSkillContent,
  offset: number,
): readonly [PromptSkillContent, PromptSkillContent] {
  const before: PromptSkillContentPart[] = [];
  const after: PromptSkillContentPart[] = [];
  let position = 0;
  for (const part of content) {
    const length = partLength(part);
    const end = position + length;
    if (offset <= position) {
      after.push(part);
    } else if (offset >= end) {
      before.push(part);
    } else if (part.type === "text") {
      const localOffset = offset - position;
      before.push({ text: part.text.slice(0, localOffset), type: "text" });
      after.push({ text: part.text.slice(localOffset), type: "text" });
    } else {
      // Skill Token 不可编辑，选区落入其纯文本范围时按最接近的边界处理。
      (offset - position < length / 2 ? after : before).push(part);
    }
    position = end;
  }
  return [normalizePromptSkillContent(before), normalizePromptSkillContent(after)];
}

export function insertPromptSkill(
  content: PromptSkillContent,
  slashCommand: Pick<PromptSlashCommand, "end" | "start">,
  skill: AgentSkill,
): PromptSkillContent {
  const [before] = splitPromptSkillContent(content, slashCommand.start);
  const [, after] = splitPromptSkillContent(content, slashCommand.end);
  const alreadySelected = content.some(
    (part) => part.type === "skill" && part.skill.id === skill.id,
  );
  return normalizePromptSkillContent([
    ...before,
    ...(alreadySelected ? [] : [{ skill, type: "skill" as const }]),
    ...after,
  ]);
}

export function removePromptSkill(
  content: PromptSkillContent,
  skillId: string,
): PromptSkillContent {
  return normalizePromptSkillContent(
    content.filter((part) => part.type !== "skill" || part.skill.id !== skillId),
  );
}

export function serializePromptSkillContent(content: PromptSkillContent): string {
  return content
    .map((part) => (part.type === "text" ? part.text : skillPlainText(part.skill)))
    .join("");
}

export function toPromptSkillSubmission(content: PromptSkillContent): PromptSkillSubmission {
  const skills: AgentSkill[] = [];
  let text = "";
  for (const part of content) {
    if (part.type === "skill") {
      skills.push(part.skill);
    } else {
      text += part.text;
    }
  }
  return { skills, text: text.trim() };
}

export function isPromptSkillContentEmpty(content: PromptSkillContent): boolean {
  const submission = toPromptSkillSubmission(content);
  return submission.text === "" && submission.skills.length === 0;
}

export type PromptSkillEditorHandle = Readonly<{
  focus: (offset?: number) => void;
  getContent: () => PromptSkillContent;
  replace: (content: PromptSkillContent, cursorOffset?: number) => void;
}>;

type PromptSkillEditorProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "content" | "contentEditable" | "onChange"
> &
  Readonly<{
    content: PromptSkillContent;
    disabled?: boolean;
    onChange: (content: PromptSkillContent, serializedText: string, cursorOffset: number) => void;
    placeholder: string;
    scope: string;
  }>;

const blockElementNames = new Set(["DIV", "P"]);

function createEditorSkillNode(skill: AgentSkill, iconTemplate: SVGSVGElement | null): HTMLElement {
  const token = document.createElement("span");
  token.className = `${skillTokenClassName} relative top-0.5 cursor-pointer select-none hover:bg-control-hover`;
  token.contentEditable = "false";
  token.dataset["promptSkillId"] = skill.id;
  token.dataset["promptSkillName"] = skill.name;
  token.dataset["serializedText"] = skillPlainText(skill);
  token.setAttribute("aria-label", `Skill ${skill.displayName}，实际文本 ${skillPlainText(skill)}`);
  token.setAttribute("role", "button");
  token.tabIndex = -1;
  if (iconTemplate !== null) {
    const icon = iconTemplate.cloneNode(true) as SVGSVGElement;
    icon.classList.remove("hidden");
    token.append(icon);
  }
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = skill.displayName;
  token.append(label);
  return token;
}

function renderEditorContent(
  root: HTMLDivElement,
  content: PromptSkillContent,
  iconTemplate: SVGSVGElement | null,
): void {
  const nodes = content.map((part) =>
    part.type === "text"
      ? document.createTextNode(part.text)
      : createEditorSkillNode(part.skill, iconTemplate),
  );
  root.replaceChildren(...nodes);
  root.dataset["empty"] = String(content.length === 0);
  root.dataset["serializedValue"] = serializePromptSkillContent(content);
}

function readEditorContent(
  root: HTMLDivElement,
  skillsById: ReadonlyMap<string, AgentSkill>,
): PromptSkillContent {
  const parts: PromptSkillContentPart[] = [];
  const appendText = (text: string) => {
    if (text !== "") {
      parts.push({ text, type: "text" });
    }
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent ?? "");
      return;
    }
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const skillId = node.dataset["promptSkillId"];
    if (skillId !== undefined) {
      const skill = skillsById.get(skillId);
      if (skill !== undefined) {
        parts.push({ skill, type: "skill" });
      }
      return;
    }
    if (node.tagName === "BR") {
      appendText("\n");
      return;
    }
    const startsBlock = blockElementNames.has(node.tagName) && parts.length > 0;
    if (startsBlock) {
      appendText("\n");
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return normalizePromptSkillContent(parts);
}

function serializedNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (!(node instanceof HTMLElement)) {
    return 0;
  }
  const serializedText = node.dataset["serializedText"];
  if (serializedText !== undefined) {
    return serializedText.length;
  }
  if (node.tagName === "BR") {
    return 1;
  }
  return [...node.childNodes].reduce((total, child) => total + serializedNodeLength(child), 0);
}

function serializedPointOffset(
  root: HTMLDivElement,
  target: Node | null,
  targetOffset: number,
): number | undefined {
  if (target === null || !root.contains(target)) {
    return undefined;
  }
  let offset = 0;
  let found = false;
  const visit = (node: Node) => {
    if (found) {
      return;
    }
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += Math.min(targetOffset, node.textContent?.length ?? 0);
      } else {
        offset += [...node.childNodes]
          .slice(0, targetOffset)
          .reduce((total, child) => total + serializedNodeLength(child), 0);
      }
      found = true;
      return;
    }
    if (node instanceof Element && node.contains(target)) {
      node.childNodes.forEach(visit);
      return;
    }
    offset += serializedNodeLength(node);
  };
  root.childNodes.forEach(visit);
  return offset;
}

function selectionOffset(root: HTMLDivElement): number {
  const selection = document.getSelection();
  return (
    serializedPointOffset(root, selection?.anchorNode ?? null, selection?.anchorOffset ?? 0) ??
    root.dataset["serializedValue"]?.length ??
    0
  );
}

function findDomPoint(root: HTMLDivElement, requestedOffset: number): readonly [Node, number] {
  let remaining = Math.max(0, requestedOffset);
  for (const [index, node] of [...root.childNodes].entries()) {
    const length = serializedNodeLength(node);
    if (remaining === 0) {
      return [root, index];
    }
    if (node.nodeType === Node.TEXT_NODE && remaining <= length) {
      return [node, remaining];
    }
    if (remaining < length) {
      return remaining < length / 2 ? [root, index] : [root, index + 1];
    }
    remaining -= length;
  }
  return [root, root.childNodes.length];
}

function placeCaret(root: HTMLDivElement, offset: number): void {
  const [node, nodeOffset] = findDomPoint(root, offset);
  const range = document.createRange();
  range.setStart(node, nodeOffset);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertPlainTextAtSelection(root: HTMLDivElement, text: string): void {
  const selection = document.getSelection();
  const range = selection?.rangeCount === 0 ? undefined : selection?.getRangeAt(0);
  if (range === undefined || !root.contains(range.commonAncestorContainer)) {
    root.append(document.createTextNode(text));
    placeCaret(root, serializedNodeLength(root));
    return;
  }
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export const PromptSkillEditor = forwardRef<PromptSkillEditorHandle, PromptSkillEditorProps>(
  function PromptSkillEditor(
    {
      className = "",
      content,
      disabled = false,
      onChange,
      onClick,
      onKeyDown,
      onPaste,
      placeholder,
      scope,
      ...props
    },
    forwardedRef,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const iconTemplateRef = useRef<SVGSVGElement>(null);
    const contentRef = useRef(content);
    const skillsByIdRef = useRef(new Map<string, AgentSkill>());
    const previousScopeRef = useRef<string | undefined>(undefined);

    const rememberSkills = (nextContent: PromptSkillContent) => {
      for (const part of nextContent) {
        if (part.type === "skill") {
          skillsByIdRef.current.set(part.skill.id, part.skill);
        }
      }
    };
    rememberSkills(content);

    const emitChange = () => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      const nextContent = readEditorContent(root, skillsByIdRef.current);
      contentRef.current = nextContent;
      root.dataset["empty"] = String(nextContent.length === 0);
      const serializedText = serializePromptSkillContent(nextContent);
      root.dataset["serializedValue"] = serializedText;
      onChange(nextContent, serializedText, selectionOffset(root));
    };

    const replace = (nextContent: PromptSkillContent, cursorOffset?: number) => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      rememberSkills(nextContent);
      contentRef.current = nextContent;
      renderEditorContent(root, nextContent, iconTemplateRef.current);
      if (cursorOffset !== undefined) {
        placeCaret(root, cursorOffset);
      }
    };

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus(offset) {
          const root = rootRef.current;
          root?.focus();
          if (root !== null && offset !== undefined) {
            placeCaret(root, offset);
          }
        },
        getContent() {
          const root = rootRef.current;
          return root === null
            ? contentRef.current
            : readEditorContent(root, skillsByIdRef.current);
        },
        replace,
      }),
      [],
    );

    useLayoutEffect(() => {
      if (previousScopeRef.current === scope) {
        return;
      }
      previousScopeRef.current = scope;
      replace(content);
    }, [content, scope]);

    const removeSkillFromEvent = (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      const token =
        target instanceof Element ? target.closest<HTMLElement>("[data-prompt-skill-id]") : null;
      const skillId = token?.dataset["promptSkillId"];
      if (skillId === undefined) {
        return false;
      }
      event.preventDefault();
      const root = rootRef.current;
      if (root === null || token === null) {
        return true;
      }
      const tokenOffset = [...root.childNodes]
        .slice(0, [...root.childNodes].indexOf(token))
        .reduce((total, node) => total + serializedNodeLength(node), 0);
      replace(removePromptSkill(contentRef.current, skillId), tokenOffset);
      emitChange();
      return true;
    };

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
      onPaste?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (event.clipboardData.files.length > 0) {
        // 图片粘贴继续冒泡给 PromptInput 的附件处理，编辑器只接管纯文本。
        return;
      }
      event.preventDefault();
      insertPlainTextAtSelection(event.currentTarget, event.clipboardData.getData("text/plain"));
      emitChange();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.nativeEvent.isComposing || disabled) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          insertPlainTextAtSelection(event.currentTarget, "\n");
          emitChange();
        } else {
          event.currentTarget.closest("form")?.requestSubmit();
        }
      }
    };

    return (
      <>
        <Box aria-hidden="true" className="hidden size-4 shrink-0" ref={iconTemplateRef} />
        <div
          {...props}
          aria-disabled={disabled || undefined}
          aria-multiline="true"
          className={`max-h-40 min-h-12 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none before:pointer-events-none before:text-muted-foreground/60 data-[empty=true]:before:content-[attr(data-placeholder)] ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className}`}
          contentEditable={!disabled}
          data-empty={content.length === 0}
          data-placeholder={placeholder}
          data-prompt-skill-editor=""
          onClick={(event) => {
            if (!removeSkillFromEvent(event)) {
              onClick?.(event);
            }
          }}
          onCopy={(event) => {
            const root = rootRef.current;
            const selection = document.getSelection();
            if (root === null || selection === null || selection.rangeCount === 0) {
              return;
            }
            const range = selection.getRangeAt(0);
            if (!root.contains(range.commonAncestorContainer)) {
              return;
            }
            const serializedText = serializePromptSkillContent(
              readEditorContent(root, skillsByIdRef.current),
            );
            const start = serializedPointOffset(root, range.startContainer, range.startOffset);
            const end = serializedPointOffset(root, range.endContainer, range.endOffset);
            if (start === undefined || end === undefined || start === end) {
              return;
            }
            // Token 可见文本使用 displayName，复制时恢复 Codex 规定的 `$name`。
            event.preventDefault();
            event.clipboardData.setData("text/plain", serializedText.slice(start, end));
          }}
          onInput={emitChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          ref={rootRef}
          role="textbox"
          spellCheck="true"
          suppressContentEditableWarning
        />
      </>
    );
  },
);
