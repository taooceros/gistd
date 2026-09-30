/// Mounts Typst HTML output directly into the gistd page (`g-output=html`).
///
/// The document body goes into a shadow root, so the document's own `<style>`
/// sheets stay scoped to it and gistd's CSS does not restyle it. Documents come
/// from arbitrary URLs and run on the gistd origin, so active content is
/// stripped: `<script>` and similar elements, `on*` handler attributes, and
/// `javascript:` URLs.

/// Elements that execute code, load nested browsing contexts, or change how
/// the page resolves URLs.
const BLOCKED_ELEMENTS =
  "script, noscript, iframe, frame, frameset, object, embed, applet, base, meta, portal";

/// Attributes whose value is loaded or navigated to as a URL.
const URL_ATTRIBUTES: Record<string, true> = {
  href: true,
  src: true,
  srcset: true,
  action: true,
  formaction: true,
  "xlink:href": true,
  poster: true,
  data: true,
};

/// Neutralizes active content in place.
function sanitize(root: ParentNode) {
  for (const el of root.querySelectorAll(BLOCKED_ELEMENTS)) {
    el.remove();
  }
  for (const el of root.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      const lower = name.toLowerCase();
      const isScriptUrl =
        URL_ATTRIBUTES[lower] &&
        // Browsers ignore whitespace/control characters inside the scheme.
        /^(?:javascript|vbscript|data:text\/html)/i.test(
          value.replace(/[\u0000-\u0020]+/g, "")
        );
      if (lower.startsWith("on") || isScriptUrl) {
        el.removeAttribute(name);
      }
    }
  }
}

/// Resets inherited gistd styles so the document looks as it would standalone.
const HOST_STYLE = `:host {
  all: initial;
  display: block;
  background: white;
  color: black;
  color-scheme: light;
  /* Browser default is serif; documents can still override via their CSS. */
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  line-height: 1.5;
}
.gistd-html-body {
  display: block;
  margin: 8px;
}`;

export function mountHtmlOutput(host: HTMLElement, html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  sanitize(parsed);

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const hostStyle = document.createElement("style");
  hostStyle.textContent = HOST_STYLE;

  const body = document.createElement("div");
  for (const { name, value } of [...parsed.body.attributes]) {
    body.setAttribute(name, value);
  }
  body.classList.add("gistd-html-body");
  body.append(...document.adoptNode(parsed.body).childNodes);

  shadow.replaceChildren(
    hostStyle,
    ...[...parsed.head.querySelectorAll("style, link[rel~='stylesheet']")].map(
      (node) => document.adoptNode(node)
    ),
    body
  );

  if (!host.dataset.linksBound) {
    host.dataset.linksBound = "";
    shadow.addEventListener("click", (event) => {
      const link =
        event.target instanceof Element && event.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      if (href.startsWith("#")) {
        // Fragment targets live in the shadow root, which the browser's
        // own fragment navigation does not search.
        event.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        shadow.getElementById(id)?.scrollIntoView();
        history.replaceState(null, "", href);
      } else {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    });
  }
}
