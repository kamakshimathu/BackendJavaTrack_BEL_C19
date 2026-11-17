import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/app-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: { message: 'Invalid request input' } });
    return;
  }

  const status = typeof error === 'object' && error !== null && 'status' in error
    ? error.status : undefined;

  if (status === 400) {
    res.status(400).json({ error: { message: 'Invalid request body' } });
    return;
  }
  if (status === 413) {
    res.status(413).json({ error: { message: 'Request body too large' } });
    return;
  }
  if (status === 415) {
    res.status(415).json({ error: { message: 'Unsupported request encoding' } });
    return;
  }

  // Avoid logging raw errors, which can contain database connection details.
  console.error('An unexpected request error occurred.');
  res.status(500).json({ error: { message: 'Internal server error' } });
};
