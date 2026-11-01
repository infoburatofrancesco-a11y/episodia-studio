export type CastType = 'HUMAN' | 'ANIMAL';

export interface VoiceConfig {
  voiceName: string;
  pitch: number;
  speed: number;
  stylePrompt: string;
  warmth?: number; // -12 to +12 dB low-mid body warmth
  presence?: number; // -12 to +12 dB vocal clarity
  useRecordedVoiceDirectly?: boolean; // If true, uses the recorded/uploaded voice directly with DSP modification
  voiceSampleBlobUrl?: string;
  voiceSampleBase64?: string;
  voiceSampleMimeType?: string;
  analyzedTimbreProfile?: string;
}

export interface SubtitleStyle {
  textColor: string;
  bgColor: string;
  badgeText: string;
}

export type RelationshipPresetType =
  | 'LOVE_AFFECTION' // Si vogliono un mondo di bene / Affetto puro
  | 'PARTNERS_IN_CRIME' // Sempre in combutta / Complici di marachelle
  | 'FUNNY_RIVALS' // Rivali comici / Bisticci continui (es. divano o cibo)
  | 'BOSS_AND_SERVANT' // Chi comanda a bacchetta e chi obbedisce
  | 'PROTECTOR_AND_BABY' // Protettivo / Saggio & Combinaguai
  | 'CUSTOM'; // Rapporto personalizzato

export interface CharacterRelationship {
  targetCharacterId: string;
  relationType: RelationshipPresetType;
  description: string;
}

export interface CastMember {
  id: string;
  name: string;
  type: CastType;
  referencePhotos: string[]; // Base64 / Blob URL (1-5 photos)
  personalityPrompt: string;
  voiceConfig: VoiceConfig;
  subtitleStyle: SubtitleStyle;
  defaultCreditRole: string;
  memoryGags: string[];
  relationships?: CharacterRelationship[];
}

export interface IntroOutroMediaItem {
  id: string;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  fileName: string;
}

export interface IntroOutroConfig {
  introEnabled: boolean;
  introDurationSec: number; // default 3.0
  introBgVideoOrImage: string;
  introBgMediaType?: 'NONE' | 'IMAGE' | 'VIDEO';
  introBgFileName?: string;
  introMediaItems?: IntroOutroMediaItem[]; // Multiple videos & photos for dynamic Intro montage
  introJingleUrl: string;
  introJingleFileName?: string;
  introThemeColor: string;
  introCustomTitle?: string;
  introCustomSubtitle?: string;
  introShowEpisodeBadge?: boolean; // default true
  introShowCastAvatars?: boolean; // default true
  outroEnabled: boolean;
  outroDurationSec: number; // default 4.0
  outroBgVideoOrImage?: string;
  outroBgMediaType?: 'NONE' | 'IMAGE' | 'VIDEO';
  outroBgFileName?: string;
  outroMediaItems?: IntroOutroMediaItem[]; // Multiple videos & photos for dynamic Outro montage
  outroAudioUrl?: string;
  outroAudioFileName?: string;
  outroThemeColor?: string;
  outroCustomHeader?: string;
  outroShowCastCards?: boolean; // default true
  autoListDetectedCast: boolean; // default true
  aiFunnyRoles: boolean; // default true
  footerText: string;
}

export interface DurationPlan {
  targetTotalDurationSec: number;
  introDurationSec: number;
  outroDurationSec: number;
  netContentDurationSec: number;
  recommendedUserVideosCount: number;
  recommendedUserVideoSecEach: number;
  recommendedAiPhotosCount: number;
  recommendedAiPhotoSecEach: number;
  uploadedMaterialDurationSec: number;
}

export type SceneType = 'USER_VIDEO' | 'AI_PHOTO_VIDEO';
export type SceneStatus = 'READY' | 'GENERATING' | 'DONE' | 'ERROR';
export type CameraShotType = 'DYNAMIC_ZOOM' | 'CLOSEUP_PUNCH' | 'PAN_CINEMATIC' | 'REACTION_SHAKE';

export interface CharacterBoundingBox {
  characterId?: string;
  /** Normalized 0..1 coordinates relative to the media frame width & height */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional normalized mouth/muzzle anchor point (0..1) inside the frame */
  mouthX?: number;
  mouthY?: number;
}

export interface AiPlotProposal {
  id: string;
  suggestedEpisodeTitle: string;
  plotText: string;
  toneBadge: string;
  visualHook: string;
}

export interface DialogueTurn {
  characterId: string;
  dialogueOrThought: string;
  startOffsetSec?: number;
  durationSec?: number;
  focusRegion?: 'LEFT' | 'CENTER' | 'RIGHT';
}

export interface SceneCard {
  id: string;
  order: number;
  sceneType: SceneType;
  characterId: string;
  characterIds?: string[]; // Multiple characters present & interacting in this same photo/video
  characterBoxes?: Record<string, CharacterBoundingBox>; // Insta360-style subject tracking bounding boxes by characterId
  dialogueTurns?: DialogueTurn[]; // Back-and-forth interaction between characters in this scene
  durationSec: number;
  dialogueOrThought: string;
  userVideoBlobUrl?: string;
  userVideoFileName?: string;
  trimStartSec?: number;
  trimEndSec?: number;
  aiPhotoSourceUrl?: string;
  veoMotionPrompt?: string;
  cameraShot?: CameraShotType;
  directorNote?: string;
  generatedAudioUrl?: string;
  generatedAiImageUrl?: string; // Optional contextual photo re-elaborated by Nano Banana
  generatedAiVideoUrl?: string;
  useOriginalVideoAudio?: boolean; // When true on USER_VIDEO, plays the video's native audio track in the mix
  characterRoleBadge?: string; // TV Sitcom role callout badge
  status: SceneStatus;
  funnyCreditOverride?: string;
}

export interface BackgroundMusicConfig {
  sourceFileName: string;
  extractedAudioBlobUrl: string;
  durationSec?: number;
  volume: number;
  autoDucking: boolean;
}

export interface UploadedMediaItem {
  id: string;
  name: string;
  type: 'VIDEO' | 'PHOTO';
  blobUrl: string;
  base64Preview?: string; // Frame keyframe or photo in base64 for Gemini Vision
  originalDurationSec: number;
  usedDurationSec: number;
  assignedCharacterId?: string;
  assignedCharacterIds?: string[]; // Multiple characters detected or selected in this photo/video
  characterBoxes?: Record<string, CharacterBoundingBox>; // Insta360-style subject tracking bounding boxes by characterId
  visualDescription?: string; // Visual analysis description from AI Vision
  customInstruction?: string; // User/AI specific instructions for how to elaborate this video clip
  recognitionStatus?: 'IDLE' | 'ANALYZING' | 'RECOGNIZED' | 'MATCHED' | 'FALLBACK' | 'MANUAL';
  recognitionConfidence?: number;
}

export interface Episode {
  id: string;
  episodeNumber: number;
  title: string;
  rawIdea: string;
  targetTotalDurationSec: number;
  netContentDurationSec: number;
  backgroundMusic?: BackgroundMusicConfig;
  detectedCastIds: string[];
  funnyRolesByCastId?: Record<string, string>;
  uploadedMedia: UploadedMediaItem[];
  scenes: SceneCard[];
}

export type SeriesGenreStyle =
  | 'COMEDY' // Sitcom / Commedia Brillante
  | 'ROMANTIC' // Romantico / Dolce & Emozionante
  | 'HORROR_THRILLER' // Horror / Thriller / Mistero & Suspense
  | 'ACTION_ADVENTURE' // Azione / Spionaggio / Avventura
  | 'DRAMA_SOAP' // Telenovela / Drammatico / Colpi di Scena
  | 'MOCKUMENTARY' // Documentario Parodia / Interviste in Camera
  | 'CUSTOM'; // Stile Personalizzato

export interface SeriesGenrePresetInfo {
  id: SeriesGenreStyle;
  label: string;
  emoji: string;
  badgeColor: string;
  shortDesc: string;
  directorPrompt: string;
}

export const SERIES_GENRE_STYLES: SeriesGenrePresetInfo[] = [
  {
    id: 'COMEDY',
    label: 'Comedy / Sitcom Brillante',
    emoji: '😂',
    badgeColor: 'bg-amber-100 text-amber-900 border-amber-300',
    shortDesc: 'Battute fulminee, ironia, equivoci divertenti e ritmo da sitcom TV.',
    directorPrompt:
      'Stile COMEDY / SITCOM BRILLANTE: ritmo vivace, battute ironiche e fulminee, tempi comici serrati, gag esilaranti e botta-e-risposta divertenti.'
  },
  {
    id: 'ROMANTIC',
    label: 'Romantico / Emozionante',
    emoji: '❤️',
    badgeColor: 'bg-rose-100 text-rose-900 border-rose-300',
    shortDesc: 'Atmosfera tenera, sguardi complici, dolcezza, affetto profondo e cuore.',
    directorPrompt:
      'Stile ROMANTICO / DOLCE & EMOZIONANTE: dialoghi teneri, affettuosi e poetici, complicità profonda, sguardi dolci, inquadrature morbide (PAN_CINEMATIC) e grande calore emotivo.'
  },
  {
    id: 'HORROR_THRILLER',
    label: 'Horror / Thriller & Mistero',
    emoji: '👻',
    badgeColor: 'bg-purple-100 text-purple-900 border-purple-300',
    shortDesc: 'Suspense, mistero, indizi segreti, colpi di scena da brivido (anche in chiave buffa!).',
    directorPrompt:
      'Stile HORROR / THRILLER & MISTERO: atmosfera di suspense e tensione, sussurri, sospetti incrociati, indizi misteriosi, colpi di scena improvvisi e inquadrature drammatiche (CLOSEUP_PUNCH / REACTION_SHAKE).'
  },
  {
    id: 'ACTION_ADVENTURE',
    label: 'Azione / Missione Segreta',
    emoji: '🔥',
    badgeColor: 'bg-orange-100 text-orange-900 border-orange-300',
    shortDesc: 'Piani ad alto rischio, codici segreti, adrenalina e operazioni speciali.',
    directorPrompt:
      'Stile AZIONE / MISSIONE SEGRETA: ritmo adrenalinico da film di spionaggio, nomi in codice, conto alla rovescia, piani tattici e montaggio rapido (DYNAMIC_ZOOM / REACTION_SHAKE).'
  },
  {
    id: 'DRAMA_SOAP',
    label: 'Drammatico / Telenovela',
    emoji: '🎭',
    badgeColor: 'bg-pink-100 text-pink-900 border-pink-300',
    shortDesc: 'Rivelazioni scioccanti, sguardi intensi, passioni esagerate e pathos teatrale.',
    directorPrompt:
      'Stile DRAMMATICO / TELENOVELA: enfasi teatrale, rivelazioni clamorose ("Non può essere vero!"), sospiri intensi, passioni travolgenti e primi piani drammatici.'
  },
  {
    id: 'MOCKUMENTARY',
    label: 'Mockumentary (Stile The Office)',
    emoji: '🎥',
    badgeColor: 'bg-sky-100 text-sky-900 border-sky-300',
    shortDesc: 'Sguardi in macchina, confessioni dirette al pubblico e realismo surreale.',
    directorPrompt:
      'Stile MOCKUMENTARY (Documentario Parodia / The Office): i personaggi parlano o guardano direttamente in camera commentando l’assurdità della situazione con tono serio-ironico.'
  },
  {
    id: 'CUSTOM',
    label: 'Stile Personalizzato',
    emoji: '✨',
    badgeColor: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    shortDesc: 'Definisci tu a parole il genere, il tono e lo stile registico della serie.',
    directorPrompt:
      'Stile PERSONALIZZATO definito dal regista della serie.'
  }
];

export interface Series {
  id: string;
  title: string;
  description: string;
  genreStyle?: SeriesGenreStyle;
  customStylePrompt?: string;
  cast: CastMember[];
  branding: IntroOutroConfig;
  episodes: Episode[];
}

export type ExportPresetId =
  | 'IG_REELS_9_16'
  | 'IG_STORIES_9_16'
  | 'YOUTUBE_SHORTS_9_16'
  | 'YOUTUBE_VIDEO_16_9';

export interface ExportFormatSpec {
  id: ExportPresetId;
  title: string;
  subtitle: string;
  aspectRatio: '9:16' | '16:9';
  width: number;
  height: number;
  platformBadge: string;
  safeZoneHint: string;
}

export interface ApiKeysConfig {
  geminiApiKey: string;
  googleCloudProjectId: string;
  googleCloudLocation: string;
  vertexAiAccessToken: string;
  cloudTtsApiKey: string;
  falApiKey?: string; // Optional fal.ai key for Cloud Neural Video Lip-Sync (Sync Labs / LivePortrait / Kling / SadTalker)
  preferVeoCloud: boolean;
  preferCloudTts: boolean;
  cloudSyncCode?: string; // Optional Gist / Cloud Sync ID to sync between PC and Phone
}

