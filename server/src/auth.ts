import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from './config.js'

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth for routes mounted behind the API auth middleware. */
      userId: string
    }
  }
}

export type AuthRequest = Request
export function signAccessToken(userId: string) { return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '8h', issuer: 'ivac-control-center' }) }
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try { (req as AuthRequest).userId = String(jwt.verify(token, env.JWT_SECRET, { issuer: 'ivac-control-center' }).sub); next() }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }) }
}
