import type { StoredSession } from '@/types/auth';

export class SessionRefreshUnauthorizedError extends Error {
  constructor(message = '登录状态暂时不可用，请稍后重试。') {
    super(message);
    this.name = 'SessionRefreshUnauthorizedError';
  }
}

type RetryWithSessionRefreshOptions<T> = {
  request: (session: StoredSession) => Promise<T>;
  refreshSession: () => Promise<StoredSession | null>;
  getSession: () => StoredSession | null;
  isUnauthorizedError: (error: unknown) => boolean;
};

export async function retryWithSessionRefresh<T>({
  request,
  refreshSession,
  getSession,
  isUnauthorizedError,
}: RetryWithSessionRefreshOptions<T>): Promise<T> {
  const currentSession = getSession();
  if (!currentSession) {
    throw new SessionRefreshUnauthorizedError();
  }

  try {
    return await request(currentSession);
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error;
    }

    const refreshedSession = await refreshSession();
    if (!refreshedSession) {
      throw error;
    }

    return request(refreshedSession);
  }
}
