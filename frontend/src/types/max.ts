export interface MaxContentPart {
  type: "text" | "image";
  text?: string;
  data?: string;       // base64 image data
  media_type?: string; // e.g. "image/png"
}

export interface MaxMessage {
  role: "user" | "assistant";
  content: MaxContentPart[];
}

export interface MaxContext {
  script?: string;
  payload?: string;
  output?: string;
  error?: string;
  flow_summary?: string;
  project_name?: string;
  session_summary?: string;
  global_prefs?: string;
  project_prefs?: string;
}

export type MaxProvider = "anthropic" | "vertex" | "claude-cli";

/** The user picks a family; the backend resolves it to the newest model in it. */
export type MaxModelFamily = "sonnet" | "opus";

export const MODEL_FAMILIES: { value: MaxModelFamily; label: string; hint: string }[] = [
  { value: "sonnet", label: "Sonnet", hint: "Fast, great for everyday DataWeave work" },
  { value: "opus",   label: "Opus",   hint: "Deeper reasoning for hard flows and debugging" },
];

export interface MaxChatRequest {
  api_key?: string;
  provider?: MaxProvider;
  vertex_region?: string;
  messages: MaxMessage[];
  context?: MaxContext;
  model_family?: MaxModelFamily;
}

export interface MaxSummarizeRequest {
  api_key?: string;
  provider?: MaxProvider;
  vertex_region?: string;
  messages: MaxMessage[];
  existing_summary?: string;
}

export interface MaxSummarizeResponse {
  summary: string;
}

export interface MaxTestRequest {
  provider: MaxProvider;
  api_key?: string;
  vertex_region?: string;
}

export interface MaxTestResponse {
  success: boolean;
  error?: string;
  project_id?: string;
}
