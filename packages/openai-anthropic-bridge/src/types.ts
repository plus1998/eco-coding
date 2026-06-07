// Anthropic Messages API

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: unknown | undefined;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[] | undefined;
  stream?: boolean | undefined;
  temperature?: number | undefined;
  top_p?: number | undefined;
  stop_sequences?: string[] | undefined;
  thinking?: AnthropicThinking | undefined;
  /** Top-level effort from Claude Agent SDK / local proxy injection. */
  effort?: string | undefined;
  tool_choice?: unknown | undefined;
  metadata?: unknown | undefined;
  output_config?: AnthropicOutputConfig | undefined;
}

export interface AnthropicOutputConfig {
  effort?: string | undefined;
}

export interface AnthropicThinking {
  type: string;
  budget_tokens?: number | undefined;
}

export interface AnthropicMessage {
  role: string;
  content: unknown;
}

export interface AnthropicContentBlock {
  type: string;
  cache_control?: AnthropicCacheControl | undefined;
  text?: string | undefined;
  thinking?: string | undefined;
  source?: AnthropicImageSource | undefined;
  id?: string | undefined;
  name?: string | undefined;
  input?: unknown | undefined;
  tool_use_id?: string | undefined;
  content?: unknown | undefined;
  is_error?: boolean | undefined;
}

export interface AnthropicImageSource {
  type: string;
  media_type: string;
  data: string;
}

export interface AnthropicCacheControl {
  type: string;
  ttl?: string | undefined;
}

export interface AnthropicTool {
  type?: string | undefined;
  name: string;
  description?: string | undefined;
  input_schema?: unknown | undefined;
  cache_control?: AnthropicCacheControl | undefined;
  allowed_domains?: string[] | undefined;
  max_uses?: number | undefined;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence?: string | null | undefined;
  usage: AnthropicUsage;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse | undefined;
  index?: number | undefined;
  content_block?: AnthropicContentBlock | undefined;
  delta?: AnthropicDelta | undefined;
  usage?: AnthropicUsage | undefined;
}

export interface AnthropicDelta {
  type?: string | undefined;
  text?: string | undefined;
  partial_json?: string | undefined;
  thinking?: string | undefined;
  signature?: string | undefined;
  stop_reason?: string | undefined;
  stop_sequence?: string | null | undefined;
}

// OpenAI Responses API

export interface ResponsesRequest {
  model: string;
  instructions?: string | undefined;
  input: unknown;
  max_output_tokens?: number | undefined;
  temperature?: number | undefined;
  top_p?: number | undefined;
  stream?: boolean | undefined;
  tools?: ResponsesTool[] | undefined;
  include?: string[] | undefined;
  store?: boolean | undefined;
  parallel_tool_calls?: boolean | undefined;
  reasoning?: ResponsesReasoning | undefined;
  text?: ResponsesText | undefined;
  tool_choice?: unknown | undefined;
  service_tier?: string | undefined;
  prompt_cache_key?: string | undefined;
  previous_response_id?: string | undefined;
}

export interface ResponsesReasoning {
  effort: string;
  summary?: string | undefined;
}

export interface ResponsesText {
  verbosity?: string | undefined;
}

export interface ResponsesInputItem {
  type?: string | undefined;
  role?: string | undefined;
  content?: unknown | undefined;
  call_id?: string | undefined;
  name?: string | undefined;
  arguments?: string | undefined;
  id?: string | undefined;
  output?: string | undefined;
}

export interface ResponsesContentPart {
  type: string;
  text?: string | undefined;
  image_url?: string | undefined;
}

export interface ResponsesWebSearchFilters {
  allowed_domains?: string[] | undefined;
  blocked_domains?: string[] | undefined;
}

export interface ResponsesTool {
  type: string;
  name?: string | undefined;
  description?: string | undefined;
  parameters?: unknown | undefined;
  strict?: boolean | undefined;
  filters?: ResponsesWebSearchFilters | undefined;
}

export interface ResponsesResponse {
  id: string;
  object: string;
  model: string;
  status?: string | undefined;
  output?: ResponsesOutput[] | undefined;
  usage?: ResponsesUsage | undefined;
  incomplete_details?: ResponsesIncompleteDetails | undefined;
  error?: ResponsesError | undefined;
}

export interface ResponsesError {
  code: string;
  message: string;
}

export interface ResponsesIncompleteDetails {
  reason: string;
}

export interface ResponsesOutput {
  type: string;
  id?: string | undefined;
  role?: string | undefined;
  content?: ResponsesContentPart[] | undefined;
  status?: string | undefined;
  encrypted_content?: string | undefined;
  summary?: ResponsesSummary[] | undefined;
  call_id?: string | undefined;
  name?: string | undefined;
  arguments?: string | undefined;
  action?: WebSearchAction | undefined;
}

export interface WebSearchAction {
  type?: string | undefined;
  query?: string | undefined;
}

export interface ResponsesSummary {
  type: string;
  text: string;
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: ResponsesInputTokensDetails | undefined;
  output_tokens_details?: ResponsesOutputTokensDetails | undefined;
}

export interface ResponsesInputTokensDetails {
  cached_tokens?: number | undefined;
  audio_tokens?: number | undefined;
}

export interface ResponsesOutputTokensDetails {
  reasoning_tokens?: number | undefined;
  audio_tokens?: number | undefined;
  accepted_prediction_tokens?: number | undefined;
  rejected_prediction_tokens?: number | undefined;
}

export interface ResponsesStreamEvent {
  type: string;
  response?: ResponsesResponse | undefined;
  usage?: ResponsesUsage | undefined;
  item?: ResponsesOutput | undefined;
  output_index?: number | undefined;
  content_index?: number | undefined;
  delta?: string | undefined;
  text?: string | undefined;
  item_id?: string | undefined;
  call_id?: string | undefined;
  name?: string | undefined;
  arguments?: string | undefined;
  summary_index?: number | undefined;
  part?: ResponsesContentPart | undefined;
  code?: string | undefined;
  param?: string | undefined;
  sequence_number?: number | undefined;
}

// OpenAI Chat Completions API

export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  instructions?: string | undefined;
  max_tokens?: number | undefined;
  max_completion_tokens?: number | undefined;
  temperature?: number | undefined;
  top_p?: number | undefined;
  stream?: boolean | undefined;
  stream_options?: ChatStreamOptions | undefined;
  tools?: ChatTool[] | undefined;
  tool_choice?: unknown | undefined;
  reasoning_effort?: string | undefined;
  service_tier?: string | undefined;
  stop?: unknown | undefined;
  functions?: ChatFunction[] | undefined;
  function_call?: unknown | undefined;
}

export interface ChatStreamOptions {
  include_usage?: boolean | undefined;
}

export interface ChatMessage {
  role: string;
  content?: unknown | undefined;
  reasoning_content?: string | undefined;
  reasoning?: string | undefined;
  reasoning_details?: ChatReasoningDetail[] | undefined;
  name?: string | undefined;
  tool_calls?: ChatToolCall[] | undefined;
  tool_call_id?: string | undefined;
  function_call?: ChatFunctionCall | undefined;
}

export interface ChatReasoningDetail {
  type?: string | undefined;
  text?: string | undefined;
  format?: string | undefined;
  index?: number | undefined;
}

export interface ChatContentPart {
  type: string;
  text?: string | undefined;
  image_url?: ChatImageURL | undefined;
}

export interface ChatImageURL {
  url: string;
  detail?: string | undefined;
}

export interface ChatTool {
  type: string;
  function?: ChatFunction | undefined;
}

export interface ChatFunction {
  name: string;
  description?: string | undefined;
  parameters?: unknown | undefined;
  strict?: boolean | undefined;
}

export interface ChatToolCall {
  index?: number | undefined;
  id?: string | undefined;
  type?: string | undefined;
  function: ChatFunctionCall;
}

export interface ChatFunctionCall {
  name: string;
  arguments?: string | undefined;
}

export interface ChatCompletionsResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage | undefined;
  system_fingerprint?: string | undefined;
  service_tier?: string | undefined;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: ChatTokenDetails | undefined;
  completion_tokens_details?: ChatTokenDetails | undefined;
}

export interface ChatTokenDetails {
  cached_tokens?: number | undefined;
  audio_tokens?: number | undefined;
  reasoning_tokens?: number | undefined;
  accepted_prediction_tokens?: number | undefined;
  rejected_prediction_tokens?: number | undefined;
}

export interface ChatCompletionsChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChunkChoice[];
  usage?: ChatUsage | undefined;
  system_fingerprint?: string | undefined;
  service_tier?: string | undefined;
}

export interface ChatChunkChoice {
  index: number;
  delta: ChatDelta;
  finish_reason: string | null;
}

export interface ChatDelta {
  role?: string | undefined;
  content?: string | undefined;
  reasoning_content?: string | undefined;
  /** Some OpenAI-compatible providers (e.g. DeepSeek) use `reasoning` in stream deltas. */
  reasoning?: string | undefined;
  tool_calls?: ChatToolCall[] | undefined;
}
