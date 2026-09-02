import { useCallback, useEffect, useMemo, useState } from "react";
import { appPreferenceStorage } from "../../../platform/tauri/app-storage.js";

import {
  createCustomBackgroundImage,
  readCustomBackgroundImages,
  readWorkbenchBackgroundPreference,
  removeCustomBackgroundFromDraft,
  type CustomBackgroundImage,
  type WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";

function readInitialBackground(): WorkbenchBackgroundPreference {
  return readWorkbenchBackgroundPreference(appPreferenceStorage);
}

export function useWorkbenchBackgroundDraft() {
  const [background, setBackground] =
    useState<WorkbenchBackgroundPreference>(readInitialBackground);
  const [customImages, setCustomImages] = useState<readonly CustomBackgroundImage[]>([]);
  const [storedImageIds, setStoredImageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [deletedImageIds, setDeletedImageIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let disposed = false;
    void readCustomBackgroundImages()
      .then((images) => {
        if (disposed) return;
        setCustomImages(images);
        setStoredImageIds(new Set(images.map((image) => image.id)));
      })
      .catch(() => {
        if (!disposed) {
          setCustomImages([]);
          setStoredImageIds(new Set());
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const backgroundMutation = useMemo(
    () => ({
      deletedImageIds: [...deletedImageIds],
      imagesToSave: customImages.filter((image) => !storedImageIds.has(image.id)),
    }),
    [customImages, deletedImageIds, storedImageIds],
  );

  const acknowledgeBackgroundMutation = useCallback(
    (mutation: typeof backgroundMutation) => {
      const savedImageIds = new Set(mutation.imagesToSave.map((image) => image.id));
      const removedImageIds = new Set(mutation.deletedImageIds);
      setStoredImageIds((current) => {
        const next = new Set([...current, ...savedImageIds]);
        for (const imageId of removedImageIds) next.delete(imageId);
        return next;
      });
      setDeletedImageIds(
        (current) => new Set([...current].filter((imageId) => !removedImageIds.has(imageId))),
      );
    },
    [],
  );

  return {
    acknowledgeBackgroundMutation,
    addCustomBackgroundFiles: (files: readonly File[]) => {
      const addedImages = files.map((file) => createCustomBackgroundImage(file));
      if (addedImages.length === 0) return;
      setCustomImages((current) => [...current, ...addedImages]);
      setBackground((current) => ({
        ...current,
        mode: "custom",
        selectedCustomImageId: addedImages.at(-1)?.id ?? current.selectedCustomImageId,
      }));
    },
    background,
    backgroundMutation,
    customBackgroundMissing:
      background.mode === "custom" &&
      (background.selectedCustomImageId === null ||
        !customImages.some((image) => image.id === background.selectedCustomImageId)),
    customImages,
    removeCustomBackgroundImage: (imageId: string) => {
      const result = removeCustomBackgroundFromDraft(
        customImages,
        imageId,
        background.selectedCustomImageId,
      );
      setCustomImages(result.images);
      setBackground((preference) => ({
        ...preference,
        selectedCustomImageId:
          preference.selectedCustomImageId === imageId
            ? result.selectedCustomImageId
            : preference.selectedCustomImageId,
      }));
      if (storedImageIds.has(imageId)) {
        setDeletedImageIds((current) => new Set(current).add(imageId));
      }
    },
    selectCustomBackgroundImage: (imageId: string) => {
      setBackground((current) => ({
        ...current,
        mode: "custom",
        selectedCustomImageId: imageId,
      }));
    },
    setBackground,
  } as const;
}
