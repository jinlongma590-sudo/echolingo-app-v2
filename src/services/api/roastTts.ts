import { env } from '@/lib/env';

function buildApiUrl(path: string) {
  return `${env.apiBaseUrl.replace(/\/$/, '')}${path}`;
}

function truncateResponsePreview(text: string, maxLength = 240) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export async function fetchRoastTtsAudio(text: string): Promise<ArrayBuffer> {
  const response = await fetch(buildApiUrl('/api/mobile/roast/tts-test'), {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const preview = truncateResponsePreview(errorText);
    throw new Error(preview || `Roast TTS request failed with status ${response.status}`);
  }

  return await response.arrayBuffer();
}
