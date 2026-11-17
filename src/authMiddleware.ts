import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  try {
    const raw = readFileSync(path.join(ROOT, 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw) as FirebaseAppletConfig;
  } catch {
    return { projectId: process.env.FIREBASE_PROJECT_ID ?? '' };
  }
}

export const firebaseServerConfig = loadFirebaseConfig();

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com'),
);

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  user?: VerifiedFirebaseUser;
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser> {
  const projectId = firebaseServerConfig.projectId;
  if (!projectId) {
    throw new Error('Firebase project configuration is missing on the server.');
  }
  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
  });
  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  const emailVerified = payload.email_verified === true;
  const name = typeof payload.name === 'string' ? payload.name : email.split('@')[0] || 'Member';
  if (!uid) {
    throw new Error('Token subject is missing.');
  }
  if (!emailVerified) {
    throw new Error('Verified email address is required.');
  }
  return { uid, email, emailVerified, name };
}

export async function requireFirebaseAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Empty Bearer token.' });
    return;
  }
  try {
    req.user = await verifyFirebaseIdToken(token);
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid authentication token.';
    const status = message.includes('Verified email') ? 403 : 401;
    res.status(status).json({ error: message });
  }
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '0');
  next();
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests = 120, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    next();
  };
}

const serverAttestationSalt = process.env.MLEDGER_API_TOKEN || randomUUID();

export function createAttestationHash(uid: string, action: string, payload: Record<string, unknown>): string {
  const canonical = JSON.stringify({
    uid,
    action,
    payload,
    salt: serverAttestationSalt,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
