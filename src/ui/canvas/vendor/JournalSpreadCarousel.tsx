import { ImageStackGrid } from '../ImageStackGrid'
// 用法：由 ImageStackViewer 传入真实项目图片；保留原组件的双页折叠、景深与拖动翻页。
// 来源：用户提供的 21st.dev / @kedhareswer / journal-spread-carousel 组件。

import * as React from "react"
import { Maximize, ZoomIn, ZoomOut } from "lucide-react"
import journalHand from "../../../assets/fonts/journal-hand.woff2"
import { useLanguage } from "../../shared/language"
import { useThemeStore } from "../../theme/themeStore"

/** A photo pinned to a spread. x / y / w are percentages of the whole spread. */
export type JournalPrint = {
  src: string
  alt?: string
  x: number
  y: number
  w: number
  rotate?: number
  caption?: string
  /** A strip of washi tape across the top instead of a polaroid border. */
  tape?: boolean
}

/** A handwritten note on a spread. x / y / w are percentages of the whole spread. */
export type JournalNote = {
  x: number
  y: number
  w: number
  title?: string
  body?: string
  rotate?: number
  /** "card" sits on a torn paper slip; "ink" writes straight onto the photo. */
  style?: "card" | "ink"
}

/** One open double page. The image runs across both pages and folds at the spine. */
export type JournalSpread = {
  id?: string
  label?: string
  caption?: string
  image?: string
  alt?: string
  imagePosition?: string
  /** Paper colour when there is no image, or under it while it loads. */
  paper?: string
  prints?: JournalPrint[]
  notes?: JournalNote[]
}

export interface JournalSpreadCarouselProps {
  spreads: JournalSpread[]
  title?: string
  /** The line under the title. Defaults to the page count. */
  meta?: string
  height?: string
  initialIndex?: number
  activeId?: string
  onReorder?: (id: string, targetId: string) => void
  /** Milliseconds between automatic page turns; false turns it off. Stops on the first touch. */
  autoPlay?: number | false
  onIndexChange?: (index: number) => void
  caption: string
  captionReadOnly?: boolean
  onCaptionChange(value: string): void
  onCaptionCommit(): void
  onClose(): void
  className?: string
}

// #region pose
const OPEN = 0 // 当前图片完整铺平，避免书脊高光或两页夹角在画面中央形成白线。
const SIDE = 80 // how far a stacked page turns towards the middle
const FOLD = 174 // a page folding shut over its partner

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 当前图片按原比例适应可用空间，两侧仅预留少量翻页提示。 */
export function spreadWidth(stageW: number, stageH: number, aspect: number): number {
  if (stageW <= 0 || stageH <= 0) return 0
  return Math.min(stageW * .86, stageH * .96 * aspect)
}

/**
 * Where spread `p` steps from the centre sits. 0 is open in the middle; ±1 is the first
 * page of each stack, and further ones step outwards and back.
 */
export function poseFor(p: number, w: number) {
  const d = Math.abs(p)
  const a = d < 1 ? d : 1
  const s = p < 0 ? -1 : 1
  const out = d > 1 ? d - 1 : 0
  const x = s * (a * (w * 0.5 + w * 0.03) + out * w * 0.055)
  const z = -(a * w * 0.42 + out * w * 0.06)
  // Pages on the side they stack to turn edge-on; the other page folds shut over them.
  // The fold eases in (a * a) so the leaving and arriving spreads overlap mid-turn.
  const fold = a * a
  const left = p > 0 ? OPEN + (FOLD - OPEN) * fold : OPEN + (SIDE - OPEN) * a
  const right = p < 0 ? -(OPEN + (FOLD - OPEN) * fold) : -(OPEN + (SIDE - OPEN) * a)
  const shade = (deg: number) => clamp((Math.abs(deg) - OPEN) / 95, 0, 0.62)
  return {
    x,
    z,
    left,
    right,
    shadeLeft: shade(left),
    shadeRight: shade(right),
    opacity: clamp(7.2 - d, 0, 1),
    hidden: d > 7.2,
  }
}

/** Where a drag lets go: the nearest spread, nudged by the flick. */
export function settle(pos: number, velocity: number, n: number): number {
  return clamp(Math.round(pos + clamp(velocity * 0.18, -1.5, 1.5)), 0, Math.max(0, n - 1))
}

/** Tween length for a jump of `steps` spreads; longer jumps riffle faster per page. */
export function durationFor(steps: number): number {
  return steps <= 0 ? 0 : Math.round(560 * Math.sqrt(Math.min(steps, 12)))
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
// #endregion

const FONT = `@font-face{font-family:JSC Hand;font-style:normal;font-weight:600;font-display:swap;src:url(${journalHand}) format("woff2")}`

const CSS =
  FONT +
  ".jsc-root{position:relative;width:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;" +
  "background:radial-gradient(120% 80% at 50% 35%,#3f4565 0%,#363b58 55%,#2d3149 100%);color:#f4f2ee;" +
  "font-family:ui-rounded,'SF Pro Rounded',system-ui,-apple-system,'Segoe UI',sans-serif;outline:none;user-select:none;-webkit-user-select:none;container-type:inline-size}" +
  ".jsc-root:focus-visible{box-shadow:inset 0 0 0 2px rgba(255,255,255,.55)}" +
  ".jsc-top{position:relative;padding:max(14px,1.6cqi) max(14px,1.8cqi) 0;display:flex;justify-content:space-between;align-items:flex-start}" +
  ".jsc-group{display:flex;gap:max(8px,.8cqi)}" +
  ".jsc-chip{display:grid;place-items:center;width:clamp(34px,3.4cqi,46px);height:clamp(34px,3.4cqi,46px);border-radius:50%;border:0;padding:0;cursor:pointer;" +
  "color:#f4f2ee;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);transition:background .2s}" +
  ".jsc-chip:hover{background:rgba(255,255,255,.16)}" +
  ".jsc-chip[aria-pressed=true]{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.85)}" +
  ".jsc-chip svg{width:46%;height:46%}" +
  ".jsc-head{position:absolute;left:50%;top:max(40px,4.4cqi);transform:translateX(-50%);text-align:center;white-space:nowrap;pointer-events:none}" +
  ".jsc-title{margin:0;font-weight:700;font-size:clamp(22px,2.7cqi,40px);letter-spacing:-.01em;line-height:1.1}" +
  ".jsc-meta{display:inline-flex;align-items:center;gap:.45em;margin-top:.55em;font-size:clamp(11px,1cqi,14px);font-weight:600;opacity:.82}" +
  ".jsc-meta svg{width:1.15em;height:1.15em}" +
  ".jsc-stage{position:relative;margin-top:clamp(64px,7cqi,104px);touch-action:pan-y;cursor:grab}" +
  ".jsc-stage[data-drag]{cursor:grabbing}" +
  ".jsc-floor{position:absolute;left:50%;top:50%;width:calc(var(--jsc-w) * 1.55);height:calc(var(--jsc-h) * .62);transform:translate(-50%,calc(var(--jsc-h) * .2));" +
  "background:#20243a;opacity:.55;filter:blur(calc(var(--jsc-w) * .03));border-radius:calc(var(--jsc-w) * .04);pointer-events:none}" +
  ".jsc-view{position:absolute;inset:0;perspective:var(--jsc-perspective,1600px);perspective-origin:50% 46%}" +
  ".jsc-scene{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d}" +
  ".jsc-item{position:absolute;left:0;top:0;transform-style:preserve-3d;visibility:hidden}" +
  ".jsc-page{position:absolute;top:calc(var(--jsc-h) * -.5);width:calc(var(--jsc-w) * .5);height:var(--jsc-h);overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;" +
  "background:transparent;box-shadow:none}" +
  // 只在书页中缝处重叠半像素；外侧边缘保持原宽度，避免漏出纸面底色。
  ".jsc-page[data-side=l]{left:calc(var(--jsc-w) * -.5);width:calc(var(--jsc-w) * .5 + .5px);transform-origin:100% 50%;border-radius:calc(var(--jsc-w) * .034) 0 0 calc(var(--jsc-w) * .034)}" +
  ".jsc-page[data-side=r]{left:0;transform-origin:0 50%;border-radius:0 calc(var(--jsc-w) * .034) calc(var(--jsc-w) * .034) 0}" +
  ".jsc-sheet{position:absolute;top:0;width:var(--jsc-w);height:var(--jsc-h);pointer-events:none}" +
  ".jsc-page[data-side=l]>.jsc-sheet{left:0}" +
  ".jsc-page[data-side=r]>.jsc-sheet{left:calc(var(--jsc-w) * -.5)}" +
  ".jsc-bg{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block}" +
  ".jsc-shade{position:absolute;inset:0;background:#141729;opacity:var(--jsc-s,0)}" +
  ".jsc-print{position:absolute;margin:0;background:#fbfaf6;padding:3.5% 3.5% 0;box-shadow:0 .4em 1em rgba(18,16,30,.28),0 .1em .2em rgba(18,16,30,.2);font-size:calc(var(--jsc-w) * .01)}" +
  ".jsc-print img{display:block;width:100%;height:auto;max-width:none;aspect-ratio:4/5;object-fit:cover}" +
  ".jsc-print figcaption{font-family:'JSC Hand',cursive;font-weight:600;color:#2a2c3e;text-align:center;font-size:calc(var(--jsc-w) * .024);line-height:1;padding:.32em 0 .4em}" +
  ".jsc-print[data-tape]{padding:0;background:none}" +
  ".jsc-print[data-tape]::before{content:'';position:absolute;left:50%;top:-6%;width:46%;height:11%;transform:translateX(-50%) rotate(-3deg);background:rgba(236,226,196,.78);box-shadow:0 1px 2px rgba(0,0,0,.12)}" +
  ".jsc-print[data-tape] figcaption{position:absolute;left:0;right:0;bottom:-1.1em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.55)}" +
  ".jsc-note{position:absolute;font-family:'JSC Hand',cursive;font-weight:600;line-height:1.02;color:#272a3f}" +
  ".jsc-note[data-style=card]{background:#f6f1e6;padding:.7em .85em .8em;box-shadow:0 .3em .9em rgba(18,16,30,.25);clip-path:polygon(0 3%,7% 0,18% 2%,31% 0,46% 2%,60% 0,74% 2%,88% 0,100% 2%,99% 100%,84% 98%,69% 100%,52% 98%,37% 100%,21% 98%,6% 100%,1% 97%)}" +
  ".jsc-note[data-style=ink]{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45),0 0 12px rgba(0,0,0,.25)}" +
  ".jsc-note b{display:block;font-weight:600;font-size:calc(var(--jsc-w) * .048);margin-bottom:.12em}" +
  ".jsc-note span{display:block;font-size:calc(var(--jsc-w) * .028)}" +
  ".jsc-bar{display:flex;justify-content:center;gap:clamp(12px,1.4cqi,20px);padding:clamp(14px,1.8cqi,28px) 0 clamp(22px,3cqi,44px);position:relative;z-index:2}" +
  ".jsc-btn{display:grid;place-items:center;width:clamp(40px,3.6cqi,52px);height:clamp(40px,3.6cqi,52px);border-radius:50%;border:0;padding:0;cursor:pointer;color:#262a40;background:#fff;" +
  "box-shadow:0 4px 14px rgba(10,12,28,.28);transition:transform .2s cubic-bezier(.2,.7,.2,1)}" +
  ".jsc-btn:hover{transform:translateY(-2px)}" +
  ".jsc-btn:active{transform:scale(.94)}" +
  ".jsc-btn svg{width:44%;height:44%}" +
  ".jsc-chip:focus-visible,.jsc-btn:focus-visible{outline:2px solid #fff;outline-offset:3px}" +
  ".jsc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}" +
  "@media (prefers-reduced-motion:reduce){html:not([data-force-motion=true]) .jsc-btn,html:not([data-force-motion=true]) .jsc-chip{transition:none}}"

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24", "aria-hidden": true } as const

function Icon({ name }: { name: string }) {
  switch (name) {
    case "book":
      return (
        <svg {...ICON}>
          <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        </svg>
      )
    case "grid":
      return (
        <svg {...ICON}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      )
    case "search":
      return (
        <svg {...ICON}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.6-3.6" />
        </svg>
      )
    case "menu":
      return (
        <svg {...ICON}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      )
    case "lock":
      return (
        <svg {...ICON}>
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
          <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </svg>
      )
    case "more":
      return (
        <svg {...ICON} strokeWidth={3}>
          <path d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      )
    case "share":
      return (
        <svg {...ICON}>
          <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
      )
    case "delete":
      return (
        <svg {...ICON}>
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
      )
    default:
      return (
        <svg {...ICON}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
  }
}

function Sheet({ spread }: { spread: JournalSpread }) {
  return (
    <div className="jsc-sheet" style={{ background: spread.image ? "transparent" : spread.paper }}>
      {spread.image ? (
        <img className="jsc-bg" src={spread.image} alt="" draggable={false} decoding="async" style={{ maxWidth: "none", objectPosition: spread.imagePosition }} />
      ) : null}
      {spread.prints?.map((p, k) => (
        <figure
          key={k}
          className="jsc-print"
          data-tape={p.tape ? "" : undefined}
          style={{ left: p.x + "%", top: p.y + "%", width: p.w + "%", transform: "rotate(" + (p.rotate ?? 0) + "deg)" }}
        >
          <img src={p.src} alt="" draggable={false} decoding="async" style={{ maxWidth: "none" }} />
          {p.caption ? <figcaption>{p.caption}</figcaption> : null}
        </figure>
      ))}
      {spread.notes?.map((t, k) => (
        <div
          key={k}
          className="jsc-note"
          data-style={t.style ?? "card"}
          style={{ left: t.x + "%", top: t.y + "%", width: t.w + "%", transform: "rotate(" + (t.rotate ?? 0) + "deg)" }}
        >
          {t.title ? <b>{t.title}</b> : null}
          {t.body ? <span>{t.body}</span> : null}
        </div>
      ))}
    </div>
  )
}

export default function JournalSpreadCarousel({
  spreads,
  title = "Journal",
  meta,
  height = "100svh",
  initialIndex = 0,
  activeId,
  onReorder,
  autoPlay = false,
  onIndexChange,
  caption,
  captionReadOnly = false,
  onCaptionChange,
  onCaptionCommit,
  onClose,
  className,
}: JournalSpreadCarouselProps) {
  const { t } = useLanguage()
  const forceMotion = useThemeStore(state => state.forceMotion)
  const [grid, setGrid] = React.useState(false)
  const n = spreads.length
  const start = clamp(Math.round(initialIndex), 0, Math.max(0, n - 1))
  const [index, setIndex] = React.useState(start)
  const [reduced, setReduced] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [imageAspects, setImageAspects] = React.useState<Record<string, number>>({})
  const aspect = imageAspects[spreads[index]?.image ?? ''] ?? 1.25
  const itemWidths = React.useRef<number[]>([])
  const imageSources = spreads.map(spread => spread.image ?? '').join('\n')
  const [zoom, setZoom] = React.useState({ scale: 1, x: 0, y: 0 })
  const zoomRef = React.useRef(zoom)
  const stageSize = React.useRef({ width: 0, height: 0, imageHeight: 0 })
  const pan = React.useRef<null | { id: number; x: number; y: number; fromX: number; fromY: number }>(null)
  const rootRef = React.useRef(null as HTMLDivElement | null)
  const stageRef = React.useRef(null as HTMLDivElement | null)
  const items = React.useRef([] as (HTMLDivElement | null)[])
  const pages = React.useRef([] as (HTMLDivElement | null)[])
  const width = React.useRef(0) // cached on resize; the frame loop never measures
  const pos = React.useRef(start)
  const target = React.useRef(start)
  const tween = React.useRef(null as null | { from: number; to: number; t0: number; dur: number; ease: (t: number) => number })
  const raf = React.useRef(0)
  const drag = React.useRef(null as null | { id: number; x: number; from: number; lastX: number; lastT: number; v: number; moved: boolean })
  const touched = React.useRef(false)
  const reducedRef = React.useRef(false)
  const onIndexRef = React.useRef(onIndexChange)
  onIndexRef.current = onIndexChange

  const updateZoom = React.useCallback((next: typeof zoom) => {
    // 图片边缘不能被拖离视口；小于适应尺寸时始终居中。
    const size = stageSize.current
    const maxX = Math.max(0, (width.current * next.scale - size.width) / 2)
    const maxY = Math.max(0, (size.imageHeight * next.scale - size.height) / 2)
    zoomRef.current = { scale: next.scale, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) }
    setZoom(zoomRef.current)
  }, [])
  const resetZoom = React.useCallback(() => {
    pan.current = null
    setDragging(false)
    updateZoom({ scale: 1, x: 0, y: 0 })
  }, [updateZoom])

  const paint = React.useCallback(() => {
    const w = width.current
    if (!w) return
    for (let i = 0; i < items.current.length; i++) {
      const el = items.current[i]
      if (!el) continue
      const q = poseFor(i - pos.current, itemWidths.current[i] ?? w)
      if (q.hidden) {
        el.style.visibility = "hidden"
        continue
      }
      el.style.visibility = "visible"
      el.style.opacity = String(q.opacity)
      el.style.transform = "translate3d(" + q.x.toFixed(2) + "px,0," + q.z.toFixed(2) + "px)"
      const l = pages.current[i * 2]
      const r = pages.current[i * 2 + 1]
      if (l) {
        l.style.transform = "rotateY(" + q.left.toFixed(2) + "deg)"
        l.style.setProperty("--jsc-s", q.shadeLeft.toFixed(3))
      }
      if (r) {
        r.style.transform = "rotateY(" + q.right.toFixed(2) + "deg)"
        r.style.setProperty("--jsc-s", q.shadeRight.toFixed(3))
      }
    }
  }, [])

  const frame = React.useCallback(
    (t: number) => {
      raf.current = 0
      const tw = tween.current
      if (tw) {
        const k = tw.dur > 0 ? clamp((t - tw.t0) / tw.dur, 0, 1) : 1
        pos.current = tw.from + (tw.to - tw.from) * tw.ease(k)
        if (k >= 1) tween.current = null
      }
      paint()
      if (tween.current) raf.current = requestAnimationFrame(frame)
    },
    [paint],
  )

  const kick = React.useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(frame)
  }, [frame])

  const go = React.useCallback(
    (to: number, ease = easeInOut, instant = false) => {
      const next = clamp(to, 0, Math.max(0, n - 1))
      if (next !== target.current) {
        resetZoom()
        target.current = next
        setIndex(next)
        onIndexRef.current?.(next)
      }
      const dur = reducedRef.current || instant ? 0 : durationFor(Math.abs(next - pos.current))
      tween.current = { from: pos.current, to: next, t0: performance.now(), dur, ease }
      kick()
    },
    [n, kick, resetZoom],
  )

  // 排序后按稳定身份继续查看同一张图，避免备注与当前页错位。
  React.useEffect(() => {
    const next = spreads.findIndex(spread => spread.id === activeId)
    if (next >= 0 && next !== target.current) go(next, easeInOut, true)
  }, [spreads, activeId, go])

  const changeZoom = React.useCallback((scale: number, point = { x: 0, y: 0 }) => {
    touched.current = true
    // 放大时先结束折页，确保拖动只移动当前图片。
    tween.current = null
    drag.current = null
    pan.current = null
    setDragging(false)
    pos.current = target.current
    paint()
    const previous = zoomRef.current, next = clamp(scale, .5, 5)
    const ratio = next / previous.scale
    updateZoom({ scale: next, x: point.x - (point.x - previous.x) * ratio, y: point.y - (point.y - previous.y) * ratio })
  }, [paint, updateZoom])

  React.useEffect(() => {
    let active = true
    // 每页缓存自身比例，翻页只改变折叠角度，不把离场图改成下一张的尺寸。
    const images = imageSources.split('\n').filter(Boolean).map(source => {
      const image = new Image()
      image.onload = () => { if (active && image.naturalHeight) setImageAspects(previous => ({ ...previous, [source]: image.naturalWidth / image.naturalHeight })) }
      image.src = source
      return image
    })
    return () => { active = false; images.forEach(image => { image.onload = null }) }
  }, [imageSources])

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => {
      // 与工作台设置保持一致：默认遵循系统偏好，用户可显式强制播放动画。
      reducedRef.current = mq.matches && !forceMotion
      setReduced(reducedRef.current)
    }
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [forceMotion])

  // Measure once per resize and cache it; the per-frame paint reads only the cache.
  React.useEffect(() => {
    const stage = stageRef.current
    const root = rootRef.current
    if (!stage || !root) return
    const ro = new ResizeObserver(([entry]) => {
      const { width: sw, height: sh } = entry.contentRect
      const w = spreadWidth(sw, sh, aspect)
      // 透视由窗口决定，切换横竖图不能突然改变整组折页的相机距离。
      root.style.setProperty("--jsc-perspective", sw * 2.3 + "px")
      width.current = w
      itemWidths.current = spreads.map((spread, i) => {
        const ratio = imageAspects[spread.image ?? ''] ?? 1.25, pageWidth = spreadWidth(sw, sh, ratio)
        items.current[i]?.style.setProperty('--jsc-w', pageWidth + 'px')
        items.current[i]?.style.setProperty('--jsc-h', pageWidth / ratio + 'px')
        return pageWidth
      })
      stageSize.current = { width: sw, height: sh, imageHeight: w / aspect }
      root.style.setProperty("--jsc-w", w + "px")
      root.style.setProperty("--jsc-h", w / aspect + "px")
      updateZoom(zoomRef.current)
      paint()
    })
    ro.observe(stage)
    // 图片比例变化只更新布局，不能取消正在运行的翻页帧循环。
    return () => ro.disconnect()
  }, [paint, grid, aspect, imageAspects, imageSources, updateZoom])

  React.useEffect(() => () => cancelAnimationFrame(raf.current), [])

  React.useEffect(() => {
    if (pos.current > n - 1) go(n - 1)
    else paint()
  }, [n, go, paint])

  // Turns pages on its own until someone touches it; pauses off-screen and in a hidden tab.
  React.useEffect(() => {
    const root = rootRef.current
    if (!autoPlay || reduced || n < 2 || !root) return
    let visible = true
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
    })
    io.observe(root)
    const id = window.setInterval(() => {
      if (touched.current || !visible || document.hidden || drag.current) return
      go(target.current >= n - 1 ? 0 : target.current + 1)
    }, autoPlay)
    return () => {
      window.clearInterval(id)
      io.disconnect()
    }
  }, [autoPlay, reduced, n, go])

  const stop = () => {
    touched.current = true
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || n < 1) return
    stop()
    rootRef.current?.focus({ preventScroll: true })
    if (zoomRef.current.scale > 1) {
      pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, fromX: zoomRef.current.x, fromY: zoomRef.current.y }
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
      return
    }
    tween.current = null
    drag.current = { id: e.pointerId, x: e.clientX, from: pos.current, lastX: e.clientX, lastT: e.timeStamp, v: 0, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current
    if (p?.id === e.pointerId) {
      updateZoom({ scale: zoomRef.current.scale, x: p.fromX + e.clientX - p.x, y: p.fromY + e.clientY - p.y })
      return
    }
    const d = drag.current
    const w = width.current
    if (!d || d.id !== e.pointerId || !w) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true
      setDragging(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    if (!d.moved) return
    const dt = Math.max(1, e.timeStamp - d.lastT)
    d.v = d.v * 0.6 + (-(e.clientX - d.lastX) / (w * 0.42) / (dt / 1000)) * 0.4
    d.lastX = e.clientX
    d.lastT = e.timeStamp
    pos.current = clamp(d.from - dx / (w * 0.42), -0.3, n - 0.7)
    kick()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (pan.current?.id === e.pointerId) {
      pan.current = null
      setDragging(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.moved) {
      go(settle(pos.current, d.v, n), easeOut)
      return
    }
    const hit = (e.target as HTMLElement).closest("[data-i]")
    const i = hit ? Number(hit.getAttribute("data-i")) : target.current
    go(i)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }
    if (e.target !== e.currentTarget) return
    if (!grid && (e.key === '+' || e.key === '=')) changeZoom(zoomRef.current.scale * 1.25)
    else if (!grid && e.key === '-') changeZoom(zoomRef.current.scale / 1.25)
    else if (!grid && e.key === '0') resetZoom()
    else if (e.key in map) go(target.current + map[e.key], easeInOut, true)
    else if (e.key === "Home") go(0, easeInOut, true)
    else if (e.key === "End") go(n - 1, easeInOut, true)
    else return
    e.preventDefault()
    stop()
  }

  // 滚轮与触控板捏合围绕指针缩放；适应大小时保留横向滑动翻页。
  const wheel = React.useRef({ acc: 0, at: 0 })
  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const rect = stage.getBoundingClientRect()
        const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1)
        changeZoom(zoomRef.current.scale * Math.exp(-delta * .002), { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 })
        return
      }
      if (zoomRef.current.scale > 1) {
        updateZoom({ ...zoomRef.current, x: zoomRef.current.x - e.deltaX })
        return
      }
      const w = wheel.current
      w.acc += e.deltaX
      if (Math.abs(w.acc) < 40 || e.timeStamp - w.at < 320) return
      touched.current = true
      w.at = e.timeStamp
      go(target.current + (w.acc > 0 ? 1 : -1))
      w.acc = 0
    }
    stage.addEventListener("wheel", onWheel, { passive: false })
    return () => stage.removeEventListener("wheel", onWheel)
  }, [go, grid, changeZoom, updateZoom])

  const current = spreads[index]
  const pagesLabel = meta ?? `${index + 1} / ${n} ${t('张图片', 'images')}`

  return (
    <div
      ref={rootRef}
      className={"jsc-root" + (className ? " " + className : "")}
      style={{ height }}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <style>{CSS}</style>
      <div className="jsc-top">
        <div className="jsc-group">
          <button type="button" className="jsc-chip" aria-pressed={!grid} aria-label={t('翻页查看', 'Spread view')} onClick={() => { onCaptionCommit(); setGrid(false) }}>
            <Icon name="book" />
          </button>
          <button type="button" className="jsc-chip" aria-pressed={grid} aria-label={t('缩略图列表', 'Grid view')} onClick={() => { onCaptionCommit(); resetZoom(); setGrid(true) }}>
            <Icon name="grid" />
          </button>
        </div>
        <div className="jsc-head">
          <h2 className="jsc-title">{title}</h2>
          <div className="jsc-meta">
            {pagesLabel}
          </div>
        </div>
        <div className="jsc-group">
          {!grid && <div className="jsc-zoom" role="group" aria-label={t('图片缩放', 'Image zoom')}>
            <button type="button" className="jsc-chip" disabled={zoom.scale <= .5} aria-label={t('缩小图片', 'Zoom out')} title={t('缩小图片（−）', 'Zoom out (−)')} onClick={() => changeZoom(zoomRef.current.scale / 1.25)}><ZoomOut /></button>
            <output aria-label={t('图片缩放比例', 'Image zoom level')}>{Math.round(zoom.scale * 100)}%</output>
            <button type="button" className="jsc-chip" disabled={zoom.scale >= 5} aria-label={t('放大图片', 'Zoom in')} title={t('放大图片（+）', 'Zoom in (+)')} onClick={() => changeZoom(zoomRef.current.scale * 1.25)}><ZoomIn /></button>
            <button type="button" className="jsc-chip" aria-label={t('适应窗口', 'Fit to window')} title={t('适应窗口（0）', 'Fit to window (0)')} onClick={resetZoom}><Maximize /></button>
          </div>}
          <button type="button" className="jsc-chip" aria-label={t('关闭叠图浏览', 'Close image stack')} onClick={onClose}>
            <svg {...ICON}><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>

      {grid ? <ImageStackGrid spreads={spreads} activeId={activeId} onReorder={onReorder} onOpen={next => { setGrid(false); go(next, easeInOut, true) }}/> : <div
        ref={stageRef}
        className="jsc-stage"
        data-zoomed={zoom.scale > 1 ? '' : undefined}
        data-drag={dragging ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pan.current = null; drag.current = null; setDragging(false); go(target.current, easeOut) }}
        onLostPointerCapture={() => { if (pan.current || drag.current) { pan.current = null; drag.current = null; setDragging(false); go(target.current, easeOut) } }}
      >
        <div className="jsc-camera" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}>
        {/* 放大查看使用完整图面，避免两个半页在非整数缩放下出现拼接细线。 */}
        {zoom.scale > 1 && current && <div className="jsc-detail"><Sheet spread={current} /></div>}
        <div className="jsc-floor" aria-hidden="true" />
        <div className="jsc-view">
          <div className="jsc-scene">
            {spreads.map((s, i) => (
              <div
                key={s.id ?? i}
                ref={(el) => {
                  items.current[i] = el
                }}
                className="jsc-item"
                data-i={i}
                role="group"
                aria-roledescription="spread"
                aria-label={(s.label ?? "Spread " + (i + 1)) + ", " + (i + 1) + " of " + n}
                aria-hidden={i !== index}
              >
                {s.alt ? <span className="jsc-sr">{s.alt}</span> : null}
                {(["l", "r"] as const).map((side, k) => (
                  <div
                    key={side}
                    ref={(el) => {
                      pages.current[i * 2 + k] = el
                    }}
                    className="jsc-page"
                    data-side={side}
                  >
                    <Sheet spread={s} />
                    <div className="jsc-shade" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>}

      <footer className="jsc-footer">
        {!grid && <label className="jsc-caption"><span>{current?.label}</span><textarea aria-label={t('当前图片备注', 'Current image caption')} readOnly={captionReadOnly} value={caption} placeholder={t('为这张图片添加备注…', 'Add a caption for this image…')} onChange={event => onCaptionChange(event.target.value)} onBlur={onCaptionCommit} /></label>}
        <div className="jsc-bar">
          <button type="button" className="jsc-btn" disabled={index === 0} aria-label={t('上一张图片', 'Previous image')} onClick={() => { stop(); go(target.current - 1) }}><svg {...ICON}><path d="m14 6-6 6 6 6" /></svg></button>
          <span className="jsc-position" aria-live="polite">{index + 1} / {n}</span>
          <button type="button" className="jsc-btn" disabled={index === n - 1} aria-label={t('下一张图片', 'Next image')} onClick={() => { stop(); go(target.current + 1) }}><svg {...ICON}><path d="m10 6 6 6-6 6" /></svg></button>
        </div>
      </footer>

      <p className="jsc-sr" aria-live="polite">
        {current ? (current.label ?? "Spread " + (index + 1)) + ", " + (index + 1) + " of " + n : ""}
      </p>
    </div>
  )
}
