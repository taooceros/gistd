import "./typst.ts";

import van, { State } from "vanjs-core";
const { div, button, a } = van.tags;

import { DirectoryView, FsHooks, FsItemState } from "./fs";
import { TypstDocument, Doc, HtmlDoc } from "./doc";
import { argsFromUrl, inputPathOf } from "./args";
import type { OutputFormat } from "./args";
import { pinnedPath } from "./permalink";
import type { StorageSpec } from "./storage";
import { getFontProvider } from "./font";
import { ErrorPanel, DiagnosticMessage } from "./error";
import { compileTypstDocument } from "./typst-compiler";
import { resolveTypstVersion } from "./typst-version";

let $typst = window.$typst;

/// Checks if the browser is in dark mode
const isDarkMode = () =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/// Exports the document
const ExportButton = (title: string, content: string, onclick: () => void) =>
  button({
    onclick,
    title,
    textContent: content,
  });

/// Copies a link that keeps showing what is on screen now: the checked-out
/// commit instead of the branch, and a concrete typst version.
const PermalinkButton = (spec: StorageSpec, fsHooks: FsHooks) => {
  const label = van.state("PermaLink");
  let resetTimer: number | undefined;
  const flash = (text: string) => {
    clearTimeout(resetTimer);
    label.val = text;
    resetTimer = window.setTimeout(() => (label.val = "PermaLink"), 2500);
  };
  return button({
    title: "Copy a permalink pinned to this commit and typst version",
    textContent: label,
    onclick: async () => {
      const url = new URL(window.location.href);
      const oid = await fsHooks.commit?.();
      const pinned = oid && pinnedPath(inputPathOf(url.pathname), spec, oid);
      if (pinned) {
        url.pathname = (import.meta.env.BASE_URL || "/") + pinned;
      }
      url.searchParams.set(
        "g-version",
        resolveTypstVersion(argsFromUrl().version).concreteVersion
      );
      const link = url.toString();
      try {
        await navigator.clipboard.writeText(link);
        flash(pinned || spec.type === "http" ? "Copied" : "Copied (unpinned)");
      } catch {
        window.prompt("Copy the permalink:", link);
      }
    },
  });
};

/// Fetches the latest version of the branch (or URL) and recompiles.
const RefreshButton = (fsHooks: FsHooks) => {
  const label = van.state("Refresh");
  const busy = van.state(false);
  let resetTimer: number | undefined;
  return button({
    title: "Fetch the latest version of the branch and recompile",
    disabled: busy,
    textContent: label,
    onclick: async () => {
      if (!fsHooks.refresh) return;
      clearTimeout(resetTimer);
      busy.val = true;
      label.val = "Refreshing...";
      try {
        label.val = (await fsHooks.refresh()) ? "Updated" : "Up to date";
      } catch (e) {
        console.error("refresh failed", e);
        label.val = "Refresh failed";
      } finally {
        busy.val = false;
        resetTimer = window.setTimeout(() => (label.val = "Refresh"), 2500);
      }
    },
  });
};
const ModeButton = (mode: "slide" | "doc") =>
  button({
    textContent: mode.charAt(0).toUpperCase() + mode.slice(1),
    onclick: () => {
      const newMode = mode === "slide" ? "doc" : "slide";
      const url = new URL(window.location.href);
      url.searchParams.set("g-mode", newMode);
      window.location.href = url.toString();
    },
  });

/// Segmented SVG | HTML switch; the active output is pressed and disabled.
const OutputSwitch = (output: OutputFormat) => {
  const option = (target: OutputFormat, label: string, title: string) =>
    button({
      class: "gistd-output-option",
      title,
      textContent: label,
      "aria-pressed": String(target === output),
      disabled: target === output,
      onclick: () => {
        const url = new URL(window.location.href);
        if (target === "html") {
          url.searchParams.set("g-output", "html");
        } else {
          url.searchParams.delete("g-output");
        }
        window.location.href = url.toString();
      },
    });
  return div(
    { class: "gistd-output-switch", role: "group", "aria-label": "Output format" },
    option("paged", "SVG", "Render pages as SVG"),
    option("html", "HTML", "Render Typst HTML output (typst v0.15.0+)")
  );
};

const fullScreenButton = (mode: "slide" | "doc") => {
  if (mode === "slide") {
    return [
      button({
        onclick: () => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
        },
        textContent: "Full Screen",
      }),
    ];
  }
  return [];
};

const pageControls = ({
  page,
  maxPage,
  mode,
}: {
  page: State<number>;
  maxPage: State<number>;
  mode: "slide" | "doc";
}) => {
  if (mode === "slide") {
    return [
      button({
        onclick: () => {
          page.val = Math.max(Math.min(page.val - 1, maxPage.val), 1);
        },
        textContent: "Prev",
      }),
      button({
        onclick: () => {
          page.val = 1;
        },
        textContent: van.derive(
          () => `${Math.min(page.val, maxPage.val)} / ${maxPage.val}`
        ),
      }),
      button({
        onclick: () => {
          page.val = Math.max(Math.min(page.val + 1, maxPage.val), 1);
        },
        textContent: "Next",
      }),
    ];
  }
  return [];
};

const App = () => {
  /// External status
  const /// Captures compiler load status
    compilerLoaded = van.state(false),
    /// Captures font load status
    fontLoaded = van.state(false),
    /// Binds to filesystem reload event (bumped on every fs (re)load)
    reloadBell = van.state(0),
    /// Sparse checkout hooks, filled in by DirectoryView
    fsHooks: FsHooks = {};
  /// Consecutive recompiles triggered by writing out missing files
  let materializeRounds = 0;
  const {
    /// Creates storage spec from url
    storage,
    page: initialPage,
    mode: requestedMode,
    output,
    fontSpecs,
  } = argsFromUrl();
  /// HTML output has no pages, so slide mode does not apply
  const mode = output === "html" ? "doc" : requestedMode;
  console.log("storage", storage, "page", initialPage, "mode", mode, "output", output);
  document.documentElement.dataset.mode = mode;
  document.documentElement.dataset.output = output;

  /// Styles and outputs
  const /// The source code state
    error = van.state<string | DiagnosticMessage[]>(""),
    /// The dark mode style
    darkMode = van.state(isDarkMode()),
    /// The typst document
    typstDoc = van.state<TypstDocument | undefined>(undefined),
    /// The serialized HTML document (g-output=html)
    htmlOutput = van.state(""),
    /// request to change focus file
    changeFocusFile = van.state<FsItemState | undefined>(undefined),
    /// The current focus file
    focusFile = van.state<FsItemState | undefined>(undefined),
    /// Whether in full screen
    inFullScreen = van.state(false),
    /// The current page
    page = van.state(initialPage),
    /// The maximum page
    maxPage = van.state(0),
    /// The pdfpc data
    pdfpc = van.state<any>(null),
    /// Record first idx for each label
    labelFirstIdx = van.state<Record<string, number>>({}),
    /// Record current visited idx for each label
    labelCurrentIdx = van.state<Record<string, number>>({});

  /// Storage spec (main file path is read at use: git refs resolve later)
  const url = storage.originUrl(),
    fileName = storage.fileName(),
    description = storage.description(),
    removeExtension = fileName.replace(/\.typ$/, "");

  const initializeLabelIndices = () => {
    if (!pdfpc.val || !pdfpc.val.pages) return;

    const firstIdx: Record<string, number> = {};
    const currentIdx: Record<string, number> = {};

    // Find first occurrence of each label
    pdfpc.val.pages.forEach((page: any, idx: number) => {
      const label = page.label;
      if (!(label in firstIdx)) {
        firstIdx[label] = idx;
        currentIdx[label] = idx; // Initialize current to first
      }
    });

    labelFirstIdx.val = firstIdx;
    labelCurrentIdx.val = currentIdx;
  };

  /// Changes Title for Browser History
  document.title = window.location.pathname;
  /// Checks compiler status
  window.$typst$script.then(async () => {
    $typst = window.$typst;

    await $typst.getCompiler();
    compilerLoaded.val = true;
    if ("setFonts" in $typst) {
      const fontInfo = await getFontProvider(fontSpecs);
      console.log("fontInfo", fontInfo);
      // todo: remove me
      // @ts-ignore
      await $typst.setFonts(fontInfo);
    }
    fontLoaded.val = true;
  });

  /// Listens to dark mode change
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener("change", (event) => (darkMode.val = event.matches));

  /// Triggers compilation when precondition is met or changed
  van.derive(async () => {
    try {
      if (
        /// Compiler with fonts should be loaded
        fontLoaded.val &&
        /// Paged renderer should be ready (HTML output renders into a frame)
        (output === "html" || typstDoc.val) &&
        /// Filesystem should be loaded
        reloadBell.val &&
        /// recompile If focus file changed
        focusFile.val &&
        /// recompile If focus file content changed
        focusFile.val.data.val &&
        /// recompile If dark mode changed
        (darkMode.val || !darkMode.val)
      ) {
        console.log("recompilation");

        setTypstTheme(darkMode.val);

        console.log("start compile", storage.mainFilePath());

        const compileResult = await compileTypstDocument($typst, {
          mainFilePath: storage.mainFilePath(),
          queryPdfpc: mode === "slide",
          output,
        });
        console.log("diagnostics", compileResult.diagnostics);
        if (compileResult.hasError) {
          const diagnostics = compileResult.diagnostics || [];
          if (
            materializeRounds < 10 &&
            (await fsHooks.materializeMissing?.(diagnostics))
          ) {
            materializeRounds++;
            console.log("wrote out missing files, recompiling");
            reloadBell.val++;
            return;
          }
          error.val = diagnostics;
          return;
        }
        materializeRounds = 0;

        if (compileResult.vector !== undefined) {
          typstDoc.val?.addChangement([
            compileResult.changeKind,
            compileResult.vector,
          ]);
        }
        if (compileResult.html !== undefined) {
          htmlOutput.val = compileResult.html;
        }
        error.val = "";

        if (compileResult.title) {
          document.title = compileResult.title;
        }

        if (mode === "slide" && compileResult.pdfpc !== undefined) {
          const processedPdfpc = processPdfpc(compileResult.pdfpc);
          pdfpc.val = processedPdfpc;
          // Initialize label indices when new pdfpc data is loaded
          initializeLabelIndices();
          console.log("processed pdfpc", processedPdfpc);
        }
      }
    } catch (e) {
      error.val = e as string;
      console.error(e);
    }
  });

  // Track current page label for history
  van.derive(() => {
    if (mode === "slide" && pdfpc.val && pdfpc.val.pages && page.val > 0) {
      const currentIdx = page.val - 1;
      const pages = pdfpc.val.pages;
      if (currentIdx >= 0 && currentIdx < pages.length) {
        const currentLabel = pages[currentIdx].label;
        labelCurrentIdx.val = {
          ...labelCurrentIdx.val,
          [currentLabel]: currentIdx,
        };
      }
    }
  });

  // slide mode key bindings
  if (mode === "slide") {
    const detectFullScreen = () => {
      if (window.matchMedia("(display-mode: fullscreen)").matches) {
        inFullScreen.val = true;
      } else {
        inFullScreen.val = false;
      }

      console.log("detectFullScreen", inFullScreen.val);
      if (inFullScreen.val) {
        document.documentElement.dataset.fullscreen = "";
      } else {
        delete document.documentElement.dataset.fullscreen;
      }
    };
    document.addEventListener("fullscreenchange", detectFullScreen);
    detectFullScreen();
    // on click
    window.addEventListener("click", (e) => {
      // if in full screen
      if (!inFullScreen.val) {
        return;
      }

      //  if inside #gistd-doc
      if (e.target instanceof HTMLElement && e.target.closest("#gistd-doc")) {
        page.val = Math.max(Math.min(page.val + 1, maxPage.val), 1);
      }
    });
    // full screen and wheel down
    window.addEventListener("wheel", (e) => {
      // if in full screen
      if (!inFullScreen.val) {
        return;
      }

      if (e.deltaY > 0) {
        page.val = Math.max(Math.min(page.val + 1, maxPage.val), 1);
      } else if (e.deltaY < 0) {
        page.val = Math.max(Math.min(page.val - 1, maxPage.val), 1);
      }
    });

    const getNextPageByLabel = (
      currentPage: number,
      direction: "next" | "prev"
    ): number => {
      if (!pdfpc.val || !pdfpc.val.pages) {
        return direction === "next" ? currentPage + 1 : currentPage - 1;
      }
      const pages = pdfpc.val.pages;
      const currentIdx = currentPage - 1; // page.val from 1, idx from 0
      if (currentIdx < 0 || currentIdx >= pages.length) {
        return direction === "next" ? currentPage + 1 : currentPage - 1;
      }
      const currentLabel = pages[currentIdx].label;

      // Record current label's idx
      labelCurrentIdx.val = {
        ...labelCurrentIdx.val,
        [currentLabel]: currentIdx,
      };

      if (direction === "next") {
        for (let i = currentIdx + 1; i < pages.length; i++) {
          if (pages[i].label !== currentLabel) {
            const targetLabel = pages[i].label;
            // Return to last visited idx of this label, or first occurrence if never visited
            const visitedIdx =
              labelCurrentIdx.val[targetLabel] ??
              labelFirstIdx.val[targetLabel] ??
              i;
            return visitedIdx + 1; // back to 1-based
          }
        }
        return currentPage + 1; // fallback
      } else {
        for (let i = currentIdx - 1; i >= 0; i--) {
          if (pages[i].label !== currentLabel) {
            const targetLabel = pages[i].label;
            // Return to last visited idx of this label, or first occurrence if never visited
            const visitedIdx =
              labelCurrentIdx.val[targetLabel] ??
              labelFirstIdx.val[targetLabel] ??
              i;
            return visitedIdx + 1; // back to 1-based
          }
        }
        return currentPage - 1; // fallback
      }
    };

    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const nextPage = getNextPageByLabel(page.val, "prev");
        page.val = Math.max(Math.min(nextPage, maxPage.val), 1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const nextPage = getNextPageByLabel(page.val, "next");
        page.val = Math.max(Math.min(nextPage, maxPage.val), 1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        page.val = Math.max(Math.min(page.val - 1, maxPage.val), 1);
      }
      if (e.key === "ArrowDown" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        page.val = Math.max(Math.min(page.val + 1, maxPage.val), 1);
      }
    });
  }

  const exportAs = (data: string | Uint8Array | undefined, mime: string) => {
    if (!data) {
      return;
    }

    var fileBlob = new Blob([data as any], { type: mime });

    // Create element with <a> tag
    const link = document.createElement("a");

    // name
    link.download =
      mime === "application/pdf"
        ? `${removeExtension}.pdf`
        : `${removeExtension}.html`;

    // Add file content in the object URL
    link.href = URL.createObjectURL(fileBlob);

    // Add file name
    link.target = "_blank";

    // Add click event to <a> tag to save file.
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportPdf = async () => {
    setTypstTheme(false);
    const pdfData = await $typst.pdf({ mainFilePath: storage.mainFilePath() });
    return exportAs(pdfData, "application/pdf");
  };

  DirectoryView({
    storage,
    compilerLoaded,
    changeFocusFile,
    focusFile,
    reloadBell,
    error: error as State<string>,
    fsHooks,
  });

  return div(
    { class: "gistd-main flex-column" },
    div(
      {
        class: "header flex-row",
        style: "justify-content: space-between; margin-bottom: 10px",
      },
      a(
        {
          href: url,
          target: "_blank",
          style:
            "display: flex; align-items: center; text-align: center; text-decoration: underline; padding-left: 10px",
        },
        description
      ),
      div(
        { class: "gistd-toolbar-row flex-row" },
        ErrorPanel({ error }),
        // prev, next
        ...fullScreenButton(mode),
        ...pageControls({ page, maxPage, mode }),

        ExportButton("Compilation Settings", "Settings", () =>
          alert("Not implemented")
        ),
        ExportButton("Export To PDF", "PDF", exportPdf),
        ...(output === "html"
          ? [
              ExportButton("Export To HTML", "Export HTML", () =>
                exportAs(htmlOutput.val, "text/html")
              ),
            ]
          : []),
        RefreshButton(fsHooks),
        PermalinkButton(storage.spec, fsHooks),
        OutputSwitch(output),
        ...(output === "html" ? [] : [ModeButton(mode)])
      )
    ),
    div(
      { class: "doc-row flex-row" },
      output === "html"
        ? HtmlDoc({ compilerLoaded, fontLoaded, html: htmlOutput })
        : Doc({
            inFullScreen,
            maxPage,
            page,
            mode,
            darkMode,
            compilerLoaded,
            fontLoaded,
            typstDoc,
          })
    ),
    div(
      { class: "footer flex-row" },
      div(
        "Powered by ",
        a({ href: "https://typst.app", target: "_blank" }, "Typst"),
        " and ",
        a(
          { href: "https://github.com/Myriad-Dreamin/gistd", target: "_blank" },
          "gistd."
        )
      )
    )
  );

  async function setTypstTheme(darkMode: boolean) {
    let styling = darkMode
      ? `#let prefer-theme = "dark";`
      : `#let prefer-theme = "light";`;
    await $typst.addSource("/.gistd-private/styling.typ", styling);
  }

  function processPdfpc(pdfpc: unknown): any {
    if (!pdfpc || !(pdfpc as any[]).length) {
      return null;
    }
    const arr = (pdfpc as any[]).map((it) => it.value);
    const newSlideIndices = arr
      .map((item, i) => (item.t === "NewSlide" ? i : -1))
      .filter((i) => i >= 0);
    const config =
      newSlideIndices.length > 0 ? arr.slice(0, newSlideIndices[0]) : arr;
    const slides: any[][] = [];
    for (let i = 0; i < newSlideIndices.length - 1; i++) {
      slides.push(arr.slice(newSlideIndices[i] + 1, newSlideIndices[i + 1]));
    }
    if (newSlideIndices.length > 0) {
      slides.push(arr.slice(newSlideIndices[newSlideIndices.length - 1] + 1));
    }
    const pdfpcObj: any = {
      pdfpcFormat: 2,
      disableMarkdown: false,
    };
    for (const item of config) {
      const key = item.t.charAt(0).toLowerCase() + item.t.slice(1);
      pdfpcObj[key] = item.v;
    }
    const pages: any[] = [];
    for (const slide of slides) {
      const page: any = {
        idx: 0,
        label: "1",
        overlay: 0,
        forcedOverlay: false,
        hidden: false,
      };
      for (const item of slide) {
        if (item.t === "Idx") {
          page.idx = item.v;
        } else if (item.t === "LogicalSlide") {
          page.label = String(item.v);
        } else if (item.t === "Overlay") {
          page.overlay = item.v;
          page.forcedOverlay = item.v > 0;
        } else if (item.t === "HiddenSlide") {
          page.hidden = true;
        } else if (item.t === "SaveSlide") {
          if (!("savedSlide" in pdfpcObj)) {
            pdfpcObj.savedSlide = Number(page.label) - 1;
          }
        } else if (item.t === "EndSlide") {
          if (!("endSlide" in pdfpcObj)) {
            pdfpcObj.endSlide = Number(page.label) - 1;
          }
        } else if (item.t === "Note") {
          page.note = item.v;
        } else {
          const key = item.t.charAt(0).toLowerCase() + item.t.slice(1);
          pdfpcObj[key] = item.v;
        }
      }
      pages.push(page);
    }
    pdfpcObj.pages = pages;
    return pdfpcObj;
  }
};

van.add(document.querySelector("#app")!, App());
