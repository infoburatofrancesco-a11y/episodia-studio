export interface Character {
  id: string;
  name: string;
  category: 'human' | 'animal';
  personality: string;
  visualDescriptor: string;
  referenceImageBase64: string;
  voiceId?: string;
}

export interface Series {
  id: string;
  title: string;
  description: string;
  genre: string;
  defaultAspectRatio: '9:16' | '16:9';
  castIds: string[];
  draftTitle?: string;
  draftLogline?: string;
  draftCastIds?: string[];
  draftShotCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Shot {
  id: string;
  shotNumber: number;
  duration: number;
  characterIds: string[];
  cameraAngle: string;
  visualPromptEn: string;
  speakerId: string | null;
  dialogueIta: string;
  videoUrl?: string;
  localMediaKey?: string;
  status: 'draft' | 'generating' | 'ready';
}

export interface Episode {
  id: string;
  seriesId: string;
  episodeNumber: number;
  title: string;
  logline: string;
  selectedCastIds: string[];
  shots: Shot[];
  createdAt: string;
}

export interface CloudSyncConfig {
  enabled: boolean;
  remoteEndpointUrl?: string;
  remoteApiKey?: string;
  lastSyncedAt?: string;
}

export interface StudioDatabasePayload {
  cast: Character[];
  series: Series[];
  episodes: Episode[];
  updatedAt: string;
}
