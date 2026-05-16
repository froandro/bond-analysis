# Облигационный Арбитраж

Профессиональный калькулятор для анализа доходности облигаций с интеграцией MOEX API.

## Возможности

- Поиск облигаций на Московской бирже
- Расчёт YTM (доходность к погашению)
- Расчёт чистой доходности с учётом налогов
- Анализ окупаемости (срок возврата инвестиций)
- График денежных потоков
- Поддержка разных типов облигаций: постоянный купон, флоатер, амортизация
- Кэширование типов облигаций

## Запуск

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
```

## Технологии

- React + TypeScript
- Vite
- Tailwind CSS
- Recharts (графики)
- MOEX API

## Страница

Открой http://localhost:3000 после запуска

## Деплой на VPS

### 1. Сборка
```bash
npm run build
```

### 2. Загрузка на сервер
Скопируй папку `dist` на VPS любым способом (scp, rsync, SFTP).

### 3. Установка и запуск
На VPS:

```bash
# Установка Node.js (если нет)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Установка serve
npm install -g serve

# Запуск
serve -s dist -l 3000
```

### 4. Nginx (опционально)
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
    }
}
```

### 5. Автозапуск с PM2 (опционально)
```bash
npm install -g pm2
pm2 serve dist 3000 --name obligations
pm2 save
pm2 startup
```