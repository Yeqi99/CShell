import { useEffect, useState } from 'react';
import type { AppearanceAsset, Preferences } from '../shared/contracts';

const fonts = new Map<string, Promise<string>>();
export const assetFamily = (asset: AppearanceAsset) => `CShell-${asset.id.split('.')[0]}`;
export function loadFont(asset: AppearanceAsset): Promise<string> {
  let pending = fonts.get(asset.id);
  if (!pending) {
    pending = window.cshell
      .appearanceData(asset.id)
      .then(async (data) => {
        const family = assetFamily(asset);
        const face = await new FontFace(family, `url("${data}")`).load();
        document.fonts.add(face);
        window.dispatchEvent(new Event('cshell:fonts-loaded'));
        return family;
      })
      .catch((error) => {
        fonts.delete(asset.id);
        throw error;
      });
    fonts.set(asset.id, pending);
  }
  return pending;
}
export function useAppearance(preferences: Preferences, onError: (error: unknown) => void) {
  useEffect(() => {
    let cancelled = false;
    for (const asset of [preferences.uiFontAsset, preferences.terminalFontAsset]) {
      if (asset)
        void loadFont(asset).catch((error) => {
          if (!cancelled) onError(error);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [preferences.uiFontAsset?.id, preferences.terminalFontAsset?.id, onError]);
}
export function WorkbenchBackground({
  preferences,
  onError,
}: {
  preferences: Preferences;
  onError: (error: unknown) => void;
}) {
  const [image, setImage] = useState<{ id: string; data: string } | null>(null);
  const id = preferences.backgroundAsset?.id;
  useEffect(() => {
    let cancelled = false;
    if (id)
      void window.cshell
        .appearanceData(id)
        .then((data) => {
          if (!cancelled) setImage({ id, data });
        })
        .catch((error) => {
          if (!cancelled) onError(error);
        });
    return () => {
      cancelled = true;
    };
  }, [id, onError]);
  if (!id || image?.id !== id) return null;
  return (
    <div
      aria-hidden="true"
      className="workbench-background"
      style={{
        backgroundImage: `url("${image.data}")`,
        opacity: preferences.backgroundOpacity,
        filter: `blur(${preferences.backgroundBlur}px)`,
        backgroundSize: preferences.backgroundFit,
      }}
    />
  );
}
