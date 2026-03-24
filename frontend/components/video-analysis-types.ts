export type MetricKey =
  | "speech_rate"
  | "filler_words"
  | "eye_contact"
  | "tonal_variation"
  | "expression_change"
  | "gestures";

export type MetricEvent = {
  metric?: string;
  label?: string;
  t0: number;
  t1?: number;
  value?: number;
  note?: string;
  type?: string;
  message?: string;
};

