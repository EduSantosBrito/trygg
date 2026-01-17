/**
 * @since 1.0.0
 * JSX Type Definitions for effect-ui
 * 
 * This module provides TypeScript type definitions for JSX elements.
 */
import type { Effect } from "effect"
import type { Element, ElementProps, EventHandler, ElementKey, MaybeSignal } from "./Element.js"

export namespace JSX {
  /**
   * The type returned by JSX expressions
   */
  export type Element = import("./Element.js").Element

  /**
   * Props that can be passed to intrinsic elements
   */
  export interface IntrinsicAttributes {
    readonly key?: ElementKey
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
    readonly href?: string
    readonly target?: "_blank" | "_self" | "_parent" | "_top"
    readonly rel?: string
    readonly download?: string | boolean
  }

  /**
   * Button element props
   */
  interface ButtonHTMLAttributes extends HTMLAttributes {
    readonly type?: "button" | "submit" | "reset"
    readonly disabled?: boolean
    readonly form?: string
    readonly formAction?: string
    readonly formMethod?: string
    readonly formNoValidate?: boolean
    readonly formTarget?: string
  }

  /**
   * Form element props
   */
  interface FormHTMLAttributes extends HTMLAttributes {
    readonly action?: string
    readonly method?: "get" | "post"
    readonly encType?: string
    readonly target?: string
    readonly noValidate?: boolean
    readonly autoComplete?: "on" | "off"
  }

  /**
   * Input element props
   * 
   * Props like `value` and `checked` can accept Signals for fine-grained reactivity.
   * When you pass a Signal, the input updates directly without re-rendering the component.
   */
  interface InputHTMLAttributes extends HTMLAttributes {
    readonly type?: "text" | "password" | "email" | "number" | "tel" | "url" | "search" | "date" | "time" | "datetime-local" | "month" | "week" | "color" | "file" | "hidden" | "checkbox" | "radio" | "range" | "submit" | "reset" | "button"
    // Note: Using union of individual Signal types due to invariance
    readonly value?: string | number | readonly string[] | import("./Signal.js").Signal<string> | import("./Signal.js").Signal<number> | import("./Signal.js").Signal<readonly string[]>
    readonly defaultValue?: string | number | readonly string[]
    readonly checked?: MaybeSignal<boolean>
    readonly defaultChecked?: boolean
    readonly accept?: string
    readonly multiple?: boolean
    readonly capture?: boolean | "user" | "environment"
  }

  /**
   * Label element props
   */
  interface LabelHTMLAttributes extends HTMLAttributes {
    readonly htmlFor?: string
  }

  /**
   * Select element props
   */
  interface SelectHTMLAttributes extends HTMLAttributes {
    readonly value?: string | number | readonly string[]
    readonly defaultValue?: string | number | readonly string[]
    readonly multiple?: boolean
  }

  /**
   * Textarea element props
   */
  interface TextareaHTMLAttributes extends HTMLAttributes {
    readonly value?: string
    readonly defaultValue?: string
    readonly rows?: number
    readonly cols?: number
    readonly wrap?: "hard" | "soft" | "off"
  }

  /**
   * Image element props
   */
  interface ImgHTMLAttributes extends HTMLAttributes {
    readonly src?: string
    readonly srcSet?: string
    readonly sizes?: string
    readonly alt?: string
    readonly loading?: "eager" | "lazy"
    readonly decoding?: "async" | "auto" | "sync"
    readonly crossOrigin?: "anonymous" | "use-credentials"
  }

  /**
   * Table element props
   */
  interface TableHTMLAttributes extends HTMLAttributes {
    readonly cellPadding?: number | string
    readonly cellSpacing?: number | string
  }

  /**
   * Table cell props (th, td)
   */
  interface TdHTMLAttributes extends HTMLAttributes {
    readonly colSpan?: number
    readonly rowSpan?: number
    readonly headers?: string
    readonly scope?: "col" | "row" | "colgroup" | "rowgroup"
  }

  /**
   * SVG element props
   */
  interface SVGAttributes extends HTMLAttributes {
    readonly viewBox?: string
    readonly xmlns?: string
    readonly fill?: string
    readonly stroke?: string
    readonly strokeWidth?: number | string
    readonly d?: string
    readonly cx?: number | string
    readonly cy?: number | string
    readonly r?: number | string
    readonly x?: number | string
    readonly y?: number | string
    readonly x1?: number | string
    readonly y1?: number | string
    readonly x2?: number | string
    readonly y2?: number | string
    readonly points?: string
    readonly transform?: string
    readonly pathLength?: number
  }

  /**
   * Intrinsic elements - maps HTML tag names to their prop types
   */
  export interface IntrinsicElements {
    // Document sections
    html: HTMLAttributes
    head: HTMLAttributes
    body: HTMLAttributes
    title: HTMLAttributes
    meta: HTMLAttributes
    link: HTMLAttributes
    script: HTMLAttributes
    style: HTMLAttributes

    // Content sectioning
    header: HTMLAttributes
    footer: HTMLAttributes
    main: HTMLAttributes
    nav: HTMLAttributes
    section: HTMLAttributes
    article: HTMLAttributes
    aside: HTMLAttributes
    h1: HTMLAttributes
    h2: HTMLAttributes
    h3: HTMLAttributes
    h4: HTMLAttributes
    h5: HTMLAttributes
    h6: HTMLAttributes
    address: HTMLAttributes

    // Text content
    div: HTMLAttributes
    p: HTMLAttributes
    pre: HTMLAttributes
    blockquote: HTMLAttributes
    ol: HTMLAttributes
    ul: HTMLAttributes
    li: HTMLAttributes
    dl: HTMLAttributes
    dt: HTMLAttributes
    dd: HTMLAttributes
    figure: HTMLAttributes
    figcaption: HTMLAttributes
    hr: HTMLAttributes

    // Inline text
    span: HTMLAttributes
    a: AnchorHTMLAttributes
    em: HTMLAttributes
    strong: HTMLAttributes
    small: HTMLAttributes
    s: HTMLAttributes
    cite: HTMLAttributes
    q: HTMLAttributes
    code: HTMLAttributes
    kbd: HTMLAttributes
    sub: HTMLAttributes
    sup: HTMLAttributes
    i: HTMLAttributes
    b: HTMLAttributes
    u: HTMLAttributes
    mark: HTMLAttributes
    ruby: HTMLAttributes
    rt: HTMLAttributes
    rp: HTMLAttributes
    bdi: HTMLAttributes
    bdo: HTMLAttributes
    br: HTMLAttributes
    wbr: HTMLAttributes

    // Forms
    form: FormHTMLAttributes
    input: InputHTMLAttributes
    button: ButtonHTMLAttributes
    select: SelectHTMLAttributes
    textarea: TextareaHTMLAttributes
    label: LabelHTMLAttributes
    fieldset: HTMLAttributes
    legend: HTMLAttributes
    datalist: HTMLAttributes
    option: HTMLAttributes
    optgroup: HTMLAttributes
    output: HTMLAttributes
    progress: HTMLAttributes
    meter: HTMLAttributes

    // Tables
    table: TableHTMLAttributes
    thead: HTMLAttributes
    tbody: HTMLAttributes
    tfoot: HTMLAttributes
    tr: HTMLAttributes
    th: TdHTMLAttributes
    td: TdHTMLAttributes
    caption: HTMLAttributes
    colgroup: HTMLAttributes
    col: HTMLAttributes

    // Media
    img: ImgHTMLAttributes
    audio: HTMLAttributes
    video: HTMLAttributes
    source: HTMLAttributes
    track: HTMLAttributes
    picture: HTMLAttributes
    iframe: HTMLAttributes
    embed: HTMLAttributes
    object: HTMLAttributes
    param: HTMLAttributes
    canvas: HTMLAttributes
    map: HTMLAttributes
    area: HTMLAttributes

    // Interactive
    details: HTMLAttributes
    summary: HTMLAttributes
    dialog: HTMLAttributes
    menu: HTMLAttributes

    // SVG
    svg: SVGAttributes
    path: SVGAttributes
    circle: SVGAttributes
    ellipse: SVGAttributes
    line: SVGAttributes
    polygon: SVGAttributes
    polyline: SVGAttributes
    rect: SVGAttributes
    g: SVGAttributes
    defs: SVGAttributes
    use: SVGAttributes
    text: SVGAttributes
    tspan: SVGAttributes
    image: SVGAttributes
    clipPath: SVGAttributes
    mask: SVGAttributes
    pattern: SVGAttributes
    linearGradient: SVGAttributes
    radialGradient: SVGAttributes
    stop: SVGAttributes
    symbol: SVGAttributes
    marker: SVGAttributes
    foreignObject: SVGAttributes

    // Web Components
    slot: HTMLAttributes
    template: HTMLAttributes
  }

  /**
   * Element children type
   */
  export type ElementChildrenAttribute = {
    children: {}
  }
}

// Re-export JSX namespace for use with jsxImportSource
export { JSX }

declare global {
  namespace JSX {
    type Element = import("./Element.js").Element
    
    interface IntrinsicAttributes {
      readonly key?: import("./Element.js").ElementKey
    }
    
    interface IntrinsicElements {
      // Document sections
      html: import("./Element.js").ElementProps
      head: import("./Element.js").ElementProps
      body: import("./Element.js").ElementProps
      title: import("./Element.js").ElementProps
      meta: import("./Element.js").ElementProps
      link: import("./Element.js").ElementProps
      script: import("./Element.js").ElementProps
      style: import("./Element.js").ElementProps

      // Content sectioning
      header: import("./Element.js").ElementProps
      footer: import("./Element.js").ElementProps
      main: import("./Element.js").ElementProps
      nav: import("./Element.js").ElementProps
      section: import("./Element.js").ElementProps
      article: import("./Element.js").ElementProps
      aside: import("./Element.js").ElementProps
      h1: import("./Element.js").ElementProps
      h2: import("./Element.js").ElementProps
      h3: import("./Element.js").ElementProps
      h4: import("./Element.js").ElementProps
      h5: import("./Element.js").ElementProps
      h6: import("./Element.js").ElementProps
      address: import("./Element.js").ElementProps

      // Text content
      div: import("./Element.js").ElementProps
      p: import("./Element.js").ElementProps
      pre: import("./Element.js").ElementProps
      blockquote: import("./Element.js").ElementProps
      ol: import("./Element.js").ElementProps
      ul: import("./Element.js").ElementProps
      li: import("./Element.js").ElementProps
      dl: import("./Element.js").ElementProps
      dt: import("./Element.js").ElementProps
      dd: import("./Element.js").ElementProps
      figure: import("./Element.js").ElementProps
      figcaption: import("./Element.js").ElementProps
      hr: import("./Element.js").ElementProps

      // Inline text
      span: import("./Element.js").ElementProps
      a: import("./Element.js").ElementProps
      em: import("./Element.js").ElementProps
      strong: import("./Element.js").ElementProps
      small: import("./Element.js").ElementProps
      s: import("./Element.js").ElementProps
      cite: import("./Element.js").ElementProps
      q: import("./Element.js").ElementProps
      code: import("./Element.js").ElementProps
      kbd: import("./Element.js").ElementProps
      sub: import("./Element.js").ElementProps
      sup: import("./Element.js").ElementProps
      i: import("./Element.js").ElementProps
      b: import("./Element.js").ElementProps
      u: import("./Element.js").ElementProps
      mark: import("./Element.js").ElementProps
      ruby: import("./Element.js").ElementProps
      rt: import("./Element.js").ElementProps
      rp: import("./Element.js").ElementProps
      bdi: import("./Element.js").ElementProps
      bdo: import("./Element.js").ElementProps
      br: import("./Element.js").ElementProps
      wbr: import("./Element.js").ElementProps

      // Forms
      form: import("./Element.js").ElementProps
      input: import("./Element.js").ElementProps
      button: import("./Element.js").ElementProps
      select: import("./Element.js").ElementProps
      textarea: import("./Element.js").ElementProps
      label: import("./Element.js").ElementProps
      fieldset: import("./Element.js").ElementProps
      legend: import("./Element.js").ElementProps
      datalist: import("./Element.js").ElementProps
      option: import("./Element.js").ElementProps
      optgroup: import("./Element.js").ElementProps
      output: import("./Element.js").ElementProps
      progress: import("./Element.js").ElementProps
      meter: import("./Element.js").ElementProps

      // Tables
      table: import("./Element.js").ElementProps
      thead: import("./Element.js").ElementProps
      tbody: import("./Element.js").ElementProps
      tfoot: import("./Element.js").ElementProps
      tr: import("./Element.js").ElementProps
      th: import("./Element.js").ElementProps
      td: import("./Element.js").ElementProps
      caption: import("./Element.js").ElementProps
      colgroup: import("./Element.js").ElementProps
      col: import("./Element.js").ElementProps

      // Media
      img: import("./Element.js").ElementProps
      audio: import("./Element.js").ElementProps
      video: import("./Element.js").ElementProps
      source: import("./Element.js").ElementProps
      track: import("./Element.js").ElementProps
      picture: import("./Element.js").ElementProps
      iframe: import("./Element.js").ElementProps
      embed: import("./Element.js").ElementProps
      object: import("./Element.js").ElementProps
      param: import("./Element.js").ElementProps
      canvas: import("./Element.js").ElementProps
      map: import("./Element.js").ElementProps
      area: import("./Element.js").ElementProps

      // Interactive
      details: import("./Element.js").ElementProps
      summary: import("./Element.js").ElementProps
      dialog: import("./Element.js").ElementProps
      menu: import("./Element.js").ElementProps

      // SVG
      svg: import("./Element.js").ElementProps
      path: import("./Element.js").ElementProps
      circle: import("./Element.js").ElementProps
      ellipse: import("./Element.js").ElementProps
      line: import("./Element.js").ElementProps
      polygon: import("./Element.js").ElementProps
      polyline: import("./Element.js").ElementProps
      rect: import("./Element.js").ElementProps
      g: import("./Element.js").ElementProps
      defs: import("./Element.js").ElementProps
      use: import("./Element.js").ElementProps
      text: import("./Element.js").ElementProps
      tspan: import("./Element.js").ElementProps
      image: import("./Element.js").ElementProps
      clipPath: import("./Element.js").ElementProps
      mask: import("./Element.js").ElementProps
      pattern: import("./Element.js").ElementProps
      linearGradient: import("./Element.js").ElementProps
      radialGradient: import("./Element.js").ElementProps
      stop: import("./Element.js").ElementProps
      symbol: import("./Element.js").ElementProps
      marker: import("./Element.js").ElementProps
      foreignObject: import("./Element.js").ElementProps

      // Web Components
      slot: import("./Element.js").ElementProps
      template: import("./Element.js").ElementProps
    }
    
    interface ElementChildrenAttribute {
      children: {}
    }
  }
}
