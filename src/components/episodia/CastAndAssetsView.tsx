'use client';

import React, { useState, useRef } from 'react';
import {
  Users,
  Sparkles,
  Upload,
  Plus,
  Pencil,
  Trash2,
  User,
  Cat,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Mic,
  X,
  Eye,
  Wand2,
  RefreshCw,
  Images,
  Star,
  Database,
} from 'lucide-react';
import type { Character } from '@/types/episodia';

interface CastAndAssetsViewProps {
  cast: Character[];
  onSaveCharacter: (character: Character) => Promise<void>;
  onDeleteCharacter: (id: string) => Promise<void>;
}

/**
 * Ottimizza e ridimensiona ogni foto caricata a max 1024px (JPEG 0.82)
 * così da mantenere altissima nitidezza per la profilazione AI e salvare
 * l'intero Portafoglio Attori (comprese più foto per attore) su Supabase Cloud.
 */
function optimizeImageFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File non valido: carica JPG, PNG o WEBP.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 1024;
          let width = img.naturalWidth || img.width || 800;
          let height = img.naturalHeight || img.height || 800;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.82);
          resolve(compressed);
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.onerror = () =>
      reject(new Error('Errore nella lettura del file immagine.'));
    reader.readAsDataURL(file);
  });
}

const PHOTO_SLOT_LABELS = [
  '1. Frontale (Copertina)',
  '2. Profilo / 3/4',
  '3. Espressione / Sorriso',
  '4. Mezzo Busto / Abiti',
  '5. Dettaglio / Accessori',
  '6. Angolazione Extra',
];

export default function CastAndAssetsView({
  cast,
  onSaveCharacter,
  onDeleteCharacter,
}: CastAndAssetsViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'human' | 'animal'>('human');
  const [actorRole, setActorRole] = useState('Protagonista');
  const [personality, setPersonality] = useState('');
  const [visualDescriptor, setVisualDescriptor] = useState('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [voiceId, setVoiceId] = useState('');

  // Indice foto attiva visualizzata sulle card del portafoglio
  const [activeCardPhotoIdx, setActiveCardPhotoIdx] = useState<
    Record<string, number>
  >({});

  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [regeneratingCardId, setRegeneratingCardId] = useState<string | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCategory('human');
    setActorRole('Protagonista');
    setPersonality('');
    setVisualDescriptor('');
    setReferenceImages([]);
    setVoiceId('');
    setErrorMsg(null);
    setWarningMsg(null);
  };

  const handleEditSelect = (char: Character) => {
    setEditingId(char.id);
    setName(char.name);
    setCategory(char.category);
    setActorRole(char.actorRole || 'Protagonista');
    setPersonality(char.personality);
    setVisualDescriptor(char.visualDescriptor);
    const imgs =
      char.referenceImagesBase64 && char.referenceImagesBase64.length > 0
        ? char.referenceImagesBase64
        : char.referenceImageBase64
        ? [char.referenceImageBase64]
        : [];
    setReferenceImages(imgs);
    setVoiceId(char.voiceId || '');
    setErrorMsg(null);
    setWarningMsg(null);
    setSuccessMsg(null);
  };

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length === 0) {
      setErrorMsg('Carica file immagine validi (JPG, PNG, WEBP).');
      return;
    }

    try {
      const converted = await Promise.all(
        files.map((file) => optimizeImageFileToBase64(file))
      );
      setReferenceImages((prev) => [...prev, ...converted].slice(0, 6));
      setErrorMsg(null);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Errore durante il caricamento delle foto.'
      );
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFilesSelected(e.dataTransfer.files);
    }
  };

  const handleSetPrimaryPhoto = (idx: number) => {
    setReferenceImages((prev) => {
      if (idx <= 0 || idx >= prev.length) return prev;
      const selected = prev[idx];
      const rest = prev.filter((_, i) => i !== idx);
      return [selected, ...rest];
    });
  };

  const handleRemovePhoto = (idx: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAnalyzeWithAI = async () => {
    if (referenceImages.length === 0) {
      setErrorMsg(
        'Carica almeno una foto (o più angolazioni) del personaggio per la profilazione.'
      );
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setWarningMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch('/api/analyze-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImageBase64: referenceImages[0],
          referenceImagesBase64: referenceImages,
          category,
          name: name.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || "Errore durante l'analisi AI delle foto."
        );
      }

      setVisualDescriptor(data.visualDescriptor);
      if (data.warning) {
        setWarningMsg(data.warning);
      } else {
        setSuccessMsg(
          `Identikit visivo 360° estratto da ${referenceImages.length} foto con successo!`
        );
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Errore durante la chiamata a Gemini Vision.';
      setErrorMsg(msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRegenerateCardDescriptor = async (char: Character) => {
    setRegeneratingCardId(char.id);
    setErrorMsg(null);
    setWarningMsg(null);
    const charPhotos =
      char.referenceImagesBase64 && char.referenceImagesBase64.length > 0
        ? char.referenceImagesBase64
        : [char.referenceImageBase64];

    try {
      const response = await fetch('/api/analyze-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImageBase64: charPhotos[0],
          referenceImagesBase64: charPhotos,
          category: char.category,
          name: char.name,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Errore rigenerazione identikit.');
      }
      const updatedChar: Character = {
        ...char,
        visualDescriptor: data.visualDescriptor,
      };
      await onSaveCharacter(updatedChar);
      if (editingId === char.id) {
        setVisualDescriptor(data.visualDescriptor);
      }
      if (data.warning) {
        setWarningMsg(data.warning);
      } else {
        setSuccessMsg(
          `Profilazione di "${char.name}" (${charPhotos.length} foto) aggiornata nel Database Casting!`
        );
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Errore durante la rigenerazione dell'identikit."
      );
    } finally {
      setRegeneratingCardId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!name.trim()) {
      setErrorMsg("Inserisci il nome dell'attore / personaggio.");
      return;
    }
    if (referenceImages.length === 0) {
      setErrorMsg('Carica almeno una foto per profilare il personaggio.');
      return;
    }
    if (!visualDescriptor.trim()) {
      setErrorMsg(
        'Inserisci o genera con AI il Visual Descriptor (in inglese) per la profilazione visiva.'
      );
      return;
    }
    if (!personality.trim()) {
      setErrorMsg(
        'Descrivi la personalità e il modo di parlare del personaggio.'
      );
      return;
    }

    setIsSaving(true);
    try {
      const character: Character = {
        id: editingId || `char-${Date.now()}`,
        name: name.trim(),
        category,
        actorRole,
        personality: personality.trim(),
        visualDescriptor: visualDescriptor.trim(),
        referenceImageBase64: referenceImages[0],
        referenceImagesBase64: referenceImages,
        ...(voiceId.trim() ? { voiceId: voiceId.trim() } : {}),
      };

      await onSaveCharacter(character);
      const wasEditing = Boolean(editingId);
      const savedCount = referenceImages.length;
      resetForm();
      setSuccessMsg(
        wasEditing
          ? `Scheda attore (${savedCount} foto) aggiornata nel Database Casting Supabase!`
          : `Attore salvato nel Portafoglio Casting su Database Supabase con ${savedCount} foto!`
      );
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Errore nel salvataggio.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* PANNELLO LATERALE: PROFILAZIONE MULTI-FOTO PER IL PORTAFOGLIO ATTORI */}
      <div className="xl:col-span-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-2xl sticky top-6">
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-400">
              {editingId ? (
                <Pencil className="w-5 h-5" />
              ) : (
                <Plus className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-100">
                {editingId
                  ? 'Modifica Scheda Attore'
                  : 'Profilazione Nuovo Attore (Multi-Foto)'}
              </h2>
              <p className="text-xs text-zinc-400">
                Foto e identikit memorizzati su Database Supabase per il Portafoglio Casting
              </p>
            </div>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-800 px-3 py-1.5 rounded-lg transition"
            >
              <X className="w-3.5 h-3.5" />
              Annulla
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="mb-4 p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {warningMsg && (
          <div className="mb-4 p-3.5 rounded-xl bg-amber-950/70 border border-amber-700/80 text-amber-200 text-xs flex items-start gap-2.5 leading-relaxed">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{warningMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* UPLOAD MULTI-FOTO PER PROFILAZIONE 360° */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                <Images className="w-4 h-4 text-amber-400" />
                Set Fotografico di Profilazione ({referenceImages.length}/6 Foto) *
              </label>
              {referenceImages.length > 0 && referenceImages.length < 6 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-bold text-violet-400 hover:text-violet-300 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Aggiungi altre foto
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFilesSelected(e.target.files);
                  e.target.value = '';
                }
              }}
            />

            {/* DROPZONE MULTI-FOTO */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => {
                if (referenceImages.length === 0) {
                  fileInputRef.current?.click();
                }
              }}
              className={`rounded-xl border-2 border-dashed transition-all p-3 ${
                isDragging
                  ? 'border-violet-500 bg-violet-950/30'
                  : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
              } ${referenceImages.length === 0 ? 'cursor-pointer' : ''}`}
            >
              {referenceImages.length === 0 ? (
                <div className="py-7 px-4 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3 text-violet-400">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-bold text-zinc-200">
                    Carica 1 o più foto del personaggio (Frontale, Profilo, Espressioni)
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Puoi selezionare fino a <strong>6 foto insieme</strong>: verranno tutte salvate nel Database Casting su Supabase!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* GRIGLIA DELLE FOTO CARICATE PER QUESTO PERSONAGGIO */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {referenceImages.map((imgUrl, idx) => (
                      <div
                        key={idx}
                        className={`relative group rounded-xl overflow-hidden border h-28 bg-zinc-900 ${
                          idx === 0
                            ? 'border-amber-500 ring-2 ring-amber-500/30'
                            : 'border-zinc-800'
                        }`}
                      >
                        <img
                          src={imgUrl}
                          alt={`Foto profilazione ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-black/75 px-1.5 py-1 text-[9px] font-bold text-zinc-200 truncate">
                          {PHOTO_SLOT_LABELS[idx] || `Foto #${idx + 1}`}
                        </div>

                        {idx === 0 ? (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 text-[9px] font-black uppercase flex items-center gap-0.5">
                            <Star className="w-2.5 h-2.5 fill-current" />
                            Principale
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSetPrimaryPhoto(idx)}
                            className="opacity-0 group-hover:opacity-100 absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 hover:bg-amber-500 text-zinc-200 hover:text-zinc-950 text-[9px] font-bold transition"
                            title="Imposta come foto principale"
                          >
                            Usa come Principale
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(idx)}
                          className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/80 hover:bg-red-600 text-zinc-300 hover:text-white transition"
                          title="Rimuovi questa foto"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}

                    {referenceImages.length < 6 && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-28 rounded-xl border border-dashed border-zinc-700 hover:border-violet-500 bg-zinc-900/50 hover:bg-violet-950/20 flex flex-col items-center justify-center gap-1 text-zinc-400 hover:text-violet-300 transition"
                      >
                        <Plus className="w-5 h-5 text-violet-400" />
                        <span className="text-[10px] font-bold">
                          Aggiungi Foto
                        </span>
                        <span className="text-[9px] text-zinc-500">
                          ({6 - referenceImages.length} slot liberi)
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* NOME, CATEGORIA E RUOLO NEL CASTING */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Nome Attore / Personaggio *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Diana / Zio Franco"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Categoria *
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategory('human')}
                  className={`flex items-center justify-center gap-1 py-2.5 px-2 rounded-xl border text-xs font-semibold transition ${
                    category === 'human'
                      ? 'bg-violet-600/25 border-violet-500 text-violet-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  Umano
                </button>
                <button
                  type="button"
                  onClick={() => setCategory('animal')}
                  className={`flex items-center justify-center gap-1 py-2.5 px-2 rounded-xl border text-xs font-semibold transition ${
                    category === 'animal'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  <Cat className="w-3.5 h-3.5" />
                  Animale
                </button>
              </div>
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Ruolo Casting
              </label>
              <select
                value={actorRole}
                onChange={(e) => setActorRole(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-2.5 py-2.5 text-xs font-semibold text-zinc-200 focus:outline-none focus:border-violet-500"
              >
                <option value="Protagonista">Protagonista</option>
                <option value="Co-protagonista">Co-protagonista</option>
                <option value="Antagonista">Antagonista</option>
                <option value="Guest / Comparsa">Guest / Comparsa</option>
              </select>
            </div>
          </div>

          {/* VISUAL DESCRIPTOR + PULSANTE PROFILAZIONE DA TUTTE LE FOTO */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Identikit Visivo Fisso (EN) *
              </label>
              <button
                type="button"
                onClick={handleAnalyzeWithAI}
                disabled={isAnalyzing || referenceImages.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-amber-500 to-violet-600 hover:from-amber-400 hover:to-violet-500 text-zinc-950 font-bold shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analisi {referenceImages.length} Foto...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-3.5 h-3.5" />
                    {referenceImages.length > 1
                      ? `Profilazione AI (${referenceImages.length} Foto)`
                      : 'Genera da Foto (AI)'}
                  </>
                )}
              </button>
            </div>
            <textarea
              rows={4}
              value={visualDescriptor}
              onChange={(e) => setVisualDescriptor(e.target.value)}
              placeholder="Clicca 'Profilazione AI' per analizzare tutte le foto caricate o descrivi i tratti fisici fissi in inglese..."
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-xs leading-relaxed text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition"
            />
          </div>

          {/* PERSONALITA' IN ITALIANO */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Personalità, Tono di Voce &amp; Tormentoni (ITA) *
            </label>
            <textarea
              rows={3}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="Es. Solare, ironica, battuta sempre pronta, ripete spesso 'Ma stiamo scherzando?!'..."
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition"
            />
          </div>

          {/* VOICE ID OPZIONALE */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              <Mic className="w-3.5 h-3.5 text-amber-400" />
              Voice ID (Opzionale - Predisposizione Voice Cloning)
            </label>
            <input
              type="text"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="Es. elevenlabs_voice_id_xyz"
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white font-bold text-sm shadow-lg shadow-violet-600/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Salvataggio su Database Supabase...
              </>
            ) : editingId ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Salva Modifiche nel Portafoglio Casting ({referenceImages.length}{' '}
                Foto)
              </>
            ) : (
              <>
                <Database className="w-4 h-4" />
                Salva Attore nel Portafoglio Casting ({referenceImages.length}{' '}
                Foto)
              </>
            )}
          </button>
        </form>
      </div>

      {/* COLONNA DESTRA: PORTAFOGLIO ATTORI DEL CASTING (MEMORIZZATO SU DATABASE SUPABASE) */}
      <div className="xl:col-span-7 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl px-6 py-4">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-base font-bold text-zinc-100">
                Portafoglio Attori del Casting ({cast.length})
              </h3>
              <p className="text-xs text-zinc-400">
                Tutte le schede attori e i set fotografici sono memorizzati nel Database Supabase e riutilizzabili in ogni Serie
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="px-2.5 py-1 rounded-full bg-violet-600/15 border border-violet-500/30 text-violet-300 font-medium">
              {cast.filter((c) => c.category === 'human').length} Umani
            </span>
            <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium">
              {cast.filter((c) => c.category === 'animal').length} Animali
            </span>
          </div>
        </div>

        {cast.length === 0 ? (
          <div className="bg-zinc-900/60 border border-zinc-800/80 border-dashed rounded-2xl p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4 text-zinc-500">
              <Sparkles className="w-8 h-8 text-violet-400" />
            </div>
            <h4 className="text-base font-bold text-zinc-200 mb-1">
              Portafoglio Attori del Casting vuoto
            </h4>
            <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
              Carica una o più foto del personaggio nel pannello a sinistra, genera o compila l&apos;identikit visivo e clicca{' '}
              <span className="text-violet-400 font-semibold">
                Salva Attore nel Portafoglio Casting
              </span>
              .
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cast.map((char) => {
              const isSelectedForEdit = editingId === char.id;
              const isRegenerating = regeneratingCardId === char.id;
              const allPhotos =
                char.referenceImagesBase64 &&
                char.referenceImagesBase64.length > 0
                  ? char.referenceImagesBase64
                  : [char.referenceImageBase64];
              const currentPhotoIdx = Math.min(
                activeCardPhotoIdx[char.id] || 0,
                allPhotos.length - 1
              );
              const displayedPhoto =
                allPhotos[currentPhotoIdx] || char.referenceImageBase64;

              return (
                <div
                  key={char.id}
                  className={`group bg-zinc-900/90 border rounded-2xl overflow-hidden transition-all flex flex-col ${
                    isSelectedForEdit
                      ? 'border-violet-500 ring-2 ring-violet-500/30'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="relative h-60 w-full bg-zinc-950 overflow-hidden">
                    <img
                      src={displayedPhoto}
                      alt={char.name}
                      className="w-full h-full object-cover transition-all duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />

                    {/* Badge Categoria + Ruolo + N. Foto nel DB */}
                    <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
                      {char.category === 'human' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-violet-600/90 text-white shadow-lg backdrop-blur-sm">
                          <User className="w-3 h-3" />
                          Umano
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/90 text-zinc-950 shadow-lg backdrop-blur-sm">
                          <Cat className="w-3 h-3" />
                          Animale
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/75 text-emerald-300 border border-emerald-500/40 backdrop-blur-sm">
                        <Images className="w-3 h-3" />
                        {allPhotos.length} foto in DB
                      </span>
                    </div>

                    {/* Azioni Rigenera AI / Modifica / Elimina */}
                    <div className="absolute top-3 right-3 flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isRegenerating}
                        onClick={() => handleRegenerateCardDescriptor(char)}
                        title="Rigenera Identikit Visivo da tutte le foto dell'attore"
                        className="px-2.5 py-1.5 rounded-xl bg-zinc-900/85 hover:bg-amber-500 text-amber-300 hover:text-zinc-950 border border-zinc-700/80 text-[11px] font-bold flex items-center gap-1 transition backdrop-blur-sm"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            isRegenerating ? 'animate-spin' : ''
                          }`}
                        />
                        Rigenera AI
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditSelect(char)}
                        title="Modifica scheda e foto attore"
                        className="p-2 rounded-xl bg-zinc-900/85 hover:bg-violet-600 text-zinc-200 hover:text-white border border-zinc-700/80 transition backdrop-blur-sm"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCharacter(char.id)}
                        title="Elimina attore dal portafoglio"
                        className="p-2 rounded-xl bg-zinc-900/85 hover:bg-red-600 text-zinc-200 hover:text-white border border-zinc-700/80 transition backdrop-blur-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
                      <div>
                        {char.actorRole && (
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400 block">
                            {char.actorRole}
                          </span>
                        )}
                        <h4 className="text-lg font-bold text-white drop-shadow">
                          {char.name}
                        </h4>
                      </div>

                      {/* Selettore Miniature Multi-Foto direttamente sulla Card */}
                      {allPhotos.length > 1 && (
                        <div className="flex items-center gap-1 bg-black/70 p-1 rounded-xl border border-white/10 backdrop-blur-sm">
                          {allPhotos.map((thumb, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() =>
                                setActiveCardPhotoIdx((prev) => ({
                                  ...prev,
                                  [char.id]: idx,
                                }))
                              }
                              className={`w-7 h-7 rounded-lg overflow-hidden border transition ${
                                currentPhotoIdx === idx
                                  ? 'border-amber-400 scale-105'
                                  : 'border-zinc-700 opacity-60 hover:opacity-100'
                              }`}
                            >
                              <img
                                src={thumb}
                                alt={`${char.name} ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400 block mb-1">
                        Personalità &amp; Tono (ITA)
                      </span>
                      <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
                        {char.personality}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-zinc-800/80">
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1">
                        <Eye className="w-3 h-3" />
                        Identikit Casting 360° (EN)
                      </span>
                      <p className="text-[11px] text-zinc-400 font-mono line-clamp-3 leading-relaxed bg-zinc-950/70 p-2 rounded-lg border border-zinc-800/60">
                        {char.visualDescriptor}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
