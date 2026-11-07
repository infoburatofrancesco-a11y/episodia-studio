'use client';

import React, { useState } from 'react';
import {
  Film,
  Mic,
  MicOff,
  Camera,
  Sparkles,
  CheckCircle2,
  Clock,
  Volume2,
  Smartphone,
  Monitor,
  Play,
  RefreshCw,
  Plus,
  AlertTriangle,
  Wand2,
  HardDrive,
  Download,
  Upload,
  Tv,
  Users,
  Check,
  Loader2,
  Music,
  FileVideo,
  X,
} from 'lucide-react';
import type { Character, Series, Episode, Shot } from '@/types/episodia';
import { saveLocalGeneratedVideo } from '@/lib/storage';
import {
  renderShotVideoDataUrl,
  stitchVideoClipsIntoSingleVideo,
  unlockSharedAudioContext,
  normalizeVideoDataUrl,
  downloadVideoDataUrlAsBinaryFile,
  compressImageForApi,
} from '@/lib/videoRenderer';

function fixWebmDurationOnLoad(e: React.SyntheticEvent<HTMLVideoElement>) {
  const el = e.currentTarget;
  if (el.currentTime === 0) {
    try {
      el.currentTime = 0.05;
    } catch {
      // ignore seek error if not ready
    }
  }
  if (el.paused && el.autoplay) {
    el.play().catch(() => {});
  }
}

interface StoryboardStudioViewProps {
  seriesList: Series[];
  activeSeries: Series | null;
  episodes: Episode[];
  activeEpisode: Episode | null;
  cast: Character[];
  onSelectSeries: (seriesId: string) => void;
  onSelectEpisode: (episodeId: string) => void;
  onUpdateEpisode: (updatedEpisode: Episode) => Promise<void>;
  onGoToWritersRoom: () => void;
  onGoToSeriesHub: () => void;
}

const CAMERA_PRESETS = [
  'Medium selfie shot, handheld camera',
  'Close-up reaction shot, shallow depth of field',
  'Two-shot over the shoulder, dynamic framing',
  'Wide shot in room, cinematic sitcom lighting',
  'Extreme close-up on eyes and facial expression',
];

function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

export default function StoryboardStudioView({
  seriesList,
  activeSeries,
  episodes,
  activeEpisode,
  cast,
  onSelectSeries,
  onSelectEpisode,
  onUpdateEpisode,
  onGoToWritersRoom,
  onGoToSeriesHub,
}: StoryboardStudioViewProps) {
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>(
    activeSeries?.defaultAspectRatio || '9:16'
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [step2NoticeShotId, setStep2NoticeShotId] = useState<string | null>(
    null
  );
  const [regeneratingShotId, setRegeneratingShotId] = useState<string | null>(
    null
  );
  const [renderingVideoShotId, setRenderingVideoShotId] = useState<
    string | null
  >(null);
  const [shotProgressText, setShotProgressText] = useState<string>('');
  const [shotRenderError, setShotRenderError] = useState<string | null>(null);
  const [isStitchingFinalVideo, setIsStitchingFinalVideo] = useState(false);
  const [stitchStatus, setStitchStatus] = useState<string | null>(null);
  const [mergedEpisodePreviewUrl, setMergedEpisodePreviewUrl] = useState<
    string | null
  >(null);
  const [isRegeneratingWholeEpisode, setIsRegeneratingWholeEpisode] =
    useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [currentPlaylistIdx, setCurrentPlaylistIdx] = useState(0);
  const [veoApiKey, setVeoApiKey] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('episodia_veo_api_key') || '';
    }
    return '';
  });

  const handleSaveVeoApiKey = (val: string) => {
    setVeoApiKey(val);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('episodia_veo_api_key', val.trim());
    }
  };

  if (!activeSeries || seriesList.length === 0) {
    return (
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-12 text-center max-w-2xl mx-auto my-8">
        <div className="w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center mx-auto mb-4 text-violet-400">
          <Tv className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-zinc-100 mb-2">
          Crea la tua prima serie
        </h2>
        <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
          Non hai ancora nessuna serie attiva. Crea prima una serie TV per configurare la sigla e gli episodi.
        </p>
        <button
          type="button"
          onClick={onGoToSeriesHub}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold shadow-lg transition"
        >
          <Plus className="w-4 h-4" />
          Crea la tua prima serie
        </button>
      </div>
    );
  }

  const seriesEpisodes = episodes.filter(
    (ep) => ep.seriesId === activeSeries.id
  );

  if (!activeEpisode) {
    return (
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-12 text-center max-w-2xl mx-auto my-8">
        <div className="w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center mx-auto mb-4 text-violet-400">
          <Film className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-zinc-100 mb-2">
          Nessun Episodio Attivo per &quot;{activeSeries.title}&quot;
        </h2>
        <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
          Genera o salva una nuova puntata nella{' '}
          <strong className="text-zinc-200">Writer&apos;s Room</strong> per la serie{' '}
          <strong className="text-amber-400">{activeSeries.title}</strong>.
        </p>
        <button
          type="button"
          onClick={onGoToWritersRoom}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold shadow-lg shadow-violet-600/25 transition"
        >
          <Wand2 className="w-4 h-4" />
          Vai alla Writer&apos;s Room
        </button>
      </div>
    );
  }

  const castMap = new Map<string, Character>(cast.map((c) => [c.id, c]));

  const hasActiveIntro = Boolean(
    activeSeries.intro &&
      activeSeries.intro.enabled &&
      (activeSeries.intro.shots.length > 0 ||
        Boolean(activeSeries.intro.introVideoUrl))
  );

  const introDurationOffset = hasActiveIntro
    ? Math.min(15, activeSeries.intro?.durationSeconds || 15)
    : 0;

  const totalEpisodeDurationWithIntro =
    introDurationOffset + activeEpisode.shots.length * 10;

  const markSaved = () => {
    setLastSavedAt(
      new Date().toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  };

  const handleEpisodeMetadataChange = async (patch: Partial<Episode>) => {
    const updatedEpisode: Episode = {
      ...activeEpisode,
      ...patch,
    };
    await onUpdateEpisode(updatedEpisode);
    markSaved();
  };

  const toggleEpisodeCastMember = async (charId: string) => {
    const exists = activeEpisode.selectedCastIds.includes(charId);
    const nextIds = exists
      ? activeEpisode.selectedCastIds.filter((id) => id !== charId)
      : [...activeEpisode.selectedCastIds, charId];
    await handleEpisodeMetadataChange({ selectedCastIds: nextIds });
  };

  const handleShotChange = async (shotId: string, patch: Partial<Shot>) => {
    const updatedShots = activeEpisode.shots.map((s) =>
      s.id === shotId ? { ...s, ...patch } : s
    );
    const updatedEpisode: Episode = {
      ...activeEpisode,
      shots: updatedShots,
    };
    await onUpdateEpisode(updatedEpisode);
    markSaved();
  };

  const handleRegenerateSingleShot = async (shot: Shot) => {
    setRegeneratingShotId(shot.id);
    try {
      const response = await fetch('/api/regenerate-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeTitle: activeEpisode.title,
          episodeLogline: activeEpisode.logline,
          shot,
          allShots: activeEpisode.shots,
          cast,
        }),
      });
      const data = await response.json();
      if (response.ok && data.shot) {
        await handleShotChange(shot.id, {
          cameraAngle: data.shot.cameraAngle,
          visualPromptEn: data.shot.visualPromptEn,
          speakerId: data.shot.speakerId,
          dialogueIta: data.shot.dialogueIta,
        });
      }
    } catch (err) {
      console.error('Errore rigenerazione shot:', err);
    } finally {
      setRegeneratingShotId(null);
    }
  };

  const handleRegenerateWholeEpisode = async () => {
    const epCast = cast.filter((c) =>
      activeEpisode.selectedCastIds.includes(c.id)
    );
    const effectiveCast = epCast.length > 0 ? epCast : cast;
    if (effectiveCast.length === 0) return;

    setIsRegeneratingWholeEpisode(true);
    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${activeSeries.title} - ${activeEpisode.title}`,
          logline: `[Serie: ${activeSeries.title} (${activeSeries.genre})] Situazione episodio: ${activeEpisode.logline}`,
          shotCount: activeEpisode.shots.length || 4,
          cast: effectiveCast,
        }),
      });
      const data = await response.json();
      if (response.ok && Array.isArray(data.shots)) {
        await handleEpisodeMetadataChange({ shots: data.shots });
      }
    } catch (err) {
      console.error('Errore rigenerazione episodio:', err);
    } finally {
      setIsRegeneratingWholeEpisode(false);
    }
  };

  const handleAttachLocalVideoFile = (shot: Shot, file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        await saveLocalGeneratedVideo(shot.id, reader.result);
        await handleShotChange(shot.id, {
          videoUrl: reader.result,
          localMediaKey: shot.id,
          status: 'ready',
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadLocalVideo = (shot: Shot) => {
    if (!shot.videoUrl) return;
    downloadVideoDataUrlAsBinaryFile(
      shot.videoUrl,
      `${activeSeries.title.replace(/\s+/g, '_')}_Ep${activeEpisode.episodeNumber}_Shot${shot.shotNumber}.webm`
    );
  };

  // Genera la clip video di 10s per un singolo Shot dell'episodio e la salva SOLO in locale
  const handleGenerateShotVideoLocal = async (shot: Shot): Promise<string | null> => {
    unlockSharedAudioContext();
    setRenderingVideoShotId(shot.id);
    setShotRenderError(null);
    setShotProgressText('Passo 1/3: Nano Banana sta generando Scena + Voce AI...');
    try {
      await handleShotChange(shot.id, { status: 'generating', duration: 10 });

      const speaker = shot.speakerId ? castMap.get(shot.speakerId) : null;
      const shotChars = shot.characterIds
        .map((id) => castMap.get(id))
        .filter((c): c is Character => Boolean(c));
      const effectiveChars = shotChars.length > 0 ? shotChars : cast;

      // Mettiamo SEMPRE il personaggio che parla per primo così Nano Banana blocca la sua identità 1:1
      const orderedChars = speaker
        ? [speaker, ...effectiveChars.filter((c) => c.id !== speaker.id)]
        : effectiveChars;

      const rawRefList: string[] = [];
      const photoLabels: string[] = [];
      for (const c of orderedChars.slice(0, 3)) {
        const primaryPhoto =
          c.referenceImagesBase64?.[0] || c.referenceImageBase64;
        if (primaryPhoto && rawRefList.length < 4) {
          rawRefList.push(primaryPhoto);
          photoLabels.push(`Photo ${rawRefList.length} (${c.name})`);
        }
        // Aggiungiamo anche una seconda angolazione di ogni personaggio presente nello shot (fino a 4 foto totali)
        if (
          c.referenceImagesBase64 &&
          c.referenceImagesBase64.length > 1 &&
          rawRefList.length < 4
        ) {
          rawRefList.push(c.referenceImagesBase64[1]);
          photoLabels.push(`Photo ${rawRefList.length} (${c.name} angle 2)`);
        }
      }

      const compressedRefs = await Promise.all(
        rawRefList.slice(0, 4).map((img) => compressImageForApi(img, 768))
      );
      const rawRefPhoto = rawRefList[0] || cast[0]?.referenceImageBase64;

      // MODALITÀ 1: GOOGLE VEO 3.1 NATIVO ("Ingredients to Video" come nell'app Gemini Web)
      // Si attiva non appena è presente una chiave Google AI Studio (AIzaSy...)
      if (veoApiKey.trim().startsWith('AIza')) {
        try {
          setShotProgressText(
            'Avvio Google Veo 3.1 (Ingredients to Video con foto attori)...'
          );
          const veoStartRes = await fetch('/api/generate-veo-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'start',
              customApiKey: veoApiKey.trim(),
              visualPromptEn: shot.visualPromptEn,
              dialogueIta: shot.dialogueIta,
              speakerName: speaker?.name,
              characterNames: orderedChars.map((c) => c.name),
              aspectRatio,
              referenceImagesBase64: compressedRefs,
            }),
          });

          if (veoStartRes.ok) {
            const veoStartData = await veoStartRes.json();
            if (veoStartData.ok && veoStartData.operationName) {
              for (let attempt = 1; attempt <= 28; attempt++) {
                setShotProgressText(
                  `Google Veo 3.1 sta generando il video animato reale (${attempt * 5}s)...`
                );
                await new Promise((r) => setTimeout(r, 5000));
                const pollRes = await fetch('/api/generate-veo-video', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'poll',
                    operationName: veoStartData.operationName,
                    customApiKey: veoApiKey.trim(),
                  }),
                });
                const pollData = await pollRes.json();
                if (pollData.done && pollData.videoDataUrl) {
                  await saveLocalGeneratedVideo(shot.id, pollData.videoDataUrl);
                  await handleShotChange(shot.id, {
                    videoUrl: pollData.videoDataUrl,
                    localMediaKey: shot.id,
                    duration: 10,
                    status: 'ready',
                  });
                  setMergedEpisodePreviewUrl(null);
                  return pollData.videoDataUrl;
                }
                if (pollData.done && pollData.error) {
                  console.warn(
                    'Veo 3.1 poll error, fallback Nano Banana Pro:',
                    pollData.error
                  );
                  break;
                }
              }
            }
          }
        } catch (veoErr) {
          console.warn('Fallback da Veo 3.1 a Nano Banana Pro:', veoErr);
        }
      }

      // MODALITÀ 2 (Con chiave AQ.Ab8RN...): Nano Banana Pro (Fedeltà 1:1 alle foto) + Multi-Speaker TTS Italiano
      setShotProgressText(
        'Passo 1/3: Nano Banana Pro sta creando la scena 1:1 dalle tue foto + Dialogo Italiano...'
      );
      const mediaRes = await fetch('/api/generate-shot-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'base',
          visualPromptEn: shot.visualPromptEn,
          cameraAngle: shot.cameraAngle,
          dialogueIta: shot.dialogueIta,
          speakerName: speaker?.name,
          speakerDescriptor: speaker?.visualDescriptor,
          speakerCategory: speaker?.category || 'human',
          characterNames: orderedChars.map((c) => c.name),
          photoLabels,
          aspectRatio,
          referenceImagesBase64: compressedRefs,
          shotNumber: shot.shotNumber,
        }),
      });

      const rawText = await mediaRes.text();
      let mediaData: {
        frameImageBase64?: string | null;
        framesBase64?: string[];
        audioWavBase64?: string | null;
        isGrid2x2?: boolean;
        error?: string;
      } = {};
      try {
        mediaData = JSON.parse(rawText);
      } catch {
        throw new Error(
          `Il server ha impiegato troppo tempo a rispondere (${mediaRes.status}). Riprova tra un istante.`
        );
      }

      if (!mediaRes.ok) {
        throw new Error(mediaData.error || 'Errore API Nano Banana.');
      }

      const frame1 =
        mediaData.frameImageBase64 ||
        rawRefPhoto ||
        cast[0]?.referenceImageBase64;

      if (!frame1) {
        throw new Error('Nessuna immagine disponibile per generare la clip.');
      }

      const isGrid2x2 = Boolean(
        mediaData.isGrid2x2 ?? mediaData.frameImageBase64
      );
      const framesList: string[] = [frame1];

      // CHIAMATA 2 (In parallelo): Genera le 2 Griglie 2x2 dei Visemi Labiali ("Ah" aperto + "Oh"/"Eh" semi-aperto)
      // su tutte le 4 pose fisiche consecutive per avere movimento completo di corpo/mani + lip-sync 30fps!
      try {
        setShotProgressText(
          'Passo 2/3: Generazione pose articolazione vocale in-place sulle 4 pose del personaggio...'
        );
        const compressedBase = await compressImageForApi(frame1, 1024);
        const [openRes, midRes] = await Promise.all([
          fetch('/api/generate-shot-media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step: 'variant',
              variantType: 'speaking_open',
              baseFrameBase64: compressedBase,
              visualPromptEn: shot.visualPromptEn,
              speakerName: speaker?.name,
              characterNames: orderedChars.map((c) => c.name),
              aspectRatio,
            }),
          }).catch(() => null),
          fetch('/api/generate-shot-media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step: 'variant',
              variantType: 'speaking_mid',
              baseFrameBase64: compressedBase,
              visualPromptEn: shot.visualPromptEn,
              speakerName: speaker?.name,
              characterNames: orderedChars.map((c) => c.name),
              aspectRatio,
            }),
          }).catch(() => null),
        ]);

        if (openRes && openRes.ok) {
          const openJson = await openRes.json().catch(() => ({}));
          if (openJson.frameImageBase64) {
            framesList.push(openJson.frameImageBase64);
          }
        }
        if (midRes && midRes.ok) {
          const midJson = await midRes.json().catch(() => ({}));
          if (midJson.frameImageBase64) {
            framesList.push(midJson.frameImageBase64);
          }
        }
      } catch (varErr) {
        console.warn('Fallback da visemi 2x2:', varErr);
      }

      setShotProgressText(
        'Passo 3/3: Sincronizzazione 4 Pose Movimento + Lip-Sync Voce Italiana (0%)...'
      );

      const clipDataUrl = await renderShotVideoDataUrl({
        frameImageBase64: frame1,
        framesBase64: framesList,
        isGrid2x2,
        audioWavBase64: mediaData.audioWavBase64,
        dialogueIta: shot.dialogueIta,
        speakerName: speaker?.name,
        shotLabel: `EP. #${activeEpisode.episodeNumber} • SHOT #${shot.shotNumber}`,
        durationSeconds: 10,
        aspectRatio,
        compactForCloud: false,
        onProgress: (pct) => {
          setShotProgressText(
            `Passo 3/3: Registrazione Video Animato 10s (${pct}%)...`
          );
        },
      });

      await saveLocalGeneratedVideo(shot.id, clipDataUrl);
      await handleShotChange(shot.id, {
        videoUrl: clipDataUrl,
        localMediaKey: shot.id,
        duration: 10,
        status: 'ready',
      });
      setMergedEpisodePreviewUrl(null);
      return clipDataUrl;
    } catch (err) {
      console.error('Errore generazione clip shot locale:', err);
      setShotRenderError(
        err instanceof Error
          ? err.message
          : 'Errore imprevisto durante la generazione della clip.'
      );
      await handleShotChange(shot.id, { status: 'draft' });
      return null;
    } finally {
      setRenderingVideoShotId(null);
      setShotProgressText('');
    }
  };

  // Genera gli shot con Nano Banana, prepara l'ANTEPRIMA VIDEO COMPLETA NELL'APP
  // e, quando richiesto (downloadImmediately = true), unisce e scarica il file unico!
  const handleRenderAndMergeCompleteLocalVideo = async (
    downloadImmediately = false
  ) => {
    unlockSharedAudioContext();
    setIsStitchingFinalVideo(true);
    try {
      const clipsToMerge: string[] = [];

      // 1. Se la serie ha il Video Sigla sul Database Cloud, lo mettiamo in TESTA (0s - 15s)!
      if (hasActiveIntro && activeSeries.intro?.introVideoUrl) {
        clipsToMerge.push(activeSeries.intro.introVideoUrl);
      } else if (
        hasActiveIntro &&
        activeSeries.intro?.shots &&
        activeSeries.intro.shots.some((s) => s.videoUrl)
      ) {
        activeSeries.intro.shots.forEach((s) => {
          if (s.videoUrl) clipsToMerge.push(s.videoUrl);
        });
      }

      // 2. Per ogni Shot della puntata, usa la clip locale valida (10s) o generala con Nano Banana
      const updatedShots = [...activeEpisode.shots];
      const allAlreadyHaveClips = updatedShots.every(
        (s) => s.videoUrl && s.videoUrl.length > 20000 && s.duration === 10
      );

      for (let i = 0; i < updatedShots.length; i++) {
        const s = updatedShots[i];
        let clipUrl: string | undefined | null = s.videoUrl;
        // Se non c'è una clip valida da 10s (>20KB) oppure l'utente ha cliccato "Genera Video" per rigenerare
        if (
          !clipUrl ||
          clipUrl.length < 20000 ||
          s.duration !== 10 ||
          (!downloadImmediately && allAlreadyHaveClips)
        ) {
          setStitchStatus(
            `Nano Banana AI: Generazione pose movimento + voce Shot #${s.shotNumber}/${updatedShots.length} (10s)...`
          );
          clipUrl = await handleGenerateShotVideoLocal(s);
          if (clipUrl) {
            updatedShots[i] = {
              ...s,
              videoUrl: clipUrl,
              localMediaKey: s.id,
              duration: 10,
              status: 'ready',
            };
          }
        }
        if (clipUrl) {
          clipsToMerge.push(clipUrl);
        }
      }

      await onUpdateEpisode({
        ...activeEpisode,
        shots: updatedShots,
      });

      setCurrentPlaylistIdx(0);

      if (!downloadImmediately || clipsToMerge.length === 0) {
        return;
      }

      setStitchStatus(
        hasActiveIntro && activeSeries.intro?.introVideoUrl
          ? `Esportazione file unico: Sigla Cloud (${introDurationOffset}s in testa) + Puntata...`
          : 'Esportazione file video finale unico...'
      );

      const mergedFinalVideoUrl = await stitchVideoClipsIntoSingleVideo(
        clipsToMerge,
        aspectRatio,
        false
      );

      const finalKey = `final-ep-${activeEpisode.id}`;
      await saveLocalGeneratedVideo(finalKey, mergedFinalVideoUrl);

      downloadVideoDataUrlAsBinaryFile(
        mergedFinalVideoUrl,
        `${activeSeries.title.replace(/\s+/g, '_')}_Ep${activeEpisode.episodeNumber}_COMPLETO_CON_SIGLA.webm`
      );
    } catch (err) {
      console.error('Errore unione video finale con sigla:', err);
    } finally {
      setIsStitchingFinalVideo(false);
      setStitchStatus(null);
    }
  };

  const handleDownloadMergedPreviewVideo = () => {
    if (!mergedEpisodePreviewUrl) return;
    downloadVideoDataUrlAsBinaryFile(
      mergedEpisodePreviewUrl,
      `${activeSeries.title.replace(/\s+/g, '_')}_Ep${activeEpisode.episodeNumber}_COMPLETO_CON_SIGLA.webm`
    );
  };

  // Costruisce la timeline completa di esportazione con la Sigla (max 15s) in testa + gli Shot dell'episodio
  const handleExportCompleteEpisodePackage = () => {
    const exportTimeline = {
      seriesTitle: activeSeries.title,
      episodeNumber: activeEpisode.episodeNumber,
      episodeTitle: activeEpisode.title,
      logline: activeEpisode.logline,
      aspectRatio,
      prependedIntro: hasActiveIntro
        ? {
            includedInHead: true,
            maxDurationSeconds: introDurationOffset,
            timecode: `00:00 - 00:${String(introDurationOffset).padStart(2, '0')}`,
            concept: activeSeries.intro?.concept,
            hasMasterIntroVideo: Boolean(activeSeries.intro?.introVideoUrl),
            introShots: activeSeries.intro?.shots || [],
          }
        : null,
      episodeShots: activeEpisode.shots.map((s) => ({
        ...s,
        startTimeSeconds: introDurationOffset + (s.shotNumber - 1) * 10,
        endTimeSeconds: introDurationOffset + s.shotNumber * 10,
      })),
      totalDurationSeconds: totalEpisodeDurationWithIntro,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportTimeline, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSeries.title.replace(/\s+/g, '_')}_Ep${activeEpisode.episodeNumber}_Master_Con_Sigla.json`;
    a.click();
    URL.revokeObjectURL(url);

    // Se sono presenti anche clip video (Sigla in testa + Shot), scarica in sequenza partendo dalla Sigla!
    if (hasActiveIntro && activeSeries.intro?.introVideoUrl) {
      downloadVideoDataUrlAsBinaryFile(
        activeSeries.intro.introVideoUrl,
        `00_SIGLA_IN_TESTA_${introDurationOffset}s_${activeSeries.title.replace(/\s+/g, '_')}.webm`
      );
    }
    activeEpisode.shots.forEach((shot) => {
      if (shot.videoUrl) {
        downloadVideoDataUrlAsBinaryFile(
          shot.videoUrl,
          `${String(shot.shotNumber).padStart(2, '0')}_Shot_${shot.shotNumber}_Ep${activeEpisode.episodeNumber}.webm`
        );
      }
    });
  };

  const toggleCharInShot = async (shot: Shot, charId: string) => {
    const exists = shot.characterIds.includes(charId);
    let nextIds: string[];
    if (exists) {
      if (shot.characterIds.length <= 1) return;
      nextIds = shot.characterIds.filter((id) => id !== charId);
    } else {
      nextIds = [...shot.characterIds, charId];
    }
    const nextSpeaker =
      shot.speakerId && !nextIds.includes(shot.speakerId)
        ? nextIds[0] || null
        : shot.speakerId;

    await handleShotChange(shot.id, {
      characterIds: nextIds,
      speakerId: nextSpeaker,
    });
  };

  const injectVisualDescriptorsIntoPrompt = async (shot: Shot) => {
    const descriptorsBlock = shot.characterIds
      .map((id) => castMap.get(id))
      .filter((c): c is Character => Boolean(c))
      .map((c) => `[${c.name}: ${c.visualDescriptor}]`)
      .join(' ');

    const speaker = shot.speakerId ? castMap.get(shot.speakerId) : null;
    const actionSuffix = speaker
      ? `${speaker.name} is speaking expressively to the camera.`
      : 'Characters react naturally in the scene.';

    const updatedPrompt = `${shot.cameraAngle}. ${descriptorsBlock}. ${actionSuffix}`;
    await handleShotChange(shot.id, { visualPromptEn: updatedPrompt });
  };

  // Playlist per il Player Master (Sigla 15s in testa + Shot episodio)
  const playableClips: Array<{
    label: string;
    videoUrl: string;
    subtitle: string;
  }> = [];
  if (
    hasActiveIntro &&
    activeSeries.intro?.introVideoUrl &&
    activeSeries.intro.introVideoUrl.length > 20000
  ) {
    playableClips.push({
      label: `SIGLA IN TESTA (0s - ${introDurationOffset}s)`,
      videoUrl: normalizeVideoDataUrl(activeSeries.intro.introVideoUrl),
      subtitle: activeSeries.intro.concept || `Sigla ${activeSeries.title}`,
    });
  }
  activeEpisode.shots.forEach((s) => {
    if (s.videoUrl && s.videoUrl.length > 20000) {
      playableClips.push({
        label: `SHOT #${s.shotNumber} (${introDurationOffset + (s.shotNumber - 1) * 10}s - ${introDurationOffset + s.shotNumber * 10}s)`,
        videoUrl: normalizeVideoDataUrl(s.videoUrl),
        subtitle: s.dialogueIta,
      });
    }
  });

  return (
    <div className="space-y-6">
      {/* BANNER MOTORE VIDEO REALE GOOGLE VEO 3.1 ("INGREDIENTS TO VIDEO") */}
      <div className="bg-gradient-to-r from-violet-950/50 via-zinc-900 to-amber-950/30 border border-amber-500/40 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
              Motore Video Animato Nativo Google Veo 3.1 (Ingredients to Video)
            </span>
          </div>
          <p className="text-[11px] text-zinc-300 leading-relaxed">
            La chiave Vertex Express attuale (<code className="text-amber-300">AQ.Ab8RN...</code>) ha il metodo <code className="text-amber-300">PredictLongRunning</code> (Veo 3.1) bloccato da Google Cloud (<code className="text-red-300">API_KEY_SERVICE_BLOCKED</code>). Incolla qui una chiave <strong>Google AI Studio (<code className="text-emerald-300">AIzaSy...</code>)</strong> da <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline text-amber-300 hover:text-amber-200">aistudio.google.com/apikey</a> per generare video MP4 reali con <strong>Veo 3.1</strong> identici a Gemini Web!
          </p>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
          <input
            type="password"
            value={veoApiKey}
            onChange={(e) => handleSaveVeoApiKey(e.target.value)}
            placeholder="Incolla chiave AI Studio (AIzaSy...) per Veo 3.1"
            className="w-full rounded-xl bg-zinc-950 border border-amber-500/40 px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
          />
          {veoApiKey.trim().startsWith('AIza') && (
            <span className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold whitespace-nowrap">
              Veo 3.1 Attivo
            </span>
          )}
        </div>
      </div>

      {/* SCHEDA METADATI PUNTATA + PULSANTE ESPORTAZIONE CON SIGLA IN TESTA */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div className="flex flex-wrap items-center gap-3">
            {/* Selettore Serie */}
            <div className="flex items-center gap-1.5 rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2">
              <Tv className="w-3.5 h-3.5 text-violet-400" />
              <select
                value={activeSeries.id}
                onChange={(e) => onSelectSeries(e.target.value)}
                className="bg-transparent text-xs font-semibold text-zinc-100 focus:outline-none"
              >
                {seriesList.map((s) => (
                  <option key={s.id} value={s.id} className="bg-zinc-900">
                    {s.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Selettore Episodio */}
            {seriesEpisodes.length > 0 && (
              <select
                value={activeEpisode.id}
                onChange={(e) => onSelectEpisode(e.target.value)}
                className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 focus:outline-none focus:border-violet-500"
              >
                {seriesEpisodes.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    Ep. #{ep.episodeNumber} — {ep.title} ({ep.shots.length} shot)
                  </option>
                ))}
              </select>
            )}

            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {totalEpisodeDurationWithIntro}s Totali
              {hasActiveIntro
                ? ` (${introDurationOffset}s Sigla + ${activeEpisode.shots.length * 10}s Puntata)`
                : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* PULSANTE GENERA TUTTI GLI SHOT CON NANO BANANA & MOSTRA ANTEPRIMA */}
            <button
              type="button"
              disabled={isStitchingFinalVideo}
              onClick={() => handleRenderAndMergeCompleteLocalVideo(false)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-zinc-950 text-xs font-black shadow-lg transition disabled:opacity-50"
            >
              {isStitchingFinalVideo ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {stitchStatus || 'Generazione Nano Banana in corso...'}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Genera Video (Nano Banana) &amp; Vedi Anteprima in App
                </>
              )}
            </button>

            {/* PULSANTE ESPORTA VIDEO / PUNTATA CON SIGLA IN TESTA */}
            <button
              type="button"
              onClick={() => {
                setCurrentPlaylistIdx(0);
                setShowExportModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-lg transition"
            >
              <FileVideo className="w-4 h-4" />
              {hasActiveIntro
                ? `Anteprima & Scarica (con Sigla ${introDurationOffset}s)`
                : 'Anteprima & Scarica Puntata'}
            </button>

            {/* PULSANTE RIGENERA INTERO EPISODIO */}
            <button
              type="button"
              disabled={isRegeneratingWholeEpisode}
              onClick={handleRegenerateWholeEpisode}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-zinc-950 text-xs font-extrabold shadow-md transition disabled:opacity-50"
            >
              {isRegeneratingWholeEpisode ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Rigenerazione...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Rigenera Episodio (AI)
                </>
              )}
            </button>

            <div className="inline-flex rounded-xl bg-zinc-950 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  aspectRatio === '9:16'
                    ? 'bg-violet-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                9:16
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('16:9')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  aspectRatio === '16:9'
                    ? 'bg-violet-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                16:9
              </button>
            </div>
          </div>
        </div>

        {/* CAMPI SEMPRE EDITABILI E AUTO-SALVATI: TITOLO, TRAMA E PERSONAGGI DELLA PUNTATA */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-4">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Titolo della Puntata (Auto-salvato)
            </label>
            <input
              type="text"
              value={activeEpisode.title}
              onChange={(e) =>
                handleEpisodeMetadataChange({ title: e.target.value })
              }
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm font-bold text-zinc-100 focus:outline-none focus:border-violet-500"
            />
          </div>

          <div className="lg:col-span-5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              Trama / Soggetto della Puntata (Auto-salvato)
            </label>
            <textarea
              rows={2}
              value={activeEpisode.logline}
              onChange={(e) =>
                handleEpisodeMetadataChange({ logline: e.target.value })
              }
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
            />
          </div>

          <div className="lg:col-span-3">
            <label className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-violet-400" />
                Personaggi Puntata
              </span>
              {lastSavedAt && (
                <span className="text-[10px] text-emerald-400 font-normal">
                  Salvato {lastSavedAt}
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {cast.map((c) => {
                const isSelected = activeEpisode.selectedCastIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleEpisodeCastMember(c.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                      isSelected
                        ? 'bg-violet-600/25 border-violet-500 text-violet-200'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <img
                      src={c.referenceImageBase64}
                      alt={c.name}
                      className="w-4 h-4 rounded-full object-cover"
                    />
                    <span>{c.name}</span>
                    {isSelected && <Check className="w-3 h-3 text-amber-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* MODALE ESPORTAZIONE MASTER CON SIGLA IN TESTA (0s - 15s) */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <FileVideo className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-white">
                    Esportazione Master — {activeSeries.title} (Ep. #{activeEpisode.episodeNumber})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {hasActiveIntro
                      ? `Include automaticamente in testa i primi ${introDurationOffset} secondi della Sigla Ufficiale della Serie`
                      : 'Esportazione sequenza episodio'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* RIEPILOGO TIMELINE DI ESPORTAZIONE */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {hasActiveIntro && (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Music className="w-4 h-4 text-amber-400" />
                    <div>
                      <span className="text-xs font-black text-amber-300 uppercase block">
                        IN TESTA (0s – {introDurationOffset}s): SIGLA SERIE &quot;{activeSeries.title}&quot;
                      </span>
                      <span className="text-[11px] text-zinc-300">
                        {activeSeries.intro?.shots.length || 0} shot sigla •{' '}
                        {activeSeries.intro?.introVideoUrl
                          ? 'Video Sigla MP4 collegato'
                          : 'Storyboard Sigla pronto'}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold text-amber-300">
                    {introDurationOffset}s
                  </span>
                </div>
              )}

              {activeEpisode.shots.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between"
                >
                  <div>
                    <span className="text-xs font-bold text-violet-300">
                      SHOT #{s.shotNumber} (
                      {introDurationOffset + (s.shotNumber - 1) * 10}s –{' '}
                      {introDurationOffset + s.shotNumber * 10}s)
                    </span>
                    <p className="text-[11px] text-zinc-400 truncate max-w-md">
                      {s.dialogueIta || s.cameraAngle}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">10s</span>
                </div>
              ))}
            </div>

            {/* PLAYER ANTEPRIMA IN APP (O VIDEO UNICO UNITO O SEQUENZA CLIP) */}
            {(mergedEpisodePreviewUrl || playableClips.length > 0) && (
              <div className="p-4 rounded-xl bg-zinc-950 border border-emerald-500/40 space-y-2 text-center">
                <span className="text-xs font-bold text-emerald-400 block">
                  {mergedEpisodePreviewUrl
                    ? `Anteprima Video Finale Unito (${totalEpisodeDurationWithIntro}s con Sigla in Testa)`
                    : `Anteprima Riproduzione in App (${playableClips[currentPlaylistIdx]?.label})`}
                </span>
                <video
                  key={
                    mergedEpisodePreviewUrl ||
                    playableClips[currentPlaylistIdx]?.videoUrl
                  }
                  src={
                    mergedEpisodePreviewUrl
                      ? normalizeVideoDataUrl(mergedEpisodePreviewUrl)
                      : playableClips[currentPlaylistIdx]?.videoUrl
                  }
                  controls
                  autoPlay
                  playsInline
                  onLoadedMetadata={fixWebmDurationOnLoad}
                  onEnded={() => {
                    if (
                      !mergedEpisodePreviewUrl &&
                      currentPlaylistIdx < playableClips.length - 1
                    ) {
                      setCurrentPlaylistIdx(currentPlaylistIdx + 1);
                    }
                  }}
                  className="w-full max-h-64 rounded-lg bg-black mx-auto"
                />
              </div>
            )}

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                disabled={isStitchingFinalVideo}
                onClick={() => handleRenderAndMergeCompleteLocalVideo(false)}
                className="w-full py-3.5 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-zinc-950 font-black text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                {isStitchingFinalVideo ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {stitchStatus || 'Generazione Nano Banana e Montaggio Anteprima...'}
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    {hasActiveIntro
                      ? `1. Genera con Nano Banana & Vedi Anteprima Completa (Sigla ${introDurationOffset}s + Puntata)`
                      : '1. Genera con Nano Banana & Vedi Anteprima Completa in App'}
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isStitchingFinalVideo}
                onClick={() =>
                  mergedEpisodePreviewUrl
                    ? handleDownloadMergedPreviewVideo()
                    : handleRenderAndMergeCompleteLocalVideo(true)
                }
                className="w-full py-3.5 px-5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-zinc-950 font-black text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                2. Scarica Video Finale Completo in Locale (.WebM / .MP4)
              </button>

              <button
                type="button"
                onClick={handleExportCompleteEpisodePackage}
                className="w-full py-2.5 px-4 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-bold text-xs flex items-center justify-center gap-2 transition"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                Scarica Timeline JSON + Singole Clip Separate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEATRO ANTEPRIMA VIDEO IN APP (SEMPRE VISIBILE APPENA GENERI UNO O PIÙ SHOT) */}
      {(mergedEpisodePreviewUrl || playableClips.length > 0) && (
        <div className="bg-zinc-900/95 border-2 border-emerald-500/50 rounded-2xl p-6 shadow-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Play className="w-5 h-5 fill-current" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">
                    Anteprima Video in App — {activeSeries.title} (Ep. #{activeEpisode.episodeNumber})
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Nano Banana Motion + Voce AI
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Guarda l&apos;anteprima completa direttamente qui nell&apos;app prima di scaricare il file video finale sul tuo dispositivo.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={isStitchingFinalVideo}
                onClick={() => handleRenderAndMergeCompleteLocalVideo(false)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/50 text-violet-100 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                Rigenera Clip 10s (Nano Banana)
              </button>
              <button
                type="button"
                disabled={isStitchingFinalVideo}
                onClick={() =>
                  mergedEpisodePreviewUrl
                    ? handleDownloadMergedPreviewVideo()
                    : handleRenderAndMergeCompleteLocalVideo(true)
                }
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-amber-500 hover:from-emerald-400 hover:to-amber-400 text-zinc-950 font-black text-xs uppercase tracking-wider shadow-lg transition disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Scarica Video Finale su PC / Telefono
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <video
              key={
                mergedEpisodePreviewUrl ||
                playableClips[currentPlaylistIdx]?.videoUrl
              }
              src={
                mergedEpisodePreviewUrl
                  ? normalizeVideoDataUrl(mergedEpisodePreviewUrl)
                  : playableClips[currentPlaylistIdx]?.videoUrl
              }
              poster={
                cast.find((c) => activeEpisode.selectedCastIds.includes(c.id))
                  ?.referenceImageBase64
              }
              preload="auto"
              controls
              autoPlay
              playsInline
              onLoadedMetadata={fixWebmDurationOnLoad}
              onLoadedData={fixWebmDurationOnLoad}
              onEnded={() => {
                if (
                  !mergedEpisodePreviewUrl &&
                  currentPlaylistIdx < playableClips.length - 1
                ) {
                  setCurrentPlaylistIdx(currentPlaylistIdx + 1);
                }
              }}
              className={`rounded-xl border border-zinc-800 bg-black shadow-2xl ${
                aspectRatio === '9:16'
                  ? 'max-h-[460px] aspect-[9/16]'
                  : 'w-full max-w-2xl aspect-video'
              }`}
            />
            {!mergedEpisodePreviewUrl && playableClips.length > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                {playableClips.map((clip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentPlaylistIdx(idx)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition ${
                      currentPlaylistIdx === idx
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {clip.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* BLOCCO IN TESTA ALLA SEQUENZA: SIGLA DELLA SERIE (SINCRONIZZATA DA DATABASE CLOUD) */}
      {hasActiveIntro && (
        <div className="bg-gradient-to-r from-amber-950/40 via-zinc-900 to-emerald-950/40 border-2 border-amber-500/50 rounded-2xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-500 text-zinc-950 flex items-center justify-center font-black shadow-lg">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-amber-500 text-zinc-950 text-[10px] font-black uppercase">
                  IN TESTA AL VIDEO • 0s – {introDurationOffset}s
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                  {activeSeries.intro?.introVideoUrl
                    ? 'Video Sigla Sincronizzato su Database Cloud (Uguale su tutti i PC/Telefoni)'
                    : 'Sceneggiatura Sigla su Database Cloud'}
                </span>
                <h3 className="text-sm font-bold text-white">
                  Sigla Ufficiale &quot;{activeSeries.title}&quot; ({introDurationOffset} secondi max)
                </h3>
              </div>
              <p className="text-xs text-zinc-300 mt-1">
                Il <strong>Video Sigla</strong> è salvato sul Database Cloud per essere identico su ogni dispositivo, mentre il <strong>video finale della puntata</strong> viene salvato <strong>solo in locale</strong> con la sigla unita nei primi {introDurationOffset} secondi.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onGoToSeriesHub}
            className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/40 text-xs font-bold text-amber-300 transition"
          >
            Gestisci Sigla Cloud →
          </button>
        </div>
      )}

      {/* SEQUENZA DI CARD NUMERATE (SHOT 1, SHOT 2, SHOT 3...) */}
      <div className="space-y-6">
        {activeEpisode.shots.map((shot) => {
          const wordCount = countWords(shot.dialogueIta);
          const isWordCountOptimal = wordCount <= 30;
          const isWordCountWarning = wordCount > 30 && wordCount <= 40;
          const speakerChar = shot.speakerId
            ? castMap.get(shot.speakerId)
            : null;
          const shotCharacters = shot.characterIds
            .map((id) => castMap.get(id))
            .filter((c): c is Character => Boolean(c));
          const isRegeneratingThisShot = regeneratingShotId === shot.id;

          const startSec = introDurationOffset + (shot.shotNumber - 1) * 10;
          const endSec = introDurationOffset + shot.shotNumber * 10;

          return (
            <div
              key={shot.id}
              className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl transition hover:border-zinc-700"
            >
              {/* HEADER DELLA SHOT CARD */}
              <div className="bg-zinc-950/80 px-6 py-3.5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 rounded-lg bg-violet-600 text-white text-xs font-black tracking-wider uppercase shadow">
                    SHOT #{shot.shotNumber}
                  </span>
                  <span className="text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-md">
                    {startSec}s – {endSec}s (10s)
                  </span>
                  <span className="text-xs text-zinc-400 hidden sm:inline">
                    • {shot.cameraAngle}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isRegeneratingThisShot}
                    onClick={() => handleRegenerateSingleShot(shot)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-violet-600/25 hover:bg-violet-600 text-violet-200 hover:text-white border border-violet-500/40 text-xs font-bold transition disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        isRegeneratingThisShot ? 'animate-spin' : ''
                      }`}
                    />
                    {isRegeneratingThisShot
                      ? 'Rigenerazione Shot...'
                      : 'Rigenera questo Shot (AI)'}
                  </button>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-900 border border-zinc-800 text-zinc-400">
                    <HardDrive className="w-3 h-3 text-amber-400" />
                    Storage Video: Solo Locale
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${
                      shot.status === 'ready'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : shot.status === 'generating'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                        : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                    }`}
                  >
                    {shot.status === 'draft'
                      ? 'Bozza Sceneggiatura'
                      : shot.status === 'generating'
                      ? 'Rendering...'
                      : 'Clip Locale Pronta'}
                  </span>
                </div>
              </div>

              {/* CORPO DELLA SHOT CARD */}
              <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* COLONNA SINISTRA (8 COL) */}
                <div className="lg:col-span-8 space-y-5">
                  <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800/80 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        Personaggi nell&apos;Inquadratura &amp; Speaker Attivo
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        Clicca sul microfono per scegliere chi parla in questo shot
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {shotCharacters.map((char) => {
                        const isSpeaking = shot.speakerId === char.id;
                        return (
                          <div
                            key={char.id}
                            className={`flex items-center gap-2.5 p-2 pr-3 rounded-xl border transition ${
                              isSpeaking
                                ? 'bg-amber-500/15 border-amber-500 ring-2 ring-amber-500/30'
                                : 'bg-zinc-900 border-zinc-800'
                            }`}
                          >
                            <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-zinc-700">
                              <img
                                src={char.referenceImageBase64}
                                alt={char.name}
                                className="w-full h-full object-cover"
                              />
                              {isSpeaking && (
                                <div className="absolute bottom-0 right-0 bg-amber-500 text-zinc-950 p-0.5 rounded-tl">
                                  <Volume2 className="w-3 h-3" />
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-zinc-100">
                                  {char.name}
                                </span>
                                {isSpeaking && (
                                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950">
                                    Parla
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleShotChange(shot.id, {
                                      speakerId: isSpeaking ? null : char.id,
                                    })
                                  }
                                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-medium transition ${
                                    isSpeaking
                                      ? 'bg-amber-500/30 text-amber-200 hover:bg-amber-500/40'
                                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                  }`}
                                >
                                  {isSpeaking ? (
                                    <>
                                      <Mic className="w-3 h-3" />
                                      Speaker
                                    </>
                                  ) : (
                                    <>
                                      <MicOff className="w-3 h-3" />
                                      Imposta Speaker
                                    </>
                                  )}
                                </button>
                                {shot.characterIds.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleCharInShot(shot, char.id)
                                    }
                                    className="text-[10px] text-zinc-500 hover:text-red-400"
                                    title="Rimuovi dallo shot"
                                  >
                                    Rimuovi
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {cast
                        .filter((c) => !shot.characterIds.includes(c.id))
                        .map((missingChar) => (
                          <button
                            key={missingChar.id}
                            type="button"
                            onClick={() =>
                              toggleCharInShot(shot, missingChar.id)
                            }
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-zinc-800 hover:border-violet-500/60 text-xs text-zinc-500 hover:text-zinc-300 transition"
                            title={`Aggiungi ${missingChar.name} a questo shot`}
                          >
                            <Plus className="w-3.5 h-3.5 text-violet-400" />
                            <span>{missingChar.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* BATTUTA IN ITALIANO */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                        <Mic className="w-3.5 h-3.5 text-amber-400" />
                        Battuta Dialogo (ITA) —{' '}
                        {speakerChar ? (
                          <span className="text-amber-400 font-bold">
                            {speakerChar.name}
                          </span>
                        ) : (
                          <span className="text-zinc-500 italic">
                            Nessuno speaker (Shot muto / reazione)
                          </span>
                        )}
                      </label>

                      <div
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                          isWordCountOptimal
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : isWordCountWarning
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-red-500/15 text-red-300 border-red-500/30'
                        }`}
                      >
                        {!isWordCountOptimal && (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        <span>
                          {wordCount} parole{' '}
                          {isWordCountOptimal
                            ? '(Ottimale per 10s)'
                            : isWordCountWarning
                            ? '(Al limite per 10s)'
                            : '(Troppo lungo per 10s: max ~30 parole)'}
                        </span>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={shot.dialogueIta}
                      onChange={(e) =>
                        handleShotChange(shot.id, {
                          dialogueIta: e.target.value,
                        })
                      }
                      placeholder="Inserisci la battuta in italiano pronunciata dal personaggio in questi 10 secondi..."
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  {/* CAMERA ANGLE EDITABILE */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        <Camera className="w-3.5 h-3.5 text-violet-400" />
                        Inquadratura &amp; Camera Angle (EN)
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {CAMERA_PRESETS.slice(0, 3).map((preset, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() =>
                              handleShotChange(shot.id, { cameraAngle: preset })
                            }
                            className="text-[10px] px-2 py-0.5 rounded bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-violet-300 border border-zinc-800 transition"
                          >
                            {preset.split(',')[0]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="text"
                      value={shot.cameraAngle}
                      onChange={(e) =>
                        handleShotChange(shot.id, {
                          cameraAngle: e.target.value,
                        })
                      }
                      placeholder="Es. Medium selfie shot, handheld camera"
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-violet-500 transition"
                    />
                  </div>

                  {/* VISUAL PROMPT IN INGLESE EDITABILE */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        Visual Prompt Image-to-Video (EN)
                      </label>
                      <button
                        type="button"
                        onClick={() => injectVisualDescriptorsIntoPrompt(shot)}
                        className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 font-medium"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Sincronizza Identikit Cast
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      value={shot.visualPromptEn}
                      onChange={(e) =>
                        handleShotChange(shot.id, {
                          visualPromptEn: e.target.value,
                        })
                      }
                      placeholder="English visual prompt combining character visualDescriptors + 5-second physical action + facial expressions..."
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3.5 text-xs font-mono leading-relaxed text-zinc-200 focus:outline-none focus:border-violet-500 transition"
                    />
                  </div>
                </div>

                {/* COLONNA DESTRA (4 COL): ANTEPRIMA VIDEO + GESTIONE FILE LOCALE */}
                <div className="lg:col-span-4 flex flex-col items-center">
                  <div className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex flex-col items-center">
                    <div className="w-full flex items-center justify-between text-[11px] text-zinc-400 mb-3">
                      <span className="font-semibold uppercase tracking-wider">
                        Monitor Studio ({aspectRatio})
                      </span>
                      <span className="font-mono text-amber-400">
                        10.0s @ 24fps
                      </span>
                    </div>

                    <div
                      className={`relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-inner flex flex-col justify-between ${
                        aspectRatio === '9:16'
                          ? 'max-w-[230px] aspect-[9/16]'
                          : 'aspect-video'
                      }`}
                    >
                      {shot.videoUrl && shot.videoUrl.length > 20000 ? (
                        <video
                          src={normalizeVideoDataUrl(shot.videoUrl)}
                          poster={shotCharacters[0]?.referenceImageBase64}
                          preload="auto"
                          controls
                          autoPlay
                          loop
                          playsInline
                          onLoadedMetadata={fixWebmDurationOnLoad}
                          onLoadedData={fixWebmDurationOnLoad}
                          className="absolute inset-0 w-full h-full object-cover z-20"
                        />
                      ) : (
                        <>
                          {shotCharacters.length > 0 ? (
                            <div
                              className={`absolute inset-0 grid ${
                                shotCharacters.length === 1
                                  ? 'grid-cols-1'
                                  : 'grid-cols-2'
                              }`}
                            >
                              {shotCharacters.slice(0, 4).map((c) => (
                                <div
                                  key={c.id}
                                  className="relative w-full h-full overflow-hidden"
                                >
                                  <img
                                    src={c.referenceImageBase64}
                                    alt={c.name}
                                    className="w-full h-full object-cover opacity-75"
                                  />
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/50" />

                          <div className="relative z-10 p-2.5 flex items-center justify-between text-[10px] font-mono text-zinc-200">
                            <span className="px-1.5 py-0.5 rounded bg-black/60 border border-white/10">
                              CAM {shot.shotNumber}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-red-600/80 text-white font-bold">
                              REC • 00:10
                            </span>
                          </div>

                          {renderingVideoShotId === shot.id && (
                            <div className="absolute inset-0 z-30 bg-zinc-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center space-y-3">
                              <Loader2 className="w-9 h-9 text-amber-400 animate-spin" />
                              <span className="text-xs font-extrabold text-amber-300 leading-snug">
                                {shotProgressText ||
                                  'Generazione Clip Nano Banana (10s) in corso...'}
                              </span>
                              <span className="text-[10px] text-zinc-400">
                                L&apos;anteprima video di 10s partirà qui automaticamente!
                              </span>
                            </div>
                          )}

                          <div className="relative z-10 flex flex-col items-center justify-center px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleGenerateShotVideoLocal(shot)}
                              title="Clicca per generare la clip e vedere l'anteprima video"
                              className="w-12 h-12 rounded-full bg-violet-600 hover:bg-amber-500 border-2 border-white/30 flex items-center justify-center text-white hover:text-zinc-950 shadow-xl mb-1.5 transition transform hover:scale-110"
                            >
                              <Play className="w-5 h-5 fill-current ml-0.5" />
                            </button>
                            <span className="text-[10px] font-bold text-amber-300 bg-black/70 px-2 py-0.5 rounded mb-1">
                              Clicca ▶ per Generare Anteprima
                            </span>
                            <span className="text-[10px] font-medium text-zinc-300 bg-black/50 px-2 py-0.5 rounded">
                              {shot.cameraAngle}
                            </span>
                          </div>

                          <div className="relative z-10 p-3 text-center">
                            {shot.dialogueIta ? (
                              <div className="bg-black/75 backdrop-blur-sm border border-white/10 rounded-lg px-2.5 py-1.5">
                                {speakerChar && (
                                  <span className="block text-[10px] font-bold text-amber-400 uppercase">
                                    {speakerChar.name}
                                  </span>
                                )}
                                <p className="text-[11px] font-medium text-white leading-snug line-clamp-3">
                                  “{shot.dialogueIta}”
                                </p>
                              </div>
                            ) : (
                              <span className="text-[10px] italic text-zinc-400">
                                [Inquadratura muta / Reazione]
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={
                        renderingVideoShotId === shot.id ||
                        isStitchingFinalVideo
                      }
                      onClick={() => handleGenerateShotVideoLocal(shot)}
                      className="mt-4 w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-zinc-950 font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-violet-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                    >
                      {renderingVideoShotId === shot.id ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {shotProgressText || 'Nano Banana Motion + Voce (10s)...'}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          {shot.videoUrl
                            ? 'Rigenera Clip con Nano Banana (10s)'
                            : 'Genera Clip con Nano Banana (10s - Anteprima)'}
                        </>
                      )}
                    </button>

                    {shotRenderError && (
                      <div className="mt-2 w-full p-2.5 rounded-lg bg-red-950/70 border border-red-800 text-[11px] text-red-200 text-center">
                        {shotRenderError}
                      </div>
                    )}

                    <div className="mt-2.5 w-full grid grid-cols-2 gap-2">
                      <label className="cursor-pointer py-2 px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-semibold text-zinc-300 flex items-center justify-center gap-1.5 transition">
                        <Upload className="w-3.5 h-3.5 text-violet-400" />
                        <span>Allega Clip Locale</span>
                        <input
                          type="file"
                          accept="video/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleAttachLocalVideoFile(shot, f);
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        disabled={!shot.videoUrl}
                        onClick={() => handleDownloadLocalVideo(shot)}
                        className="py-2 px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-semibold text-zinc-300 flex items-center justify-center gap-1.5 transition disabled:opacity-40"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Salva MP4 su PC</span>
                      </button>
                    </div>

                    {step2NoticeShotId === shot.id && (
                      <div className="mt-2.5 p-2.5 rounded-lg bg-violet-950/60 border border-violet-500/40 text-[11px] text-violet-200 text-center leading-relaxed">
                        Pronto per il <strong>Passo 2</strong>: in fase di esportazione finale verrà aggiunto automaticamente in testa il blocco <strong>Sigla ({introDurationOffset}s)</strong> seguito da questa clip!
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
