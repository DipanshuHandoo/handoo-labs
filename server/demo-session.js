import { randomUUID } from 'node:crypto';

const ttlMs = 15 * 60_000;
const maxSessions = 1000;
const sessions = new Map();
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now >= entry.expiresAt) {
      sessions.delete(id);
      void dispose(entry.value).catch((error) => console.error('[demo session cleanup]', error));
    }
  }
}, 60_000);
cleanup.unref();

async function dispose(value) {
  if (typeof value?.dispose === 'function') await value.dispose();
}

export async function getDemoSession(request, response, tool, create) {
  const cookieName = `handoo_${tool}`;
  const secure = request.secure ? '; Secure' : '';
  const refreshCookie = (id) => response.append('Set-Cookie', `${cookieName}=${id}; Path=/api/${tool}; HttpOnly; SameSite=Strict; Max-Age=${ttlMs / 1000}${secure}`);
  const cookie = request.get('cookie')?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const existing = cookie && /^[0-9a-f-]{36}$/i.test(cookie) ? sessions.get(cookie) : null;
  const now = Date.now();
  if (existing && now < existing.expiresAt) {
    existing.expiresAt = now + ttlMs;
    sessions.delete(cookie);
    sessions.set(cookie, existing);
    refreshCookie(cookie);
    return existing.value;
  }

  if (cookie) {
    const expired = sessions.get(cookie);
    sessions.delete(cookie);
    if (expired) await dispose(expired.value);
  }
  if (sessions.size >= maxSessions) {
    const oldest = sessions.entries().next().value;
    if (oldest) {
      sessions.delete(oldest[0]);
      await dispose(oldest[1].value);
    }
  }

  const id = randomUUID();
  const value = await create(id);
  sessions.set(id, { value, expiresAt: now + ttlMs });
  refreshCookie(id);
  return value;
}
