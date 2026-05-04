export type EntitlementCheckResult = {
  allowed: boolean;
  reason: 'signed_out' | 'not_activated' | 'credits_insufficient' | 'allowed';
  redirectTo?: string;
  title: string;
  message: string;
};

export type EntitlementContext = {
  isSignedIn: boolean;
  isActivated: boolean;
  speakingCredits?: number | null;
};

function allowedResult(title: string, message: string): EntitlementCheckResult {
  return {
    allowed: true,
    reason: 'allowed',
    title,
    message,
  };
}

export function checkPremiumAccess(params: EntitlementContext): EntitlementCheckResult {
  if (!params.isSignedIn) {
    return {
      allowed: false,
      reason: 'signed_out',
      redirectTo: '/auth/sign-in',
      title: '请先登录',
      message: '登录后即可继续访问完整学习能力。',
    };
  }

  if (!params.isActivated) {
    return {
      allowed: false,
      reason: 'not_activated',
      redirectTo: '/purchase/membership',
      title: '开通后继续',
      message: '当前功能需要先开通 EchoLingo 学习权益。',
    };
  }

  return allowedResult('已开通', '当前账号可继续访问完整学习能力。');
}

export function checkSpeakingCredits(params: EntitlementContext): EntitlementCheckResult {
  const credits = Math.max(Number(params.speakingCredits ?? 0), 0);
  if (credits <= 0) {
    return {
      allowed: false,
      reason: 'credits_insufficient',
      redirectTo: '/purchase/speaking-credits',
      title: '口语额度不足',
      message: '当前账号的口语练习额度不足，请先补充后再继续。',
    };
  }

  return allowedResult('额度充足', '当前账号可继续进入口语训练。');
}

export function checkAiPracticeAccess(params: EntitlementContext): EntitlementCheckResult {
  if (!params.isSignedIn) {
    return {
      allowed: false,
      reason: 'signed_out',
      redirectTo: '/auth/sign-in',
      title: '请先登录',
      message: '登录后即可开始 AI 口语练习。',
    };
  }

  const credits = Math.max(Number(params.speakingCredits ?? 0), 0);
  if (credits > 0) {
    return allowedResult('额度可用', '当前账号可继续进入口语训练。');
  }

  if (!params.isActivated) {
    return {
      allowed: false,
      reason: 'not_activated',
      redirectTo: '/purchase/membership',
      title: '开通后继续',
      message: '体验额度已用完，开通后可继续使用完整口语能力。',
    };
  }

  return checkSpeakingCredits(params);
}
