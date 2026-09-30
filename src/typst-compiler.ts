import type { OutputFormat } from "./args";
import type { DiagnosticMessage } from "./error";

type ChangeKind = "new" | "diff-v1";

export interface TypstCompileResult {
  changeKind: ChangeKind;
  diagnostics: DiagnosticMessage[];
  hasError: boolean;
  /// Serialized HTML document, set when compiled with `output: "html"`.
  html?: string;
  pdfpc?: unknown;
  title?: string;
  vector?: unknown;
}

export interface CompileTypstOptions {
  mainFilePath: string;
  queryPdfpc: boolean;
  output?: OutputFormat;
}

/// Symbol under which typst.ts wrappers keep the raw wasm object
/// (`kObject` in typst.ts `internal.types.mts`).
const kObject = Symbol.for("reflexo-obj");

/// Diagnostics format `full` (see `getDiagnosticsArg` in typst.ts).
const DIAGNOSTICS_FULL = 3;

export async function compileTypstDocument(
  $typst: any,
  { mainFilePath, queryPdfpc, output = "paged" }: CompileTypstOptions
): Promise<TypstCompileResult> {
  const compiler = await $typst.getCompiler();

  if (output === "html") {
    if (!("runWithWorld" in compiler)) {
      throw new Error("HTML output is not supported by this typst compiler");
    }
    return compileHtmlWithWorldCompiler(compiler, mainFilePath);
  }

  if ("runWithWorld" in compiler) {
    return compileWithWorldCompiler(compiler, { mainFilePath, queryPdfpc });
  }

  return compileWithLegacyCompiler(compiler, { mainFilePath, queryPdfpc });
}

/// Result of the gistd-patched `TypstCompileWorld.html(diagnosticsFormat)`.
interface RawHtmlResult {
  result?: string;
  title?: string;
  hasError?: boolean;
  diagnostics?: DiagnosticMessage[];
}

interface HtmlCapableWorld {
  html(diagnosticsFormat: number): RawHtmlResult;
}

interface WorldCompiler {
  reset(): Promise<void>;
  runWithWorld<T>(
    options: { mainFilePath: string },
    cb: (world: Record<symbol, unknown>) => Promise<T>
  ): Promise<T>;
}

function isHtmlCapableWorld(world: unknown): world is HtmlCapableWorld {
  return (
    typeof world === "object" &&
    world !== null &&
    "html" in world &&
    typeof world.html === "function"
  );
}

async function compileHtmlWithWorldCompiler(
  compiler: WorldCompiler,
  mainFilePath: string
): Promise<TypstCompileResult> {
  await compiler.reset();

  return compiler.runWithWorld({ mainFilePath }, async (world) => {
    const rawWorld = world[kObject];
    if (!isHtmlCapableWorld(rawWorld)) {
      throw new Error(
        "HTML output needs the HTML-capable typst compiler build (g-output=html)"
      );
    }

    const htmlResult = rawWorld.html(DIAGNOSTICS_FULL);
    if (typeof htmlResult.result !== "string") {
      return {
        changeKind: "new",
        diagnostics: htmlResult.diagnostics || [],
        hasError: true,
      } satisfies TypstCompileResult;
    }

    return {
      changeKind: "new",
      diagnostics: [],
      hasError: false,
      html: htmlResult.result,
      title: htmlResult.title,
    } satisfies TypstCompileResult;
  });
}

async function compileWithWorldCompiler(
  compiler: any,
  { mainFilePath, queryPdfpc }: CompileTypstOptions
): Promise<TypstCompileResult> {
  await compiler.reset();

  let result: TypstCompileResult | undefined;
  await compiler.runWithWorld({ mainFilePath }, async (world: any) => {
    const compileResult = (await world.compile()) as {
      hasError?: boolean;
      diagnostics?: DiagnosticMessage[];
    };
    const diagnostics = compileResult.diagnostics || [];
    const hasError =
      compileResult.hasError ||
      (compileResult.hasError === undefined && diagnostics.length > 0);

    if (hasError) {
      result = {
        changeKind: "new",
        diagnostics,
        hasError: true,
      };
      return;
    }

    const vectorResult = (await world.vector()) as {
      result: unknown;
      diagnostics?: DiagnosticMessage[];
    };
    const vectorDiagnostics = vectorResult.diagnostics || [];
    if (vectorDiagnostics.length > 0) {
      result = {
        changeKind: "new",
        diagnostics: vectorDiagnostics,
        hasError: true,
      };
      return;
    }

    result = {
      changeKind: "new",
      diagnostics: [],
      hasError: false,
      pdfpc: queryPdfpc ? await queryPdfpcInWorld(world) : undefined,
      title: typeof world.title === "function" ? world.title() : undefined,
      vector: vectorResult.result,
    };
  });

  if (!result) {
    throw new Error("compiler finished without a result");
  }
  return result;
}

async function compileWithLegacyCompiler(
  compiler: any,
  { mainFilePath, queryPdfpc }: CompileTypstOptions
): Promise<TypstCompileResult> {
  const { result: vector, diagnostics = [] } = await compiler.compile({
    mainFilePath,
    diagnostics: "full",
  });

  if (diagnostics.length > 0) {
    return {
      changeKind: "diff-v1",
      diagnostics,
      hasError: true,
    };
  }

  return {
    changeKind: "diff-v1",
    diagnostics: [],
    hasError: false,
    pdfpc: queryPdfpc
      ? await queryPdfpcInLegacyCompiler(compiler, mainFilePath)
      : undefined,
    vector,
  };
}

async function queryPdfpcInWorld(world: any) {
  try {
    return await world.query({
      selector: "<pdfpc>",
    });
  } catch (e) {
    console.log("this slide does not have pdfpc");
    return undefined;
  }
}

async function queryPdfpcInLegacyCompiler(compiler: any, mainFilePath: string) {
  try {
    return await compiler.query({
      mainFilePath,
      selector: "<pdfpc>",
    });
  } catch (e) {
    console.log("this slide does not have pdfpc");
    return undefined;
  }
}
