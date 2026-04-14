import type { MetricCardsSnapshot, MetricDetailPayload } from "./metricDetailContent";
import type { MetricKey } from "./video-analysis-types";

/** One metric row from GET /api/channels/{name}/report benchmark object. */
export type ChannelBenchmarkRow = {
  n: number;
  missing: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  hist?: { labels: string[]; counts: number[] };
};

const BENCH_KEY: Record<MetricKey, string> = {
  speech_rate: "wpm",
  filler_words: "fillers_per_min",
  eye_contact: "eye_contact_pct",
  gestures: "gestures_per_min",
  tonal_variation: "tonal",
  expression_change: "expression_changes_per_min",
};

function fmt(
  v: number | null | undefined,
  kind: "int" | "float1" | "pct0"
): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  if (kind === "pct0") return `${Math.round(n)}%`;
  if (kind === "float1") return n.toFixed(1);
  return `${Math.round(n)}`;
}

function rangeLine(
  lo: number | null | undefined,
  hi: number | null | undefined,
  kind: "int" | "float1" | "pct0"
): string {
  if (lo == null && hi == null) return "—";
  return `${fmt(lo, kind)} – ${fmt(hi, kind)}`;
}

function endsLine(
  low: number | null | undefined,
  high: number | null | undefined,
  kind: "int" | "float1" | "pct0"
): string {
  if (low == null && high == null) return "—";
  return `Rarely below ${fmt(low, kind)} · rarely above ${fmt(high, kind)}`;
}

/**
 * Channel-wide benchmark modal copy: descriptive only, no single-video coaching.
 */
export function buildBenchmarkMetricDetail(
  metric: MetricKey,
  cards: MetricCardsSnapshot,
  row: ChannelBenchmarkRow | null | undefined,
  completedVideos: number
): MetricDetailPayload {
  const n = Math.max(0, Number(row?.n ?? 0) || 0);
  const missing = Math.max(0, Number(row?.missing ?? 0) || 0);
  const kind: "int" | "float1" | "pct0" =
    metric === "eye_contact"
      ? "pct0"
      : metric === "speech_rate" || metric === "tonal_variation"
        ? metric === "tonal_variation"
          ? "float1"
          : "int"
        : metric === "filler_words" || metric === "gestures" || metric === "expression_change"
          ? "float1"
          : "int";

  const p50 = row?.p50 ?? null;
  const p25 = row?.p25 ?? null;
  const p75 = row?.p75 ?? null;
  const p10 = row?.p10 ?? null;
  const p90 = row?.p90 ?? null;

  const valueLine = (() => {
    switch (metric) {
      case "speech_rate":
        return p50 != null && Number.isFinite(Number(p50)) ? `${Math.round(Number(p50))} WPM` : String(cards.wpm);
      case "filler_words":
        return p50 != null && Number.isFinite(Number(p50)) ? `${Number(p50).toFixed(1)} / min` : String(cards.fillers);
      case "eye_contact": {
        const e = p50 != null && Number.isFinite(Number(p50)) ? Number(p50) : Number(cards.eye) * 100;
        return Number.isFinite(e) ? `${Math.round(e)}%` : "—";
      }
      case "gestures":
        return p50 != null && Number.isFinite(Number(p50)) ? `${Number(p50).toFixed(1)} / min` : String(cards.gestures);
      case "tonal_variation":
        return p50 != null && Number.isFinite(Number(p50)) ? Number(p50).toFixed(1) : cards.tonalScore != null ? String(cards.tonalScore) : "—";
      case "expression_change":
        return p50 != null && Number.isFinite(Number(p50))
          ? `${Number(p50).toFixed(1)} changes/min`
          : Number.isFinite(cards.exprChangesPerMin)
            ? `${cards.exprChangesPerMin.toFixed(1)} changes/min`
            : "—";
      default:
        return "—";
    }
  })();

  const badgeText =
    n >= 20 ? "Strong sample" : n >= 10 ? "Moderate sample" : n > 0 ? "Early sample" : "No data";

  const statsRows: { label: string; value: string }[] = [
    { label: "Typical (middle of the pack)", value: valueLine },
    { label: "Usual range (where most videos sit)", value: rangeLine(p25, p75, kind) },
    { label: "Full spread (rare lows and highs)", value: endsLine(p10, p90, kind) },
    { label: "Videos scored for this metric", value: `${n}` },
    { label: "Could not score", value: missing ? String(missing) : "—" },
    { label: "Completed videos on channel", value: String(Math.max(0, completedVideos)) },
  ];

  const title = (() => {
    switch (metric) {
      case "speech_rate":
        return "Speech rate";
      case "filler_words":
        return "Filler words";
      case "eye_contact":
        return "Eye contact";
      case "gestures":
        return "Gestures";
      case "tonal_variation":
        return "Tonal variation";
      case "expression_change":
        return "Expressions";
      default:
        return "Metric";
    }
  })();

  const interpretation =
    n <= 0
      ? "Not enough completed videos with this metric to describe the channel yet."
      : `This is the channel’s typical level for ${title.toLowerCase()}—the middle of all scored videos, not one clip. Usual range shows where most videos fall; the full spread shows rare lows and highs.`;

  return {
    title,
    subtitle: "Whole-channel snapshot (all completed analyses)",
    valueLine,
    badgeText,
    interpretation,
    targetRange:
      "Typical is the middle value across scored videos. Usual range is where most videos sit (the middle bulk). Full spread captures unusually low and high ends of this channel’s uploads.",
    howMeasured:
      "Each video is analyzed once; we combine every completed run for this channel name in the database. Open a single video from the list below if you need moment-by-moment detail.",
    suggestions: [],
    timelineLines: [
      "These figures summarize the entire channel. Use “Examples & individual videos” below to open one recording.",
    ],
    statsRows,
    detailSections: [],
  };
}

export function metricBenchmarkHint(metric: MetricKey, cards: MetricCardsSnapshot): string {
  switch (metric) {
    case "speech_rate": {
      const w = Number(cards.wpm);
      return Number.isFinite(w)
        ? `Typical speaking pace across this channel’s completed videos (~${Math.round(w)} WPM).`
        : "Typical WPM across completed videos on this channel.";
    }
    case "filler_words":
      return "Typical filler rate per minute of speech, averaged across the channel’s completed videos.";
    case "eye_contact":
      return "Typical on-camera share across videos where we could measure the face.";
    case "gestures":
      return "Typical gesture activity per minute across the channel’s completed videos.";
    case "tonal_variation":
      return "Typical pitch-variation score across the channel’s completed videos.";
    case "expression_change":
      return "Typical expression change rate across the channel’s completed videos.";
    default:
      return "";
  }
}

export function benchmarkKeyForMetric(metric: MetricKey): string {
  return BENCH_KEY[metric];
}
