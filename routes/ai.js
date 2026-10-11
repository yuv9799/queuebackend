import { Router } from 'express';
import {
  AI_ENABLED,
  AI_CHAT_LIMIT,
  AI_CHAT_WINDOW_MS,
  AI_MAX_SESSIONS,
  AI_SESSION_TTL_MS,
} from '../config/ai.js';
import { createAssistantState, handleAssistantRequest } from '../services/ai/assistant.js';

const router = Router();
const sessions = new Map();
const rateWindows = new Map();

function rateLimited(ip, now = Date.now()) {
  const current = rateWindows.get(ip);
  if (!current || now - current.startedAt >= AI_CHAT_WINDOW_MS) {
    rateWindows.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > AI_CHAT_LIMIT;
}

function pruneSessions(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > AI_SESSION_TTL_MS) sessions.delete(id);
  }
  while (sessions.size >= AI_MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (!oldest) break;
    sessions.delete(oldest);
  }
}

function validSessionId(value) {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= 128
    && /^[a-zA-Z0-9_-]+$/.test(value);
}

function getContextTokenId(body) {
  const tokenId = Number(body.context?.tokenId);
  return Number.isSafeInteger(tokenId) && tokenId > 0 ? tokenId : null;
}

router.post('/chat', async (req, res, next) => {
  if (!AI_ENABLED) {
    return res.status(503).json({
      error: 'The assistant is unavailable right now. You can still use the Token Kiosk.',
    });
  }
  const body = req.body || {};
  const message = body.message === undefined ? '' : body.message;
  if (typeof message !== 'string' || message.length > 1000) {
    return res.status(400).json({ error: 'message must be text no longer than 1000 characters' });
  }
  if (!validSessionId(body.sessionId)) {
    return res.status(400).json({ error: 'A valid sessionId is required' });
  }
  const action = body.action ?? null;
  if (action !== null && (!action || typeof action !== 'object' || Array.isArray(action)
    || typeof action.type !== 'string' || action.type.length > 40)) {
    return res.status(400).json({ error: 'action must be a supported assistant action' });
  }

  const now = Date.now();
  for (const [ip, window] of rateWindows) {
    if (now - window.startedAt >= AI_CHAT_WINDOW_MS) rateWindows.delete(ip);
  }
  if (rateLimited(req.ip || req.socket.remoteAddress || 'unknown', now)) {
    return res.status(429).json({ error: 'Too many assistant requests. Please wait a few minutes and try again.' });
  }

  pruneSessions(now);
  const sessionId = body.sessionId;
  const contextTokenId = getContextTokenId(body);
  let session = sessions.get(sessionId);
  if (!session) {
    session = { state: createAssistantState(contextTokenId), updatedAt: now };
    sessions.set(sessionId, session);
  }
  session.updatedAt = now;

  try {
    const result = await handleAssistantRequest({
      app: req.app,
      state: session.state,
      message,
      action,
      contextTokenId,
    });
    return res.json(result);
  } catch (error) {
    console.error('AI assistant request failed:', error?.name || 'Error');
    return next(error);
  }
});

export default router;
