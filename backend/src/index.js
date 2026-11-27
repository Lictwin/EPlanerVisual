const express = require('express');
const cors = require('cors');
require('dotenv').config();

const procedureRoutes = require('./routes/procedures');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'EPlanerVisual Backend API',
    version: '1.0.0',
    endpoints: {
      procedures: '/api/procedures'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/procedures', procedureRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
  }
  console.error('Необработанная ошибка сервера:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`API доступно по http://localhost:${PORT}/api/procedures`);
  });
}

module.exports = app;
