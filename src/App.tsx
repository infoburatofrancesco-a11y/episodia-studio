import React, { useEffect, useState } from 'react';
import {
  Users,
  Film,
  Settings,
  Check,
  ArrowLeft,
  Trash2
} from 'lucide-react';
import {
  Series,
  Episode,
  CastMember,
  IntroOutroConfig,
  ApiKeysConfig
} from './types/studio';
import { DEFAULT_SERIES, DEFAULT_EPISODE, DEFAULT_CAST } from './data/defaultStudioData';
import {
  loadAllSeries,
  saveSeries,
  deleteSeriesFromStorage,
  loadApiKeys,
  saveApiKeys,
  getActiveSeriesId,
  setActiveSeriesId,
  exportStudioBackupFile,
  importStudioBackupFile
} from './services/storageService';
import {
  generateStoryboardAndScriptWithGemini,
  generateAllScenesParallel,
  balanceSceneDurationsToExactTarget,
  ensureSitcomPunchyLine,
  getCharacterSitcomRoleBadge
} from './services/aiService';
import { CastModal } from './components/CastModal';
import { BrandingModal } from './components/BrandingModal';
import { ServicesGuideModal } from './components/ServicesGuideModal';
import { ConfirmDialogModal, ConfirmDialogState } from './components/ConfirmDialogModal';
import { SeriesDashboard } from './components/SeriesDashboard';
import { SeriesDetailView } from './components/SeriesDetailView';
import { Step1DurationAndMaterial } from './components/Step1DurationAndMaterial';
import { Step2StoryboardComic } from './components/Step2StoryboardComic';
import { Step3PlayerAndExport } from './components/Step3PlayerAndExport';

type AppViewMode = 'ALL_SERIES' | 'SERIES_HUB' | 'EPISODE_WIZARD';

export function App() {
  const [seriesList, setSeriesList] = useState<Series[]>(() => {
    try {
      if (localStorage.getItem('skysketch_deleted_default_series_v1') === 'true') {
        return [];
      }
    } catch {}
    return [DEFAULT_SERIES];
  });
  const [activeSeriesId, setActiveSeriesIdState] = useState<string>(() => {
    try {
      if (localStorage.getItem('skysketch_deleted_default_series_v1') === 'true') {
        return '';
      }
    } catch {}
    return DEFAULT_SERIES.id;
  });
  const [activeEpisodeId, setActiveEpisodeId] = useState<string>(DEFAULT_EPISODE.id);
  const [viewMode, setViewMode] = useState<AppViewMode>('ALL_SERIES');
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  const [apiKeys, setApiKeys] = useState<ApiKeysConfig>(() => loadApiKeys());

  // Modals state
  const [isCastModalOpen, setIsCastModalOpen] = useState(false);
  const [isBrandingModalOpen, setIsBrandingModalOpen] = useState(false);
  const [isServicesModalOpen, setIsServicesModalOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  // Async processing states
  const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
  const [isMountingAll, setIsMountingAll] = useState(false);

  useEffect(() => {
    loadAllSeries().then((loaded) => {
      const migrated = loaded.map((s) => {
        const isDefaultVdcSeries =
          s.id === DEFAULT_SERIES.id ||
          s.title.toLowerCase().includes('vita da cani') ||
          s.title.includes('Casa Francesco & Golden');

        if (!isDefaultVdcSeries) {
          // Autonomous user-created series (e.g. "Bestemmia Atelier"): NEVER inject Vita da Cani characters, intro, or episodes!
          // Also sanitize any previously contaminated scene lines so they belong 100% to this series and its own cast.
          const ownCast = s.cast.filter((c) => c.id !== 'cast-cristina');
          const sanitizedEpisodes = s.episodes
            .filter((ep) => ep.id !== DEFAULT_EPISODE.id)
            .map((ep) => ({
              ...ep,
              scenes: ep.scenes.map((sc, idx) => {
                const charObj = ownCast.find((c) => c.id === sc.characterId) || ownCast[0];
                if (!charObj) return sc;
                const cleanLine = ensureSitcomPunchyLine(
                  sc.dialogueOrThought,
                  charObj,
                  idx + 1,
                  ep.rawIdea || ep.title,
                  s.title
                );
                const lineChanged = cleanLine !== sc.dialogueOrThought;
                const cleanedTurns = sc.dialogueTurns?.map((t, tIdx) => {
                  const turnSpeaker = ownCast.find((c) => c.id === t.characterId) || charObj;
                  return {
                    ...t,
                    dialogueOrThought: ensureSitcomPunchyLine(
                      t.dialogueOrThought,
                      turnSpeaker,
                      idx + tIdx + 1,
                      ep.rawIdea || ep.title,
                      s.title
                    )
                  };
                });
                return {
                  ...sc,
                  characterId: charObj.id,
                  dialogueOrThought: cleanLine,
                  dialogueTurns: cleanedTurns,
                  generatedAudioUrl: lineChanged ? undefined : sc.generatedAudioUrl,
                  characterRoleBadge: getCharacterSitcomRoleBadge(charObj, s.title)
                };
              })
            }));

          const finalAutonomousEpisodes = sanitizedEpisodes.length > 0 ? sanitizedEpisodes : [
            {
              id: `ep-${s.id}-1`,
              episodeNumber: 1,
              title: 'Puntata #1 — Il Debutto',
              rawIdea: `Primo episodio della serie "${s.title}".`,
              targetTotalDurationSec: 60,
              netContentDurationSec: 50,
              detectedCastIds: ownCast.map((c) => c.id),
              funnyRolesByCastId: {},
              uploadedMedia: [],
              scenes: ownCast.map((c, idx) => ({
                id: `scene-${Date.now()}-${idx}`,
                order: idx + 1,
                sceneType: 'AI_PHOTO_VIDEO' as const,
                characterId: c.id,
                durationSec: Math.floor(50 / Math.max(1, ownCast.length)),
                dialogueOrThought: `Benvenuti in ${s.title}!`,
                aiPhotoSourceUrl: c.referencePhotos?.[0] || '',
                status: 'READY' as const
              }))
            }
          ];

          const updatedAutonomousSeries: Series = {
            ...s,
            cast: ownCast,
            episodes: finalAutonomousEpisodes
          };
          saveSeries(updatedAutonomousSeries);
          return updatedAutonomousSeries;
        }

        // Default "Vita da Cani" series migration only
        const hasCristina = s.cast.some((c) => c.name.toLowerCase().includes('cristina'));
        const cristinaDefault = DEFAULT_CAST.find((c) => c.id === 'cast-cristina');
        const nextCast =
          !hasCristina && cristinaDefault ? [...s.cast, cristinaDefault] : s.cast;

        const isLegacyDefaultTitle =
          s.title.includes('Casa Francesco & Golden') || !s.title.trim();
        const hasNoIntroMedia =
          !s.branding.introBgVideoOrImage &&
          (!s.branding.introMediaItems || s.branding.introMediaItems.length === 0);

        const nextBranding: IntroOutroConfig = hasNoIntroMedia
          ? {
              ...s.branding,
              introEnabled: true,
              introDurationSec: 8.0,
              introBgVideoOrImage: './videos/vita_da_cani_intro.mp4',
              introBgMediaType: 'VIDEO',
              introBgFileName: 'vita_da_cani_intro.mp4',
              introMediaItems: [
                {
                  id: 'intro-vdc-video',
                  url: './videos/vita_da_cani_intro.mp4',
                  type: 'VIDEO',
                  fileName: 'vita_da_cani_intro.mp4'
                }
              ],
              introShowEpisodeBadge: false,
              introShowCastAvatars: false
            }
          : s.branding;

        const cleanedEpisodes = s.episodes.map((ep) => ({
          ...ep,
          scenes: ep.scenes.map((sc, idx) => {
            const charObj = nextCast.find((c) => c.id === sc.characterId) || nextCast[0];
            const cleanLine = ensureSitcomPunchyLine(
              sc.dialogueOrThought,
              charObj,
              idx + 1,
              ep.rawIdea,
              'Vita da Cani'
            );
            return {
              ...sc,
              dialogueOrThought: cleanLine,
              characterRoleBadge:
                sc.characterRoleBadge || getCharacterSitcomRoleBadge(charObj, 'Vita da Cani'),
              useOriginalVideoAudio:
                sc.sceneType === 'USER_VIDEO'
                  ? sc.useOriginalVideoAudio ?? Boolean(sc.userVideoBlobUrl?.includes('vita_da_cani_'))
                  : undefined
            };
          })
        }));

        const hasVdcEpisode = cleanedEpisodes.some((ep) => ep.id === DEFAULT_EPISODE.id);
        const finalEpisodes = hasVdcEpisode
          ? cleanedEpisodes
          : [DEFAULT_EPISODE, ...cleanedEpisodes];

        const updatedSeries: Series = {
          ...s,
          title: isLegacyDefaultTitle ? 'Vita da Cani' : s.title,
          cast: nextCast,
          branding: nextBranding,
          episodes: finalEpisodes
        };
        saveSeries(updatedSeries);
        return updatedSeries;
      });

      setSeriesList(migrated);
      const savedActiveId = getActiveSeriesId();
      const targetSeries = migrated.find((s) => s.id === savedActiveId) || migrated[0];
      if (targetSeries) {
        setActiveSeriesIdState(targetSeries.id);
        if (targetSeries.episodes[0]) {
          setActiveEpisodeId(targetSeries.episodes[0].id);
        }
      }
    });
  }, []);

  const isDefaultDeleted =
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('skysketch_deleted_default_series_v1') === 'true';

  const EMPTY_SERIES_PLACEHOLDER: Series = {
    id: 'series-empty-placeholder',
    title: 'Nessuna Serie Presente',
    description: 'Crea una nuova serie personalizzata con i tuoi personaggi e le tue storie!',
    genreStyle: 'COMEDY',
    cast: [],
    branding: {
      introEnabled: false,
      introDurationSec: 3.0,
      introThemeColor: '#0284c7',
      introShowEpisodeBadge: true,
      introShowCastAvatars: true,
      outroEnabled: false,
      outroDurationSec: 4.0,
      outroShowCastCards: true,
      autoListDetectedCast: true,
      aiFunnyRoles: true,
      footerText: '🎬 Serie Originale creata con SkySketch Studio!'
    },
    episodes: []
  };

  const activeSeries: Series =
    (seriesList.length > 0
      ? seriesList.find((s) => s.id === activeSeriesId) || seriesList[0]
      : null) || EMPTY_SERIES_PLACEHOLDER;

  const activeEpisode: Episode =
    (activeSeries && activeSeries.id !== 'series-empty-placeholder'
      ? activeSeries.episodes?.find((ep) => ep.id === activeEpisodeId) ||
        activeSeries.episodes?.[0]
      : null) || {
        id: 'ep-empty-placeholder',
        episodeNumber: 1,
        title: 'Nuova Puntata',
        rawIdea: '',
        targetTotalDurationSec: 60,
        netContentDurationSec: 50,
        detectedCastIds: [],
        funnyRolesByCastId: {},
        uploadedMedia: [],
        scenes: []
      };

  const updateActiveSeries = (updater: (prev: Series) => Series) => {
    setSeriesList((prevList) =>
      prevList.map((s) => {
        if (s.id !== activeSeries.id) return s;
        const updated = updater(s);
        saveSeries(updated);
        return updated;
      })
    );
  };

  const updateActiveEpisode = (patch: Partial<Episode>) => {
    updateActiveSeries((series) => {
      const episodes = series.episodes || [];
      const targetId = activeEpisode.id || activeEpisodeId;
      const epIndex = episodes.findIndex((ep) => ep.id === targetId);
      if (epIndex >= 0) {
        const nextEpisodes = [...episodes];
        nextEpisodes[epIndex] = { ...nextEpisodes[epIndex], ...patch };
        return {
          ...series,
          episodes: nextEpisodes
        };
      }
      // Safe upsert if episode was missing or orphaned
      const newEp: Episode = {
        ...activeEpisode,
        ...patch,
        id: targetId || `ep-${series.id}-${Date.now()}`
      };
      if (activeEpisodeId !== newEp.id) {
        setActiveEpisodeId(newEp.id);
      }
      return {
        ...series,
        episodes: episodes.length > 0 ? [newEp, ...episodes.slice(1)] : [newEp]
      };
    });
  };

  const handleSelectSeriesFromDashboard = (seriesId: string) => {
    setActiveSeriesIdState(seriesId);
    setActiveSeriesId(seriesId);
    const target = seriesList.find((s) => s.id === seriesId);
    if (target && target.episodes[0]) {
      setActiveEpisodeId(target.episodes[0].id);
    }
    setViewMode('SERIES_HUB');
  };

  const handleCreateNewSeriesProject = (newSeries: Series) => {
    setSeriesList((prev) => [...prev, newSeries]);
    saveSeries(newSeries);
    setActiveSeriesIdState(newSeries.id);
    setActiveSeriesId(newSeries.id);
    if (newSeries.episodes[0]) {
      setActiveEpisodeId(newSeries.episodes[0].id);
    }
    setViewMode('SERIES_HUB');
  };

  const executeDeleteSeriesProject = (seriesId: string) => {
    try {
      localStorage.setItem('skysketch_deleted_default_series_v1', 'true');
    } catch {}
    const filtered = seriesList.filter((s) => s.id !== seriesId);
    setSeriesList(filtered);
    deleteSeriesFromStorage(seriesId);
    if (filtered.length > 0) {
      setActiveSeriesIdState(filtered[0].id);
      setActiveSeriesId(filtered[0].id);
      if (filtered[0].episodes && filtered[0].episodes[0]) {
        setActiveEpisodeId(filtered[0].episodes[0].id);
      } else {
        setActiveEpisodeId('');
      }
    } else {
      setActiveSeriesIdState('');
      setActiveSeriesId('');
      setActiveEpisodeId('');
    }
    setViewMode('ALL_SERIES');
  };

  const handleDeleteSeriesProject = (seriesId: string) => {
    const target = seriesList.find((s) => s.id === seriesId);
    setConfirmDialog({
      isOpen: true,
      title: 'Eliminare questa Serie TV?',
      message:
        'Stai per eliminare definitivamente questa serie, inclusi il suo Cast e tutte le puntate al suo interno:',
      itemHighlight: `📺 ${target?.title || 'Serie selezionata'} (${
        target?.episodes.length || 0
      } puntate)`,
      confirmLabel: 'Sì, Elimina Serie',
      cancelLabel: 'Annulla',
      variant: 'danger',
      onConfirm: () => executeDeleteSeriesProject(seriesId)
    });
  };

  const handleCreateNewEpisode = () => {
    const maxEpNum = activeSeries.episodes.reduce(
      (max, ep) => Math.max(max, ep.episodeNumber),
      0
    );
    const nextEpNum = maxEpNum + 1;
    const introSec = activeSeries.branding.introEnabled
      ? activeSeries.branding.introDurationSec
      : 0;
    const outroSec = activeSeries.branding.outroEnabled
      ? activeSeries.branding.outroDurationSec
      : 0;
    const netSec = Math.max(10, Math.round(60 - introSec - outroSec));

    const newEp: Episode = {
      id: `ep-${Date.now()}`,
      episodeNumber: nextEpNum,
      title: `Puntata #${nextEpNum} — Nuovo Sketch`,
      rawIdea: '',
      targetTotalDurationSec: 60,
      netContentDurationSec: netSec,
      detectedCastIds: activeSeries.cast.map((c) => c.id),
      funnyRolesByCastId: {},
      uploadedMedia: [],
      scenes: activeSeries.cast.map((c, idx) => ({
        id: `scene-${Date.now()}-${idx}`,
        order: idx + 1,
        sceneType: 'AI_PHOTO_VIDEO',
        characterId: c.id,
        durationSec: Math.max(4, Math.floor(netSec / Math.max(1, activeSeries.cast.length))),
        dialogueOrThought:
          c.type === 'ANIMAL'
            ? `Pensiero segreto di ${c.name} nella puntata ${nextEpNum}!`
            : `Battuta di ${c.name} nella puntata ${nextEpNum}!`,
        aiPhotoSourceUrl:
          c.referencePhotos.find((p) => !p.startsWith('data:image/svg+xml')) ||
          c.referencePhotos[0] ||
          '',
        veoMotionPrompt: 'Expressive character reaction in 9:16',
        status: 'READY'
      }))
    };

    balanceSceneDurationsToExactTarget(newEp.scenes, netSec);

    updateActiveSeries((s) => ({
      ...s,
      episodes: [...s.episodes, newEp]
    }));
    setActiveEpisodeId(newEp.id);
    setCurrentStep(1);
    setViewMode('EPISODE_WIZARD');
  };

  const executeDeleteEpisode = (epId: string) => {
    const remaining = activeSeries.episodes.filter((e) => e.id !== epId);
    updateActiveSeries((s) => ({ ...s, episodes: remaining }));
    if (activeEpisodeId === epId) {
      if (remaining[0]) {
        setActiveEpisodeId(remaining[0].id);
      }
      if (viewMode === 'EPISODE_WIZARD') {
        setViewMode('SERIES_HUB');
      }
    }
  };

  const handleDeleteEpisode = (epId: string) => {
    const targetEp = activeSeries.episodes.find((e) => e.id === epId);
    setConfirmDialog({
      isOpen: true,
      title: 'Eliminare questa Puntata?',
      message: 'Vuoi davvero eliminare questa puntata e il relativo storyboard?',
      itemHighlight: `🎬 Puntata #${targetEp?.episodeNumber || ''} — ${
        targetEp?.title || 'Puntata selezionata'
      }`,
      confirmLabel: 'Sì, Elimina Puntata',
      cancelLabel: 'Annulla',
      variant: 'danger',
      onConfirm: () => executeDeleteEpisode(epId)
    });
  };

  const handleSaveCast = (newCast: CastMember[]) => {
    updateActiveSeries((s) => ({
      ...s,
      cast: newCast,
      episodes: s.episodes.map((ep) => ({
        ...ep,
        scenes: ep.scenes.map((sc) => {
          const updatedChar = newCast.find((c) => c.id === sc.characterId) || newCast[0];
          if (!updatedChar) return sc;
          const oldChar = s.cast.find((c) => c.id === sc.characterId);
          const bestRealPhoto =
            updatedChar.referencePhotos.find((p) => !p.startsWith('data:image/svg+xml')) ||
            updatedChar.referencePhotos[0] ||
            '';
          const photoChanged =
            oldChar?.referencePhotos?.[0] !== updatedChar.referencePhotos?.[0] ||
            (Boolean(sc.aiPhotoSourceUrl?.startsWith('data:image/svg+xml')) &&
              Boolean(bestRealPhoto) &&
              !bestRealPhoto.startsWith('data:image/svg+xml'));

          return {
            ...sc,
            aiPhotoSourceUrl:
              !sc.aiPhotoSourceUrl ||
              sc.aiPhotoSourceUrl.startsWith('data:image/svg+xml') ||
              photoChanged
                ? bestRealPhoto
                : sc.aiPhotoSourceUrl,
            generatedAiImageUrl: photoChanged ? undefined : sc.generatedAiImageUrl,
            // Invalidate cached scene voice so newly sampled/modified character voices are generated!
            generatedAudioUrl: undefined,
            status: 'READY' as const
          };
        })
      }))
    }));
  };

  const handleSaveBranding = (newBranding: IntroOutroConfig) => {
    const introSec = newBranding.introEnabled ? newBranding.introDurationSec : 0;
    const outroSec = newBranding.outroEnabled ? newBranding.outroDurationSec : 0;

    updateActiveSeries((s) => ({
      ...s,
      branding: newBranding,
      episodes: s.episodes.map((ep) => {
        const netSec = Math.max(5, Math.round(ep.targetTotalDurationSec - introSec - outroSec));
        const clonedScenes = ep.scenes.map((sc) => ({ ...sc }));
        balanceSceneDurationsToExactTarget(clonedScenes, netSec);
        return {
          ...ep,
          netContentDurationSec: netSec,
          scenes: clonedScenes
        };
      })
    }));
  };

  const handleSaveApiKeys = (newKeys: ApiKeysConfig) => {
    setApiKeys(newKeys);
    saveApiKeys(newKeys);
  };

  const handleChangeTargetDuration = (newTargetSec: number) => {
    const introSec = activeSeries.branding.introEnabled
      ? activeSeries.branding.introDurationSec
      : 0;
    const outroSec = activeSeries.branding.outroEnabled
      ? activeSeries.branding.outroDurationSec
      : 0;
    const netSec = Math.max(5, Math.round(newTargetSec - introSec - outroSec));
    const clonedScenes = activeEpisode.scenes.map((sc) => ({ ...sc }));
    balanceSceneDurationsToExactTarget(clonedScenes, netSec);

    updateActiveEpisode({
      targetTotalDurationSec: newTargetSec,
      netContentDurationSec: netSec,
      scenes: clonedScenes
    });
  };

  const handleGenerateStoryboard = async () => {
    setIsGeneratingStoryboard(true);
    try {
      const result = await generateStoryboardAndScriptWithGemini({
        seriesTitle: activeSeries.title,
        seriesDescription: activeSeries.description,
        episodeTitle: activeEpisode.title,
        rawIdea: activeEpisode.rawIdea,
        targetTotalDurationSec: activeEpisode.targetTotalDurationSec,
        branding: activeSeries.branding,
        cast: activeSeries.cast,
        uploadedMedia: activeEpisode.uploadedMedia,
        apiKeys,
        seriesGenreStyle: activeSeries.genreStyle,
        seriesCustomStylePrompt: activeSeries.customStylePrompt
      });

      const introSec = activeSeries.branding.introEnabled
        ? activeSeries.branding.introDurationSec
        : 0;
      const outroSec = activeSeries.branding.outroEnabled
        ? activeSeries.branding.outroDurationSec
        : 0;
      const netSec = Math.max(
        5,
        Math.round(activeEpisode.targetTotalDurationSec - introSec - outroSec)
      );

      updateActiveEpisode({
        title: result.title || activeEpisode.title,
        detectedCastIds: result.detectedCastIds,
        funnyRolesByCastId: result.funnyRolesByCastId,
        netContentDurationSec: netSec,
        scenes: result.scenes
      });

      setCurrentStep(2);
    } finally {
      setIsGeneratingStoryboard(false);
    }
  };

  const handleConfirmAndMountAll = async () => {
    setIsMountingAll(true);
    try {
      const generatedScenes = await generateAllScenesParallel({
        scenes: activeEpisode.scenes,
        cast: activeSeries.cast,
        seriesTitle: activeSeries.title,
        episodeTitle: activeEpisode.title,
        rawIdea: activeEpisode.rawIdea,
        apiKeys
      });

      const usedCastIds = Array.from(new Set(generatedScenes.map((s) => s.characterId)));

      const updatedCast = activeSeries.cast.map((member) => {
        if (!usedCastIds.includes(member.id)) return member;
        const memberLine = generatedScenes.find((s) => s.characterId === member.id)
          ?.dialogueOrThought;
        if (!memberLine) return member;
        return {
          ...member,
          memoryGags: [...member.memoryGags.slice(-4), memberLine.slice(0, 80)]
        };
      });

      updateActiveSeries((s) => ({
        ...s,
        cast: updatedCast,
        episodes: s.episodes.map((ep) =>
          ep.id === activeEpisode.id
            ? {
                ...ep,
                detectedCastIds: usedCastIds,
                scenes: generatedScenes
              }
            : ep
        )
      }));

      setCurrentStep(3);
    } finally {
      setIsMountingAll(false);
    }
  };

  return (
    <div className="min-h-screen bg-sky-50 text-slate-800 flex flex-col">
      {/* HEADER SUPERIORE COMPATTO (NON-STICKY SU TELEFONO PER LASCIARE 100% SCHERMO AL FUMETTO) */}
      <header className="md:sticky md:top-0 z-30 bg-white/95 backdrop-blur-md border-b-2 border-sky-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          {/* Logo + Breadcrumb Gerarchico Compatto */}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div
              onClick={() => setViewMode('ALL_SERIES')}
              className="flex items-center gap-2 cursor-pointer group flex-shrink-0"
            >
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white text-xl shadow-sm group-hover:scale-105 transition">
                ☁️
              </div>
              <div className="hidden xs:block sm:block">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-800 leading-none">
                  SkySketch
                </h1>
                <span className="text-[10px] font-bold text-sky-600 uppercase tracking-wider block">
                  Studio 9:16
                </span>
              </div>
            </div>

            {/* 3 Pulsanti di Navigazione Livello su 1 sola riga compatta */}
            <div className="flex items-center gap-1 bg-sky-50 p-1 rounded-xl border border-sky-200 overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setViewMode('ALL_SERIES')}
                className={`px-2.5 py-1.5 rounded-lg font-extrabold text-xs transition whitespace-nowrap ${
                  viewMode === 'ALL_SERIES'
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'text-sky-900 hover:bg-sky-100'
                }`}
              >
                📺 Serie ({seriesList.length})
              </button>

              {viewMode !== 'ALL_SERIES' &&
                seriesList.length > 0 &&
                activeSeries.id !== 'series-empty-placeholder' && (
                  <>
                    <span className="text-sky-400 font-black text-xs">›</span>

                    <button
                      type="button"
                      onClick={() => setViewMode('SERIES_HUB')}
                      className={`px-2.5 py-1.5 rounded-lg font-extrabold text-xs transition truncate max-w-[115px] sm:max-w-[200px] ${
                        viewMode === 'SERIES_HUB'
                          ? 'bg-sky-500 text-white shadow-xs'
                          : 'text-sky-900 hover:bg-sky-100'
                      }`}
                    >
                      📁 {activeSeries.title}
                    </button>

                    {viewMode === 'EPISODE_WIZARD' && (
                      <>
                        <span className="text-sky-400 font-black text-xs">›</span>

                        <button
                          type="button"
                          onClick={() => setViewMode('EPISODE_WIZARD')}
                          className="px-2.5 py-1.5 rounded-lg font-extrabold text-xs transition whitespace-nowrap bg-sky-500 text-white shadow-xs"
                        >
                          🎬 Ep. #{activeEpisode.episodeNumber}
                        </button>
                      </>
                    )}
                  </>
                )}
            </div>
          </div>

          {/* Pulsanti Azione Rapida Contestuali */}
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-1.5">
              {viewMode !== 'ALL_SERIES' && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsCastModalOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-sky-100 text-sky-900 hover:bg-sky-200 font-extrabold text-xs transition"
                  >
                    <Users className="w-3.5 h-3.5 text-sky-600" />
                    <span>👥 Cast ({activeSeries.cast.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsBrandingModalOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700 font-extrabold text-xs shadow-xs transition"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>
                      🎬 Sigla & Coda ({activeSeries.branding.introDurationSec}s+
                      {activeSeries.branding.outroDurationSec}s)
                    </span>
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsServicesModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-xs"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>⚙️ AI</span>
            </button>
          </div>
        </div>

        {/* Sotto-barra Step 1 / 2 / 3 + Sigla & Coda compatta per Telefono e PC */}
        {viewMode === 'EPISODE_WIZARD' && (
          <div className="bg-sky-100/90 border-t border-sky-200">
            <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setViewMode('SERIES_HUB')}
                  className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-sky-50 text-sky-900 border border-sky-200 font-extrabold text-xs inline-flex items-center gap-1"
                  title="Torna a tutte le puntate della serie"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Puntate</span>
                </button>

                {[
                  {
                    step: 1 as const,
                    shortTitle: '① Durata & Media',
                    fullTitle: '① Durata, Materiale & Musica'
                  },
                  {
                    step: 2 as const,
                    shortTitle: `② Fumetto (${activeEpisode.scenes.length})`,
                    fullTitle: `② Il Fumetto (${activeEpisode.scenes.length} Scene)`
                  },
                  {
                    step: 3 as const,
                    shortTitle: '③ Video MP4',
                    fullTitle: '③ Guarda e Scarica MP4'
                  }
                ].map((item) => {
                  const isActive = currentStep === item.step;
                  const isDone = currentStep > item.step;
                  return (
                    <button
                      key={item.step}
                      type="button"
                      onClick={() => setCurrentStep(item.step)}
                      className={`flex items-center gap-1 px-2.5 sm:px-3.5 py-1.5 rounded-xl font-extrabold text-xs transition ${
                        isActive
                          ? 'bg-sky-500 text-white shadow-xs'
                          : isDone
                          ? 'bg-white text-sky-900 border border-sky-300'
                          : 'bg-white/70 text-slate-600 hover:bg-white'
                      }`}
                    >
                      {isDone && <Check className="w-3 h-3 text-emerald-600" />}
                      <span className="sm:hidden">{item.shortTitle}</span>
                      <span className="hidden sm:inline">{item.fullTitle}</span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setIsBrandingModalOpen(true)}
                  className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs inline-flex items-center gap-1 shadow-xs transition"
                  title="Apri la sezione dedicata per creare Sigla Iniziale e Titoli di Coda con Video, Foto, Audio e Testi indipendenti"
                >
                  🎬 Sigla & Coda
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteEpisode(activeEpisode.id)}
                  className="ml-auto sm:ml-1 inline-flex items-center gap-1 px-2 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-extrabold text-xs transition"
                  title="Elimina questa Puntata"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Elimina Puntata</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* AREA PRINCIPALE CHIARA: 1 SOLA SCHERMATA ALLA VOLTA */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* LIVELLO 1: DASHBOARD DI TUTTE LE SERIE / PROGETTI */}
        {viewMode === 'ALL_SERIES' && (
          <SeriesDashboard
            seriesList={seriesList}
            onSelectSeries={handleSelectSeriesFromDashboard}
            onCreateSeries={handleCreateNewSeriesProject}
            onDeleteSeries={handleDeleteSeriesProject}
            onExportBackup={() => exportStudioBackupFile(seriesList)}
            onImportBackup={async (file) => {
              const imported = await importStudioBackupFile(file);
              if (imported) {
                setSeriesList(imported);
                setActiveSeriesIdState(imported[0].id);
              }
            }}
          />
        )}

        {/* LIVELLO 2: PAGINA DELLA SINGOLA SERIE (CAST + SIGLA + ELENCO PUNTATE) */}
        {viewMode === 'SERIES_HUB' && (
          <SeriesDetailView
            series={activeSeries}
            onBackToAllSeries={() => setViewMode('ALL_SERIES')}
            onOpenCastModal={() => setIsCastModalOpen(true)}
            onOpenBrandingModal={() => setIsBrandingModalOpen(true)}
            onSelectEpisodeToEdit={(epId, step = 1) => {
              setActiveEpisodeId(epId);
              setCurrentStep(step);
              setViewMode('EPISODE_WIZARD');
            }}
            onCreateNewEpisode={handleCreateNewEpisode}
            onDeleteEpisode={handleDeleteEpisode}
            onDeleteCurrentSeries={() => handleDeleteSeriesProject(activeSeries.id)}
            onUpdateSeriesMeta={(newTitle, newDesc, newGenreStyle, newCustomStylePrompt) =>
              updateActiveSeries((s) => ({
                ...s,
                title: newTitle,
                description: newDesc,
                genreStyle: newGenreStyle ?? s.genreStyle,
                customStylePrompt: newCustomStylePrompt ?? s.customStylePrompt
              }))
            }
          />
        )}

        {/* LIVELLO 3: WIZARD DELLA SINGOLA PUNTATA (STEP 1, 2, 3) */}
        {viewMode === 'EPISODE_WIZARD' && currentStep === 1 && (
          <Step1DurationAndMaterial
            seriesTitle={activeSeries.title}
            seriesDescription={activeSeries.description}
            seriesGenreStyle={activeSeries.genreStyle}
            seriesCustomStylePrompt={activeSeries.customStylePrompt}
            apiKeys={apiKeys}
            episodeTitle={activeEpisode.title}
            onChangeEpisodeTitle={(title) => updateActiveEpisode({ title })}
            targetTotalDurationSec={activeEpisode.targetTotalDurationSec}
            onChangeTargetDuration={handleChangeTargetDuration}
            branding={activeSeries.branding}
            onOpenBrandingModal={() => setIsBrandingModalOpen(true)}
            cast={activeSeries.cast}
            uploadedMedia={activeEpisode.uploadedMedia || []}
            onChangeUploadedMedia={(items) => updateActiveEpisode({ uploadedMedia: items })}
            backgroundMusic={activeEpisode.backgroundMusic}
            onChangeBackgroundMusic={(bgm) => updateActiveEpisode({ backgroundMusic: bgm })}
            rawIdea={activeEpisode.rawIdea}
            onChangeRawIdea={(idea) => updateActiveEpisode({ rawIdea: idea })}
            onGenerateStoryboard={handleGenerateStoryboard}
            isGeneratingStoryboard={isGeneratingStoryboard}
          />
        )}

        {viewMode === 'EPISODE_WIZARD' && currentStep === 2 && (
          <Step2StoryboardComic
            seriesTitle={activeSeries.title}
            episodeTitle={activeEpisode.title}
            onChangeEpisodeTitle={(title) => updateActiveEpisode({ title })}
            rawIdea={activeEpisode.rawIdea}
            targetTotalDurationSec={activeEpisode.targetTotalDurationSec}
            branding={activeSeries.branding}
            onOpenBrandingModal={() => setIsBrandingModalOpen(true)}
            cast={activeSeries.cast}
            scenes={activeEpisode.scenes}
            onChangeScenes={(scenes) => updateActiveEpisode({ scenes })}
            apiKeys={apiKeys}
            onBackToStep1={() => setCurrentStep(1)}
            onConfirmAndMountAll={handleConfirmAndMountAll}
            isMountingAll={isMountingAll}
          />
        )}

        {viewMode === 'EPISODE_WIZARD' && currentStep === 3 && (
          <Step3PlayerAndExport
            seriesTitle={activeSeries.title}
            episodeNumber={activeEpisode.episodeNumber}
            episodeTitle={activeEpisode.title}
            targetTotalDurationSec={activeEpisode.targetTotalDurationSec}
            branding={activeSeries.branding}
            cast={activeSeries.cast}
            scenes={activeEpisode.scenes}
            detectedCastIds={activeEpisode.detectedCastIds}
            funnyRolesByCastId={activeEpisode.funnyRolesByCastId || {}}
            backgroundMusic={activeEpisode.backgroundMusic}
            onBackToStep2={() => setCurrentStep(2)}
          />
        )}
      </main>

      {/* MODALS */}
      <CastModal
        isOpen={isCastModalOpen}
        onClose={() => setIsCastModalOpen(false)}
        cast={activeSeries.cast}
        apiKeys={apiKeys}
        onSaveCast={handleSaveCast}
      />

      <BrandingModal
        isOpen={isBrandingModalOpen}
        onClose={() => setIsBrandingModalOpen(false)}
        seriesTitle={activeSeries.title}
        branding={activeSeries.branding}
        onSaveBranding={handleSaveBranding}
      />

      <ServicesGuideModal
        isOpen={isServicesModalOpen}
        onClose={() => setIsServicesModalOpen(false)}
        apiKeys={apiKeys}
        onSaveApiKeys={handleSaveApiKeys}
      />

      <ConfirmDialogModal
        dialog={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />
    </div>
  );
}

export default App;
