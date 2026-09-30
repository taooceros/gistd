import van, { State } from "vanjs-core";
import type {
  TypstRenderer,
  RenderSession,
} from "typst.ts-0.14/dist/esm/renderer.mjs";
import { TypstDomDocument } from "./dom";
import { collectHeadings, mountHtmlOutput } from "./html-output";
import type { OutputHeading } from "./html-output";
import { MountDomOptions } from "typst.ts-0.14/dist/esm/options.render.mjs";
import { RenderInSessionOptions } from "typst.ts-0.14/dist/esm/options.render.mjs";

const { div, details, summary, ul, li, a } = van.tags;

export class TypstDocument {
  doc: TypstDomDocument = undefined!;
  constructor(
    public elem: HTMLDivElement,
    public plugin: TypstRenderer,
    public kModule: RenderSession
  ) {
    window.addEventListener("scroll", () => {
      this.doc.addViewportChange();
    });
  }

  setPageColor(_color: string) {
    // todo: dark theme
    this.doc.setPageColor("white");
  }

  addChangement(changement: [string, any]) {
    console.log("addChangement", this.elem, changement);
    this.doc.addChangement(changement);
  }
}

export interface DocState {
  maxPage?: State<number>;
  inFullScreen?: State<boolean>;
  page?: State<number>;
  mode?: "slide" | "doc";
  darkMode: State<boolean>;
  compilerLoaded: State<boolean>;
  fontLoaded: State<boolean>;
  typstDoc: State<TypstDocument | undefined>;
}

/// The document component
export const Doc = ({
  inFullScreen,
  maxPage,
  page,
  mode,
  darkMode,
  compilerLoaded,
  fontLoaded,
  typstDoc,
}: DocState) => {
  const docRef = van.state<HTMLDivElement | undefined>(undefined);
  const kModule = van.state<RenderSession | undefined>(undefined);

  /// Creates a render session
  van.derive(
    async () =>
      fontLoaded.val &&
      (await window.$typst.getRenderer()).runWithSession(
        (m: RenderSession) /* module kernel from wasm */ => {
          return new Promise(async (kModuleDispose) => {
            kModule.val = m;
            /// simply let session leak
            void kModuleDispose;
          });
        }
      )
  );

  /// Creates a TypstDocument
  van.derive(async () => {
    if (!(kModule.val && docRef.val)) {
      return;
    }

    if (typstDoc.val) {
      return;
    }

    const hookedElem = docRef.val!;
    if (hookedElem.firstElementChild?.tagName !== "svg") {
      hookedElem.innerHTML = "";
    }
    const doc = new TypstDocument(
      hookedElem,
      await window.$typst.getRenderer(),
      kModule.val!
    );

    doc.doc = await renderDom(doc.plugin, {
      inFullScreen,
      maxPage,
      page: page?.val || 0,
      mode,
      renderSession: doc.kModule,
      container: doc.elem,
      pixelPerPt: 4.5,
      domScale: 1.5,
    });
    van.derive(() => {
      console.log("setPartialPageNumber", page?.val || 0);
      doc.doc.setPartialPageNumber(page?.val || 0);
    });

    typstDoc.val = doc;

    /// Responds to dark mode change
    van.derive(() => doc.setPageColor(darkMode.val ? "#242424" : "white"));
  });

  return div({ id: "gistd-doc" }, (dom?: Element) => {
    dom ||= div();
    if (!compilerLoaded.val) {
      dom.textContent = "Loading compiler from CDN...";
    } else if (!fontLoaded.val) {
      dom.textContent = "Loading fonts from CDN...";
    } else {
      dom.textContent = "";
      /// Catches a new reference to dom
      docRef.val = dom as HTMLDivElement;
    }
    return dom;
  });
};

export interface HtmlDocState {
  compilerLoaded: State<boolean>;
  fontLoaded: State<boolean>;
  /// Serialized HTML document produced by the compiler.
  html: State<string>;
}

/// Documents with fewer headings get no table of contents.
const MIN_TOC_HEADINGS = 3;

/// Displays Typst HTML output inline in the page (`g-output=html`), with a
/// table of contents built from its headings.
export const HtmlDoc = ({ compilerLoaded, fontLoaded, html }: HtmlDocState) => {
  const body = div({ class: "gistd-html-output" });
  const headings = van.state<OutputHeading[]>([]);

  van.derive(() => {
    if (html.val) {
      mountHtmlOutput(body, html.val);
      headings.val = collectHeadings(body);
    }
  });

  const status = van.derive(() => {
    if (!compilerLoaded.val) return "Loading compiler from CDN...";
    if (!fontLoaded.val) return "Loading fonts from CDN...";
    if (!html.val) return "Compiling HTML...";
    return "";
  });

  // Kept across recompiles so its open/closed state survives refreshes.
  const toc = details(
    {
      class: "gistd-html-toc",
      open: window.matchMedia?.("(min-width: 1200px)").matches ?? false,
      hidden: () => headings.val.length < MIN_TOC_HEADINGS,
    },
    summary("Contents"),
    () =>
      ul(
        headings.val.map((h) =>
          li(
            { style: `padding-left: ${(h.level - 1) * 0.9}em` },
            a(
              {
                href: h.element.id ? `#${h.element.id}` : "#",
                onclick: (event: Event) => {
                  event.preventDefault();
                  h.element.scrollIntoView({ block: "start" });
                  if (h.element.id) {
                    history.replaceState(history.state, "", `#${h.element.id}`);
                  }
                },
              },
              h.text
            )
          )
        )
      )
  );

  return div(
    { id: "gistd-doc" },
    div({ hidden: () => !status.val }, status),
    div({ class: "gistd-html-layout" }, toc, body)
  );
};

async function renderDom(renderer: TypstRenderer, options: RenderDomOptions) {
  const t = new TypstDomDocument({
    ...options,
    renderMode: "dom",
    hookedElem: options.container,
    kModule: options.renderSession,
    renderer: renderer,
  });
  await t.impl.mountDom(options.pixelPerPt);
  return t;
}

interface UserRenderDomOptions {
  page?: number;
  mode?: "slide" | "doc";
}

interface RenderDomOptions
  extends RenderInSessionOptions<MountDomOptions>,
    UserRenderDomOptions {
  maxPage?: State<number>;
  inFullScreen?: State<boolean>;
}
