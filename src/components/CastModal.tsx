import React, { useEffect, useRef, useState } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Upload,
  Volume2,
  X,
  Sparkles,
  Dog,
  User,
  Check,
  Mic,
  CheckCircle2,
  RefreshCw,
  Heart,
  Cloud,
  Search
} from 'lucide-react';
import {
  CastMember,
  CastType,
  ApiKeysConfig,
  RelationshipPresetType,
  CharacterRelationship
} from '../types/studio';
import { fileToDataUrl, generateOptimizedImageBase64 } from '../services/audioExtractorService';
import {
  GEMINI_HD_VOICES,
  fetchRawGeminiNeuralVoiceBlob,
  analyzeAndCloneVoiceSample,
  applyAcousticMasteringToAudioBlob,
  getSampledVoiceBlobFromConfig
} from '../services/aiService';
import { ConfirmDialogModal, ConfirmDialogState } from './ConfirmDialogModal';
import { CloudMediaPickerModal } from './CloudMediaPickerModal';

const RELATIONSHIP_PRESETS: Array<{
  type: RelationshipPresetType;
  label: string;
  buildDefaultText: (nameA: string, nameB: string) => string;
}> = [
  {
    type: 'LOVE_AFFECTION',
    label: '❤️ Si vogliono bene',
    buildDefaultText: (a, b) =>
      `${a} e ${b} si vogliono un mondo di bene: sono legatissimi, si cercano sempre e si difendono a vicenda.`
  },
  {
    type: 'PARTNERS_IN_CRIME',
    label: '🤝 Sempre in combutta',
    buildDefaultText: (a, b) =>
      `${a} e ${b} sono sempre in combutta: complici inseparabili di marachelle, uno fa da palo e l'altro agisce!`
  },
  {
    type: 'FUNNY_RIVALS',
    label: '⚡ Bisticci & Rivali comici',
    buildDefaultText: (a, b) =>
      `${a} e ${b} si punzecchiano di continuo: competono per il posto migliore sul divano e per chi ottiene più biscotti.`
  },
  {
    type: 'BOSS_AND_SERVANT',
    label: '👑 Capo & Suddito',
    buildDefaultText: (a, b) =>
      `Tra ${a} e ${b} comanda chiaramente uno dei due: basta uno sguardo teatrale per farsi ubbidire all'istante.`
  },
  {
    type: 'PROTECTOR_AND_BABY',
    label: '🛡️ Protettivo & Combinaguai',
    buildDefaultText: (a, b) =>
      `${a} tiene d'occhio ${b} con pazienza infinita mentre combina guai esilaranti in giro per casa.`
  },
  {
    type: 'CUSTOM',
    label: '✏️ Personalizzato',
    buildDefaultText: (a, b) => `Rapporto speciale tra ${a} e ${b}: `
  }
];

interface CastModalProps {
  isOpen: boolean;
  onClose: () => void;
  cast: CastMember[];
  apiKeys: ApiKeysConfig;
  onSaveCast: (newCast: CastMember[]) => void;
}

export const CastModal: React.FC<CastModalProps> = ({
  isOpen,
  onClose,
  cast,
  apiKeys,
  onSaveCast
}) => {
  const [members, setMembers] = useState<CastMember[]>(cast);
  const [selectedId, setSelectedId] = useState<string>(cast[0]?.id || '');
  const [testingVoiceId, setTestingVoiceId] = useState<string | null>(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [isApplyingLiveDsp, setIsApplyingLiveDsp] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [isCloudPhotoOpen, setIsCloudPhotoOpen] = useState(false);

  // Cache of unmastered audio Blobs per character:
  // - recordedBlobsRef stores the user's actual recorded/uploaded voice Blob
  // - neuralBlobsRef stores the raw 24kHz Gemini 2.5 Neural voice Blob (keyed by memberId + voiceName)
  const recordedBlobsRef = useRef<Record<string, Blob>>({});
  const neuralBlobsRef = useRef<Record<string, Blob>>({});

  // Voice recording state
  const [isRecordingSample, setIsRecordingSample] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [isAnalyzingSample, setIsAnalyzingSample] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const wasOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setMembers(cast);
      if (cast[0] && !cast.some((c) => c.id === selectedId)) {
        setSelectedId(cast[0].id);
      }
    }
    wasOpenRef.current = isOpen;
  }, [cast, isOpen, selectedId]);

  if (!isOpen) return null;

  const activeMember = members.find((m) => m.id === selectedId) || members[0];

  const handleUpdateMember = (id: string, patch: Partial<CastMember>) => {
    setMembers((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, ...patch } : m));
      onSaveCast(next);
      return next;
    });
  };

  /**
   * Bidirectionally updates the relationship between `sourceId` and `targetId`
   * so that if A and B love each other or are partners in crime, both profiles stay synchronized!
   */
  const handleUpdateRelationship = (
    sourceId: string,
    targetId: string,
    relationType: RelationshipPresetType,
    description: string
  ) => {
    setMembers((prev) => {
      const updated = prev.map((m) => {
        if (m.id === sourceId) {
          const existing = Array.isArray(m.relationships) ? m.relationships : [];
          const hasEntry = existing.some((r) => r.targetCharacterId === targetId);
          const nextRels: CharacterRelationship[] = hasEntry
            ? existing.map((r) =>
                r.targetCharacterId === targetId
                  ? { targetCharacterId: targetId, relationType, description }
                  : r
              )
            : [...existing, { targetCharacterId: targetId, relationType, description }];
          return { ...m, relationships: nextRels };
        }
        if (m.id === targetId) {
          const existing = Array.isArray(m.relationships) ? m.relationships : [];
          const hasEntry = existing.some((r) => r.targetCharacterId === sourceId);
          const nextRels: CharacterRelationship[] = hasEntry
            ? existing.map((r) =>
                r.targetCharacterId === sourceId
                  ? { targetCharacterId: sourceId, relationType, description }
                  : r
              )
            : [...existing, { targetCharacterId: sourceId, relationType, description }];
          return { ...m, relationships: nextRels };
        }
        return m;
      });
      onSaveCast(updated);
      return updated;
    });
  };

  /**
   * INSTANT LIVE DSP RE-MASTERING:
   * Whenever the user moves any slider (Pitch, Speed, Warmth, Presence) or switches mode,
   * we immediately re-master the cached audio (either their Recorded Voice or the Neural HD Voice)
   * in ~15ms using Web Audio OfflineAudioContext and auto-play the updated audio!
   */
  const triggerInstantDspUpdateAndPlay = async (
    member: CastMember,
    updatedConfig: CastMember['voiceConfig'],
    autoPlay = true
  ) => {
    const hasSample = Boolean(
      recordedBlobsRef.current[member.id] ||
        updatedConfig.voiceSampleBase64 ||
        updatedConfig.voiceSampleBlobUrl
    );
    const useRecorded = updatedConfig.useRecordedVoiceDirectly && hasSample;

    let baseBlob: Blob | null = null;

    if (useRecorded) {
      if (recordedBlobsRef.current[member.id]) {
        baseBlob = recordedBlobsRef.current[member.id];
      } else {
        baseBlob = await getSampledVoiceBlobFromConfig(updatedConfig);
        if (baseBlob) {
          recordedBlobsRef.current[member.id] = baseBlob;
        }
      }
    } else {
      const cacheKey = `${member.id}_${updatedConfig.voiceName}`;
      baseBlob = neuralBlobsRef.current[cacheKey] || null;
      if (!baseBlob) {
        const sampleDialogue =
          member.type === 'ANIMAL'
            ? `Ciao! Sono ${member.name}, ascolta il mio timbro vocale personalizzato per la serie!`
            : `Ciao! Sono ${member.name}, ecco la mia voce personalizzata per la puntata!`;
        baseBlob = await fetchRawGeminiNeuralVoiceBlob({
          text: sampleDialogue,
          character: { ...member, voiceConfig: updatedConfig },
          apiKeys
        });
        if (baseBlob) {
          neuralBlobsRef.current[cacheKey] = baseBlob;
        }
      }
      if (!baseBlob && recordedBlobsRef.current[member.id]) {
        baseBlob = recordedBlobsRef.current[member.id];
      }
    }

    if (!baseBlob) return;

    setIsApplyingLiveDsp(true);
    try {
      const rawMasteredUrl = await applyAcousticMasteringToAudioBlob(
        baseBlob,
        updatedConfig,
        { ...member, voiceConfig: updatedConfig }
      );
      const masteredUrl = rawMasteredUrl.split('#')[0];
      setPreviewAudioUrl(masteredUrl);
      if (autoPlay && audioPlayerRef.current) {
        audioPlayerRef.current.src = masteredUrl;
        audioPlayerRef.current.currentTime = 0;
        audioPlayerRef.current.play().catch(() => {});
      }
    } finally {
      setIsApplyingLiveDsp(false);
    }
  };

  const handleSliderChange = (
    field: 'pitch' | 'speed' | 'warmth' | 'presence',
    value: number
  ) => {
    if (!activeMember) return;
    const updatedConfig: CastMember['voiceConfig'] = {
      ...activeMember.voiceConfig,
      [field]: value
    };
    handleUpdateMember(activeMember.id, { voiceConfig: updatedConfig });
    triggerInstantDspUpdateAndPlay(activeMember, updatedConfig, true);
  };

  const handleVoiceActorChange = async (newVoiceName: string) => {
    if (!activeMember) return;
    const updatedConfig: CastMember['voiceConfig'] = {
      ...activeMember.voiceConfig,
      voiceName: newVoiceName,
      useRecordedVoiceDirectly: false
    };
    const updatedMember: CastMember = {
      ...activeMember,
      voiceConfig: updatedConfig
    };
    handleUpdateMember(activeMember.id, { voiceConfig: updatedConfig });
    await handleTestNeuralVoice(updatedMember);
  };

  const handleAddMember = (type: CastType) => {
    const newId = `cast-${Date.now()}`;
    const isAnimal = type === 'ANIMAL';
    const newMember: CastMember = {
      id: newId,
      name: isAnimal ? 'Nuovo Cucciolo' : 'Nuovo Umano',
      type,
      referencePhotos: [],
      personalityPrompt: isAnimal
        ? 'Simpatico, curioso e sempre affamato di snack.'
        : 'Ironico, paziente e sorpreso dalle gag in casa.',
      voiceConfig: {
        voiceName: isAnimal ? 'Leda' : 'Orus',
        pitch: 1.0,
        speed: 1.0,
        warmth: 3,
        presence: 2,
        useRecordedVoiceDirectly: false,
        stylePrompt: isAnimal
          ? 'Recita in italiano spontaneo con voce sorridente, vivace e naturalezza umana'
          : 'Recita in italiano naturale, caldo, espressivo e colloquiale come un vero attore'
      },
      subtitleStyle: {
        textColor: isAnimal ? '#78350f' : '#0c4a6e',
        bgColor: isAnimal ? '#fef3c7' : '#e0f2fe',
        badgeText: isAnimal ? '🐕 Pensiero:' : '🗣️ Parla:'
      },
      defaultCreditRole: isAnimal
        ? 'Assaggiatore Ufficiale di Croccantini'
        : 'Regista & Distributore Coccole',
      memoryGags: ['Adora rubare la scena nei momenti meno opportuni']
    };
    const updated = [...members, newMember];
    setMembers(updated);
    setSelectedId(newId);
    onSaveCast(updated);
  };

  const handleDeleteMember = (id: string) => {
    if (members.length <= 1) return;
    const target = members.find((m) => m.id === id);
    setConfirmDialog({
      isOpen: true,
      title: 'Eliminare questo Personaggio?',
      message: 'Vuoi rimuovere questo protagonista dal Cast della serie?',
      itemHighlight: `${target?.type === 'ANIMAL' ? '🐾' : '🧑'} ${target?.name || 'Personaggio'}`,
      confirmLabel: 'Sì, Rimuovi',
      cancelLabel: 'Annulla',
      variant: 'danger',
      onConfirm: () => {
        const filtered = members.filter((m) => m.id !== id);
        setMembers(filtered);
        if (selectedId === id && filtered[0]) {
          setSelectedId(filtered[0].id);
        }
        onSaveCast(filtered);
      }
    });
  };

  const handlePhotoFilesUpload = async (filesList: FileList | File[] | null) => {
    if (!filesList || filesList.length === 0 || !activeMember) return;
    const existingRealPhotos = activeMember.referencePhotos.filter(
      (p) => !p.startsWith('data:image/svg+xml')
    );
    const files = Array.from(filesList).slice(0, Math.max(1, 5 - existingRealPhotos.length));
    const urls: string[] = [];
    for (const f of files) {
      try {
        const optimized = await generateOptimizedImageBase64(f, 800, 0.82);
        urls.push(optimized || URL.createObjectURL(f));
      } catch {
        const dataUrl = await fileToDataUrl(f).catch(() => URL.createObjectURL(f));
        urls.push(dataUrl);
      }
    }
    handleUpdateMember(activeMember.id, {
      referencePhotos: [...urls, ...existingRealPhotos].slice(0, 5)
    });
  };

  /**
   * Plays or generates the preview audio:
   * - If "Usa la mia Voce Campionata & Modificata" is active, it masters & plays the user's recorded voice sample!
   * - If "Usa Attore Neurale HD" is active, it fetches/caches the 24kHz Gemini 2.5 Neural voice and masters it!
   */
  const handleTestNeuralVoice = async (member: CastMember) => {
    setTestingVoiceId(member.id);
    try {
      const hasSample = Boolean(
        recordedBlobsRef.current[member.id] ||
          member.voiceConfig.voiceSampleBase64 ||
          member.voiceConfig.voiceSampleBlobUrl
      );
      if (member.voiceConfig.useRecordedVoiceDirectly && hasSample) {
        await triggerInstantDspUpdateAndPlay(member, member.voiceConfig, true);
        return;
      }

      const cacheKey = `${member.id}_${member.voiceConfig.voiceName}`;
      let rawBlob: Blob | null = neuralBlobsRef.current[cacheKey] || null;

      if (!rawBlob) {
        const sampleDialogue =
          member.type === 'ANIMAL'
            ? `Ma davvero pensate che io non abbia sentito il rumore del sacchetto dei biscotti? Questa è la mia voce personalizzata!`
            : `Ragazzi, guardatemi negli occhi: oggi giriamo una puntata spettacolare!`;

        rawBlob = await fetchRawGeminiNeuralVoiceBlob({
          text: sampleDialogue,
          character: member,
          apiKeys
        });

        if (rawBlob) {
          neuralBlobsRef.current[cacheKey] = rawBlob;
        }
      }

      if (rawBlob) {
        const rawMasteredUrl = await applyAcousticMasteringToAudioBlob(
          rawBlob,
          member.voiceConfig,
          member
        );
        const masteredUrl = rawMasteredUrl.split('#')[0];
        setPreviewAudioUrl(masteredUrl);
        if (audioPlayerRef.current) {
          audioPlayerRef.current.src = masteredUrl;
          audioPlayerRef.current.currentTime = 0;
          await audioPlayerRef.current.play().catch(() => {});
        }
      }
    } finally {
      setTestingVoiceId(null);
    }
  };

  const handleStartRecordingVoiceSample = async () => {
    if (!activeMember) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setIsRecordingSample(false);
        const audioBlob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm'
        });
        await processVoiceSampleBlob(audioBlob);
      };

      setRecordingSec(0);
      setIsRecordingSample(true);
      recorder.start(200);

      timerRef.current = window.setInterval(() => {
        setRecordingSec((prev) => {
          if (prev >= 15) {
            handleStopRecordingVoiceSample();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.warn('Mic access error:', err);
      setConfirmDialog({
        isOpen: true,
        title: 'Microfono non disponibile',
        message:
          'Permesso microfono negato o non disponibile. Puoi usare il pulsante "📂 Carica File Audio" qui accanto per caricare un vocale registrato dal telefono!',
        confirmLabel: 'Ho capito',
        hideCancel: true,
        variant: 'primary',
        onConfirm: () => {}
      });
    }
  };

  const handleStopRecordingVoiceSample = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleUploadVoiceSampleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !activeMember) return;
    const file = e.target.files[0];
    await processVoiceSampleBlob(file);
  };

  const processVoiceSampleBlob = async (audioBlob: Blob) => {
    if (!activeMember) return;
    setIsAnalyzingSample(true);
    try {
      recordedBlobsRef.current[activeMember.id] = audioBlob;

      const cloned = await analyzeAndCloneVoiceSample({
        audioBlob,
        character: activeMember,
        apiKeys
      });

      const updatedVoiceConfig: CastMember['voiceConfig'] = {
        ...activeMember.voiceConfig,
        voiceName: cloned.recommendedVoiceName,
        pitch: cloned.detectedPitchRatio,
        warmth: cloned.detectedWarmthDb,
        presence: cloned.detectedPresenceDb,
        // Default to false so the character speaks EVERY scene's dialogue line in the video using the cloned timbre/pitch/warmth of the sample!
        useRecordedVoiceDirectly: false,
        voiceSampleBlobUrl: cloned.voiceSampleBlobUrl,
        voiceSampleBase64: cloned.voiceSampleBase64,
        voiceSampleMimeType: cloned.voiceSampleMimeType,
        analyzedTimbreProfile: cloned.analyzedTimbreProfile,
        stylePrompt: cloned.stylePrompt
      };

      const updatedMember: CastMember = {
        ...activeMember,
        voiceConfig: updatedVoiceConfig
      };

      handleUpdateMember(activeMember.id, {
        voiceConfig: updatedVoiceConfig
      });

      // Synthesize a sample line using the newly cloned voice timbre so the user immediately hears how the character will speak in the video!
      await handleTestNeuralVoice(updatedMember);
    } finally {
      setIsAnalyzingSample(false);
    }
  };

  const handleSaveAndClose = () => {
    onSaveCast(members);
    onClose();
  };

  const hasRecordedSample = Boolean(
    activeMember &&
      (recordedBlobsRef.current[activeMember.id] ||
        activeMember.voiceConfig.voiceSampleBase64 ||
        activeMember.voiceConfig.voiceSampleBlobUrl)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white border-t-2 sm:border-2 border-sky-200 rounded-t-3xl sm:rounded-2xl shadow-xl w-full max-w-5xl max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-sky-50 border-b border-sky-200">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 bg-sky-500 text-white rounded-2xl shadow-sm flex-shrink-0">
              <Users className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-extrabold text-slate-800 truncate">
                👥 Cast & Studio Voce in Tempo Reale
              </h2>
              <p className="text-xs text-slate-600 hidden sm:block">
                Seleziona un personaggio, campiona o modifica la voce in tempo reale e personalizza carattere e sottotitoli
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-sky-100 rounded-xl transition flex-shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-sky-100">
          {/* Sidebar Cast List (Horizontal scroll on mobile, vertical column on desktop) */}
          <div className="md:col-span-4 p-4 sm:p-5 bg-sky-50/50 space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleAddMember('HUMAN')}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs sm:text-sm rounded-2xl shadow-sm transition"
              >
                <Plus className="w-4 h-4" /> + Umano
              </button>
              <button
                type="button"
                onClick={() => handleAddMember('ANIMAL')}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs sm:text-sm rounded-2xl shadow-sm transition"
              >
                <Plus className="w-4 h-4" /> + Animale
              </button>
            </div>

            <div className="flex md:flex-col gap-2.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0 pt-1">
              {members.map((m) => {
                const isSelected = m.id === activeMember?.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`flex items-center justify-between p-2.5 sm:p-3 rounded-2xl border cursor-pointer transition flex-shrink-0 min-w-[175px] md:min-w-0 ${
                      isSelected
                        ? 'bg-white border-sky-500 shadow-sm ring-2 ring-sky-200'
                        : 'bg-white/70 border-sky-200 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full overflow-hidden border-2 border-sky-300 bg-sky-100 flex-shrink-0 flex items-center justify-center">
                        {m.referencePhotos[0] ? (
                          <img
                            src={m.referencePhotos[0]}
                            alt={m.name}
                            className="w-full h-full object-cover"
                          />
                        ) : m.type === 'ANIMAL' ? (
                          <Dog className="w-6 h-6 text-amber-600" />
                        ) : (
                          <User className="w-6 h-6 text-sky-600" />
                        )}
                      </div>
                      <div className="truncate">
                        <div className="font-extrabold text-sm sm:text-base text-slate-800 truncate">
                          {m.name}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            m.type === 'ANIMAL'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {m.type === 'ANIMAL' ? '🐾 Animale' : '🧑 Umano'}
                        </span>
                      </div>
                    </div>
                    {members.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMember(m.id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg ml-1"
                        title="Elimina personaggio"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Member Editor */}
          {activeMember && (
            <div className="md:col-span-8 p-4 sm:p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-sky-800 mb-1">
                    Nome Protagonista
                  </label>
                  <input
                    type="text"
                    value={activeMember.name}
                    onChange={(e) => handleUpdateMember(activeMember.id, { name: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-2xl border border-sky-200 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-sky-800 mb-1">
                    Categoria (Umano / Animale)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateMember(activeMember.id, {
                          type: 'HUMAN',
                          subtitleStyle: {
                            ...activeMember.subtitleStyle,
                            badgeText: `🗣️ ${activeMember.name}:`
                          }
                        })
                      }
                      className={`py-2.5 px-3 rounded-2xl font-bold text-sm border transition ${
                        activeMember.type === 'HUMAN'
                          ? 'bg-sky-500 text-white border-sky-600'
                          : 'bg-sky-50 text-sky-800 border-sky-200'
                      }`}
                    >
                      🧑 Umano (Parla)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateMember(activeMember.id, {
                          type: 'ANIMAL',
                          subtitleStyle: {
                            ...activeMember.subtitleStyle,
                            badgeText: `🐕 Pensiero di ${activeMember.name}:`
                          }
                        })
                      }
                      className={`py-2.5 px-3 rounded-2xl font-bold text-sm border transition ${
                        activeMember.type === 'ANIMAL'
                          ? 'bg-amber-500 text-white border-amber-600'
                          : 'bg-sky-50 text-sky-800 border-sky-200'
                      }`}
                    >
                      🐾 Animale (Pensa)
                    </button>
                  </div>
                </div>
              </div>

              {/* STUDIO VOCE CON AGGIORNAMENTO ISTANTANEO SUGLI SLIDER */}
              <div className="p-5 rounded-2xl bg-sky-50 border-2 border-sky-300 space-y-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 pb-3">
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-black text-sky-950">
                      🎙️ Studio Voce & Modificatore Timbro in Tempo Reale
                    </span>
                    <p className="text-xs text-slate-600">
                      Registra/carica la tua voce oppure scegli un Attore Neurale HD: <strong>muovendo gli slider qui sotto il suono cambia e si riascolta istantaneamente!</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={testingVoiceId === activeMember.id}
                    onClick={() => handleTestNeuralVoice(activeMember)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-xs font-black shadow-sm transition"
                  >
                    {testingVoiceId === activeMember.id ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Elaborazione Audio...
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4" />
                        {activeMember.voiceConfig.useRecordedVoiceDirectly && hasRecordedSample
                          ? '🔊 Ascolta La Mia Voce Modificata'
                          : '🔊 Ascolta Prova Voce Reale HD'}
                      </>
                    )}
                  </button>
                </div>

                {/* PASSO 1: REGISTRA O CARICA LA TUA VOCE + SELETTORE MODALITÀ */}
                <div className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wider text-sky-900">
                        🎤 1. Registra o Carica la Tua Voce da Campionare e Modificare
                      </div>
                      <p className="text-xs text-slate-600">
                        Parla al microfono o carica un file audio: potrai usare direttamente la tua voce modificata con Tonalità, Ritmo, Calore e Nitidezza!
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      {!isRecordingSample ? (
                        <button
                          type="button"
                          disabled={isAnalyzingSample}
                          onClick={handleStartRecordingVoiceSample}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-extrabold text-xs shadow-sm transition"
                        >
                          <Mic className="w-4 h-4" /> 🔴 Registra col Microfono
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStopRecordingVoiceSample}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-700 text-white font-extrabold text-xs animate-pulse shadow-sm"
                        >
                          ⏹️ Ferma Registrazione ({recordingSec}s)
                        </button>
                      )}

                      <label className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-xs cursor-pointer transition">
                        <Upload className="w-4 h-4" /> Carica File Audio
                        <input
                          type="file"
                          accept="audio/*,video/*"
                          onChange={handleUploadVoiceSampleFile}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {isAnalyzingSample && (
                    <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs font-bold text-sky-900 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-sky-600" />
                      Acquisizione e preparazione della tua voce per la modifica in tempo reale...
                    </div>
                  )}

                  {/* SELETTORE CHIARO: CLONA TIMBRO SUI DIALOGHI DEL VIDEO vs USA FILE AUDIO DIRETTO */}
                  {hasRecordedSample && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Voce Campionata Acquisita! Scegli come usarla nel video generato:
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const updated: CastMember['voiceConfig'] = {
                              ...activeMember.voiceConfig,
                              useRecordedVoiceDirectly: false
                            };
                            handleUpdateMember(activeMember.id, { voiceConfig: updated });
                            handleTestNeuralVoice({ ...activeMember, voiceConfig: updated });
                          }}
                          className={`py-2.5 px-3 rounded-xl font-extrabold text-xs border transition ${
                            !activeMember.voiceConfig.useRecordedVoiceDirectly
                              ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                              : 'bg-white text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                          }`}
                        >
                          🧬 Clona il Timbro Campionanto su Tutte le Battute del Video (Consigliato)
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const updated: CastMember['voiceConfig'] = {
                              ...activeMember.voiceConfig,
                              useRecordedVoiceDirectly: true
                            };
                            handleUpdateMember(activeMember.id, { voiceConfig: updated });
                            triggerInstantDspUpdateAndPlay(activeMember, updated, true);
                          }}
                          className={`py-2.5 px-3 rounded-xl font-extrabold text-xs border transition ${
                            activeMember.voiceConfig.useRecordedVoiceDirectly
                              ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                              : 'bg-white text-sky-900 border-sky-200 hover:bg-sky-50'
                          }`}
                        >
                          🎤 Riproduci Direttamente la Registrazione Vocale nel Video
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* PASSO 2: SCELTA ATTORE NEURALE (se non in modalità solo voce registrata) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-extrabold text-sky-900 mb-1">
                      2. Attore Neurale HD di Base (Cambiando voce si aggiorna subito l&apos;audio)
                    </label>
                    <select
                      value={activeMember.voiceConfig.voiceName}
                      onChange={(e) => handleVoiceActorChange(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-sky-200 text-xs font-bold bg-white text-slate-800"
                    >
                      {GEMINI_HD_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-sky-900 mb-1">
                      Direzione Attoriale / Intonazione & Accento
                    </label>
                    <input
                      type="text"
                      value={activeMember.voiceConfig.stylePrompt}
                      onChange={(e) =>
                        handleUpdateMember(activeMember.id, {
                          voiceConfig: { ...activeMember.voiceConfig, stylePrompt: e.target.value }
                        })
                      }
                      placeholder="Es. Parlato caldo e naturale, pause realistiche, tono ironico"
                      className="w-full px-3 py-2 rounded-xl border border-sky-200 text-xs bg-white text-slate-800"
                    />
                  </div>
                </div>

                {/* PASSO 3: 4 SLIDER CON RICALCOLO E RIPRODUZIONE ISTANTANEA */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-sky-950">
                      🎛️ 3. Modifica Timbro in Tempo Reale (Sposta uno slider per sentire subito la differenza!):
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const resetCfg: CastMember['voiceConfig'] = {
                          ...activeMember.voiceConfig,
                          pitch: 1.0,
                          speed: 1.0,
                          warmth: 3,
                          presence: 2
                        };
                        handleUpdateMember(activeMember.id, { voiceConfig: resetCfg });
                        triggerInstantDspUpdateAndPlay(activeMember, resetCfg, true);
                      }}
                      className="text-[11px] font-bold text-sky-700 hover:underline"
                    >
                      Ripristina valori naturali (1.0x)
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-white border-2 border-sky-200 shadow-sm">
                      <label className="block text-xs font-extrabold text-sky-950 mb-1">
                        Tonalità ({activeMember.voiceConfig.pitch.toFixed(2)}x)
                      </label>
                      <input
                        type="range"
                        min="0.65"
                        max="1.45"
                        step="0.03"
                        value={activeMember.voiceConfig.pitch}
                        onChange={(e) => handleSliderChange('pitch', parseFloat(e.target.value))}
                        className="w-full accent-sky-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-semibold mt-0.5">
                        <span>Profonda</span>
                        <span>Acuta</span>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white border-2 border-sky-200 shadow-sm">
                      <label className="block text-xs font-extrabold text-sky-950 mb-1">
                        Ritmo ({activeMember.voiceConfig.speed.toFixed(2)}x)
                      </label>
                      <input
                        type="range"
                        min="0.75"
                        max="1.35"
                        step="0.03"
                        value={activeMember.voiceConfig.speed}
                        onChange={(e) => handleSliderChange('speed', parseFloat(e.target.value))}
                        className="w-full accent-sky-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-semibold mt-0.5">
                        <span>Lento</span>
                        <span>Veloce</span>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white border-2 border-sky-200 shadow-sm">
                      <label className="block text-xs font-extrabold text-sky-950 mb-1">
                        Calore Corpo ({activeMember.voiceConfig.warmth ?? 3} dB)
                      </label>
                      <input
                        type="range"
                        min="-10"
                        max="12"
                        step="1"
                        value={activeMember.voiceConfig.warmth ?? 3}
                        onChange={(e) => handleSliderChange('warmth', parseInt(e.target.value, 10))}
                        className="w-full accent-sky-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-semibold mt-0.5">
                        <span>Leggera</span>
                        <span>Radiofonica</span>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white border-2 border-sky-200 shadow-sm">
                      <label className="block text-xs font-extrabold text-sky-950 mb-1">
                        Nitidezza ({activeMember.voiceConfig.presence ?? 2} dB)
                      </label>
                      <input
                        type="range"
                        min="-8"
                        max="12"
                        step="1"
                        value={activeMember.voiceConfig.presence ?? 2}
                        onChange={(e) =>
                          handleSliderChange('presence', parseInt(e.target.value, 10))
                        }
                        className="w-full accent-sky-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-semibold mt-0.5">
                        <span>Morbida</span>
                        <span>Cristallina</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Player Anteprima Audio Generato & Modificato in Tempo Reale */}
                <div className="pt-1">
                  {isApplyingLiveDsp && (
                    <span className="text-[11px] font-bold text-sky-700 block mb-1">
                      ⚡ Applicazione istantanea modifica timbro in corso...
                    </span>
                  )}
                  <audio
                    ref={audioPlayerRef}
                    controls
                    src={previewAudioUrl || undefined}
                    className="w-full h-10"
                  />
                </div>
              </div>

              {/* FOTO DI RIFERIMENTO (1 A 5) */}
              <div className="p-5 rounded-2xl bg-sky-50/70 border border-sky-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="block text-sm font-black text-sky-950">
                      📸 Foto di Riferimento del Personaggio (da 1 a 5 foto)
                    </label>
                    <p className="text-xs text-slate-600">
                      Usate da Gemini per riconoscere chi appare nei tuoi video e da Veo 3.1 per animare il personaggio
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-white border border-sky-200 text-xs font-extrabold text-sky-800">
                    {activeMember.referencePhotos.length}/5 caricate
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {activeMember.referencePhotos.map((photo, idx) => (
                    <div
                      key={idx}
                      className="relative w-24 h-28 rounded-2xl overflow-hidden border-2 border-sky-300 bg-white group shadow-sm"
                    >
                      <img src={photo} alt={activeMember.name} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateMember(activeMember.id, {
                            referencePhotos: activeMember.referencePhotos.filter((_, i) => i !== idx)
                          })
                        }
                        className="absolute top-1.5 right-1.5 bg-rose-600 text-white p-1.5 rounded-full opacity-90 hover:opacity-100 shadow transition"
                        title="Rimuovi foto"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {activeMember.referencePhotos.length < 5 && (
                    <>
                      <label className="w-24 h-28 rounded-2xl border-2 border-dashed border-sky-400 bg-white hover:bg-sky-100 flex flex-col items-center justify-center cursor-pointer text-sky-700 transition shadow-sm">
                        <Upload className="w-6 h-6 mb-1 text-sky-500" />
                        <span className="text-xs font-extrabold">Galleria</span>
                        <span className="text-[10px] text-slate-500">+ Più Foto</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            const selected = Array.from(e.target.files || []);
                            e.currentTarget.value = '';
                            handlePhotoFilesUpload(selected);
                          }}
                          className="hidden"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => setIsCloudPhotoOpen(true)}
                        className="w-28 h-28 rounded-2xl border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-sky-100 hover:from-indigo-100 hover:to-sky-200 flex flex-col items-center justify-center cursor-pointer text-indigo-900 transition shadow-sm p-2 text-center"
                      >
                        <Cloud className="w-6 h-6 mb-1 text-indigo-600" />
                        <span className="text-[11px] font-black leading-tight">
                          Cerca Drive / Google Foto
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* CARATTERE, UMORISMO & MODO DI PARLARE/PENSARE (SPAZIOSO, FULL-WIDTH, OTTIMIZZATO MOBILE) */}
              <div className="p-5 rounded-2xl bg-sky-50/70 border border-sky-200 space-y-3">
                <div>
                  <label className="block text-sm font-black text-sky-950">
                    🎭 Carattere, Umorismo & Modo di Parlare / Pensare
                  </label>
                  <p className="text-xs text-slate-600">
                    Descrivi la personalità: l&apos;IA userà queste indicazioni per scrivere battute o pensieri sempre fedeli al personaggio
                  </p>
                </div>
                <textarea
                  rows={4}
                  value={activeMember.personalityPrompt}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, { personalityPrompt: e.target.value })
                  }
                  placeholder="Es. Golden Retriever saggia ma calcolatrice spietata quando si tratta di biscotti e comodità sul divano..."
                  className="w-full p-4 rounded-2xl border-2 border-sky-200 bg-white text-sm sm:text-base font-medium text-slate-800 leading-relaxed focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 resize-y min-h-[110px]"
                />
              </div>

              {/* RAPPORTI E DINAMICHE TRA I PERSONAGGI (es. A e B si vogliono bene, C e D sempre in combutta!) */}
              <div className="p-5 rounded-2xl bg-sky-50 border-2 border-sky-300 space-y-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 pb-3">
                  <div>
                    <label className="inline-flex items-center gap-1.5 text-sm font-black text-sky-950">
                      <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                      💞 Rapporti e Dinamiche di {activeMember.name} con gli altri Personaggi
                    </label>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Indica in che rapporto stanno i personaggi tra loro (es. <strong>chi si vuole bene</strong>, <strong>chi è sempre in combutta</strong>, <strong>chi litiga per il divano</strong>): l&apos;IA ne terrà conto nei dialoghi e quando interagiscono!
                    </p>
                  </div>
                </div>

                {members.filter((m) => m.id !== activeMember.id).length === 0 ? (
                  <div className="p-4 rounded-xl bg-white border border-sky-200 text-xs text-slate-500 text-center">
                    Aggiungi almeno un secondo personaggio nel Cast qui a sinistra per definire i rapporti tra loro!
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {members
                      .filter((m) => m.id !== activeMember.id)
                      .map((otherMember) => {
                        const existingRel = activeMember.relationships?.find(
                          (r) => r.targetCharacterId === otherMember.id
                        );
                        const currentType: RelationshipPresetType =
                          existingRel?.relationType || 'LOVE_AFFECTION';
                        const currentDesc =
                          existingRel?.description ??
                          RELATIONSHIP_PRESETS[0].buildDefaultText(
                            activeMember.name,
                            otherMember.name
                          );

                        return (
                          <div
                            key={otherMember.id}
                            className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3 shadow-xs"
                          >
                            {/* Intestazione Coppia: ActiveMember ↔️ OtherMember */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5">
                                <div className="flex items-center -space-x-2">
                                  <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-sky-400 bg-sky-100">
                                    {activeMember.referencePhotos[0] ? (
                                      <img
                                        src={activeMember.referencePhotos[0]}
                                        alt={activeMember.name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : null}
                                  </div>
                                  <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-amber-400 bg-amber-100">
                                    {otherMember.referencePhotos[0] ? (
                                      <img
                                        src={otherMember.referencePhotos[0]}
                                        alt={otherMember.name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : null}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-sm font-black text-slate-800">
                                    {activeMember.name} ↔️ {otherMember.name}
                                  </span>
                                  <span className="block text-[11px] font-semibold text-sky-700">
                                    Scegli il tipo di legame o scrivi i dettagli qui sotto:
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Preset rapidi (Si vogliono bene, Sempre in combutta, Bisticci, ecc.) */}
                            <div className="flex flex-wrap gap-1.5">
                              {RELATIONSHIP_PRESETS.map((preset) => {
                                const isActive = currentType === preset.type;
                                return (
                                  <button
                                    key={preset.type}
                                    type="button"
                                    onClick={() =>
                                      handleUpdateRelationship(
                                        activeMember.id,
                                        otherMember.id,
                                        preset.type,
                                        preset.buildDefaultText(activeMember.name, otherMember.name)
                                      )
                                    }
                                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition ${
                                      isActive
                                        ? 'bg-sky-600 text-white border-sky-700 shadow-xs'
                                        : 'bg-sky-50 text-sky-900 border-sky-200 hover:bg-sky-100'
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Descrizione libera del rapporto */}
                            <div>
                              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-sky-900 mb-1">
                                Come interagiscono {activeMember.name} e {otherMember.name}?
                              </label>
                              <textarea
                                rows={2}
                                value={currentDesc}
                                onChange={(e) =>
                                  handleUpdateRelationship(
                                    activeMember.id,
                                    otherMember.id,
                                    currentType,
                                    e.target.value
                                  )
                                }
                                placeholder={`Es. ${activeMember.name} e ${otherMember.name} sono sempre in combutta per rubare i biscotti...`}
                                className="w-full p-3 rounded-xl border border-sky-200 bg-sky-50/40 focus:bg-white text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:border-sky-500 resize-y"
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* STILE SOTTOTITOLO FUMETTO & RUOLO NEI TITOLI DI CODA */}
              <div className="p-5 rounded-2xl bg-sky-50/70 border border-sky-200 space-y-4">
                <div>
                  <label className="block text-sm font-black text-sky-950">
                    💬 Stile Fumetto Sottotitoli & Qualifica nei Titoli di Coda
                  </label>
                  <p className="text-xs text-slate-600">
                    Personalizza l&apos;etichetta del fumetto, i colori e il ruolo ironico mostrato a fine puntata
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-extrabold uppercase tracking-wider text-sky-900 mb-1.5">
                      Etichetta Badge nel Fumetto
                    </label>
                    <input
                      type="text"
                      value={activeMember.subtitleStyle.badgeText}
                      onChange={(e) =>
                        handleUpdateMember(activeMember.id, {
                          subtitleStyle: {
                            ...activeMember.subtitleStyle,
                            badgeText: e.target.value
                          }
                        })
                      }
                      className="w-full px-4 py-3 rounded-2xl border-2 border-sky-200 bg-white text-sm font-bold text-slate-800 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold uppercase tracking-wider text-sky-900 mb-1.5">
                      Ruolo Fisso o Ironico nei Titoli di Coda
                    </label>
                    <input
                      type="text"
                      value={activeMember.defaultCreditRole}
                      onChange={(e) =>
                        handleUpdateMember(activeMember.id, { defaultCreditRole: e.target.value })
                      }
                      className="w-full px-4 py-3 rounded-2xl border-2 border-sky-200 bg-white text-sm font-semibold text-slate-800 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {/* Color Pickers + Live Bubble Preview */}
                <div className="p-4 rounded-2xl bg-white border border-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="color"
                        value={activeMember.subtitleStyle.bgColor}
                        onChange={(e) =>
                          handleUpdateMember(activeMember.id, {
                            subtitleStyle: { ...activeMember.subtitleStyle, bgColor: e.target.value }
                          })
                        }
                        className="w-11 h-11 rounded-xl border-2 border-sky-200 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-700">Colore Sfondo</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="color"
                        value={activeMember.subtitleStyle.textColor}
                        onChange={(e) =>
                          handleUpdateMember(activeMember.id, {
                            subtitleStyle: {
                              ...activeMember.subtitleStyle,
                              textColor: e.target.value
                            }
                          })
                        }
                        className="w-11 h-11 rounded-xl border-2 border-sky-200 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-700">Colore Testo</span>
                    </label>
                  </div>

                  <div
                    style={{
                      backgroundColor: activeMember.subtitleStyle.bgColor,
                      color: activeMember.subtitleStyle.textColor
                    }}
                    className="px-4 py-2.5 rounded-2xl text-sm font-black border-2 border-black/10 shadow-sm text-center"
                  >
                    {activeMember.subtitleStyle.badgeText} &quot;Anteprima fumetto in video!&quot;
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Mobile-Friendly */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-sky-50 border-t border-sky-200">
          <div className="hidden sm:flex items-center gap-2 text-xs text-sky-800 font-bold">
            <Sparkles className="w-4 h-4 text-sky-500" />
            Modifica istantanea della voce e salvataggio nella Serie
          </div>
          <div className="flex gap-2.5 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-5 py-3 rounded-2xl bg-sky-100 text-sky-800 hover:bg-sky-200 font-extrabold text-sm transition"
            >
              Annulla
            </button>
            <button
              onClick={handleSaveAndClose}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-sm shadow-sm transition"
            >
              <Check className="w-4 h-4" /> Salva Cast & Voci
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialogModal
        dialog={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />

      <CloudMediaPickerModal
        isOpen={isCloudPhotoOpen}
        onClose={() => setIsCloudPhotoOpen(false)}
        onFilesImported={(files) => handlePhotoFilesUpload(files)}
        allowVideos={false}
        allowImages={true}
        titleContext={`Foto di ${activeMember?.name || 'Personaggio'}`}
      />
    </div>
  );
};
