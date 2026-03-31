import type { MetricEvent, MetricKey } from "./video-analysis-types";

export function formatTimeShort(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const METRIC_EVENT_KEY: Record<MetricKey, string> = {
  speech_rate: "speech_rate",
  filler_words: "filler_words",
  eye_contact: "eye_contact",
  tonal_variation: "tonal_variation",
  expression_change: "expression_change",
  gestures: "gestures",
};

export function eventsForMetric(metric: MetricKey, events: MetricEvent[]): MetricEvent[] {
  const key = METRIC_EVENT_KEY[metric];
  return events
    .filter((e) => String(e.metric || e.type) === key)
    .sort((a, b) => Number(a.t0 || 0) - Number(b.t0 || 0));
}

export function summarizeMetricEvents(metric: MetricKey, events: MetricEvent[], maxLines = 5): string[] {
  const list = eventsForMetric(metric, events);
  if (!list.length) return ["No separate timeline markers for this metric in this video (overall score still uses the summary above)."];

  const lines: string[] = [];
  const count = list.length;
  lines.push(`${count} timed segment${count === 1 ? "" : "s"} on the video timeline for this metric.`);

  const slice = list.slice(0, maxLines);
  for (const e of slice) {
    const t0 = formatTimeShort(Number(e.t0 || 0));
    const t1 = e.t1 != null ? formatTimeShort(Number(e.t1)) : t0;
    const label = e.label || e.note || e.message || "";
    lines.push(`${t0}–${t1}${label ? `: ${label}` : ""}`);
  }
  if (list.length > maxLines) {
    lines.push(`…and ${list.length - maxLines} more on the timeline.`);
  }
  return lines;
}

export type MetricCardsSnapshot = {
  wpm: number | string;
  fillers: number | string;
  eye: number | string;
  gestures: number | string;
  tonalScore: number | null;
  tonalLabel: string | null;
  exprTop: string;
  exprChangesPerMin: number;
  exprBadge: string;
};

export type TimelineBinRow = {
  t0?: number;
  t1?: number;
  wpm?: number;
  fillers_per_min?: number;
  eye_contact?: number | null;
  gestures_per_min?: number | null;
  expression_changes_per_min?: number | null;
  scene?: string;
};

export type MetricDetailContext = {
  durationSec: number;
  binSizeSec: number;
  timelineBins: TimelineBinRow[];
  rawCards?: Record<string, unknown> | null;
  transcriptPreview?: string | null;
  debug?: {
    speech_duration_sec?: number;
    timed_words_count?: number;
    low_speech_detected?: boolean;
  } | null;
  summary?: {
    overall_score?: number;
    warnings?: string[];
  } | null;
  quality?: Record<string, unknown> | null;
  speakers?: Record<string, unknown>[] | null;
};

export type DetailSection = { title: string; items: string[] };

export type MetricDetailPayload = {
  title: string;
  subtitle: string;
  valueLine: string;
  badgeText: string;
  interpretation: string;
  targetRange: string;
  howMeasured: string;
  suggestions: string[];
  timelineLines: string[];
  statsRows: { label: string; value: string }[];
  detailSections: DetailSection[];
};

function wpmBadge(w: number): { text: string } {
  if (!Number.isFinite(w)) return { text: "—" };
  if (w < 95) return { text: "Slow" };
  if (w > 160) return { text: "Fast" };
  return { text: "Normal" };
}

function formatDurationVerbose(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function computeMetricExtras(
  metric: MetricKey,
  ctx: MetricDetailContext | null | undefined,
  events: MetricEvent[]
): { statsRows: { label: string; value: string }[]; detailSections: DetailSection[] } {
  if (!ctx) return { statsRows: [], detailSections: [] };
  const rows: { label: string; value: string }[] = [];
  const sections: DetailSection[] = [];
  const bins = ctx.timelineBins || [];
  const binSec = Number(ctx.binSizeSec) || 10;

  if (typeof ctx.summary?.overall_score === "number") {
    rows.push({ label: "Overall delivery score", value: String(Math.round(ctx.summary.overall_score)) });
  }
  if (ctx.summary?.warnings?.length) {
    rows.push({ label: "Pipeline notes", value: ctx.summary.warnings.join(" ") });
  }
  rows.push({ label: "Video duration", value: formatDurationVerbose(ctx.durationSec) });
  rows.push({ label: "Merged timeline bins", value: `${binSec}s windows (speech + vision)` });

  if (ctx.quality && typeof ctx.quality.sampled_frames === "number") {
    rows.push({ label: "Vision frames analyzed (sampled)", value: String(ctx.quality.sampled_frames) });
  }
  if (ctx.quality && typeof ctx.quality.speakers_detected === "number") {
    rows.push({ label: "Speakers detected (vision)", value: String(ctx.quality.speakers_detected) });
  }
  if (ctx.quality && typeof ctx.quality.insightface_active === "boolean") {
    rows.push({ label: "InsightFace tracking", value: ctx.quality.insightface_active ? "On" : "Off" });
  }

  switch (metric) {
    case "speech_rate": {
      const sr = asRecord(ctx.rawCards?.speech_rate);
      if (sr) {
        if (typeof sr.words === "number") rows.push({ label: "Words counted", value: String(Math.round(sr.words)) });
        if (typeof sr.speaking_sec === "number")
          rows.push({ label: "Speaking time (speech segments)", value: formatDurationVerbose(sr.speaking_sec) });
      }
      if (ctx.debug) {
        if (typeof ctx.debug.timed_words_count === "number")
          rows.push({ label: "Words with timestamps", value: String(ctx.debug.timed_words_count) });
        if (typeof ctx.debug.speech_duration_sec === "number")
          rows.push({ label: "Span used for overall WPM", value: formatDurationVerbose(ctx.debug.speech_duration_sec) });
        if (ctx.debug.low_speech_detected)
          rows.push({ label: "Low speech flag", value: "Yes — check audio level or non-speech content" });
      }
      const wpmBins = bins
        .map((b) => ({ b, w: Number(b.wpm) }))
        .filter((x) => Number.isFinite(x.w) && x.w > 0);
      if (wpmBins.length) {
        const vals = wpmBins.map((x) => x.w);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const maxB = wpmBins.reduce((a, x) => (x.w > a.w ? x : a));
        const minB = wpmBins.reduce((a, x) => (x.w < a.w ? x : a));
        const fast = wpmBins.filter((x) => x.w > 160).length;
        const slow = wpmBins.filter((x) => x.w > 0 && x.w < 95).length;
        sections.push({
          title: `Pace in ${binSec}s windows`,
          items: [
            `Mean WPM across bins with speech: ~${Math.round(avg)}`,
            `Peak window ${formatTimeShort(Number(maxB.b.t0))}–${formatTimeShort(Number(maxB.b.t1))}: ~${Math.round(maxB.w)} WPM`,
            `Lowest active window ${formatTimeShort(Number(minB.b.t0))}–${formatTimeShort(Number(minB.b.t1))}: ~${Math.round(minB.w)} WPM`,
            `${fast} bin(s) above 160 WPM · ${slow} bin(s) below 95 WPM (where speech was detected)`,
          ],
        });
      } else {
        sections.push({
          title: "Pace in timeline bins",
          items: ["No per-bin WPM in the merged timeline for this run (very short clip or sparse speech)."],
        });
      }
      if (ctx.transcriptPreview?.trim()) {
        const t = ctx.transcriptPreview.trim();
        sections.push({
          title: "Transcript excerpt",
          items: [t.length > 600 ? `${t.slice(0, 600)}…` : t],
        });
      }
      break;
    }
    case "filler_words": {
      const fw = asRecord(ctx.rawCards?.filler_words);
      if (fw) {
        if (typeof fw.count === "number") rows.push({ label: "Total filler instances", value: String(fw.count) });
        const byType = asRecord(fw.by_type);
        if (byType && Object.keys(byType).length) {
          const top = Object.entries(byType)
            .filter(([, n]) => typeof n === "number")
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .slice(0, 8)
            .map(([k, n]) => `${k}: ${n}`);
          sections.push({ title: "Fillers by type", items: top });
        }
      }
      const fillerBins = bins
        .map((b) => ({ b, f: Number(b.fillers_per_min) }))
        .filter((x) => Number.isFinite(x.f) && x.f > 0)
        .sort((a, b) => b.f - a.f)
        .slice(0, 5);
      if (fillerBins.length) {
        sections.push({
          title: "Busiest windows (fillers / min)",
          items: fillerBins.map(
            (x) =>
              `${formatTimeShort(Number(x.b.t0))}–${formatTimeShort(Number(x.b.t1))}: ~${x.f.toFixed(1)}/min`
          ),
        });
      }
      if (ctx.transcriptPreview?.trim()) {
        const t = ctx.transcriptPreview.trim();
        sections.push({
          title: "Transcript excerpt (for context)",
          items: [t.length > 400 ? `${t.slice(0, 400)}…` : t],
        });
      }
      break;
    }
    case "eye_contact": {
      const ec = asRecord(ctx.rawCards?.eye_contact);
      if (ec && typeof ec.face_visible_ratio === "number")
        rows.push({
          label: "Face visible (sampled frames)",
          value: `${Math.round(ec.face_visible_ratio * 100)}%`,
        });
      const eyeBins = bins
        .map((b) => ({ b, e: b.eye_contact }))
        .filter((x): x is { b: TimelineBinRow; e: number } => typeof x.e === "number" && Number.isFinite(x.e))
        .sort((a, b) => a.e - b.e)
        .slice(0, 5);
      if (eyeBins.length) {
        sections.push({
          title: "Weakest on-camera windows",
          items: eyeBins.map(
            (x) =>
              `${formatTimeShort(Number(x.b.t0))}–${formatTimeShort(Number(x.b.t1))}: ~${Math.round(x.e * 100)}% toward camera (${String(x.b.scene || "talking_head")})`
          ),
        });
      } else {
        sections.push({
          title: "Per-window eye contact",
          items: ["No per-bin eye ratio (face often off-frame or not detected in bins)."],
        });
      }
      if (ctx.speakers?.length) {
        const lines = ctx.speakers.slice(0, 4).map((sp, i) => {
          const id = sp.speaker_id ?? i;
          const ratio = typeof sp.on_camera_ratio === "number" ? `${Math.round(Number(sp.on_camera_ratio) * 100)}%` : "—";
          const fv = typeof sp.face_visible === "number" ? String(sp.face_visible) : "—";
          return `Speaker ${id}: on-camera ~${ratio} (face-visible frames: ${fv})`;
        });
        sections.push({ title: "Per-speaker (vision)", items: lines });
      }
      break;
    }
    case "gestures": {
      const g = asRecord(ctx.rawCards?.gestures);
      if (g) {
        if (typeof g.event_count === "number") rows.push({ label: "Total gesture events", value: String(g.event_count) });
        const types = asRecord(g.types);
        if (types && Object.keys(types).length) {
          sections.push({
            title: "Gesture types",
            items: Object.entries(types).map(([k, v]) => `${k}: ${v}`),
          });
        }
      }
      const gBins = bins
        .map((b) => ({ b, gpm: Number(b.gestures_per_min) }))
        .filter((x) => Number.isFinite(x.gpm) && x.gpm > 0)
        .sort((a, b) => b.gpm - a.gpm)
        .slice(0, 5);
      if (gBins.length) {
        sections.push({
          title: "Most active hand-motion windows",
          items: gBins.map(
            (x) =>
              `${formatTimeShort(Number(x.b.t0))}–${formatTimeShort(Number(x.b.t1))}: ~${x.gpm.toFixed(1)} events/min`
          ),
        });
      }
      break;
    }
    case "tonal_variation": {
      const tv = asRecord(ctx.rawCards?.tonal_variation);
      if (tv) {
        if (typeof tv.label === "string") rows.push({ label: "Backend label", value: tv.label });
        if (typeof tv.score === "number") rows.push({ label: "Pitch-spread index", value: tv.score.toFixed(2) });
        const pitch = asRecord(tv.pitch_hz);
        if (pitch && typeof pitch.std === "number")
          rows.push({ label: "Pitch std (librosa)", value: pitch.std.toFixed(2) });
      }
      const te = eventsForMetric("tonal_variation", events);
      if (te.length) {
        sections.push({
          title: "Tonal segments on timeline (sample)",
          items: te.slice(0, 12).map((e) => {
            const t0 = formatTimeShort(Number(e.t0));
            const t1 = e.t1 != null ? formatTimeShort(Number(e.t1)) : t0;
            const lab = e.label || e.note || "—";
            const val = e.value != null ? ` · index ${Number(e.value).toFixed(1)}` : "";
            return `${t0}–${t1}: ${lab}${val}`;
          }),
        });
      }
      break;
    }
    case "expression_change": {
      const ex = asRecord(ctx.rawCards?.expressions);
      if (ex) {
        if (typeof ex.change_count === "number")
          rows.push({ label: "Total expression changes (vision)", value: String(ex.change_count) });
        const byType = asRecord(ex.by_type);
        if (byType && Object.keys(byType).length) {
          const sorted = Object.entries(byType)
            .filter(([, n]) => typeof n === "number")
            .sort((a, b) => Number(b[1]) - Number(a[1]));
          sections.push({
            title: "Expression labels (frame counts)",
            items: sorted.map(([k, n]) => `${k}: ${n} samples`),
          });
        }
      }
      const exprBins = bins
        .map((b) => ({ b, c: Number(b.expression_changes_per_min) }))
        .filter((x) => Number.isFinite(x.c) && x.c >= 0)
        .sort((a, b) => b.c - a.c)
        .slice(0, 5);
      if (exprBins.length) {
        sections.push({
          title: "Highest expression-change windows",
          items: exprBins.map(
            (x) =>
              `${formatTimeShort(Number(x.b.t0))}–${formatTimeShort(Number(x.b.t1))}: ~${x.c.toFixed(1)} changes/min`
          ),
        });
      }
      break;
    }
    default:
      break;
  }

  return { statsRows: rows, detailSections: sections };
}

function withExtras(
  metric: MetricKey,
  ctx: MetricDetailContext | null | undefined,
  events: MetricEvent[],
  base: Omit<MetricDetailPayload, "statsRows" | "detailSections">
): MetricDetailPayload {
  return { ...base, ...computeMetricExtras(metric, ctx, events) };
}

export function buildMetricDetail(
  metric: MetricKey,
  cards: MetricCardsSnapshot,
  _durationSec: number,
  events: MetricEvent[],
  eyeNotMeasurable: boolean,
  ctx?: MetricDetailContext | null
): MetricDetailPayload {
  const timelineLines = summarizeMetricEvents(metric, events, 14);

  switch (metric) {
    case "speech_rate": {
      const w = Number(cards.wpm);
      const badge = wpmBadge(w);
      let interpretation =
        "Speaking pace is how many words you say per minute during detected speech. Very slow or very fast delivery can make content harder to follow.";
      if (Number.isFinite(w)) {
        if (w < 95) {
          interpretation = `At about ${Math.round(w)} WPM, your pace is below the band we treat as easy to follow for most listeners (about 95–160 WPM). Viewers may have more time to absorb each point, but very slow speech can feel sluggish.`;
        } else if (w > 160) {
          interpretation = `At about ${Math.round(w)} WPM, you are speaking faster than the upper end of the “comfortable” band (about 95–160 WPM). High energy is fine, but very fast speech can reduce clarity for some audiences.`;
        } else {
          interpretation = `At about ${Math.round(w)} WPM, you are inside the typical comfortable range (about 95–160 WPM) for many educational and conversational videos.`;
        }
      }
      return withExtras(metric, ctx, events, {
        title: "Speech rate",
        subtitle: "Words per minute (WPM)",
        valueLine: Number.isFinite(w) ? `${Math.round(w)} WPM` : String(cards.wpm),
        badgeText: badge.text,
        interpretation,
        targetRange:
          "Reference band used in this app: about 95–160 WPM as “normal.” Outside that range is labeled Slow or Fast for coaching, not as a universal truth for every format.",
        howMeasured:
          "The backend transcribes audio with faster-whisper, counts words over time, and estimates WPM from timed speech segments. Long videos may use a smaller model for speed.",
        suggestions: Number.isFinite(w)
          ? w < 95
            ? ["Add a touch more energy or tighten pauses if the video feels slow.", "Emphasize key phrases so the pace feels intentional."]
            : w > 160
              ? ["Insert short pauses after important points.", "Repeat or spell out critical numbers and names."]
              : ["Keep varying emphasis so the steady pace does not feel flat.", "Use pauses before big ideas."]
          : ["Run analysis on a video with clear speech to get a WPM reading."],
        timelineLines,
      });
    }
    case "filler_words": {
      const f = Number(cards.fillers);
      const badge =
        Number.isFinite(f) && f <= 2 ? "Low" : Number.isFinite(f) && f <= 5 ? "Moderate" : Number.isFinite(f) ? "High" : "—";
      let interpretation =
        "Filler words (like “um,” “uh,” “like”) are counted from the transcript and shown per minute of analyzed speech.";
      if (Number.isFinite(f)) {
        if (f <= 2) interpretation = `${f.toFixed(1)} fillers per minute is relatively low. Occasional fillers are normal and can sound human.`;
        else if (f <= 5)
          interpretation = `${f.toFixed(1)} fillers per minute is moderate. Listeners may start noticing clusters; reducing fillers in key moments helps authority.`;
        else interpretation = `${f.toFixed(1)} fillers per minute is high. Reducing fillers in intros, CTAs, and punchlines usually has the biggest impact.`;
      }
      return withExtras(metric, ctx, events, {
        title: "Filler words",
        subtitle: "Per minute",
        valueLine: Number.isFinite(f) ? `${f.toFixed(1)} / min` : String(cards.fillers),
        badgeText: badge,
        interpretation,
        targetRange:
          "Rough guide in this app: up to ~2/min labeled Low, ~2–5 Moderate, above ~5 High. Your genre (casual vs. corporate) may differ.",
        howMeasured:
          "Transcript from faster-whisper is scanned for a fixed list of fillers (e.g. um, uh, like, you know). Word-level timestamps place them on the timeline.",
        suggestions: Number.isFinite(f)
          ? f > 2
            ? ['Replace fillers with a brief silent pause before the next thought.', "Re-record only the worst 2–3 segments if editing time is limited."]
            : ["Keep the habit: short silence beats filler when you need thinking time."]
          : ["Complete a run with speech detected to see filler rate."],
        timelineLines,
      });
    }
    case "eye_contact": {
      const e = Number(cards.eye);
      const pct = Number.isFinite(e) ? Math.round(e * 100) : null;
      const badge =
        eyeNotMeasurable || !Number.isFinite(e)
          ? "N/A"
          : pct != null && pct >= 50
            ? "Good"
            : pct != null && pct >= 30
              ? "Decent"
              : "Low";
      const interpretation =
        eyeNotMeasurable || !Number.isFinite(e)
          ? "Eye contact could not be scored reliably—often because your face is small, off-frame, or not visible for enough of the video. Try framing face and camera at eye level for future takes."
          : pct != null
            ? `About ${pct}% of face-visible frames are classified as “on camera” (looking toward the lens by our head-pose / gaze heuristic). Higher tends to feel more direct for talking-head content; exact targets depend on style (e.g. reading vs. vlog).`
            : "No numeric eye-contact ratio for this run.";
      return withExtras(metric, ctx, events, {
        title: "Eye contact",
        subtitle: "On-camera time (when face is visible)",
        valueLine:
          eyeNotMeasurable || !Number.isFinite(e) ? "Not measurable" : `${pct}%`,
        badgeText: badge,
        interpretation,
        targetRange:
          "This app uses approximate bands: ~50%+ labeled Good, ~30–50% Decent, below ~30% Low—only when the face is detected often enough.",
        howMeasured:
          "Video frames are sampled; MediaPipe Face Mesh (with iris) estimates gaze / head pose. Optional InsightFace can help with multiple faces. Ratios are over frames where a face was found.",
        suggestions: eyeNotMeasurable
          ? ["Center your face in frame and improve lighting.", "Look toward the camera lens for key lines."]
          : pct != null && pct < 50
            ? ["On sentence endings, glance to the lens.", "Place notes near the webcam to reduce side-eye."]
            : ["Keep mixing intentional look-away for emphasis—variety is natural."],
        timelineLines,
      });
    }
    case "gestures": {
      const g = Number(cards.gestures);
      const badge =
        !Number.isFinite(g) ? "—" : g < 4 ? "Low" : g <= 20 ? "Normal" : "High";
      let interpretation =
        "Gesture rate counts noticeable hand / wrist motions per minute (with cooldown so small jitter is not over-counted).";
      if (Number.isFinite(g)) {
        if (g < 4) interpretation = `${g.toFixed(1)} gestures per minute is on the low side for many presenters; adding occasional hand beats can reinforce key ideas.`;
        else if (g <= 20) interpretation = `${g.toFixed(1)} gestures per minute sits in a typical active-presenting range for this detector.`;
        else interpretation = `${g.toFixed(1)} gestures per minute is high; it can read as energetic or, if constant, distracting—calibrate to your format.`;
      }
      return withExtras(metric, ctx, events, {
        title: "Gestures",
        subtitle: "Actions per minute (estimated)",
        valueLine: Number.isFinite(g) ? `${g.toFixed(1)} / min` : String(cards.gestures),
        badgeText: badge,
        interpretation,
        targetRange:
          "Heuristic bands in UI: below ~4/min Low, ~4–20 Normal, above ~20 High. Thresholds are tuned for webcam-style framing.",
        howMeasured:
          "MediaPipe Hands tracks wrists; movement above a pixel threshold with a time cooldown counts as one gesture event. Events are normalized per minute using speaking-related duration from the pipeline.",
        suggestions: Number.isFinite(g)
          ? g < 4
            ? ["Use one clear gesture per main point.", "Open hands slightly on transitions."]
            : g > 20
              ? ["Hold still through dense facts; gesture on keywords only.", "Keep hands in frame without constant motion."]
              : ["Pair gestures with verbal emphasis for maximum clarity."]
          : ["Analyze a video with upper body visible for gesture stats."],
        timelineLines,
      });
    }
    case "tonal_variation": {
      const score = cards.tonalScore;
      const label = (cards.tonalLabel || "").toLowerCase();
      const valueLine =
        score != null && typeof score === "number" ? `${score.toFixed(1)} (${label || "—"})` : "N/A";
      const badge =
        label === "expressive"
          ? "Expressive"
          : label === "moderate"
            ? "Moderate"
            : label === "monotone" || label === "flat"
              ? "Monotone"
              : label
                ? label.replace(/\b\w/g, (c) => c.toUpperCase())
                : "—";
      let interpretation =
        "Tonal variation reflects how much pitch moves in the audio—more movement usually sounds more engaging; flat delivery can feel monotonous.";
      if (label === "monotone" || label === "flat") {
        interpretation =
          "Your pitch variation is low in our sample (librosa pitch track). That often reads as flat or monotone; stressing keywords and varying sentence rhythm helps.";
      } else if (label === "expressive") {
        interpretation =
          "Pitch variation is high relative to our thresholds—delivery likely sounds lively. Keep clarity in mind if volume or pitch swings are extreme.";
      } else if (label === "moderate") {
        interpretation = "Pitch variation is in the middle range—neither flat nor extremely dynamic.";
      }
      return withExtras(metric, ctx, events, {
        title: "Tonal variation",
        subtitle: "Pitch movement (librosa)",
        valueLine,
        badgeText: badge,
        interpretation,
        targetRange:
          "Labels use pitch standard deviation bands on a short analysis window (e.g. monotone vs moderate vs expressive). Exact numeric score is an internal scale, not Hz.",
        howMeasured:
          "Audio is analyzed with librosa’s piptrack; spread of non-zero pitch estimates becomes a score and a categorical label. Long files may only analyze a capped duration for speed.",
        suggestions:
          label === "monotone" || label === "flat"
            ? ["Stress important words with slightly higher pitch.", "Break long sentences; change pace between ideas."]
            : ["Keep intentional contrast: calm setup, brighter emphasis on payoffs."],
        timelineLines,
      });
    }
    case "expression_change": {
      const cpm = cards.exprChangesPerMin;
      const badge = cards.exprBadge === "low" ? "Low" : cards.exprBadge === "high" ? "High" : "Normal";
      const interpretation = Number.isFinite(cpm)
        ? `About ${cpm.toFixed(1)} expression changes per minute (facial label flips in sampled frames). Top observed label: ${cards.exprTop}. Low change can look static; very high change can feel hectic depending on context.`
        : "Expression change rate could not be computed (often low face visibility).";
      return withExtras(metric, ctx, events, {
        title: "Expressions",
        subtitle: "Face expression variety",
        valueLine: Number.isFinite(cpm) ? `${cpm.toFixed(1)} changes/min · top: ${cards.exprTop}` : "—",
        badgeText: badge,
        interpretation,
        targetRange:
          "UI buckets: under ~20 changes/min Low, ~20–60 Normal, above ~60 High (heuristic, depends on sampling FPS and video length).",
        howMeasured:
          "MediaPipe face landmarks drive simple expression labels (e.g. neutral, smile); a change is counted when the dominant label switches between sampled frames.",
        suggestions:
          cards.exprBadge === "low"
            ? ["React visibly to key beats (smile, eyebrow flash) without overacting.", "Check lighting so the model sees your face clearly."]
            : ["Hold a calmer base expression during dense information.", "Save bigger faces for punchlines."],
        timelineLines,
      });
    }
    default:
      return withExtras(metric, ctx, events, {
        title: "Metric",
        subtitle: "",
        valueLine: "—",
        badgeText: "—",
        interpretation: "",
        targetRange: "",
        howMeasured: "",
        suggestions: [],
        timelineLines: [],
      });
  }
}

/** Short context line shown on each metric card under the main number (matches modal bands). */
export function metricCardHint(
  metric: MetricKey,
  cards: MetricCardsSnapshot,
  eyeNotMeasurable: boolean,
  options?: { demoWpm?: number; useDemoWpm?: boolean }
): string {
  switch (metric) {
    case "speech_rate": {
      const w =
        options?.useDemoWpm && typeof options.demoWpm === "number" && Number.isFinite(options.demoWpm)
          ? options.demoWpm
          : Number(cards.wpm);
      if (!Number.isFinite(w))
        return "Estimated from your transcript over timed speech. Complete a run to compare against our ~95–160 WPM guide.";
      if (w < 95)
        return `Below the ~95 WPM lower guide — more time per word; consider slightly quicker energy on hooks.`;
      if (w > 160)
        return `Above the ~160 WPM upper guide — strong pace; use short pauses so names and numbers stay clear.`;
      return `Inside the ~95–160 WPM band we use as “comfortable” for many explainer-style videos.`;
    }
    case "filler_words": {
      const f = Number(cards.fillers);
      if (!Number.isFinite(f))
        return "Counted from the transcript (um, uh, like, …) per minute of analyzed speech.";
      if (f <= 2)
        return "Very light filler load — listeners get a crisp, confident feel on most lines.";
      if (f <= 5)
        return "Moderate fillers — fine for casual tone; trim them on intros, CTAs, and proof points.";
      return "High filler rate — try silent pauses instead of sounds between thoughts.";
    }
    case "eye_contact": {
      if (eyeNotMeasurable)
        return "We rarely saw a clear face in frame, so this score isn’t reliable — center your face and light it evenly.";
      const e = Number(cards.eye);
      if (!Number.isFinite(e))
        return "Share of face-visible moments where gaze/head pose reads as toward the camera.";
      const pct = Math.round(e * 100);
      if (pct >= 65)
        return `When your face is visible, ~${pct}% of those moments read as “on camera” — strong direct-to-viewer feel.`;
      if (pct >= 40)
        return `Mixed on-camera time (~${pct}% of face-visible frames) — good baseline; strengthen on key sentences.`;
      return `Lower on-camera share (~${pct}% of face-visible frames) — glance to the lens on punchlines and sign-offs.`;
    }
    case "gestures": {
      const g = Number(cards.gestures);
      if (!Number.isFinite(g))
        return "Hand motion events per minute from wrist tracking (with cooldown so tiny jitter isn’t counted).";
      if (g < 4)
        return "Hands are fairly quiet — one deliberate gesture per main idea can boost clarity.";
      if (g <= 20)
        return "Steady, present-level gesturing — matches what many coaches want for webcam-style delivery.";
      return "Very active hands — energy reads high; avoid constant motion during dense facts.";
    }
    case "tonal_variation": {
      const label = (cards.tonalLabel || "").toLowerCase();
      const score = cards.tonalScore;
      const scoreBit =
        score != null && Number.isFinite(score) ? ` Score ${score.toFixed(1)} is our pitch-spread index (not Hz).` : "";
      if (label === "expressive" || label === "moderate")
        return `Pitch moves enough to avoid sounding flat.${scoreBit} Label: ${label || "—"}.`;
      if (label === "monotone" || label === "flat")
        return `Pitch stays in a narrow range — delivery can feel flat; stress keywords and vary sentence length.${scoreBit}`;
      return `From librosa pitch tracks on your audio.${scoreBit || " Higher spread usually sounds more engaging."}`;
    }
    case "expression_change": {
      const cpm = cards.exprChangesPerMin;
      const top = cards.exprTop !== "-" ? cards.exprTop : "neutral";
      if (!Number.isFinite(cpm))
        return "How often your dominant face label switches between sampled frames — needs a visible face.";
      if (cards.exprBadge === "low")
        return `${cpm.toFixed(1)} changes/min — calmer face; add small reactions on beats (top label: ${top}).`;
      if (cards.exprBadge === "high")
        return `${cpm.toFixed(1)} changes/min — very lively face; steady the base during complex explanations (top: ${top}).`;
      return `${cpm.toFixed(1)} changes/min — balanced variety (most common look: ${top}).`;
    }
    default:
      return "";
  }
}
