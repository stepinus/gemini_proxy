FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./
COPY tsconfig.json ./

# Устанавливаем все зависимости (включая dev для сборки)
RUN npm ci

# Копируем исходный код
COPY src ./src
COPY public ./public

# Собираем TypeScript
RUN npm run build

# Удаляем dev зависимости после сборки
RUN npm ci --only=production && npm cache clean --force

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Меняем владельца файлов
RUN chown -R nodejs:nodejs /app
USER nodejs

# Открываем порт
EXPOSE 3000

# Запускаем приложение
CMD ["npm", "start"]