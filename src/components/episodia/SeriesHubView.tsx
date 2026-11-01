'use client';

import React, { useState, useRef } from 'react';
import {
  Tv,
  Plus,
  Pencil,
  Trash2,
  Check,
  Sparkles,
  Cloud,
  RefreshCw,
  Download,
  Upload,
  CheckCircle2,
  Smartphone,
  Monitor,
  ArrowRight,
  Server,
  X,
  Copy,
  Database,
  AlertCircle,
  Music,
  Film,
  Loader2,
  Wand2,
  Play,
} from 'lucide-react';
import type {
  Character,
  Series,
  Episode,
  Shot,
  SeriesIntro,
  CloudSyncConfig,
} from '@/types/episodia';
import { saveLocalGeneratedVideo } from '@/lib/storage';

interface SeriesHubViewProps {
  seriesList: Series[];
  activeSeriesId: string;
  cast: Character[];
  episodes: Episode[];
  cloudConfig: CloudSyncConfig;
  syncStatus: string;
  onSelectSeries: (seriesId: string) => void;
  onSaveSeries: (seriesItem: Series) => Promise<void>;
  onDeleteSeries: (seriesId: string) => Promise<void>;
  onOpenWritersRoomForSeries: (seriesId: string) => void;
  onOpenEpisodeInStoryboard: (seriesId: string, episodeId: string) => void;
  onSaveCloudConfig: (config: CloudSyncConfig) => Promise<void>;
  onForceServerSync: () => Promise<void>;
  onImportDatabaseJson: (payload: {
    cast: Character[];
    series: Series[];
    episodes: Episode[];
  }) => Promise<void>;
}

const SUPABASE_SQL_SNIPPET = `create table if not exists public.episodia_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.episodia_state enable row level security;

drop policy if exists "Episodia full access" on public.episodia_state;
create policy "Episodia full access"
  on public.episodia_state for all
  using (true)
  with check (true);`;

export default function SeriesHubView({
  seriesList,
  activeSeriesId,
  cast,
  episodes,
  cloudConfig,
  syncStatus,
  onSelectSeries,
  onSaveSeries,
  onDeleteSeries,
  onOpenWritersRoomForSeries,
  onOpenEpisodeInStoryboard,
  onSaveCloudConfig,
  onForceServerSync,
  onImportDatabaseJson,
}: SeriesHubViewProps) {
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('Sitcom brillante');
  const [description, setDescription] = useState('');
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<'9:16' | '16:9'>(
    '9:16'
  );
  const [selectedCastIds, setSelectedCastIds] = useState<string[]>([]);

  // Stato Generatore Sigla (Intro Max 15s) per la serie attiva
  const activeSeries =
    seriesList.find((s) => s.id === activeSeriesId) || seriesList[0] || null;

  const [introDuration, setIntroDuration] = useState<5 | 10 | 15>(
    activeSeries?.intro?.durationSeconds || 15
  );
  const [introConcept, setIntroConcept] = useState<string>(
    activeSeries?.intro?.concept ||
      'Sigla ritmata stile sitcom TV: presentazione veloce dei protagonisti con espressioni iconiche e tormentone iniziale'
  );
  const [isGeneratingIntro, setIsGeneratingIntro] = useState(false);
  const [introError, setIntroError] = useState<string | null>(null);

  // Wizard Supabase & Cloud state
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState(
    cloudConfig.remoteEndpointUrl ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      'https://afbgsinmrehzekxsrmfo.supabase.co'
  );
  const [remoteKey, setRemoteKey] = useState(
    cloudConfig.remoteApiKey ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      'sb_publishable_trNvxm7zLRCgTX_czummaw_bfmsEzTW'
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  const importInputRef = useRef<HTMLInputElement>(null);

  const resetSeriesForm = () => {
    setEditingSeriesId(null);
    setTitle('');
    setGenre('Sitcom brillante');
    setDescription('');
    setDefaultAspectRatio('9:16');
    setSelectedCastIds([]);
  };

  const handleEditSeries = (s: Series) => {
    setEditingSeriesId(s.id);
    setTitle(s.title);
    setGenre(s.genre);
    setDescription(s.description);
    setDefaultAspectRatio(s.defaultAspectRatio);
    setSelectedCastIds(s.castIds || []);
  };

  const toggleCastMember = (charId: string) => {
    setSelectedCastIds((prev) =>
      prev.includes(charId)
        ? prev.filter((id) => id !== charId)
        : [...prev, charId]
    );
  };

  const handleSubmitSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const now = new Date().toISOString();
    const existing = seriesList.find((s) => s.id === editingSeriesId);

    const seriesItem: Series = {
      id: editingSeriesId || `series-${Date.now()}`,
      title: title.trim(),
      genre: genre.trim() || 'Sitcom Social',
      description: description.trim(),
      defaultAspectRatio,
      castIds: selectedCastIds,
      intro: existing?.intro,
      draftTitle: existing?.draftTitle,
      draftLogline: existing?.draftLogline,
      draftCastIds: existing?.draftCastIds,
      draftShotCount: existing?.draftShotCount,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await onSaveSeries(seriesItem);
    onSelectSeries(seriesItem.id);
    resetSeriesForm();
  };

  // Generazione Sigla della Serie (Puntata Specifica di max 15 secondi = 1, 2 o 3 shot da 5s)
  const handleGenerateSeriesIntro = async (targetSeries: Series) => {
    setIntroError(null);
    const seriesCast = cast.filter((c) => targetSeries.castIds.includes(c.id));
    const effectiveCast = seriesCast.length > 0 ? seriesCast : cast;

    if (effectiveCast.length === 0) {
      setIntroError(
        'Aggiungi almeno un personaggio nel Cast Globale per generare la Sigla della serie.'
      );
      return;
    }

    const durationSec = targetSeries.intro?.durationSeconds || introDuration;
    const conceptText =
      targetSeries.intro?.concept ||
      introConcept ||
      'Presentazione dinamica dei personaggi della serie';
    const numShots = Math.min(3, Math.max(1, Math.round(durationSec / 5)));

    setIsGeneratingIntro(true);
    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `SIGLA UFFICIALE (${durationSec}s) - ${targetSeries.title}`,
          logline: `[SIGLA DI APERTURA SERIE TV - DURATA MASSIMA ${durationSec} SECONDI (${numShots} shot da 5s)] Serie: "${targetSeries.title}" (${targetSeries.genre}). Concept sigla: ${conceptText}. Crea una sigla memorabile, ritmata e iconica da anteporre in testa a ogni puntata.`,
          shotCount: numShots,
          cast: effectiveCast,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'Errore durante la generazione della Sigla.'
        );
      }

      const introShots: Shot[] = data.shots;
      const updatedIntro: SeriesIntro = {
        enabled: true,
        durationSeconds: durationSec,
        concept: conceptText,
        shots: introShots,
        introVideoUrl: targetSeries.intro?.introVideoUrl,
        updatedAt: new Date().toISOString(),
      };

      await onSaveSeries({
        ...targetSeries,
        intro: updatedIntro,
      });
    } catch (err: unknown) {
      setIntroError(
        err instanceof Error
          ? err.message
          : 'Errore nella generazione della Sigla.'
      );
    } finally {
      setIsGeneratingIntro(false);
    }
  };

  const handleUpdateIntroField = async (
    targetSeries: Series,
    patch: Partial<SeriesIntro>
  ) => {
    const currentIntro: SeriesIntro = targetSeries.intro || {
      enabled: true,
      durationSeconds: introDuration,
      concept: introConcept,
      shots: [],
      updatedAt: new Date().toISOString(),
    };
    const updatedIntro: SeriesIntro = {
      ...currentIntro,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await onSaveSeries({
      ...targetSeries,
      intro: updatedIntro,
    });
  };

  const handleUpdateIntroShot = async (
    targetSeries: Series,
    shotId: string,
    patch: Partial<Shot>
  ) => {
    if (!targetSeries.intro) return;
    const updatedShots = targetSeries.intro.shots.map((s) =>
      s.id === shotId ? { ...s, ...patch } : s
    );
    await handleUpdateIntroField(targetSeries, { shots: updatedShots });
  };

  const handleAttachIntroVideo = (targetSeries: Series, file: File) => {
    setIntroError(null);
    // Verifica dimensione consigliata per il payload serverless Vercel/Supabase (~4MB)
    if (file.size > 4.2 * 1024 * 1024) {
      setIntroError(
        'Il file video della Sigla supera i 4 MB. Per sincronizzarlo sul Database Cloud (Supabase) usa una clip MP4 di max 15 secondi compressa (sotto i 4 MB).'
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const mediaKey = `intro-${targetSeries.id}`;
        await saveLocalGeneratedVideo(mediaKey, reader.result);
        await handleUpdateIntroField(targetSeries, {
          enabled: true,
          introVideoUrl: reader.result,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExportJson = () => {
    const payload = {
      cast,
      series: seriesList,
      episodes,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `episodia-cloud-snapshot-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed && Array.isArray(parsed.cast)) {
          await onImportDatabaseJson({
            cast: parsed.cast || [],
            series: parsed.series || seriesList,
            episodes: parsed.episodes || [],
          });
        }
      } catch (err) {
        console.error('Errore importazione JSON:', err);
      }
    };
    reader.readAsText(file);
  };

  const handleCopySql = async () => {
    await navigator.clipboard.writeText(SUPABASE_SQL_SNIPPET);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const handleSaveAndTestSupabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSyncing(true);
    setTestResult(null);

    await onSaveCloudConfig({
      enabled: true,
      remoteEndpointUrl: remoteUrl.trim() || undefined,
      remoteApiKey: remoteKey.trim() || undefined,
      lastSyncedAt: new Date().toISOString(),
    });

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (remoteUrl.trim()) headers['x-cloud-endpoint'] = remoteUrl.trim();
      if (remoteKey.trim()) headers['x-cloud-key'] = remoteKey.trim();

      const res = await fetch('/api/studio-db', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cast, series: seriesList, episodes }),
      });

      const data = await res.json();
      if (data.cloudSynced) {
        setTestResult({
          ok: true,
          msg: 'Connessione Supabase riuscita! Tutti i dati sono sincronizzati nel Cloud.',
        });
        await onForceServerSync();
      } else {
        setTestResult({
          ok: false,
          msg: data.cloudError
            ? `Attenzione: ${data.cloudError}.`
            : 'Salvataggio locale riuscito, ma verifica Project URL e Key di Supabase.',
        });
      }
    } catch {
      setTestResult({
        ok: false,
        msg: 'Errore di rete durante il test verso Supabase.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* BANNER SERVER & SUPABASE CLOUD */}
      <div className="bg-gradient-to-r from-zinc-900 via-violet-950/30 to-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100">
                Database Cloud Multi-Dispositivo (Supabase) + File Video Locali
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {syncStatus}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-3xl leading-relaxed">
              Gestisci più Serie TV in parallelo, ognuna con la propria <strong>Sigla ufficiale (max 15s)</strong> che viene aggiunta automaticamente in testa a ogni puntata in fase di esportazione.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCloudModal(!showCloudModal)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-violet-600 hover:from-emerald-400 hover:to-violet-500 text-zinc-950 font-extrabold text-xs shadow-lg transition"
          >
            <Cloud className="w-4 h-4" />
            Impostazioni Supabase &amp; Cloud
          </button>

          <button
            type="button"
            onClick={async () => {
              setIsSyncing(true);
              await onForceServerSync();
              setIsSyncing(false);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 transition"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-amber-400 ${
                isSyncing ? 'animate-spin' : ''
              }`}
            />
            Sincronizza Ora
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 transition"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            Esporta DB
          </button>

          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 transition"
          >
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            Importa DB
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>

      {/* WIZARD GUIDATO PASSO-PASSO: SUPABASE + GITHUB + VERCEL */}
      {showCloudModal && (
        <div className="bg-zinc-900/95 border-2 border-emerald-500/50 rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">
                  Configurazione Database Supabase &amp; Sito Online
                </h4>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCloudModal(false)}
              className="text-zinc-400 hover:text-white p-1.5 rounded-lg bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Tabella SQL Supabase
                </span>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition"
                >
                  <Copy className="w-3 h-3" />
                  {copiedSql ? 'Copiato!' : 'Copia SQL'}
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-emerald-300 overflow-x-auto leading-relaxed">
                {SUPABASE_SQL_SNIPPET}
              </pre>
            </div>

            <form
              onSubmit={handleSaveAndTestSupabase}
              className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  Project URL &amp; Key Supabase
                </span>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-400 mb-1">
                    Project URL
                  </label>
                  <input
                    type="url"
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-400 mb-1">
                    API Key (publishable / anon)
                  </label>
                  <input
                    type="password"
                    value={remoteKey}
                    onChange={(e) => setRemoteKey(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
                {testResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] flex items-start gap-2 ${
                      testResult.ok
                        ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                        : 'bg-red-950/60 border-red-700 text-red-200'
                    }`}
                  >
                    <span>{testResult.msg}</span>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={isSyncing}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg transition"
              >
                {isSyncing ? 'Verifica...' : 'Salva & Sincronizza Supabase'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SE NON C'È NESSUNA SERIE (O È STATA CANCELLATA L'UNICA SERIE): SCHERMATA "CREA LA TUA PRIMA SERIE" */}
      {seriesList.length === 0 ? (
        <div className="max-w-2xl mx-auto my-6 bg-zinc-900/95 border-2 border-violet-500/40 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-amber-500 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-600/30">
              <Tv className="w-8 h-8 text-zinc-950 stroke-[2.5]" />
            </div>
            <h2 className="text-2xl font-black text-white">
              Crea la tua prima serie
            </h2>
            <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
              Inizia dando un titolo, un genere e scegliendo i personaggi ricorrenti dal tuo Cast Globale. Potrai poi generare anche la <strong>Sigla di 15 secondi</strong> e le puntate!
            </p>
          </div>

          <form onSubmit={handleSubmitSeries} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Titolo della tua Prima Serie *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Es. Vita da Cani / Coinquilini nel Caos"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Genere / Tono
                </label>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Es. Sitcom brillante"
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-xs text-zinc-100 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Formato Video Default
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDefaultAspectRatio('9:16')}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      defaultAspectRatio === '9:16'
                        ? 'bg-violet-600/25 border-violet-500 text-violet-200'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    9:16 Reels/TikTok
                  </button>
                  <button
                    type="button"
                    onClick={() => setDefaultAspectRatio('16:9')}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      defaultAspectRatio === '16:9'
                        ? 'bg-violet-600/25 border-violet-500 text-violet-200'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    16:9 Cinema
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Concept / Ambientazione della Serie
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrivi il format della serie, l'ambientazione ricorrente e lo stile comico..."
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
              />
            </div>

            {cast.length > 0 && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Seleziona i Protagonisti dal Cast Globale ({selectedCastIds.length})
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {cast.map((char) => {
                    const isSelected = selectedCastIds.includes(char.id);
                    return (
                      <button
                        key={char.id}
                        type="button"
                        onClick={() => toggleCastMember(char.id)}
                        className={`flex items-center gap-2 p-2 rounded-xl border text-left transition ${
                          isSelected
                            ? 'bg-violet-600/20 border-violet-500 text-zinc-100'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                        }`}
                      >
                        <img
                          src={char.referenceImageBase64}
                          alt={char.name}
                          className="w-8 h-8 rounded-lg object-cover shrink-0"
                        />
                        <span className="text-xs font-semibold truncate flex-1">
                          {char.name}
                        </span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-zinc-950 font-black text-sm uppercase tracking-wider shadow-xl transition flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Crea la tua prima serie
            </button>
          </form>
        </div>
      ) : (
        /* LAYOUT PRINCIPALE QUANDO ESISTE ALMENO UNA SERIE */
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* FORM CREAZIONE / MODIFICA SERIE TV */}
            <div className="xl:col-span-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                    {editingSeriesId ? (
                      <Pencil className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-zinc-100">
                      {editingSeriesId ? 'Modifica Serie TV' : 'Nuova Serie TV'}
                    </h2>
                    <p className="text-[11px] text-zinc-400">
                      Aggiungi una nuova serie in parallelo
                    </p>
                  </div>
                </div>
                {editingSeriesId && (
                  <button
                    type="button"
                    onClick={resetSeriesForm}
                    className="text-xs text-zinc-400 hover:text-white px-2.5 py-1 rounded-lg bg-zinc-800"
                  >
                    Annulla
                  </button>
                )}
              </div>

              <form onSubmit={handleSubmitSeries} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Titolo della Serie *
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Es. Vita da Cani / Coinquilini nel Caos"
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                      Genere / Tono
                    </label>
                    <input
                      type="text"
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      placeholder="Es. Sitcom ironica"
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                      Formato Default
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDefaultAspectRatio('9:16')}
                        className={`py-2 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 transition ${
                          defaultAspectRatio === '9:16'
                            ? 'bg-violet-600/25 border-violet-500 text-violet-200'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                        }`}
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        9:16
                      </button>
                      <button
                        type="button"
                        onClick={() => setDefaultAspectRatio('16:9')}
                        className={`py-2 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1 transition ${
                          defaultAspectRatio === '16:9'
                            ? 'bg-violet-600/25 border-violet-500 text-violet-200'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                        }`}
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        16:9
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Concept / Ambientazione della Serie
                  </label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrivi il format della serie, l'ambientazione ricorrente e lo stile comico..."
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500"
                  />
                </div>

                {/* ASSEGNAZIONE PERSONAGGI DAL CAST GLOBALE */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Cast Fisso di questa Serie ({selectedCastIds.length}{' '}
                    selezionati)
                  </label>
                  {cast.length === 0 ? (
                    <p className="text-xs text-zinc-500 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                      Nessun personaggio nel Cast Globale.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {cast.map((char) => {
                        const isSelected = selectedCastIds.includes(char.id);
                        return (
                          <button
                            key={char.id}
                            type="button"
                            onClick={() => toggleCastMember(char.id)}
                            className={`flex items-center gap-2 p-2 rounded-xl border text-left transition ${
                              isSelected
                                ? 'bg-violet-600/20 border-violet-500 text-zinc-100'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                            }`}
                          >
                            <img
                              src={char.referenceImageBase64}
                              alt={char.name}
                              className="w-8 h-8 rounded-lg object-cover shrink-0"
                            />
                            <span className="text-xs font-semibold truncate flex-1">
                              {char.name}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-zinc-950 font-extrabold text-xs uppercase tracking-wider shadow-lg transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {editingSeriesId
                    ? 'Salva Modifiche Serie'
                    : 'Crea Nuova Serie TV'}
                </button>
              </form>
            </div>

            {/* ELENCO DELLE SERIE TV IN PARALLELO */}
            <div className="xl:col-span-8 space-y-4">
              <div className="flex items-center justify-between bg-zinc-900/90 border border-zinc-800 rounded-2xl px-6 py-4">
                <div className="flex items-center gap-3">
                  <Tv className="w-5 h-5 text-amber-400" />
                  <div>
                    <h3 className="text-base font-bold text-zinc-100">
                      Le Tue Serie TV in Produzione ({seriesList.length})
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Puoi modificare o eliminare qualsiasi serie in qualsiasi momento
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {seriesList.map((seriesItem) => {
                  const isSelected = seriesItem.id === activeSeries?.id;
                  const seriesEpisodes = episodes.filter(
                    (ep) => ep.seriesId === seriesItem.id
                  );
                  const seriesCast = cast.filter((c) =>
                    seriesItem.castIds.includes(c.id)
                  );
                  const hasIntro =
                    seriesItem.intro &&
                    seriesItem.intro.enabled &&
                    (seriesItem.intro.shots.length > 0 ||
                      Boolean(seriesItem.intro.introVideoUrl));

                  return (
                    <div
                      key={seriesItem.id}
                      onClick={() => onSelectSeries(seriesItem.id)}
                      className={`cursor-pointer rounded-2xl border p-5 transition-all flex flex-col justify-between space-y-4 ${
                        isSelected
                          ? 'bg-zinc-900 border-violet-500 ring-2 ring-violet-500/30 shadow-2xl'
                          : 'bg-zinc-900/75 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              {isSelected && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-violet-600 text-white">
                                  Serie Attiva
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                {seriesItem.genre}
                              </span>
                              {hasIntro && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                                  <Music className="w-3 h-3" />
                                  Sigla {seriesItem.intro?.durationSeconds}s in Testa
                                </span>
                              )}
                            </div>
                            <h4 className="text-lg font-bold text-white">
                              {seriesItem.title}
                            </h4>
                          </div>

                          {/* PULSANTI MODIFICA E CANCELLA SEMPRE VISIBILI (ANCHE SE È L'UNICA SERIE) */}
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleEditSeries(seriesItem)}
                              className="p-2 rounded-lg bg-zinc-950 hover:bg-violet-600 text-zinc-400 hover:text-white border border-zinc-800 transition"
                              title="Modifica Serie"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteSeries(seriesItem.id)}
                              className="p-2 rounded-lg bg-zinc-950 hover:bg-red-600 text-zinc-400 hover:text-white border border-zinc-800 transition"
                              title="Elimina Serie"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {seriesItem.description && (
                          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                            {seriesItem.description}
                          </p>
                        )}

                        {/* Cast assegnato alla Serie */}
                        <div className="pt-2 border-t border-zinc-800/80">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-2">
                            Cast della Serie (
                            {seriesCast.length || cast.length} personaggi)
                          </span>
                          <div className="flex items-center -space-x-2 overflow-hidden">
                            {(seriesCast.length > 0 ? seriesCast : cast)
                              .slice(0, 6)
                              .map((c) => (
                                <img
                                  key={c.id}
                                  src={c.referenceImageBase64}
                                  alt={c.name}
                                  title={c.name}
                                  className="inline-block h-8 w-8 rounded-full ring-2 ring-zinc-900 object-cover"
                                />
                              ))}
                            {cast.length === 0 && (
                              <span className="text-xs text-zinc-500 italic">
                                Nessun personaggio ancora creato
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Episodi di questa Serie */}
                        <div className="pt-2 border-t border-zinc-800/80">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block mb-1.5">
                            Episodi Salvati ({seriesEpisodes.length})
                          </span>
                          {seriesEpisodes.length === 0 ? (
                            <p className="text-xs text-zinc-500">
                              Nessun episodio ancora scritto per questa serie.
                            </p>
                          ) : (
                            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                              {seriesEpisodes.slice(0, 4).map((ep) => (
                                <button
                                  key={ep.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenEpisodeInStoryboard(
                                      seriesItem.id,
                                      ep.id
                                    );
                                  }}
                                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800/80 text-left text-xs transition"
                                >
                                  <span className="font-semibold text-zinc-200 truncate">
                                    Ep. #{ep.episodeNumber} — {ep.title}
                                  </span>
                                  <span className="text-[10px] text-violet-400 shrink-0 ml-2">
                                    {ep.shots.length} shot →
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* AZIONE RAPIDA: SCRIVI NUOVO EPISODIO */}
                      <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenWritersRoomForSeries(seriesItem.id);
                          }}
                          className="w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-md"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Scrivi Episodio per &quot;{seriesItem.title}&quot;
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SEZIONE DEDICATA: SIGLA UFFICIALE DELLA SERIE ATTIVA (MAX 15 SECONDI, AGGIUNTA IN TESTA ALL'ESPORTAZIONE) */}
          {activeSeries && (
            <div className="bg-zinc-900/95 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                    <Music className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white">
                        Sigla Ufficiale della Serie: &quot;{activeSeries.title}&quot; (Max 15 Secondi)
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                        <Database className="w-3 h-3" />
                        Salva Video Sigla su Database Cloud (Uguale su ogni PC/Telefono)
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      A differenza dei video finali delle puntate (che vengono salvati solo in locale), il <strong>Video Sigla (max 15s)</strong> viene memorizzato nel <strong>Database Cloud Supabase</strong> così da essere identico e collegato automaticamente in testa a ogni video generato da qualsiasi telefono o PC!
                    </p>
                  </div>
                </div>

                {/* TOGGLE ATTIVA/DISATTIVA SIGLA IN TESTA ALL'ESPORTAZIONE */}
                <label className="flex items-center gap-2.5 cursor-pointer px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-800">
                  <input
                    type="checkbox"
                    checked={activeSeries.intro?.enabled ?? true}
                    onChange={(e) =>
                      handleUpdateIntroField(activeSeries, {
                        enabled: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-amber-500 rounded"
                  />
                  <span className="text-xs font-bold text-zinc-200">
                    Antepone la Sigla in testa a ogni Esportazione Video
                  </span>
                </label>
              </div>

              {introError && (
                <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{introError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* CONFIGURAZIONE E GENERAZIONE SIGLA (5 COL) */}
                <div className="lg:col-span-5 space-y-4 bg-zinc-950/80 border border-zinc-800 rounded-xl p-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                      1. Durata della Sigla (Max 15 Secondi)
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {([5, 10, 15] as const).map((sec) => {
                        const currentSec =
                          activeSeries.intro?.durationSeconds || introDuration;
                        return (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => {
                              setIntroDuration(sec);
                              handleUpdateIntroField(activeSeries, {
                                durationSeconds: sec,
                              });
                            }}
                            className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition flex flex-col items-center ${
                              currentSec === sec
                                ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <span>{sec} Secondi</span>
                            <span className="text-[10px] font-normal opacity-75">
                              {sec / 5} Shot da 5s
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                      2. Stile &amp; Soggetto della Sigla
                    </label>
                    <textarea
                      rows={3}
                      value={
                        activeSeries.intro?.concept !== undefined
                          ? activeSeries.intro.concept
                          : introConcept
                      }
                      onChange={(e) => {
                        setIntroConcept(e.target.value);
                        handleUpdateIntroField(activeSeries, {
                          concept: e.target.value,
                        });
                      }}
                      placeholder="Es. Sigla ritmata: i protagonisti si voltano verso la camera con un'espressione buffa e pronunciano lo slogan della serie..."
                      className="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-3 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={isGeneratingIntro}
                      onClick={() => handleGenerateSeriesIntro(activeSeries)}
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-violet-600 hover:from-amber-400 hover:to-violet-500 text-zinc-950 font-extrabold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition disabled:opacity-50"
                    >
                      {isGeneratingIntro ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generazione Sigla ({activeSeries.intro?.durationSeconds || introDuration}s) con Gemini...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4" />
                          {activeSeries.intro?.shots?.length
                            ? 'Rigenera Sceneggiatura Sigla (AI)'
                            : 'Genera Sigla con Gemini (Max 15s)'}
                        </>
                      )}
                    </button>

                    {/* Carica video master della sigla (max 15s) salvato su Database Cloud (Supabase) */}
                    <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-2">
                      <label className="w-full cursor-pointer py-2.5 px-3 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 text-xs font-bold text-emerald-200 flex items-center justify-center gap-2 transition">
                        <Upload className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          {activeSeries.intro?.introVideoUrl
                            ? 'Sostituisci Video Sigla sul Database Cloud (MP4 max 15s)'
                            : 'Carica Video Sigla su Database Cloud (MP4 max 15s)'}
                        </span>
                        <input
                          type="file"
                          accept="video/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleAttachIntroVideo(activeSeries, f);
                          }}
                        />
                      </label>
                    </div>

                    {activeSeries.intro?.introVideoUrl && (
                      <div className="pt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1">
                            <Database className="w-3 h-3" />
                            Video Sigla Salvato su Database Cloud ({activeSeries.intro.durationSeconds}s):
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateIntroField(activeSeries, {
                                introVideoUrl: undefined,
                              })
                            }
                            className="text-[10px] text-zinc-400 hover:text-red-400"
                          >
                            Rimuovi video sigla
                          </button>
                        </div>
                        <video
                          src={activeSeries.intro.introVideoUrl}
                          controls
                          className="w-full max-h-44 rounded-xl border border-emerald-500/30 bg-black object-contain"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* SHOT SEQUENZIALI DELLA SIGLA (7 COL) */}
                <div className="lg:col-span-7 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <Film className="w-4 h-4" />
                      Storyboard della Sigla ({activeSeries.intro?.shots?.length || 0} Shot • Max 15s)
                    </span>
                  </div>

                  {!activeSeries.intro?.shots ||
                  activeSeries.intro.shots.length === 0 ? (
                    <div className="p-8 rounded-xl bg-zinc-950/60 border border-dashed border-zinc-800 text-center">
                      <Play className="w-7 h-7 text-zinc-600 mx-auto mb-2" />
                      <p className="text-xs text-zinc-400">
                        Nessuna sequenza Sigla ancora generata per{' '}
                        <strong>{activeSeries.title}</strong>. Clicca su{' '}
                        <span className="text-amber-400 font-semibold">
                          Genera Sigla con Gemini (Max 15s)
                        </span>{' '}
                        a sinistra!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeSeries.intro.shots.map((shot) => (
                        <div
                          key={shot.id}
                          className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="px-2.5 py-0.5 rounded bg-amber-500 text-zinc-950 text-[11px] font-black uppercase">
                              SIGLA SHOT #{shot.shotNumber} (
                              {(shot.shotNumber - 1) * 5}s -{' '}
                              {shot.shotNumber * 5}s)
                            </span>
                            <span className="text-[11px] font-mono text-zinc-400">
                              {shot.cameraAngle}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1">
                                Battuta / Voiceover Sigla (ITA)
                              </label>
                              <textarea
                                rows={2}
                                value={shot.dialogueIta}
                                onChange={(e) =>
                                  handleUpdateIntroShot(activeSeries, shot.id, {
                                    dialogueIta: e.target.value,
                                  })
                                }
                                className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 text-xs text-zinc-100"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1">
                                Visual Prompt Sigla (EN)
                              </label>
                              <textarea
                                rows={2}
                                value={shot.visualPromptEn}
                                onChange={(e) =>
                                  handleUpdateIntroShot(activeSeries, shot.id, {
                                    visualPromptEn: e.target.value,
                                  })
                                }
                                className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 text-[11px] font-mono text-zinc-300"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
