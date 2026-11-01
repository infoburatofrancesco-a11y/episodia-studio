import React, { useState } from 'react';
import {
  X,
  Download,
  Upload,
  Sparkles,
  Volume2,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Wand2,
  Video,
  Key
} from 'lucide-react';
import { CastMember, SceneCard, ApiKeysConfig } from '../types/studio';
import {
  generateSceneMultiTurnVoiceAndTimings,
  generateContextualAiSceneImage,
  generateVeoVideoForScene,
  buildVeoDirectPromptForScene
} from '../services/aiService';

interface LipSyncPowerModalProps {
  isOpen: boolean;
  onClose: () => void;
  scene: SceneCard;
  cast: CastMember[];
  seriesTitle: string;
  episodeTitle: string;
  rawIdea: string;
  apiKeys: ApiKeysConfig;
  onSaveApiKeys?: (next: ApiKeysConfig) => void;
  onUpdateScene: (updated: SceneCard) => void;
  onOpenSubjectTracker: () => void;
}

export const LipSyncPowerModal: React.FC<LipSyncPowerModalProps> = ({
  isOpen,
  onClose,
  scene,
  cast,
  seriesTitle,
  episodeTitle,
  rawIdea,
  apiKeys,
  onSaveApiKeys,
  onUpdateScene,
  onOpenSubjectTracker
}) => {
  const [isGeneratingWav, setIsGeneratingWav] = useState(false);
  const [isGeneratingNanoBanana, setIsGeneratingNanoBanana] = useState(false);
  const [isGeneratingVeo, setIsGeneratingVeo] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [falKeyInput, setFalKeyInput] = useState(apiKeys.falApiKey || '');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const character = cast.find((c) => c.id === scene.characterId) || cast[0];
  const isAnimal = character?.type === 'ANIMAL';
  const hasMouthBox = Boolean(scene.characterBoxes?.[character?.id || '']);

  const handleDownloadSampledVoiceWav = async () => {
    setIsGeneratingWav(true);
    setStatusMessage('Generazione traccia vocale campionata (.WAV) per il Lip-Sync...');
    try {
      let audioUrl = scene.generatedAudioUrl;
      if (!audioUrl || !audioUrl.includes('#sitcomvoice_v4')) {
        const res = await generateSceneMultiTurnVoiceAndTimings({
          scene,
          cast,
          apiKeys
        });
        audioUrl = res.audioUrl;
        onUpdateScene({
          ...scene,
          generatedAudioUrl: res.audioUrl,
          dialogueTurns: res.updatedTurns || scene.dialogueTurns,
          status: 'DONE'
        });
      }

      const cleanUrl = (audioUrl || '').split('#')[0];
      if (cleanUrl) {
        const a = document.createElement('a');
        a.href = cleanUrl;
        const safeName = (character?.name || 'personaggio').toLowerCase().replace(/[^a-z0-9]/g, '_');
        a.download = `voce_lipsync_${safeName}_scena_${scene.order}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setStatusMessage(
          `✅ File audio WAV di ${character?.name} scaricato! Ora puoi caricarlo su Kling AI, Hedra o Sync Labs insieme alla foto/video.`
        );
      }
    } catch {
      setStatusMessage('⚠️ Impossibile scaricare il WAV automatico, riprova tra un istante.');
    } finally {
      setIsGeneratingWav(false);
    }
  };

  const handleCopyLipSyncPrompt = async () => {
    const promptText = buildVeoDirectPromptForScene(scene, cast, seriesTitle);
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2500);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleRunNanoBananaViseme = async () => {
    setIsGeneratingNanoBanana(true);
    setStatusMessage(
      `Generazione Frame Parlante a bocca aperta con Nano Banana (Gemini Image) per ${character?.name}...`
    );
    try {
      const reworkedUrl = await generateContextualAiSceneImage({
        scene,
        character,
        episodeTitle,
        rawIdea,
        apiKeys
      });
      if (reworkedUrl) {
        onUpdateScene({
          ...scene,
          generatedAiImageUrl: reworkedUrl
        });
        setStatusMessage(
          `✅ Frame parlante Nano Banana generato! Durante il parlato il motore alternerà la bocca chiusa e la bocca aperta.`
        );
      } else {
        setStatusMessage(
          '⚠️ Per generare il frame a bocca aperta con Nano Banana inserisci la tua Gemini API Key in alto a destra (⚙️ Stato Servizi & Chiavi AI).'
        );
      }
    } finally {
      setIsGeneratingNanoBanana(false);
    }
  };

  const handleRunVeoCloudVideo = async () => {
    setIsGeneratingVeo(true);
    setStatusMessage(`Richiesta generazione video parlante a Google Veo 3 per ${character?.name}...`);
    try {
      const veoRes = await generateVeoVideoForScene({
        scene,
        character,
        apiKeys
      });
      if (veoRes.usedVeoCloud && veoRes.videoUrl) {
        onUpdateScene({
          ...scene,
          sceneType: 'USER_VIDEO',
          userVideoBlobUrl: veoRes.videoUrl,
          generatedAiVideoUrl: veoRes.videoUrl,
          useOriginalVideoAudio: false,
          status: 'DONE'
        });
        setStatusMessage('✅ Video Lip-Sync Veo 3 generato e applicato alla scena!');
      } else {
        setStatusMessage(
          'ℹ️ L’API pubblica non ha restituito l’MP4 diretto: usa il pulsante "📋 Copia Prompt" qui sotto per generarlo direttamente nella tua web app Gemini Ultra o su Kling AI / Hedra e ricaricarlo qui!'
        );
      }
    } finally {
      setIsGeneratingVeo(false);
    }
  };

  const handleUploadLipSyncMp4 = (file: File | undefined) => {
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    onUpdateScene({
      ...scene,
      sceneType: 'USER_VIDEO',
      userVideoBlobUrl: blobUrl,
      userVideoFileName: file.name,
      useOriginalVideoAudio: true,
      trimStartSec: 0,
      status: 'DONE'
    });
    setStatusMessage(`✅ Video Lip-Sync "${file.name}" caricato nella Scena #${scene.order}!`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-2 sm:p-4">
      <div className="bg-white border-2 border-sky-300 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[94dvh] flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-r from-sky-900 via-sky-800 to-indigo-900 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-xl shadow flex-shrink-0">
              👄
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider">
                  STUDIO LIP-SYNC AI PRO • SCENA #{scene.order}
                </span>
                <span className="text-xs text-sky-200 font-bold truncate">
                  Protagonista: {isAnimal ? '🐾' : '🧑'} {character?.name}
                </span>
              </div>
              <h3 className="text-sm sm:text-lg font-black text-white truncate mt-0.5">
                Tutti gli Strumenti per un Labiale Perfetto (Cani/Animali &amp; Umani)
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-sky-50/40">
          {statusMessage && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-xs sm:text-sm font-bold text-emerald-950 flex items-center justify-between gap-2">
              <span>{statusMessage}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="text-emerald-700 hover:text-emerald-950 font-black px-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* LIVELLO 1: CALIBRAZIONE PUNTO BOCCA 👄 + NANO BANANA IN-APP */}
          <div className="bg-white border-2 border-sky-200 rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-900 text-[10px] font-black uppercase">
                  METODO 1 • ISTANTANEO DENTRO SKYSKETCH STUDIO
                </span>
                <h4 className="text-sm sm:text-base font-black text-slate-800 mt-1">
                  🎯 Punto Bocca 2.5D + Nano Banana Open-Mouth Frame
                </h4>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-black ${
                  hasMouthBox
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                }`}
              >
                {hasMouthBox ? '✅ Punto Bocca 👄 Calibrato' : '⚠️ Punto Bocca 👄 su posizione standard'}
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Il motore interno ora apre la cavità orale e muove la mascella inferiore a ritmo con ogni sillaba della voce di{' '}
              <strong>{character?.name}</strong>. Per farlo muovere nel punto millimetrico giusto, posiziona l&apos;icona{' '}
              <strong>👄</strong> esattamente sulla linea delle labbra o del muso:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSubjectTracker();
                }}
                className="p-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-xs transition"
              >
                <span>🎯 1. Posiziona Riquadro &amp; Bocca 👄</span>
              </button>

              <button
                type="button"
                disabled={isGeneratingNanoBanana}
                onClick={handleRunNanoBananaViseme}
                className="p-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white font-black text-xs flex items-center justify-center gap-2 shadow-xs transition"
              >
                {isGeneratingNanoBanana ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                <span>🍌 2. Genera Frame Bocca Aperta (Nano Banana)</span>
              </button>

              <button
                type="button"
                disabled={isGeneratingVeo}
                onClick={handleRunVeoCloudVideo}
                className="p-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-black text-xs flex items-center justify-center gap-2 shadow-xs transition"
              >
                {isGeneratingVeo ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Video className="w-4 h-4" />
                )}
                <span>🎬 3. Genera Video Cloud (Veo 3 API)</span>
              </button>
            </div>
          </div>

          {/* LIVELLO 2: I 4 STRUMENTI ESTERNI PIU' POTENTI AL MONDO PER LIP-SYNC REALISTICO (CON KIT 1-CLICK) */}
          <div className="bg-white border-2 border-indigo-200 rounded-2xl p-4 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 pb-3">
              <div>
                <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 text-[10px] font-black uppercase">
                  METODO 2 • QUALITÀ CINEMATOGRAFICA HOLLYWOOD (CONSIGLIATO PER VIDEO VIRALI)
                </span>
                <h4 className="text-sm sm:text-base font-black text-slate-900 mt-1">
                  🚀 Esporta la Voce Campionata (.WAV) e Genera il Labiale 3D Neurale
                </h4>
                <p className="text-xs text-slate-600">
                  Perché nel browser una foto statica non può inventare denti, lingua e rotazione 3D della testa? Perché serve un{' '}
                  <strong>modello neurale Video Audio-Driven</strong>! Con 1 clic scarichi il file <strong>.WAV</strong> con la voce campionata di{' '}
                  <strong>{character?.name}</strong> e lo dai in pasto a uno di questi 4 motori:
                </p>
              </div>
            </div>

            {/* STEP A: SCARICA IL KIT AUDIO WAV + PROMPT */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-indigo-50/70 p-3 rounded-2xl border border-indigo-200">
              <button
                type="button"
                disabled={isGeneratingWav}
                onClick={handleDownloadSampledVoiceWav}
                className="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow transition"
              >
                {isGeneratingWav ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>⬇️ Passo A: Scarica Voce Campionata (.WAV) di {character?.name}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyLipSyncPrompt}
                className="py-3 px-4 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition"
              >
                {copiedPrompt ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-700" />
                    <span>✅ Prompt Lip-Sync Copiato!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-amber-900" />
                    <span>📋 Passo B: Copia Prompt Regia + Battuta</span>
                  </>
                )}
              </button>
            </div>

            {/* TABELLA DEI 4 MIGLIORI STRUMENTI AI PER LIP-SYNC DI CANI E UMANI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 1. KLING AI */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs sm:text-sm text-slate-900">
                      1. 🐾 Kling AI 1.6 (Lip-Sync + Pets)
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black">
                      TOP PER CANI &amp; UMANI
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Anima sia <strong>cani (Zora)</strong> che <strong>bambini/adulti (Uma)</strong>! Carica la tua foto/video + il file{' '}
                    <code>.WAV</code> scaricato al Passo A: muove muso, lingua e labbra in sincrono perfetto.
                  </p>
                </div>
                <a
                  href="https://klingai.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold transition"
                >
                  <span>Apri Kling AI</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* 2. HEDRA CHARACTER-3 */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs sm:text-sm text-slate-900">
                      2. 🗣️ Hedra Character-3 (Audio-to-Video)
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 text-[10px] font-black">
                      PIÙ VELOCE DA FOTO
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Prende una <strong>singola foto</strong> + il file <code>.WAV</code> di SkySketch e genera un video in cui il personaggio recita tutta la battuta con espressioni facciali da sitcom!
                  </p>
                </div>
                <a
                  href="https://www.hedra.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-extrabold transition"
                >
                  <span>Apri Hedra Studio</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* 3. SYNC LABS / RUNWAY ACT-ONE */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs sm:text-sm text-slate-900">
                      3. 🎥 Sync Labs (sync.so) / Captions
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 text-[10px] font-black">
                      TOP SU VIDEO REALI
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Hai già un <strong>video reale</strong> in cui il personaggio è in primo piano? Carica il tuo video + il file{' '}
                    <code>.WAV</code> di SkySketch: modifica solo la bocca nel video facendolo parlare!
                  </p>
                </div>
                <a
                  href="https://sync.so"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-sky-700 hover:bg-sky-600 text-white text-xs font-extrabold transition"
                >
                  <span>Apri Sync.so Lip-Sync</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* 4. GEMINI ULTRA VEO 3 */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs sm:text-sm text-slate-900">
                      4. ✨ Google Gemini Ultra (Veo 3)
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black">
                      INCLUSO NEL TUO PIANO
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Clicca su <strong>Passo B: Copia Prompt</strong> qui sopra, apri Gemini Ultra, allega la foto di{' '}
                    <strong>{character?.name}</strong> e incolla il prompt per generare la clip parlante Veo 3!
                  </p>
                </div>
                <a
                  href="https://gemini.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition"
                >
                  <span>Apri Gemini Ultra</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* STEP C: RICARICA IL VIDEO GENERATO NELLA SCENA */}
            <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-dashed border-emerald-400 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <h5 className="text-xs sm:text-sm font-black text-emerald-950">
                  📹 Passo C: Hai generato l&apos;MP4 parlante? Ricaricalo subito in questa Scena #{scene.order}!
                </h5>
                <p className="text-[11px] text-emerald-800">
                  Sostituirà la clip corrente nella Scena #{scene.order} mantenendo intatta la quadratura al secondo della puntata.
                </p>
              </div>
              <label className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm inline-flex items-center gap-2 cursor-pointer shadow transition flex-shrink-0">
                <Upload className="w-4 h-4" />
                <span>Carica Video Lip-Sync (.MP4)</span>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleUploadLipSyncMp4(e.target.files?.[0])}
                />
              </label>
            </div>
          </div>

          {/* OPZIONALE: CHIAVE API FAL.AI PER AUTOMAZIONE DIRETTA */}
          {onSaveApiKeys && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-black text-slate-800">
                <Key className="w-4 h-4 text-sky-600" />
                <span>Chiave API fal.ai Opzionale (Per LivePortrait Animali / Sync Labs via API):</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={falKeyInput}
                  onChange={(e) => setFalKeyInput(e.target.value)}
                  placeholder="Incolla chiave fal.ai (es. key_id:key_secret)..."
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    onSaveApiKeys({ ...apiKeys, falApiKey: falKeyInput.trim() });
                    setStatusMessage('✅ Chiave fal.ai salvata nelle impostazioni!');
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold"
                >
                  Salva Chiave
                </button>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-4 sm:px-6 py-3 bg-slate-900 text-white flex items-center justify-between">
          <span className="text-[11px] text-slate-300">
            💡 Suggerimento: posiziona sempre il punto <strong>👄</strong> sulla bocca del personaggio per il lip-sync automatico 2.5D!
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs transition"
          >
            Chiudi Studio Lip-Sync
          </button>
        </div>
      </div>
    </div>
  );
};
