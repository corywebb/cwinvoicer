// A tiny element builder: h('button', { class: 'primary', onclick }, 'Save').

/** Event handlers read the control that fired them (inputs, selects, buttons). */
export type UIEvent = Event & { target: HTMLInputElement };
export type Handler = (ev: UIEvent) => unknown;

/** `on*` keys are event listeners; known DOM properties are set directly; everything else is an attribute. */
export type Props = { [k: `on${string}`]: Handler | null | undefined | false } & { [k: string]: unknown };

/** Children: nodes and text. null, undefined and false render nothing; arrays are flattened. */
export type Kid = Node | string | number | boolean | null | undefined | Kid[];

const PROPERTIES = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'srcdoc']);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.style.cssText = String(v);
    else if (PROPERTIES.has(k)) Reflect.set(el, k, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of (kids as unknown[]).flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

/** Wraps data tables so they scroll sideways on narrow screens. Safe to call again after partial updates. */
export function scrollTables(root: ParentNode): void {
  root.querySelectorAll('table.data').forEach((table) => {
    if (table.parentElement?.classList.contains('table-scroll')) return;
    const wrap = h('div', { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': 'Scrollable data table' });
    table.replaceWith(wrap);
    wrap.append(table);
  });
}

/** An element from the static page shell (index.html). */
export function shell<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector} in index.html`);
  return el;
}
