import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import type { StudioDatabasePayload, Episode, Series } from '@/types/episodia';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE_PATH = path.join(DATA_DIR, 'episodia-db.json');

const DEFAULT_DB: StudioDatabasePayload = {
  cast: [],
  series: [],
  episodes: [],
  updatedAt: new Date().toISOString(),
};

function stripHeavyGeneratedMedia(episodes: Episode[]): Episode[] {
  return episodes.map((ep) => ({
    ...ep,
    shots: ep.shots.map((shot) => {
      const cleanShot = { ...shot };
      if (cleanShot.videoUrl && cleanShot.videoUrl.startsWith('data:video')) {
        delete cleanShot.videoUrl;
      }
      if (cleanShot.videoUrl && cleanShot.videoUrl.startsWith('blob:')) {
        delete cleanShot.videoUrl;
      }
      return cleanShot;
    }),
  }));
}

function stripHeavySeriesIntroMedia(seriesList: Series[]): Series[] {
  return seriesList.map((s) => {
    if (!s.intro) return s;
    const cleanIntro = { ...s.intro };
    if (
      cleanIntro.introVideoUrl &&
      (cleanIntro.introVideoUrl.startsWith('data:video') ||
        cleanIntro.introVideoUrl.startsWith('blob:'))
    ) {
      delete cleanIntro.introVideoUrl;
    }
    cleanIntro.shots = (cleanIntro.shots || []).map((shot) => {
      const cleanShot = { ...shot };
      if (
        cleanShot.videoUrl &&
        (cleanShot.videoUrl.startsWith('data:video') ||
          cleanShot.videoUrl.startsWith('blob:'))
      ) {
        delete cleanShot.videoUrl;
      }
      return cleanShot;
    });
    return {
      ...s,
      intro: cleanIntro,
    };
  });
}

async function readLocalServerDb(): Promise<StudioDatabasePayload> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(DB_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as StudioDatabasePayload;
    return {
      cast: Array.isArray(parsed.cast) ? parsed.cast : [],
      series: Array.isArray(parsed.series) ? parsed.series : [],
      episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return DEFAULT_DB;
  }
}

async function writeLocalServerDb(payload: StudioDatabasePayload): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // Su hosting serverless read-only (es. Vercel) ignoriamo la scrittura su disco locale
  }
}

function resolveCloudCredentials(req: NextRequest): {
  url: string | null;
  key: string | null;
  isSupabase: boolean;
} {
  const rawUrl =
    req.headers.get('x-cloud-endpoint')?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.EPISODIA_CLOUD_SYNC_URL?.trim() ||
    null;

  const rawKey =
    req.headers.get('x-cloud-key')?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.EPISODIA_CLOUD_SYNC_KEY?.trim() ||
    null;

  const isSupabase = Boolean(rawUrl && rawUrl.includes('.supabase.co'));
  return { url: rawUrl, key: rawKey, isSupabase };
}

function buildSupabaseHeaders(
  key: string,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: key,
    ...extra,
  };
  if (key.startsWith('eyJ')) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}

export async function GET(req: NextRequest) {
  try {
    const { url, key, isSupabase } = resolveCloudCredentials(req);

    if (url && isSupabase && key) {
      try {
        const baseUrl = url.replace(/\/+$/, '');
        const restUrl = baseUrl.includes('/rest/v1/')
          ? baseUrl
          : `${baseUrl}/rest/v1/episodia_state?id=eq.main&select=payload,updated_at`;

        const sbRes = await fetch(restUrl, {
          headers: buildSupabaseHeaders(key, {
            Accept: 'application/json',
          }),
          cache: 'no-store',
        });

        if (sbRes.ok) {
          const rows = await sbRes.json();
          if (Array.isArray(rows) && rows.length > 0 && rows[0]?.payload) {
            const p = rows[0].payload as Partial<StudioDatabasePayload>;
            const merged: StudioDatabasePayload = {
              cast: Array.isArray(p.cast) ? p.cast : [],
              series: Array.isArray(p.series) ? p.series : [],
              episodes: Array.isArray(p.episodes) ? p.episodes : [],
              updatedAt:
                rows[0].updated_at || p.updatedAt || new Date().toISOString(),
            };
            await writeLocalServerDb(merged);
            return NextResponse.json({
              ...merged,
              source: 'supabase-cloud',
            });
          }
          const localDb = await readLocalServerDb();
          return NextResponse.json({
            ...localDb,
            source: 'supabase-empty-ready',
          });
        }
      } catch (sbErr) {
        console.warn('Fallback da Supabase a disco locale:', sbErr);
      }
    }

    if (url && !isSupabase) {
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (key) {
          headers['Authorization'] = `Bearer ${key}`;
          headers['X-Master-Key'] = key;
          headers['apikey'] = key;
        }
        const cloudRes = await fetch(url, { headers, cache: 'no-store' });
        if (cloudRes.ok) {
          const cloudJson = await cloudRes.json();
          const record = (cloudJson.record ||
            cloudJson) as Partial<StudioDatabasePayload>;
          if (record && (Array.isArray(record.cast) || Array.isArray(record.series))) {
            const merged: StudioDatabasePayload = {
              cast: record.cast || [],
              series: Array.isArray(record.series) ? record.series : [],
              episodes: record.episodes || [],
              updatedAt: record.updatedAt || new Date().toISOString(),
            };
            await writeLocalServerDb(merged);
            return NextResponse.json({
              ...merged,
              source: 'cloud-remote',
            });
          }
        }
      } catch (cloudErr) {
        console.warn('Fallback su database server locale:', cloudErr);
      }
    }

    const db = await readLocalServerDb();
    return NextResponse.json({
      ...db,
      source: 'server-disk',
    });
  } catch (error: unknown) {
    console.error('Errore GET /api/studio-db:', error);
    return NextResponse.json(
      { error: 'Impossibile leggere il database dal server.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<StudioDatabasePayload>;
    const currentDb = await readLocalServerDb();

    const updatedPayload: StudioDatabasePayload = {
      cast: Array.isArray(body.cast) ? body.cast : currentDb.cast,
      series: Array.isArray(body.series)
        ? stripHeavySeriesIntroMedia(body.series)
        : currentDb.series,
      episodes: Array.isArray(body.episodes)
        ? stripHeavyGeneratedMedia(body.episodes)
        : currentDb.episodes,
      updatedAt: new Date().toISOString(),
    };

    await writeLocalServerDb(updatedPayload);

    const { url, key, isSupabase } = resolveCloudCredentials(req);
    let cloudSynced = false;
    let cloudError: string | null = null;

    if (url && isSupabase && key) {
      try {
        const baseUrl = url.replace(/\/+$/, '');
        const upsertUrl = baseUrl.includes('/rest/v1/')
          ? baseUrl
          : `${baseUrl}/rest/v1/episodia_state?on_conflict=id`;

        const sbRes = await fetch(upsertUrl, {
          method: 'POST',
          headers: buildSupabaseHeaders(key, {
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          }),
          body: JSON.stringify({
            id: 'main',
            payload: updatedPayload,
            updated_at: updatedPayload.updatedAt,
          }),
        });

        cloudSynced = sbRes.ok;
        if (!sbRes.ok) {
          cloudError = await sbRes.text();
        }
      } catch (sbErr: unknown) {
        cloudError = sbErr instanceof Error ? sbErr.message : 'Errore Supabase';
      }
    } else if (url && !isSupabase) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (key) {
          headers['Authorization'] = `Bearer ${key}`;
          headers['X-Master-Key'] = key;
          headers['apikey'] = key;
        }
        const cloudRes = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(updatedPayload),
        });
        cloudSynced = cloudRes.ok;
      } catch (cloudErr: unknown) {
        cloudError =
          cloudErr instanceof Error ? cloudErr.message : 'Errore Cloud';
      }
    }

    return NextResponse.json({
      ok: true,
      updatedAt: updatedPayload.updatedAt,
      cloudSynced,
      cloudError,
    });
  } catch (error: unknown) {
    console.error('Errore POST /api/studio-db:', error);
    return NextResponse.json(
      { error: 'Impossibile salvare il database sul server.' },
      { status: 500 }
    );
  }
}
