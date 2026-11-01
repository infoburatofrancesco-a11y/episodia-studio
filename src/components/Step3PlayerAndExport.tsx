import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Download,
  Package,
  ArrowLeft,
  CheckCircle2,
  Volume2,
  Film,
  X
} from 'lucide-react';
import JSZip from 'jszip';
import {
  CastMember,
  IntroOutroConfig,
  IntroOutroMediaItem,
  SceneCard,
  BackgroundMusicConfig,
  ExportPresetId,
  ExportFormatSpec,
  DialogueTurn
} from '../types/studio';
import {
  generateSceneMultiTurnVoiceAndTimings,
  cleanDialogueTextForSpeech,
  ensureSitcomPunchyLine,
  getCharacterSitcomRoleBadge,
  speakLineWithBrowserItalianTts,
  buildCharacterVoiceSignature,
  drawLivingAnimatedCharacterFrame
} from '../services/aiService';
import { loadApiKeys } from '../services/storageService';

/**
 * Generates a warm, subtle TV Sitcom acoustic bass & rhythm groove WAV blob URL
 * so photo-based sketches have a lively sitcom atmosphere when no external BGM file is uploaded.
 */
function createSitcomGrooveWavUrl(): string {
  const sr = 22050;
  const durSec = 8; // 8-second seamless loop at 120 BPM (16 beats)
  const numSamples = sr * durSec;
  const buffer = new Float32Array(numSamples);

  const bassNotesHz = [
    130.81, 164.81, 196.0, 164.81, // C3 E3 G3 E3
    110.0, 130.81, 164.81, 130.81, // A2 C3 E3 C3
    146.83, 174.61, 220.0, 174.61, // D3 F3 A3 F3
    196.0, 164.81, 146.83, 196.0   // G3 E3 D3 G3
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sr;
    const beatFloat = t * 2; // 120 BPM = 2 beats per second
    const beatIdx = Math.floor(beatFloat) % bassNotesHz.length;
    const beatPhase = beatFloat % 1;

    const freq = bassNotesHz[beatIdx];
    const bassEnv = Math.exp(-beatPhase * 5.5) * Math.min(1, beatPhase * 45);
    const bassWave =
      (Math.sin(2 * Math.PI * freq * t) * 0.75 +
        Math.sin(4 * Math.PI * freq * t) * 0.25) *
      bassEnv *
      0.15;

    const offPhase = (beatFloat + 0.5) % 1;
    const chordEnv = offPhase < 0.25 ? Math.exp(-offPhase * 18) * Math.min(1, offPhase * 80) : 0;
    const chordWave =
      (Math.sin(2 * Math.PI * freq * 2 * t) +
        Math.sin(2 * Math.PI * freq * 2.5 * t) +
        Math.sin(2 * Math.PI * freq * 3 * t)) *
      chordEnv *
      0.04;

    buffer[i] = Math.max(-0.9, Math.min(0.9, bassWave + chordWave));
  }

  const wavBuf = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(wavBuf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(44 + i * 2, Math.round(buffer[i] * 32767), true);
  }
  return URL.createObjectURL(new Blob([wavBuf], { type: 'audio/wav' }));
}

const RENDER_SCALE = 1.5; // Renders 720x1280 logical space at 1080x1920 Full HD physical pixels!

export const EXPORT_FORMAT_PRESETS: ExportFormatSpec[] = [
  {
    id: 'IG_REELS_9_16',
    title: '📱 Instagram Reels / TikTok (9:16)',
    subtitle: 'Verticale Full-Screen 1080x1920 Full HD • Sottotitoli cinema anti-copertura UI',
    aspectRatio: '9:16',
    width: 720,
    height: 1280,
    platformBadge: 'IG REELS • 9:16',
    safeZoneHint: 'Sottotitoli posizionati sopra la barra descrizione e pulsanti laterali di Instagram Reels'
  },
  {
    id: 'IG_STORIES_9_16',
    title: '📲 Instagram Stories (9:16)',
    subtitle: 'Verticale 1080x1920 Full HD • Margini protetti per Sticker & Rispondi',
    aspectRatio: '9:16',
    width: 720,
    height: 1280,
    platformBadge: 'IG STORIES • 9:16',
    safeZoneHint: 'Ottimizzato con margine extra in basso per la barra "Invia messaggio" delle Storie'
  },
  {
    id: 'YOUTUBE_SHORTS_9_16',
    title: '⚡ YouTube Shorts (9:16)',
    subtitle: 'Verticale 1080x1920 Full HD • Calibrato per il feed mobile di YouTube Shorts',
    aspectRatio: '9:16',
    width: 720,
    height: 1280,
    platformBadge: 'YT SHORTS • 9:16',
    safeZoneHint: 'Centratura dinamica ad alto contrasto per mobile feed YouTube'
  },
  {
    id: 'YOUTUBE_VIDEO_16_9',
    title: '🖥️ YouTube Video Standard / TV (16:9 Orizzontale)',
    subtitle: 'Orizzontale Widescreen 1920x1080 Full HD • Layout stile Sitcom TV "Vita da Cani"',
    aspectRatio: '16:9',
    width: 1280,
    height: 720,
    platformBadge: 'YOUTUBE 16:9 HD',
    safeZoneHint: 'Formato panoramico 16:9 Full HD identico ai video Sitcom TV di Gemini / Veo'
  }
];

interface Step3PlayerAndExportProps {
  seriesTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  targetTotalDurationSec: number;
  branding: IntroOutroConfig;
  cast: CastMember[];
  scenes: SceneCard[];
  detectedCastIds: string[];
  funnyRolesByCastId: Record<string, string>;
  backgroundMusic?: BackgroundMusicConfig;
  onBackToStep2: () => void;
}

export const Step3PlayerAndExport: React.FC<Step3PlayerAndExportProps> = ({
  seriesTitle,
  episodeNumber,
  episodeTitle,
  targetTotalDurationSec,
  branding,
  cast,
  scenes,
  detectedCastIds,
  funnyRolesByCastId,
  backgroundMusic,
  onBackToStep2
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<ExportPresetId>('YOUTUBE_VIDEO_16_9');
  const [isFormatModalOpen, setIsFormatModalOpen] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isExportingMp4, setIsExportingMp4] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [exportSuccessUrl, setExportSuccessUrl] = useState<string | null>(null);
  const [prioritizeCastVoices, setPrioritizeCastVoices] = useState(true);
  const [isPreparingVoices, setIsPreparingVoices] = useState(false);
  const [voicesReadyVersion, setVoicesReadyVersion] = useState(0);

  const activeFormat =
    EXPORT_FORMAT_PRESETS.find((p) => p.id === selectedPresetId) || EXPORT_FORMAT_PRESETS[0];
  const isLandscape = activeFormat.aspectRatio === '16:9';

  // Preloaded Image and Video elements cache for 60fps Canvas drawing
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const videoCacheRef = useRef<Record<string, HTMLVideoElement>>({});
  const videoGainNodesRef = useRef<Record<string, GainNode>>({});
  const connectedVideoElsRef = useRef<WeakSet<HTMLVideoElement>>(new WeakSet());

  // Web Audio API graph for Native Video Audio, Sitcom Neural Voices, Auto-Ducking, Real-Time Lip-Sync Analyser, and Master Recording
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const bgmAudioElRef = useRef<HTMLAudioElement | null>(null);
  const bgmGainNodeRef = useRef<GainNode | null>(null);
  const voiceAudioElRef = useRef<HTMLAudioElement | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceFreqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const directTtsAudioElRef = useRef<HTMLAudioElement | null>(null);
  const introOutroAudioElRef = useRef<HTMLAudioElement | null>(null);
  const activeIntroOutroPhaseRef = useRef<'NONE' | 'INTRO' | 'OUTRO'>('NONE');
  const activeVoiceSceneIdRef = useRef<string | null>(null);
  const activeSpokenTurnKeyRef = useRef<string | null>(null);

  // Automatic real-voice cache for Sitcom Voice v4 (with each character's sampled voice & custom pitch/formants)
  const repairedVoicesRef = useRef<
    Record<
      string,
      { audioUrl: string; updatedTurns?: DialogueTurn[]; recommendedSceneDurationSec?: number }
    >
  >({});
  const sitcomGrooveUrlRef = useRef<string | null>(null);

  const rafRef = useRef<number | null>(null);
  const startTimestampRef = useRef<number>(0);

  const introSec = branding.introEnabled ? branding.introDurationSec : 0;
  const outroSec = branding.outroEnabled ? branding.outroDurationSec : 0;
  const netScenesSec = scenes.reduce((acc, s) => acc + s.durationSec, 0);
  const totalSec = introSec + netScenesSec + outroSec || targetTotalDurationSec;

  const introMediaList: IntroOutroMediaItem[] =
    branding.introMediaItems && branding.introMediaItems.length > 0
      ? branding.introMediaItems
      : branding.introBgVideoOrImage
      ? [
          {
            id: 'intro-legacy-bg',
            url: branding.introBgVideoOrImage,
            type: branding.introBgMediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
            fileName: branding.introBgFileName || 'Sfondo Sigla'
          }
        ]
      : [];

  const outroMediaList: IntroOutroMediaItem[] =
    branding.outroMediaItems && branding.outroMediaItems.length > 0
      ? branding.outroMediaItems
      : branding.outroBgVideoOrImage
      ? [
          {
            id: 'outro-legacy-bg',
            url: branding.outroBgVideoOrImage,
            type: branding.outroBgMediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
            fileName: branding.outroBgFileName || 'Sfondo Titoli di Coda'
          }
        ]
      : [];

  const connectCachedVideosToAudioGraph = () => {
    const ctx = audioCtxRef.current;
    const dest = masterDestRef.current;
    if (!ctx || !dest) return;

    Object.entries(videoCacheRef.current).forEach(([key, vid]) => {
      if (!connectedVideoElsRef.current.has(vid)) {
        try {
          vid.muted = false;
          vid.volume = 1.0;
          const srcNode = ctx.createMediaElementSource(vid);
          const gainNode = ctx.createGain();
          gainNode.gain.value = 0; // Muted until actively selected in timeline
          srcNode.connect(gainNode);
          gainNode.connect(ctx.destination);
          gainNode.connect(dest);
          videoGainNodesRef.current[key] = gainNode;
          connectedVideoElsRef.current.add(vid);
        } catch {
          // Ignore if already connected or CORS restricted
        }
      }
    });
  };

  // Preload Cast, Scene images, User Videos, AND Multiple Intro/Outro Videos & Photos
  useEffect(() => {
    const preloadImg = (url?: string) => {
      if (!url || imageCacheRef.current[url]) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!isPlaying) {
          renderCanvasFrameAtTime(currentTimeSec, activeFormat);
        }
      };
      img.src = url;
      imageCacheRef.current[url] = img;
    };

    cast.forEach((member) => {
      member.referencePhotos.forEach((photo) => preloadImg(photo));
    });

    [...introMediaList, ...outroMediaList].forEach((item) => {
      if (!item.url) return;
      if (item.type === 'VIDEO') {
        if (!videoCacheRef.current[item.url]) {
          const vid = document.createElement('video');
          vid.crossOrigin = 'anonymous';
          vid.src = item.url;
          vid.muted = true;
          vid.loop = true;
          vid.playsInline = true;
          vid.preload = 'auto';
          vid.onloadeddata = () => {
            if (!isPlaying) {
              renderCanvasFrameAtTime(currentTimeSec, activeFormat);
            }
          };
          vid.load();
          videoCacheRef.current[item.url] = vid;
        }
      } else {
        preloadImg(item.url);
      }
    });

    scenes.forEach((scene) => {
      preloadImg(scene.generatedAiImageUrl);
      preloadImg(scene.aiPhotoSourceUrl);

      const effectiveVideoSrc =
        (scene.sceneType === 'USER_VIDEO' && scene.userVideoBlobUrl) ||
        (scene.generatedAiVideoUrl &&
          (scene.generatedAiVideoUrl.startsWith('blob:') ||
            scene.generatedAiVideoUrl.startsWith('http'))
          ? scene.generatedAiVideoUrl
          : null);

      if (effectiveVideoSrc) {
        const cachedVid = videoCacheRef.current[scene.id];
        if (!cachedVid || cachedVid.src !== effectiveVideoSrc) {
          const vid = document.createElement('video');
          vid.crossOrigin = 'anonymous';
          vid.src = effectiveVideoSrc;
          vid.muted = true;
          vid.loop = true;
          vid.playsInline = true;
          vid.preload = 'auto';
          vid.onloadedmetadata = () => {
            vid.currentTime = scene.trimStartSec || 0;
          };
          vid.onloadeddata = () => {
            if (!isPlaying) {
              renderCanvasFrameAtTime(currentTimeSec, activeFormat);
            }
          };
          vid.load();
          videoCacheRef.current[scene.id] = vid;
        }
      }
    });

    if (audioCtxRef.current) {
      connectCachedVideosToAudioGraph();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast, scenes, branding]);

  const getExpectedSceneVoiceTag = (sc: SceneCard): string => {
    const turns =
      sc.dialogueTurns && sc.dialogueTurns.length > 0
        ? sc.dialogueTurns
        : [
            {
              characterId: sc.characterId,
              dialogueOrThought: sc.dialogueOrThought,
              startOffsetSec: 0,
              durationSec: sc.durationSec
            }
          ];
    const sigs = turns.map((t) => {
      const ch = cast.find((c) => c.id === t.characterId) || cast.find((c) => c.id === sc.characterId) || cast[0];
      return buildCharacterVoiceSignature(ch);
    });
    return `#sitcomvoice_v4_${sigs.join('__')}`;
  };

  const ensureAllSitcomVoicesReady = async (checkCancelled?: () => boolean) => {
    const apiKeys = loadApiKeys();
    setIsPreparingVoices(true);
    let updatedAny = false;
    try {
      for (const sc of scenes) {
        if (checkCancelled?.()) break;
        // Only skip if prioritizeCastVoices is OFF and this is a USER_VIDEO explicitly using original audio
        if (
          !prioritizeCastVoices &&
          sc.sceneType === 'USER_VIDEO' &&
          sc.userVideoBlobUrl &&
          sc.useOriginalVideoAudio === true
        ) {
          continue;
        }
        const expectedTag = getExpectedSceneVoiceTag(sc);
        const hasExactCastVoice =
          sc.generatedAudioUrl?.includes(expectedTag) ||
          repairedVoicesRef.current[sc.id]?.audioUrl?.includes(expectedTag);
        if (!hasExactCastVoice) {
          try {
            const res = await generateSceneMultiTurnVoiceAndTimings({
              scene: sc,
              cast,
              apiKeys,
              seriesTitle
            });
            if (!checkCancelled?.() && res.audioUrl) {
              repairedVoicesRef.current[sc.id] = res;
              updatedAny = true;
            }
          } catch {
            // Ignore background rescue error
          }
        }
      }
    } finally {
      if (!checkCancelled?.()) {
        setIsPreparingVoices(false);
        if (updatedAny) {
          setVoicesReadyVersion((v) => v + 1);
        }
      }
    }
  };

  // Automatic Sitcom Voice v4 Upgrade: ensures all scenes use each character's sampled voice & custom timbre/pitch
  useEffect(() => {
    let cancelled = false;
    ensureAllSitcomVoicesReady(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, cast, prioritizeCastVoices]);

  // Re-render frame whenever format or metadata changes
  useEffect(() => {
    renderCanvasFrameAtTime(currentTimeSec, activeFormat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesTitle, episodeTitle, scenes, branding, cast, selectedPresetId]);

  useEffect(() => {
    return () => {
      stopPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureAudioGraph = () => {
    if (!directTtsAudioElRef.current) {
      const directEl = new Audio();
      directEl.referrerPolicy = 'no-referrer';
      directTtsAudioElRef.current = directEl;
    }

    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const dest = ctx.createMediaStreamDestination();
      audioCtxRef.current = ctx;
      masterDestRef.current = dest;

      const bgmEl = new Audio();
      bgmEl.crossOrigin = 'anonymous';
      bgmEl.loop = true;
      const bgmSource = ctx.createMediaElementSource(bgmEl);
      const bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.22;
      bgmSource.connect(bgmGain);
      bgmGain.connect(ctx.destination);
      bgmGain.connect(dest);

      bgmAudioElRef.current = bgmEl;
      bgmGainNodeRef.current = bgmGain;

      const voiceEl = new Audio();
      voiceEl.crossOrigin = 'anonymous';
      const voiceSource = ctx.createMediaElementSource(voiceEl);
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 1.0;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.62;

      voiceSource.connect(voiceGain);
      voiceGain.connect(analyser);
      voiceGain.connect(ctx.destination);
      voiceGain.connect(dest);

      voiceAudioElRef.current = voiceEl;
      voiceAnalyserRef.current = analyser;
      voiceFreqDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const ioAudioEl = new Audio();
      ioAudioEl.crossOrigin = 'anonymous';
      const ioSource = ctx.createMediaElementSource(ioAudioEl);
      const ioGain = ctx.createGain();
      ioGain.gain.value = 0.95;
      ioSource.connect(ioGain);
      ioGain.connect(ctx.destination);
      ioGain.connect(dest);
      introOutroAudioElRef.current = ioAudioEl;
    }

    connectCachedVideosToAudioGraph();

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const getRealtimeVoiceEnergy = (localSec: number, isSpeakingNow: boolean): number => {
    if (!isSpeakingNow) return 0;
    const analyser = voiceAnalyserRef.current;
    const freqData = voiceFreqDataRef.current;
    const voiceEl = voiceAudioElRef.current;

    // Natural Italian syllable cadence envelope (~4.5 syllables/sec) so the jaw visibly opens and closes on every syllable
    const syl1 = Math.pow(Math.abs(Math.sin(localSec * 16.5)), 0.75);
    const syl2 = Math.cos(localSec * 9.2) * 0.35 + 0.65;
    const syllableEnvelope = Math.max(0.05, Math.min(1, syl1 * syl2));

    if (analyser && freqData && voiceEl && !voiceEl.paused) {
      analyser.getByteFrequencyData(freqData);
      let sum = 0;
      const startBin = 2;
      const endBin = Math.min(32, freqData.length);
      for (let i = startBin; i < endBin; i++) {
        sum += freqData[i];
      }
      const avg = sum / Math.max(1, endBin - startBin) / 255;
      if (avg > 0.02) {
        const fftAmp = Math.max(0.3, Math.min(1, avg * 2.2));
        return Math.max(0, Math.min(1, fftAmp * syllableEnvelope));
      }
    }

    return Math.max(0.06, Math.min(0.96, syllableEnvelope));
  };

  const setExclusiveActiveVideoAudioKey = (activeKey: string | null) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    Object.entries(videoGainNodesRef.current).forEach(([k, gainNode]) => {
      const target = k === activeKey ? 1.0 : 0.0;
      gainNode.gain.setTargetAtTime(target, ctx.currentTime, 0.04);
    });
  };

  const startPlayback = (
    fromStart = false,
    formatOverride?: ExportFormatSpec,
    onCompleteCallback?: () => void
  ) => {
    const fmt = formatOverride || activeFormat;
    ensureAudioGraph();
    const startOffset = fromStart ? 0 : currentTimeSec >= totalSec ? 0 : currentTimeSec;
    setCurrentTimeSec(startOffset);
    setIsPlaying(true);
    activeVoiceSceneIdRef.current = null;
    activeSpokenTurnKeyRef.current = null;
    activeIntroOutroPhaseRef.current = 'NONE';

    if (bgmAudioElRef.current) {
      if (backgroundMusic?.extractedAudioBlobUrl) {
        bgmAudioElRef.current.src = backgroundMusic.extractedAudioBlobUrl;
      } else {
        if (!sitcomGrooveUrlRef.current) {
          sitcomGrooveUrlRef.current = createSitcomGrooveWavUrl();
        }
        bgmAudioElRef.current.src = sitcomGrooveUrlRef.current;
      }
      bgmAudioElRef.current.currentTime = 0;
      bgmAudioElRef.current.play().catch(() => {});
    }

    startTimestampRef.current = performance.now() - startOffset * 1000;

    const tick = (now: number) => {
      const elapsedSec = (now - startTimestampRef.current) / 1000;
      if (elapsedSec >= totalSec) {
        setCurrentTimeSec(totalSec);
        renderCanvasFrameAtTime(totalSec, fmt);
        stopPlayback();
        onCompleteCallback?.();
        return;
      }

      setCurrentTimeSec(elapsedSec);
      syncAudioAndDuckingAtTime(elapsedSec);
      renderCanvasFrameAtTime(elapsedSec, fmt);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  const stopPlayback = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsPlaying(false);
    bgmAudioElRef.current?.pause();
    voiceAudioElRef.current?.pause();
    directTtsAudioElRef.current?.pause();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    introOutroAudioElRef.current?.pause();
    activeIntroOutroPhaseRef.current = 'NONE';
    activeSpokenTurnKeyRef.current = null;
    setExclusiveActiveVideoAudioKey(null);
    Object.values(videoCacheRef.current).forEach((v) => v.pause());
  };

  const syncAudioAndDuckingAtTime = (tSec: number) => {
    const ctx = audioCtxRef.current;
    const bgmGain = bgmGainNodeRef.current;
    const hasCustomBgm = Boolean(backgroundMusic?.extractedAudioBlobUrl);

    const isIntro = tSec < introSec;
    const isOutro = tSec >= introSec + netScenesSec;

    if (isIntro) {
      const hasIntroAudio = Boolean(branding.introJingleUrl);
      let activeIntroVideoUrl: string | null = null;

      if (introMediaList.length > 0) {
        const idx = Math.min(
          introMediaList.length - 1,
          Math.floor((Math.max(0, tSec) / Math.max(0.5, introSec)) * introMediaList.length)
        );
        const activeItem = introMediaList[idx];
        if (activeItem?.type === 'VIDEO') {
          activeIntroVideoUrl = activeItem.url;
          const vid = videoCacheRef.current[activeItem.url];
          if (vid) {
            if (activeIntroOutroPhaseRef.current !== 'INTRO') {
              vid.currentTime = Math.max(0, tSec);
            }
            if (vid.paused) {
              vid.play().catch(() => {});
            }
          }
        }
      }

      // If the Intro has a video (e.g., Vita da Cani intro) and no separate jingle override, play the video's native audio!
      if (activeIntroVideoUrl && !hasIntroAudio) {
        setExclusiveActiveVideoAudioKey(activeIntroVideoUrl);
        if (bgmGain && ctx) {
          bgmGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.08);
        }
      } else {
        setExclusiveActiveVideoAudioKey(null);
        if (bgmGain && ctx) {
          bgmGain.gain.setTargetAtTime(
            hasIntroAudio ? 0.06 : hasCustomBgm ? 0.55 : 0.32,
            ctx.currentTime,
            0.15
          );
        }
      }

      if (activeIntroOutroPhaseRef.current !== 'INTRO') {
        activeIntroOutroPhaseRef.current = 'INTRO';
        voiceAudioElRef.current?.pause();
        directTtsAudioElRef.current?.pause();
        if (hasIntroAudio && introOutroAudioElRef.current) {
          introOutroAudioElRef.current.src = branding.introJingleUrl;
          introOutroAudioElRef.current.currentTime = 0;
          introOutroAudioElRef.current.play().catch(() => {});
        }
      }
      activeVoiceSceneIdRef.current = null;
      return;
    }

    if (isOutro) {
      const hasOutroAudio = Boolean(branding.outroAudioUrl);
      let activeOutroVideoUrl: string | null = null;

      if (outroMediaList.length > 0) {
        const outroLocal = Math.max(0, tSec - (introSec + netScenesSec));
        const idx = Math.min(
          outroMediaList.length - 1,
          Math.floor((outroLocal / Math.max(0.5, outroSec)) * outroMediaList.length)
        );
        const activeItem = outroMediaList[idx];
        if (activeItem?.type === 'VIDEO') {
          activeOutroVideoUrl = activeItem.url;
          const vid = videoCacheRef.current[activeItem.url];
          if (vid && vid.paused) {
            vid.play().catch(() => {});
          }
        }
      }

      if (activeOutroVideoUrl && !hasOutroAudio) {
        setExclusiveActiveVideoAudioKey(activeOutroVideoUrl);
        if (bgmGain && ctx) {
          bgmGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.08);
        }
      } else {
        setExclusiveActiveVideoAudioKey(null);
        if (bgmGain && ctx) {
          bgmGain.gain.setTargetAtTime(
            hasOutroAudio ? 0.06 : hasCustomBgm ? 0.55 : 0.34,
            ctx.currentTime,
            0.15
          );
        }
      }

      if (activeIntroOutroPhaseRef.current !== 'OUTRO') {
        activeIntroOutroPhaseRef.current = 'OUTRO';
        voiceAudioElRef.current?.pause();
        directTtsAudioElRef.current?.pause();
        introMediaList.forEach((m) => {
          if (m.type === 'VIDEO') videoCacheRef.current[m.url]?.pause();
        });
        scenes.forEach((s) => {
          videoCacheRef.current[s.id]?.pause();
        });
        if (hasOutroAudio && introOutroAudioElRef.current) {
          introOutroAudioElRef.current.src = branding.outroAudioUrl!;
          introOutroAudioElRef.current.currentTime = 0;
          introOutroAudioElRef.current.play().catch(() => {});
        }
      }
      activeVoiceSceneIdRef.current = null;
      return;
    }

    if (activeIntroOutroPhaseRef.current !== 'NONE') {
      activeIntroOutroPhaseRef.current = 'NONE';
      introOutroAudioElRef.current?.pause();
      [...introMediaList, ...outroMediaList].forEach((m) => {
        if (m.type === 'VIDEO') videoCacheRef.current[m.url]?.pause();
      });
    }

    let cursor = introSec;
    let currentScene: SceneCard | null = null;
    let currentSceneIdx = 0;
    let sceneLocalTime = 0;

    for (let idx = 0; idx < scenes.length; idx++) {
      const s = scenes[idx];
      if (tSec >= cursor && tSec < cursor + s.durationSec) {
        currentScene = s;
        currentSceneIdx = idx;
        sceneLocalTime = tSec - cursor;
        break;
      }
      cursor += s.durationSec;
    }

    if (!currentScene) return;

    // Resolve effective video scene for visual playback
    const realVideoScenes = scenes.filter(
      (s) => s.sceneType === 'USER_VIDEO' && Boolean(s.userVideoBlobUrl)
    );
    const hasRealPhoto =
      (currentScene.aiPhotoSourceUrl &&
        !currentScene.aiPhotoSourceUrl.startsWith('data:image/svg+xml')) ||
      (currentScene.generatedAiImageUrl &&
        !currentScene.generatedAiImageUrl.startsWith('data:image/svg+xml'));

    const effectiveVideoScene =
      currentScene.sceneType === 'USER_VIDEO' && currentScene.userVideoBlobUrl
        ? currentScene
        : !hasRealPhoto && realVideoScenes.length > 0
        ? realVideoScenes[currentSceneIdx % realVideoScenes.length]
        : null;

    // Only mute character voices if prioritizeCastVoices is OFF and the current scene is explicitly a USER_VIDEO with useOriginalVideoAudio === true
    const usesNativeVideoAudio =
      !prioritizeCastVoices &&
      currentScene.sceneType === 'USER_VIDEO' &&
      Boolean(currentScene.userVideoBlobUrl) &&
      currentScene.useOriginalVideoAudio === true;

    if (usesNativeVideoAudio && effectiveVideoScene) {
      setExclusiveActiveVideoAudioKey(effectiveVideoScene.id);
      voiceAudioElRef.current?.pause();
      directTtsAudioElRef.current?.pause();

      if (bgmGain && ctx) {
        bgmGain.gain.setTargetAtTime(hasCustomBgm ? 0.08 : 0.0, ctx.currentTime, 0.08);
      }

      if (activeVoiceSceneIdRef.current !== currentScene.id) {
        activeVoiceSceneIdRef.current = currentScene.id;
        scenes.forEach((s) => {
          if (s.id !== effectiveVideoScene.id) {
            videoCacheRef.current[s.id]?.pause();
          }
        });
        const vid = videoCacheRef.current[effectiveVideoScene.id];
        if (vid) {
          vid.currentTime = effectiveVideoScene.trimStartSec || 0;
          vid.play().catch(() => {});
        }
      } else {
        const vid = videoCacheRef.current[effectiveVideoScene.id];
        if (vid && vid.paused && isPlaying) {
          vid.play().catch(() => {});
        }
      }
      return;
    }

    // Play the Character's Sampled / Custom Mastered Voice (#sitcomvoice_v4) on the scene!
    setExclusiveActiveVideoAudioKey(null);

    const isSpeakingWindow =
      sceneLocalTime >= 0.08 && sceneLocalTime <= currentScene.durationSec - 0.35;

    if (bgmGain && ctx) {
      const shouldDuck = backgroundMusic?.autoDucking !== false && isSpeakingWindow;
      const targetGain = shouldDuck
        ? hasCustomBgm
          ? 0.12
          : 0.08
        : hasCustomBgm
        ? 0.42
        : 0.22;
      bgmGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.1);
    }

    // Prefer #sitcomvoice_v4 audio (with each character's sampled voice & custom pitch/warmth/presence)
    const repaired = repairedVoicesRef.current[currentScene.id];
    const verifiedRealVoiceUrl = repaired?.audioUrl?.includes('#sitcomvoice_v4')
      ? repaired.audioUrl
      : currentScene.generatedAudioUrl?.includes('#sitcomvoice_v4')
      ? currentScene.generatedAudioUrl
      : repaired?.audioUrl?.includes('#realvoice')
      ? repaired.audioUrl
      : currentScene.generatedAudioUrl?.includes('#realvoice')
      ? currentScene.generatedAudioUrl
      : null;

    if (activeVoiceSceneIdRef.current !== currentScene.id) {
      activeVoiceSceneIdRef.current = currentScene.id;
      if (verifiedRealVoiceUrl && voiceAudioElRef.current) {
        directTtsAudioElRef.current?.pause();
        voiceAudioElRef.current.src = verifiedRealVoiceUrl.split('#')[0];
        voiceAudioElRef.current.currentTime = 0;
        voiceAudioElRef.current.play().catch(() => {
          const firstChar =
            cast.find((c) => c.id === currentScene!.characterId) || cast[0];
          const shortLine = ensureSitcomPunchyLine(
            currentScene!.dialogueOrThought,
            firstChar,
            currentScene!.order
          );
          speakLineWithBrowserItalianTts(shortLine, firstChar);
        });
      }

      if (effectiveVideoScene) {
        const vid = videoCacheRef.current[effectiveVideoScene.id];
        if (vid) {
          vid.currentTime = effectiveVideoScene.trimStartSec || 0;
          vid.play().catch(() => {});
        }
      }
    } else if (effectiveVideoScene) {
      const vid = videoCacheRef.current[effectiveVideoScene.id];
      if (vid && vid.paused && isPlaying) {
        vid.play().catch(() => {});
      }
    }

    // Fallback direct Italian speech stream with character pitch/speed if WAV is still being prepared
    if (!verifiedRealVoiceUrl) {
      const turns =
        repaired?.updatedTurns ||
        (currentScene.dialogueTurns && currentScene.dialogueTurns.length > 0
          ? currentScene.dialogueTurns
          : [
              {
                characterId: currentScene.characterId,
                dialogueOrThought: currentScene.dialogueOrThought,
                startOffsetSec: 0,
                durationSec: currentScene.durationSec
              }
            ]);

      let activeTurnIdx = 0;
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        if (
          sceneLocalTime >= t.startOffsetSec &&
          (sceneLocalTime < t.startOffsetSec + t.durationSec || i === turns.length - 1)
        ) {
          activeTurnIdx = i;
          break;
        }
      }

      const turnKey = `${currentScene.id}_turn_${activeTurnIdx}`;
      if (activeSpokenTurnKeyRef.current !== turnKey) {
        activeSpokenTurnKeyRef.current = turnKey;
        const turn = turns[activeTurnIdx];
        const turnChar =
          cast.find((c) => c.id === turn.characterId) ||
          cast.find((c) => c.id === currentScene.characterId) ||
          cast[0];
        const shortSitcomLine = ensureSitcomPunchyLine(
          turn.dialogueOrThought || currentScene.dialogueOrThought,
          turnChar,
          currentScene.order + activeTurnIdx
        );
        const cleanSpeech = cleanDialogueTextForSpeech(shortSitcomLine).slice(0, 160);

        if (directTtsAudioElRef.current) {
          const directEl = directTtsAudioElRef.current;
          directEl.pause();
          directEl.src = `https://clients5.google.com/translate_tts?ie=UTF-8&client=dict-chrome-ex&tl=it&q=${encodeURIComponent(
            cleanSpeech
          )}`;
          const charPitch = turnChar?.voiceConfig?.pitch ?? 1.0;
          const charSpeed = turnChar?.voiceConfig?.speed ?? 1.0;
          directEl.preservesPitch = false;
          directEl.playbackRate = Math.max(0.75, Math.min(1.4, charPitch * charSpeed));
          directEl.play().catch(() => {
            speakLineWithBrowserItalianTts(cleanSpeech, turnChar);
          });
        } else {
          speakLineWithBrowserItalianTts(cleanSpeech, turnChar);
        }
      }
    }
  };

  /**
   * Renders adaptive 9:16 (1080x1920 Full HD) OR 16:9 (1920x1080 Full HD) frames
   * in the "Vita da Cani" Broadcast TV Sitcom visual style!
   */
  const renderCanvasFrameAtTime = (tSec: number, fmt: ExportFormatSpec) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const targetPhysW = Math.round(fmt.width * RENDER_SCALE);
    const targetPhysH = Math.round(fmt.height * RENDER_SCALE);
    if (canvas.width !== targetPhysW || canvas.height !== targetPhysH) {
      canvas.width = targetPhysW;
      canvas.height = targetPhysH;
    }

    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

    const W = fmt.width;
    const H = fmt.height;
    const landscape = fmt.aspectRatio === '16:9';

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const getNativeMediaDimensions = (el: HTMLImageElement | HTMLVideoElement) => {
      if (el instanceof HTMLVideoElement) {
        return {
          srcW: el.videoWidth || W,
          srcH: el.videoHeight || H
        };
      }
      return {
        srcW: el.naturalWidth || el.width || W,
        srcH: el.naturalHeight || el.height || H
      };
    };

    const drawBackdropAndCrispMedia = (
      sourceEl: HTMLImageElement | HTMLVideoElement,
      boxW: number,
      boxH: number
    ): { drawW: number; drawH: number; srcW: number; srcH: number } => {
      const { srcW, srcH } = getNativeMediaDimensions(sourceEl);
      const srcAspect = srcW / Math.max(1, srcH);
      const dstAspect = boxW / Math.max(1, boxH);
      const sameOrientation =
        (srcAspect >= 1 && dstAspect >= 1) || (srcAspect < 1 && dstAspect < 1);

      let drawW: number;
      let drawH: number;
      if (sameOrientation || Math.abs(srcAspect - dstAspect) < 0.38) {
        const coverScale = Math.max(boxW / srcW, boxH / srcH);
        drawW = srcW * coverScale;
        drawH = srcH * coverScale;
      } else {
        const fitScale = Math.min(boxW / srcW, boxH / srcH);
        drawW = srcW * fitScale;
        drawH = srcH * fitScale;
      }

      ctx.drawImage(sourceEl, -drawW / 2, -drawH / 2, drawW, drawH);
      return { drawW, drawH, srcW, srcH };
    };

    // 1. DYNAMIC OPENING INTRO
    if (tSec < introSec) {
      const progress = Math.min(1, tSec / Math.max(0.5, introSec));
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, branding.introThemeColor || '#0284c7');
      grad.addColorStop(1, '#0c4a6e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      let drewIntroVideo = false;

      if (introMediaList.length > 0) {
        const idx = Math.min(
          introMediaList.length - 1,
          Math.floor((Math.max(0, tSec) / Math.max(0.5, introSec)) * introMediaList.length)
        );
        const activeIntroItem = introMediaList[idx];
        if (
          activeIntroItem?.type === 'VIDEO' &&
          videoCacheRef.current[activeIntroItem.url] &&
          videoCacheRef.current[activeIntroItem.url].readyState >= 2
        ) {
          const introVid = videoCacheRef.current[activeIntroItem.url];
          const { srcW, srcH } = getNativeMediaDimensions(introVid);
          const bgCoverScale = Math.max(W / srcW, H / srcH) * 1.05;
          ctx.save();
          ctx.translate(W / 2, H / 2);
          ctx.filter = 'blur(22px) brightness(0.6)';
          ctx.drawImage(
            introVid,
            (-srcW * bgCoverScale) / 2,
            (-srcH * bgCoverScale) / 2,
            srcW * bgCoverScale,
            srcH * bgCoverScale
          );
          ctx.filter = 'none';
          drawBackdropAndCrispMedia(introVid, W, H);
          ctx.restore();
          drewIntroVideo = true;
        } else if (activeIntroItem) {
          const introImg = imageCacheRef.current[activeIntroItem.url];
          if (introImg && introImg.complete) {
            const { srcW, srcH } = getNativeMediaDimensions(introImg);
            const bgScale = Math.max(W / srcW, H / srcH) * (1.0 + progress * 0.04);
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.drawImage(
              introImg,
              (-srcW * bgScale) / 2,
              (-srcH * bgScale) / 2,
              srcW * bgScale,
              srcH * bgScale
            );
            ctx.restore();
            ctx.fillStyle = 'rgba(8, 47, 73, 0.32)';
            ctx.fillRect(0, 0, W, H);
          }
        }
      }

      // If an intro video is playing (like vita_da_cani_intro.mp4) and badges are off, let the video's own 3D logo shine!
      if (drewIntroVideo && branding.introShowEpisodeBadge === false && branding.introShowCastAvatars === false) {
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${landscape ? 32 : 40}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(
        (branding.introCustomTitle || seriesTitle || 'SERIE ORIGINALE').toUpperCase(),
        W / 2,
        landscape ? 110 : 220
      );

      if (branding.introCustomSubtitle) {
        ctx.fillStyle = '#bae6fd';
        ctx.font = `800 ${landscape ? 24 : 29}px Inter, sans-serif`;
        wrapTextCentered(
          ctx,
          branding.introCustomSubtitle,
          W / 2,
          landscape ? 155 : 285,
          W - 100,
          34
        );
      }

      if (branding.introShowEpisodeBadge !== false) {
        const pillY = landscape ? 195 : 410;
        drawRoundedRect(ctx, W / 2 - 140, pillY, 280, 58, 29, '#38bdf8');
        ctx.fillStyle = '#082f49';
        ctx.font = '900 26px Inter, sans-serif';
        ctx.fillText(`EPISODIO #${episodeNumber}`, W / 2, pillY + 38);

        const boxY = landscape ? 275 : 520;
        const boxW = landscape ? Math.min(820, W - 160) : W - 100;
        drawRoundedRect(
          ctx,
          (W - boxW) / 2,
          boxY,
          boxW,
          landscape ? 150 : 200,
          32,
          'rgba(255,255,255,0.95)'
        );
        ctx.fillStyle = '#0c4a6e';
        ctx.font = `900 ${landscape ? 34 : 38}px Inter, sans-serif`;
        wrapTextCentered(ctx, episodeTitle, W / 2, boxY + (landscape ? 68 : 85), boxW - 60, 44);
      }

      if (branding.introShowCastAvatars !== false) {
        const presentCast = cast.filter((c) => detectedCastIds.includes(c.id));
        const listToShow = presentCast.length > 0 ? presentCast : cast;
        const spacing = landscape ? 170 : 155;
        const startX = W / 2 - ((listToShow.length - 1) * spacing) / 2;
        const cy = landscape ? 545 : 910;
        const radius = landscape ? 48 : 56;

        listToShow.forEach((member, i) => {
          const cx = startX + i * spacing;
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          const img = imageCacheRef.current[member.referencePhotos[0]];
          if (img && img.complete) {
            const { srcW, srcH } = getNativeMediaDimensions(img);
            const s = Math.max((radius * 2) / srcW, (radius * 2) / srcH);
            ctx.drawImage(img, cx - (srcW * s) / 2, cy - (srcH * s) / 2, srcW * s, srcH * s);
          } else {
            ctx.fillStyle = '#e0f2fe';
            ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
          }
          ctx.restore();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = '800 22px Inter, sans-serif';
          ctx.fillText(member.name, cx, cy + radius + 32);
        });
      }

      return;
    }

    // 2. SMART OUTRO
    if (tSec >= introSec + netScenesSec) {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, branding.outroThemeColor || '#0f172a');
      grad.addColorStop(1, '#0c4a6e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      if (outroMediaList.length > 0) {
        const outroLocal = Math.max(0, tSec - (introSec + netScenesSec));
        const idx = Math.min(
          outroMediaList.length - 1,
          Math.floor((outroLocal / Math.max(0.5, outroSec)) * outroMediaList.length)
        );
        const activeOutroItem = outroMediaList[idx];
        if (
          activeOutroItem?.type === 'VIDEO' &&
          videoCacheRef.current[activeOutroItem.url] &&
          videoCacheRef.current[activeOutroItem.url].readyState >= 2
        ) {
          const outroVid = videoCacheRef.current[activeOutroItem.url];
          const { srcW, srcH } = getNativeMediaDimensions(outroVid);
          const bgScale = Math.max(W / srcW, H / srcH);
          ctx.save();
          ctx.translate(W / 2, H / 2);
          ctx.drawImage(
            outroVid,
            (-srcW * bgScale) / 2,
            (-srcH * bgScale) / 2,
            srcW * bgScale,
            srcH * bgScale
          );
          ctx.restore();
          ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
          ctx.fillRect(0, 0, W, H);
        } else if (activeOutroItem) {
          const outroImg = imageCacheRef.current[activeOutroItem.url];
          if (outroImg && outroImg.complete) {
            const { srcW, srcH } = getNativeMediaDimensions(outroImg);
            const bgScale = Math.max(W / srcW, H / srcH);
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.drawImage(
              outroImg,
              (-srcW * bgScale) / 2,
              (-srcH * bgScale) / 2,
              srcW * bgScale,
              srcH * bgScale
            );
            ctx.restore();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
            ctx.fillRect(0, 0, W, H);
          }
        }
      }

      const hasAnyAnimalInCast = cast.some((c) => c.type === 'ANIMAL');
      const seriesIcon =
        seriesTitle.toLowerCase().includes('vita da cani') || hasAnyAnimalInCast ? '🐾' : '🎬';
      ctx.fillStyle = '#fde047';
      ctx.font = '900 24px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        (
          branding.outroCustomHeader || `${seriesIcon} ${seriesTitle.toUpperCase()} • CAST UFFICIALE`
        ).toUpperCase(),
        W / 2,
        landscape ? 70 : 120
      );

      if (branding.outroShowCastCards !== false) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${landscape ? 34 : 38}px Inter, sans-serif`;
        ctx.fillText('PROTAGONISTI DELLA PUNTATA', W / 2, landscape ? 115 : 175);

        const usedIds = Array.from(
          new Set(scenes.flatMap((s) => s.characterIds || [s.characterId]))
        );
        const outroCast =
          branding.autoListDetectedCast && usedIds.length > 0
            ? cast.filter((c) => usedIds.includes(c.id))
            : cast;

        if (landscape) {
          const cardW = Math.min(340, (W - 120) / Math.max(1, outroCast.length) - 20);
          const totalRowW = outroCast.length * cardW + (outroCast.length - 1) * 24;
          const startX = (W - totalRowW) / 2;

          outroCast.forEach((member, idx) => {
            const cardX = startX + idx * (cardW + 24);
            const cardY = 160;
            drawRoundedRect(ctx, cardX, cardY, cardW, 420, 28, 'rgba(255,255,255,0.95)');

            const cx = cardX + cardW / 2;
            const cy = cardY + 110;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, 62, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            const img = imageCacheRef.current[member.referencePhotos[0]];
            if (img && img.complete) {
              const { srcW, srcH } = getNativeMediaDimensions(img);
              const s = Math.max(124 / srcW, 124 / srcH);
              ctx.drawImage(img, cx - (srcW * s) / 2, cy - (srcH * s) / 2, srcW * s, srcH * s);
            }
            ctx.restore();

            ctx.textAlign = 'center';
            ctx.fillStyle = '#0c4a6e';
            ctx.font = '900 28px Inter, sans-serif';
            ctx.fillText(
              `${member.type === 'ANIMAL' ? '🐾' : '🧑'} ${member.name}`,
              cx,
              cardY + 225
            );

            const roleText = branding.aiFunnyRoles
              ? funnyRolesByCastId[member.id] || member.defaultCreditRole
              : member.defaultCreditRole;

            ctx.fillStyle = '#0284c7';
            ctx.font = '700 20px Inter, sans-serif';
            wrapTextCentered(ctx, roleText, cx, cardY + 275, cardW - 40, 28);
          });
        } else {
          outroCast.forEach((member, idx) => {
            const cardY = 220 + idx * 225;
            drawRoundedRect(ctx, 50, cardY, W - 100, 195, 28, 'rgba(255,255,255,0.95)');

            const cx = 145;
            const cy = cardY + 98;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, 60, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            const img = imageCacheRef.current[member.referencePhotos[0]];
            if (img && img.complete) {
              const { srcW, srcH } = getNativeMediaDimensions(img);
              const s = Math.max(120 / srcW, 120 / srcH);
              ctx.drawImage(img, cx - (srcW * s) / 2, cy - (srcH * s) / 2, srcW * s, srcH * s);
            }
            ctx.restore();

            ctx.textAlign = 'left';
            ctx.fillStyle = '#0c4a6e';
            ctx.font = '900 30px Inter, sans-serif';
            ctx.fillText(
              `${member.type === 'ANIMAL' ? '🐾' : '🧑'} ${member.name}`,
              235,
              cardY + 72
            );

            const roleText = branding.aiFunnyRoles
              ? funnyRolesByCastId[member.id] || member.defaultCreditRole
              : member.defaultCreditRole;

            ctx.fillStyle = '#0284c7';
            ctx.font = '700 21px Inter, sans-serif';
            wrapTextLeft(ctx, roleText, 235, cardY + 114, W - 305, 28);
          });
        }
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#bae6fd';
      ctx.font = '800 22px Inter, sans-serif';
      wrapTextCentered(ctx, branding.footerText, W / 2, H - (landscape ? 45 : 85), W - 100, 30);
      return;
    }

    // 3. FULL-SCREEN 1080P LIVING CHARACTER 2.5D ANIMATION & CINEMA MONTAGE
    let cursor = introSec;
    let activeScene = scenes[0];
    let activeSceneIdx = 0;
    let localSec = 0;

    for (let idx = 0; idx < scenes.length; idx++) {
      const s = scenes[idx];
      if (tSec >= cursor && tSec < cursor + s.durationSec) {
        activeScene = s;
        activeSceneIdx = idx;
        localSec = tSec - cursor;
        break;
      }
      cursor += s.durationSec;
    }

    if (!activeScene) return;

    const repairedForScene = repairedVoicesRef.current[activeScene.id];
    const turns =
      repairedForScene?.updatedTurns ||
      (activeScene.dialogueTurns && activeScene.dialogueTurns.length > 0
        ? activeScene.dialogueTurns
        : [
            {
              characterId: activeScene.characterId,
              dialogueOrThought: activeScene.dialogueOrThought,
              startOffsetSec: 0,
              durationSec: activeScene.durationSec,
              focusRegion: 'CENTER' as const
            }
          ]);

    let activeTurn = turns[0];
    let activeTurnIdx = 0;
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const tEnd = t.startOffsetSec + t.durationSec;
      if (localSec >= t.startOffsetSec && (localSec < tEnd || i === turns.length - 1)) {
        activeTurn = t;
        activeTurnIdx = i;
        break;
      }
    }

    const character =
      cast.find((c) => c.id === activeTurn.characterId) ||
      cast.find((c) => c.id === activeScene.characterId) ||
      cast[0];
    const progress = Math.min(1, localSec / Math.max(1, activeScene.durationSec));

    const turnStart = activeTurn.startOffsetSec ?? 0;
    const turnDur = Math.max(0.6, activeTurn.durationSec ?? activeScene.durationSec);
    const turnLocalSec = Math.max(0, localSec - turnStart);
    const turnProgress = Math.min(1, turnLocalSec / turnDur);
    const isSpeakingWindow =
      turnLocalSec >= 0.04 && turnLocalSec <= Math.max(0.25, turnDur - 0.16);
    const speechEnergy = getRealtimeVoiceEnergy(localSec, isSpeakingWindow);

    const sitcomLine = ensureSitcomPunchyLine(
      activeTurn.dialogueOrThought || activeScene.dialogueOrThought,
      character,
      activeScene.order + activeTurnIdx,
      episodeTitle,
      seriesTitle
    );
    const cleanSpeechText = cleanDialogueTextForSpeech(sitcomLine);
    const speechWords = cleanSpeechText.split(/\s+/).filter(Boolean);

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);

    const isBakedGeminiSitcomVideo =
      activeScene.sceneType === 'USER_VIDEO' &&
      Boolean(activeScene.userVideoBlobUrl?.includes('vita_da_cani_'));

    const activeSpeakerBox = character ? activeScene.characterBoxes?.[character.id] : undefined;

    const focusRegion =
      activeTurn.focusRegion ||
      (activeSpeakerBox
        ? activeSpeakerBox.x + activeSpeakerBox.width / 2 < 0.38
          ? 'LEFT'
          : activeSpeakerBox.x + activeSpeakerBox.width / 2 > 0.62
          ? 'RIGHT'
          : 'CENTER'
        : turns.length > 1
        ? activeTurnIdx === 0
          ? 'LEFT'
          : 'RIGHT'
        : 'CENTER');

    const speakerFocusOffsetX = activeSpeakerBox
      ? (0.5 - (activeSpeakerBox.x + activeSpeakerBox.width / 2)) * W * 0.22
      : focusRegion === 'LEFT'
      ? W * 0.055
      : focusRegion === 'RIGHT'
      ? -W * 0.055
      : 0;

    const speakerFocusOffsetY = activeSpeakerBox
      ? (0.48 - (activeSpeakerBox.y + activeSpeakerBox.height / 2)) * H * 0.14
      : 0;

    let camScale = 1.0;
    let camOffsetX = 0;
    let camOffsetY = 0;
    let camRot = 0;

    if (!isBakedGeminiSitcomVideo) {
      const shot = activeScene.cameraShot || 'CLOSEUP_PUNCH';
      if (shot === 'CLOSEUP_PUNCH') {
        camScale = 1.04 + turnProgress * 0.065 + speechEnergy * 0.014;
      } else if (shot === 'PAN_CINEMATIC') {
        camScale = 1.05 + speechEnergy * 0.012;
        camOffsetX = speakerFocusOffsetX * 1.2 + Math.sin(localSec * 1.4) * 5.5;
      } else if (shot === 'REACTION_SHAKE') {
        camScale = 1.06 + speechEnergy * 0.018;
        camOffsetX = speakerFocusOffsetX + Math.sin(localSec * 16) * (speechEnergy * 3.0);
        camOffsetY = speakerFocusOffsetY + Math.cos(localSec * 14) * (speechEnergy * 2.2);
      } else {
        camScale = 1.02 + progress * 0.055 + speechEnergy * 0.012;
      }
      camOffsetX += speakerFocusOffsetX + Math.sin(localSec * 1.6) * 2.2;
      camOffsetY += speakerFocusOffsetY + Math.cos(localSec * 1.3) * 1.6;
      camRot = Math.sin(localSec * 4.2) * speechEnergy * 0.008;
    }

    /**
     * 60FPS MULTI-SHOT AI VIDEO COLLAGE RENDERER (ZERO LIP-SYNC / ZERO MOUTH WARPING):
     * Elaborates each scene as a standalone cinematic video clip inside the final collage,
     * driven by the AI instruction (`veoMotionPrompt`), camera direction (`cameraShot`),
     * initial uploaded material (`sourceEl`), and AI-elaborated action keyframe (`elaboratedActionEl`).
     */
    const promptLower = (activeScene.veoMotionPrompt || '').toLowerCase();
    const wantsFastAction =
      promptLower.includes('corsa') ||
      promptLower.includes('scatto') ||
      promptLower.includes('azione') ||
      promptLower.includes(' insegu') ||
      promptLower.includes('veloc') ||
      activeScene.cameraShot === 'REACTION_SHAKE';
    const wantsPanLeftRight =
      promptLower.includes('panoramica') ||
      promptLower.includes('laterale') ||
      promptLower.includes('carrellata') ||
      activeScene.cameraShot === 'PAN_CINEMATIC';
    const wantsZoomIn =
      promptLower.includes('avvicin') ||
      promptLower.includes('primo piano') ||
      promptLower.includes('zoom') ||
      activeScene.cameraShot === 'CLOSEUP_PUNCH';

    const drawCinemaCollageSceneMedia = (
      sourceEl: HTMLImageElement | HTMLVideoElement,
      alpha = 1.0,
      elaboratedActionEl?: HTMLImageElement | null,
      scenePrompt?: string
    ) => {
      const { srcW, srcH } = getNativeMediaDimensions(sourceEl);
      if (srcW <= 0 || srcH <= 0) return;

      ctx.save();
      ctx.globalAlpha = alpha;

      // 1. PARALLAX CINEMA ENVIRONMENT BACKDROP
      const bgCoverScale = Math.max(W / srcW, H / srcH) * 1.12;
      const bgParallaxX = -camOffsetX * 0.4 + Math.sin(localSec * 0.85) * 8;
      const bgParallaxY = -camOffsetY * 0.3 + Math.cos(localSec * 0.65) * 5;
      ctx.save();
      ctx.translate(W / 2 + bgParallaxX, H / 2 + bgParallaxY);
      ctx.filter = 'blur(24px) brightness(0.48) saturate(1.18)';
      ctx.drawImage(
        sourceEl,
        (-srcW * bgCoverScale) / 2,
        (-srcH * bgCoverScale) / 2,
        srcW * bgCoverScale,
        srcH * bgCoverScale
      );
      ctx.filter = 'none';
      ctx.restore();

      // 2. MULTI-SHOT CINEMA CAMERA MOTION DIRECTED BY AI INSTRUCTIONS (`veoMotionPrompt`)
      const easeInOut = 0.5 - 0.5 * Math.cos(progress * Math.PI);
      const dynamicZoom = wantsZoomIn
        ? 1.02 + easeInOut * 0.14
        : wantsFastAction
        ? 1.05 + Math.sin(progress * Math.PI) * 0.09
        : 1.03 + easeInOut * 0.08;

      const dirSign = activeSceneIdx % 2 === 0 ? 1 : -1;
      const dynamicPanX = wantsPanLeftRight
        ? (progress - 0.5) * W * 0.09 * dirSign
        : wantsFastAction
        ? Math.sin(localSec * 9.0) * 5.5 + (progress - 0.5) * W * 0.04 * dirSign
        : (progress - 0.5) * W * 0.045 * dirSign;

      const dynamicPanY = wantsFastAction
        ? Math.cos(localSec * 7.5) * 4.0
        : (0.5 - progress) * H * 0.025;

      const hasDistinctActionShot =
        Boolean(elaboratedActionEl && elaboratedActionEl.complete) &&
        elaboratedActionEl !== sourceEl;

      // Smooth multi-shot transition from Shot A (initial material) to Shot B (AI-elaborated action keyframe)
      const shotBBlend = hasDistinctActionShot
        ? Math.max(0, Math.min(1, (progress - 0.36) / 0.24))
        : 0;

      // Render Shot A (Initial Material with AI Camera Direction)
      ctx.save();
      ctx.translate(W / 2 + camOffsetX + dynamicPanX, H / 2 + camOffsetY + dynamicPanY);
      ctx.rotate(camRot * 0.5);
      ctx.scale(camScale * dynamicZoom, camScale * dynamicZoom);
      drawBackdropAndCrispMedia(sourceEl, W, H);
      ctx.restore();

      // Render Shot B (AI-Elaborated Action Keyframe with Complementary Camera Motion)
      if (hasDistinctActionShot && elaboratedActionEl && shotBBlend > 0.01) {
        const shotBZoom = 1.14 - easeInOut * 0.09;
        const shotBPanX = -dynamicPanX * 0.65;
        const shotBPanY = -dynamicPanY * 0.5;

        ctx.save();
        ctx.globalAlpha = alpha * shotBBlend;
        ctx.translate(W / 2 + shotBPanX, H / 2 + shotBPanY);
        ctx.scale(shotBZoom, shotBZoom);
        drawBackdropAndCrispMedia(elaboratedActionEl, W, H);
        ctx.restore();

        // Optical Anamorphic Light-Flare Sweep during the Multi-Shot Transition
        if (shotBBlend > 0.05 && shotBBlend < 0.95) {
          const flareIntensity = Math.sin(shotBBlend * Math.PI);
          const sweepX = W * shotBBlend;
          const flareGrad = ctx.createLinearGradient(sweepX - 180, 0, sweepX + 180, H);
          flareGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
          flareGrad.addColorStop(0.5, `rgba(253, 224, 71, ${0.32 * flareIntensity})`);
          flareGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = flareGrad;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // Subtle Top-Center Clip Indicator showing which individual video clip is playing in the collage
      if (!isBakedGeminiSitcomVideo && scenePrompt !== undefined) {
        ctx.save();
        const clipTag = `🎞️ CLIP #${activeScene.order}/${scenes.length}`;
        ctx.font = `800 ${landscape ? 13 : 12}px Inter, system-ui, sans-serif`;
        const tagW = ctx.measureText(clipTag).width + 24;
        const tagH = 26;
        const tagX = (W - tagW) / 2;
        const tagY = landscape ? 24 : 34;
        drawRoundedRect(ctx, tagX, tagY, tagW, tagH, 13, 'rgba(15, 23, 42, 0.78)');
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.fillText(clipTag, W / 2, tagY + 17.5);
        ctx.restore();
      }

      ctx.restore();
    };

    const renderSceneVisual = (sc: SceneCard, _scIdx: number, alpha: number) => {
      const isActiveScene = sc.id === activeScene.id;
      const speakingMember = isActiveScene
        ? character
        : cast.find((c) => c.id === sc.characterId) || cast[0];
      const primarySceneMember = cast.find((c) => c.id === sc.characterId) || cast[0];

      const bestSpeakerPhoto =
        speakingMember?.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
        speakingMember?.referencePhotos?.[0] ||
        '';
      const bestPrimaryPhoto =
        primarySceneMember?.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
        primarySceneMember?.referencePhotos?.[0] ||
        '';

      // Primary base material for Shot A
      const targetPhotoUrl =
        sc.aiPhotoSourceUrl && !sc.aiPhotoSourceUrl.startsWith('data:image/svg+xml')
          ? sc.aiPhotoSourceUrl
          : bestPrimaryPhoto || bestSpeakerPhoto || sc.generatedAiImageUrl || '';

      // AI-elaborated action keyframe (or cutaway co-star frame) for Shot B
      const elaboratedActionUrl =
        sc.generatedAiImageUrl &&
        !sc.generatedAiImageUrl.startsWith('data:image/svg+xml') &&
        sc.generatedAiImageUrl !== targetPhotoUrl
          ? sc.generatedAiImageUrl
          : bestSpeakerPhoto && bestSpeakerPhoto !== targetPhotoUrl
          ? bestSpeakerPhoto
          : null;

      const elaboratedActionImg = elaboratedActionUrl
        ? imageCacheRef.current[elaboratedActionUrl] || null
        : null;

      // 1. If the scene has a cached video (USER_VIDEO or Veo / synthesized video clip), render the video stream
      if (videoCacheRef.current[sc.id]) {
        const vid = videoCacheRef.current[sc.id];
        if (vid.readyState >= 2) {
          drawCinemaCollageSceneMedia(vid, alpha, elaboratedActionImg, sc.veoMotionPrompt);
          return;
        }
      }

      // 2. Render Living Animated Character with 2.5D Head/Jaw Lip-Sync, Eye Blinks & Reel Overlays
      const primaryImg =
        (targetPhotoUrl && imageCacheRef.current[targetPhotoUrl]?.complete
          ? imageCacheRef.current[targetPhotoUrl]
          : null) ||
        (bestSpeakerPhoto && imageCacheRef.current[bestSpeakerPhoto]?.complete
          ? imageCacheRef.current[bestSpeakerPhoto]
          : null) ||
        (fallbackUrl && imageCacheRef.current[fallbackUrl]?.complete
          ? imageCacheRef.current[fallbackUrl]
          : null);

      if (primaryImg) {
        ctx.save();
        ctx.globalAlpha = alpha;
        drawLivingAnimatedCharacterFrame({
          ctx,
          W,
          H,
          firstImg: primaryImg,
          secondImg: elaboratedActionImg,
          progress,
          localSec,
          speechEnergy,
          character: speakingMember,
          seriesTitle,
          roleBadge: sc.characterRoleBadge,
          lineText: sc.dialogueOrThought,
          cameraShot: sc.cameraShot,
          box: sc.characterBoxes?.[speakingMember.id],
          isActionFast: wantsFastAction,
          isPan: wantsPanLeftRight
        });
        ctx.restore();
      }
    };

    renderSceneVisual(activeScene, activeSceneIdx, 1.0);

    // Smooth 0.16s Cinema Cut Dissolve from previous scene
    if (localSec < 0.16 && activeSceneIdx > 0) {
      const prevScene = scenes[activeSceneIdx - 1];
      const fadeOutAlpha = Math.max(0, 1 - localSec / 0.16);
      renderSceneVisual(prevScene, activeSceneIdx - 1, fadeOutAlpha);
    }

    // 4. CLEAN CINEMA SERIES BADGE & LOWER-THIRD SPEAKER GRAPHICS (never covers the character's face!)
    if (!isBakedGeminiSitcomVideo) {
      drawVitaDaCaniSitcomOverlay(
        ctx,
        W,
        H,
        landscape,
        seriesTitle || 'Serie Originale',
        character?.name || 'Protagonista',
        activeScene.characterRoleBadge ||
          funnyRolesByCastId[character?.id || ''] ||
          getCharacterSitcomRoleBadge(character, seriesTitle),
        localSec,
        activeScene.durationSec,
        character?.type === 'ANIMAL'
      );
    }

    // Subtle Bottom Cinema Gradient Vignette for Subtitles
    const vignetteTopY = H * (landscape ? 0.72 : 0.75);
    const vigGrad = ctx.createLinearGradient(0, vignetteTopY, 0, H);
    vigGrad.addColorStop(0, 'rgba(2, 6, 23, 0)');
    vigGrad.addColorStop(0.6, 'rgba(2, 6, 23, 0.5)');
    vigGrad.addColorStop(1, 'rgba(2, 6, 23, 0.84)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, vignetteTopY, W, H - vignetteTopY);

    // 5. ANIMATED WORD-BY-WORD KARAOKE SITCOM SUBTITLES + LIVE LIP-SYNC WAVEFORM BADGE
    const bottomSafeMargin =
      fmt.id === 'IG_STORIES_9_16'
        ? 115
        : fmt.id === 'IG_REELS_9_16'
        ? 98
        : landscape
        ? 38
        : 84;

    const isUmaChar = character?.name.toLowerCase().includes('uma');
    const isZoraChar = character?.name.toLowerCase().includes('zora');
    const speakerColor = isUmaChar
      ? '#f472b6'
      : isZoraChar || character?.type === 'ANIMAL'
      ? '#fde047'
      : '#38bdf8';

    const maxSubWidth = landscape ? Math.min(960, W - 140) : W - 76;
    const subFontSize = landscape ? 29 : 27;
    const subLineHeight = landscape ? 40 : 37;

    ctx.save();
    ctx.font = `800 ${subFontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    const wordsToWrap = speechWords.length > 0 ? speechWords : ['...'];
    const activeWordGlobalIdx = Math.min(
      wordsToWrap.length - 1,
      Math.max(0, Math.floor(turnProgress * wordsToWrap.length))
    );

    const wrappedWordLines: Array<Array<{ word: string; globalIdx: number }>> = [];
    let curWordLine: Array<{ word: string; globalIdx: number }> = [];
    let curLineText = '';
    wordsToWrap.forEach((w, gIdx) => {
      const testLine = curLineText ? `${curLineText} ${w}` : w;
      if (ctx.measureText(testLine).width > maxSubWidth && curWordLine.length > 0) {
        wrappedWordLines.push(curWordLine);
        curWordLine = [{ word: w, globalIdx: gIdx }];
        curLineText = w;
      } else {
        curWordLine.push({ word: w, globalIdx: gIdx });
        curLineText = testLine;
      }
    });
    if (curWordLine.length > 0) wrappedWordLines.push(curWordLine);
    const linesToDraw = wrappedWordLines.slice(0, 2);

    const blockHeight = linesToDraw.length * subLineHeight;
    const baseSubY = H - bottomSafeMargin - blockHeight;

    // Speaker Name Badge + Interactive Botta-e-Risposta Indicator + Live Lip-Sync Equalizer Bars
    const interactionLabel =
      turns.length > 1
        ? `💬 ${character?.name.toUpperCase()} (TURNO ${activeTurnIdx + 1}/${turns.length})`
        : `🎙️ ${(character?.name || 'PROTAGONISTA').toUpperCase()}`;
    const speakerTagY = baseSubY - 16;
    ctx.font = `900 ${landscape ? 19 : 18}px Inter, system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.lineWidth = 5;
    ctx.strokeText(interactionLabel, W / 2, speakerTagY);
    ctx.fillStyle = speakerColor;
    ctx.fillText(interactionLabel, W / 2, speakerTagY);

    // Draw 5-Bar Live Lip-Sync Audio Waveform next to the speaker label
    if (speechEnergy > 0.04) {
      const labelW = ctx.measureText(interactionLabel).width;
      const waveStartX = W / 2 + labelW / 2 + 12;
      const barMultipliers = [0.55, 0.95, 1.25, 0.85, 0.6];
      barMultipliers.forEach((mult, bIdx) => {
        const bh = Math.max(4, Math.min(18, speechEnergy * 16 * mult));
        const bx = waveStartX + bIdx * 5;
        const by = speakerTagY - 6 - bh / 2;
        drawRoundedRect(ctx, bx, by, 3.5, bh, 1.5, '#fde047');
      });
    }

    // Word-by-Word Karaoke Animated Subtitles
    ctx.font = `900 ${subFontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    const spaceWidth = ctx.measureText(' ').width;

    linesToDraw.forEach((wordItems, lineIdx) => {
      const lineStr = wordItems.map((wi) => wi.word).join(' ');
      const totalLineW = ctx.measureText(lineStr).width;
      let cursorX = (W - totalLineW) / 2;
      const baseLineY = baseSubY + (lineIdx + 0.82) * subLineHeight;

      wordItems.forEach((wi) => {
        const isCurrentWord = wi.globalIdx === activeWordGlobalIdx && isSpeakingWindow;
        const isPastWord = wi.globalIdx < activeWordGlobalIdx;
        const wordW = ctx.measureText(wi.word).width;
        const wordBounceY = isCurrentWord ? -Math.max(2, speechEnergy * 4.5) : 0;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = isCurrentWord ? 14 : 9;
        ctx.shadowOffsetY = 2;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.96)';
        ctx.lineWidth = isCurrentWord ? 7 : 6;
        ctx.strokeText(wi.word, cursorX, baseLineY + wordBounceY);

        ctx.fillStyle = isCurrentWord
          ? '#fde047'
          : isPastWord
          ? '#ffffff'
          : 'rgba(255, 255, 255, 0.78)';
        ctx.fillText(wi.word, cursorX, baseLineY + wordBounceY);
        ctx.restore();

        cursorX += wordW + spaceWidth;
      });
    });

    ctx.restore();
  };

  /**
   * Launches the Full HD 1080p GPU MediaRecorder export (1080x1920 or 1920x1080 at 16 Mbps).
   */
  const executeVideoExportWithPreset = async (preset: ExportFormatSpec) => {
    setSelectedPresetId(preset.id);
    setIsFormatModalOpen(false);

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(preset.width * RENDER_SCALE);
    canvas.height = Math.round(preset.height * RENDER_SCALE);

    setIsExportingMp4(true);
    setExportSuccessUrl(null);
    stopPlayback();

    await ensureAllSitcomVoicesReady();

    ensureAudioGraph();
    const canvasStream = canvas.captureStream(60);
    const combinedTracks = [...canvasStream.getVideoTracks()];
    if (masterDestRef.current) {
      combinedTracks.push(...masterDestRef.current.stream.getAudioTracks());
    }

    const finalStream = new MediaStream(combinedTracks);
    const mimeCandidates = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm'
    ];
    const selectedMime =
      mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(finalStream, {
      mimeType: selectedMime,
      videoBitsPerSecond: 16_000_000
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: selectedMime });
      const url = URL.createObjectURL(blob);
      setExportSuccessUrl(url);
      setIsExportingMp4(false);

      const a = document.createElement('a');
      a.href = url;
      const cleanTitle = episodeTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `SkySketch_${preset.id}_Ep${episodeNumber}_${cleanTitle}_${totalSec}s.mp4`;
      a.click();
    };

    recorder.start(200);
    startPlayback(true, preset, () => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    });
  };

  const handleExportZipPackage = async () => {
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      const summary = {
        seriesTitle,
        episodeNumber,
        episodeTitle,
        exportPreset: activeFormat,
        targetTotalDurationSec: totalSec,
        introDurationSec: introSec,
        outroDurationSec: outroSec,
        scenes: scenes.map((s) => ({
          order: s.order,
          type: s.sceneType,
          durationSec: s.durationSec,
          character: cast.find((c) => c.id === s.characterId)?.name,
          dialogueOrThought: s.dialogueOrThought
        }))
      };

      zip.file('sceneggiatura_storyboard.json', JSON.stringify(summary, null, 2));

      for (const scene of scenes) {
        const bestAudioUrl =
          repairedVoicesRef.current[scene.id]?.audioUrl || scene.generatedAudioUrl;
        if (bestAudioUrl) {
          try {
            const res = await fetch(bestAudioUrl.split('#')[0]);
            const blob = await res.blob();
            zip.file(`audio_scena_${scene.order}.wav`, blob);
          } catch {
            // Ignore
          }
        }

        const singleVideoUrl =
          scene.sceneType === 'USER_VIDEO' && scene.userVideoBlobUrl
            ? scene.userVideoBlobUrl
            : scene.generatedAiVideoUrl;
        if (
          singleVideoUrl &&
          (singleVideoUrl.startsWith('blob:') || singleVideoUrl.startsWith('http'))
        ) {
          try {
            const vRes = await fetch(singleVideoUrl);
            const vBlob = await vRes.blob();
            const ext = vBlob.type.includes('mp4') ? 'mp4' : 'webm';
            zip.file(`singolo_video_scena_${scene.order}.${ext}`, vBlob);
          } catch {
            // Ignore
          }
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const zipUrl = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `SkySketch_Pacchetto_Clip_Ep${episodeNumber}.zip`;
      a.click();
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* SELETTORE FORMATO RAPIDO IN ALTO (9:16 REELS / STORIES / SHORTS vs 16:9 YOUTUBE VIDEO) */}
      <div className="bg-white border-2 border-sky-200 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-wider text-sky-700 block">
            Passo 3 di 3 • Montaggio Collage dei Singoli Video AI
          </span>
          <h3 className="text-lg font-black text-slate-800">{activeFormat.title}</h3>
          <p className="text-xs text-slate-500">{activeFormat.safeZoneHint}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {EXPORT_FORMAT_PRESETS.map((preset) => {
            const isSelected = preset.id === selectedPresetId;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedPresetId(preset.id)}
                className={`px-3.5 py-2 rounded-xl font-extrabold text-xs border transition ${
                  isSelected
                    ? 'bg-sky-500 text-white border-sky-600 shadow-sm'
                    : 'bg-sky-50 text-sky-900 border-sky-200 hover:bg-sky-100'
                }`}
              >
                {preset.title}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: ADAPTIVE 9:16 OR 16:9 CANVAS PLAYER */}
        <div
          className={`${
            isLandscape ? 'lg:col-span-7' : 'lg:col-span-5'
          } flex flex-col items-center`}
        >
          <div className="relative p-3 rounded-[2rem] bg-slate-900 shadow-2xl border-4 border-sky-300 w-full flex justify-center">
            <div
              className={`${
                isLandscape
                  ? 'w-full aspect-[16/9]'
                  : 'w-[290px] sm:w-[340px] aspect-[9/16]'
              } rounded-[1.5rem] overflow-hidden bg-sky-950 relative`}
            >
              <canvas
                ref={canvasRef}
                width={activeFormat.width}
                height={activeFormat.height}
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* Player Controls */}
          <div className="w-full mt-4 bg-white border-2 border-sky-200 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between text-xs font-extrabold text-sky-900">
              <span>⏱️ {currentTimeSec.toFixed(1)}s</span>
              <span className="px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800">
                {activeFormat.aspectRatio} • {activeFormat.width}x{activeFormat.height} • 60 FPS
              </span>
              <span>Totale: {totalSec.toFixed(1)}s</span>
            </div>

            <div className="w-full h-2.5 bg-sky-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-100"
                style={{ width: `${Math.min(100, (currentTimeSec / totalSec) * 100)}%` }}
              />
            </div>

            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (isPlaying) {
                    stopPlayback();
                  } else {
                    startPlayback(false);
                  }
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-base shadow-sm transition"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-5 h-5" /> Pausa
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" /> Riproduci Collage Video ({activeFormat.aspectRatio})
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => startPlayback(true)}
                className="p-3 rounded-2xl bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold transition"
                title="Ricomincia da capo"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: EXPORT & SUMMARY */}
        <div className={`${isLandscape ? 'lg:col-span-5' : 'lg:col-span-7'} space-y-6`}>
          <div className="bg-white border-2 border-sky-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  stopPlayback();
                  onBackToStep2();
                }}
                className="px-3.5 py-2 rounded-2xl bg-sky-100 text-sky-800 hover:bg-sky-200 font-bold text-xs inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Torna ai Singoli Video AI (Step 2)
              </button>
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold">
                🎞️ Collage di {scenes.length} Singoli Video AI Attivo
              </span>
            </div>

            <div>
              <h2 className="text-2xl font-black text-slate-800">
                🎬 Ep. #{episodeNumber}: {episodeTitle}
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Durata totale collage: <strong>{totalSec} secondi</strong> (
                {introSec}s Sigla + {netScenesSec}s Collage di {scenes.length} Clip Video + {outroSec}s Titoli di Coda)
              </p>
            </div>

            {/* SEQUENZA COLLAGE DEI SINGOLI VIDEO AI */}
            <div className="p-3.5 rounded-2xl bg-slate-900 border-2 border-sky-300 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-sky-300 uppercase tracking-wider">
                  🎞️ Sequenza Collage dei Singoli Video ({scenes.length} Clip Unite)
                </span>
                <span className="text-[11px] font-bold text-emerald-300">
                  Zero Lip-Sync • Regia Multi-Shot AI
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
                {scenes.map((sc, idx) => {
                  let sceneStartSec = introSec;
                  for (let i = 0; i < idx; i++) {
                    sceneStartSec += scenes[i].durationSec;
                  }
                  const isCurrentClip =
                    currentTimeSec >= sceneStartSec &&
                    currentTimeSec < sceneStartSec + sc.durationSec;
                  const singleClipUrl =
                    sc.sceneType === 'USER_VIDEO' && sc.userVideoBlobUrl
                      ? sc.userVideoBlobUrl
                      : sc.generatedAiVideoUrl &&
                        (sc.generatedAiVideoUrl.startsWith('blob:') ||
                          sc.generatedAiVideoUrl.startsWith('http'))
                      ? sc.generatedAiVideoUrl
                      : null;
                  const thumbImg =
                    sc.generatedAiImageUrl ||
                    sc.aiPhotoSourceUrl ||
                    cast.find((c) => c.id === sc.characterId)?.referencePhotos?.[0] ||
                    '';

                  return (
                    <div
                      key={sc.id}
                      onClick={() => {
                        stopPlayback();
                        setCurrentTimeSec(sceneStartSec + 0.05);
                        renderCanvasFrameAtTime(sceneStartSec + 0.05, activeFormat);
                      }}
                      className={`p-2 rounded-xl border cursor-pointer transition flex flex-col justify-between gap-1.5 ${
                        isCurrentClip
                          ? 'bg-sky-900/90 border-amber-400 ring-2 ring-amber-400/50'
                          : 'bg-slate-800/90 border-slate-700 hover:border-sky-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-black text-amber-300">
                          Clip #{sc.order} ({sc.durationSec}s)
                        </span>
                        {singleClipUrl && (
                          <a
                            href={singleClipUrl}
                            download={`Singolo_Video_Scena_${sc.order}.webm`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white"
                            title="Scarica questo singolo video"
                          >
                            ⬇️
                          </a>
                        )}
                      </div>
                      {thumbImg && (
                        <img
                          src={thumbImg}
                          alt={`Clip ${sc.order}`}
                          className="w-full h-12 object-cover rounded-lg border border-slate-600"
                        />
                      )}
                      <p className="text-[10px] text-slate-300 line-clamp-1 font-semibold">
                        {sc.veoMotionPrompt || sc.visualActionDescription || sc.dialogueOrThought}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* PANNELLO VOCI CAMPIONATE E TIMBRO PERSONAGGI ATTIVO NEL VIDEO */}
            <div className="p-4 rounded-2xl bg-sky-50/90 border-2 border-sky-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-sky-600" />
                  <span className="text-xs sm:text-sm font-black text-sky-950">
                    🎙️ Voci Personaggi Campionati &amp; Audio nel Collage
                  </span>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                    isPreparingVoices
                      ? 'bg-amber-100 text-amber-800 animate-pulse'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {isPreparingVoices
                    ? '⏳ Sintesi timbro voci personaggi in corso...'
                    : `✅ Voci Personaggi Pronte (v4.${voicesReadyVersion})`}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {cast.map((member) => {
                  const vc = member.voiceConfig;
                  const hasSampled = Boolean(vc?.voiceSampleBase64 || vc?.voiceSampleBlobUrl);
                  const pitchVal = (vc?.pitch ?? 1.0).toFixed(2);
                  return (
                    <span
                      key={member.id}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-extrabold border ${
                        hasSampled
                          ? 'bg-emerald-100/90 text-emerald-900 border-emerald-300'
                          : 'bg-white text-sky-900 border-sky-200'
                      }`}
                    >
                      <span>{member.type === 'ANIMAL' ? '🐾' : '🧑'} {member.name}:</span>
                      <span className="font-bold">
                        {hasSampled
                          ? vc?.useRecordedVoiceDirectly
                            ? '🎤 Voce Campionata Diretta'
                            : `🧬 Timbro Campionato (${pitchVal}x)`
                          : `🎛️ Pitch ${pitchVal}x`}
                      </span>
                    </span>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    activeVoiceSceneIdRef.current = null;
                    setPrioritizeCastVoices(true);
                  }}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-extrabold border transition ${
                    prioritizeCastVoices
                      ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                      : 'bg-white text-sky-900 border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  🎙️ Usa Voci Personaggi su Tutte le Scene (Attivo)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    activeVoiceSceneIdRef.current = null;
                    setPrioritizeCastVoices(false);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-extrabold border transition ${
                    !prioritizeCastVoices
                      ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                      : 'bg-white text-sky-900 border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  🔊 Audio Originale Clip Video
                </button>
              </div>
            </div>

            {/* Giant Export Button that opens the Format & Platform Selection Modal */}
            <div className="space-y-3 pt-3">
              <button
                type="button"
                disabled={isExportingMp4}
                onClick={() => setIsFormatModalOpen(true)}
                className="w-full py-5 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:opacity-65 text-white font-black text-lg sm:text-xl shadow-lg hover:shadow-xl transition flex items-center justify-center gap-3"
              >
                <Download className="w-7 h-7" />
                {isExportingMp4
                  ? `Esportazione Collage ${activeFormat.aspectRatio} in corso (${currentTimeSec.toFixed(0)}s / ${totalSec}s)...`
                  : `📥 Esporta Video Collage Finale (16:9 o 9:16) MP4`}
              </button>

              <button
                type="button"
                disabled={isExportingZip}
                onClick={handleExportZipPackage}
                className="w-full py-3.5 px-6 rounded-2xl bg-sky-100 hover:bg-sky-200 text-sky-800 font-extrabold text-sm sm:text-base transition flex items-center justify-center gap-2"
              >
                <Package className="w-5 h-5" />
                {isExportingZip
                  ? 'Creazione archivio ZIP...'
                  : '📦 Scarica Tutti i Singoli Video + Audio + Copione (ZIP)'}
              </button>
            </div>

            {exportSuccessUrl && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-bold flex flex-wrap items-center justify-between gap-2">
                <span>🎉 Video Collage {activeFormat.aspectRatio} esportato con successo!</span>
                <a
                  href={exportSuccessUrl}
                  download={`SkySketch_${activeFormat.id}_Ep${episodeNumber}_${totalSec}s.mp4`}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-extrabold"
                >
                  Salva File MP4
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODALE DI SCELTA FORMATO E DESTINAZIONE PRIMA DELL'ESPORTAZIONE */}
      {isFormatModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white border-t-2 sm:border-2 border-sky-200 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-sky-50 border-b border-sky-200">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="p-2 sm:p-2.5 bg-sky-500 text-white rounded-2xl flex-shrink-0">
                  <Film className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-xl font-black text-slate-800 leading-tight">
                    📐 Scegli il Formato di Esportazione
                  </h3>
                  <p className="text-xs text-slate-600 hidden sm:block">
                    L&apos;esportazione adatta automaticamente inquadratura, risoluzione (9:16 o 16:9) e sottotitoli
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormatModalOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-800 rounded-xl flex-shrink-0"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 p-4 sm:p-6 space-y-3 overflow-y-auto">
              {EXPORT_FORMAT_PRESETS.map((preset) => {
                const isSelected = preset.id === selectedPresetId;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={`p-3.5 sm:p-4 rounded-2xl border-2 cursor-pointer transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-sky-50 border-sky-500 ring-2 ring-sky-200'
                        : 'bg-white border-sky-200 hover:bg-sky-50/50'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-black text-sm sm:text-base text-slate-800">
                          {preset.title}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-sky-500 text-white text-[11px] font-extrabold">
                          {preset.aspectRatio} ({preset.width}x{preset.height})
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 font-medium">{preset.subtitle}</p>
                      <p className="text-[11px] text-sky-800 font-bold">
                        ✓ {preset.safeZoneHint}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        executeVideoExportWithPreset(preset);
                      }}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-black text-xs sm:text-sm shadow-sm flex-shrink-0 text-center transition"
                    >
                      Esporta Ora →
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 px-4 sm:px-6 py-3.5 bg-sky-50 border-t border-sky-200">
              <button
                type="button"
                onClick={() => setIsFormatModalOpen(false)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-2xl bg-sky-100 text-sky-800 font-extrabold text-sm text-center"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => executeVideoExportWithPreset(activeFormat)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-sm shadow-md"
              >
                <Download className="w-4 h-4" /> Avvia Esportazione ({activeFormat.aspectRatio})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Draws the Series Broadcast Cinema & Sitcom Graphics Package:
 * 1) Top-right Series Logo badge (uses 🐾 only for "Vita da Cani" or animal characters, otherwise 🎬)
 * 2) Clean, non-intrusive top-left Character Name & Role tag (never covers the character's face!)
 */
function drawVitaDaCaniSitcomOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  landscape: boolean,
  seriesTitle: string,
  characterName: string,
  roleBadge: string,
  localSec: number,
  _durationSec: number,
  isAnimalCharacter?: boolean
) {
  ctx.save();

  const isVdc = (seriesTitle || '').toLowerCase().includes('vita da cani');
  const icon = isVdc || isAnimalCharacter ? '🐾' : '🎬';

  // A. Top-Right Broadcast Series Badge
  const labelText = `${icon} ${(seriesTitle || 'Serie').slice(0, 20)}`;
  ctx.font = `900 ${landscape ? 17 : 16}px Inter, system-ui, sans-serif`;
  const badgeMetrics = ctx.measureText(labelText);
  const badgeW = Math.max(landscape ? 185 : 175, badgeMetrics.width + 36);
  const badgeH = landscape ? 40 : 38;
  const badgeX = W - badgeW - (landscape ? 24 : 20);
  const badgeY = landscape ? 22 : 30;

  ctx.save();
  drawRoundedRect(ctx, badgeX + 2, badgeY + 3, badgeW, badgeH, 14, 'rgba(2, 6, 23, 0.68)');
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 14, 'rgba(15, 23, 42, 0.88)');
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#38bdf8';
  ctx.stroke();

  ctx.fillStyle = '#fde047';
  ctx.textAlign = 'center';
  ctx.fillText(labelText, badgeX + badgeW / 2, badgeY + badgeH * 0.66);
  ctx.restore();

  // B. Compact Top-Left Character Name + Role Callout (first 2.8 seconds, positioned safely away from the center face)
  const calloutAlpha =
    localSec < 0.16
      ? localSec / 0.16
      : localSec < 2.4
      ? 1.0
      : localSec < 2.9
      ? 1.0 - (localSec - 2.4) / 0.5
      : 0;

  if (calloutAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, calloutAlpha));

    const anchorX = landscape ? 28 : 22;
    const anchorY = landscape ? 26 : 34;

    const nameUpper = (characterName || 'PROTAGONISTA').toUpperCase();
    const roleUpper = (roleBadge || 'PROTAGONISTA').toUpperCase();

    ctx.font = `900 ${landscape ? 24 : 22}px Inter, system-ui, sans-serif`;
    const nameW = ctx.measureText(nameUpper).width;
    ctx.font = `800 ${landscape ? 13 : 12}px Inter, system-ui, sans-serif`;
    const roleW = ctx.measureText(roleUpper).width;

    const cardW = Math.max(150, Math.max(nameW, roleW) + 34);
    const cardH = landscape ? 58 : 54;

    drawRoundedRect(ctx, anchorX + 3, anchorY + 4, cardW, cardH, 14, 'rgba(2, 6, 23, 0.65)');
    drawRoundedRect(ctx, anchorX, anchorY, cardW, cardH, 14, 'rgba(15, 23, 42, 0.88)');
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#facc15';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fde047';
    ctx.font = `900 ${landscape ? 22 : 20}px Inter, system-ui, sans-serif`;
    ctx.fillText(nameUpper, anchorX + 16, anchorY + (landscape ? 27 : 25));

    ctx.fillStyle = '#bae6fd';
    ctx.font = `800 ${landscape ? 12 : 11}px Inter, system-ui, sans-serif`;
    ctx.fillText(roleUpper, anchorX + 16, anchorY + (landscape ? 46 : 43));

    ctx.restore();
  }

  ctx.restore();
}

// Canvas drawing helpers
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function wrapTextCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currentY);
}

function wrapTextLeft(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currentY);
}
