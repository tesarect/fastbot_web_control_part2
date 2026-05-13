/**
 * Promise-wrapped <script> tag injector. Used to load vendored UMD libraries
 * (ros3djs, mesh loaders) that don't ship clean ES module builds.
 * Each src is loaded once — repeated calls return a cached promise.
 */
const cache = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  const existing = cache.get(src);
  if (existing) return existing;

  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });

  cache.set(src, p);
  return p;
}

export async function loadScriptsInOrder(srcs: string[]): Promise<void> {
  for (const src of srcs) {
    await loadScript(src);
  }
}
