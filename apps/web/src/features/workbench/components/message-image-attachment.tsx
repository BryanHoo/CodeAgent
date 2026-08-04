import { X } from "lucide-react";
import { useId, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/ui/button.js";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../../../shared/ui/dialog.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";

type MessageImageAttachmentProps = Readonly<{
  name: string;
  url: string;
}>;

export function MessageImageAttachment({ name, url }: MessageImageAttachmentProps) {
  const { t } = useTranslation("conversation");
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <Button
          aria-label={t("timeline.showImage", { name })}
          className="block size-40 max-w-full cursor-zoom-in overflow-hidden rounded-surface bg-control p-0 shadow-control transition-opacity hover:opacity-90 focus-visible:shadow-focus"
          data-message-attachment="image"
          type="button"
          variant="ghost"
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
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-labelledby={titleId}
        className="max-h-[92dvh] w-auto max-w-[calc(100%-2rem)] overflow-hidden p-0"
        data-message-image-preview=""
      >
        <section className="grid max-h-[92dvh] max-w-[92vw] grid-rows-[auto_minmax(0,1fr)] bg-raised">
          <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
            <DialogTitle className="min-w-0 flex-1 truncate text-body-small" id={titleId}>
              {name}
            </DialogTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t("timeline.closeImagePreview")}
                  onClick={() => {
                    setIsOpen(false);
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("timeline.closeImagePreview")}</TooltipContent>
            </Tooltip>
          </header>
          <div className="grid min-h-0 place-items-center overflow-auto bg-content p-2">
            <img
              alt={name}
              className="block max-h-[calc(92dvh-3rem)] max-w-[calc(92vw-1rem)] object-contain"
              decoding="async"
              src={url}
            />
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
