import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import type { StoredSession } from '@/types/auth';
import { buildRestTableUrl } from '@/services/supabase/rest';
import { decodeBase64 } from '@/services/audio/pcmUtils';

type PickedAvatarAsset = ImagePicker.ImagePickerAsset;
export type AvatarInputSource = 'library' | 'camera';

type NormalizedAvatarUri = {
  uri: string;
  originalScheme: string;
  normalizedScheme: string;
  cleanup?: () => Promise<void>;
};

type AvatarUploadBody = Blob | ArrayBuffer;

function getImagePickerModule() {
  const module = ImagePicker as Partial<typeof ImagePicker> | undefined;
  if (!module) {
    throw new Error('expo-image-picker 模块对象不存在。当前 iOS App 很可能还没有重新编译进该原生依赖。');
  }
  return module;
}

function buildAvatarPath(userId: string, asset: PickedAvatarAsset) {
  const normalizedMime = resolveAvatarMimeType(asset).toLowerCase();
  const extension = normalizedMime.includes('png') ? 'png' : 'jpg';
  return `${userId}/avatar-${Date.now()}.${extension}`;
}

function resolveAvatarMimeType(asset: PickedAvatarAsset) {
  const mimeType = asset.mimeType?.trim();
  return mimeType && mimeType.toLowerCase().startsWith('image/') ? mimeType : 'image/jpeg';
}

function getUriScheme(uri: string | null | undefined) {
  const match = uri?.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return match?.[1]?.toLowerCase() ?? 'unknown';
}

function getAssetFileSize(asset: PickedAvatarAsset) {
  return typeof asset.fileSize === 'number' ? asset.fileSize : null;
}

function buildCacheAvatarUri(asset: PickedAvatarAsset) {
  const normalizedMime = resolveAvatarMimeType(asset).toLowerCase();
  const extension = normalizedMime.includes('png') ? 'png' : 'jpg';
  if (!FileSystem.cacheDirectory) {
    throw new Error('头像上传失败，请重试');
  }
  return `${FileSystem.cacheDirectory}avatars/avatar-upload-${Date.now()}.${extension}`;
}

async function normalizeAvatarUploadUri(asset: PickedAvatarAsset): Promise<NormalizedAvatarUri> {
  const originalScheme = getUriScheme(asset.uri);

  if (Platform.OS !== 'android' || originalScheme !== 'content') {
    return {
      uri: asset.uri,
      originalScheme,
      normalizedScheme: originalScheme,
    };
  }

  const targetUri = buildCacheAvatarUri(asset);
  const cacheDir = targetUri.slice(0, targetUri.lastIndexOf('/') + 1);
  await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {
    // The directory may already exist.
  });
  await FileSystem.copyAsync({ from: asset.uri, to: targetUri });

  return {
    uri: targetUri,
    originalScheme,
    normalizedScheme: getUriScheme(targetUri),
    cleanup: async () => {
      await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {
        // Cache cleanup is best-effort.
      });
    },
  };
}

function logAvatarPickResult(source: AvatarInputSource, asset: PickedAvatarAsset) {
  console.info('[avatar_pick_result]', {
    platform: Platform.OS,
    source,
    uriScheme: getUriScheme(asset.uri),
    mimeType: asset.mimeType ?? null,
    fileSize: getAssetFileSize(asset),
  });
}

function logAvatarUploadUriNormalized(asset: PickedAvatarAsset, normalized: NormalizedAvatarUri) {
  console.info('[avatar_upload_uri_normalized]', {
    platform: Platform.OS,
    fromScheme: normalized.originalScheme,
    toScheme: normalized.normalizedScheme,
    mimeType: asset.mimeType ?? null,
    fileSize: getAssetFileSize(asset),
  });
}

function logAvatarUploadFailed(asset: PickedAvatarAsset, stage: string, detail?: Record<string, unknown>) {
  console.warn('[avatar_upload_failed]', {
    platform: Platform.OS,
    uriScheme: getUriScheme(asset.uri),
    mimeType: asset.mimeType ?? null,
    fileSize: getAssetFileSize(asset),
    stage,
    ...detail,
  });
}

async function readAvatarUploadBody(asset: PickedAvatarAsset, normalized: NormalizedAvatarUri): Promise<AvatarUploadBody> {
  if (Platform.OS === 'android' && normalized.normalizedScheme === 'file') {
    const base64 = await FileSystem.readAsStringAsync(normalized.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = decodeBase64(base64);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  const fileResponse = await fetch(normalized.uri);
  return fileResponse.blob();
}

function buildPublicAvatarUrl(path: string) {
  return `${env.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/avatars/${path}`;
}

function normalizeStorageObjectPath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join('/');
}

function resolveOwnedAvatarPath(avatarUrl: string | null | undefined, userId: string) {
  if (!avatarUrl) return null;

  try {
    const url = new URL(avatarUrl);
    const supabaseOrigin = new URL(env.supabaseUrl).origin;
    if (url.origin !== supabaseOrigin) return null;

    const publicPrefix = '/storage/v1/object/public/avatars/';
    const objectPrefix = '/storage/v1/object/avatars/';
    const rawPath = url.pathname.startsWith(publicPrefix)
      ? url.pathname.slice(publicPrefix.length)
      : url.pathname.startsWith(objectPrefix)
        ? url.pathname.slice(objectPrefix.length)
        : null;

    if (!rawPath) return null;

    const normalizedPath = normalizeStorageObjectPath(rawPath);
    if (!normalizedPath.startsWith(`${userId}/`)) return null;

    return normalizedPath;
  } catch {
    return null;
  }
}

async function deleteAvatarObject(session: StoredSession, objectPath: string) {
  const encodedPath = objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const response = await fetch(`${env.supabaseUrl}/storage/v1/object/avatars/${encodedPath}`, {
    method: 'DELETE',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '旧头像删除失败');
  }
}

async function ensureMediaLibraryPermission() {
  const imagePicker = getImagePickerModule();
  if (typeof imagePicker.requestMediaLibraryPermissionsAsync !== 'function') {
    throw new Error('expo-image-picker 已加载，但 requestMediaLibraryPermissionsAsync 不存在。当前 iOS App 很可能还是旧原生包。');
  }
  const permission = await imagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('请先允许访问相册后再更换头像');
  }
}

async function ensureCameraPermission() {
  const imagePicker = getImagePickerModule();
  if (typeof imagePicker.requestCameraPermissionsAsync !== 'function') {
    throw new Error('expo-image-picker 已加载，但 requestCameraPermissionsAsync 不存在。当前 iOS App 很可能还是旧原生包。');
  }
  const permission = await imagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('请先允许访问相机后再拍摄头像');
  }
}

export async function pickAvatarImage(source: AvatarInputSource) {
  if (source === 'camera') {
    await ensureCameraPermission();
  } else {
    await ensureMediaLibraryPermission();
  }

  const imagePicker = getImagePickerModule();
  if (source === 'camera' && typeof imagePicker.launchCameraAsync !== 'function') {
    throw new Error('expo-image-picker 已加载，但 launchCameraAsync 不存在。当前 iOS App 没有编进拍照原生模块。');
  }
  if (source === 'library' && typeof imagePicker.launchImageLibraryAsync !== 'function') {
    throw new Error('expo-image-picker 已加载，但 launchImageLibraryAsync 不存在。当前 iOS App 没有编进相册原生模块。');
  }

  const launcher =
    source === 'camera'
      ? imagePicker.launchCameraAsync!.bind(imagePicker)
      : imagePicker.launchImageLibraryAsync!.bind(imagePicker);

  const result = await launcher({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.72,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];
  if (asset.mimeType && !asset.mimeType.toLowerCase().startsWith('image/')) {
    throw new Error('只能选择图片作为头像');
  }

  logAvatarPickResult(source, asset);

  return asset;
}

async function uploadAvatarObject(session: StoredSession, asset: PickedAvatarAsset) {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error('缺少用户信息，无法上传头像');
  }

  const filePath = buildAvatarPath(userId, asset);
  let normalized: NormalizedAvatarUri;
  try {
    normalized = await normalizeAvatarUploadUri(asset);
  } catch (error) {
    logAvatarUploadFailed(asset, 'normalize_uri', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error('头像上传失败，请重试');
  }
  logAvatarUploadUriNormalized(asset, normalized);

  let uploadBody: AvatarUploadBody;
  try {
    uploadBody = await readAvatarUploadBody(asset, normalized);
  } catch (error) {
    logAvatarUploadFailed(asset, 'read_blob', {
      fromScheme: normalized.originalScheme,
      toScheme: normalized.normalizedScheme,
      message: error instanceof Error ? error.message : String(error),
    });
    await normalized.cleanup?.();
    throw new Error('头像上传失败，请重试');
  }

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(`${env.supabaseUrl}/storage/v1/object/avatars/${filePath}`, {
      method: 'POST',
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': resolveAvatarMimeType(asset),
        'x-upsert': 'false',
      },
      body: uploadBody,
    });
  } catch (error) {
    logAvatarUploadFailed(asset, 'storage_upload', {
      message: error instanceof Error ? error.message : String(error),
    });
    await normalized.cleanup?.();
    throw new Error('头像上传失败，请重试');
  }
  await normalized.cleanup?.();

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    logAvatarUploadFailed(asset, 'storage_upload', { status: uploadResponse.status });
    throw new Error(text || '头像上传失败，请重试');
  }

  return {
    filePath,
    publicUrl: buildPublicAvatarUrl(filePath),
  };
}

async function updateAvatarProfile(session: StoredSession, avatarUrl: string) {
  const userId = session.user?.id;
  if (!userId) {
    throw new Error('缺少用户信息，无法更新头像');
  }

  const response = await fetch(buildRestTableUrl('user_profiles', { id: `eq.${userId}` }), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '头像资料更新失败');
  }
}

export async function uploadAvatarAndUpdateProfile(session: StoredSession, source: AvatarInputSource) {
  const currentAvatarUrl = session.user?.avatarUrl ?? null;
  const asset = await pickAvatarImage(source);
  if (!asset) {
    return null;
  }

  const uploaded = await uploadAvatarObject(session, asset);
  await updateAvatarProfile(session, uploaded.publicUrl);

  const userId = session.user?.id;
  const oldAvatarPath = userId ? resolveOwnedAvatarPath(currentAvatarUrl, userId) : null;
  if (oldAvatarPath && oldAvatarPath !== uploaded.filePath) {
    void deleteAvatarObject(session, oldAvatarPath).catch((error) => {
      console.warn('[avatar] failed to delete previous avatar', error);
    });
  }

  return {
    avatarUrl: uploaded.publicUrl,
    path: uploaded.filePath,
  };
}

export const avatarService = {
  uploadAvatarAndUpdateProfile,
};

export default avatarService;
