export type AppEntryKind =
  | 'premium_library'
  | 'ai_practice'
  | 'speaking_v1'
  | 'speaking_v2'
  | 'vocabulary'
  | 'account';

export function getEntryRequirement(kind: AppEntryKind): {
  requiresLogin: boolean;
  requiresActivation: boolean;
  requiresCredits: boolean;
} {
  switch (kind) {
    case 'premium_library':
      return {
        requiresLogin: true,
        requiresActivation: true,
        requiresCredits: false,
      };
    case 'ai_practice':
    case 'speaking_v1':
    case 'speaking_v2':
      return {
        requiresLogin: true,
        requiresActivation: true,
        requiresCredits: true,
      };
    case 'vocabulary':
      return {
        requiresLogin: false,
        requiresActivation: false,
        requiresCredits: false,
      };
    case 'account':
      return {
        requiresLogin: false,
        requiresActivation: false,
        requiresCredits: false,
      };
    default: {
      const exhaustiveCheck: never = kind;
      return exhaustiveCheck;
    }
  }
}
