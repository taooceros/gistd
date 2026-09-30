import van, { State } from "vanjs-core";
import type {
  TypstRenderer,
  RenderSession,
} from "typst.ts-0.14/dist/esm/renderer.mjs";
import { TypstDomDocument } from "./dom";
import { MountDomOptions } from "typst.ts-0.14/dist/esm/options.render.mjs";
import { RenderInSessionOptions } from "typst.ts-0.14/dist/esm/options.render.mjs";

const { div, iframe } = van.tags;

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

/// Message type posted by {@link HTML_FRAME_HELPER} with the content height.
const HTML_FRAME_HEIGHT_MESSAGE = "gistd-html-height";

/// Injected into the HTML output: reports content height to the parent so the
/// frame grows with the document, and opens non-fragment links in a new tab
/// (the sandboxed frame cannot navigate the gistd page itself).
const HTML_FRAME_HELPER = `<script>(() => {
  const post = () => parent.postMessage({ type: "${HTML_FRAME_HEIGHT_MESSAGE}", height: document.documentElement.scrollHeight }, "*");
  addEventListener("load", post);
  new ResizeObserver(post).observe(document.documentElement);
  addEventListener("click", (e) => {
    const a = e.target instanceof Element && e.target.closest("a[href]");
    if (a && !a.getAttribute("href").startsWith("#")) a.target = "_blank";
  });
})();</script>`;

function withFrameHelper(html: string) {
  const head = /<head[^>]*>/i.exec(html);
  if (!head) {
    return HTML_FRAME_HELPER + html;
  }
  const at = head.index + head[0].length;
  return html.slice(0, at) + HTML_FRAME_HELPER + html.slice(at);
}

/// Displays Typst HTML output in a sandboxed frame (`g-output=html`).
export const HtmlDoc = ({ compilerLoaded, fontLoaded, html }: HtmlDocState) => {
  const frame = iframe({
    class: "gistd-html-frame",
    title: "Typst HTML output",
    // No allow-same-origin: document scripts cannot reach the gistd page.
    sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox",
  }) as HTMLIFrameElement;

  window.addEventListener("message", (event) => {
    if (
      event.source === frame.contentWindow &&
      event.data?.type === HTML_FRAME_HEIGHT_MESSAGE &&
      typeof event.data.height === "number"
    ) {
      frame.style.height = `${event.data.height}px`;
    }
  });

  van.derive(() => {
    if (html.val) {
      frame.srcdoc = withFrameHelper(html.val);
    }
  });

  const status = van.derive(() => {
    if (!compilerLoaded.val) return "Loading compiler from CDN...";
    if (!fontLoaded.val) return "Loading fonts from CDN...";
    if (!html.val) return "Compiling HTML...";
    return "";
  });

  return div(
    { id: "gistd-doc" },
    div({ hidden: () => !status.val }, status),
    frame
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
