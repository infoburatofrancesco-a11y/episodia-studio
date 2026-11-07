import { get, set, del } from 'idb-keyval';
import type {
  Character,
  Series,
  Episode,
  CloudSyncConfig,
  StudioDatabasePayload,
} from '@/types/episodia';

export const CAST_STORAGE_KEY = 'episodia_cast';
export const SERIES_STORAGE_KEY = 'episodia_series';
export const EPISODES_STORAGE_KEY = 'episodia_episodes';
export const LOCAL_MEDIA_STORAGE_KEY = 'episodia_local_media_v6_i2v24fps';
export const CLOUD_CONFIG_STORAGE_KEY = 'episodia_cloud_config';

// ============================================================================
// CLOUD & SERVER SYNC CONFIGURATION
// ============================================================================

export async function getCloudSyncConfig(): Promise<CloudSyncConfig> {
  if (typeof window === 'undefined') return { enabled: true };
  try {
    const cfg = await get<CloudSyncConfig>(CLOUD_CONFIG_STORAGE_KEY);
    return cfg || { enabled: true };
  } catch {
    return { enabled: true };
  }
}

export async function saveCloudSyncConfig(
  config: CloudSyncConfig
): Promise<void> {
  if (typeof window === 'undefined') return;
  await set(CLOUD_CONFIG_STORAGE_KEY, config);
}

export async function pushStateToServer(): Promise<{
  ok: boolean;
  updatedAt?: string;
  cloudSynced?: boolean;
}> {
  if (typeof window === 'undefined') return { ok: false };
  try {
    const [cast, series, episodes, cloudCfg] = await Promise.all([
      getCast(),
      getSeriesList(),
      getEpisodes(),
      getCloudSyncConfig(),
    ]);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cloudCfg.remoteEndpointUrl?.trim()) {
      headers['x-cloud-endpoint'] = cloudCfg.remoteEndpointUrl.trim();
    }
    if (cloudCfg.remoteApiKey?.trim()) {
      headers['x-cloud-key'] = cloudCfg.remoteApiKey.trim();
    }

    const res = await fetch('/api/studio-db', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        cast,
        series,
        episodes,
      }),
    });

    if (!res.ok) return { ok: false };
    const data = await res.json();

    await saveCloudSyncConfig({
      ...cloudCfg,
      lastSyncedAt: data.updatedAt || new Date().toISOString(),
    });

    return {
      ok: true,
      updatedAt: data.updatedAt,
      cloudSynced: data.cloudSynced,
    };
  } catch (error) {
    console.warn('Sincronizzazione server in background non riuscita:', error);
    return { ok: false };
  }
}

export async function pullStateFromServer(): Promise<{
  cast: Character[];
  series: Series[];
  episodes: Episode[];
  source: string;
}> {
  const [localCast, localSeries, localEpisodes, localMediaMap, cloudCfg] =
    await Promise.all([
      getCast(),
      getSeriesList(),
      getEpisodes(),
      getLocalGeneratedMediaMap(),
      getCloudSyncConfig(),
    ]);

  try {
    const headers: Record<string, string> = {};
    if (cloudCfg.remoteEndpointUrl?.trim()) {
      headers['x-cloud-endpoint'] = cloudCfg.remoteEndpointUrl.trim();
    }
    if (cloudCfg.remoteApiKey?.trim()) {
      headers['x-cloud-key'] = cloudCfg.remoteApiKey.trim();
    }

    const res = await fetch('/api/studio-db', {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (res.ok) {
      const serverData = (await res.json()) as StudioDatabasePayload & {
        source?: string;
      };

      const finalCast = Array.isArray(serverData.cast) ? serverData.cast : [];
      const rawSeries = Array.isArray(serverData.series)
        ? serverData.series
        : [];
      const finalSeries = attachLocalMediaToSeries(rawSeries, localMediaMap);

      const normalizedEpisodes = (serverData.episodes || []).map((ep) => ({
        ...ep,
        seriesId: ep.seriesId || finalSeries[0]?.id || '',
      }));

      const hydratedEpisodes = attachLocalMediaToEpisodes(
        normalizedEpisodes,
        localMediaMap
      );

      await Promise.all([
        set(CAST_STORAGE_KEY, finalCast),
        set(SERIES_STORAGE_KEY, finalSeries),
        set(EPISODES_STORAGE_KEY, hydratedEpisodes),
      ]);

      return {
        cast: finalCast,
        series: finalSeries,
        episodes: hydratedEpisodes,
        source: serverData.source || 'server-disk',
      };
    }
  } catch (err) {
    console.warn('Server non raggiungibile, uso IndexedDB locale:', err);
  }

  return {
    cast: localCast,
    series: attachLocalMediaToSeries(localSeries, localMediaMap),
    episodes: attachLocalMediaToEpisodes(localEpisodes, localMediaMap),
    source: 'indexeddb-offline',
  };
}

// ============================================================================
// LOCAL-ONLY GENERATED MEDIA STORAGE (Video/Clip e Sigle salvati SOLO in locale)
// ============================================================================

// Ripara i Data URL video rimuovendo ";codecs=vp8,opus" prima di ";base64," (la virgola in "vp8,opus" rompe il tag <video> in Chrome mostrando 0:00)
function sanitizeVideoDataUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.replace(
    /^data:(video\/[a-z0-9]+);[^;]+;base64,/i,
    'data:$1;base64,'
  );
}

export async function getLocalGeneratedMediaMap(): Promise<
  Record<string, string>
> {
  if (typeof window === 'undefined') return {};
  try {
    // Rimuove automaticamente la vecchia cache con le clip da 4-5s corrotte/sdoppiate
    del('episodia_local_media').catch(() => {});
    const map = await get<Record<string, string>>(LOCAL_MEDIA_STORAGE_KEY);
    if (!map || typeof map !== 'object') return {};
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === 'string') {
        cleaned[k] = sanitizeVideoDataUrl(v) || v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

export async function saveLocalGeneratedVideo(
  mediaKey: string,
  videoDataUrl: string
): Promise<void> {
  if (typeof window === 'undefined') return;
  const map = await getLocalGeneratedMediaMap();
  map[mediaKey] = sanitizeVideoDataUrl(videoDataUrl) || videoDataUrl;
  await set(LOCAL_MEDIA_STORAGE_KEY, map);
}

export async function deleteLocalGeneratedVideo(
  mediaKey: string
): Promise<void> {
  if (typeof window === 'undefined') return;
  const map = await getLocalGeneratedMediaMap();
  delete map[mediaKey];
  await set(LOCAL_MEDIA_STORAGE_KEY, map);
}

function attachLocalMediaToEpisodes(
  episodes: Episode[],
  mediaMap: Record<string, string>
): Episode[] {
  return episodes.map((ep) => ({
    ...ep,
    shots: ep.shots.map((shot) => {
      const validLocalUrl = sanitizeVideoDataUrl(mediaMap[shot.id]);
      return {
        ...shot,
        duration: 10,
        videoUrl: validLocalUrl,
        status: validLocalUrl ? 'ready' : 'draft',
      };
    }),
  }));
}

// Per le Serie TV, il Video Sigla (introVideoUrl e gli shot della sigla) è salvato sul Database Cloud
// così è identico su qualsiasi telefono o PC, con fallback sulla cache locale se offline.
function attachLocalMediaToSeries(
  seriesList: Series[],
  mediaMap: Record<string, string>
): Series[] {
  return seriesList.map((s) => {
    if (!s.intro) return s;
    const introKey = `intro-${s.id}`;
    return {
      ...s,
      intro: {
        ...s.intro,
        introVideoUrl: sanitizeVideoDataUrl(
          s.intro.introVideoUrl || mediaMap[introKey]
        ),
        shots: (s.intro.shots || []).map((shot) => ({
          ...shot,
          videoUrl: sanitizeVideoDataUrl(shot.videoUrl || mediaMap[shot.id]),
        })),
      },
    };
  });
}

// ============================================================================
// GLOBAL CAST STORAGE (IndexedDB + Server Sync)
// ============================================================================

export async function getCast(): Promise<Character[]> {
  if (typeof window === 'undefined') return [];
  try {
    const data = await get<Character[]>(CAST_STORAGE_KEY);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Errore durante la lettura del Cast da IndexedDB:', error);
    return [];
  }
}

export async function saveCast(characters: Character[]): Promise<void> {
  if (typeof window === 'undefined') return;
  await set(CAST_STORAGE_KEY, characters);
  await pushStateToServer();
}

export async function saveCharacter(character: Character): Promise<Character[]> {
  const currentCast = await getCast();
  const existingIndex = currentCast.findIndex((c) => c.id === character.id);
  let updatedCast: Character[];

  if (existingIndex >= 0) {
    updatedCast = [...currentCast];
    updatedCast[existingIndex] = character;
  } else {
    updatedCast = [...currentCast, character];
  }

  await saveCast(updatedCast);
  return updatedCast;
}

export async function deleteCharacter(characterId: string): Promise<Character[]> {
  const currentCast = await getCast();
  const updatedCast = currentCast.filter((c) => c.id !== characterId);
  await saveCast(updatedCast);
  return updatedCast;
}

export async function clearCast(): Promise<void> {
  if (typeof window === 'undefined') return;
  await del(CAST_STORAGE_KEY);
  await pushStateToServer();
}

// ============================================================================
// MULTI-SERIES STORAGE (Gestione di più Serie TV in parallelo)
// ============================================================================

export async function getSeriesList(): Promise<Series[]> {
  if (typeof window === 'undefined') return [];
  try {
    const data = await get<Series[]>(SERIES_STORAGE_KEY);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Errore durante la lettura delle Serie da IndexedDB:', error);
    return [];
  }
}

export async function saveSeriesList(seriesList: Series[]): Promise<void> {
  if (typeof window === 'undefined') return;
  await set(SERIES_STORAGE_KEY, seriesList);
  await pushStateToServer();
}

export async function saveSeries(seriesItem: Series): Promise<Series[]> {
  const current = await getSeriesList();
  const idx = current.findIndex((s) => s.id === seriesItem.id);
  let updated: Series[];

  if (idx >= 0) {
    updated = [...current];
    updated[idx] = { ...seriesItem, updatedAt: new Date().toISOString() };
  } else {
    updated = [
      ...current,
      { ...seriesItem, updatedAt: new Date().toISOString() },
    ];
  }

  await saveSeriesList(updated);
  return updated;
}

export async function deleteSeries(seriesId: string): Promise<{
  series: Series[];
  episodes: Episode[];
}> {
  const currentSeries = await getSeriesList();
  const updatedSeries = currentSeries.filter((s) => s.id !== seriesId);

  const currentEpisodes = await getEpisodes();
  const updatedEpisodes = currentEpisodes.filter(
    (ep) => ep.seriesId !== seriesId
  );

  await set(SERIES_STORAGE_KEY, updatedSeries);
  await set(EPISODES_STORAGE_KEY, updatedEpisodes);
  await pushStateToServer();

  return { series: updatedSeries, episodes: updatedEpisodes };
}

// ============================================================================
// EPISODES STORAGE (IndexedDB + Server Sync)
// ============================================================================

export async function getEpisodes(): Promise<Episode[]> {
  if (typeof window === 'undefined') return [];
  try {
    const data = await get<Episode[]>(EPISODES_STORAGE_KEY);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Errore durante la lettura degli Episodi da IndexedDB:', error);
    return [];
  }
}

export async function saveEpisodes(episodes: Episode[]): Promise<void> {
  if (typeof window === 'undefined') return;
  await set(EPISODES_STORAGE_KEY, episodes);
  await pushStateToServer();
}

export async function saveEpisode(episode: Episode): Promise<Episode[]> {
  const currentEpisodes = await getEpisodes();
  const existingIndex = currentEpisodes.findIndex((ep) => ep.id === episode.id);
  let updatedEpisodes: Episode[];

  if (existingIndex >= 0) {
    updatedEpisodes = [...currentEpisodes];
    updatedEpisodes[existingIndex] = episode;
  } else {
    updatedEpisodes = [episode, ...currentEpisodes];
  }

  await saveEpisodes(updatedEpisodes);
  return updatedEpisodes;
}

export async function deleteEpisode(episodeId: string): Promise<Episode[]> {
  const currentEpisodes = await getEpisodes();
  const updatedEpisodes = currentEpisodes.filter((ep) => ep.id !== episodeId);
  await saveEpisodes(updatedEpisodes);
  return updatedEpisodes;
}

export async function clearEpisodes(): Promise<void> {
  if (typeof window === 'undefined') return;
  await del(EPISODES_STORAGE_KEY);
  await pushStateToServer();
}
