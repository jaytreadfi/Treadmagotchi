/**
 * Sprite image preloader with module-level cache.
 * All images are loaded once and reused across frames.
 */

const cache = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<HTMLImageElement>>();

/** Preload an image and cache it. Returns the loaded HTMLImageElement. */
export function preloadImage(src: string): Promise<HTMLImageElement> {
  const cached = cache.get(src);
  if (cached) return Promise.resolve(cached);

  const existing = loading.get(src);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cache.set(src, img);
      loading.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      loading.delete(src);
      reject(new Error(`Failed to load: ${src}`));
    };
    img.src = src;
  });

  loading.set(src, promise);
  return promise;
}

/** Synchronous cache getter — returns null if not yet loaded. */
export function getCached(src: string): HTMLImageElement | null {
  return cache.get(src) ?? null;
}

/** Preload an egg sprite. */
export function preloadEgg(id: number): Promise<HTMLImageElement> {
  return preloadImage(`/sprites/eggs/${id}.png`);
}

/** Preload a character sprite sheet. */
export function preloadCharacter(sheet: string): Promise<HTMLImageElement> {
  return preloadImage(sheet);
}

/** Preload the shadow sprite. */
export function preloadShadow(): Promise<HTMLImageElement> {
  return preloadImage('/sprites/characters/shadow.png');
}

/** Preload a map background image. */
export function preloadMap(src: string): Promise<HTMLImageElement> {
  return preloadImage(src);
}
