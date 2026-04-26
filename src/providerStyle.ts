// Refined, muted palette — one accent hue per provider. Used as a small dot,
// never as a fill, to keep the page calm.
export const PROVIDER_COLOR: Record<string, string> = {
  Anthropic: "#C96442",
  OpenAI: "#0E9F6E",
  Google: "#3B6EF5",
  xAI: "#111111",
  DeepSeek: "#5B4DBF",
  Meta: "#1E64DC",
  Alibaba: "#E26A2C",
  Mistral: "#E04A1F",
};

export const colorFor = (creator: string) => PROVIDER_COLOR[creator] ?? "#888";
