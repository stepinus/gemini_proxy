import express, { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import {
  OpenAIChatRequest,
  OpenAIChatResponse,
  AdminRequest,
  AddKeyRequest,
  DeleteKeyRequest,
  KeysResponse,
  ApiResponse,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicStreamChunk,
  StreamChunk
} from './types';

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const KEYS_FILE = path.join(__dirname, '../data/api-keys.json');
let apiKeys: string[] = [];
let currentKeyIndex = 0;

// Интерфейс для данных в файле
interface KeysData {
  apiKeys: string[];
  currentKeyIndex: number;
}

// Функция для сохранения ключей в файл
function saveKeys(): void {
  try {
    const dataDir = path.dirname(KEYS_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const data: KeysData = {
      apiKeys,
      currentKeyIndex
    };

    fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
    console.log(`Keys saved to ${KEYS_FILE}`);
  } catch (error) {
    console.error('Error saving keys:', error);
  }
}

// Функция для загрузки ключей из файла
function loadKeys(): void {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const fileContent = fs.readFileSync(KEYS_FILE, 'utf8');
      const data: KeysData = JSON.parse(fileContent);

      apiKeys = data.apiKeys || [];
      currentKeyIndex = data.currentKeyIndex || 0;

      // Проверяем корректность индекса
      if (currentKeyIndex >= apiKeys.length) {
        currentKeyIndex = 0;
      }

      console.log(`Loaded ${apiKeys.length} keys from ${KEYS_FILE}`);
    } else {
      console.log('No keys file found, starting with empty keys');
    }
  } catch (error) {
    console.error('Error loading keys:', error);
    apiKeys = [];
    currentKeyIndex = 0;
  }
}

// Загружаем ключи при запуске
loadKeys();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Функция для получения следующего API ключа
function getNextApiKey(): string {
  if (apiKeys.length === 0) {
    throw new Error('No API keys available');
  }

  const key = apiKeys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

  // Сохраняем изменения индекса (можно делать реже для производительности)
  saveKeys();

  return key;
}

// Функция для отправки SSE chunk
function sendSSEChunk(res: Response, data: any): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Функция для обработки стриминга от Gemini
async function handleGeminiStream(
  messages: any[],
  apiKey: string,
  res: Response,
  format: 'openai' | 'anthropic',
  model: string,
  geminiModel: string
): Promise<void> {
  try {
    const ai = new GoogleGenAI({ apiKey });

    // Преобразуем сообщения в промпт
    const contents = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');

    const chatId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const response = await ai.models.generateContentStream({
      model: geminiModel,
      contents: contents,
    });

    for await (const chunk of response) {
      const chunkText = chunk.text || '';

      if (chunkText) {
        if (format === 'openai') {
          const streamChunk: StreamChunk = {
            id: chatId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: { content: chunkText },
              finish_reason: null
            }]
          };
          sendSSEChunk(res, streamChunk);
        } else {
          const streamChunk: AnthropicStreamChunk = {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: chunkText
            }
          };
          sendSSEChunk(res, streamChunk);
        }
      }
    }

    // Отправляем финальный chunk
    if (format === 'openai') {
      const finalChunk: StreamChunk = {
        id: chatId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }]
      };
      sendSSEChunk(res, finalChunk);
    } else {
      const finalChunk: AnthropicStreamChunk = {
        type: 'message_stop'
      };
      sendSSEChunk(res, finalChunk);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error: any) {
    console.error('Error in stream:', error);
    res.status(500).end();
  }
}

// Главная страница с формой управления ключами
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// API для получения списка ключей (только для админки)
app.post('/admin/keys', (req: Request<{}, KeysResponse, AdminRequest>, res: Response<KeysResponse | ApiResponse>) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.json({
    keys: apiKeys.map((key, index) => ({
      id: index,
      key: key.substring(0, 10) + '...'
    })),
    total: apiKeys.length,
    currentIndex: currentKeyIndex
  });
});

// API для добавления ключа
app.post('/admin/keys/add', (req: Request<{}, ApiResponse, AddKeyRequest>, res: Response<ApiResponse>) => {
  const { password, apiKey } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  if (!apiKey || apiKey.trim() === '') {
    return res.status(400).json({ error: 'API key is required' });
  }

  apiKeys.push(apiKey.trim());
  saveKeys(); // Сохраняем изменения
  res.json({ message: 'API key added successfully', total: apiKeys.length });
});

// API для удаления ключа
app.post('/admin/keys/delete', (req: Request<{}, ApiResponse, DeleteKeyRequest>, res: Response<ApiResponse>) => {
  const { password, keyIndex } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const index = parseInt(keyIndex.toString());
  if (isNaN(index) || index < 0 || index >= apiKeys.length) {
    return res.status(400).json({ error: 'Invalid key index' });
  }

  apiKeys.splice(index, 1);

  // Корректируем текущий индекс если необходимо
  if (currentKeyIndex >= apiKeys.length) {
    currentKeyIndex = 0;
  }

  saveKeys(); // Сохраняем изменения
  res.json({ message: 'API key deleted successfully', total: apiKeys.length });
});

// OpenAI compatible endpoint - по умолчанию gemini-2.5-pro
app.post('/v1/chat/completions', async (req: Request<{}, OpenAIChatResponse, OpenAIChatRequest>, res: Response) => {
  try {
    if (apiKeys.length === 0) {
      return res.status(503).json({
        id: '',
        object: 'error',
        created: Math.floor(Date.now() / 1000),
        model: '',
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      } as any);
    }

    const { messages, model = 'gemini-2.5-pro', stream = false } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        id: '',
        object: 'error',
        created: Math.floor(Date.now() / 1000),
        model: '',
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      } as any);
    }

    // Получаем следующий API ключ
    const apiKey = getNextApiKey();

    // Определяем модель Gemini на основе запрошенной модели
    let geminiModel = 'gemini-2.5-pro';
    if (model.includes('flash')) {
      geminiModel = 'gemini-2.5-flash';
    }

    // Если запрошен стриминг
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await handleGeminiStream(messages, apiKey, res, 'openai', model, geminiModel);
      return;
    }

    // Используем Google GenAI клиент
    const ai = new GoogleGenAI({ apiKey });

    // Преобразуем сообщения в промпт
    const contents = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');

    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: contents,
    });

    const content = response.text || '';

    const openaiResponse: OpenAIChatResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };

    res.json(openaiResponse);

  } catch (error: any) {
    console.error('Error proxying to Gemini:', error.response?.data || error.message);

    res.status(500).json({
      id: '',
      object: 'error',
      created: Math.floor(Date.now() / 1000),
      model: '',
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    } as any);
  }
});

// Pro endpoint - использует gemini-2.5-pro
app.post('/pro/v1/messages', async (req: Request<{}, AnthropicResponse, AnthropicRequest>, res: Response) => {
  try {
    if (apiKeys.length === 0) {
      return res.status(503).json({
        error: {
          type: 'api_error',
          message: 'No API keys configured'
        }
      } as any);
    }

    const { messages, model = 'gemini-2.5-pro', max_tokens, stream = false } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Messages array is required'
        }
      } as any);
    }

    if (!max_tokens) {
      return res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'max_tokens is required'
        }
      } as any);
    }

    // Получаем следующий API ключ
    const apiKey = getNextApiKey();

    // Если запрошен стриминг
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Отправляем начальный chunk для Anthropic
      const startChunk: AnthropicStreamChunk = {
        type: 'message_start',
        message: {
          id: `msg_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          content: [],
          model: model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      };
      sendSSEChunk(res, startChunk);

      const contentStartChunk: AnthropicStreamChunk = {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: ''
        }
      };
      sendSSEChunk(res, contentStartChunk);

      await handleGeminiStream(messages, apiKey, res, 'anthropic', model, 'gemini-2.5-pro');
      return;
    }

    // Используем Google GenAI клиент
    const ai = new GoogleGenAI({ apiKey });

    // Преобразуем сообщения в промпт
    const contents = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: contents,
    });

    const content = response.text || '';

    const anthropicResponse: AnthropicResponse = {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: content
      }],
      model: model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0
      }
    };

    res.json(anthropicResponse);

  } catch (error: any) {
    console.error('Error proxying to Gemini:', error.response?.data || error.message);

    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Internal server error'
      }
    } as any);
  }
});

// Flash endpoint - использует gemini-2.5-flash
app.post('/flash/v1/messages', async (req: Request<{}, AnthropicResponse, AnthropicRequest>, res: Response) => {
  try {
    if (apiKeys.length === 0) {
      return res.status(503).json({
        error: {
          type: 'api_error',
          message: 'No API keys configured'
        }
      } as any);
    }

    const { messages, model = 'gemini-2.5-flash', max_tokens, stream = false } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Messages array is required'
        }
      } as any);
    }

    if (!max_tokens) {
      return res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'max_tokens is required'
        }
      } as any);
    }

    // Получаем следующий API ключ
    const apiKey = getNextApiKey();

    // Если запрошен стриминг
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Отправляем начальный chunk для Anthropic
      const startChunk: AnthropicStreamChunk = {
        type: 'message_start',
        message: {
          id: `msg_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          content: [],
          model: model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      };
      sendSSEChunk(res, startChunk);

      const contentStartChunk: AnthropicStreamChunk = {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: ''
        }
      };
      sendSSEChunk(res, contentStartChunk);

      await handleGeminiStream(messages, apiKey, res, 'anthropic', model, 'gemini-2.5-flash');
      return;
    }

    // Используем Google GenAI клиент
    const ai = new GoogleGenAI({ apiKey });

    // Преобразуем сообщения в промпт
    const contents = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
    });

    const content = response.text || '';

    const anthropicResponse: AnthropicResponse = {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: content
      }],
      model: model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0
      }
    };

    res.json(anthropicResponse);

  } catch (error: any) {
    console.error('Error proxying to Gemini:', error.response?.data || error.message);

    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Internal server error'
      }
    } as any);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}`);
  console.log(`OpenAI API endpoint (gemini-2.5-pro default): http://localhost:${PORT}/v1/chat/completions`);
  console.log(`Pro endpoint (gemini-2.5-pro): http://localhost:${PORT}/pro/v1/messages`);
  console.log(`Flash endpoint (gemini-2.5-flash): http://localhost:${PORT}/flash/v1/messages`);
});