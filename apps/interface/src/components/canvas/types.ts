/**
 * Universal Canvas Content Types
 *
 * Defines the schema for all content that can be rendered on the PearlOS canvas.
 * Content type detection is automatic based on the `type` field.
 */

// ─── Chart Types ─────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface TimeSeriesPoint {
  time: string; // ISO date string or label
  value: number;
  series?: string;
}

export interface LineChartData {
  chartType: 'line';
  series: Array<{
    name: string;
    data: TimeSeriesPoint[];
    color?: string;
  }>;
  xLabel?: string;
  yLabel?: string;
}

export interface BarChartData {
  chartType: 'bar';
  categories: string[];
  series: Array<{
    name: string;
    data: number[];
    color?: string;
  }>;
  xLabel?: string;
  yLabel?: string;
  horizontal?: boolean;
}

export interface PieChartData {
  chartType: 'pie';
  segments: ChartDataPoint[];
}

export type ChartData = LineChartData | BarChartData | PieChartData;

// ─── Article Type ────────────────────────────────────────────────────────────

export interface ArticleData {
  headline: string;
  author?: string;
  source?: string;
  date?: string;
  body: string; // markdown
  heroImage?: string;
  images?: Array<{ url: string; caption?: string }>;
  url?: string;
}

// ─── Table Type ──────────────────────────────────────────────────────────────

export interface TableData {
  columns: Array<{
    key: string;
    label: string;
    sortable?: boolean;
    align?: 'left' | 'center' | 'right';
  }>;
  rows: Array<Record<string, string | number | boolean>>;
}

// ─── Image Type ──────────────────────────────────────────────────────────────

export interface ImageData {
  src: string;
  alt?: string;
  caption?: string;
  pixelArt?: boolean; // render with nearest-neighbor scaling
  width?: number;
  height?: number;
}

// ─── Code Type ───────────────────────────────────────────────────────────────

export interface CodeData {
  code: string;
  language?: string;
  filename?: string;
  highlightLines?: number[];
}

// ─── Content Union ───────────────────────────────────────────────────────────

export interface CanvasContentBase {
  title?: string;
  style?: {
    theme?: 'dark' | 'light';
    accent?: string;
  };
}

export interface MarkdownContent extends CanvasContentBase {
  type: 'markdown';
  data: string; // raw markdown
}

export interface ChartContent extends CanvasContentBase {
  type: 'chart';
  data: ChartData;
}

export interface ImageContent extends CanvasContentBase {
  type: 'image';
  data: ImageData;
}

export interface ArticleContent extends CanvasContentBase {
  type: 'article';
  data: ArticleData;
}

export interface TableContent extends CanvasContentBase {
  type: 'table';
  data: TableData;
}

export interface HtmlContent extends CanvasContentBase {
  type: 'html';
  data: {
    html: string;
    css?: string;
    js?: string;
  };
}

export interface CodeContent extends CanvasContentBase {
  type: 'code';
  data: CodeData;
}

export type CanvasContent =
  | MarkdownContent
  | ChartContent
  | ImageContent
  | ArticleContent
  | TableContent
  | HtmlContent
  | CodeContent;

// ─── Event Types ─────────────────────────────────────────────────────────────

export const NIA_EVENT_CANVAS_RENDER = 'nia.event.canvasRender';
export const NIA_EVENT_CANVAS_CLEAR = 'nia.event.canvasClear';
export const NIA_EVENT_CANVAS_UPDATE = 'nia.event.canvasUpdate';

export interface CanvasRenderEvent {
  content: CanvasContent;
  transition?: 'fade' | 'slide' | 'instant';
}

// ─── Auto-detection helper ───────────────────────────────────────────────────

/**
 * Attempt to detect content type from raw data.
 * Useful when receiving untyped payloads from tools.
 */
export function detectContentType(data: unknown): CanvasContent['type'] {
  if (typeof data === 'string') return 'markdown';
  if (typeof data !== 'object' || data === null) return 'markdown';

  const obj = data as Record<string, unknown>;

  if ('chartType' in obj) return 'chart';
  if ('src' in obj && typeof obj.src === 'string') return 'image';
  if ('headline' in obj && 'body' in obj) return 'article';
  if ('columns' in obj && 'rows' in obj) return 'table';
  if ('html' in obj && typeof obj.html === 'string') return 'html';
  if ('code' in obj && typeof obj.code === 'string') return 'code';

  return 'markdown';
}
