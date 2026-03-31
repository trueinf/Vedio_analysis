"use client";

import { useMemo, useState } from "react";
import { buildMetricDetail, metricCardHint, type MetricDetailContext } from "./metricDetailContent";
import { MetricDetailModal } from "./MetricDetailModal";
import type { MetricEvent, MetricKey } from "./video-analysis-types";
import { Card } from "./ui";

function metricIcon(metric: string): string {
  if (metric === "eye_contact") return "👀";
  if (metric === "filler_words") return "🗣️";
  if (metric === "speech_rate") return "⏱️";
  if (metric === "tonal_variation") return "🎵";
  if (metric === "expression_change") return "🙂";
  if (metric === "gestures") return "🖐️";
  return "•";
}

function StatCard(props: {
  title: string;
  subtitle: string;
  value: string;
  badge: { text: string; tone: "good" | "warn" | "bad" | "neutral" };
  hint?: string;
  onClick?: () => void;
  active?: boolean;
  icon?: string;
}) {
  const tone =
    props.badge.tone === "good"
      ? "bg-green-100 text-green-700"
      : props.badge.tone === "warn"
      ? "bg-amber-100 text-amber-700"
      : props.badge.tone === "bad"
      ? "bg-red-100 text-red-700"
      : "bg-slate-100 text-slate-700";
  return (
    <Card
      className={`p-4 h-full transition-all ${props.onClick ? "cursor-pointer hover:shadow-md" : ""} ${
        props.active ? "ring-2 ring-blue-300 shadow-md" : ""
      } bg-white/5 border border-white/10 backdrop-blur text-white hover:scale-[1.01]`}
      onClick={props.onClick}
    >
      <div className="text-base font-semibold">{props.title}</div>
      <div className="text-sm text-slate-300 mt-0.5">{props.subtitle}</div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="text-xl shrink-0">{props.icon ?? ""}</div>
        <div className="text-4xl font-semibold leading-none text-right min-w-0 flex-1">{props.value}</div>
        <div className={`text-xs px-2 py-1 rounded-md shrink-0 self-end ${tone}`}>{props.badge.text}</div>
      </div>
      {props.hint ? (
        <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-white/10 leading-relaxed">{props.hint}</p>
      ) : null}
      {props.onClick ? (
        <p className="text-[11px] text-slate-500 mt-2">Click for full breakdown</p>
      ) : null}
    </Card>
  );
}

export function MetricsGrid(props: {
  show: boolean;
  currentStepId: string;
  demoMetricValue: number;
  selectedMetric: MetricKey | "";
  onSelectMetric: (metric: MetricKey) => void;
  cards: {
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
  events: MetricEvent[];
  durationSec: number;
  eyeNotMeasurable: boolean;
  metricDetailContext?: MetricDetailContext | null;
}) {
  const [detailMetric, setDetailMetric] = useState<MetricKey | null>(null);

  const detailPayload = useMemo(() => {
    if (!detailMetric) return null;
    return buildMetricDetail(
      detailMetric,
      props.cards,
      props.durationSec,
      props.events,
      props.eyeNotMeasurable,
      props.metricDetailContext ?? null
    );
  }, [detailMetric, props.cards, props.durationSec, props.events, props.eyeNotMeasurable, props.metricDetailContext]);

  const openDetail = (metric: MetricKey) => {
    props.onSelectMetric(metric);
    setDetailMetric(metric);
  };

  const cardSnapshot = props.cards;
  const demoSpeech = props.currentStepId === "metrics";

  return (
    <>
      <div
        id="demo-metrics"
        className={`col-span-12 grid grid-cols-1 md:grid-cols-4 gap-5 auto-rows-fr ${props.show ? "" : "hidden"}`}
      >
        <StatCard
          title="Speech Rate"
          subtitle="Words Per Minute"
          icon={metricIcon("speech_rate")}
          value={
            props.currentStepId === "metrics"
              ? `${Math.round(props.demoMetricValue)} WPM`
              : typeof props.cards.wpm === "number"
              ? `${Math.round(props.cards.wpm)} WPM`
              : `${props.cards.wpm}`
          }
          active={props.selectedMetric === "speech_rate"}
          onClick={() => openDetail("speech_rate")}
          badge={(() => {
            const w = Number(props.cards.wpm);
            if (!Number.isFinite(w)) return { text: "—", tone: "neutral" as const };
            if (w < 95) return { text: "Slow", tone: "warn" as const };
            if (w > 160) return { text: "Fast", tone: "warn" as const };
            return { text: "Normal", tone: "good" as const };
          })()}
          hint={metricCardHint("speech_rate", cardSnapshot, props.eyeNotMeasurable, {
            useDemoWpm: demoSpeech,
            demoWpm: props.demoMetricValue,
          })}
        />
        <StatCard
          title="Filler Words"
          subtitle="Per Minute"
          icon={metricIcon("filler_words")}
          value={typeof props.cards.fillers === "number" ? `${props.cards.fillers.toFixed(1)}` : `${props.cards.fillers}`}
          active={props.selectedMetric === "filler_words"}
          onClick={() => openDetail("filler_words")}
          badge={(() => {
            const f = Number(props.cards.fillers);
            if (!Number.isFinite(f)) return { text: "—", tone: "neutral" as const };
            if (f <= 2) return { text: "Low", tone: "good" as const };
            if (f <= 5) return { text: "Moderate", tone: "warn" as const };
            return { text: "High", tone: "bad" as const };
          })()}
          hint={metricCardHint("filler_words", cardSnapshot, props.eyeNotMeasurable)}
        />
        <StatCard
          title="Eye Contact"
          subtitle="On Camera Time"
          icon={metricIcon("eye_contact")}
          value={typeof props.cards.eye === "number" ? `${Math.round(props.cards.eye * 100)}%` : `${props.cards.eye}`}
          active={props.selectedMetric === "eye_contact"}
          onClick={() => openDetail("eye_contact")}
          badge={(() => {
            const e = Number(props.cards.eye);
            if (!Number.isFinite(e) || e < 0) return { text: "—", tone: "neutral" as const };
            const pct = e * 100;
            if (pct >= 50) return { text: "Good", tone: "good" as const };
            if (pct >= 30) return { text: "Decent", tone: "warn" as const };
            return { text: "Low", tone: "bad" as const };
          })()}
          hint={metricCardHint("eye_contact", cardSnapshot, props.eyeNotMeasurable)}
        />
        <StatCard
          title="Gestures"
          subtitle="Actions Per Minute"
          icon={metricIcon("gestures")}
          value={typeof props.cards.gestures === "number" ? `${props.cards.gestures.toFixed(1)}` : `${props.cards.gestures}`}
          active={props.selectedMetric === "gestures"}
          onClick={() => openDetail("gestures")}
          badge={(() => {
            const g = Number(props.cards.gestures);
            if (!Number.isFinite(g)) return { text: "—", tone: "neutral" as const };
            if (g < 4) return { text: "Low", tone: "warn" as const };
            if (g <= 20) return { text: "Normal", tone: "good" as const };
            return { text: "High", tone: "warn" as const };
          })()}
          hint={metricCardHint("gestures", cardSnapshot, props.eyeNotMeasurable)}
        />
      </div>

      <div className={`col-span-12 grid grid-cols-1 md:grid-cols-2 gap-5 auto-rows-fr ${props.show ? "" : "hidden"}`}>
        <StatCard
          title="Tonal Variation"
          subtitle="Pitch Variation (librosa)"
          icon={metricIcon("tonal_variation")}
          value={props.cards.tonalScore != null && typeof props.cards.tonalScore === "number" ? props.cards.tonalScore.toFixed(1) : "N/A"}
          active={props.selectedMetric === "tonal_variation"}
          onClick={() => openDetail("tonal_variation")}
          badge={(() => {
            const label = props.cards.tonalLabel;
            const text =
              label === "expressive"
                ? "Expressive"
                : label === "moderate"
                ? "Moderate"
                : label === "monotone"
                ? "Monotone"
                : label === "flat"
                ? "Flat"
                : label
                ? String(label).replace(/\b\w/g, (c) => c.toUpperCase())
                : "N/A";
            const tone =
              label === "expressive"
                ? "good"
                : label === "moderate"
                ? "warn"
                : label === "monotone" || label === "flat"
                ? "bad"
                : "neutral";
            return { text, tone: tone as "good" | "warn" | "bad" | "neutral" };
          })()}
          hint={metricCardHint("tonal_variation", cardSnapshot, props.eyeNotMeasurable)}
        />
        <StatCard
          title="Expressions"
          icon={metricIcon("expression_change")}
          subtitle={props.cards.exprTop !== "-" ? `Changes/min · Top: ${props.cards.exprTop}` : "Changes Per Minute"}
          value={Number.isFinite(props.cards.exprChangesPerMin) ? props.cards.exprChangesPerMin.toFixed(1) : "-"}
          active={props.selectedMetric === "expression_change"}
          onClick={() => openDetail("expression_change")}
          badge={{
            text: props.cards.exprBadge === "low" ? "Low" : props.cards.exprBadge === "high" ? "High" : "Normal",
            tone: props.cards.exprBadge === "normal" ? "good" : "warn",
          }}
          hint={metricCardHint("expression_change", cardSnapshot, props.eyeNotMeasurable)}
        />
      </div>

      <MetricDetailModal
        open={detailMetric != null}
        onClose={() => setDetailMetric(null)}
        detail={detailPayload}
      />
    </>
  );
}

