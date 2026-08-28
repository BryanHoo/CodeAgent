import type {
  DesktopPetDragStrategy,
  DesktopPetState,
} from "../../../protocol/desktop-pet.js";
import type { WorkbenchPetDescriptor } from "../../../protocol/index.js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  getDesktopPetState,
  getDesktopPetDragStrategy,
  getDesktopPetPosition,
  listenDesktopPetMoved,
  listenDesktopPetState,
  loadDesktopPet,
  moveDesktopPet,
  setDesktopPetDragPosition,
  showDesktopPet,
  startDesktopPetNativeDrag,
} from "../../../platform/tauri/desktop-pet-client.js";
import { useTranslation } from "../../../i18n/i18n.js";
import {
  desktopPetDragPosition,
  dragAnimation,
  introDuration,
  isDesktopPetDragPointerActive,
} from "../desktop-pet-animation.js";
import { releaseDesktopPetPointerCapture } from "../desktop-pet-pointer.js";
import { WorkbenchPetCanvas } from "./workbench-pet-canvas.js";

interface DragStateBase {
  pointerId: number;
  startX: number;
  startY: number;
}

type DragState =
  | (DragStateBase & { nativeStarted: boolean; strategy: "native" })
  | (DragStateBase & {
      directionChosen: boolean;
      origin: Readonly<{ x: number; y: number }>;
      strategy: "webview";
    });

function isNativeDragRunning(drag: DragState | null): boolean {
  return drag?.strategy === "native" && drag.nativeStarted;
}

export function DesktopPetWindow() {
  const { t } = useTranslation("workbench");
  const [state, setState] = useState<DesktopPetState | null>(null);
  const [pet, setPet] = useState<WorkbenchPetDescriptor | null>(null);
  const [dragStrategy, setDragStrategy] = useState<DesktopPetDragStrategy | null>(null);
  const [animationName, setAnimationName] = useState("idle");
  const baseAnimationRef = useRef("idle");
  const dragRef = useRef<DragState | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpDurationRef = useRef(1);
  const moveInFlightRef = useRef(false);
  const pendingPositionRef = useRef<Readonly<{ x: number; y: number }> | null>(null);
  const positionRef = useRef<Readonly<{ x: number; y: number }> | null>(null);
  const rafRef = useRef<number | null>(null);
  const shownAssetRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void getDesktopPetDragStrategy()
      .catch((): DesktopPetDragStrategy => "webview")
      .then((strategy) => {
        if (!disposed) setDragStrategy(strategy);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void (async () => {
      const unlisten = await listenDesktopPetState((nextState) => {
        if (!disposed) setState(nextState);
      });
      if (disposed) {
        unlisten();
        return;
      }
      stopListening = unlisten;
      const initial = await getDesktopPetState();
      if (!disposed) setState(initial);
    })().catch(() => undefined);
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    if (dragStrategy !== "webview") return;
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void Promise.all([
      getDesktopPetPosition().then((position) => {
        positionRef.current = position;
      }),
      listenDesktopPetMoved((position) => {
        positionRef.current = position;
      }).then((unlisten) => {
        if (disposed) unlisten();
        else stopListening = unlisten;
      }),
    ]).catch(() => undefined);
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [dragStrategy]);

  useEffect(() => {
    if (state === null) return;
    baseAnimationRef.current = state.animationName;
    if (dragRef.current === null && jumpTimerRef.current === null) {
      setAnimationName(state.animationName);
    }
  }, [state]);

  useEffect(() => {
    jumpDurationRef.current = Math.max(1, introDuration(pet?.animations.jumping));
  }, [pet]);

  const flushPositionRef = useRef(() => undefined);
  flushPositionRef.current = () => {
    if (moveInFlightRef.current) return;
    const position = pendingPositionRef.current;
    if (position === null) return;
    pendingPositionRef.current = null;
    moveInFlightRef.current = true;
    // 同一时刻只保留一个 IPC 调用，移动过快时直接合并到最新坐标。
    void setDesktopPetDragPosition(position)
      .catch(() => undefined)
      .finally(() => {
        moveInFlightRef.current = false;
        flushPositionRef.current();
      });
  };

  const schedulePosition = (position: Readonly<{ x: number; y: number }>) => {
    pendingPositionRef.current = position;
    positionRef.current = position;
    rafRef.current ??= requestAnimationFrame(() => {
      rafRef.current = null;
      flushPositionRef.current();
    });
  };

  const finishDrag = (pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) return;
    dragRef.current = null;
    const handle = handleRef.current;
    handle?.removeAttribute("data-dragging");
    if (handle !== null) releaseDesktopPetPointerCapture(handle, pointerId);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    flushPositionRef.current();
    setAnimationName("jumping");
    if (jumpTimerRef.current !== null) clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(() => {
      jumpTimerRef.current = null;
      setAnimationName(baseAnimationRef.current);
    }, jumpDurationRef.current);
  };

  useEffect(
    () => () => {
      if (jumpTimerRef.current !== null) clearTimeout(jumpTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      pendingPositionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    setPet(null);
    if (state === null) return;
    void loadDesktopPet(state.petId)
      .then((nextPet) => {
        if (!disposed) setPet(nextPet);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [state?.petId]);

  const handleReady = useCallback(() => {
    if (pet === null || shownAssetRef.current === pet.assetId) return;
    shownAssetRef.current = pet.assetId;
    void showDesktopPet().catch(() => undefined);
  }, [pet]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || dragStrategy === null) return;
    const origin = positionRef.current;
    if (dragStrategy === "webview" && origin === null) return;
    event.preventDefault();
    const target = event.currentTarget;
    const common = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
    };
    if (dragStrategy === "native") {
      dragRef.current = { ...common, nativeStarted: false, strategy: "native" };
    } else if (origin !== null) {
      dragRef.current = { ...common, directionChosen: false, origin, strategy: "webview" };
    }
    target.setPointerCapture(event.pointerId);
    target.setAttribute("data-dragging", "");
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (isNativeDragRunning(drag)) return;
    if (!isDesktopPetDragPointerActive(event.buttons)) {
      // pointerup 若在原生窗口移动期间丢失，下一次移动仍可根据按键位恢复交互。
      finishDrag(event.pointerId);
      return;
    }
    if (drag.strategy === "native") {
      const nextAnimation = dragAnimation(drag.startX, event.screenX);
      if (nextAnimation === null) return;
      drag.nativeStarted = true;
      // AppKit 会吞掉 mouseup；接管前先释放 WebView capture，避免主窗口 hover 和光标路由残留。
      releaseDesktopPetPointerCapture(event.currentTarget, event.pointerId);
      setAnimationName(nextAnimation);
      // AppKit 在主线程接管完整拖拽会话，Promise 仅在 mouseUp 后返回。
      const pointerId = event.pointerId;
      void startDesktopPetNativeDrag()
        .catch(() => undefined)
        .finally(() => {
          finishDrag(pointerId);
        });
      return;
    }
    schedulePosition(
      desktopPetDragPosition(
        drag.origin,
        { x: drag.startX, y: drag.startY },
        { x: event.screenX, y: event.screenY },
        globalThis.devicePixelRatio,
      ),
    );
    if (!drag.directionChosen) {
      const nextAnimation = dragAnimation(drag.startX, event.screenX);
      if (nextAnimation !== null) {
        drag.directionChosen = true;
        setAnimationName(nextAnimation);
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      void moveDesktopPet({ deltaX: 0, deltaY: 0, reset: true }).catch(() => undefined);
      return;
    }
    if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    void moveDesktopPet({
      deltaX: event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0,
      deltaY: event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0,
      reset: false,
    }).catch(() => undefined);
  };

  if (state === null || pet === null) return null;
  return (
    <button
      aria-label={t("pet.move", { name: pet.displayName })}
      className="desktop-pet-target"
      onKeyDown={handleKeyDown}
      onLostPointerCapture={(event) => {
        if (!isNativeDragRunning(dragRef.current)) finishDrag(event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (!isNativeDragRunning(dragRef.current)) finishDrag(event.pointerId);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => {
        if (!isNativeDragRunning(dragRef.current)) finishDrag(event.pointerId);
      }}
      ref={handleRef}
      type="button"
    >
      <span className="desktop-pet-sprite">
        <WorkbenchPetCanvas
          animationName={animationName}
          alwaysAnimate
          onReady={handleReady}
          pet={pet}
        />
      </span>
    </button>
  );
}
