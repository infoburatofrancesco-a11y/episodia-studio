import React, { useState } from 'react';
import {
  Dices,
  Minus,
  Plus,
  Rocket,
  Volume2,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  Video,
  Film,
  Wand2,
  Copy,
  Check,
  Upload,
  Download,
  ExternalLink
} from 'lucide-react';
import {
  CastMember,
  IntroOutroConfig,
  SceneCard,
  ApiKeysConfig,
  CameraShotType,
  DialogueTurn
} from '../types/studio';
import {
  regenerateSingleSceneLineWithAi,
  generateSceneMultiTurnVoiceAndTimings,
  generateContextualAiSceneImage,
  generateVeoVideoForScene,
  buildDialogueTurnsForSceneCharacters,
  buildVeoDirectPromptForScene,
  getCharacterSitcomRoleBadge
} from '../services/aiService';

interface Step2StoryboardComicProps {
  seriesTitle?: string;
  episodeTitle: string;
  onChangeEpisodeTitle: (title: string) => void;
  rawIdea: string;
  targetTotalDurationSec: number;
  branding: IntroOutroConfig;
  onOpenBrandingModal?: () => void;
  cast: CastMember[];
  scenes: SceneCard[];
  onChangeScenes: (scenes: SceneCard[]) => void;
  apiKeys: ApiKeysConfig;
  onBackToStep1: () => void;
  onConfirmAndMountAll: () => void;
  isMountingAll: boolean;
}

const CAMERA_SHOT_LABELS: Record<CameraShotType, string> = {
  CLOSEUP_PUNCH: '🎬 Cambio d’Inquadratura Dinamico (Da Materiale a Primo Piano Azione)',
  DYNAMIC_ZOOM: '🔍 Carrellata Cinematografica Progressiva sul Soggetto',
  PAN_CINEMATIC: '🎥 Panoramica Widescreen & Stacco Multi-Inquadratura',
  REACTION_SHAKE: '⚡ Azione Rapida & Taglio Ritmato ad Alto Impatto'
};

export const Step2StoryboardComic: React.FC<Step2StoryboardComicProps> = ({
  seriesTitle = 'Serie Originale',
  episodeTitle,
  onChangeEpisodeTitle,
  rawIdea,
  targetTotalDurationSec,
  branding,
  onOpenBrandingModal,
  cast,
  scenes,
  onChangeScenes,
  apiKeys,
  onBackToStep1,
  onConfirmAndMountAll,
  isMountingAll
}) => {
  const [loadingSceneId, setLoadingSceneId] = useState<string | null>(null);
  const [loadingPhotoSceneId, setLoadingPhotoSceneId] = useState<string | null>(null);
  const [loadingLineSceneId, setLoadingLineSceneId] = useState<string | null>(null);
  const [copiedPromptSceneId, setCopiedPromptSceneId] = useState<string | null>(null);
  const [isGeneratingAllSingleVideos, setIsGeneratingAllSingleVideos] = useState(false);

  const introSec = branding.introEnabled ? branding.introDurationSec : 0;
  const outroSec = branding.outroEnabled ? branding.outroDurationSec : 0;
  const netTargetSec = Math.max(5, Math.round(targetTotalDurationSec - introSec - outroSec));

  const userVideoSec = scenes
    .filter((s) => s.sceneType === 'USER_VIDEO')
    .reduce((acc, s) => acc + s.durationSec, 0);
  const aiPhotoSec = scenes
    .filter((s) => s.sceneType === 'AI_PHOTO_VIDEO')
    .reduce((acc, s) => acc + s.durationSec, 0);
  const totalCalculatedSec = introSec + userVideoSec + aiPhotoSec + outroSec;

  const readySingleVideosCount = scenes.filter(
    (s) =>
      (s.sceneType === 'USER_VIDEO' && s.userVideoBlobUrl) ||
      (s.generatedAiVideoUrl &&
        (s.generatedAiVideoUrl.startsWith('blob:') || s.generatedAiVideoUrl.startsWith('http')))
  ).length;

  const formatMinSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const handleCopyVeoPrompt = async (scene: SceneCard) => {
    const character = cast.find((c) => c.id === scene.characterId) || cast[0];
    const promptText = buildVeoDirectPromptForScene({
      scene,
      character,
      seriesTitle
    });
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPromptSceneId(scene.id);
      setTimeout(() => {
        setCopiedPromptSceneId((prev) => (prev === scene.id ? null : prev));
      }, 2500);
    } catch {
      // Fallback
    }
  };

  const handleReplaceSceneWithVideoFile = (sceneId: string, file: File | undefined) => {
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    onChangeScenes(
      scenes.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              sceneType: 'USER_VIDEO',
              userVideoBlobUrl: blobUrl,
              generatedAiVideoUrl: blobUrl,
              useOriginalVideoAudio: true,
              trimStartSec: 0,
              status: 'DONE'
            }
          : s
      )
    );
  };

  const syncTurnsWithDuration = (
    turns: DialogueTurn[] | undefined,
    newDur: number
  ): DialogueTurn[] | undefined => {
    if (!turns || turns.length === 0) return turns;
    const count = turns.length;
    const slot = newDur / count;
    let offset = 0;
    return turns.map((t, idx) => {
      const d =
        idx === count - 1
          ? Math.max(1, Number((newDur - offset).toFixed(2)))
          : Math.max(1, Number(slot.toFixed(2)));
      const start = Number(offset.toFixed(2));
      offset += d;
      return {
        ...t,
        startOffsetSec: start,
        durationSec: d
      };
    });
  };

  const handleAdjustSceneDuration = (sceneId: string, delta: number) => {
    const idx = scenes.findIndex((s) => s.id === sceneId);
    if (idx === -1) return;

    const targetScene = scenes[idx];
    if (targetScene.durationSec + delta < 3 || targetScene.durationSec + delta > 20) return;

    let donorIdx = -1;
    for (let offset = 1; offset < scenes.length; offset++) {
      const candidateIdx = (idx + offset) % scenes.length;
      const cand = scenes[candidateIdx];
      if (cand.durationSec - delta >= 3 && cand.durationSec - delta <= 20) {
        donorIdx = candidateIdx;
        break;
      }
    }

    if (donorIdx === -1) return;

    const updated = scenes.map((s, i) => {
      if (i === idx) {
        const newDur = s.durationSec + delta;
        return {
          ...s,
          durationSec: newDur,
          dialogueTurns: syncTurnsWithDuration(s.dialogueTurns, newDur),
          trimEndSec: s.sceneType === 'USER_VIDEO' ? (s.trimStartSec || 0) + newDur : s.trimEndSec
        };
      }
      if (i === donorIdx) {
        const newDur = s.durationSec - delta;
        return {
          ...s,
          durationSec: newDur,
          dialogueTurns: syncTurnsWithDuration(s.dialogueTurns, newDur),
          trimEndSec: s.sceneType === 'USER_VIDEO' ? (s.trimStartSec || 0) + newDur : s.trimEndSec
        };
      }
      return s;
    });

    onChangeScenes(updated);
  };

  const handleRerollLine = async (scene: SceneCard, turnIndex?: number) => {
    setLoadingLineSceneId(scene.id);
    try {
      if (typeof turnIndex === 'number' && scene.dialogueTurns && scene.dialogueTurns[turnIndex]) {
        const turn = scene.dialogueTurns[turnIndex];
        const character = cast.find((c) => c.id === turn.characterId) || cast[0];
        const newLine = await regenerateSingleSceneLineWithAi({
          character,
          seriesTitle,
          episodeTitle,
          rawIdea,
          sceneOrder: scene.order + turnIndex,
          durationSec: Math.max(2, Math.round(turn.durationSec)),
          currentLine: turn.dialogueOrThought,
          apiKeys
        });
        const nextTurns = scene.dialogueTurns.map((t, i) =>
          i === turnIndex ? { ...t, dialogueOrThought: newLine } : t
        );
        const summary = nextTurns
          .map((t) => `${cast.find((c) => c.id === t.characterId)?.name || ''}: "${t.dialogueOrThought}"`)
          .join(' ↔️ ');
        onChangeScenes(
          scenes.map((s) =>
            s.id === scene.id
              ? { ...s, dialogueTurns: nextTurns, dialogueOrThought: summary }
              : s
          )
        );
      } else {
        const character = cast.find((c) => c.id === scene.characterId) || cast[0];
        const newLine = await regenerateSingleSceneLineWithAi({
          character,
          seriesTitle,
          episodeTitle,
          rawIdea,
          sceneOrder: scene.order,
          durationSec: scene.durationSec,
          currentLine: scene.dialogueOrThought,
          apiKeys
        });
        onChangeScenes(
          scenes.map((s) =>
            s.id === scene.id
              ? {
                  ...s,
                  dialogueOrThought: newLine,
                  dialogueTurns: [
                    {
                      characterId: s.characterId,
                      dialogueOrThought: newLine,
                      startOffsetSec: 0,
                      durationSec: s.durationSec,
                      focusRegion: 'CENTER'
                    }
                  ]
                }
              : s
          )
        );
      }
    } finally {
      setLoadingLineSceneId(null);
    }
  };

  const handleReworkPhotoWithAi = async (scene: SceneCard) => {
    setLoadingPhotoSceneId(scene.id);
    try {
      const character = cast.find((c) => c.id === scene.characterId) || cast[0];
      const reworkedUrl = await generateContextualAiSceneImage({
        scene,
        character,
        seriesTitle,
        episodeTitle,
        rawIdea,
        apiKeys
      });
      if (reworkedUrl) {
        onChangeScenes(
          scenes.map((s) =>
            s.id === scene.id
              ? { ...s, generatedAiImageUrl: reworkedUrl, generatedAiVideoUrl: undefined }
              : s
          )
        );
      }
    } finally {
      setLoadingPhotoSceneId(null);
    }
  };

  /**
   * 100% Clean Character Toggle (NO popup window, NO mouth positioning!)
   */
  const handleToggleCharacterInScene = (scene: SceneCard, toggledCharId: string) => {
    const currentIds =
      scene.characterIds && scene.characterIds.length > 0
        ? scene.characterIds
        : [scene.characterId];

    let nextIds: string[];
    const isAdding = !currentIds.includes(toggledCharId);
    if (!isAdding) {
      if (currentIds.length <= 1) return;
      nextIds = currentIds.filter((id) => id !== toggledCharId);
    } else {
      nextIds = [...currentIds, toggledCharId];
    }

    const primaryCharId = nextIds[0];
    const primaryObj = cast.find((c) => c.id === primaryCharId) || cast[0];
    const nextTurns = buildDialogueTurnsForSceneCharacters({
      characterIds: nextIds,
      durationSec: scene.durationSec,
      cast,
      idea: rawIdea || episodeTitle,
      sceneOrder: scene.order,
      existingTurns: scene.dialogueTurns,
      fallbackSingleLine: scene.dialogueOrThought,
      seriesTitle
    });

    const summary =
      nextTurns.length > 1
        ? nextTurns
            .map((t) => `${cast.find((c) => c.id === t.characterId)?.name || ''}: "${t.dialogueOrThought}"`)
            .join(' ↔️ ')
        : nextTurns[0]?.dialogueOrThought || scene.dialogueOrThought;

    const isDefaultCastPhoto = cast.some((c) =>
      c.referencePhotos?.includes(scene.aiPhotoSourceUrl || '')
    );

    onChangeScenes(
      scenes.map((s) =>
        s.id === scene.id
          ? {
              ...s,
              characterId: primaryCharId,
              characterIds: nextIds,
              characterRoleBadge: getCharacterSitcomRoleBadge(primaryObj, seriesTitle),
              dialogueTurns: nextTurns,
              dialogueOrThought: summary,
              cameraShot: nextIds.length > 1 ? 'PAN_CINEMATIC' : s.cameraShot,
              generatedAiImageUrl: undefined,
              generatedAiVideoUrl: undefined,
              aiPhotoSourceUrl:
                s.sceneType === 'AI_PHOTO_VIDEO' && isDefaultCastPhoto
                  ? primaryObj.referencePhotos?.[0] || s.aiPhotoSourceUrl
                  : s.aiPhotoSourceUrl
            }
          : s
      )
    );
  };

  const handleUpdateTurnText = (scene: SceneCard, turnIndex: number, newText: string) => {
    const baseTurns =
      scene.dialogueTurns && scene.dialogueTurns.length > 0
        ? scene.dialogueTurns
        : buildDialogueTurnsForSceneCharacters({
            characterIds: scene.characterIds || [scene.characterId],
            durationSec: scene.durationSec,
            cast,
            idea: rawIdea || episodeTitle,
            sceneOrder: scene.order,
            seriesTitle
          });

    const nextTurns = baseTurns.map((t, i) =>
      i === turnIndex ? { ...t, dialogueOrThought: newText } : t
    );
    const summary =
      nextTurns.length > 1
        ? nextTurns
            .map((t) => `${cast.find((c) => c.id === t.characterId)?.name || ''}: "${t.dialogueOrThought}"`)
            .join(' ↔️ ')
        : nextTurns[0]?.dialogueOrThought || newText;

    onChangeScenes(
      scenes.map((s) =>
        s.id === scene.id
          ? { ...s, dialogueTurns: nextTurns, dialogueOrThought: summary }
          : s
      )
    );
  };

  /**
   * Generates a SINGLE standalone AI Video Clip (and voice) for one specific scene card
   * based on its Indicazioni di Regia (veoMotionPrompt) and source material!
   */
  const handleElaborateSingleSceneVideo = async (scene: SceneCard) => {
    setLoadingSceneId(scene.id);
    try {
      const character = cast.find((c) => c.id === scene.characterId) || cast[0];
      const [voiceAndTurns, veoRes] = await Promise.all([
        generateSceneMultiTurnVoiceAndTimings({
          scene,
          cast,
          apiKeys,
          seriesTitle
        }),
        generateVeoVideoForScene({
          scene: {
            ...scene,
            generatedAiVideoUrl: undefined // Force fresh video elaboration
          },
          character,
          cast,
          seriesTitle,
          episodeTitle,
          rawIdea,
          apiKeys
        })
      ]);

      onChangeScenes(
        scenes.map((s) =>
          s.id === scene.id
            ? {
                ...s,
                generatedAudioUrl: voiceAndTurns.audioUrl,
                dialogueTurns: voiceAndTurns.updatedTurns || s.dialogueTurns,
                generatedAiImageUrl: veoRes.elaboratedImageUrl || s.generatedAiImageUrl,
                generatedAiVideoUrl: veoRes.videoUrl,
                status: 'DONE'
              }
            : s
        )
      );
    } finally {
      setLoadingSceneId(null);
    }
  };

  /**
   * Generates ALL individual scene video clips so the user can review each single video before the final collage.
   */
  const handleGenerateAllSingleVideos = async () => {
    setIsGeneratingAllSingleVideos(true);
    try {
      const updatedList = [...scenes];
      for (let i = 0; i < updatedList.length; i++) {
        const sc = updatedList[i];
        setLoadingSceneId(sc.id);
        const character = cast.find((c) => c.id === sc.characterId) || cast[0];
        const [voiceAndTurns, veoRes] = await Promise.all([
          generateSceneMultiTurnVoiceAndTimings({
            scene: sc,
            cast,
            apiKeys,
            seriesTitle
          }),
          generateVeoVideoForScene({
            scene: sc,
            character,
            cast,
            seriesTitle,
            episodeTitle,
            rawIdea,
            apiKeys
          })
        ]);

        updatedList[i] = {
          ...sc,
          generatedAudioUrl: voiceAndTurns.audioUrl,
          dialogueTurns: voiceAndTurns.updatedTurns || sc.dialogueTurns,
          generatedAiImageUrl: veoRes.elaboratedImageUrl || sc.generatedAiImageUrl,
          generatedAiVideoUrl: veoRes.videoUrl,
          status: 'DONE'
        };
        onChangeScenes([...updatedList]);
      }
    } finally {
      setLoadingSceneId(null);
      setIsGeneratingAllSingleVideos(false);
    }
  };

  return (
    <div className="space-y-5 pb-10">
      {/* TOP BAR: SINGOLI VIDEO AI PRIMA DEL COLLAGE */}
      <div className="bg-white border-2 border-sky-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackToStep1}
              className="px-3 py-2 rounded-xl bg-sky-100 text-sky-800 hover:bg-sky-200 font-bold text-xs inline-flex items-center gap-1 flex-shrink-0 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Step 1
            </button>
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-700 block">
                Passo 2 di 3 • Elaborazione dei Singoli Video AI per &quot;{seriesTitle}&quot; ({readySingleVideosCount}/{scenes.length} Video Pronti)
              </span>
              <input
                type="text"
                value={episodeTitle}
                onChange={(e) => onChangeEpisodeTitle(e.target.value)}
                className="w-full text-lg sm:text-xl font-black text-slate-800 bg-sky-50/60 px-2.5 py-1 mt-0.5 rounded-xl border border-sky-200 focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              type="button"
              disabled={isGeneratingAllSingleVideos || isMountingAll}
              onClick={handleGenerateAllSingleVideos}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-xs transition bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white shadow-sm"
            >
              <Video className={`w-4 h-4 ${isGeneratingAllSingleVideos ? 'animate-spin' : ''}`} />
              <span>
                {isGeneratingAllSingleVideos
                  ? 'Elaborazione Singoli Video AI...'
                  : `🎬 Elabora Tutti i Singoli Video AI (${scenes.length} Clip)`}
              </span>
            </button>

            <button
              type="button"
              disabled={isMountingAll || isGeneratingAllSingleVideos}
              onClick={onConfirmAndMountAll}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-black text-xs sm:text-sm shadow-sm transition"
            >
              <Rocket className="w-4 h-4" />
              <span>
                {isMountingAll
                  ? 'Unione dei Singoli Video nel Collage...'
                  : '🎞️ Unisci i Singoli Video nel Collage Finale →'}
              </span>
            </button>
          </div>
        </div>

        {rawIdea && (
          <div className="p-3 rounded-xl bg-sky-50/80 border border-sky-200 text-xs text-slate-700">
            <strong className="text-sky-900">🎯 Trama &amp; Indicazioni Generali Episodio:</strong> {rawIdea}
          </div>
        )}

        {/* Formula Quadratura al Secondo */}
        <div className="p-3 rounded-2xl bg-sky-50 border border-sky-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-extrabold text-sky-950">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenBrandingModal}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-sky-100 border border-sky-300 text-sky-900 transition inline-flex items-center gap-1 shadow-xs"
              title="Clicca per modificare Video, Foto, Audio e Testi della Sigla Iniziale"
            >
              🎬 Sigla: {introSec}s ✏️
            </button>
            <span>+</span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-sky-200">
              📹 Video Originali: {userVideoSec}s
            </span>
            <span>+</span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-sky-200">
              🎥 Singoli Video AI: {aiPhotoSec}s
            </span>
            <span>+</span>
            <button
              type="button"
              onClick={onOpenBrandingModal}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-sky-100 border border-sky-300 text-sky-900 transition inline-flex items-center gap-1 shadow-xs"
              title="Clicca per modificare Video, Foto, Audio e Testi dei Titoli di Coda"
            >
              🏁 Coda: {outroSec}s ✏️
            </button>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-sky-500 text-white text-xs sm:text-sm font-black text-center">
            🎞️ COLLAGE TOTALE: {formatMinSec(totalCalculatedSec)} ({scenes.length} Singoli Video uniti)
          </div>
        </div>
      </div>

      {/* SCHEDE DEI SINGOLI VIDEO AI (PRIMA DEL COLLAGE) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
        {scenes.map((scene, index) => {
          const character = cast.find((c) => c.id === scene.characterId) || cast[0];
          const isAnimal = character?.type === 'ANIMAL';
          const sceneCharIds =
            scene.characterIds && scene.characterIds.length > 0
              ? scene.characterIds
              : [scene.characterId];
          const isMultiChar = sceneCharIds.length > 1;

          const activeTurns =
            scene.dialogueTurns && scene.dialogueTurns.length > 0
              ? scene.dialogueTurns
              : buildDialogueTurnsForSceneCharacters({
                  characterIds: sceneCharIds,
                  durationSec: scene.durationSec,
                  cast,
                  idea: rawIdea || episodeTitle,
                  sceneOrder: scene.order,
                  fallbackSingleLine: scene.dialogueOrThought,
                  seriesTitle
                });

          const bestCharPhoto =
            character?.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
            character?.referencePhotos?.[0] ||
            '';
          const bestSourcePhoto =
            scene.aiPhotoSourceUrl && !scene.aiPhotoSourceUrl.startsWith('data:image/svg+xml')
              ? scene.aiPhotoSourceUrl
              : bestCharPhoto || scene.aiPhotoSourceUrl || '';
          const previewImage = scene.generatedAiImageUrl || bestSourcePhoto;

          const playableSingleVideoUrl =
            scene.generatedAiVideoUrl &&
            (scene.generatedAiVideoUrl.startsWith('blob:') ||
              scene.generatedAiVideoUrl.startsWith('http'))
              ? scene.generatedAiVideoUrl
              : scene.sceneType === 'USER_VIDEO' && scene.userVideoBlobUrl
              ? scene.userVideoBlobUrl
              : '';

          return (
            <div
              key={scene.id}
              className="bg-white border-2 border-sky-200 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col justify-between space-y-3.5 hover:border-sky-400 transition"
            >
              {/* RIGA 1: Numero Singolo Video, Selettore Protagonisti e Durata (-1s / +1s) */}
              <div className="flex flex-col gap-2 pb-2.5 border-b border-sky-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2.5 py-1 rounded-xl bg-sky-500 text-white font-black text-xs flex items-center justify-center flex-shrink-0 shadow-sm">
                      🎬 Video #{index + 1}
                    </span>
                    <span className="text-xs font-extrabold text-sky-900">
                      {playableSingleVideoUrl
                        ? '✅ Singolo Video Pronto per il Collage'
                        : '⚡ Da Elaborare con AI'}
                    </span>
                  </div>

                  {/* Controllo Durata Singolo Video (-1s / +1s) */}
                  <div className="flex items-center gap-1 bg-sky-50 border border-sky-200 px-2 py-1 rounded-xl flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAdjustSceneDuration(scene.id, -1)}
                      className="w-7 h-7 rounded-lg bg-white hover:bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-900 font-bold transition"
                      title="Riduci di 1s"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-2 font-black text-sm text-sky-900">
                      {scene.durationSec}s
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAdjustSceneDuration(scene.id, 1)}
                      className="w-7 h-7 rounded-lg bg-white hover:bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-900 font-bold transition"
                      title="Aumenta di 1s"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Pillole Personaggi presenti in questo Singolo Video (zero popup bocca!) */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500 mr-1">
                      Protagonisti nel video:
                    </span>
                    {cast.map((c) => {
                      const isSelected = sceneCharIds.includes(c.id);
                      const turnNum = sceneCharIds.indexOf(c.id) + 1;
                      const cPhoto =
                        c.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
                        c.referencePhotos?.[0];
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleToggleCharacterInScene(scene, c.id)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-extrabold border transition ${
                            isSelected
                              ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                              : 'bg-sky-50/70 text-slate-600 border-sky-200 hover:bg-sky-100'
                          }`}
                        >
                          {cPhoto && (
                            <img
                              src={cPhoto}
                              alt={c.name}
                              className="w-4 h-4 rounded-full object-cover bg-white"
                            />
                          )}
                          <span>{c.name}</span>
                          {isSelected && isMultiChar && (
                            <span className="px-1.5 rounded-full bg-amber-300 text-slate-900 text-[10px] font-black">
                              #{turnNum}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* RIGA 2: PLAYER DEL SINGOLO VIDEO GENERATO + INDICAZIONI AI */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-sky-50/60 p-3 rounded-2xl border border-sky-200/80">
                {/* Player Video o Materiale di Partenza */}
                <div className="sm:col-span-5 flex flex-col gap-2">
                  <div className="relative rounded-xl overflow-hidden bg-slate-950 aspect-[16/10] flex items-center justify-center border border-sky-200">
                    {playableSingleVideoUrl ? (
                      <video
                        key={playableSingleVideoUrl}
                        src={playableSingleVideoUrl}
                        controls
                        loop
                        playsInline
                        className="w-full h-full object-contain"
                      />
                    ) : previewImage ? (
                      <img
                        src={previewImage}
                        alt={character?.name}
                        className="w-full h-full object-contain"
                      />
                    ) : null}

                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 pointer-events-none">
                      {scene.userVideoBlobUrl || scene.generatedAiVideoUrl?.includes('#veonative') ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-600/95 text-white text-[10px] font-extrabold shadow">
                          <Video className="w-3 h-3" /> 🎬 Video Animato Reale
                        </span>
                      ) : playableSingleVideoUrl ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/95 text-slate-950 text-[10px] font-extrabold shadow">
                          <Video className="w-3 h-3" /> ⚠️ Anteprima Foto 2.5D (Usa Gemini o Veo per animazione reale)
                        </span>
                      ) : scene.generatedAiImageUrl ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-purple-600/95 text-white text-[10px] font-extrabold shadow">
                          <Sparkles className="w-3 h-3" /> Scena Rielaborata AI
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/95 text-slate-950 text-[10px] font-black shadow">
                          📷 Materiale Base
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Azioni rapide sul file video singolo */}
                  <div className="flex items-center gap-1.5">
                    <label className="flex-1 py-1.5 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 font-extrabold text-[10px] flex items-center justify-center gap-1 cursor-pointer transition shadow-2xs">
                      <Upload className="w-3 h-3" />
                      <span>📹 Carica Video MP4</span>
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) =>
                          handleReplaceSceneWithVideoFile(scene.id, e.target.files?.[0])
                        }
                      />
                    </label>

                    {playableSingleVideoUrl && (
                      <a
                        href={playableSingleVideoUrl}
                        download={`video_scena_${scene.order}_${character?.name || 'clip'}.webm`}
                        className="py-1.5 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[10px] inline-flex items-center justify-center gap-1 shadow-2xs transition"
                        title="Scarica questo singolo video"
                      >
                        <Download className="w-3 h-3" />
                        <span>Scarica Clip</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Indicazioni AI per Elaborare questo Singolo Video + Pulsante Genera */}
                <div className="sm:col-span-7 flex flex-col justify-between space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-black uppercase text-purple-900 mb-1 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      🎬 Indicazioni AI per Elaborare questo Singolo Video:
                    </label>
                    <textarea
                      rows={2}
                      value={scene.veoMotionPrompt || ''}
                      onChange={(e) =>
                        onChangeScenes(
                          scenes.map((s) =>
                            s.id === scene.id
                              ? { ...s, veoMotionPrompt: e.target.value, directorNote: e.target.value }
                              : s
                          )
                        )
                      }
                      placeholder={`Scrivi cosa deve succedere in questo singolo video con ${
                        character?.name || 'il protagonista'
                      } (es. cambio d'inquadratura dinamico, azione nell'atelier, reazione sorpresa)...`}
                      className="w-full p-2.5 rounded-xl border-2 border-purple-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-purple-500 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase text-sky-800 mb-0.5 flex items-center gap-1">
                        <Film className="w-3 h-3 text-sky-600" /> Movimento Regia Video:
                      </label>
                      <select
                        value={scene.cameraShot || 'CLOSEUP_PUNCH'}
                        onChange={(e) =>
                          onChangeScenes(
                            scenes.map((s) =>
                              s.id === scene.id
                                ? { ...s, cameraShot: e.target.value as CameraShotType }
                                : s
                            )
                          )
                        }
                        className="w-full px-2 py-1.5 rounded-xl border border-sky-200 bg-white text-[11px] font-bold text-slate-800"
                      >
                        {(Object.keys(CAMERA_SHOT_LABELS) as CameraShotType[]).map((shotKey) => (
                          <option key={shotKey} value={shotKey}>
                            {CAMERA_SHOT_LABELS[shotKey]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-extrabold uppercase text-amber-800 mb-0.5">
                        🏷️ Titolo/Ruolo Sovraimpressione:
                      </label>
                      <input
                        type="text"
                        value={
                          scene.characterRoleBadge ??
                          getCharacterSitcomRoleBadge(character, seriesTitle)
                        }
                        onChange={(e) =>
                          onChangeScenes(
                            scenes.map((s) =>
                              s.id === scene.id
                                ? { ...s, characterRoleBadge: e.target.value }
                                : s
                            )
                          )
                        }
                        placeholder="Es. PROTAGONISTA / ATELIER"
                        className="w-full px-2.5 py-1.5 rounded-xl border border-amber-300 bg-amber-50/60 text-[11px] font-black text-amber-950"
                      />
                    </div>
                  </div>

                  {/* Se è un Video Caricato: scegli se usare l'Audio Originale del Video o la Voce Narrante AI */}
                  {scene.sceneType === 'USER_VIDEO' && (
                    <div className="flex flex-wrap items-center justify-between gap-1.5 p-2 rounded-xl bg-emerald-50 border border-emerald-200">
                      <span className="text-[11px] font-extrabold text-emerald-950">
                        🔊 Audio di questo Singolo Video:
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onChangeScenes(
                              scenes.map((s) =>
                                s.id === scene.id ? { ...s, useOriginalVideoAudio: true } : s
                              )
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition ${
                            scene.useOriginalVideoAudio !== false
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-white text-slate-600 border border-emerald-200'
                          }`}
                        >
                          🔊 Audio Originale Video
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onChangeScenes(
                              scenes.map((s) =>
                                s.id === scene.id ? { ...s, useOriginalVideoAudio: false } : s
                              )
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition ${
                            scene.useOriginalVideoAudio === false
                              ? 'bg-sky-600 text-white shadow-xs'
                              : 'bg-white text-slate-600 border border-sky-200'
                          }`}
                        >
                          🎙️ Voce Narrante AI
                        </button>
                      </div>
                    </div>
                  )}

                  {/* PULSANTI GENERAZIONE SINGOLO VIDEO AI */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      disabled={loadingSceneId === scene.id}
                      onClick={() => handleElaborateSingleSceneVideo(scene)}
                      className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-sky-600 hover:from-purple-500 hover:to-sky-500 disabled:opacity-60 text-white font-black text-xs inline-flex items-center justify-center gap-1.5 shadow-sm transition"
                    >
                      {loadingSceneId === scene.id ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Elaborazione Video AI in corso...</span>
                        </>
                      ) : (
                        <>
                          <Video className="w-3.5 h-3.5" />
                          <span>
                            {playableSingleVideoUrl
                              ? '🔄 Rielabora Singolo Video AI'
                              : '🎬 Genera questo Singolo Video AI'}
                          </span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={loadingPhotoSceneId === scene.id}
                      onClick={() => handleReworkPhotoWithAi(scene)}
                      className="py-2 px-2.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-950 border border-purple-300 font-extrabold text-[11px] inline-flex items-center gap-1 flex-shrink-0 transition"
                      title="Genera con Gemini Image una nuova inquadratura d'azione a partire dalla foto e dalle indicazioni!"
                    >
                      {loadingPhotoSceneId === scene.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="w-3.5 h-3.5" />
                      )}
                      <span>✨ Nuova Scena AI</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyVeoPrompt(scene)}
                      className="py-2 px-2.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 font-extrabold text-[11px] inline-flex items-center justify-center gap-1 transition"
                      title="Copia il prompt completo e calibrato per Gemini Video / Google Veo"
                    >
                      {copiedPromptSceneId === scene.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Prompt Copiato!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-amber-800" />
                          <span>📋 Prompt Gemini Video</span>
                        </>
                      )}
                    </button>

                    <a
                      href="https://gemini.google.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="py-2 px-2.5 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-950 border border-sky-300 font-extrabold text-[11px] inline-flex items-center justify-center gap-1 transition"
                      title="Apri Google Gemini per incollare il prompt e generare il video animato con Veo"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-sky-700" />
                      <span>🌐 Apri Gemini</span>
                    </a>
                  </div>
                </div>
              </div>

              {/* RIGA 3: DIALOGO / NARRAZIONE DELLA CLIP */}
              {isMultiChar ? (
                <div className="space-y-2 p-3 rounded-2xl bg-sky-50/90 border-2 border-sky-300">
                  <div className="flex items-center justify-between text-[11px] font-black uppercase text-sky-900">
                    <span>💬 Dialogo / Narrazione in questo Singolo Video:</span>
                    <span className="text-sky-700">{activeTurns.length} interventi</span>
                  </div>
                  {activeTurns.map((turn, tIdx) => {
                    const turnChar = cast.find((c) => c.id === turn.characterId) || character;
                    return (
                      <div
                        key={`${scene.id}-turn-${tIdx}`}
                        style={{
                          backgroundColor: turnChar?.subtitleStyle.bgColor || '#e0f2fe',
                          color: turnChar?.subtitleStyle.textColor || '#0c4a6e'
                        }}
                        className="p-3 rounded-xl border border-sky-300/80 shadow-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-xs font-black uppercase">
                            #{tIdx + 1} {turnChar?.name} ({turn.durationSec}s):
                          </span>
                          <button
                            type="button"
                            disabled={loadingLineSceneId === scene.id}
                            onClick={() => handleRerollLine(scene, tIdx)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/90 hover:bg-white text-sky-900 text-[11px] font-extrabold shadow-xs transition"
                          >
                            <Dices className="w-3 h-3" /> Cambia battuta
                          </button>
                        </div>
                        <textarea
                          rows={2}
                          value={turn.dialogueOrThought}
                          onChange={(e) => handleUpdateTurnText(scene, tIdx, e.target.value)}
                          className="w-full bg-transparent font-bold text-xs sm:text-sm focus:outline-none resize-none leading-snug"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: character?.subtitleStyle.bgColor || '#e0f2fe',
                    color: character?.subtitleStyle.textColor || '#0c4a6e'
                  }}
                  className="relative p-3.5 rounded-2xl border-2 border-sky-200/80 shadow-inner space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase tracking-wide opacity-90">
                      {character?.subtitleStyle.badgeText ||
                        (isAnimal ? `🐕 ${character?.name}:` : `🗣️ ${character?.name}:`)}
                    </span>
                    <button
                      type="button"
                      disabled={loadingLineSceneId === scene.id}
                      onClick={() => handleRerollLine(scene)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/90 hover:bg-white text-sky-900 text-xs font-extrabold shadow-sm transition"
                    >
                      {loadingLineSceneId === scene.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Dices className="w-3.5 h-3.5" />
                      )}
                      🎲 Cambia battuta con AI
                    </button>
                  </div>

                  <textarea
                    rows={2}
                    value={scene.dialogueOrThought}
                    onChange={(e) =>
                      onChangeScenes(
                        scenes.map((s) =>
                          s.id === scene.id
                            ? {
                                ...s,
                                dialogueOrThought: e.target.value,
                                dialogueTurns: [
                                  {
                                    characterId: s.characterId,
                                    dialogueOrThought: e.target.value,
                                    startOffsetSec: 0,
                                    durationSec: s.durationSec,
                                    focusRegion: 'CENTER'
                                  }
                                ]
                              }
                            : s
                        )
                      )
                    }
                    className="w-full bg-transparent font-bold text-sm sm:text-base focus:outline-none resize-none leading-snug"
                  />
                </div>
              )}

              {/* RIGA 4: ANTEPRIMA AUDIO VOCE SE PRESENTE */}
              {scene.generatedAudioUrl && (
                <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold text-sky-900 flex items-center gap-1">
                    <Volume2 className="w-3.5 h-3.5 text-sky-600" />
                    Audio Voce Scena #{index + 1}:
                  </span>
                  <audio
                    controls
                    src={scene.generatedAudioUrl.split('#')[0]}
                    className="h-8 flex-1 max-w-xs"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* BARRA FINALE: GENERA SINGOLI VIDEO E UNISCILI NEL COLLAGE FINALE */}
      <div className="bg-white border-2 border-sky-300 rounded-2xl p-4 sm:p-5 shadow-md flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <button
          type="button"
          disabled={isGeneratingAllSingleVideos || isMountingAll}
          onClick={handleGenerateAllSingleVideos}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 font-extrabold text-sm sm:text-base transition shadow-sm"
        >
          <Video className={`w-5 h-5 ${isGeneratingAllSingleVideos ? 'animate-spin' : ''}`} />
          <span>
            {isGeneratingAllSingleVideos
              ? 'Elaborazione Singoli Video AI in corso...'
              : `🎬 1. Elabora Tutti i Singoli Video AI (${scenes.length} Clip)`}
          </span>
        </button>

        <button
          type="button"
          disabled={isMountingAll || isGeneratingAllSingleVideos}
          onClick={onConfirmAndMountAll}
          className="w-full sm:flex-1 inline-flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-black text-base sm:text-lg shadow-md hover:shadow-xl transition"
        >
          <Rocket className="w-6 h-6 flex-shrink-0" />
          <span>
            {isMountingAll
              ? 'Creazione Collage Finale dai Singoli Video...'
              : `🎞️ 2. Unisci i Singoli Video nel Collage Finale (${formatMinSec(totalCalculatedSec)}) →`}
          </span>
        </button>
      </div>
    </div>
  );
};
