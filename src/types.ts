// OpenAI API типы
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

// Gemini API типы
export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  parts: GeminiPart[];
  role?: 'user' | 'model';
}

export interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
}

export interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}

// Anthropic API типы
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicRequest {
  model?: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  temperature?: number;
  stream?: boolean;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamChunk {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  message?: Partial<AnthropicResponse>;
  content_block?: {
    type: 'text';
    text: string;
  };
  delta?: {
    type: 'text_delta';
    text: string;
  };
  index?: number;
}

// Admin API типы
export interface AdminRequest {
  password: string;
}

export interface AddKeyRequest extends AdminRequest {
  apiKey: string;
}

export interface DeleteKeyRequest extends AdminRequest {
  keyIndex: number;
}

export interface KeysResponse {
  keys: Array<{
    id: number;
    key: string;
  }>;
  total: number;
  currentIndex: number;
}

export interface ApiResponse {
  message?: string;
  error?: string;
  total?: number;
}