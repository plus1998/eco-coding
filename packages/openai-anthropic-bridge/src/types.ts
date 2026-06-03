// Anthropic Messages API

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  thinking?: AnthropicThinking;
  tool_choice?: unknown;
  metadata?: unknown;
  output_config?: AnthropicOutputConfig;
}

export interface AnthropicOutputConfig {
  effort?: string;
}

export interface AnthropicThinking {
  type: string;
  budget_tokens?: number;
}

export interface AnthropicMessage {
  role: string;
  content: unknown;
}

export interface AnthropicContentBlock {
  type: string;
  cache_control?: AnthropicCacheControl;
  text?: string;
  thinking?: string;
  source?: AnthropicImageSource;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface AnthropicImageSource {
  type: string;
  media_type: string;
  data: string;
}

export interface AnthropicCacheControl {
  type: string;
  ttl?: string;
}

export interface AnthropicTool {
  type?: string;
  name: string;
  description?: string;
  input_schema?: unknown;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence?: string | null;
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
  message?: AnthropicResponse;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: AnthropicDelta;
  usage?: AnthropicUsage;
}

export interface AnthropicDelta {
  type?: string;
  text?: string;
  partial_json?: string;
  thinking?: string;
  signature?: string;
  stop_reason?: string;
  stop_sequence?: string | null;
}

// OpenAI Responses API

export interface ResponsesRequest {
  model: string;
  instructions?: string;
  input: unknown;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ResponsesTool[];
  include?: string[];
  store?: boolean;
  parallel_tool_calls?: boolean;
  reasoning?: ResponsesReasoning;
  text?: ResponsesText;
  tool_choice?: unknown;
  service_tier?: string;
  prompt_cache_key?: string;
  previous_response_id?: string;
}

export interface ResponsesReasoning {
  effort: string;
  summary?: string;
}

export interface ResponsesText {
  verbosity?: string;
}

export interface ResponsesInputItem {
  type?: string;
  role?: string;
  content?: unknown;
  call_id?: string;
  name?: string;
  arguments?: string;
  id?: string;
  output?: string;
}

export interface ResponsesContentPart {
  type: string;
  text?: string;
  image_url?: string;
}

export interface ResponsesTool {
  type: string;
  name?: string;
  description?: string;
  parameters?: unknown;
  strict?: boolean;
}

export interface ResponsesResponse {
  id: string;
  object: string;
  model: string;
  status?: string;
  output?: ResponsesOutput[];
  usage?: ResponsesUsage;
  incomplete_details?: ResponsesIncompleteDetails;
  error?: ResponsesError;
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
  id?: string;
  role?: string;
  content?: ResponsesContentPart[];
  status?: string;
  encrypted_content?: string;
  summary?: ResponsesSummary[];
  call_id?: string;
  name?: string;
  arguments?: string;
  action?: WebSearchAction;
}

export interface WebSearchAction {
  type?: string;
  query?: string;
}

export interface ResponsesSummary {
  type: string;
  text: string;
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: ResponsesInputTokensDetails;
  output_tokens_details?: ResponsesOutputTokensDetails;
}

export interface ResponsesInputTokensDetails {
  cached_tokens?: number;
  audio_tokens?: number;
}

export interface ResponsesOutputTokensDetails {
  reasoning_tokens?: number;
  audio_tokens?: number;
  accepted_prediction_tokens?: number;
  rejected_prediction_tokens?: number;
}

export interface ResponsesStreamEvent {
  type: string;
  response?: ResponsesResponse;
  usage?: ResponsesUsage;
  item?: ResponsesOutput;
  output_index?: number;
  content_index?: number;
  delta?: string;
  text?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  summary_index?: number;
  part?: ResponsesContentPart;
  code?: string;
  param?: string;
  sequence_number?: number;
}

// OpenAI Chat Completions API

export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  instructions?: string;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stream_options?: ChatStreamOptions;
  tools?: ChatTool[];
  tool_choice?: unknown;
  reasoning_effort?: string;
  service_tier?: string;
  stop?: unknown;
  functions?: ChatFunction[];
  function_call?: unknown;
}

export interface ChatStreamOptions {
  include_usage?: boolean;
}

export interface ChatMessage {
  role: string;
  content?: unknown;
  reasoning_content?: string;
  reasoning?: string;
  reasoning_details?: Array<{ type?: string; text?: string; format?: string; index?: number }>;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  function_call?: ChatFunctionCall;
}

export interface ChatContentPart {
  type: string;
  text?: string;
  image_url?: ChatImageURL;
}

export interface ChatImageURL {
  url: string;
  detail?: string;
}

export interface ChatTool {
  type: string;
  function?: ChatFunction;
}

export interface ChatFunction {
  name: string;
  description?: string;
  parameters?: unknown;
  strict?: boolean;
}

export interface ChatToolCall {
  index?: number;
  id?: string;
  type?: string;
  function: ChatFunctionCall;
}

export interface ChatFunctionCall {
  name: string;
  arguments?: string;
}

export interface ChatCompletionsResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
  system_fingerprint?: string;
  service_tier?: string;
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
  prompt_tokens_details?: ChatTokenDetails;
  completion_tokens_details?: ChatTokenDetails;
}

export interface ChatTokenDetails {
  cached_tokens?: number;
  audio_tokens?: number;
  reasoning_tokens?: number;
  accepted_prediction_tokens?: number;
  rejected_prediction_tokens?: number;
}

export interface ChatCompletionsChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChunkChoice[];
  usage?: ChatUsage;
  system_fingerprint?: string;
  service_tier?: string;
}

export interface ChatChunkChoice {
  index: number;
  delta: ChatDelta;
  finish_reason: string | null;
}

export interface ChatDelta {
  role?: string;
  content?: string;
  reasoning_content?: string;
  /** Some OpenAI-compatible providers (e.g. DeepSeek) use `reasoning` in stream deltas. */
  reasoning?: string;
  tool_calls?: ChatToolCall[];
}
