# Gemini API Proxy

OpenAI-совместимый API прокси для Google Gemini с ротацией ключей, написанный на TypeScript.

## Возможности

- 🔑 Управление API ключами через веб-интерфейс
- 🔄 Автоматическая ротация ключей по кругу
- 🌐 OpenAI-совместимый эндпоинт `/v1/chat/completions`
- 🤖 Anthropic-совместимый эндпоинт `/v1/messages`
- 📡 Поддержка стриминговых ответов для обоих API
- 💾 Персистентное хранение ключей в файле
- 🔒 Защита админ-панели паролем
- 📝 Написано на TypeScript с полной типизацией

## Установка

### Обычная установка

1. Установите зависимости:
```bash
npm install
```

2. Соберите TypeScript:
```bash
npm run build
```

3. Запустите сервер:
```bash
npm start
```

Или для разработки с автоперезагрузкой:
```bash
npm run dev
```

### Docker установка

1. Соберите и запустите с помощью Docker Compose:
```bash
docker-compose up -d
```

2. Или соберите Docker образ вручную:
```bash
docker build -t gemini-proxy .
docker run -p 3000:3000 -e ADMIN_PASSWORD=your_password gemini-proxy
```

## Конфигурация

Установите пароль администратора через переменную окружения:
```bash
export ADMIN_PASSWORD=your_secure_password
```

По умолчанию используется пароль: `admin123`

## Хранение данных

API ключи сохраняются в файле `data/api-keys.json` и автоматически загружаются при запуске сервера.

**Формат файла:**
```json
{
  "apiKeys": [
    "your-gemini-api-key-1",
    "your-gemini-api-key-2"
  ],
  "currentKeyIndex": 0
}
```

**Особенности:**
- ✅ Ключи сохраняются при каждом добавлении/удалении
- ✅ Индекс текущего ключа обновляется при каждом использовании
- ✅ При запуске в Docker данные сохраняются в volume
- ✅ Автоматическое создание папки `data/` если её нет

## Использование

### Управление ключами

1. Откройте http://localhost:3000
2. Введите пароль администратора
3. Добавляйте/удаляйте API ключи Gemini

### API эндпоинты

**OpenAI-совместимый эндпоинт:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Привет, как дела?"}
    ],
    "stream": false
  }'
```

**Anthropic-совместимый эндпоинт:**
```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1000,
    "messages": [
      {"role": "user", "content": "Привет, как дела?"}
    ],
    "stream": false
  }'
```

**Стриминговые запросы:**
Добавьте `"stream": true` в любой из запросов выше для получения стримингового ответа.

### Ротация ключей

Сервис автоматически использует следующий ключ для каждого запроса. Если у вас 10 ключей, первый ключ будет использован снова через 10 запросов.

## Структура проекта

```
├── src/
│   ├── server.ts      # Основной сервер
│   └── types.ts       # TypeScript типы
├── dist/              # Скомпилированный JavaScript
├── data/
│   └── api-keys.json  # Файл с сохраненными API ключами
├── public/
│   └── index.html     # Веб-интерфейс управления
├── package.json       # Зависимости
├── tsconfig.json      # Конфигурация TypeScript
├── Dockerfile         # Docker конфигурация
├── docker-compose.yml # Docker Compose файл
├── .dockerignore      # Исключения для Docker
└── README.md          # Документация
```

## API эндпоинты

### Управление
- `GET /` - Веб-интерфейс управления ключами
- `POST /admin/keys` - Получить список ключей
- `POST /admin/keys/add` - Добавить новый ключ
- `POST /admin/keys/delete` - Удалить ключ

### AI API
- `POST /v1/chat/completions` - OpenAI-совместимый чат эндпоинт
- `POST /v1/messages` - Anthropic-совместимый эндпоинт

Оба AI эндпоинта поддерживают:
- ✅ Обычные запросы
- ✅ Стриминговые ответы (`"stream": true`)
- ✅ Автоматическую ротацию API ключей