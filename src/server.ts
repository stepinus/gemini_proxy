import express, { Request, Response } from 'express';
import axios, { AxiosResponse } from 'axios';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import {
  OpenAIChatRequest,
  OpenAIChatResponse,
  GeminiRequest,
  GeminiResponse,
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
  geminiRequest: GeminiRequest,
  apiKey: string,
  res: Response,
  format: 'openai' | 'anthropic',
  model: string
): Promise<void> {
  try {
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent',
      geminiRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        },
        responseType: 'stream'
      }
    );

    let fullContent = '';
    const chatId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    response.data.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            
            if (content) {
              const newContent = content.slice(fullContent.length);
              fullContent = content;
              
              if (format === 'openai') {
                const chunk: StreamChunk = {
                  id: chatId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: { content: newContent },
                    finish_reason: null
                  }]
                };
                sendSSEChunk(res, chunk);
              } else {
                const chunk: AnthropicStreamChunk = {
                  type: 'content_block_delta',
                  delta: {
                    type: 'text_delta',
                    text: newContent
                  }
                };
                sendSSEChunk(res, chunk);
              }
            }
          } catch (e) {
            // Игнорируем ошибки парсинга
          }
        }
      }
    });

    response.data.on('end', () => {
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
    });

    response.data.on('error', (error: any) => {
      console.error('Stream error:', error);
      res.end();
    });

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

// OpenAI compatible endpoint
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

    const { messages, model = 'gpt-3.5-turbo', max_tokens, temperature, stream = false } = req.body;

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

    // Преобразуем OpenAI формат в Gemini формат
    const geminiContents = messages.map(msg => ({
      parts: [{ text: msg.content }],
      role: msg.role === 'assistant' ? 'model' as const : 'user' as const
    }));

    // Получаем следующий API ключ
    const apiKey = getNextApiKey();

    // Формируем запрос к Gemini API
    const geminiRequest: GeminiRequest = {
      contents: geminiContents,
      generationConfig: {}
    };

    if (max_tokens) {
      geminiRequest.generationConfig!.maxOutputTokens = max_tokens;
    }

    if (temperature !== undefined) {
      geminiRequest.generationConfig!.temperature = temperature;
    }

    // Если запрошен стриминг
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      await handleGeminiStream(geminiRequest, apiKey, res, 'openai', model);
      return;
    }

    // Отправляем запрос к Gemini
    const response: AxiosResponse<GeminiResponse> = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      geminiRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        }
      }
    );

    // Преобразуем ответ Gemini в OpenAI формат
    const geminiResponse = response.data;
    const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';

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

// Anthropic compatible endpoint
app.post('/v1/messages', async (req: Request<{}, AnthropicResponse, AnthropicRequest>, res: Response) => {
  try {
    if (apiKeys.length === 0) {
      return res.status(503).json({
        error: {
          type: 'api_error',
          message: 'No API keys configured'
        }
      } as any);
    }

    const { messages, model = 'claude-3-sonnet-20240229', max_tokens, temperature, stream = false } = req.body;

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

    // Преобразуем Anthropic формат в Gemini формат
    const geminiContents = messages.map(msg => ({
      parts: [{ text: msg.content }],
      role: msg.role === 'assistant' ? 'model' as const : 'user' as const
    }));

    // Получаем следующий API ключ
    const apiKey = getNextApiKey();

    // Формируем запрос к Gemini API
    const geminiRequest: GeminiRequest = {
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: max_tokens
      }
    };

    if (temperature !== undefined) {
      geminiRequest.generationConfig!.temperature = temperature;
    }

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
      
      await handleGeminiStream(geminiRequest, apiKey, res, 'anthropic', model);
      return;
    }

    // Отправляем запрос к Gemini
    const response: AxiosResponse<GeminiResponse> = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      geminiRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        }
      }
    );

    // Преобразуем ответ Gemini в Anthropic формат
    const geminiResponse = response.data;
    const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';

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
  console.log(`OpenAI API endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`Anthropic API endpoint: http://localhost:${PORT}/v1/messages`);
});