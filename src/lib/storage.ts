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
export const LOCAL_MEDIA_STORAGE_KEY = 'episodia_local_media';
export const CLOUD_CONFIG_STORAGE_KEY = 'episodia_cloud_config';

const DEFAULT_SERIES_ITEM: Series = {
  id: 'series-default-1',
  title: 'Serie Principale',
  description: 'Sitcom social in formato verticale per Reels e TikTok',
  genre: 'Sitcom brillante',
  defaultAspectRatio: '9:16',
  castIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

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

/**
 * Sincronizza Personaggi, Serie ed Episodi con il Server (/api/studio-db)
 * e opzionalmente con un Endpoint Cloud remoto (es. Firebase, JSONBin, Supabase).
 * I file video pesanti generati NON vengono mai caricati sul server.
 */
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

/**
 * Carica lo stato completo unificando Server/Cloud + Cache IndexedDB + File Video Locali.
 */
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

      const serverHasData =
        (serverData.cast && serverData.cast.length > 0) ||
        (serverData.episodes && serverData.episodes.length > 0) ||
        (serverData.series && serverData.series.length > 1);

      const localHasData =
        localCast.length > 0 ||
        localEpisodes.length > 0 ||
        localSeries.length > 1;

      // Se il browser locale aveva già dati salvati e il server era appena stato inizializzato vuoto,
      // carichiamo automaticamente i dati locali sul server!
      if (!serverHasData && localHasData) {
        await pushStateToServer();
        const hydratedLocalEpisodes = attachLocalMediaToEpisodes(
          localEpisodes,
          localMediaMap
        );
        return {
          cast: localCast,
          series: localSeries,
          episodes: hydratedLocalEpisodes,
          source: 'local-pushed-to-server',
        };
      }

      const finalCast = serverData.cast || [];
      const finalSeries =
        serverData.series && serverData.series.length > 0
          ? serverData.series
          : [DEFAULT_SERIES_ITEM];

      // Associa eventuali episodi privi di seriesId alla prima serie disponibile
      const normalizedEpisodes = (serverData.episodes || []).map((ep) => ({
        ...ep,
        seriesId: ep.seriesId || finalSeries[0].id,
      }));

      // Ri-collega i video salvati solo in locale su questo PC
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

  const hydratedLocalEpisodes = attachLocalMediaToEpisodes(
    localEpisodes,
    localMediaMap
  );
  return {
    cast: localCast,
    series: localSeries,
    episodes: hydratedLocalEpisodes,
    source: 'indexeddb-offline',
  };
}

// ============================================================================
// LOCAL-ONLY GENERATED MEDIA STORAGE (Video/Clip salvati SOLO in locale)
// ============================================================================

export async function getLocalGeneratedMediaMap(): Promise<
  Record<string, string>
> {
  if (typeof window === 'undefined') return {};
  try {
    const map = await get<Record<string, string>>(LOCAL_MEDIA_STORAGE_KEY);
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

export async function saveLocalGeneratedVideo(
  shotId: string,
  videoDataUrl: string
): Promise<void> {
  if (typeof window === 'undefined') return;
  const map = await getLocalGeneratedMediaMap();
  map[shotId] = videoDataUrl;
  await set(LOCAL_MEDIA_STORAGE_KEY, map);
}

export async function deleteLocalGeneratedVideo(shotId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const map = await getLocalGeneratedMediaMap();
  delete map[shotId];
  await set(LOCAL_MEDIA_STORAGE_KEY, map);
}

function attachLocalMediaToEpisodes(
  episodes: Episode[],
  mediaMap: Record<string, string>
): Episode[] {
  return episodes.map((ep) => ({
    ...ep,
    shots: ep.shots.map((shot) => ({
      ...shot,
      videoUrl: mediaMap[shot.id] || shot.videoUrl,
    })),
  }));
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
  if (typeof window === 'undefined') return [DEFAULT_SERIES_ITEM];
  try {
    const data = await get<Series[]>(SERIES_STORAGE_KEY);
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
    await set(SERIES_STORAGE_KEY, [DEFAULT_SERIES_ITEM]);
    return [DEFAULT_SERIES_ITEM];
  } catch (error) {
    console.error('Errore durante la lettura delle Serie da IndexedDB:', error);
    return [DEFAULT_SERIES_ITEM];
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
  let updatedSeries = currentSeries.filter((s) => s.id !== seriesId);
  if (updatedSeries.length === 0) {
    updatedSeries = [DEFAULT_SERIES_ITEM];
  }

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
