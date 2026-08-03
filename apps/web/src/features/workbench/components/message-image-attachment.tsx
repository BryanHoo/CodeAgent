import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { IconButton } from "../../../shared/ui/icon-button.js";

type MessageImageAttachmentProps = Readonly<{
  name: string;
  url: string;
}>;

export function MessageImageAttachment({ name, url }: MessageImageAttachmentProps) {
  const { t } = useTranslation("conversation");
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || dialog === null || dialog.open) {
      return;
    }

    // 使用原生模态能力圈定焦点，并统一支持 Escape 关闭。
    dialog.showModal();
  }, [isOpen]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("timeline.showImage", { name })}
        className="block size-40 max-w-full cursor-zoom-in overflow-hidden rounded-surface bg-control shadow-control transition-opacity hover:opacity-90 focus-visible:shadow-focus"
        data-message-attachment="image"
        onClick={() => {
          setIsOpen(true);
        }}
        type="button"
      >
        {/* 历史图片只在进入可视区时读取和解码。 */}
        <img
          alt={name}
          className="size-full object-cover"
          decoding="async"
          height={160}
          loading="lazy"
          src={url}
          width={160}
        />
      </button>
      {isOpen ? (
        // 原生 dialog 已处理键盘交互，点击 backdrop 时关闭预览。
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <dialog
          aria-labelledby={titleId}
          className="m-auto max-h-[92vh] max-w-[92vw] overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
          data-message-image-preview=""
          onCancel={(event) => {
            event.preventDefault();
            setIsOpen(false);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
          ref={dialogRef}
        >
          <section className="grid max-h-[92vh] max-w-[92vw] grid-rows-[auto_minmax(0,1fr)] bg-raised">
            <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
              <h2 className="min-w-0 flex-1 truncate text-body-small font-semibold" id={titleId}>
                {name}
              </h2>
              <IconButton
                label={t("timeline.closeImagePreview")}
                onClick={() => {
                  setIsOpen(false);
                }}
                size="small"
              >
                <X className="size-3.5" aria-hidden="true" />
              </IconButton>
            </header>
            <div className="grid min-h-0 place-items-center overflow-auto bg-content p-2">
              <img
                alt={name}
                className="block max-h-[calc(92vh-3rem)] max-w-[calc(92vw-1rem)] object-contain"
                decoding="async"
                src={url}
              />
            </div>
          </section>
        </dialog>
      ) : null}
    </>
  );
}
