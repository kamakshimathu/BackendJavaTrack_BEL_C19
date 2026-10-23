import { Router } from 'express';
import { database } from '../../config/database.js';
import { emptyQuerySchema } from '../../shared/request-schemas.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  emptyQuerySchema.parse(req.query);
  res.setHeader('Cache-Control', 'no-store');

  try {
    await database.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'unavailable',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});
