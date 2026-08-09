import type { AgentSkill } from "@code-agent/protocol";
import { Box } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  isPromptInputComposing,
  isPromptInputNewlineShortcut,
} from "../../../shared/components/agent/prompt-input.js";
import {
  removePromptSkill,
  recognizePromptSkillReferences,
  serializePromptSkillContent,
  skillPlainText,
  type PromptSkillContent,
} from "./prompt-skill-content.js";
import {
  caretAnchorText,
  insertLineBreakAtSelection,
  insertPlainTextAtSelection,
  placeCaret,
  readEditorContent,
  renderEditorContent,
  selectionOffset,
  serializedNodeLength,
  serializedPointOffset,
} from "./prompt-skill-editor-dom.js";

export * from "./prompt-skill-content.js";

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
    skills: readonly AgentSkill[];
    scope: string;
  }>;

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
      skills,
      scope,
      ...props
    },
    forwardedRef,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const iconTemplateRef = useRef<SVGSVGElement>(null);
    const contentRef = useRef(content);
    const availableSkillsRef = useRef(skills);
    const skillsByIdRef = useRef(new Map<string, AgentSkill>());
    const previousScopeRef = useRef<string | undefined>(undefined);

    const rememberSkills = useCallback((nextContent: PromptSkillContent) => {
      for (const part of nextContent) {
        if (part.type === "skill") {
          skillsByIdRef.current.set(part.skill.id, part.skill);
        }
      }
    }, []);
    availableSkillsRef.current = skills;
    for (const skill of skills) {
      skillsByIdRef.current.set(skill.id, skill);
    }
    rememberSkills(content);

    const emitChange = () => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      const editorContent = readEditorContent(root, skillsByIdRef.current);
      const nextContent = recognizePromptSkillReferences(editorContent, availableSkillsRef.current);
      const cursorOffset = selectionOffset(root);
      if (nextContent !== editorContent) {
        // 手输的 Codex `$name` 引用立即转换为现有 Token，同时保持序列化光标位置。
        renderEditorContent(root, nextContent, iconTemplateRef.current);
        placeCaret(root, Math.min(cursorOffset, serializePromptSkillContent(nextContent).length));
      }
      contentRef.current = nextContent;
      root.dataset["empty"] = String(nextContent.length === 0);
      const serializedText = serializePromptSkillContent(nextContent);
      root.dataset["serializedValue"] = serializedText;
      onChange(nextContent, serializedText, selectionOffset(root));
    };

    const replace = useCallback(
      (nextContent: PromptSkillContent, cursorOffset?: number) => {
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
      },
      [rememberSkills],
    );

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
      [replace],
    );

    useLayoutEffect(() => {
      if (previousScopeRef.current === scope) {
        return;
      }
      previousScopeRef.current = scope;
      replace(content);
    }, [content, replace, scope]);

    useLayoutEffect(() => {
      const root = rootRef.current;
      if (root === null || skills.length === 0) {
        return;
      }
      const editorContent = readEditorContent(root, skillsByIdRef.current);
      const nextContent = recognizePromptSkillReferences(editorContent, skills);
      if (nextContent === editorContent) {
        return;
      }

      const cursorOffset = selectionOffset(root);
      renderEditorContent(root, nextContent, iconTemplateRef.current);
      if (document.activeElement === root) {
        placeCaret(root, Math.min(cursorOffset, serializePromptSkillContent(nextContent).length));
      }
      contentRef.current = nextContent;
      const serializedText = serializePromptSkillContent(nextContent);
      root.dataset["serializedValue"] = serializedText;
      // Skill 目录异步返回时重新解析现有草稿，用户无需再次输入即可看到 Token。
      onChange(nextContent, serializedText, selectionOffset(root));
    }, [onChange, skills]);

    const removeSkillNode = (root: HTMLDivElement, token: HTMLElement, skillId: string) => {
      const tokenOffset = [...root.childNodes]
        .slice(0, [...root.childNodes].indexOf(token))
        .reduce((total, node) => total + serializedNodeLength(node), 0);
      replace(removePromptSkill(contentRef.current, skillId), tokenOffset);
      emitChange();
    };

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
      removeSkillNode(root, token, skillId);
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
      if (event.defaultPrevented || isPromptInputComposing(event.nativeEvent) || disabled) {
        return;
      }
      if (
        event.key === "End" &&
        !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      ) {
        const root = event.currentTarget;
        const selection = document.getSelection();
        const serializedText = serializePromptSkillContent(contentRef.current);
        const trailingPart = contentRef.current.at(-1);
        const trailingSkillStart =
          trailingPart?.type === "skill"
            ? serializedText.length - skillPlainText(trailingPart.skill).length
            : undefined;
        const cursorOffset = selectionOffset(root);
        if (
          selection?.isCollapsed === true &&
          trailingSkillStart !== undefined &&
          cursorOffset <= trailingSkillStart &&
          serializedText.slice(cursorOffset, trailingSkillStart).trim() === ""
        ) {
          // 非编辑 Token 会截断 Chromium 的 End；只在末尾空白区补齐原生行尾语义。
          event.preventDefault();
          placeCaret(root, serializedText.length);
          return;
        }
      }
      if (event.key === "Backspace") {
        const selection = document.getSelection();
        const anchorNode = selection?.anchorNode;
        const caretAnchor = anchorNode?.parentElement;
        const token = caretAnchor?.previousElementSibling;
        const skillId = token instanceof HTMLElement ? token.dataset["promptSkillId"] : undefined;
        if (
          selection?.isCollapsed === true &&
          selection.anchorOffset === caretAnchorText.length &&
          caretAnchor?.dataset["promptCaretAnchor"] !== undefined &&
          anchorNode?.textContent?.startsWith(caretAnchorText) === true &&
          token instanceof HTMLElement &&
          skillId !== undefined
        ) {
          // 保留 Token 邻接删除语义，避免先删掉用于 Safari 绘制光标的零宽字符。
          event.preventDefault();
          removeSkillNode(event.currentTarget, token, skillId);
          return;
        }
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (isPromptInputNewlineShortcut(event)) {
          insertLineBreakAtSelection(event.currentTarget);
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
          tabIndex={disabled ? -1 : 0}
        />
      </>
    );
  },
);
