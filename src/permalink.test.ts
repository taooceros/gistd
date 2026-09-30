import { expect, test } from "vitest";
import { pinnedPath } from "./permalink";
import { storageSpecFromPath } from "./storage";
import type { StorageSpec } from "./storage";

const OID = "0123456789abcdef0123456789abcdef01234567";

/// Pins `inputPath` and checks the result parses back to the same file at OID.
function pin(inputPath: string, spec: StorageSpec = storageSpecFromPath(inputPath)) {
  const pinned = pinnedPath(inputPath, spec, OID)!;
  const reparsed = storageSpecFromPath(pinned);
  expect(reparsed.type).toBe(spec.type);
  if (reparsed.type !== "http" && spec.type !== "http") {
    expect(reparsed.ref).toBe(OID);
    expect(reparsed.slug).toBe(spec.slug);
    expect(reparsed.domain).toBe(spec.domain);
  }
  return pinned;
}

test("pins a GitHub branch URL", () => {
  expect(pin("typst/templates/blob/main/charged-ieee/template/main.typ")).toBe(
    `typst/templates/blob/${OID}/charged-ieee/template/main.typ`
  );
});

test("pins a ref containing slashes", () => {
  // After GitLoader.resolveRef, the ref spans two path segments.
  const spec = storageSpecFromPath("taooceros/locks/blob/coro/delegation-study/paper.typ");
  if (spec.type !== "github") throw new Error("expected github");
  spec.ref = "coro/delegation-study";
  spec.rest = ["paper.typ"];
  spec.slug = "paper.typ";
  expect(pin("taooceros/locks/blob/coro/delegation-study/paper.typ", spec)).toBe(
    `taooceros/locks/blob/${OID}/paper.typ`
  );
});

test("keeps the @any prefix", () => {
  expect(pin("@any/github.com/typst/templates/blob/main/a/main.typ")).toBe(
    `@any/github.com/typst/templates/blob/${OID}/a/main.typ`
  );
});

test("pins a Forgejo URL as src/commit", () => {
  expect(pin("@any/codeberg.org/me/repo/src/branch/main/doc.typ")).toBe(
    `@any/codeberg.org/me/repo/src/commit/${OID}/doc.typ`
  );
  expect(pin("@http/127.0.0.1:3000/me/repo/src/branch/main/doc.typ")).toBe(
    `@http/127.0.0.1:3000/me/repo/src/commit/${OID}/doc.typ`
  );
});

test("builds a path for the default README", () => {
  expect(pin("", storageSpecFromPath(""))).toBe(
    `Myriad-Dreamin/gistd/blob/${OID}/README.typ`
  );
});

test("plain URLs cannot be pinned", () => {
  const spec = storageSpecFromPath("@any/example.com/doc.typ");
  expect(pinnedPath("@any/example.com/doc.typ", spec, OID)).toBeUndefined();
});
