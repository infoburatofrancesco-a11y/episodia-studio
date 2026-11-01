import React, { useState, useRef, useEffect } from 'react';
import {
  Clock,
  Upload,
  Music,
  Mic,
  Sparkles,
  Video,
  Image as ImageIcon,
  Trash2,
  Volume2,
  CheckCircle2,
  Wand2,
  Cloud,
  Search,
  Crosshair,
  Eye,
  Lightbulb,
  RefreshCw
} from 'lucide-react';
import {
  CastMember,
  IntroOutroConfig,
  UploadedMediaItem,
  BackgroundMusicConfig,
  SeriesGenreStyle,
  ApiKeysConfig,
  AiPlotProposal
} from '../types/studio';
import {
  inspectUploadedVideo,
  inspectUploadedPhoto,
  extractAudioFromVideoOrAudioFile,
  generateDemoSitcomMusicBlob
} from '../services/audioExtractorService';
import {
  recognizeCharactersInUploadedMedia,
  proposeEpisodePlotsFromTitleAndPhotos
} from '../services/aiService';
import { CloudMediaPickerModal } from './CloudMediaPickerModal';

interface Step1DurationAndMaterialProps {
  seriesTitle?: string;
  seriesDescription?: string;
  seriesGenreStyle?: SeriesGenreStyle;
  seriesCustomStylePrompt?: string;
  apiKeys?: ApiKeysConfig;
  episodeTitle?: string;
  onChangeEpisodeTitle?: (title: string) => void;
  targetTotalDurationSec: number;
  onChangeTargetDuration: (sec: number) => void;
  branding: IntroOutroConfig;
  onOpenBrandingModal?: () => void;
  cast: CastMember[];
  uploadedMedia: UploadedMediaItem[];
  onChangeUploadedMedia: (items: UploadedMediaItem[]) => void;
  backgroundMusic?: BackgroundMusicConfig;
  onChangeBackgroundMusic: (bgm?: BackgroundMusicConfig) => void;
  rawIdea: string;
  onChangeRawIdea: (idea: string) => void;
  onGenerateStoryboard: () => void;
  isGeneratingStoryboard: boolean;
}

export const Step1DurationAndMaterial: React.FC<Step1DurationAndMaterialProps> = ({
  seriesTitle = '',
  seriesDescription = '',
  seriesGenreStyle,
  seriesCustomStylePrompt,
  apiKeys = { geminiApiKey: '', preferVeoCloud: false },
  episodeTitle = '',
  onChangeEpisodeTitle,
  targetTotalDurationSec,
  onChangeTargetDuration,
  branding,
  onOpenBrandingModal,
  cast,
  uploadedMedia,
  onChangeUploadedMedia,
  backgroundMusic,
  onChangeBackgroundMusic,
  rawIdea,
  onChangeRawIdea,
  onGenerateStoryboard,
  isGeneratingStoryboard
}) => {
  const [customMin, setCustomMin] = useState<number>(Math.floor(targetTotalDurationSec / 60));
  const [customSec, setCustomSec] = useState<number>(targetTotalDurationSec % 60);
  const [customMinInput, setCustomMinInput] = useState<string>(
    String(Math.floor(targetTotalDurationSec / 60))
  );
  const [customSecInput, setCustomSecInput] = useState<string>(
    String(targetTotalDurationSec % 60)
  );
  const [showCustomDuration, setShowCustomDuration] = useState<boolean>(
    ![60, 120, 180].includes(targetTotalDurationSec)
  );
  const [isListeningSpeech, setIsListeningSpeech] = useState(false);
  const [isExtractingMusic, setIsExtractingMusic] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isRecognizingCast, setIsRecognizingCast] = useState(false);
  const [isProposingPlots, setIsProposingPlots] = useState(false);
  const [aiVisualSummary, setAiVisualSummary] = useState<string>('');
  const [aiPlotProposals, setAiPlotProposals] = useState<AiPlotProposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);

  const introSec = branding.introEnabled ? branding.introDurationSec : 0;
  const outroSec = branding.outroEnabled ? branding.outroDurationSec : 0;
  const netContentSec = Math.max(5, Math.round(targetTotalDurationSec - introSec - outroSec));

  // Smart Pacing Recipe calculation
  const recommendedVideoTotalSec = Math.round(netContentSec * 0.62);
  const recommendedPhotoTotalSec = netContentSec - recommendedVideoTotalSec;
  const recommendedVideosCount = Math.max(2, Math.round(recommendedVideoTotalSec / 7.5));
  const recommendedPhotosCount = Math.max(2, Math.round(recommendedPhotoTotalSec / 5));

  const mediaList = uploadedMedia || [];
  const coveredSeconds = mediaList.reduce((acc, m) => acc + m.usedDurationSec, 0);
  const missingSeconds = Math.max(0, netContentSec - coveredSeconds);
  const progressPercent = Math.min(100, Math.round((coveredSeconds / netContentSec) * 100));

  const uploadedMediaRef = useRef<UploadedMediaItem[]>(mediaList);
  useEffect(() => {
    uploadedMediaRef.current = mediaList;
  }, [mediaList]);

  const handlePresetClick = (sec: number) => {
    setShowCustomDuration(false);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    setCustomMin(m);
    setCustomSec(s);
    setCustomMinInput(String(m));
    setCustomSecInput(String(s));
    onChangeTargetDuration(sec);
  };

  const handleApplyCustomDuration = (m: number, s: number) => {
    const cleanMin = Math.max(0, Math.min(20, m));
    const cleanSec = Math.max(0, Math.min(59, s));
    setCustomMin(cleanMin);
    setCustomSec(cleanSec);
    const total = Math.max(15, cleanMin * 60 + cleanSec);
    onChangeTargetDuration(total);
  };

  const handleMediaDropOrSelect = async (filesList: FileList | File[] | null) => {
    if (!filesList || filesList.length === 0) return;
    const files = Array.from(filesList);
    setIsUploadingMedia(true);
    const newItems: UploadedMediaItem[] = [];
    const currentList = uploadedMediaRef.current || [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fallbackChar = cast[(currentList.length + i) % Math.max(1, cast.length)]?.id;
        const defaultCharIds = fallbackChar ? [fallbackChar] : [];
        const isVideo =
          file.type.startsWith('video/') ||
          /\.(mp4|mov|webm|m4v|avi|mkv|3gp|flv|wmv|ts)$/i.test(file.name);

        try {
          if (isVideo) {
            const info = await inspectUploadedVideo(file);
            const usedSec = Math.min(10, Math.max(4, Math.round(info.durationSec)));
            newItems.push({
              id: `media-vid-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name,
              type: 'VIDEO',
              blobUrl: info.blobUrl,
              base64Preview: info.base64Keyframe,
              originalDurationSec: info.durationSec,
              usedDurationSec: usedSec,
              assignedCharacterId: fallbackChar,
              assignedCharacterIds: defaultCharIds,
              recognitionStatus: cast.length > 0 ? 'ANALYZING' : 'MANUAL'
            });
          } else {
            const info = await inspectUploadedPhoto(file);
            newItems.push({
              id: `media-img-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name,
              type: 'PHOTO',
              blobUrl: info.blobUrl || info.base64Preview,
              base64Preview: info.base64Preview,
              originalDurationSec: 5,
              usedDurationSec: 5,
              assignedCharacterId: fallbackChar,
              assignedCharacterIds: defaultCharIds,
              recognitionStatus: cast.length > 0 ? 'ANALYZING' : 'MANUAL'
            });
          }
        } catch (err) {
          console.warn('Errore elaborazione singolo file, fallback resiliente:', file.name, err);
          const fallbackUrl = URL.createObjectURL(file);
          newItems.push({
            id: `media-${isVideo ? 'vid' : 'img'}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            type: isVideo ? 'VIDEO' : 'PHOTO',
            blobUrl: fallbackUrl,
            base64Preview: isVideo ? '' : fallbackUrl,
            originalDurationSec: isVideo ? 8 : 5,
            usedDurationSec: isVideo ? 8 : 5,
            assignedCharacterId: fallbackChar,
            assignedCharacterIds: defaultCharIds,
            recognitionStatus: cast.length > 0 ? 'ANALYZING' : 'MANUAL'
          });
        }
      }

      if (newItems.length > 0) {
        // Step 1: Update UI IMMEDIATELY so the user instantly sees all uploaded cards!
        const mergedList = [...(uploadedMediaRef.current || mediaList), ...newItems];
        uploadedMediaRef.current = mergedList;
        onChangeUploadedMedia(mergedList);
        setIsUploadingMedia(false);

        // Step 2: Run AI Cast recognition asynchronously in background without freezing UI
        if (cast.length > 0) {
          setIsRecognizingCast(true);
          recognizeCharactersInUploadedMedia({
            mediaItems: newItems,
            cast,
            seriesTitle,
            apiKeys: apiKeys || { geminiApiKey: '', preferVeoCloud: false, preferCloudTts: false }
          }).then((recognizedBatch) => {
            const batchMap = new Map(recognizedBatch.map((it) => [it.id, it]));
            const updated = uploadedMediaRef.current.map((item) =>
              batchMap.has(item.id) ? batchMap.get(item.id)! : item
            );
            uploadedMediaRef.current = updated;
            onChangeUploadedMedia(updated);
          }).catch((e) => {
            console.warn('Background character recognition skipped:', e);
          }).finally(() => {
            setIsRecognizingCast(false);
          });
        }
      }
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleRunAiCharacterRecognition = async () => {
    if (uploadedMedia.length === 0 || cast.length === 0) return;
    setIsRecognizingCast(true);
    try {
      const recognized = await recognizeCharactersInUploadedMedia({
        mediaItems: uploadedMedia,
        cast,
        seriesTitle,
        apiKeys
      });
      onChangeUploadedMedia(recognized);
    } finally {
      setIsRecognizingCast(false);
    }
  };

  const handleProposeAiPlots = async () => {
    setIsProposingPlots(true);
    try {
      const res = await proposeEpisodePlotsFromTitleAndPhotos({
        seriesTitle: seriesTitle || 'Serie Originale',
        seriesDescription,
        episodeTitle: episodeTitle || '',
        currentRawIdea: rawIdea,
        genreStyle: seriesGenreStyle,
        customStylePrompt: seriesCustomStylePrompt,
        cast,
        uploadedMedia,
        apiKeys
      });
      setAiVisualSummary(res.visualSummary);
      setAiPlotProposals(res.proposals);
      if (res.updatedMedia && res.updatedMedia.length > 0) {
        onChangeUploadedMedia(res.updatedMedia);
      }
    } finally {
      setIsProposingPlots(false);
    }
  };

  const handleMusicFileUpload = async (filesList: FileList | null) => {
    if (!filesList || filesList.length === 0) return;
    const file = filesList[0];
    setIsExtractingMusic(true);
    try {
      const extracted = await extractAudioFromVideoOrAudioFile(file);
      onChangeBackgroundMusic({
        sourceFileName: `${file.name} (Solo Audio Estratto)`,
        extractedAudioBlobUrl: extracted.audioBlobUrl,
        durationSec: extracted.durationSec,
        volume: 0.6,
        autoDucking: true
      });
    } finally {
      setIsExtractingMusic(false);
    }
  };

  const handleLoadDemoMusic = async () => {
    setIsExtractingMusic(true);
    try {
      const demo = await generateDemoSitcomMusicBlob();
      onChangeBackgroundMusic({
        sourceFileName: demo.sourceFileName,
        extractedAudioBlobUrl: demo.audioBlobUrl,
        durationSec: demo.durationSec,
        volume: 0.6,
        autoDucking: true
      });
    } finally {
      setIsExtractingMusic(false);
    }
  };

  const handleDictateIdea = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      const c1 = cast[0]?.name || 'il protagonista';
      const c2 = cast[1]?.name || 'il socio';
      onChangeRawIdea(
        rawIdea
          ? `${rawIdea} In più ${c1} sorprende tutti con una battuta finale imprevedibile!`
          : `Nella serie "${seriesTitle || 'Studio'}", ${c1}${
              cast.length > 1 ? ` e ${c2}` : ''
            } affrontano un imprevisto clamoroso e ribaltano la situazione con grande ironia.`
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SpeechRec as any)();
    recognition.lang = 'it-IT';
    recognition.interimResults = false;
    setIsListeningSpeech(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        onChangeRawIdea((rawIdea ? rawIdea + ' ' : '') + transcript);
      }
      setIsListeningSpeech(false);
    };
    recognition.onerror = () => setIsListeningSpeech(false);
    recognition.onend = () => setIsListeningSpeech(false);
    recognition.start();
  };

  return (
    <div className="space-y-6">
      {/* 1. SELETTORE DURATA FINALE PUNTATA */}
      <div className="bg-white border-2 border-sky-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="inline-block px-3 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-extrabold uppercase tracking-wider mb-1">
              Passo 1 di 3 • Calcolatore Intelligente Tempi
            </span>
            <h2 className="text-2xl font-black text-slate-800">
              ⏱️ Quanto deve durare l&apos;episodio finito?
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold text-slate-500 block">DURATA TOTALE SCELTA</span>
            <span className="text-3xl font-black text-sky-600">
              {Math.floor(targetTotalDurationSec / 60)}m{' '}
              {String(targetTotalDurationSec % 60).padStart(2, '0')}s ({targetTotalDurationSec}s)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { sec: 60, label: '⏱️ 1 Minuto (60s)', sub: 'Ideale per Reel / Shorts / TikTok' },
            { sec: 120, label: '⏱️ 2 Minuti (120s)', sub: 'Sketch narrativo completo' },
            { sec: 180, label: '⏱️ 3 Minuti (180s)', sub: 'Puntata speciale estesa' }
          ].map((preset) => {
            const active = !showCustomDuration && targetTotalDurationSec === preset.sec;
            return (
              <button
                key={preset.sec}
                type="button"
                onClick={() => handlePresetClick(preset.sec)}
                className={`p-4 rounded-2xl border-2 text-left transition flex flex-col justify-between ${
                  active
                    ? 'bg-sky-500 text-white border-sky-600 shadow-md scale-[1.01]'
                    : 'bg-sky-50/70 hover:bg-sky-100 text-slate-800 border-sky-200'
                }`}
              >
                <div className="text-lg font-extrabold">{preset.label}</div>
                <div className={`text-xs mt-1 ${active ? 'text-sky-100' : 'text-slate-500'}`}>
                  {preset.sub}
                </div>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowCustomDuration(true)}
            className={`p-4 rounded-2xl border-2 text-left transition flex flex-col justify-between ${
              showCustomDuration
                ? 'bg-sky-500 text-white border-sky-600 shadow-md'
                : 'bg-sky-50/70 hover:bg-sky-100 text-slate-800 border-sky-200'
            }`}
          >
            <div className="text-lg font-extrabold">✏️ Imposta a mano (Min:Sec)</div>
            <div
              className={`text-xs mt-1 ${showCustomDuration ? 'text-sky-100' : 'text-slate-500'}`}
            >
              Scegli la durata al secondo esatto
            </div>
          </button>
        </div>

        {showCustomDuration && (
          <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 flex flex-wrap items-center gap-4">
            <span className="font-bold text-sm text-sky-900">
              Imposta durata personalizzata (Minuti e Secondi):
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="20"
                value={customMinInput}
                onChange={(e) => {
                  setCustomMinInput(e.target.value);
                  const parsed = parseInt(e.target.value, 10);
                  if (!isNaN(parsed) && parsed >= 0) {
                    handleApplyCustomDuration(parsed, customSec);
                  }
                }}
                onBlur={() => {
                  const valid = Math.max(0, parseInt(customMinInput, 10) || 0);
                  setCustomMinInput(String(valid));
                  handleApplyCustomDuration(valid, customSec);
                }}
                className="w-20 px-3 py-2 rounded-xl border border-sky-300 font-extrabold text-center text-lg bg-white"
              />
              <span className="font-bold text-slate-700">min</span>
              <input
                type="number"
                min="0"
                max="59"
                value={customSecInput}
                onChange={(e) => {
                  setCustomSecInput(e.target.value);
                  const parsed = parseInt(e.target.value, 10);
                  if (!isNaN(parsed) && parsed >= 0) {
                    handleApplyCustomDuration(customMin, parsed);
                  }
                }}
                onBlur={() => {
                  const valid = Math.max(0, Math.min(59, parseInt(customSecInput, 10) || 0));
                  setCustomSecInput(String(valid));
                  handleApplyCustomDuration(customMin, valid);
                }}
                className="w-20 px-3 py-2 rounded-xl border border-sky-300 font-extrabold text-center text-lg bg-white"
              />
              <span className="font-bold text-slate-700">sec</span>
            </div>
            <span className="text-xs font-semibold text-sky-800">
              = Totale esatto: <strong>{targetTotalDurationSec} secondi</strong>
            </span>
          </div>
        )}

        {/* 2. SMART PACING CALCULATOR ("RICETTA CONSIGLIATA & RIEMPIMENTO TEMPO") */}
        <div className="p-4 sm:p-5 rounded-2xl bg-sky-50 border-2 border-sky-200 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-sky-200">
            <div className="flex flex-wrap items-center gap-1.5 text-sky-950 font-extrabold text-sm sm:text-base">
              <Clock className="w-5 h-5 text-sky-600 flex-shrink-0" />
              <span>
                Durata Finale: <strong>{targetTotalDurationSec}s</strong> ={' '}
                <span className="px-2 py-0.5 rounded-lg bg-white border border-sky-200">
                  🎬 {introSec}s Sigla
                </span>{' '}
                +{' '}
                <span className="px-2.5 py-0.5 rounded-lg bg-sky-500 text-white">
                  🎭 {netContentSec}s Sketch
                </span>{' '}
                +{' '}
                <span className="px-2 py-0.5 rounded-lg bg-white border border-sky-200">
                  🏁 {outroSec}s Coda
                </span>
              </span>
            </div>

            {onOpenBrandingModal && (
              <button
                type="button"
                onClick={onOpenBrandingModal}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs sm:text-sm shadow-sm transition"
              >
                🎬 Studio Sigla & Titoli di Coda (Video/Foto/Audio)
              </button>
            )}
          </div>

          <div className="text-sm text-sky-900 leading-relaxed">
            💡 <strong>Ricetta Consigliata per riempire i {netContentSec}s di sketch:</strong> ti
            consigliamo{' '}
            <strong>
              {recommendedVideosCount} o {recommendedVideosCount + 1} spezzoni tuoi video (da ~7-8s
              l&apos;uno)
            </strong>{' '}
            +{' '}
            <strong>
              {recommendedPhotosCount} o {recommendedPhotosCount + 1} foto da animare con IA (da ~5s
              l&apos;una)
            </strong>
            .
          </div>

          {/* Barra di Progresso Materiale Caricato */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-sky-900">
                📊 Materiale visivo caricato finora: {coveredSeconds}s su {netContentSec}s (
                {progressPercent}%)
              </span>
              <span className="text-sky-700">
                {missingSeconds > 0
                  ? `Mancano ${missingSeconds}s (verranno coperti dalle foto del Cast animate con IA!)`
                  : '✅ Budget secondi coperto al 100%!'}
              </span>
            </div>
            <div className="w-full h-4 bg-white rounded-full overflow-hidden border border-sky-200 p-0.5">
              <div
                className="h-full bg-gradient-to-r from-sky-400 to-sky-600 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(6, progressPercent)}%` }}
              />
            </div>
            <p className="text-xs text-slate-600 font-medium">
              {missingSeconds > 0 ? (
                <>
                  Hai coperto <strong>{coveredSeconds}s su {netContentSec}s</strong>. Aggiungi
                  ancora ~{Math.max(1, Math.round(missingSeconds / 8))} video (da 8s) o ~
                  {Math.max(1, Math.round(missingSeconds / 5))} foto IA (da 5s),{' '}
                  <strong>
                    oppure lascia che l&apos;IA generi automaticamente le scene mancanti dalle foto
                    del Cast ({cast.map((c) => c.name).join(', ')})!
                  </strong>
                </>
              ) : (
                <>
                  Ottimo! Hai caricato materiale sufficiente per coprire tutti i {netContentSec}s
                  netti dello sketch.
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* 3. DROPZONE MATERIALE VISIVO + 4. DROPZONE COLONNA SONORA DA VIDEO MUSICALE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Dropzone Video & Foto Utente */}
        <div className="lg:col-span-7 bg-white border-2 border-sky-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                <Video className="w-5 h-5 text-sky-500" />
                Materiale Visivo (Foto &amp; Video da cui l&apos;AI elaborerà i Singoli Video)
              </h3>
              <p className="text-xs text-slate-500">
                Carica le tue foto (.jpg, .png) e i tuoi video (.mp4, .mov): l&apos;AI riconosce i personaggi, elabora un singolo video per ciascuna scena sulla base delle tue indicazioni e poi li unisce in un collage finale!
              </p>
            </div>
          </div>

          {/* COME FUNZIONA LA NUOVA MODALITÀ: SINGOLI VIDEO AI + COLLAGE FINALE */}
          <details className="group rounded-2xl bg-sky-50/90 border-2 border-sky-200 p-3.5 text-xs text-slate-700">
            <summary className="cursor-pointer font-black text-sky-950 flex items-center justify-between gap-2 select-none">
              <span>🎬 Come funziona la Generazione Singoli Video AI + Collage Finale (Zero Lip-Sync artificiale)</span>
              <span className="px-2 py-0.5 rounded-lg bg-sky-200 text-sky-950 text-[10px] font-extrabold">
                Flusso AI ▼
              </span>
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2.5 border-t border-sky-200/80">
              <div className="p-2.5 rounded-xl bg-white border border-sky-200 space-y-1">
                <strong className="text-sky-950 block">🔍 1. Analisi Foto &amp; Personaggi</strong>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>L&apos;AI analizza le foto e i video caricati e riconosce automaticamente i personaggi del tuo Cast.</li>
                  <li>Puoi scrivere un&apos;indicazione specifica sotto ogni foto/video o usare le <strong>3 Trame AI proposte</strong>.</li>
                </ul>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-sky-200 space-y-1">
                <strong className="text-purple-950 block">🎥 2. Elaborazione Singoli Video AI</strong>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>Nello Step 2 l&apos;AI elabora un <strong>singolo video autonomo per ogni scena</strong> partendo dal materiale e dalle indicazioni di regia.</li>
                  <li>Puoi vedere, rigenerare o scaricare ogni singolo video prima del montaggio.</li>
                </ul>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-sky-200 space-y-1">
                <strong className="text-emerald-950 block">🎞️ 3. Collage Finale Automatico</strong>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>Nello Step 3 tutti i singoli video generati vengono uniti in sequenza nel <strong>Collage Video Finale</strong> con transizioni cinematografiche, voci e musica.</li>
                </ul>
              </div>
            </div>
          </details>

          <div className="space-y-2.5">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = Array.from(e.dataTransfer.files || []);
                handleMediaDropOrSelect(dropped);
              }}
              className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-sky-300 hover:border-sky-500 rounded-2xl bg-sky-50/70 hover:bg-sky-100/60 cursor-pointer transition text-center"
            >
              <Upload className="w-8 h-8 text-sky-500 mb-1.5" />
              <span className="font-extrabold text-sky-900 text-sm">
                {isUploadingMedia
                  ? 'Analisi fotogrammi e riconoscimento personaggi in corso...'
                  : '📹📷 Clicca o trascina per Caricare Più Video e Foto insieme'}
              </span>
              <span className="text-xs text-slate-500 mt-1">
                Puoi selezionare tutti i file che vuoi in una volta sola oppure aggiungerli in più volte!
              </span>
              <input
                type="file"
                accept="video/*,image/*,.mp4,.mov,.webm,.m4v,.avi,.mkv,.jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.avif"
                multiple
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = '';
                  if (files.length > 0) {
                    handleMediaDropOrSelect(files);
                  }
                }}
                className="hidden"
              />
            </label>

            {/* Pulsanti rapidi separati per Galleria Foto/Video + Google Drive & Google Foto */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="py-2.5 px-3 rounded-xl bg-sky-100 hover:bg-sky-200 border border-sky-300 text-sky-950 font-extrabold text-xs cursor-pointer transition flex items-center justify-center gap-1.5 text-center shadow-2xs">
                <ImageIcon className="w-4 h-4 text-sky-600 flex-shrink-0" />
                <span>📷 + Seleziona Più Foto (Galleria)</span>
                <input
                  type="file"
                  accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.bmp,.avif"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = '';
                    if (files.length > 0) {
                      handleMediaDropOrSelect(files);
                    }
                  }}
                  className="hidden"
                />
              </label>

              <label className="py-2.5 px-3 rounded-xl bg-sky-100 hover:bg-sky-200 border border-sky-300 text-sky-950 font-extrabold text-xs cursor-pointer transition flex items-center justify-center gap-1.5 text-center shadow-2xs">
                <Video className="w-4 h-4 text-sky-600 flex-shrink-0" />
                <span>📹 + Seleziona Più Video (Galleria)</span>
                <input
                  type="file"
                  accept="video/*,.mp4,.mov,.webm,.m4v,.avi,.mkv,.3gp,.flv,.wmv,.ts"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = '';
                    if (files.length > 0) {
                      handleMediaDropOrSelect(files);
                    }
                  }}
                  className="hidden"
                />
              </label>

              {/* Pulsante Ricerca Cloud Google Drive & Google Foto */}
              <button
                type="button"
                onClick={() => setIsCloudModalOpen(true)}
                className="py-3 px-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white font-black text-xs cursor-pointer transition flex items-center justify-center gap-2 text-center shadow-sm"
              >
                <Search className="w-4 h-4 flex-shrink-0" />
                <span>☁️🔍 Cerca su Google Drive / Google Foto</span>
              </button>

              {/* Pulsante Sfoglia Diretto App Cloud Sistema (senza blocco galleria locale) */}
              <label className="py-3 px-3.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border-2 border-indigo-300 text-indigo-950 font-extrabold text-xs cursor-pointer transition flex items-center justify-center gap-1.5 text-center shadow-2xs">
                <Cloud className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                <span>📂 Sfoglia App Google Drive / Foto</span>
                <input
                  type="file"
                  accept="video/*,image/*,.mp4,.mov,.webm,.m4v,.avi,.mkv,.jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.avif"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = '';
                    if (files.length > 0) {
                      handleMediaDropOrSelect(files);
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {mediaList.length > 0 && (
            <div className="space-y-3">
              {/* Barra Riconoscimento Automatico Personaggi AI */}
              <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-50 to-sky-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-950">
                  <Eye className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>
                    {isRecognizingCast
                      ? '🔍 Riconoscimento visivo personaggi del Cast in corso sulle foto/video...'
                      : `✅ Riconoscimento Personaggi AI attivo (${mediaList.length} media confrontati con le foto del Cast)`}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isRecognizingCast}
                  onClick={handleRunAiCharacterRecognition}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black text-xs inline-flex items-center gap-1.5 shadow-2xs transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRecognizingCast ? 'animate-spin' : ''}`} />
                  <span>
                    {isRecognizingCast
                      ? 'Analisi Visiva...'
                      : '🔍 Riconosci Personaggi nelle Foto/Video con AI'}
                  </span>
                </button>
              </div>

              <div className="space-y-3 max-h-[30rem] overflow-y-auto pr-1">
                {mediaList.map((item, mediaIdx) => {
                  const selectedIds =
                    item.assignedCharacterIds && item.assignedCharacterIds.length > 0
                      ? item.assignedCharacterIds
                      : item.assignedCharacterId
                      ? [item.assignedCharacterId]
                      : cast[0]
                      ? [cast[0].id]
                      : [];

                  const toggleCharacterInMedia = (charId: string) => {
                    let nextIds: string[];
                    const wasAlreadySelected = selectedIds.includes(charId);
                    if (wasAlreadySelected) {
                      nextIds =
                        selectedIds.length > 1
                          ? selectedIds.filter((id) => id !== charId)
                          : selectedIds;
                    } else {
                      nextIds = [...selectedIds, charId];
                    }
                    onChangeUploadedMedia(
                      uploadedMedia.map((m) =>
                        m.id === item.id
                          ? {
                              ...m,
                              assignedCharacterId: nextIds[0],
                              assignedCharacterIds: nextIds,
                              recognitionStatus: 'MANUAL'
                            }
                          : m
                      )
                    );
                  };

                  const recognizedNames = selectedIds
                    .map((id) => cast.find((c) => c.id === id)?.name)
                    .filter(Boolean)
                    .join(' & ');

                  return (
                    <div
                      key={item.id}
                      className="flex flex-col p-3.5 rounded-2xl bg-sky-50 border border-sky-200 gap-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-sky-200 flex-shrink-0 flex items-center justify-center border-2 border-emerald-400/90 shadow-xs">
                            {item.base64Preview ? (
                              <img
                                src={item.base64Preview}
                                alt={item.name}
                                className="w-full h-full object-cover"
                              />
                            ) : item.type === 'VIDEO' ? (
                              <Video className="w-5 h-5 text-sky-700" />
                            ) : (
                              <ImageIcon className="w-5 h-5 text-sky-700" />
                            )}
                            <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-slate-900/80 text-white text-[9px] font-black">
                              #{mediaIdx + 1}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-sm text-slate-800 truncate">
                                {item.name}
                              </span>
                              {recognizedNames && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-[10px] font-black">
                                  ✨ Riconosciuto: {recognizedNames}
                                  {item.recognitionConfidence
                                    ? ` (${Math.round(item.recognitionConfidence * 100)}%)`
                                    : ''}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-0.5">
                              <span className="px-2 py-0.5 rounded-full bg-white border border-sky-200 font-bold text-sky-800">
                                {item.type === 'VIDEO'
                                  ? `📹 Clip Video (Orig: ${item.originalDurationSec}s)`
                                  : '📸 Materiale per Singolo Video AI'}
                              </span>
                              <span>Durata clip:</span>
                              <input
                                type="number"
                                min="2"
                                max="30"
                                value={item.usedDurationSec}
                                onChange={(e) => {
                                  const val = Math.max(2, parseInt(e.target.value || '5', 10));
                                  onChangeUploadedMedia(
                                    uploadedMedia.map((m) =>
                                      m.id === item.id ? { ...m, usedDurationSec: val } : m
                                    )
                                  );
                                }}
                                className="w-14 px-2 py-0.5 rounded-lg border border-sky-300 font-bold text-center bg-white"
                              />
                              <span>sec</span>
                            </div>
                            {item.visualDescription && (
                              <div className="text-[11px] font-semibold text-sky-900 mt-1 truncate">
                                👁️ Analisi AI: <em>{item.visualDescription}</em>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              onChangeUploadedMedia(uploadedMedia.filter((m) => m.id !== item.id))
                            }
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg flex-shrink-0"
                            title="Rimuovi file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Indicazioni specifiche per l'elaborazione AI di questo singolo video */}
                      <div>
                        <input
                          type="text"
                          value={item.customInstruction || ''}
                          onChange={(e) =>
                            onChangeUploadedMedia(
                              uploadedMedia.map((m) =>
                                m.id === item.id
                                  ? { ...m, customInstruction: e.target.value }
                                  : m
                              )
                            )
                          }
                          placeholder={`🎬 Indicazioni AI per questo video (es. "${
                            recognizedNames || 'Il protagonista'
                          } mostra il lavoro in atelier con zoom dinamico e reazione sorpresa")...`}
                          className="w-full px-3 py-1.5 rounded-xl border border-sky-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-sky-500"
                        />
                      </div>

                      {/* Selettore Protagonista/i (senza finestre popup di bocca/tracking) */}
                      <div className="pt-1.5 border-t border-sky-200/80 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-extrabold text-sky-900">
                          👥 Personaggi in questo video{' '}
                          <span className="text-sky-600 font-semibold">
                            (clicca per cambiare o aggiungere chi partecipa alla clip)
                          </span>
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {cast.map((c) => {
                            const isSelected = selectedIds.includes(c.id);
                            const orderBadge = selectedIds.indexOf(c.id) + 1;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => toggleCharacterInMedia(c.id)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-extrabold border transition ${
                                  isSelected
                                    ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                                    : 'bg-white text-slate-600 border-sky-200 hover:bg-sky-100'
                                }`}
                              >
                                {c.referencePhotos?.[0] && (
                                  <img
                                    src={c.referencePhotos[0]}
                                    alt={c.name}
                                    className="w-4 h-4 rounded-full object-cover bg-white"
                                  />
                                )}
                                <span>{c.name}</span>
                                {isSelected && selectedIds.length > 1 && (
                                  <span className="px-1.5 py-0.2 rounded-full bg-amber-300 text-slate-950 text-[10px] font-black">
                                    #{orderBadge}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 4. Dropzone Colonna Sonora da Video Musicale (Estrazione solo Audio) */}
        <div className="lg:col-span-5 bg-white border-2 border-sky-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
              <Music className="w-5 h-5 text-sky-500" />
              🎵 Musica da Video Musicale (Solo Audio)
            </h3>
            <p className="text-xs text-slate-600">
              Trascina un <strong>video musicale (.mp4, .mov, .webm)</strong> o un file audio:
              l&apos;app usa <code className="bg-sky-50 px-1 rounded">AudioContext.decodeAudioData()</code> per{' '}
              <strong>estrarre istantaneamente SOLO la traccia audio</strong> scartando il video!
            </p>

            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleMusicFileUpload(e.dataTransfer.files);
              }}
              className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-sky-300 hover:border-sky-500 rounded-2xl bg-sky-50/70 hover:bg-sky-100/60 cursor-pointer transition text-center"
            >
              <Volume2 className="w-8 h-8 text-sky-500 mb-1.5" />
              <span className="font-extrabold text-sky-900 text-sm">
                {isExtractingMusic
                  ? 'Estrazione traccia audio dal video in corso...'
                  : 'Trascina Video Musicale (.mp4/.mov) o Audio'}
              </span>
              <span className="text-[11px] text-slate-500 mt-1">
                Estrazione 100% nel browser • Zero costi server
              </span>
              <input
                type="file"
                accept="video/*,audio/*,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    handleMusicFileUpload(files);
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>

            {!backgroundMusic && (
              <button
                type="button"
                onClick={handleLoadDemoMusic}
                className="w-full py-2 px-3 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold text-xs transition flex items-center justify-center gap-1.5"
              >
                <Wand2 className="w-4 h-4" /> Non hai un video musicale sottomano? Carica Jingle Demo Sitcom
              </button>
            )}
          </div>

          {backgroundMusic && (
            <div className="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <span className="font-bold text-xs text-emerald-950 truncate">
                    {backgroundMusic.sourceFileName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeBackgroundMusic(undefined)}
                  className="text-xs font-bold text-rose-600 hover:underline"
                >
                  Rimuovi
                </button>
              </div>

              <audio
                controls
                src={backgroundMusic.extractedAudioBlobUrl}
                className="w-full h-9"
              />

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={backgroundMusic.autoDucking}
                  onChange={(e) =>
                    onChangeBackgroundMusic({
                      ...backgroundMusic,
                      autoDucking: e.target.checked
                    })
                  }
                  className="w-4 h-4 accent-sky-600 rounded"
                />
                <span className="text-xs font-bold text-emerald-900">
                  🔉 Auto-Ducking attivo (abbassa automaticamente la musica al 15% mentre parlano i personaggi)
                </span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* 5. TITOLO, PROPOSTE TRAME AI (DA TITOLO + ANALISI FOTO) & ASPETTATIVA DELLA PUNTATA */}
      <div className="bg-white border-2 border-sky-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-900 text-[11px] font-black uppercase mb-1">
              📺 Serie Autonoma: {seriesTitle || 'Serie Originale'}
            </div>
            <h3 className="text-lg font-extrabold text-slate-800">
              🎬 Titolo, Trame Proposte dall&apos;AI &amp; Sceneggiatura ({seriesTitle || 'Episodio'})
            </h3>
            <p className="text-xs text-slate-500">
              Scrivi un titolo (o lascialo proporre all&apos;AI): l&apos;intelligenza artificiale analizza il{' '}
              <strong>Titolo di &quot;{seriesTitle || 'questa serie'}&quot;</strong> e le{' '}
              <strong>Foto/Video caricati</strong> per proporti 3 trame su misura per i tuoi personaggi (
              {cast.map((c) => c.name).join(', ') || 'Cast'})!
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isProposingPlots}
              onClick={handleProposeAiPlots}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-60 text-white font-black text-xs sm:text-sm shadow-sm transition"
            >
              <Lightbulb className="w-4 h-4 text-amber-300" />
              <span>
                {isProposingPlots
                  ? 'Analisi Foto & Titolo in corso...'
                  : '🧠 Proponi 3 Trame con AI (da Titolo + Analisi Foto)'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleDictateIdea}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs sm:text-sm transition ${
                isListeningSpeech
                  ? 'bg-rose-500 text-white animate-pulse'
                  : 'bg-sky-100 text-sky-800 hover:bg-sky-200'
              }`}
            >
              <Mic className="w-4 h-4" />
              {isListeningSpeech ? 'In ascolto... Parla ora!' : '🎤 Detta a voce'}
            </button>
          </div>
        </div>

        {onChangeEpisodeTitle && (
          <div>
            <label className="block text-xs font-extrabold uppercase text-sky-900 mb-1">
              📌 Titolo della Puntata (di &quot;{seriesTitle || 'questa serie'}&quot;)
            </label>
            <input
              type="text"
              value={episodeTitle}
              onChange={(e) => onChangeEpisodeTitle(e.target.value)}
              placeholder={`Es. ${seriesTitle || 'Puntata Speciale'} — Il Capolavoro Improvviso`}
              className="w-full px-4 py-3 rounded-2xl border-2 border-sky-200 text-base font-extrabold text-slate-800 bg-sky-50/40 focus:bg-white focus:outline-none focus:border-sky-500"
            />
          </div>
        )}

        {/* PANNELLO PROPOSTE TRAME AI BASATE SU TITOLO E ANALISI VISIVA DELLE FOTO */}
        {(aiPlotProposals.length > 0 || isProposingPlots) && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-purple-50 via-indigo-50 to-sky-50 border-2 border-purple-200 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <span className="font-black text-sm text-purple-950">
                  ✨ Trame Proposte dall&apos;AI per &quot;{seriesTitle}&quot; (basate su Titolo + Analisi Foto)
                </span>
              </div>
              <button
                type="button"
                disabled={isProposingPlots}
                onClick={handleProposeAiPlots}
                className="text-xs font-extrabold text-purple-700 hover:text-purple-900 inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isProposingPlots ? 'animate-spin' : ''}`} />
                Rigenera proposte
              </button>
            </div>

            {aiVisualSummary && (
              <div className="p-3 rounded-xl bg-white/90 border border-purple-200 text-xs text-slate-700">
                <strong className="text-purple-950">👁️ Cosa ha visto l&apos;AI nelle tue foto:</strong>{' '}
                {aiVisualSummary}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {aiPlotProposals.map((prop, idx) => {
                const isSelected = selectedProposalId === prop.id;
                return (
                  <div
                    key={prop.id}
                    className={`p-4 rounded-2xl border-2 flex flex-col justify-between gap-3 transition ${
                      isSelected
                        ? 'bg-white border-purple-600 shadow-md ring-2 ring-purple-300'
                        : 'bg-white/90 border-purple-200 hover:border-purple-400'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 text-[10px] font-black">
                          Trama #{idx + 1} • {prop.toneBadge}
                        </span>
                      </div>
                      <h4 className="font-black text-sm text-slate-900 leading-snug">
                        🎬 {prop.title}
                      </h4>
                      <p className="text-xs font-bold text-purple-900 leading-snug">
                        {prop.logline}
                      </p>
                      <p className="text-xs text-slate-600 leading-relaxed">{prop.fullPlot}</p>
                      {prop.detectedContextFromPhotos && (
                        <div className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                          📷 Da foto: {prop.detectedContextFromPhotos}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProposalId(prop.id);
                        if (onChangeEpisodeTitle && prop.title) {
                          onChangeEpisodeTitle(prop.title);
                        }
                        onChangeRawIdea(prop.fullPlot);
                      }}
                      className={`w-full py-2.5 px-3 rounded-xl font-black text-xs transition flex items-center justify-center gap-1.5 ${
                        isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-purple-600 hover:bg-purple-700 text-white'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {isSelected ? 'Trama Applicata!' : 'Usa questa Trama & Titolo'}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-extrabold uppercase text-sky-900 mb-1">
            💡 Trama / Cosa deve succedere nella puntata? (puoi scriverla tu o scegliere una proposta AI sopra)
          </label>
          <textarea
            rows={3}
            value={rawIdea}
            onChange={(e) => onChangeRawIdea(e.target.value)}
            placeholder={`Es. Nella puntata di "${seriesTitle || 'questa serie'}", ${
              cast[0]?.name || 'il protagonista'
            } affronta una situazione imprevista con ironia tagliente...`}
            className="w-full p-4 rounded-2xl border-2 border-sky-200 text-base font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={isGeneratingStoryboard}
            onClick={onGenerateStoryboard}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 sm:px-8 py-4 rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-black text-base sm:text-lg shadow-md hover:shadow-lg transition"
          >
            <Sparkles className="w-6 h-6 flex-shrink-0" />
            <span>
              {isGeneratingStoryboard
                ? `Elaborazione Regia & Singoli Video AI in corso per "${seriesTitle || 'Puntata'}"...`
                : `🎬 Prepara i Singoli Video AI per il Collage (${targetTotalDurationSec}s Esatti) →`}
            </span>
          </button>
        </div>
      </div>

      {/* Modal di Ricerca Cloud su Google Drive & Google Foto */}
      <CloudMediaPickerModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        onFilesImported={(files) => handleMediaDropOrSelect(files)}
        allowVideos={true}
        allowImages={true}
        titleContext="Studio della Puntata"
      />
    </div>
  );
};
