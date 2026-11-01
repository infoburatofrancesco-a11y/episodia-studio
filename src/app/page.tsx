'use client';

import React, { useEffect, useState } from 'react';
import {
  Users,
  Clapperboard,
  Film,
  Sparkles,
  Server,
  Tv,
  ChevronRight,
  HardDrive,
  FolderKanban,
  Globe,
  X,
  QrCode,
  ExternalLink,
} from 'lucide-react';
import type {
  Character,
  Series,
  Episode,
  CloudSyncConfig,
} from '@/types/episodia';
import {
  saveCharacter,
  deleteCharacter,
  saveCast,
  saveSeries,
  deleteSeries,
  saveSeriesList,
  saveEpisode,
  deleteEpisode,
  saveEpisodes,
  pullStateFromServer,
  pushStateToServer,
  getCloudSyncConfig,
  saveCloudSyncConfig,
} from '@/lib/storage';
import CastAndAssetsView from '@/components/episodia/CastAndAssetsView';
import SeriesHubView from '@/components/episodia/SeriesHubView';
import WritersRoomView from '@/components/episodia/WritersRoomView';
import StoryboardStudioView from '@/components/episodia/StoryboardStudioView';

type StudioTab = 'cast' | 'series' | 'writers-room' | 'storyboard';

export default function EpisodiaStudioPage() {
  const [activeTab, setActiveTab] = useState<StudioTab>('series');
  const [cast, setCast] = useState<Character[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState<string>('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [cloudConfig, setCloudConfig] = useState<CloudSyncConfig>({
    enabled: true,
  });
  const [syncStatus, setSyncStatus] = useState<string>('Connesso al Server');
  const [isLoadingStorage, setIsLoadingStorage] = useState(true);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [publicTunnelUrl, setPublicTunnelUrl] = useState('');

  useEffect(() => {
    async function loadStudioData() {
      setIsLoadingStorage(true);
      try {
        const [pulled, cfg] = await Promise.all([
          pullStateFromServer(),
          getCloudSyncConfig(),
        ]);
        setCast(pulled.cast);
        setSeriesList(pulled.series);
        setEpisodes(pulled.episodes);
        setCloudConfig(cfg);

        const firstSeriesId = pulled.series[0]?.id || '';
        setActiveSeriesId(firstSeriesId);

        const firstEp = pulled.episodes.find(
          (ep) => ep.seriesId === firstSeriesId
        );
        setActiveEpisodeId(firstEp?.id ?? pulled.episodes[0]?.id ?? null);

        setSyncStatus(
          pulled.source === 'supabase-cloud' ||
            pulled.source === 'supabase-empty-ready'
            ? 'Sincronizzato Supabase Cloud'
            : pulled.source === 'cloud-remote'
            ? 'Sincronizzato Cloud Remoto'
            : 'Sincronizzato Server (/api/studio-db)'
        );
      } catch (error) {
        console.error('Errore nel caricamento iniziale:', error);
        setSyncStatus('Modalità Locale IndexedDB');
      } finally {
        setIsLoadingStorage(false);
      }
    }
    loadStudioData();
  }, []);

  const activeSeries: Series =
    seriesList.find((s) => s.id === activeSeriesId) ||
    seriesList[0] || {
      id: 'series-default-1',
      title: 'Serie Principale',
      description: 'Sitcom social in formato verticale per Reels e TikTok',
      genre: 'Sitcom brillante',
      defaultAspectRatio: '9:16',
      castIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

  const activeSeriesEpisodes = episodes.filter(
    (ep) => ep.seriesId === activeSeries.id
  );

  const activeEpisode =
    activeSeriesEpisodes.find((ep) => ep.id === activeEpisodeId) ||
    activeSeriesEpisodes[0] ||
    null;

  // Handlers Personaggi (Cast Globale)
  const handleSaveCharacter = async (character: Character) => {
    const updated = await saveCharacter(character);
    setCast(updated);
    setSyncStatus('Salvato su Server & IndexedDB');
  };

  const handleDeleteCharacter = async (id: string) => {
    const updated = await deleteCharacter(id);
    setCast(updated);
    setSyncStatus('Salvato su Server & IndexedDB');
  };

  // Handlers Serie TV in parallelo
  const handleSelectSeries = (seriesId: string) => {
    setActiveSeriesId(seriesId);
    const firstEpForSeries = episodes.find((ep) => ep.seriesId === seriesId);
    setActiveEpisodeId(firstEpForSeries?.id ?? null);
  };

  const handleSaveSeries = async (seriesItem: Series) => {
    const updated = await saveSeries(seriesItem);
    setSeriesList(updated);
    setSyncStatus('Bozza & Serie salvate su Server');
  };

  const handleDeleteSeries = async (seriesId: string) => {
    const { series: updatedSeries, episodes: updatedEpisodes } =
      await deleteSeries(seriesId);
    setSeriesList(updatedSeries);
    setEpisodes(updatedEpisodes);
    if (activeSeriesId === seriesId) {
      setActiveSeriesId(updatedSeries[0]?.id || '');
    }
    setSyncStatus('Serie aggiornata su Server');
  };

  // Handlers Episodi
  const handleEpisodeCreated = async (episode: Episode) => {
    const updated = await saveEpisode(episode);
    setEpisodes(updated);
    setActiveSeriesId(episode.seriesId);
    setActiveEpisodeId(episode.id);
    setSyncStatus('Puntata salvata su Server');
    setActiveTab('storyboard');
  };

  const handleUpdateEpisode = async (episode: Episode) => {
    const updated = await saveEpisode(episode);
    setEpisodes(updated);
    setSyncStatus('Puntata aggiornata su Server');
  };

  const handleDeleteEpisode = async (episodeId: string) => {
    const updated = await deleteEpisode(episodeId);
    setEpisodes(updated);
    if (activeEpisodeId === episodeId) {
      const remainingInSeries = updated.filter(
        (ep) => ep.seriesId === activeSeries.id
      );
      setActiveEpisodeId(remainingInSeries[0]?.id ?? null);
    }
    setSyncStatus('Episodio rimosso dal Server');
  };

  const handleForceServerSync = async () => {
    const res = await pushStateToServer();
    const pulled = await pullStateFromServer();
    setCast(pulled.cast);
    setSeriesList(pulled.series);
    setEpisodes(pulled.episodes);
    setSyncStatus(
      res.cloudSynced
        ? 'Sincronizzato Server + Cloud Remoto'
        : 'Sincronizzato col Server'
    );
  };

  const handleSaveCloudConfig = async (cfg: CloudSyncConfig) => {
    await saveCloudSyncConfig(cfg);
    setCloudConfig(cfg);
  };

  const handleImportDatabaseJson = async (payload: {
    cast: Character[];
    series: Series[];
    episodes: Episode[];
  }) => {
    await saveCast(payload.cast);
    await saveSeriesList(payload.series);
    await saveEpisodes(payload.episodes);
    setCast(payload.cast);
    setSeriesList(payload.series);
    setEpisodes(payload.episodes);
    if (payload.series[0]) {
      setActiveSeriesId(payload.series[0].id);
    }
    setSyncStatus('Database importato e sincronizzato su Server');
  };

  const navItems: Array<{
    id: StudioTab;
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    {
      id: 'cast',
      label: '1. Cast Globale & Asset',
      sublabel: 'Tutti i personaggi riutilizzabili',
      icon: Users,
      badge: cast.length,
    },
    {
      id: 'series',
      label: '2. Serie TV in Parallelo',
      sublabel: 'Gestione multi-serie & Cloud Sync',
      icon: FolderKanban,
      badge: seriesList.length,
    },
    {
      id: 'writers-room',
      label: "3. Writer's Room",
      sublabel: `Sceneggiatura: ${activeSeries.title}`,
      icon: Clapperboard,
      badge: activeSeriesEpisodes.length,
    },
    {
      id: 'storyboard',
      label: '4. Storyboard & Studio',
      sublabel: 'Editor 5s & Video Locali',
      icon: Film,
      badge: activeEpisode ? activeEpisode.shots.length : undefined,
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* TOP HEADER CINEMATOGRAFICO */}
      <header className="min-h-16 py-2 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-30 px-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-amber-500 flex items-center justify-center shadow-lg shadow-violet-600/20">
            <Tv className="w-5 h-5 text-zinc-950 stroke-[2.5]" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xl font-black tracking-tight text-white">
              EPISODIA
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-violet-600/20 text-violet-300 border border-violet-500/40 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              AI Series Studio
            </span>
          </div>
        </div>

        {/* SELETTORE RAPIDO SERIE ATTIVA + ACCESSO REMOTO OVUNQUE + STATO SERVER */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {seriesList.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-violet-500/40">
              <Tv className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-zinc-400">Serie Attiva:</span>
              <select
                value={activeSeries.id}
                onChange={(e) => handleSelectSeries(e.target.value)}
                className="bg-transparent font-bold text-white focus:outline-none"
              >
                {seriesList.map((s) => (
                  <option key={s.id} value={s.id} className="bg-zinc-900">
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowRemoteModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600/25 hover:bg-violet-600/40 border border-violet-500/50 text-violet-200 font-semibold transition"
          >
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            <span>Accesso da Telefono / Altri PC (4G/5G)</span>
          </button>

          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-zinc-300">
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            <strong className="text-emerald-300">{syncStatus}</strong>
          </div>

          <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-zinc-300">
            <HardDrive className="w-3.5 h-3.5 text-amber-400" />
            <span>Video:</span>
            <strong className="text-amber-300">Solo Locale</strong>
          </div>
        </div>
      </header>

      {/* MODALE ACCESSO DA TELEFONI / PC NON SULLA STESSA WIFI */}
      {showRemoteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <Globe className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">
                  Come accedere da Telefono (4G/5G) o da PC su altre reti
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRemoteModal(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-zinc-300 leading-relaxed">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                <h4 className="font-bold text-violet-300 text-sm">
                  Modalità 1 — Link Pubblico HTTPS istantaneo (4G/5G dal Telefono o altro PC)
                </h4>
                <p className="text-zinc-400">
                  Quando il server gira su questo PC, un tunnel pubblico HTTPS espone la porta <code className="text-amber-300">3005</code> su Internet senza bisogno di essere sulla stessa Wi-Fi. Tutti i personaggi, serie, titoli e trame sono letti direttamente da <code className="text-amber-300">data/episodia-db.json</code>.
                </p>
                <div className="pt-2">
                  <label className="block text-[11px] font-bold uppercase text-zinc-500 mb-1">
                    Incolla qui il tuo URL Tunnel Pubblico per generare il QR Code:
                  </label>
                  <input
                    type="url"
                    value={publicTunnelUrl}
                    onChange={(e) => setPublicTunnelUrl(e.target.value)}
                    placeholder="Es. https://episodia-studio.loca.lt oppure https://xxxx.lhr.life"
                    className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                {publicTunnelUrl.trim() && (
                  <div className="pt-3 flex items-center gap-4">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                        publicTunnelUrl.trim()
                      )}`}
                      alt="QR Code Accesso Remoto"
                      className="w-28 h-28 rounded-xl bg-white p-2"
                    />
                    <div className="space-y-2">
                      <p className="text-xs text-emerald-300 font-semibold flex items-center gap-1">
                        <QrCode className="w-4 h-4" />
                        Inquadra con la fotocamera del telefono (anche in 4G/5G)!
                      </p>
                      <a
                        href={publicTunnelUrl.trim()}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-amber-400 hover:underline font-mono text-xs"
                      >
                        {publicTunnelUrl.trim()}
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                <h4 className="font-bold text-amber-300 text-sm">
                  Modalità 2 — Cloud Database Sempre Attivo (anche a PC spento)
                </h4>
                <p className="text-zinc-400">
                  Se apri l&apos;app su due PC diversi (o la pubblichi gratis su <strong>Vercel / Netlify</strong>), vai nella tab <strong>2. Serie TV in Parallelo → Configura Cloud Remoto</strong> e incolla l&apos;URL di un database gratuito (es. Firebase Realtime Database <code className="text-zinc-200">https://tuo-progetto.firebasedatabase.app/episodia.json</code>). Tutte le serie, i personaggi, i titoli e le trame si sincronizzano via Internet in tempo reale!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAIN STUDIO WORKSPACE CON SIDEBAR LATERALE */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* SIDEBAR DI NAVIGAZIONE */}
        <aside className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-zinc-800 bg-zinc-900/50 p-4 flex flex-col justify-between shrink-0">
          <div className="space-y-2">
            <div className="px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Hub di Produzione Multi-Serie
              </p>
            </div>

            <nav className="space-y-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                      isActive
                        ? 'bg-violet-600/20 border-violet-500 text-white shadow-lg shadow-violet-950/50'
                        : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition ${
                          isActive
                            ? 'bg-violet-600 text-white'
                            : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold leading-tight truncate">
                          {item.label}
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                          {item.sublabel}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {item.badge !== undefined && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            isActive
                              ? 'bg-amber-500 text-zinc-950'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight
                        className={`w-4 h-4 transition-transform ${
                          isActive
                            ? 'text-amber-400 translate-x-0.5'
                            : 'text-zinc-600'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* RIEPILOGO STATO PROGETTO IN BASSO NELLA SIDEBAR */}
          <div className="hidden lg:block mt-8 p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Cast Globale</span>
              <span className="font-bold text-violet-400">
                {cast.length} personaggi
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Serie in Parallelo</span>
              <span className="font-bold text-amber-400">
                {seriesList.length} serie
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Episodi Totali</span>
              <span className="font-bold text-emerald-400">
                {episodes.length} episodi
              </span>
            </div>
            <div className="pt-2 border-t border-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                Serie Selezionata
              </span>
              <p className="text-xs font-bold text-white truncate mt-0.5">
                {activeSeries.title}
              </p>
              {activeEpisode && (
                <p className="text-[11px] text-amber-400 truncate mt-0.5">
                  Ep. #{activeEpisode.episodeNumber}: {activeEpisode.title}
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* AREA CONTENUTO PRINCIPALE */}
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {isLoadingStorage ? (
            <div className="h-96 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <div className="w-10 h-10 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
              <p className="text-xs font-medium">
                Sincronizzazione Cast Globale e Serie TV dal Server...
              </p>
            </div>
          ) : (
            <>
              {activeTab === 'cast' && (
                <CastAndAssetsView
                  cast={cast}
                  onSaveCharacter={handleSaveCharacter}
                  onDeleteCharacter={handleDeleteCharacter}
                />
              )}

              {activeTab === 'series' && (
                <SeriesHubView
                  seriesList={seriesList}
                  activeSeriesId={activeSeries.id}
                  cast={cast}
                  episodes={episodes}
                  cloudConfig={cloudConfig}
                  syncStatus={syncStatus}
                  onSelectSeries={handleSelectSeries}
                  onSaveSeries={handleSaveSeries}
                  onDeleteSeries={handleDeleteSeries}
                  onOpenWritersRoomForSeries={(seriesId) => {
                    handleSelectSeries(seriesId);
                    setActiveTab('writers-room');
                  }}
                  onOpenEpisodeInStoryboard={(seriesId, episodeId) => {
                    setActiveSeriesId(seriesId);
                    setActiveEpisodeId(episodeId);
                    setActiveTab('storyboard');
                  }}
                  onSaveCloudConfig={handleSaveCloudConfig}
                  onForceServerSync={handleForceServerSync}
                  onImportDatabaseJson={handleImportDatabaseJson}
                />
              )}

              {activeTab === 'writers-room' && (
                <WritersRoomView
                  cast={cast}
                  seriesList={seriesList}
                  activeSeries={activeSeries}
                  episodes={episodes}
                  activeEpisodeId={activeEpisode?.id ?? null}
                  onSelectSeries={handleSelectSeries}
                  onSaveSeriesDraft={handleSaveSeries}
                  onEpisodeCreated={handleEpisodeCreated}
                  onUpdateEpisode={handleUpdateEpisode}
                  onSelectEpisode={(id) => {
                    setActiveEpisodeId(id);
                    setActiveTab('storyboard');
                  }}
                  onDeleteEpisode={handleDeleteEpisode}
                  onGoToCast={() => setActiveTab('cast')}
                />
              )}

              {activeTab === 'storyboard' && (
                <StoryboardStudioView
                  seriesList={seriesList}
                  activeSeries={activeSeries}
                  episodes={episodes}
                  activeEpisode={activeEpisode}
                  cast={cast}
                  onSelectSeries={handleSelectSeries}
                  onSelectEpisode={(id) => setActiveEpisodeId(id)}
                  onUpdateEpisode={handleUpdateEpisode}
                  onGoToWritersRoom={() => setActiveTab('writers-room')}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
