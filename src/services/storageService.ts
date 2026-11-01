import { Series, ApiKeysConfig } from '../types/studio';
import { DEFAULT_SERIES, DEFAULT_API_KEYS } from '../data/defaultStudioData';

const DB_NAME = 'SkySketchStudioDB';
const DB_VERSION = 2;
const STORE_SERIES = 'series_store';
const STORE_BLOBS = 'media_blobs';
const LS_KEYS_CONFIG = 'skysketch_api_keys_v1';
const LS_ACTIVE_SERIES_ID = 'skysketch_active_series_id_v1';

let cachedDb: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (cachedDb) {
    try {
      // Test if cached connection is still open
      cachedDb.transaction(STORE_SERIES, 'readonly');
      return Promise.resolve(cachedDb);
    } catch {
      cachedDb = null;
    }
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('IndexedDB open timeout (falling back)'));
      }
    }, 2500);

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SERIES)) {
          db.createObjectStore(STORE_SERIES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS);
        }
      };
      request.onblocked = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(new Error('IndexedDB blocked by another tab'));
        }
      };
      request.onsuccess = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cachedDb = request.result;
          cachedDb.onversionchange = () => {
            try { cachedDb?.close(); } catch {}
            cachedDb = null;
          };
          resolve(cachedDb);
        }
      };
      request.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(request.error);
        }
      };
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(e);
      }
    }
  });
}

const LS_SEEDED_DEFAULT = 'skysketch_seeded_default_v1';
const LS_DELETED_DEFAULT_SERIES = 'skysketch_deleted_default_series_v1';
const LS_SERIES_AUTONOMY_FIX_V5 = 'skysketch_series_autonomy_fix_v5';

function restoreBlobUrlFromBase64(base64: string, mimeType = 'audio/webm'): string | undefined {
  try {
    if (!base64 || base64.length < 16) return undefined;
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType || 'audio/webm' });
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

function isContaminatedVitaDaCaniText(text?: string): boolean {
  if (!text) return false;
  return /vita da cani|cagna che esplora|cagna che fuma|zora e uma|zora|uma|croccantini/i.test(text);
}

export async function loadAllSeries(): Promise<Series[]> {
  const isDefaultDeleted = localStorage.getItem(LS_DELETED_DEFAULT_SERIES) === 'true';
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SERIES, 'readonly');
      const store = tx.objectStore(STORE_SERIES);
      const req = store.getAll();
      req.onsuccess = () => {
        let list = (req.result as Series[]) || [];
        if (isDefaultDeleted) {
          list = list.filter(
            (s) =>
              s.id !== DEFAULT_SERIES.id &&
              s.id !== 'series-skysketch-1' &&
              s.id !== 'series-vita-da-cani' &&
              !s.title.toLowerCase().includes('vita da cani')
          );
        }
        if (list.length === 0) {
          const alreadySeeded = localStorage.getItem(LS_SEEDED_DEFAULT) === 'true' || isDefaultDeleted;
          if (!alreadySeeded) {
            localStorage.setItem(LS_SEEDED_DEFAULT, 'true');
            localStorage.setItem(LS_SERIES_AUTONOMY_FIX_V5, 'true');
            saveSeries(DEFAULT_SERIES);
            resolve([DEFAULT_SERIES]);
          } else {
            resolve([]);
          }
        } else {
          localStorage.setItem(LS_SEEDED_DEFAULT, 'true');
          const needsAutonomyReset = localStorage.getItem(LS_SERIES_AUTONOMY_FIX_V5) !== 'true';
          if (needsAutonomyReset) {
            localStorage.setItem(LS_SERIES_AUTONOMY_FIX_V5, 'true');
          }

          const defaultCastIds = new Set(DEFAULT_SERIES.cast.map((dc) => dc.id));

          // Repair any legacy utf8 SVG avatars, restore voiceSampleBlobUrl, and strictly isolate non-default series
          const repaired = list.map((s) => {
            const isDefaultVdcSeries =
              s.id === DEFAULT_SERIES.id || s.title.toLowerCase().includes('vita da cani');

            let rawCast = Array.isArray(s.cast) && s.cast.length > 0 ? s.cast : DEFAULT_SERIES.cast;

            // If this is an autonomous user-created series (e.g. "Bestemmia Atelier"), remove accidentally injected default cast members (like Cristina)
            if (!isDefaultVdcSeries) {
              const customMembers = rawCast.filter((c) => !defaultCastIds.has(c.id));
              if (customMembers.length > 0) {
                rawCast = customMembers;
              }
            }

            const cleanedCast = rawCast.map((c) => {
              const defMatch = isDefaultVdcSeries
                ? DEFAULT_SERIES.cast.find((dc) => dc.id === c.id)
                : undefined;
              const photos = Array.isArray(c.referencePhotos) ? c.referencePhotos : [];
              const fixedPhotos = photos.map((p) =>
                typeof p === 'string' && p.startsWith('data:image/svg+xml;utf8') && defMatch
                  ? defMatch.referencePhotos[0]
                  : p
              );
              const realPhotos = fixedPhotos.filter(
                (p) => typeof p === 'string' && !p.startsWith('data:image/svg+xml')
              );
              const restoredSampleUrl =
                c.voiceConfig?.voiceSampleBase64
                  ? restoreBlobUrlFromBase64(
                      c.voiceConfig.voiceSampleBase64,
                      c.voiceConfig.voiceSampleMimeType || 'audio/webm'
                    )
                  : c.voiceConfig?.voiceSampleBlobUrl;
              return {
                ...c,
                referencePhotos: realPhotos.length > 0 ? realPhotos : fixedPhotos,
                voiceConfig: {
                  ...(defMatch?.voiceConfig || c.voiceConfig),
                  ...c.voiceConfig,
                  voiceSampleBlobUrl: restoredSampleUrl || c.voiceConfig?.voiceSampleBlobUrl
                },
                relationships:
                  Array.isArray(c.relationships) && c.relationships.length > 0
                    ? c.relationships.filter((r) => rawCast.some((rc) => rc.id === r.targetCharacterId))
                    : defMatch?.relationships || []
              };
            });

            // Remove accidentally injected DEFAULT_EPISODE ("ep-vita-da-cani-1") from non-default series
            let rawEpisodes = Array.isArray(s.episodes) ? s.episodes : [];
            if (!isDefaultVdcSeries) {
              rawEpisodes = rawEpisodes.filter(
                (ep) =>
                  ep.id !== 'ep-vita-da-cani-1' &&
                  !ep.title.toLowerCase().includes('zora & uma')
              );
            }

            const cleanedEpisodes = rawEpisodes.map((ep, epIdx) => ({
              ...ep,
              episodeNumber: epIdx + 1,
              uploadedMedia: Array.isArray(ep.uploadedMedia) ? ep.uploadedMedia : [],
              detectedCastIds: (ep.detectedCastIds || []).filter((id) =>
                cleanedCast.some((c) => c.id === id)
              ),
              scenes: (Array.isArray(ep.scenes) ? ep.scenes : []).map((sc, scIdx) => {
                const validCharObj =
                  cleanedCast.find((c) => c.id === sc.characterId) ||
                  cleanedCast[scIdx % Math.max(1, cleanedCast.length)];
                const validCharId = validCharObj?.id || sc.characterId;
                const validCharIds = Array.isArray(sc.characterIds)
                  ? sc.characterIds.filter((id) => cleanedCast.some((c) => c.id === id))
                  : [];
                const finalCharIds = validCharIds.length > 0 ? validCharIds : [validCharId];

                const bestCharPhoto =
                  validCharObj?.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
                  validCharObj?.referencePhotos?.[0] ||
                  '';
                const sourceIsSvgOrEmpty =
                  !sc.aiPhotoSourceUrl || sc.aiPhotoSourceUrl.startsWith('data:image/svg+xml');

                // Clean any cross-contaminated dialogue from Vita da Cani in non-default series
                let cleanDialogue = sc.dialogueOrThought || '';
                if (!isDefaultVdcSeries && isContaminatedVitaDaCaniText(cleanDialogue)) {
                  cleanDialogue = `Benvenuti in ${s.title}! Io sono ${validCharObj?.name || 'il protagonista'} e oggi in "${ep.title}" vedrete qualcosa di unico!`;
                }

                const cleanTurns = Array.isArray(sc.dialogueTurns)
                  ? sc.dialogueTurns.map((t, tIdx) => {
                      const tChar =
                        cleanedCast.find((c) => c.id === t.characterId) ||
                        cleanedCast[tIdx % Math.max(1, cleanedCast.length)] ||
                        validCharObj;
                      let tLine = t.dialogueOrThought || '';
                      if (!isDefaultVdcSeries && isContaminatedVitaDaCaniText(tLine)) {
                        tLine =
                          tIdx === 0
                            ? `Allora, siamo pronti per iniziare questa nuova scena di ${s.title}?`
                            : `Assolutamente sì! Stavolta in ${s.title} superiamo ogni aspettativa!`;
                      }
                      return {
                        ...t,
                        characterId: tChar?.id || validCharId,
                        dialogueOrThought: tLine
                      };
                    })
                  : undefined;

                return {
                  ...sc,
                  characterId: validCharId,
                  characterIds: finalCharIds,
                  dialogueOrThought: cleanDialogue,
                  dialogueTurns: cleanTurns,
                  characterRoleBadge:
                    !isDefaultVdcSeries &&
                    (sc.characterRoleBadge === "L'ESPLORATRICE" ||
                      sc.characterRoleBadge === 'LA SORELLINA' ||
                      sc.characterRoleBadge === 'IL CAPOFAMIGLIA' ||
                      sc.characterRoleBadge === 'LA COMPLICE')
                      ? (validCharObj?.defaultCreditRole || 'PROTAGONISTA').slice(0, 22).toUpperCase()
                      : sc.characterRoleBadge,
                  aiPhotoSourceUrl: sourceIsSvgOrEmpty ? bestCharPhoto : sc.aiPhotoSourceUrl,
                  generatedAiImageUrl: needsAutonomyReset ? undefined : sc.generatedAiImageUrl,
                  generatedAudioUrl: undefined
                };
              })
            }));

            // Build strictly isolated branding for non-default series
            const cleanBranding = isDefaultVdcSeries
              ? {
                  ...DEFAULT_SERIES.branding,
                  ...(s.branding || {})
                }
              : {
                  introEnabled: s.branding?.introEnabled ?? true,
                  introDurationSec: s.branding?.introDurationSec ?? 3.0,
                  introBgVideoOrImage:
                    s.branding?.introBgVideoOrImage?.includes('vita_da_cani_')
                      ? ''
                      : s.branding?.introBgVideoOrImage || '',
                  introBgMediaType:
                    s.branding?.introBgVideoOrImage?.includes('vita_da_cani_')
                      ? ('NONE' as const)
                      : s.branding?.introBgMediaType,
                  introBgFileName:
                    s.branding?.introBgFileName?.includes('vita_da_cani_')
                      ? undefined
                      : s.branding?.introBgFileName,
                  introMediaItems: Array.isArray(s.branding?.introMediaItems)
                    ? s.branding.introMediaItems.filter(
                        (m) => !m.url.includes('vita_da_cani_')
                      )
                    : [],
                  introJingleUrl: s.branding?.introJingleUrl || '',
                  introJingleFileName: s.branding?.introJingleFileName,
                  introThemeColor: s.branding?.introThemeColor || '#0284c7',
                  introCustomTitle:
                    s.branding?.introCustomTitle === 'VITA DA CANI'
                      ? s.title.toUpperCase()
                      : s.branding?.introCustomTitle || s.title.toUpperCase(),
                  introCustomSubtitle:
                    s.branding?.introCustomSubtitle?.includes('Zora')
                      ? s.description
                      : s.branding?.introCustomSubtitle,
                  introShowEpisodeBadge: s.branding?.introShowEpisodeBadge ?? true,
                  introShowCastAvatars: s.branding?.introShowCastAvatars ?? true,
                  outroEnabled: s.branding?.outroEnabled ?? true,
                  outroDurationSec: s.branding?.outroDurationSec ?? 4.0,
                  outroBgVideoOrImage: s.branding?.outroBgVideoOrImage,
                  outroBgMediaType: s.branding?.outroBgMediaType,
                  outroBgFileName: s.branding?.outroBgFileName,
                  outroMediaItems: s.branding?.outroMediaItems || [],
                  outroAudioUrl: s.branding?.outroAudioUrl,
                  outroAudioFileName: s.branding?.outroAudioFileName,
                  outroThemeColor: s.branding?.outroThemeColor,
                  outroCustomHeader: s.branding?.outroCustomHeader?.includes('VITA DA CANI')
                    ? `${s.title.toUpperCase()} • CAST UFFICIALE`
                    : s.branding?.outroCustomHeader,
                  outroShowCastCards: s.branding?.outroShowCastCards ?? true,
                  autoListDetectedCast: s.branding?.autoListDetectedCast ?? true,
                  aiFunnyRoles: s.branding?.aiFunnyRoles ?? true,
                  footerText:
                    s.branding?.footerText?.includes('Vita da Cani')
                      ? `🎬 ${s.title} • Girato e montato con SkySketch Studio!`
                      : s.branding?.footerText || `🎬 ${s.title} • Girato e montato con SkySketch Studio!`
                };

            const finalEpisodes = cleanedEpisodes.length > 0 ? cleanedEpisodes : [
              {
                id: `ep-${s.id}-1`,
                episodeNumber: 1,
                title: 'Puntata #1 — Il Debutto',
                rawIdea: `Primo episodio della serie "${s.title}".`,
                targetTotalDurationSec: 60,
                netContentDurationSec: 50,
                detectedCastIds: cleanedCast.map((c) => c.id),
                funnyRolesByCastId: {},
                uploadedMedia: [],
                scenes: cleanedCast.map((c, idx) => ({
                  id: `scene-${Date.now()}-${idx}`,
                  order: idx + 1,
                  sceneType: 'AI_PHOTO_VIDEO' as const,
                  characterId: c.id,
                  durationSec: Math.floor(50 / Math.max(1, cleanedCast.length)),
                  dialogueOrThought: `Benvenuti in ${s.title}!`,
                  aiPhotoSourceUrl: c.referencePhotos?.[0] || '',
                  status: 'READY' as const
                }))
              }
            ];

            const updatedSeries: Series = {
              ...s,
              branding: cleanBranding,
              cast: cleanedCast,
              episodes: finalEpisodes
            };

            saveSeries(updatedSeries);
            return updatedSeries;
          });
          resolve(repaired);
        }
      };
      req.onerror = () => resolve(isDefaultDeleted ? [] : [DEFAULT_SERIES]);
    });
  } catch {
    return isDefaultDeleted ? [] : [DEFAULT_SERIES];
  }
}

export async function saveSeries(series: Series): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SERIES, 'readwrite');
      const store = tx.objectStore(STORE_SERIES);
      store.put(series);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  } catch (e) {
    console.warn('Fallback saveSeries localStorage:', e);
  }
}

export async function deleteSeriesFromStorage(seriesId: string): Promise<void> {
  try {
    localStorage.setItem(LS_DELETED_DEFAULT_SERIES, 'true');
  } catch {}
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SERIES, 'readwrite');
      const store = tx.objectStore(STORE_SERIES);
      store.delete(seriesId);
      if (
        seriesId === DEFAULT_SERIES.id ||
        seriesId === 'series-skysketch-1' ||
        seriesId === 'series-vita-da-cani'
      ) {
        try {
          store.delete('series-skysketch-1');
          store.delete('series-vita-da-cani');
        } catch {}
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Delete aborted'));
    });
  } catch (e) {
    console.warn('Error deleting series from IndexedDB:', e);
  }
}

export async function saveMediaBlob(id: string, blob: Blob): Promise<string> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_BLOBS)) {
      return URL.createObjectURL(blob);
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      const store = tx.objectStore(STORE_BLOBS);
      store.put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Blob store aborted'));
    });
  } catch (e) {
    console.warn('Error saving blob to IndexedDB:', e);
  }
  return URL.createObjectURL(blob);
}

export async function getMediaBlobUrl(id: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const store = tx.objectStore(STORE_BLOBS);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result instanceof Blob) {
          resolve(URL.createObjectURL(req.result));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function loadApiKeys(): ApiKeysConfig {
  try {
    const raw = localStorage.getItem(LS_KEYS_CONFIG);
    if (!raw) return DEFAULT_API_KEYS;
    const parsed = JSON.parse(raw) as Partial<ApiKeysConfig>;
    const currentKey = parsed.geminiApiKey?.trim();
    const effectiveKey =
      !currentKey || currentKey.includes('Ab8RN6Jp') || currentKey.length < 20
        ? DEFAULT_API_KEYS.geminiApiKey
        : currentKey;
    return {
      geminiApiKey: effectiveKey,
      googleCloudProjectId: parsed.googleCloudProjectId || DEFAULT_API_KEYS.googleCloudProjectId,
      googleCloudLocation: parsed.googleCloudLocation || DEFAULT_API_KEYS.googleCloudLocation,
      vertexAiAccessToken: parsed.vertexAiAccessToken || DEFAULT_API_KEYS.vertexAiAccessToken,
      cloudTtsApiKey: parsed.cloudTtsApiKey || DEFAULT_API_KEYS.cloudTtsApiKey,
      preferVeoCloud: parsed.preferVeoCloud ?? DEFAULT_API_KEYS.preferVeoCloud,
      preferCloudTts: parsed.preferCloudTts ?? DEFAULT_API_KEYS.preferCloudTts
    };
  } catch {
    return DEFAULT_API_KEYS;
  }
}

export function saveApiKeys(config: ApiKeysConfig): void {
  try {
    localStorage.setItem(LS_KEYS_CONFIG, JSON.stringify(config));
  } catch (e) {
    console.warn('Unable to save API keys:', e);
  }
}

export function getActiveSeriesId(): string | null {
  return localStorage.getItem(LS_ACTIVE_SERIES_ID);
}

export function setActiveSeriesId(id: string): void {
  localStorage.setItem(LS_ACTIVE_SERIES_ID, id);
}

/**
 * Exports all Series, Cast, Voice Samples (Base64) and Episodes into a portable `.skysketch.json` file
 * so the user can transfer or backup projects across PC and Smartphone.
 */
export async function exportStudioBackupFile(seriesList: Series[]): Promise<void> {
  const payload = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    seriesList
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SkySketch_Backup_Progetti_${new Date().toISOString().slice(0, 10)}.skysketch.json`;
  a.click();
}

export async function importStudioBackupFile(file: File): Promise<Series[] | null> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const list: Series[] = Array.isArray(parsed) ? parsed : parsed?.seriesList;
    if (!Array.isArray(list) || list.length === 0) return null;
    for (const s of list) {
      await saveSeries(s);
    }
    return list;
  } catch (e) {
    console.warn('Error importing backup file:', e);
    return null;
  }
}
