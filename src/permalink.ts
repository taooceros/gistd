import type { StorageSpec } from "./storage";

/// Returns the gistd path (without deploy base) that opens `spec` at commit
/// `oid`, or undefined for storages that cannot be pinned (plain URLs).
///
/// `inputPath` is the path the page was opened with; its ref segments are
/// replaced so everything else (`@any/<domain>` prefixes etc.) is kept. When
/// the page shows a default document (empty path), the path is built from the
/// spec instead.
export function pinnedPath(
  inputPath: string,
  spec: StorageSpec,
  oid: string
): string | undefined {
  if (spec.type === "http") return undefined;

  const refAndRest = [spec.ref, ...spec.rest].join("/");
  const path = inputPath.replace(/\/+$/, "");
  if (path.endsWith(`/${refAndRest}`)) {
    let head = path.slice(0, -refAndRest.length - 1);
    // Forgejo: `src/branch/<ref>` -> `src/commit/<oid>` (gistd ignores the
    // segment, but it keeps the link valid on the forge itself).
    if (spec.type === "forgejo") {
      head = head.replace(/\/src\/(?:branch|tag)$/, "/src/commit");
    }
    return [head, oid, ...spec.rest].join("/");
  }

  const repo = `${spec.user}/${spec.repo}`;
  if (spec.type === "github") {
    const prefix = spec.domain === "github.com" ? "" : `@any/${spec.domain}/`;
    return `${prefix}${repo}/${spec.kind}/${oid}/${spec.slug}`;
  }
  const at = spec.protocol === "http" ? "@http" : "@any";
  return `${at}/${spec.domain}/${repo}/src/commit/${oid}/${spec.slug}`;
}
