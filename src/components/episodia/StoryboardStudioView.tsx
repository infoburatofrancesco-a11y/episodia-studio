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
} from 'lucide-react';
import type { Character, Series, Episode, Shot } from '@/types/episodia';
import { saveLocalGeneratedVideo } from '@/lib/storage';

interface StoryboardStudioViewProps {
  seriesList: Series[];
  activeSeries: Series;
  episodes: Episode[];
  activeEpisode: Episode | null;
  cast: Character[];
  onSelectSeries: (seriesId: string) => void;
  onSelectEpisode: (episodeId: string) => void;
  onUpdateEpisode: (updatedEpisode: Episode) => Promise<void>;
  onGoToWritersRoom: () => void;
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
}: StoryboardStudioViewProps) {
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>(
    activeSeries.defaultAspectRatio || '9:16'
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [step2NoticeShotId, setStep2NoticeShotId] = useState<string | null>(
    null
  );
  const [regeneratingShotId, setRegeneratingShotId] = useState<string | null>(
    null
  );
  const [isRegeneratingWholeEpisode, setIsRegeneratingWholeEpisode] =
    useState(false);

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

  const markSaved = () => {
    setLastSavedAt(
      new Date().toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  };

  // Aggiorna Titolo, Trama o Cast dell'episodio salvando subito sul Server anche senza salvare file video
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

  // Rigenera un singolo Shot tramite Gemini (/api/regenerate-shot)
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

  // Rigenera l'intera sceneggiatura dell'episodio mantenendo Titolo, Trama e Cast
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
    const a = document.createElement('a');
    a.href = shot.videoUrl;
    a.download = `${activeSeries.title.replace(/\s+/g, '_')}_Ep${activeEpisode.episodeNumber}_Shot${shot.shotNumber}.mp4`;
    a.click();
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

  return (
    <div className="space-y-6">
      {/* SCHEDA METADATI PUNTATA (TITOLO, TRAMA E CAST SEMPRE SALVATI ANCHE SENZA FILE VIDEO) */}
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
              {activeEpisode.shots.length * 5}s Totali
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
                  Rigenerazione Episodio...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Rigenera Intero Episodio (AI)
                </>
              )}
            </button>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {lastSavedAt
                  ? `Titolo, Trama e Shot salvati (${lastSavedAt})`
                  : 'Titolo, Trama e Cast salvati su Server'}
              </span>
            </div>

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
            <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <Users className="w-3.5 h-3.5 text-violet-400" />
              Personaggi della Puntata
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

      {/* SEQUENZA DI CARD NUMERATE (SHOT 1, SHOT 2, SHOT 3...) */}
      <div className="space-y-6">
        {activeEpisode.shots.map((shot) => {
          const wordCount = countWords(shot.dialogueIta);
          const isWordCountOptimal = wordCount <= 15;
          const isWordCountWarning = wordCount > 15 && wordCount <= 20;
          const speakerChar = shot.speakerId
            ? castMap.get(shot.speakerId)
            : null;
          const shotCharacters = shot.characterIds
            .map((id) => castMap.get(id))
            .filter((c): c is Character => Boolean(c));
          const isRegeneratingThisShot = regeneratingShotId === shot.id;

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
                    {(shot.shotNumber - 1) * 5}s – {shot.shotNumber * 5}s (
                    {shot.duration}s)
                  </span>
                  <span className="text-xs text-zinc-400 hidden sm:inline">
                    • {shot.cameraAngle}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* PULSANTE RIGENERA QUESTO SINGOLO SHOT CON AI */}
                  <button
                    type="button"
                    disabled={isRegeneratingThisShot}
                    onClick={() => handleRegenerateSingleShot(shot)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-violet-600/25 hover:bg-violet-600 text-violet-200 hover:text-white border border-violet-500/40 text-xs font-bold transition disabled:opacity-50"
                    title="Rigenera battuta, inquadratura e prompt visivo di questo singolo Shot con Gemini"
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
                  {/* AVATAR DEI PERSONAGGI NELLO SHOT & SELETTORE SPEAKER */}
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

                  {/* BATTUTA IN ITALIANO (dialogueIta) */}
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
                            ? '(Ottimale per 5s)'
                            : isWordCountWarning
                            ? '(Al limite per 5s)'
                            : '(Troppo lungo per 5s: max ~15 parole)'}
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
                      placeholder="Inserisci la battuta in italiano pronunciata dal personaggio in questi 5 secondi..."
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
                        {shot.duration}.0s @ 24fps
                      </span>
                    </div>

                    {/* MONITOR FRAME 9:16 O 16:9 */}
                    <div
                      className={`relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-inner flex flex-col justify-between ${
                        aspectRatio === '9:16'
                          ? 'max-w-[230px] aspect-[9/16]'
                          : 'aspect-video'
                      }`}
                    >
                      {shot.videoUrl ? (
                        <video
                          src={shot.videoUrl}
                          controls
                          loop
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

                          {/* Top HUD Overlay */}
                          <div className="relative z-10 p-2.5 flex items-center justify-between text-[10px] font-mono text-zinc-200">
                            <span className="px-1.5 py-0.5 rounded bg-black/60 border border-white/10">
                              CAM {shot.shotNumber}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-red-600/80 text-white font-bold">
                              REC • 00:05
                            </span>
                          </div>

                          {/* Center Play / Preview Badge */}
                          <div className="relative z-10 flex flex-col items-center justify-center px-3 text-center">
                            <div className="w-11 h-11 rounded-full bg-zinc-950/80 border border-violet-500/60 flex items-center justify-center text-violet-400 shadow-lg mb-1.5">
                              <Play className="w-5 h-5 fill-current ml-0.5" />
                            </div>
                            <span className="text-[10px] font-medium text-zinc-300 bg-black/50 px-2 py-0.5 rounded">
                              {shot.cameraAngle}
                            </span>
                          </div>

                          {/* Bottom Subtitle Overlay */}
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

                    {/* PULSANTE GENERA / RIGENERA CLIP (PASSO 2) + SALVATAGGIO / CARICAMENTO VIDEO LOCALE */}
                    <button
                      type="button"
                      onClick={() =>
                        setStep2NoticeShotId(
                          step2NoticeShotId === shot.id ? null : shot.id
                        )
                      }
                      className="mt-4 w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-zinc-950 font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-violet-600/20 flex items-center justify-center gap-2 transition"
                    >
                      <Sparkles className="w-4 h-4" />
                      {shot.videoUrl
                        ? 'Rigenera Clip (Passo 2)'
                        : 'Genera Clip (Passo 2)'}
                    </button>

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
                        Pronto per il <strong>Passo 2</strong>: il video generato verrà salvato{' '}
                        <strong>esclusivamente in locale</strong> (<code className="text-amber-300">episodia_local_media</code> + download MP4 su disco) mentre Titolo, Trama, Personaggi e Prompt sono già salvati sul Server.
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
