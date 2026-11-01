import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  X,
  Check,
  Clock,
  Upload,
  Music,
  Mic,
  Square,
  Trash2,
  Play,
  Pause,
  Wand2,
  Video,
  Image as ImageIcon,
  Cloud,
  Search
} from 'lucide-react';
import { IntroOutroConfig, IntroOutroMediaItem } from '../types/studio';
import {
  fileToDataUrl,
  generateOptimizedImageBase64,
  extractAudioFromVideoOrAudioFile,
  generateDemoSitcomMusicBlob
} from '../services/audioExtractorService';
import { saveMediaBlob } from '../services/storageService';
import { CloudMediaPickerModal } from './CloudMediaPickerModal';

interface BrandingModalProps {
  isOpen: boolean;
  onClose: () => void;
  seriesTitle?: string;
  branding: IntroOutroConfig;
  onSaveBranding: (newBranding: IntroOutroConfig) => void;
}

function getNormalizedMediaItems(
  config: IntroOutroConfig,
  target: 'INTRO' | 'OUTRO'
): IntroOutroMediaItem[] {
  if (target === 'INTRO') {
    if (Array.isArray(config.introMediaItems) && config.introMediaItems.length > 0) {
      return config.introMediaItems;
    }
    if (config.introBgVideoOrImage) {
      return [
        {
          id: 'intro-legacy-0',
          url: config.introBgVideoOrImage,
          type: config.introBgMediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
          fileName: config.introBgFileName || 'Media Sigla 1'
        }
      ];
    }
    return [];
  } else {
    if (Array.isArray(config.outroMediaItems) && config.outroMediaItems.length > 0) {
      return config.outroMediaItems;
    }
    if (config.outroBgVideoOrImage) {
      return [
        {
          id: 'outro-legacy-0',
          url: config.outroBgVideoOrImage,
          type: config.outroBgMediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
          fileName: config.outroBgFileName || 'Media Coda 1'
        }
      ];
    }
    return [];
  }
}

export const BrandingModal: React.FC<BrandingModalProps> = ({
  isOpen,
  onClose,
  seriesTitle = 'La Mia Serie',
  branding,
  onSaveBranding
}) => {
  const [config, setConfig] = useState<IntroOutroConfig>(branding);
  const [activeTab, setActiveTab] = useState<'INTRO' | 'OUTRO'>('INTRO');
  const [introInput, setIntroInput] = useState<string>(String(branding.introDurationSec));
  const [outroInput, setOutroInput] = useState<string>(String(branding.outroDurationSec));

  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [isRecordingMic, setIsRecordingMic] = useState<'NONE' | 'INTRO' | 'OUTRO'>('NONE');
  const [recordingSec, setRecordingSec] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [cloudPickerTarget, setCloudPickerTarget] = useState<'INTRO' | 'OUTRO' | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recTimerRef = useRef<number | null>(null);
  const previewSlideTimerRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const stopPreview = () => {
    setIsPreviewPlaying(false);
    setPreviewSlideIdx(0);
    if (previewSlideTimerRef.current) {
      clearInterval(previewSlideTimerRef.current);
      previewSlideTimerRef.current = null;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.pause();
      previewVideoRef.current.currentTime = 0;
    }
  };

  useEffect(() => {
    if (isOpen) {
      setConfig(branding);
      setIntroInput(String(branding.introDurationSec ?? 3));
      setOutroInput(String(branding.outroDurationSec ?? 4));
      setIsPreviewPlaying(false);
      setPreviewSlideIdx(0);
    } else {
      stopPreview();
    }
  }, [branding, isOpen]);

  if (!isOpen) return null;

  const introMediaList = getNormalizedMediaItems(config, 'INTRO');
  const outroMediaList = getNormalizedMediaItems(config, 'OUTRO');

  const toggleLivePreview = () => {
    if (isPreviewPlaying) {
      stopPreview();
      return;
    }
    setIsPreviewPlaying(true);
    setPreviewSlideIdx(0);

    const activeList = activeTab === 'INTRO' ? introMediaList : outroMediaList;
    const totalDur =
      activeTab === 'INTRO'
        ? Math.max(1, config.introDurationSec || 3)
        : Math.max(1, config.outroDurationSec || 4);

    if (activeList.length > 1) {
      const slotMs = Math.max(800, Math.round((totalDur * 1000) / activeList.length));
      previewSlideTimerRef.current = window.setInterval(() => {
        setPreviewSlideIdx((prev) => (prev + 1) % activeList.length);
      }, slotMs);
    }

    const audioUrl = activeTab === 'INTRO' ? config.introJingleUrl : config.outroAudioUrl;
    if (audioUrl) {
      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
      }
      previewAudioRef.current.src = audioUrl;
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current.onended = () => stopPreview();
      previewAudioRef.current.play().catch(() => {});
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.currentTime = 0;
      previewVideoRef.current.play().catch(() => {});
    }
  };

  const handleIntroChange = (raw: string) => {
    setIntroInput(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0) {
      setConfig((prev) => ({ ...prev, introDurationSec: parsed }));
    }
  };

  const handleOutroChange = (raw: string) => {
    setOutroInput(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0) {
      setConfig((prev) => ({ ...prev, outroDurationSec: parsed }));
    }
  };

  const stepIntro = (delta: number) => {
    const next = Math.max(0.5, Math.round((config.introDurationSec + delta) * 10) / 10);
    setConfig((prev) => ({ ...prev, introDurationSec: next }));
    setIntroInput(String(next));
  };

  const stepOutro = (delta: number) => {
    const next = Math.max(0.5, Math.round((config.outroDurationSec + delta) * 10) / 10);
    setConfig((prev) => ({ ...prev, outroDurationSec: next }));
    setOutroInput(String(next));
  };

  // Multi-Upload Visual Background (Multiple Videos and/or Images) for Intro or Outro
  const handleUploadVisualBg = async (
    target: 'INTRO' | 'OUTRO',
    filesList: FileList | File[] | null
  ) => {
    if (!filesList || filesList.length === 0) return;
    const files = Array.from(filesList);
    setIsLoadingMedia(true);
    try {
      const addedItems: IntroOutroMediaItem[] = [];
      let firstExtractedAudioUrl = '';
      let firstVideoFileName = '';

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isVideo =
          file.type.startsWith('video/') ||
          /\.(mp4|mov|webm|m4v|avi)$/i.test(file.name);
        let mediaUrl = '';
        if (isVideo) {
          mediaUrl = URL.createObjectURL(file);
          saveMediaBlob(`${target.toLowerCase()}-bg-${Date.now()}-${i}`, file).catch(() => {});
        } else {
          try {
            mediaUrl = await generateOptimizedImageBase64(file, 1280, 0.85);
          } catch {
            mediaUrl = '';
          }
          if (!mediaUrl) mediaUrl = URL.createObjectURL(file);
        }

        addedItems.push({
          id: `${target.toLowerCase()}-media-${Date.now()}-${i}`,
          url: mediaUrl,
          type: isVideo ? 'VIDEO' : 'IMAGE',
          fileName: file.name
        });

        // If it's a video, try to extract its audio automatically if no audio is set yet
        if (isVideo && !firstExtractedAudioUrl) {
          try {
            const ext = await extractAudioFromVideoOrAudioFile(file);
            if (ext.audioBlobUrl) {
              firstExtractedAudioUrl = ext.audioBlobUrl;
              firstVideoFileName = file.name;
            }
          } catch {
            // Video might not have an audio track
          }
        }
      }

      if (target === 'INTRO') {
        setConfig((prev) => {
          const existing = getNormalizedMediaItems(prev, 'INTRO');
          const combined = [...existing, ...addedItems];
          const first = combined[0];
          return {
            ...prev,
            introMediaItems: combined,
            introBgVideoOrImage: first?.url || '',
            introBgMediaType: first?.type || 'NONE',
            introBgFileName:
              combined.length > 1
                ? `${combined.length} file (${combined.map((m) => m.fileName).join(', ')})`
                : first?.fileName,
            ...(firstExtractedAudioUrl && !prev.introJingleUrl
              ? {
                  introJingleUrl: firstExtractedAudioUrl,
                  introJingleFileName: `Audio da ${firstVideoFileName}`
                }
              : {})
          };
        });
      } else {
        setConfig((prev) => {
          const existing = getNormalizedMediaItems(prev, 'OUTRO');
          const combined = [...existing, ...addedItems];
          const first = combined[0];
          return {
            ...prev,
            outroMediaItems: combined,
            outroBgVideoOrImage: first?.url || '',
            outroBgMediaType: first?.type || 'NONE',
            outroBgFileName:
              combined.length > 1
                ? `${combined.length} file (${combined.map((m) => m.fileName).join(', ')})`
                : first?.fileName,
            ...(firstExtractedAudioUrl && !prev.outroAudioUrl
              ? {
                  outroAudioUrl: firstExtractedAudioUrl,
                  outroAudioFileName: `Audio da ${firstVideoFileName}`
                }
              : {})
          };
        });
      }
    } finally {
      setIsLoadingMedia(false);
    }
  };

  const handleRemoveSingleMediaItem = (target: 'INTRO' | 'OUTRO', itemId: string) => {
    if (target === 'INTRO') {
      setConfig((prev) => {
        const remaining = getNormalizedMediaItems(prev, 'INTRO').filter((m) => m.id !== itemId);
        const first = remaining[0];
        return {
          ...prev,
          introMediaItems: remaining,
          introBgVideoOrImage: first?.url || '',
          introBgMediaType: first ? first.type : 'NONE',
          introBgFileName:
            remaining.length > 1
              ? `${remaining.length} file (${remaining.map((m) => m.fileName).join(', ')})`
              : first?.fileName
        };
      });
    } else {
      setConfig((prev) => {
        const remaining = getNormalizedMediaItems(prev, 'OUTRO').filter((m) => m.id !== itemId);
        const first = remaining[0];
        return {
          ...prev,
          outroMediaItems: remaining,
          outroBgVideoOrImage: first?.url || '',
          outroBgMediaType: first ? first.type : 'NONE',
          outroBgFileName:
            remaining.length > 1
              ? `${remaining.length} file (${remaining.map((m) => m.fileName).join(', ')})`
              : first?.fileName
        };
      });
    }
    setPreviewSlideIdx(0);
  };

  const handleClearAllMediaItems = (target: 'INTRO' | 'OUTRO') => {
    if (target === 'INTRO') {
      setConfig((prev) => ({
        ...prev,
        introMediaItems: [],
        introBgVideoOrImage: '',
        introBgMediaType: 'NONE',
        introBgFileName: undefined
      }));
    } else {
      setConfig((prev) => ({
        ...prev,
        outroMediaItems: [],
        outroBgVideoOrImage: '',
        outroBgMediaType: 'NONE',
        outroBgFileName: undefined
      }));
    }
    setPreviewSlideIdx(0);
  };

  // Upload Independent Audio / Music (or extract from Music Video) for Intro or Outro
  const handleUploadAudio = async (target: 'INTRO' | 'OUTRO', files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsLoadingMedia(true);
    try {
      const extracted = await extractAudioFromVideoOrAudioFile(file);
      if (target === 'INTRO') {
        setConfig((prev) => ({
          ...prev,
          introJingleUrl: extracted.audioBlobUrl,
          introJingleFileName: file.name
        }));
      } else {
        setConfig((prev) => ({
          ...prev,
          outroAudioUrl: extracted.audioBlobUrl,
          outroAudioFileName: file.name
        }));
      }
    } catch {
      const fallbackUrl = URL.createObjectURL(file);
      if (target === 'INTRO') {
        setConfig((prev) => ({
          ...prev,
          introJingleUrl: fallbackUrl,
          introJingleFileName: file.name
        }));
      } else {
        setConfig((prev) => ({
          ...prev,
          outroAudioUrl: fallbackUrl,
          outroAudioFileName: file.name
        }));
      }
    } finally {
      setIsLoadingMedia(false);
    }
  };

  const handleGenerateSitcomJingle = async (target: 'INTRO' | 'OUTRO') => {
    setIsLoadingMedia(true);
    try {
      const dur = target === 'INTRO' ? config.introDurationSec : config.outroDurationSec;
      const demo = await generateDemoSitcomMusicBlob(Math.max(3, dur));
      if (target === 'INTRO') {
        setConfig((prev) => ({
          ...prev,
          introJingleUrl: demo.audioBlobUrl,
          introJingleFileName: 'Jingle Sitcom Apertura.wav'
        }));
      } else {
        setConfig((prev) => ({
          ...prev,
          outroAudioUrl: demo.audioBlobUrl,
          outroAudioFileName: 'Jingle Sitcom Coda Finale.wav'
        }));
      }
    } finally {
      setIsLoadingMedia(false);
    }
  };

  const startMicRecording = async (target: 'INTRO' | 'OUTRO') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) {
          clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const url = await saveMediaBlob(`${target.toLowerCase()}-mic-${Date.now()}`, blob);
        if (target === 'INTRO') {
          setConfig((prev) => ({
            ...prev,
            introJingleUrl: url,
            introJingleFileName: 'Voce/Audio Sigla Registrato dal Microfono'
          }));
        } else {
          setConfig((prev) => ({
            ...prev,
            outroAudioUrl: url,
            outroAudioFileName: 'Saluto/Audio Coda Registrato dal Microfono'
          }));
        }
        setIsRecordingMic('NONE');
      };

      setRecordingSec(0);
      setIsRecordingMic(target);
      recorder.start(200);
      recTimerRef.current = window.setInterval(() => {
        setRecordingSec((s) => s + 1);
      }, 1000);
    } catch {
      alert('Impossibile accedere al microfono. Verifica i permessi del browser.');
    }
  };

  const stopMicRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleSave = () => {
    stopPreview();
    const finalIntro = Math.max(0.5, parseFloat(introInput) || config.introDurationSec || 3);
    const finalOutro = Math.max(0.5, parseFloat(outroInput) || config.outroDurationSec || 4);
    onSaveBranding({
      ...config,
      introDurationSec: finalIntro,
      outroDurationSec: finalOutro
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white border-t-2 sm:border-2 border-sky-200 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 bg-sky-50 border-b border-sky-200 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-sky-500 text-white rounded-xl shadow-sm flex-shrink-0">
              <Film className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-black text-slate-800 truncate">
                🎬 Studio Sigla Iniziale & Titoli di Coda
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-600 truncate">
                Crea Sigla e Coda indipendenti con i tuoi Video, Foto, Musica/Voce e Testi
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-sky-100 rounded-xl flex-shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 2 Grandi Tab di Scelta: Sigla Iniziale vs Titoli di Coda */}
        <div className="grid grid-cols-2 gap-2 px-4 sm:px-6 py-2.5 bg-sky-100/70 border-b border-sky-200 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              stopPreview();
              setActiveTab('INTRO');
            }}
            className={`py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm transition flex items-center justify-center gap-1.5 ${
              activeTab === 'INTRO'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-white text-sky-900 hover:bg-sky-50 border border-sky-200'
            }`}
          >
            🎬 1. Sigla Iniziale ({config.introEnabled ? `${config.introDurationSec}s` : 'Off'})
          </button>
          <button
            type="button"
            onClick={() => {
              stopPreview();
              setActiveTab('OUTRO');
            }}
            className={`py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm transition flex items-center justify-center gap-1.5 ${
              activeTab === 'OUTRO'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-white text-sky-900 hover:bg-sky-50 border border-sky-200'
            }`}
          >
            🏁 2. Titoli di Coda ({config.outroEnabled ? `${config.outroDurationSec}s` : 'Off'})
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* ================================================================= */}
          {/* TAB 1: SIGLA INIZIALE (INTRO STUDIO INDIPENDENTE)                 */}
          {/* ================================================================= */}
          {activeTab === 'INTRO' && (
            <div className="space-y-5">
              {/* Barra Attivazione + Durata + Colore */}
              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <label className="inline-flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.introEnabled}
                    onChange={(e) => setConfig({ ...config, introEnabled: e.target.checked })}
                    className="w-5 h-5 accent-sky-500 rounded"
                  />
                  <span className="text-base font-black text-sky-950">
                    Attiva Sigla Iniziale prima di ogni puntata
                  </span>
                </label>

                {config.introEnabled && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-extrabold uppercase text-sky-900">Durata:</span>
                      <button
                        type="button"
                        onClick={() => stepIntro(-1)}
                        className="w-8 h-9 rounded-xl bg-white hover:bg-sky-100 border border-sky-300 text-sky-900 font-black"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0.5"
                        max="120"
                        step="0.5"
                        value={introInput}
                        onChange={(e) => handleIntroChange(e.target.value)}
                        onBlur={() => {
                          const valid = Math.max(0.5, parseFloat(introInput) || 3);
                          setIntroInput(String(valid));
                          setConfig((prev) => ({ ...prev, introDurationSec: valid }));
                        }}
                        className="w-20 px-2 py-1.5 rounded-xl border-2 border-sky-300 font-extrabold text-base text-center text-sky-950 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => stepIntro(1)}
                        className="w-8 h-9 rounded-xl bg-white hover:bg-sky-100 border border-sky-300 text-sky-900 font-black"
                      >
                        +
                      </button>
                      <span className="text-xs font-bold text-slate-600">sec</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-extrabold uppercase text-sky-900">Colore:</span>
                      <input
                        type="color"
                        value={config.introThemeColor || '#0284c7'}
                        onChange={(e) => setConfig({ ...config, introThemeColor: e.target.value })}
                        className="w-10 h-9 rounded-xl border border-sky-200 cursor-pointer bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {config.introEnabled && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Colonna Sinistra: Carica Video/Foto + Carica Audio/Voce + Testi Sigla */}
                  <div className="lg:col-span-7 space-y-4">
                    {/* 1. Video e Foto di Sfondo della Sigla (Multi-Upload) */}
                    <div className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                          <Video className="w-4 h-4 text-sky-500" />
                          1. Video e Foto della Sigla Iniziale ({introMediaList.length} file)
                        </h3>
                        {introMediaList.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleClearAllMediaItems('INTRO')}
                            className="text-xs font-extrabold text-rose-600 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Svuota tutti
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Puoi caricare <strong>più video e più foto contemporaneamente</strong> (o aggiungerne altri in seguito): verranno montati in sequenza durante i {config.introDurationSec}s della sigla!
                      </p>

                      {/* Pulsanti Multi-Upload Ottimizzati per PC e Telefono */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="py-3 px-3 rounded-xl border-2 border-dashed border-sky-400 hover:border-sky-600 bg-sky-50 hover:bg-sky-100/80 cursor-pointer transition flex items-center justify-center gap-1.5 font-extrabold text-xs text-sky-950 text-center">
                          <Upload className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span>
                            {isLoadingMedia
                              ? 'Caricamento...'
                              : '📹📷 + Più Video & Foto'}
                          </span>
                          <input
                            type="file"
                            accept="video/*,image/*"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('INTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>

                        <label className="py-3 px-3 rounded-xl border border-sky-200 bg-white hover:bg-sky-50 cursor-pointer transition flex items-center justify-center gap-1.5 font-extrabold text-xs text-sky-900 text-center">
                          <ImageIcon className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span>📷 + Più Foto Galleria</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('INTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>

                        <label className="py-3 px-3 rounded-xl border border-sky-200 bg-white hover:bg-sky-50 cursor-pointer transition flex items-center justify-center gap-1.5 font-extrabold text-xs text-sky-900 text-center">
                          <Video className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span>📹 + Più Video Galleria</span>
                          <input
                            type="file"
                            accept="video/*"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('INTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Pulsanti Google Drive & Google Foto per la Sigla Iniziale */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setCloudPickerTarget('INTRO')}
                          className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white font-black text-xs transition flex items-center justify-center gap-1.5 shadow-2xs"
                        >
                          <Search className="w-4 h-4 flex-shrink-0" />
                          <span>☁️🔍 Cerca su Google Drive / Google Foto</span>
                        </button>

                        <label className="py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 text-indigo-950 font-extrabold text-xs cursor-pointer transition flex items-center justify-center gap-1.5 text-center">
                          <Cloud className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                          <span>📂 Sfoglia App Google Drive / Foto</span>
                          <input
                            type="file"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('INTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Elenco Miniatura dei Video e Foto Caricati nella Sigla */}
                      {introMediaList.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 max-h-44 overflow-y-auto pr-1">
                          {introMediaList.map((item, idx) => (
                            <div
                              key={item.id}
                              onClick={() => setPreviewSlideIdx(idx)}
                              className={`flex items-center justify-between gap-2 p-2 rounded-xl border cursor-pointer transition ${
                                previewSlideIdx % introMediaList.length === idx
                                  ? 'bg-sky-100 border-sky-500'
                                  : 'bg-sky-50/70 border-sky-200 hover:bg-sky-100/50'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-800 flex-shrink-0 flex items-center justify-center text-white text-[10px] font-black">
                                  {item.type === 'IMAGE' ? (
                                    <img
                                      src={item.url}
                                      alt={item.fileName}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span>📹 #{idx + 1}</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[10px] font-black text-sky-800">
                                    #{idx + 1} • {item.type === 'VIDEO' ? 'Video' : 'Foto'}
                                  </div>
                                  <div className="text-[11px] font-bold text-slate-700 truncate">
                                    {item.fileName}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveSingleMediaItem('INTRO', item.id);
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded-lg flex-shrink-0"
                                title="Rimuovi questo file"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 2. Audio / Musica / Voce Indipendente della Sigla */}
                    <div className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                          <Music className="w-4 h-4 text-sky-500" />
                          2. Musica o Voce Indipendente della Sigla
                        </h3>
                        {config.introJingleUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfig({
                                ...config,
                                introJingleUrl: '',
                                introJingleFileName: undefined
                              })
                            }
                            className="text-xs font-extrabold text-rose-600 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Rimuovi audio
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="py-2.5 px-3 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-xs cursor-pointer transition flex items-center justify-center gap-1.5 text-center">
                          <Upload className="w-3.5 h-3.5" /> Carica Audio / Video
                          <input
                            type="file"
                            accept="audio/*,video/*"
                            onChange={(e) => handleUploadAudio('INTRO', e.target.files)}
                            className="hidden"
                          />
                        </label>

                        {isRecordingMic === 'INTRO' ? (
                          <button
                            type="button"
                            onClick={stopMicRecording}
                            className="py-2.5 px-3 rounded-xl bg-rose-600 text-white font-extrabold text-xs animate-pulse flex items-center justify-center gap-1.5"
                          >
                            <Square className="w-3.5 h-3.5" /> Stop ({recordingSec}s)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startMicRecording('INTRO')}
                            className="py-2.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold text-xs flex items-center justify-center gap-1.5"
                          >
                            <Mic className="w-3.5 h-3.5" /> Registra col Microfono
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleGenerateSitcomJingle('INTRO')}
                          className="py-2.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-extrabold text-xs flex items-center justify-center gap-1.5"
                        >
                          <Wand2 className="w-3.5 h-3.5" /> Jingle Sitcom AI
                        </button>
                      </div>

                      {config.introJingleUrl && (
                        <div className="pt-1 space-y-1">
                          <div className="text-[11px] font-bold text-emerald-800">
                            🎵 Traccia attiva: {config.introJingleFileName || 'Audio Sigla Personalizzato'}
                          </div>
                          <audio controls src={config.introJingleUrl} className="w-full h-8" />
                        </div>
                      )}
                    </div>

                    {/* 3. Testo Personalizzato della Sigla */}
                    <div className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3">
                      <h3 className="text-sm font-black text-slate-800">
                        ✍️ 3. Testo e Titoli della Sigla Iniziale
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold uppercase text-sky-800 mb-1">
                            Titolo Principale Sigla
                          </label>
                          <input
                            type="text"
                            placeholder={seriesTitle}
                            value={config.introCustomTitle ?? ''}
                            onChange={(e) =>
                              setConfig({ ...config, introCustomTitle: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-xl border border-sky-200 text-xs sm:text-sm font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold uppercase text-sky-800 mb-1">
                            Sottotitolo / Testo Libero Sigla
                          </label>
                          <input
                            type="text"
                            placeholder="Es. Episodio Speciale • Buon Divertimento!"
                            value={config.introCustomSubtitle ?? ''}
                            onChange={(e) =>
                              setConfig({ ...config, introCustomSubtitle: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-xl border border-sky-200 text-xs sm:text-sm font-medium"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-4 pt-1">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.introShowEpisodeBadge !== false}
                            onChange={(e) =>
                              setConfig({ ...config, introShowEpisodeBadge: e.target.checked })
                            }
                            className="w-4 h-4 accent-sky-500 rounded"
                          />
                          <span className="text-xs font-bold text-slate-700">
                            Mostra Titolo e Numero Puntata
                          </span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.introShowCastAvatars !== false}
                            onChange={(e) =>
                              setConfig({ ...config, introShowCastAvatars: e.target.checked })
                            }
                            className="w-4 h-4 accent-sky-500 rounded"
                          />
                          <span className="text-xs font-bold text-slate-700">
                            Mostra Avatar del Cast in Sigla
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Colonna Destra: Anteprima Visiva + Sonora della Sigla */}
                  <div className="lg:col-span-5 flex flex-col items-center justify-between p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                    <div className="w-full flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-sky-300">
                        📺 Anteprima Sigla ({config.introDurationSec}s • {introMediaList.length || 0} clip)
                      </span>
                      <button
                        type="button"
                        onClick={toggleLivePreview}
                        className="px-3 py-1 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-extrabold text-xs inline-flex items-center gap-1"
                      >
                        {isPreviewPlaying ? (
                          <>
                            <Pause className="w-3.5 h-3.5" /> Ferma
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" /> Prova Sigla
                          </>
                        )}
                      </button>
                    </div>

                    <div
                      style={{ backgroundColor: config.introThemeColor || '#0284c7' }}
                      className="w-full max-w-[230px] aspect-[9/16] rounded-2xl overflow-hidden relative flex flex-col items-center justify-between p-4 text-center shadow-lg border-2 border-white/20"
                    >
                      {(() => {
                        const activeIntroMedia =
                          introMediaList[previewSlideIdx % Math.max(1, introMediaList.length)];
                        if (!activeIntroMedia) return null;
                        return activeIntroMedia.type === 'VIDEO' ? (
                          <video
                            key={activeIntroMedia.id}
                            ref={previewVideoRef}
                            src={activeIntroMedia.url}
                            className="absolute inset-0 w-full h-full object-cover"
                            muted
                            loop
                            autoPlay
                            playsInline
                          />
                        ) : (
                          <img
                            key={activeIntroMedia.id}
                            src={activeIntroMedia.url}
                            alt="Sfondo Sigla"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        );
                      })()}

                      <div className="relative z-10 w-full space-y-1 bg-slate-900/55 backdrop-blur-xs p-2.5 rounded-xl">
                        <div className="text-[10px] font-black text-sky-300 uppercase">
                          ☁️ SKYSKETCH STUDIO
                        </div>
                        <div className="text-sm font-black text-white leading-tight">
                          {(config.introCustomTitle || seriesTitle).toUpperCase()}
                        </div>
                        {config.introCustomSubtitle && (
                          <div className="text-[11px] font-bold text-sky-100">
                            {config.introCustomSubtitle}
                          </div>
                        )}
                      </div>

                      {config.introShowEpisodeBadge !== false && (
                        <div className="relative z-10 bg-white/95 text-sky-950 px-3 py-2 rounded-xl shadow w-full">
                          <div className="text-[10px] font-black text-sky-600">EPISODIO #1</div>
                          <div className="text-xs font-extrabold">Titolo della Puntata</div>
                        </div>
                      )}

                      <div className="relative z-10 text-[10px] font-bold text-white/90 bg-slate-900/50 px-2.5 py-1 rounded-full">
                        {config.introJingleUrl ? '🔊 Musica/Voce Sigla Attiva' : '🔇 Nessun audio sigla'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: TITOLI DI CODA (OUTRO STUDIO INDIPENDENTE)                 */}
          {/* ================================================================= */}
          {activeTab === 'OUTRO' && (
            <div className="space-y-5">
              {/* Barra Attivazione + Durata + Colore */}
              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <label className="inline-flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.outroEnabled}
                    onChange={(e) => setConfig({ ...config, outroEnabled: e.target.checked })}
                    className="w-5 h-5 accent-sky-500 rounded"
                  />
                  <span className="text-base font-black text-sky-950">
                    Attiva Titoli di Coda alla fine di ogni puntata
                  </span>
                </label>

                {config.outroEnabled && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-extrabold uppercase text-sky-900">Durata:</span>
                      <button
                        type="button"
                        onClick={() => stepOutro(-1)}
                        className="w-8 h-9 rounded-xl bg-white hover:bg-sky-100 border border-sky-300 text-sky-900 font-black"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0.5"
                        max="120"
                        step="0.5"
                        value={outroInput}
                        onChange={(e) => handleOutroChange(e.target.value)}
                        onBlur={() => {
                          const valid = Math.max(0.5, parseFloat(outroInput) || 4);
                          setOutroInput(String(valid));
                          setConfig((prev) => ({ ...prev, outroDurationSec: valid }));
                        }}
                        className="w-20 px-2 py-1.5 rounded-xl border-2 border-sky-300 font-extrabold text-base text-center text-sky-950 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => stepOutro(1)}
                        className="w-8 h-9 rounded-xl bg-white hover:bg-sky-100 border border-sky-300 text-sky-900 font-black"
                      >
                        +
                      </button>
                      <span className="text-xs font-bold text-slate-600">sec</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-extrabold uppercase text-sky-900">Colore:</span>
                      <input
                        type="color"
                        value={config.outroThemeColor || '#0f172a'}
                        onChange={(e) => setConfig({ ...config, outroThemeColor: e.target.value })}
                        className="w-10 h-9 rounded-xl border border-sky-200 cursor-pointer bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {config.outroEnabled && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Colonna Sinistra: Video/Foto + Audio + Testi Titoli di Coda */}
                  <div className="lg:col-span-7 space-y-4">
                    {/* 1. Video e Foto di Sfondo dei Titoli di Coda (Multi-Upload) */}
                    <div className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                          <ImageIcon className="w-4 h-4 text-sky-500" />
                          1. Video e Foto dei Titoli di Coda ({outroMediaList.length} file)
                        </h3>
                        {outroMediaList.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleClearAllMediaItems('OUTRO')}
                            className="text-xs font-extrabold text-rose-600 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Svuota tutti
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Puoi caricare <strong>più video (es. blooper/fuori onda) e più foto</strong>: verranno mostrati in sequenza durante i {config.outroDurationSec}s dei titoli di coda!
                      </p>

                      {/* Pulsanti Multi-Upload Ottimizzati per PC e Telefono */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="py-3 px-3 rounded-xl border-2 border-dashed border-sky-400 hover:border-sky-600 bg-sky-50 hover:bg-sky-100/80 cursor-pointer transition flex items-center justify-center gap-1.5 font-extrabold text-xs text-sky-950 text-center">
                          <Upload className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span>
                            {isLoadingMedia
                              ? 'Caricamento...'
                              : '📹📷 + Più Video & Foto'}
                          </span>
                          <input
                            type="file"
                            accept="video/*,image/*"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('OUTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>

                        <label className="py-3 px-3 rounded-xl border border-sky-200 bg-white hover:bg-sky-50 cursor-pointer transition flex items-center justify-center gap-1.5 font-extrabold text-xs text-sky-900 text-center">
                          <ImageIcon className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span>📷 + Più Foto Galleria</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('OUTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>

                        <label className="py-3 px-3 rounded-xl border border-sky-200 bg-white hover:bg-sky-50 cursor-pointer transition flex items-center justify-center gap-1.5 font-extrabold text-xs text-sky-900 text-center">
                          <Video className="w-4 h-4 text-sky-600 flex-shrink-0" />
                          <span>📹 + Più Video Galleria</span>
                          <input
                            type="file"
                            accept="video/*"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('OUTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Pulsanti Google Drive & Google Foto per i Titoli di Coda */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setCloudPickerTarget('OUTRO')}
                          className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white font-black text-xs transition flex items-center justify-center gap-1.5 shadow-2xs"
                        >
                          <Search className="w-4 h-4 flex-shrink-0" />
                          <span>☁️🔍 Cerca su Google Drive / Google Foto</span>
                        </button>

                        <label className="py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 text-indigo-950 font-extrabold text-xs cursor-pointer transition flex items-center justify-center gap-1.5 text-center">
                          <Cloud className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                          <span>📂 Sfoglia App Google Drive / Foto</span>
                          <input
                            type="file"
                            multiple
                            onChange={(e) => {
                              const selected = Array.from(e.target.files || []);
                              e.currentTarget.value = '';
                              handleUploadVisualBg('OUTRO', selected);
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Elenco Miniatura dei Video e Foto Caricati nei Titoli di Coda */}
                      {outroMediaList.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 max-h-44 overflow-y-auto pr-1">
                          {outroMediaList.map((item, idx) => (
                            <div
                              key={item.id}
                              onClick={() => setPreviewSlideIdx(idx)}
                              className={`flex items-center justify-between gap-2 p-2 rounded-xl border cursor-pointer transition ${
                                previewSlideIdx % outroMediaList.length === idx
                                  ? 'bg-sky-100 border-sky-500'
                                  : 'bg-sky-50/70 border-sky-200 hover:bg-sky-100/50'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-800 flex-shrink-0 flex items-center justify-center text-white text-[10px] font-black">
                                  {item.type === 'IMAGE' ? (
                                    <img
                                      src={item.url}
                                      alt={item.fileName}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span>📹 #{idx + 1}</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[10px] font-black text-sky-800">
                                    #{idx + 1} • {item.type === 'VIDEO' ? 'Video' : 'Foto'}
                                  </div>
                                  <div className="text-[11px] font-bold text-slate-700 truncate">
                                    {item.fileName}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveSingleMediaItem('OUTRO', item.id);
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded-lg flex-shrink-0"
                                title="Rimuovi questo file"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 2. Audio / Musica / Voce Indipendente dei Titoli di Coda */}
                    <div className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                          <Music className="w-4 h-4 text-sky-500" />
                          2. Musica o Saluto Audio dei Titoli di Coda
                        </h3>
                        {config.outroAudioUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfig({
                                ...config,
                                outroAudioUrl: '',
                                outroAudioFileName: undefined
                              })
                            }
                            className="text-xs font-extrabold text-rose-600 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Rimuovi audio
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="py-2.5 px-3 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-xs cursor-pointer transition flex items-center justify-center gap-1.5 text-center">
                          <Upload className="w-3.5 h-3.5" /> Carica Audio / Video
                          <input
                            type="file"
                            accept="audio/*,video/*"
                            onChange={(e) => handleUploadAudio('OUTRO', e.target.files)}
                            className="hidden"
                          />
                        </label>

                        {isRecordingMic === 'OUTRO' ? (
                          <button
                            type="button"
                            onClick={stopMicRecording}
                            className="py-2.5 px-3 rounded-xl bg-rose-600 text-white font-extrabold text-xs animate-pulse flex items-center justify-center gap-1.5"
                          >
                            <Square className="w-3.5 h-3.5" /> Stop ({recordingSec}s)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startMicRecording('OUTRO')}
                            className="py-2.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold text-xs flex items-center justify-center gap-1.5"
                          >
                            <Mic className="w-3.5 h-3.5" /> Registra Saluto Voce
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleGenerateSitcomJingle('OUTRO')}
                          className="py-2.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-extrabold text-xs flex items-center justify-center gap-1.5"
                        >
                          <Wand2 className="w-3.5 h-3.5" /> Jingle Finale AI
                        </button>
                      </div>

                      {config.outroAudioUrl && (
                        <div className="pt-1 space-y-1">
                          <div className="text-[11px] font-bold text-emerald-800">
                            🎵 Traccia attiva: {config.outroAudioFileName || 'Audio Coda Personalizzato'}
                          </div>
                          <audio controls src={config.outroAudioUrl} className="w-full h-8" />
                        </div>
                      )}
                    </div>

                    {/* 3. Testi e Crediti dei Titoli di Coda */}
                    <div className="p-4 rounded-2xl bg-white border-2 border-sky-200 space-y-3">
                      <h3 className="text-sm font-black text-slate-800">
                        ✍️ 3. Testi e Crediti dei Titoli di Coda
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold uppercase text-sky-800 mb-1">
                            Titolo Intestazione Coda
                          </label>
                          <input
                            type="text"
                            placeholder="🏁 TITOLI DI CODA UFFICIALI"
                            value={config.outroCustomHeader ?? ''}
                            onChange={(e) =>
                              setConfig({ ...config, outroCustomHeader: e.target.value })
                            }
                            className="w-full px-3 py-2 rounded-xl border border-sky-200 text-xs sm:text-sm font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold uppercase text-sky-800 mb-1">
                            Testo Finale / Call to Action
                          </label>
                          <input
                            type="text"
                            value={config.footerText}
                            onChange={(e) => setConfig({ ...config, footerText: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-sky-200 text-xs sm:text-sm font-medium"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-1">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.outroShowCastCards !== false}
                            onChange={(e) =>
                              setConfig({ ...config, outroShowCastCards: e.target.checked })
                            }
                            className="w-4 h-4 accent-sky-500 rounded"
                          />
                          <span className="text-xs font-bold text-slate-700">
                            Mostra Schede Cast Protagonisti
                          </span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.autoListDetectedCast}
                            onChange={(e) =>
                              setConfig({ ...config, autoListDetectedCast: e.target.checked })
                            }
                            className="w-4 h-4 accent-sky-500 rounded"
                          />
                          <span className="text-xs font-bold text-slate-700">
                            Solo attori presenti nella puntata
                          </span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.aiFunnyRoles}
                            onChange={(e) => setConfig({ ...config, aiFunnyRoles: e.target.checked })}
                            className="w-4 h-4 accent-sky-500 rounded"
                          />
                          <span className="text-xs font-bold text-slate-700">
                            Qualifiche ironiche AI
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Colonna Destra: Anteprima Visiva + Sonora dei Titoli di Coda */}
                  <div className="lg:col-span-5 flex flex-col items-center justify-between p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                    <div className="w-full flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-sky-300">
                        📺 Anteprima Coda ({config.outroDurationSec}s • {outroMediaList.length || 0} clip)
                      </span>
                      <button
                        type="button"
                        onClick={toggleLivePreview}
                        className="px-3 py-1 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-extrabold text-xs inline-flex items-center gap-1"
                      >
                        {isPreviewPlaying ? (
                          <>
                            <Pause className="w-3.5 h-3.5" /> Ferma
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" /> Prova Coda
                          </>
                        )}
                      </button>
                    </div>

                    <div
                      style={{ backgroundColor: config.outroThemeColor || '#0f172a' }}
                      className="w-full max-w-[230px] aspect-[9/16] rounded-2xl overflow-hidden relative flex flex-col items-center justify-between p-4 text-center shadow-lg border-2 border-white/20"
                    >
                      {(() => {
                        const activeOutroMedia =
                          outroMediaList[previewSlideIdx % Math.max(1, outroMediaList.length)];
                        if (!activeOutroMedia) return null;
                        return activeOutroMedia.type === 'VIDEO' ? (
                          <video
                            key={activeOutroMedia.id}
                            ref={previewVideoRef}
                            src={activeOutroMedia.url}
                            className="absolute inset-0 w-full h-full object-cover"
                            muted
                            loop
                            autoPlay
                            playsInline
                          />
                        ) : (
                          <img
                            key={activeOutroMedia.id}
                            src={activeOutroMedia.url}
                            alt="Sfondo Coda"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        );
                      })()}

                      <div className="relative z-10 w-full space-y-1 bg-slate-900/65 backdrop-blur-xs p-2.5 rounded-xl">
                        <div className="text-[10px] font-black text-sky-300 uppercase">
                          {config.outroCustomHeader || '🏁 TITOLI DI CODA UFFICIALI'}
                        </div>
                        <div className="text-xs font-black text-white">PROTAGONISTI DI OGGI</div>
                      </div>

                      {config.outroShowCastCards !== false && (
                        <div className="relative z-10 w-full space-y-1.5">
                          <div className="bg-white/95 text-sky-950 px-2.5 py-2 rounded-xl text-[11px] font-extrabold shadow">
                            🧑🐾 Schede Personaggi & Ruoli
                          </div>
                        </div>
                      )}

                      <div className="relative z-10 w-full space-y-1 bg-slate-900/65 p-2 rounded-xl">
                        <div className="text-[10px] font-bold text-sky-200 line-clamp-2">
                          {config.footerText}
                        </div>
                        <div className="text-[9px] font-bold text-emerald-300">
                          {config.outroAudioUrl ? '🔊 Musica/Audio Coda Attivo' : '🔇 Musica sottofondo episodio'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Riepilogo Cornice */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-2xl bg-sky-100/80 border border-sky-300 text-sky-900">
            <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
              <Clock className="w-4 h-4 text-sky-600" />
              Totale cornice (Sigla {config.introEnabled ? `${config.introDurationSec}s` : '0s'} + Coda{' '}
              {config.outroEnabled ? `${config.outroDurationSec}s` : '0s'}):
            </div>
            <span className="text-base sm:text-lg font-black">
              {(config.introEnabled ? config.introDurationSec : 0) +
                (config.outroEnabled ? config.outroDurationSec : 0)}
              s
            </span>
          </div>
        </div>

        {/* Footer Modal Buttons */}
        <div className="flex items-center justify-end gap-2.5 px-4 sm:px-6 py-3.5 bg-sky-50 border-t border-sky-200 flex-shrink-0">
          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="flex-1 sm:flex-initial px-4 py-3 rounded-2xl bg-sky-100 text-sky-800 hover:bg-sky-200 font-extrabold text-xs sm:text-sm text-center"
          >
            Annulla
          </button>
          <button
            onClick={handleSave}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-xs sm:text-sm shadow-sm"
          >
            <Check className="w-4 h-4" /> Salva Sigla & Coda
          </button>
        </div>
      </div>

      {/* Modal di Ricerca Cloud su Google Drive & Google Foto per Sigla Iniziale e Titoli di Coda */}
      <CloudMediaPickerModal
        isOpen={cloudPickerTarget !== null}
        onClose={() => setCloudPickerTarget(null)}
        onFilesImported={(files) => {
          if (cloudPickerTarget) {
            handleUploadVisualBg(cloudPickerTarget, files);
          }
        }}
        allowVideos={true}
        allowImages={true}
        titleContext={
          cloudPickerTarget === 'INTRO' ? 'Sigla di Apertura' : 'Titoli di Coda'
        }
      />
    </div>
  );
};
