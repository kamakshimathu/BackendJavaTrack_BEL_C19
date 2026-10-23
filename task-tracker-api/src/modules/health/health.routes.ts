import { Router } from 'express';
import { database } from '../../config/database.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
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
