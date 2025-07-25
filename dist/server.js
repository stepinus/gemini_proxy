"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const body_parser_1 = __importDefault(require("body-parser"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Конфигурация
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const KEYS_FILE = path_1.default.join(__dirname, '../data/api-keys.json');
let apiKeys = [];
let currentKeyIndex = 0;
// Функция для сохранения ключей в файл
function saveKeys() {
    try {
        const dataDir = path_1.default.dirname(KEYS_FILE);
        if (!fs_1.default.existsSync(dataDir)) {
            fs_1.default.mkdirSync(dataDir, { recursive: true });
        }
        const data = {
            apiKeys,
            currentKeyIndex
        };
        fs_1.default.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
        console.log(`Keys saved to ${KEYS_FILE}`);
    }
    catch (error) {
        console.error('Error saving keys:', error);
    }
}
// Функция для загрузки ключей из файла
function loadKeys() {
    try {
        if (fs_1.default.existsSync(KEYS_FILE)) {
            const fileContent = fs_1.default.readFileSync(KEYS_FILE, 'utf8');
            const data = JSON.parse(fileContent);
            apiKeys = data.apiKeys || [];
            currentKeyIndex = data.currentKeyIndex || 0;
            // Проверяем корректность индекса
            if (currentKeyIndex >= apiKeys.length) {
                currentKeyIndex = 0;
            }
            console.log(`Loaded ${apiKeys.length} keys from ${KEYS_FILE}`);
        }
        else {
            console.log('No keys file found, starting with empty keys');
        }
    }
    catch (error) {
        console.error('Error loading keys:', error);
        apiKeys = [];
        currentKeyIndex = 0;
    }
}
// Загружаем ключи при запуске
loadKeys();
// Middleware
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.use(express_1.default.static('public'));
// Функция для получения следующего API ключа
function getNextApiKey() {
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
function sendSSEChunk(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
// Функция для обработки стриминга от Gemini
async function handleGeminiStream(geminiRequest, apiKey, res, format, model) {
    try {
        const response = await axios_1.default.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent', geminiRequest, {
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey
            },
            responseType: 'stream'
        });
        let fullContent = '';
        const chatId = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        response.data.on('data', (chunk) => {
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
                                const chunk = {
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
                            }
                            else {
                                const chunk = {
                                    type: 'content_block_delta',
                                    delta: {
                                        type: 'text_delta',
                                        text: newContent
                                    }
                                };
                                sendSSEChunk(res, chunk);
                            }
                        }
                    }
                    catch (e) {
                        // Игнорируем ошибки парсинга
                    }
                }
            }
        });
        response.data.on('end', () => {
            if (format === 'openai') {
                const finalChunk = {
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
            }
            else {
                const finalChunk = {
                    type: 'message_stop'
                };
                sendSSEChunk(res, finalChunk);
            }
            res.write('data: [DONE]\n\n');
            res.end();
        });
        response.data.on('error', (error) => {
            console.error('Stream error:', error);
            res.end();
        });
    }
    catch (error) {
        console.error('Error in stream:', error);
        res.status(500).end();
    }
}
// Главная страница с формой управления ключами
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public', 'index.html'));
});
// API для получения списка ключей (только для админки)
app.post('/admin/keys', (req, res) => {
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
app.post('/admin/keys/add', (req, res) => {
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
app.post('/admin/keys/delete', (req, res) => {
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
app.post('/v1/chat/completions', async (req, res) => {
    try {
        if (apiKeys.length === 0) {
            return res.status(503).json({
                id: '',
                object: 'error',
                created: Math.floor(Date.now() / 1000),
                model: '',
                choices: [],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            });
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
            });
        }
        // Преобразуем OpenAI формат в Gemini формат
        const geminiContents = messages.map(msg => ({
            parts: [{ text: msg.content }],
            role: msg.role === 'assistant' ? 'model' : 'user'
        }));
        // Получаем следующий API ключ
        const apiKey = getNextApiKey();
        // Формируем запрос к Gemini API
        const geminiRequest = {
            contents: geminiContents,
            generationConfig: {}
        };
        if (max_tokens) {
            geminiRequest.generationConfig.maxOutputTokens = max_tokens;
        }
        if (temperature !== undefined) {
            geminiRequest.generationConfig.temperature = temperature;
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
        const response = await axios_1.default.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', geminiRequest, {
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey
            }
        });
        // Преобразуем ответ Gemini в OpenAI формат
        const geminiResponse = response.data;
        const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const openaiResponse = {
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
    }
    catch (error) {
        console.error('Error proxying to Gemini:', error.response?.data || error.message);
        res.status(500).json({
            id: '',
            object: 'error',
            created: Math.floor(Date.now() / 1000),
            model: '',
            choices: [],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        });
    }
});
// Anthropic compatible endpoint
app.post('/v1/messages', async (req, res) => {
    try {
        if (apiKeys.length === 0) {
            return res.status(503).json({
                error: {
                    type: 'api_error',
                    message: 'No API keys configured'
                }
            });
        }
        const { messages, model = 'claude-3-sonnet-20240229', max_tokens, temperature, stream = false } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                error: {
                    type: 'invalid_request_error',
                    message: 'Messages array is required'
                }
            });
        }
        if (!max_tokens) {
            return res.status(400).json({
                error: {
                    type: 'invalid_request_error',
                    message: 'max_tokens is required'
                }
            });
        }
        // Преобразуем Anthropic формат в Gemini формат
        const geminiContents = messages.map(msg => ({
            parts: [{ text: msg.content }],
            role: msg.role === 'assistant' ? 'model' : 'user'
        }));
        // Получаем следующий API ключ
        const apiKey = getNextApiKey();
        // Формируем запрос к Gemini API
        const geminiRequest = {
            contents: geminiContents,
            generationConfig: {
                maxOutputTokens: max_tokens
            }
        };
        if (temperature !== undefined) {
            geminiRequest.generationConfig.temperature = temperature;
        }
        // Если запрошен стриминг
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            // Отправляем начальный chunk для Anthropic
            const startChunk = {
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
            const contentStartChunk = {
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
        const response = await axios_1.default.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', geminiRequest, {
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey
            }
        });
        // Преобразуем ответ Gemini в Anthropic формат
        const geminiResponse = response.data;
        const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const anthropicResponse = {
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
    }
    catch (error) {
        console.error('Error proxying to Gemini:', error.response?.data || error.message);
        res.status(500).json({
            error: {
                type: 'api_error',
                message: 'Internal server error'
            }
        });
    }
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}`);
    console.log(`OpenAI API endpoint: http://localhost:${PORT}/v1/chat/completions`);
    console.log(`Anthropic API endpoint: http://localhost:${PORT}/v1/messages`);
});
//# sourceMappingURL=server.js.map