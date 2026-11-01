import React, { useEffect, useState } from 'react';
import {
  Cloud,
  Search,
  Upload,
  Link2,
  Check,
  X,
  ExternalLink,
  Image as ImageIcon,
  Video,
  Sparkles,
  RefreshCw,
  FolderOpen,
  KeyRound,
  AlertCircle
} from 'lucide-react';

export interface CloudMediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFilesImported: (files: File[]) => void;
  allowVideos?: boolean;
  allowImages?: boolean;
  titleContext?: string;
}

interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  size?: string;
  modifiedTime?: string;
}

const STORAGE_GOOGLE_CLIENT_ID = 'skysketch_google_oauth_client_id_v1';
const STORAGE_GOOGLE_ACCESS_TOKEN = 'skysketch_google_access_token_v1';

/**
 * Extracts a Google Drive File ID from any common Google Drive sharing URL.
 */
function extractGoogleDriveFileId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  const matchD = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD?.[1]) return matchD[1];

  const matchIdParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchIdParam?.[1]) return matchIdParam[1];

  const matchDoc = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (matchDoc?.[1]) return matchDoc[1];

  return null;
}

/**
 * Loads an image URL via HTMLImageElement + Canvas as a fallback when direct fetch CORS is restricted
 * (works great for Google Drive thumbnail/lh3.googleusercontent.com URLs).
 */
function loadImageElementToFile(url: string, fileName: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 1080;
        canvas.height = img.naturalHeight || img.height || 1080;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context non disponibile'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Impossibile convertire immagine in File'));
              return;
            }
            const safeName = /\.(jpg|jpeg|png|webp)$/i.test(fileName)
              ? fileName
              : `${fileName}.jpg`;
            resolve(new File([blob], safeName, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.92
        );
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Impossibile caricare immagine dal link fornito'));
    img.src = url;
  });
}

export const CloudMediaPickerModal: React.FC<CloudMediaPickerModalProps> = ({
  isOpen,
  onClose,
  onFilesImported,
  allowVideos = true,
  allowImages = true,
  titleContext = 'Studio della Puntata'
}) => {
  const [activeTab, setActiveTab] = useState<'CLOUD_BROWSE' | 'DRIVE_SEARCH' | 'PASTE_LINKS'>(
    'CLOUD_BROWSE'
  );

  // Google Drive Search State
  const [googleClientId, setGoogleClientId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_GOOGLE_CLIENT_ID) || '';
    } catch {
      return '';
    }
  });
  const [accessToken, setAccessToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(STORAGE_GOOGLE_ACCESS_TOKEN) || '';
    } catch {
      return '';
    }
  });
  const [showClientIdConfig, setShowClientIdConfig] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<'ALL' | 'IMAGES' | 'VIDEOS'>('ALL');
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [selectedDriveIds, setSelectedDriveIds] = useState<string[]>([]);
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);
  const [isDownloadingDrive, setIsDownloadingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  // Paste Links State
  const [linksInput, setLinksInput] = useState('');
  const [linkMediaTypeHint, setLinkMediaTypeHint] = useState<'AUTO' | 'IMAGE' | 'VIDEO'>('AUTO');
  const [isImportingLinks, setIsImportingLinks] = useState(false);
  const [linkStatusMsg, setLinkStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && accessToken && activeTab === 'DRIVE_SEARCH' && driveFiles.length === 0) {
      handleSearchGoogleDrive(accessToken, searchQuery, mediaFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleSaveClientId = (val: string) => {
    const clean = val.trim();
    setGoogleClientId(clean);
    try {
      localStorage.setItem(STORAGE_GOOGLE_CLIENT_ID, clean);
    } catch {
      // ignore storage errors
    }
  };

  const ensureGoogleGsiScript = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).google?.accounts?.oauth2) {
        resolve();
        return;
      }
      const existing = document.getElementById('google-gsi-client-script');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        return;
      }
      const script = document.createElement('script');
      script.id = 'google-gsi-client-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Impossibile caricare Google Identity Services'));
      document.head.appendChild(script);
    });
  };

  const handleConnectGoogleAccount = async () => {
    setDriveError(null);
    if (!googleClientId.trim()) {
      setShowClientIdConfig(true);
      setDriveError(
        'Per usare la ricerca API diretta dentro la finestra inserisci il tuo Google OAuth Client ID, oppure usa il pulsante "Sfoglia App Google Drive / Google Foto" nella prima scheda (non richiede configurazione)!'
      );
      return;
    }

    try {
      await ensureGoogleGsiScript();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oauth2 = (window as any).google?.accounts?.oauth2;
      if (!oauth2) {
        throw new Error('Modulo OAuth2 Google non disponibile');
      }

      const tokenClient = oauth2.initTokenClient({
        client_id: googleClientId.trim(),
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback: (response: any) => {
          if (response?.error) {
            setDriveError(`Errore autenticazione Google: ${response.error}`);
            return;
          }
          if (response?.access_token) {
            setAccessToken(response.access_token);
            try {
              sessionStorage.setItem(STORAGE_GOOGLE_ACCESS_TOKEN, response.access_token);
            } catch {
              // ignore
            }
            handleSearchGoogleDrive(response.access_token, searchQuery, mediaFilter);
          }
        }
      });

      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Errore durante la connessione a Google Drive'
      );
    }
  };

  const handleSearchGoogleDrive = async (
    tokenOverride?: string,
    queryOverride?: string,
    filterOverride?: 'ALL' | 'IMAGES' | 'VIDEOS'
  ) => {
    const token = tokenOverride ?? accessToken;
    const qText = (queryOverride ?? searchQuery).trim();
    const mFilter = filterOverride ?? mediaFilter;

    if (!token) {
      handleConnectGoogleAccount();
      return;
    }

    setIsSearchingDrive(true);
    setDriveError(null);

    try {
      const mimeClauses: string[] = [];
      if (mFilter === 'IMAGES' || (!allowVideos && allowImages)) {
        mimeClauses.push("mimeType contains 'image/'");
      } else if (mFilter === 'VIDEOS' || (allowVideos && !allowImages)) {
        mimeClauses.push("mimeType contains 'video/'");
      } else {
        mimeClauses.push("(mimeType contains 'image/' or mimeType contains 'video/')");
      }

      let fullQuery = `trashed = false and ${mimeClauses.join(' and ')}`;
      if (qText) {
        const escaped = qText.replace(/'/g, "\\'");
        fullQuery += ` and name contains '${escaped}'`;
      }

      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', fullQuery);
      url.searchParams.set(
        'fields',
        'files(id,name,mimeType,thumbnailLink,size,modifiedTime)'
      );
      url.searchParams.set('pageSize', '40');
      url.searchParams.set('orderBy', 'modifiedTime desc');

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (res.status === 401) {
        setAccessToken('');
        sessionStorage.removeItem(STORAGE_GOOGLE_ACCESS_TOKEN);
        setDriveError('Sessione Google scaduta: clicca "Connetti Google Drive" per accedere.');
        return;
      }

      if (!res.ok) {
        throw new Error(`Errore risposta Google Drive (${res.status})`);
      }

      const data = await res.json();
      setDriveFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setDriveError(
        err instanceof Error
          ? err.message
          : 'Impossibile completare la ricerca su Google Drive.'
      );
    } finally {
      setIsSearchingDrive(false);
    }
  };

  const toggleSelectDriveFile = (id: string) => {
    setSelectedDriveIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleImportSelectedDriveFiles = async () => {
    if (!accessToken || selectedDriveIds.length === 0) return;
    setIsDownloadingDrive(true);
    setDriveError(null);
    const downloadedFiles: File[] = [];

    try {
      for (const fileId of selectedDriveIds) {
        const meta = driveFiles.find((f) => f.id === fileId);
        if (!meta) continue;

        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );
        if (!res.ok) continue;
        const blob = await res.blob();
        const fileObj = new File([blob], meta.name, {
          type: meta.mimeType || blob.type || 'application/octet-stream'
        });
        downloadedFiles.push(fileObj);
      }

      if (downloadedFiles.length === 0) {
        setDriveError('Impossibile scaricare i file selezionati da Google Drive.');
        return;
      }

      onFilesImported(downloadedFiles);
      setSelectedDriveIds([]);
      onClose();
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Errore durante il download da Google Drive'
      );
    } finally {
      setIsDownloadingDrive(false);
    }
  };

  const handleImportFromLinks = async () => {
    const rawLines = linksInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (rawLines.length === 0) return;

    setIsImportingLinks(true);
    setLinkStatusMsg(null);
    const importedFiles: File[] = [];

    try {
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const driveId = extractGoogleDriveFileId(line);
        const forceVideo =
          linkMediaTypeHint === 'VIDEO' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(line);

        if (driveId) {
          // Try fetching direct media or high-res thumbnail from Google Drive
          const directDownloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
          const highResThumbUrl = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1920`;

          let loadedFile: File | null = null;

          try {
            const resp = await fetch(directDownloadUrl);
            if (resp.ok) {
              const blob = await resp.blob();
              if (blob.size > 0 && !blob.type.includes('text/html')) {
                const ext =
                  blob.type.startsWith('video/') || forceVideo ? 'mp4' : 'jpg';
                loadedFile = new File(
                  [blob],
                  `GoogleDrive_${driveId.slice(0, 6)}_${i + 1}.${ext}`,
                  {
                    type:
                      blob.type ||
                      (forceVideo ? 'video/mp4' : 'image/jpeg')
                  }
                );
              }
            }
          } catch {
            // Fallback to high-res thumbnail loader for Drive photos
          }

          if (!loadedFile && !forceVideo) {
            try {
              loadedFile = await loadImageElementToFile(
                highResThumbUrl,
                `GoogleDrive_Foto_${i + 1}.jpg`
              );
            } catch {
              // ignore
            }
          }

          if (loadedFile) {
            importedFiles.push(loadedFile);
            continue;
          }
        }

        // Standard direct URL or Google Photos lh3.googleusercontent.com URL
        try {
          const resp = await fetch(line);
          if (resp.ok) {
            const blob = await resp.blob();
            if (blob.size > 0 && !blob.type.includes('text/html')) {
              const isVid = blob.type.startsWith('video/') || forceVideo;
              const ext = isVid ? 'mp4' : 'jpg';
              importedFiles.push(
                new File([blob], `CloudMedia_${i + 1}.${ext}`, {
                  type: blob.type || (isVid ? 'video/mp4' : 'image/jpeg')
                })
              );
              continue;
            }
          }
        } catch {
          // Try HTMLImageElement fallback
        }

        if (!forceVideo) {
          try {
            const imgFile = await loadImageElementToFile(
              line,
              `GoogleFoto_${i + 1}.jpg`
            );
            importedFiles.push(imgFile);
          } catch {
            // ignore
          }
        }
      }

      if (importedFiles.length > 0) {
        onFilesImported(importedFiles);
        setLinksInput('');
        onClose();
      } else {
        setLinkStatusMsg(
          '⚠️ Impossibile scaricare direttamente dal link (il file su Drive potrebbe essere privato o bloccato dal browser). Usa il pulsante "Sfoglia App Google Drive / Google Foto" nella prima scheda per selezionarlo direttamente!'
        );
      }
    } finally {
      setIsImportingLinks(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto">
      <div className="bg-white border-2 border-sky-300 rounded-3xl max-w-3xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh] my-auto">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-sky-900 via-sky-800 to-indigo-950 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center flex-shrink-0">
              <Cloud className="w-5 h-5 text-sky-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-sky-500/30 text-sky-200">
                  Cloud Importer • Multi-Upload
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-black truncate mt-0.5">
                ☁️ Cerca su Google Drive & Google Foto ({titleContext})
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-2.5 bg-sky-50 border-b border-sky-200">
          <button
            type="button"
            onClick={() => setActiveTab('CLOUD_BROWSE')}
            className={`py-2.5 px-2 rounded-xl font-extrabold text-xs transition flex items-center justify-center gap-1.5 ${
              activeTab === 'CLOUD_BROWSE'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white text-sky-900 hover:bg-sky-100 border border-sky-200/70'
            }`}
          >
            <FolderOpen className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">1. Sfoglia Drive & Foto</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DRIVE_SEARCH')}
            className={`py-2.5 px-2 rounded-xl font-extrabold text-xs transition flex items-center justify-center gap-1.5 ${
              activeTab === 'DRIVE_SEARCH'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white text-sky-900 hover:bg-sky-100 border border-sky-200/70'
            }`}
          >
            <Search className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">2. Ricerca Live Drive</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('PASTE_LINKS')}
            className={`py-2.5 px-2 rounded-xl font-extrabold text-xs transition flex items-center justify-center gap-1.5 ${
              activeTab === 'PASTE_LINKS'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white text-sky-900 hover:bg-sky-100 border border-sky-200/70'
            }`}
          >
            <Link2 className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">3. Incolla Link Cloud</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* TAB 1: SFOGLIA DIRETTO GOOGLE DRIVE & GOOGLE FOTO (SISTEMA / TELEFONO / PC) */}
          {activeTab === 'CLOUD_BROWSE' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-50 to-indigo-50/60 border-2 border-sky-200 space-y-3">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-sky-950">
                      Perché il selettore standard nascondeva Google Drive e Google Foto?
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Su Android e iPhone i pulsanti normali aprono solo la galleria della fotocamera.
                      Usando il pulsante <strong>&ldquo;Apri Selettore Cloud (Google Drive & Google Foto)&rdquo;</strong> qui sotto, il telefono e il PC aprono il <strong>Menu Cloud completo con lente di ricerca</strong> in cui puoi scegliere <strong>Google Drive</strong> o <strong>Google Foto</strong> dal menu laterale (`☰`) e selezionare più file insieme!
                    </p>
                  </div>
                </div>

                {/* Primary Unblocked System Cloud Picker Button */}
                <label className="w-full py-4 px-5 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-black text-sm shadow-lg cursor-pointer transition flex flex-col sm:flex-row items-center justify-center gap-2 text-center">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-5 h-5" />
                    <span>☁️🔍 Apri Selettore Cloud (Google Drive / Google Foto / File)</span>
                  </div>
                  <span className="text-[11px] font-bold bg-white/20 px-2.5 py-0.5 rounded-full">
                    Selezione Multipla Attiva
                  </span>
                  {/* Notice: omitting restrictive accept="image/*" forces Android/iOS to show Google Drive & Google Photos cloud providers! */}
                  <input
                    type="file"
                    multiple
                    onChange={(e) => {
                      const selected = Array.from(e.target.files || []);
                      e.currentTarget.value = '';
                      if (selected.length > 0) {
                        onFilesImported(selected);
                        onClose();
                      }
                    }}
                    className="hidden"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <label className="py-3 px-4 rounded-xl bg-white hover:bg-sky-50 border-2 border-sky-200 cursor-pointer transition flex items-center justify-center gap-2 font-extrabold text-xs text-sky-950 text-center">
                    <ImageIcon className="w-4 h-4 text-sky-600 flex-shrink-0" />
                    <span>📸 Sfoglia Foto da Cloud / Google Foto</span>
                    <input
                      type="file"
                      accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.bmp,.avif"
                      multiple
                      onChange={(e) => {
                        const selected = Array.from(e.target.files || []);
                        e.currentTarget.value = '';
                        if (selected.length > 0) {
                          onFilesImported(selected);
                          onClose();
                        }
                      }}
                      className="hidden"
                    />
                  </label>

                  <label className="py-3 px-4 rounded-xl bg-white hover:bg-sky-50 border-2 border-sky-200 cursor-pointer transition flex items-center justify-center gap-2 font-extrabold text-xs text-sky-950 text-center">
                    <Video className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                    <span>🎬 Sfoglia Video da Cloud / Google Drive</span>
                    <input
                      type="file"
                      accept="video/*,.mp4,.mov,.webm,.m4v,.avi,.mkv,.3gp,.flv,.wmv,.ts"
                      multiple
                      onChange={(e) => {
                        const selected = Array.from(e.target.files || []);
                        e.currentTarget.value = '';
                        if (selected.length > 0) {
                          onFilesImported(selected);
                          onClose();
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Quick guide + Direct shortcuts to Google Photos and Google Drive */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <p className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  💡 Come cercare un file su Google Drive o Google Foto dal Telefono:
                </p>
                <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside font-semibold">
                  <li>
                    Tocca il pulsante blu <strong>&ldquo;☁️🔍 Apri Selettore Cloud&rdquo;</strong> qui sopra (e scegli <strong>&ldquo;Sfoglia&rdquo;</strong> o <strong>&ldquo;File&rdquo;</strong>).
                  </li>
                  <li>
                    Tocca il menu in alto a sinistra (<strong>☰</strong>) o la barra app: vedrai <strong>Google Drive</strong> e <strong>Google Foto</strong>!
                  </li>
                  <li>
                    Usa la <strong>lente di ricerca 🔍 in alto</strong> per cercare per nome, persona, cane o luogo, tieni premuto per selezionare più foto/video e tocca <strong>Apri / Seleziona</strong>.
                  </li>
                </ol>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
                  <span className="text-[11px] font-bold text-slate-500">
                    Vuoi aprire direttamente le tue app Cloud per scaricare o copiare un link?
                  </span>
                  <a
                    href="https://drive.google.com/drive/my-drive"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-sky-50 border border-slate-300 text-xs font-extrabold text-slate-800 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-sky-600" /> Apri il mio Google Drive
                  </a>
                  <a
                    href="https://photos.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-sky-50 border border-slate-300 text-xs font-extrabold text-slate-800 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-amber-600" /> Apri il mio Google Foto
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RICERCA LIVE INTEGRATA SU GOOGLE DRIVE API */}
          {activeTab === 'DRIVE_SEARCH' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-50/80 p-3 rounded-2xl border border-sky-200">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-sky-700" />
                  <span className="text-xs font-black text-sky-950">
                    Ricerca Diretta nel tuo Account Google Drive
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowClientIdConfig((prev) => !prev)}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-sky-100 border border-sky-200 text-[11px] font-extrabold text-sky-800 flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3" /> Configura Client ID
                  </button>
                  <button
                    type="button"
                    onClick={handleConnectGoogleAccount}
                    className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold transition shadow-sm"
                  >
                    {accessToken ? '🔄 Riconnetti Google' : '🔑 Connetti Google Drive'}
                  </button>
                </div>
              </div>

              {showClientIdConfig && (
                <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-2">
                  <label className="block text-xs font-extrabold text-amber-950">
                    Google OAuth 2.0 Client ID (Opzionale - per ricerca API diretta in-app):
                  </label>
                  <input
                    type="text"
                    value={googleClientId}
                    onChange={(e) => handleSaveClientId(e.target.value)}
                    placeholder="es. 1234567890-abcdefg.apps.googleusercontent.com"
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-white text-xs font-semibold text-slate-800"
                  />
                  <p className="text-[11px] text-amber-800">
                    Se non hai un Client ID Google Cloud, usa la <strong>Scheda 1 (Sfoglia Drive & Foto)</strong> o la <strong>Scheda 3 (Incolla Link)</strong> che funzionano immediatamente senza chiave!
                  </p>
                </div>
              )}

              {/* Search Bar & Filter */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearchGoogleDrive(accessToken, searchQuery, mediaFilter);
                      }
                    }}
                    placeholder="Cerca per nome su Google Drive (es. Zora, Uma, mare, clip)..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-sky-200 bg-slate-50 focus:bg-white text-xs sm:text-sm font-bold text-slate-800 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  {(['ALL', 'IMAGES', 'VIDEOS'] as const).map((flt) => (
                    <button
                      key={flt}
                      type="button"
                      onClick={() => {
                        setMediaFilter(flt);
                        if (accessToken) {
                          handleSearchGoogleDrive(accessToken, searchQuery, flt);
                        }
                      }}
                      className={`px-3 py-2.5 rounded-xl text-xs font-extrabold border transition ${
                        mediaFilter === flt
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-sky-50'
                      }`}
                    >
                      {flt === 'ALL' ? 'Tutti' : flt === 'IMAGES' ? '📷 Foto' : '📹 Video'}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => handleSearchGoogleDrive(accessToken, searchQuery, mediaFilter)}
                    disabled={isSearchingDrive}
                    className="px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-600 text-white text-xs font-black transition flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSearchingDrive ? 'animate-spin' : ''}`} />
                    Cerca
                  </button>
                </div>
              </div>

              {driveError && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span>{driveError}</span>
                </div>
              )}

              {/* Results Grid */}
              {driveFiles.length > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-64 overflow-y-auto p-1">
                    {driveFiles.map((file) => {
                      const isSelected = selectedDriveIds.includes(file.id);
                      const isVid = file.mimeType.startsWith('video/');
                      return (
                        <div
                          key={file.id}
                          onClick={() => toggleSelectDriveFile(file.id)}
                          className={`group relative rounded-2xl border-2 overflow-hidden cursor-pointer transition ${
                            isSelected
                              ? 'border-sky-600 ring-2 ring-sky-400/50 bg-sky-50'
                              : 'border-slate-200 hover:border-sky-300 bg-white'
                          }`}
                        >
                          <div className="aspect-video bg-slate-900 relative overflow-hidden flex items-center justify-center">
                            {file.thumbnailLink ? (
                              <img
                                src={file.thumbnailLink}
                                alt={file.name}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <span className="text-white text-xs font-bold">
                                {isVid ? '📹 VIDEO' : '📷 FOTO'}
                              </span>
                            )}
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-slate-900/80 text-white text-[10px] font-black">
                              {isVid ? '📹 Video' : '📷 Foto'}
                            </span>
                            <div
                              className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center border-2 transition ${
                                isSelected
                                  ? 'bg-sky-600 border-white text-white'
                                  : 'bg-black/40 border-white/80 text-transparent'
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </div>
                          </div>
                          <div className="p-2">
                            <p className="text-[11px] font-extrabold text-slate-800 truncate">
                              {file.name}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-sky-100">
                    <span className="text-xs font-extrabold text-sky-900">
                      {selectedDriveIds.length} file selezionati da Google Drive
                    </span>
                    <button
                      type="button"
                      disabled={selectedDriveIds.length === 0 || isDownloadingDrive}
                      onClick={handleImportSelectedDriveFiles}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs shadow-md transition flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      {isDownloadingDrive
                        ? 'Importazione in corso...'
                        : `Importa ${selectedDriveIds.length} File nello Studio`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-2">
                  <Cloud className="w-8 h-8 text-sky-500 mx-auto" />
                  <p className="text-xs font-extrabold text-slate-700">
                    Connetti il tuo Google Drive per cercare foto e video per nome, oppure usa la Scheda 1 per sfogliare subito Google Drive e Google Foto dal telefono!
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: INCOLLA LINK CONDIVISI DI GOOGLE DRIVE O GOOGLE FOTO */}
          {activeTab === 'PASTE_LINKS' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="text-xs font-black text-sky-950 uppercase tracking-wider">
                    🔗 Incolla uno o più link di Google Drive o Foto/Video (uno per riga):
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-bold text-slate-600 mr-1">Tipo file:</span>
                    {(['AUTO', 'IMAGE', 'VIDEO'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setLinkMediaTypeHint(t)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition ${
                          linkMediaTypeHint === t
                            ? 'bg-sky-600 text-white'
                            : 'bg-white text-slate-700 border border-sky-200'
                        }`}
                      >
                        {t === 'AUTO' ? 'Automatico' : t === 'IMAGE' ? '📷 Foto' : '📹 Video'}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={linksInput}
                  onChange={(e) => setLinksInput(e.target.value)}
                  placeholder={
                    'Esempio:\nhttps://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I/view?usp=sharing\nhttps://lh3.googleusercontent.com/...'
                  }
                  className="w-full p-3 rounded-xl border border-sky-300 bg-white text-xs font-mono text-slate-800 focus:outline-none focus:border-sky-500"
                />

                {linkStatusMsg && (
                  <p className="text-xs font-bold text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                    {linkStatusMsg}
                  </p>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!linksInput.trim() || isImportingLinks}
                    onClick={handleImportFromLinks}
                    className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-black text-xs shadow-md transition flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {isImportingLinks
                      ? 'Download dal Cloud in corso...'
                      : '☁️ Importa tutti i Link nello Studio'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 bg-slate-50 border-t border-sky-100 flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500">
            Supporta selezione multipla da Google Drive, Google Foto e Memoria Dispositivo
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold text-xs transition"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
};
