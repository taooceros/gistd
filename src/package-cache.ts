/// Persists `@preview` package tarballs across page loads.
///
/// typst.ts resolves packages synchronously while compiling (its default
/// registry does a sync XHR and only caches in memory), so tarballs are
/// read from Cache Storage up front, before compiling, for the packages
/// used before on this device. Misses fall back to a sync XHR and are
/// persisted in the background. Package versions on packages.typst.org are
/// immutable, so cached entries never go stale.

const CACHE_NAME = "gistd-packages";
const USED_KEY = "gistd-packages-used";
/// Packages to preload; the least recently used beyond this are dropped.
const MAX_PRELOADED = 32;

function readUsed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USED_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((u): u is string => typeof u === "string")
      : [];
  } catch {
    return [];
  }
}

function fetchSync(url: string): Uint8Array | undefined {
  const request = new XMLHttpRequest();
  request.overrideMimeType("text/plain; charset=x-user-defined");
  request.open("GET", url, false);
  request.send(null);
  if (request.status === 200 && typeof request.response === "string") {
    return Uint8Array.from(request.response, (c) => c.charCodeAt(0));
  }
  return undefined;
}

export class PackageCache {
  private data = new Map<string, Uint8Array>();
  private used = readUsed();

  /// Loads previously used packages from Cache Storage into memory.
  async preload() {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      this.used.map(async (url) => {
        const res = await cache.match(url);
        if (res) this.data.set(url, new Uint8Array(await res.arrayBuffer()));
      })
    );
    // Drop tarballs that fell out of the preload list.
    const keep = new Set(this.used);
    for (const req of await cache.keys()) {
      if (!keep.has(req.url)) void cache.delete(req);
    }
  }

  /// Synchronous lookup for the compiler's package registry.
  get(url: string): Uint8Array | undefined {
    this.markUsed(url);
    let data = this.data.get(url);
    if (data) return data;
    data = fetchSync(url);
    if (data) {
      this.data.set(url, data);
      this.persist(url, data);
    }
    return data;
  }

  private markUsed(url: string) {
    this.used = [url, ...this.used.filter((u) => u !== url)].slice(
      0,
      MAX_PRELOADED
    );
    try {
      localStorage.setItem(USED_KEY, JSON.stringify(this.used));
    } catch {}
  }

  private persist(url: string, data: Uint8Array) {
    if (typeof caches === "undefined") return;
    const body = data.slice().buffer;
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.put(
          url,
          new Response(body, { headers: { "Content-Type": "application/gzip" } })
        )
      )
      .catch((e) => console.warn("package cache put failed", url, e));
  }
}

/// The parts of a typst.ts module (`import("typst.ts-x")`) used here.
export interface TypstModule {
  $typst: { use(...providers: unknown[]): void };
  MemoryAccessModel: new () => unknown;
  FetchPackageRegistry: new (am: unknown) => {
    pullPackageData(path: unknown): Uint8Array | undefined;
    resolvePath(path: unknown): string;
  };
  initOptions: {
    withAccessModel(am: unknown): unknown;
    withPackageRegistry(registry: unknown): unknown;
  };
}

/// Installs a package registry backed by `cache` on the global compiler.
/// Must run before the compiler is built.
export function usePackageCache(ts: TypstModule, cache: PackageCache) {
  const am = new ts.MemoryAccessModel();
  class CachedPackageRegistry extends ts.FetchPackageRegistry {
    pullPackageData(path: unknown) {
      return cache.get(this.resolvePath(path));
    }
  }
  // Provider keys must contain `access-model` / `package-registry`, or the
  // snippet also installs its default (uncached) fetch registry.
  ts.$typst.use(
    {
      key: "access-model$gistd",
      forRoles: ["compiler"],
      provides: [ts.initOptions.withAccessModel(am)],
    },
    {
      key: "package-registry$gistd",
      forRoles: ["compiler"],
      provides: [
        ts.initOptions.withPackageRegistry(new CachedPackageRegistry(am)),
      ],
    }
  );
}
