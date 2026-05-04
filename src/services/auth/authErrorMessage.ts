const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRawMessage(input: unknown) {
  if (input instanceof Error) {
    return input.message.trim();
  }

  if (input && typeof input === 'object') {
    const candidate = input as {
      message?: unknown;
      msg?: unknown;
      error_description?: unknown;
      description?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      status?: unknown;
      cause?: { message?: unknown } | unknown;
      error?: { message?: unknown } | unknown;
    };

    const nestedErrorMessage =
      candidate.error && typeof candidate.error === 'object' && 'message' in candidate.error
        ? (candidate.error as { message?: unknown }).message
        : undefined;
    const nestedCauseMessage =
      candidate.cause && typeof candidate.cause === 'object' && 'message' in candidate.cause
        ? (candidate.cause as { message?: unknown }).message
        : undefined;

    for (const value of [
      candidate.message,
      candidate.msg,
      candidate.error_description,
      candidate.description,
      nestedErrorMessage,
      nestedCauseMessage,
      candidate.details,
      candidate.hint,
      candidate.code,
      candidate.status,
    ]) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      if (typeof value === 'number') {
        return String(value);
      }
    }
  }

  return String(input ?? '').trim();
}

export function validateEmailAddress(email: string) {
  const normalized = email.trim();

  if (!normalized) {
    return '请输入邮箱地址';
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    return '邮箱格式不正确';
  }

  return null;
}

export function normalizeAuthErrorMessage(error: unknown, fallback = '操作失败，请稍后重试') {
  const raw = normalizeRawMessage(error);
  const normalized = raw.toLowerCase();

  if (!raw) {
    return fallback;
  }

  if (
    normalized.includes('device_signup_limit_reached') ||
    raw.includes('该设备注册账号数量已达上限')
  ) {
    return '该设备注册账号数量已达上限，请使用已有账号登录。';
  }

  if (
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid_grant') ||
    normalized.includes('invalid_credentials')
  ) {
    return '邮箱或密码不正确，请检查后重试';
  }

  if (
    normalized.includes('email not confirmed') ||
    normalized.includes('confirm your email')
  ) {
    return '邮箱尚未验证，请先完成邮箱验证';
  }

  if (
    normalized.includes('user already registered') ||
    normalized.includes('already registered') ||
    normalized.includes('already exists') ||
    normalized.includes('already been registered')
  ) {
    return '该邮箱已注册，请直接登录';
  }

  if (
    normalized.includes('weak password') ||
    normalized.includes('password should be at least') ||
    normalized.includes('password must be at least')
  ) {
    return '密码长度不够，请重新设置';
  }

  if (
    normalized.includes('email rate limit') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('over_email_send_rate_limit')
  ) {
    return '操作过于频繁，请稍后再试';
  }

  if (
    normalized.includes('signup disabled') ||
    normalized.includes('signups not allowed')
  ) {
    return '当前暂不支持注册，请稍后再试';
  }

  if (
    normalized.includes('invalid email') ||
    normalized.includes('email address is invalid')
  ) {
    return '邮箱格式不正确';
  }

  if (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network error') ||
    normalized.includes('load failed') ||
    normalized.includes('timeout')
  ) {
    return '网络连接失败，请检查网络后重试';
  }

  if (
    normalized.includes('supabase auth 未配置') ||
    normalized.includes('service unavailable') ||
    normalized.includes('internal server error') ||
    normalized.includes('bad gateway') ||
    normalized.includes('gateway timeout')
  ) {
    return '服务器暂时不可用，请稍后重试';
  }

  return fallback;
}
