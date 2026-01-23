/**
 * @since 1.0.0
 * JSX Type Definitions for effect-ui
 *
 * This module provides TypeScript type definitions for JSX elements.
 */
import type { Effect } from "effect";
import type {
  Element,
  ElementProps,
  EventHandler,
  ElementKey,
  MaybeSignal,
} from "./primitives/element.js";

export namespace JSX {
  /**
   * The type returned by JSX expressions
   */
  export type Element = import("./element.js").Element;

  /**
   * Props that can be passed to intrinsic elements
   */
  export interface IntrinsicAttributes {
    readonly key?: ElementKey;
  }

  /**
   * Base HTML element props
   */
  interface HTMLAttributes extends ElementProps {
    // All HTML attributes are already in ElementProps
  }

  /**
   * Anchor element props
   */
  interface AnchorHTMLAttributes extends HTMLAttributes {
    readonly href?: string;
    readonly target?: "_blank" | "_self" | "_parent" | "_top";
    readonly rel?: string;
    readonly download?: string | boolean;
  }

  /**
   * Button element props
   */
  interface ButtonHTMLAttributes extends HTMLAttributes {
    readonly type?: "button" | "submit" | "reset";
    readonly disabled?: boolean;
    readonly form?: string;
    readonly formAction?: string;
    readonly formMethod?: string;
    readonly formNoValidate?: boolean;
    readonly formTarget?: string;
  }

  /**
   * Form element props
   */
  interface FormHTMLAttributes extends HTMLAttributes {
    readonly action?: string;
    readonly method?: "get" | "post";
    readonly encType?: string;
    readonly target?: string;
    readonly noValidate?: boolean;
    readonly autoComplete?: "on" | "off";
  }

  /**
   * Input element props
   *
   * Props like `value` and `checked` can accept Signals for fine-grained reactivity.
   * When you pass a Signal, the input updates directly without re-rendering the component.
   */
  interface InputHTMLAttributes extends HTMLAttributes {
    readonly type?:
      | "text"
      | "password"
      | "email"
      | "number"
      | "tel"
      | "url"
      | "search"
      | "date"
      | "time"
      | "datetime-local"
      | "month"
      | "week"
      | "color"
      | "file"
      | "hidden"
      | "checkbox"
      | "radio"
      | "range"
      | "submit"
      | "reset"
      | "button";
    // Note: Using union of individual Signal types due to invariance
    readonly value?:
      | string
      | number
      | readonly string[]
      | import("./signal.js").Signal<string>
      | import("./signal.js").Signal<number>
      | import("./signal.js").Signal<readonly string[]>;
    readonly defaultValue?: string | number | readonly string[];
    readonly checked?: MaybeSignal<boolean>;
    readonly defaultChecked?: boolean;
    readonly accept?: string;
    readonly multiple?: boolean;
    readonly capture?: boolean | "user" | "environment";
  }

  /**
   * Label element props
   */
  interface LabelHTMLAttributes extends HTMLAttributes {
    readonly htmlFor?: string;
  }

  /**
   * Select element props
   */
  interface SelectHTMLAttributes extends HTMLAttributes {
    readonly value?: string | number | readonly string[];
    readonly defaultValue?: string | number | readonly string[];
    readonly multiple?: boolean;
  }

  /**
   * Textarea element props
   */
  interface TextareaHTMLAttributes extends HTMLAttributes {
    readonly value?: string;
    readonly defaultValue?: string;
    readonly rows?: number;
    readonly cols?: number;
    readonly wrap?: "hard" | "soft" | "off";
  }

  /**
   * Image element props
   */
  interface ImgHTMLAttributes extends HTMLAttributes {
    readonly src?: string;
    readonly srcSet?: string;
    readonly sizes?: string;
    readonly alt?: string;
    readonly loading?: "eager" | "lazy";
    readonly decoding?: "async" | "auto" | "sync";
    readonly crossOrigin?: "anonymous" | "use-credentials";
  }

  /**
   * Table element props
   */
  interface TableHTMLAttributes extends HTMLAttributes {
    readonly cellPadding?: number | string;
    readonly cellSpacing?: number | string;
  }

  /**
   * Table cell props (th, td)
   */
  interface TdHTMLAttributes extends HTMLAttributes {
    readonly colSpan?: number;
    readonly rowSpan?: number;
    readonly headers?: string;
    readonly scope?: "col" | "row" | "colgroup" | "rowgroup";
  }

  /**
   * SVG element props
   */
  interface SVGAttributes extends HTMLAttributes {
    readonly viewBox?: string;
    readonly xmlns?: string;
    readonly fill?: string;
    readonly stroke?: string;
    readonly strokeWidth?: number | string;
    readonly d?: string;
    readonly cx?: number | string;
    readonly cy?: number | string;
    readonly r?: number | string;
    readonly x?: number | string;
    readonly y?: number | string;
    readonly x1?: number | string;
    readonly y1?: number | string;
    readonly x2?: number | string;
    readonly y2?: number | string;
    readonly points?: string;
    readonly transform?: string;
    readonly pathLength?: number;
  }

  /**
   * Intrinsic elements - maps HTML tag names to their prop types
   */
  export interface IntrinsicElements {
    // Document sections
    html: HTMLAttributes;
    head: HTMLAttributes;
    body: HTMLAttributes;
    title: HTMLAttributes;
    meta: HTMLAttributes;
    link: HTMLAttributes;
    script: HTMLAttributes;
    style: HTMLAttributes;

    // Content sectioning
    header: HTMLAttributes;
    footer: HTMLAttributes;
    main: HTMLAttributes;
    nav: HTMLAttributes;
    section: HTMLAttributes;
    article: HTMLAttributes;
    aside: HTMLAttributes;
    h1: HTMLAttributes;
    h2: HTMLAttributes;
    h3: HTMLAttributes;
    h4: HTMLAttributes;
    h5: HTMLAttributes;
    h6: HTMLAttributes;
    address: HTMLAttributes;

    // Text content
    div: HTMLAttributes;
    p: HTMLAttributes;
    pre: HTMLAttributes;
    blockquote: HTMLAttributes;
    ol: HTMLAttributes;
    ul: HTMLAttributes;
    li: HTMLAttributes;
    dl: HTMLAttributes;
    dt: HTMLAttributes;
    dd: HTMLAttributes;
    figure: HTMLAttributes;
    figcaption: HTMLAttributes;
    hr: HTMLAttributes;

    // Inline text
    span: HTMLAttributes;
    a: AnchorHTMLAttributes;
    em: HTMLAttributes;
    strong: HTMLAttributes;
    small: HTMLAttributes;
    s: HTMLAttributes;
    cite: HTMLAttributes;
    q: HTMLAttributes;
    code: HTMLAttributes;
    kbd: HTMLAttributes;
    sub: HTMLAttributes;
    sup: HTMLAttributes;
    i: HTMLAttributes;
    b: HTMLAttributes;
    u: HTMLAttributes;
    mark: HTMLAttributes;
    ruby: HTMLAttributes;
    rt: HTMLAttributes;
    rp: HTMLAttributes;
    bdi: HTMLAttributes;
    bdo: HTMLAttributes;
    br: HTMLAttributes;
    wbr: HTMLAttributes;

    // Forms
    form: FormHTMLAttributes;
    input: InputHTMLAttributes;
    button: ButtonHTMLAttributes;
    select: SelectHTMLAttributes;
    textarea: TextareaHTMLAttributes;
    label: LabelHTMLAttributes;
    fieldset: HTMLAttributes;
    legend: HTMLAttributes;
    datalist: HTMLAttributes;
    option: HTMLAttributes;
    optgroup: HTMLAttributes;
    output: HTMLAttributes;
    progress: HTMLAttributes;
    meter: HTMLAttributes;

    // Tables
    table: TableHTMLAttributes;
    thead: HTMLAttributes;
    tbody: HTMLAttributes;
    tfoot: HTMLAttributes;
    tr: HTMLAttributes;
    th: TdHTMLAttributes;
    td: TdHTMLAttributes;
    caption: HTMLAttributes;
    colgroup: HTMLAttributes;
    col: HTMLAttributes;

    // Media
    img: ImgHTMLAttributes;
    audio: HTMLAttributes;
    video: HTMLAttributes;
    source: HTMLAttributes;
    track: HTMLAttributes;
    picture: HTMLAttributes;
    iframe: HTMLAttributes;
    embed: HTMLAttributes;
    object: HTMLAttributes;
    param: HTMLAttributes;
    canvas: HTMLAttributes;
    map: HTMLAttributes;
    area: HTMLAttributes;

    // Interactive
    details: HTMLAttributes;
    summary: HTMLAttributes;
    dialog: HTMLAttributes;
    menu: HTMLAttributes;

    // SVG
    svg: SVGAttributes;
    path: SVGAttributes;
    circle: SVGAttributes;
    ellipse: SVGAttributes;
    line: SVGAttributes;
    polygon: SVGAttributes;
    polyline: SVGAttributes;
    rect: SVGAttributes;
    g: SVGAttributes;
    defs: SVGAttributes;
    use: SVGAttributes;
    text: SVGAttributes;
    tspan: SVGAttributes;
    image: SVGAttributes;
    clipPath: SVGAttributes;
    mask: SVGAttributes;
    pattern: SVGAttributes;
    linearGradient: SVGAttributes;
    radialGradient: SVGAttributes;
    stop: SVGAttributes;
    symbol: SVGAttributes;
    marker: SVGAttributes;
    foreignObject: SVGAttributes;

    // Web Components
    slot: HTMLAttributes;
    template: HTMLAttributes;
  }

  /**
   * Element children type
   */
  export type ElementChildrenAttribute = {
    children: {};
  };
}

// Re-export JSX namespace for use with jsxImportSource
export { JSX };

declare global {
  namespace JSX {
    type Element = import("./element.js").Element;

    interface IntrinsicAttributes {
      readonly key?: import("./element.js").ElementKey;
    }

    interface IntrinsicElements {
      // Document sections
      html: import("./element.js").ElementProps;
      head: import("./element.js").ElementProps;
      body: import("./element.js").ElementProps;
      title: import("./element.js").ElementProps;
      meta: import("./element.js").ElementProps;
      link: import("./element.js").ElementProps;
      script: import("./element.js").ElementProps;
      style: import("./element.js").ElementProps;

      // Content sectioning
      header: import("./element.js").ElementProps;
      footer: import("./element.js").ElementProps;
      main: import("./element.js").ElementProps;
      nav: import("./element.js").ElementProps;
      section: import("./element.js").ElementProps;
      article: import("./element.js").ElementProps;
      aside: import("./element.js").ElementProps;
      h1: import("./element.js").ElementProps;
      h2: import("./element.js").ElementProps;
      h3: import("./element.js").ElementProps;
      h4: import("./element.js").ElementProps;
      h5: import("./element.js").ElementProps;
      h6: import("./element.js").ElementProps;
      address: import("./element.js").ElementProps;

      // Text content
      div: import("./element.js").ElementProps;
      p: import("./element.js").ElementProps;
      pre: import("./element.js").ElementProps;
      blockquote: import("./element.js").ElementProps;
      ol: import("./element.js").ElementProps;
      ul: import("./element.js").ElementProps;
      li: import("./element.js").ElementProps;
      dl: import("./element.js").ElementProps;
      dt: import("./element.js").ElementProps;
      dd: import("./element.js").ElementProps;
      figure: import("./element.js").ElementProps;
      figcaption: import("./element.js").ElementProps;
      hr: import("./element.js").ElementProps;

      // Inline text
      span: import("./element.js").ElementProps;
      a: import("./element.js").ElementProps;
      em: import("./element.js").ElementProps;
      strong: import("./element.js").ElementProps;
      small: import("./element.js").ElementProps;
      s: import("./element.js").ElementProps;
      cite: import("./element.js").ElementProps;
      q: import("./element.js").ElementProps;
      code: import("./element.js").ElementProps;
      kbd: import("./element.js").ElementProps;
      sub: import("./element.js").ElementProps;
      sup: import("./element.js").ElementProps;
      i: import("./element.js").ElementProps;
      b: import("./element.js").ElementProps;
      u: import("./element.js").ElementProps;
      mark: import("./element.js").ElementProps;
      ruby: import("./element.js").ElementProps;
      rt: import("./element.js").ElementProps;
      rp: import("./element.js").ElementProps;
      bdi: import("./element.js").ElementProps;
      bdo: import("./element.js").ElementProps;
      br: import("./element.js").ElementProps;
      wbr: import("./element.js").ElementProps;

      // Forms
      form: import("./element.js").ElementProps;
      input: import("./element.js").ElementProps;
      button: import("./element.js").ElementProps;
      select: import("./element.js").ElementProps;
      textarea: import("./element.js").ElementProps;
      label: import("./element.js").ElementProps;
      fieldset: import("./element.js").ElementProps;
      legend: import("./element.js").ElementProps;
      datalist: import("./element.js").ElementProps;
      option: import("./element.js").ElementProps;
      optgroup: import("./element.js").ElementProps;
      output: import("./element.js").ElementProps;
      progress: import("./element.js").ElementProps;
      meter: import("./element.js").ElementProps;

      // Tables
      table: import("./element.js").ElementProps;
      thead: import("./element.js").ElementProps;
      tbody: import("./element.js").ElementProps;
      tfoot: import("./element.js").ElementProps;
      tr: import("./element.js").ElementProps;
      th: import("./element.js").ElementProps;
      td: import("./element.js").ElementProps;
      caption: import("./element.js").ElementProps;
      colgroup: import("./element.js").ElementProps;
      col: import("./element.js").ElementProps;

      // Media
      img: import("./element.js").ElementProps;
      audio: import("./element.js").ElementProps;
      video: import("./element.js").ElementProps;
      source: import("./element.js").ElementProps;
      track: import("./element.js").ElementProps;
      picture: import("./element.js").ElementProps;
      iframe: import("./element.js").ElementProps;
      embed: import("./element.js").ElementProps;
      object: import("./element.js").ElementProps;
      param: import("./element.js").ElementProps;
      canvas: import("./element.js").ElementProps;
      map: import("./element.js").ElementProps;
      area: import("./element.js").ElementProps;

      // Interactive
      details: import("./element.js").ElementProps;
      summary: import("./element.js").ElementProps;
      dialog: import("./element.js").ElementProps;
      menu: import("./element.js").ElementProps;

      // SVG
      svg: import("./element.js").ElementProps;
      path: import("./element.js").ElementProps;
      circle: import("./element.js").ElementProps;
      ellipse: import("./element.js").ElementProps;
      line: import("./element.js").ElementProps;
      polygon: import("./element.js").ElementProps;
      polyline: import("./element.js").ElementProps;
      rect: import("./element.js").ElementProps;
      g: import("./element.js").ElementProps;
      defs: import("./element.js").ElementProps;
      use: import("./element.js").ElementProps;
      text: import("./element.js").ElementProps;
      tspan: import("./element.js").ElementProps;
      image: import("./element.js").ElementProps;
      clipPath: import("./element.js").ElementProps;
      mask: import("./element.js").ElementProps;
      pattern: import("./element.js").ElementProps;
      linearGradient: import("./element.js").ElementProps;
      radialGradient: import("./element.js").ElementProps;
      stop: import("./element.js").ElementProps;
      symbol: import("./element.js").ElementProps;
      marker: import("./element.js").ElementProps;
      foreignObject: import("./element.js").ElementProps;

      // Web Components
      slot: import("./element.js").ElementProps;
      template: import("./element.js").ElementProps;
    }

    interface ElementChildrenAttribute {
      children: {};
    }
  }
}
