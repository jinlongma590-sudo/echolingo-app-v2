import type { CoachSfxProfileId } from '@/data/coachProfiles';

export type CoachSfxCueId = 'laugh_mocking_01' | 'laugh_crazy_01' | 'no_way_01';

type CoachSfxCue = {
  id: CoachSfxCueId;
  asset: null;
  triggerHints: string[];
};

const WEST_COAST_ROAST_MOCK_CUES: CoachSfxCue[] = [
  {
    id: 'laugh_mocking_01',
    asset: null,
    triggerHints: ['nah', 'bro', 'dude'],
  },
  {
    id: 'laugh_crazy_01',
    asset: null,
    triggerHints: ['for real', 'what was that', 'lowkey'],
  },
  {
    id: 'no_way_01',
    asset: null,
    triggerHints: ['no way', 'damn', 'hell'],
  },
];

const COACH_SFX_CUES: Record<CoachSfxProfileId, CoachSfxCue[]> = {
  none: [],
  west_coast_roast_mock: WEST_COAST_ROAST_MOCK_CUES,
};

export function getCoachSfxCues(profileId: CoachSfxProfileId): CoachSfxCue[] {
  return COACH_SFX_CUES[profileId] ?? [];
}

export function pickCoachSfxCue(profileId: CoachSfxProfileId, assistantText: string): CoachSfxCueId | null {
  const cues = getCoachSfxCues(profileId);
  if (!cues.length) return null;

  const normalized = assistantText.toLowerCase();
  return cues.find((cue) => cue.triggerHints.some((hint) => normalized.includes(hint)))?.id ?? cues[0]?.id ?? null;
}
