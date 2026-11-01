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
} from 'lucide-react';
import type { Character } from '@/types/episodia';

interface CastAndAssetsViewProps {
  cast: Character[];
  onSaveCharacter: (character: Character) => Promise<void>;
  onDeleteCharacter: (id: string) => Promise<void>;
}

export default function CastAndAssetsView({
  cast,
  onSaveCharacter,
  onDeleteCharacter,
}: CastAndAssetsViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'human' | 'animal'>('human');
  const [personality, setPersonality] = useState('');
  const [visualDescriptor, setVisualDescriptor] = useState('');
  const [referenceImageBase64, setReferenceImageBase64] = useState('');
  const [voiceId, setVoiceId] = useState('');

  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [regeneratingCardId, setRegeneratingCardId] = useState<string | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCategory('human');
    setPersonality('');
    setVisualDescriptor('');
    setReferenceImageBase64('');
    setVoiceId('');
    setErrorMsg(null);
  };

  const handleEditSelect = (char: Character) => {
    setEditingId(char.id);
    setName(char.name);
    setCategory(char.category);
    setPersonality(char.personality);
    setVisualDescriptor(char.visualDescriptor);
    setReferenceImageBase64(char.referenceImageBase64);
    setVoiceId(char.voiceId || '');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const convertFileToBase64 = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Carica un file immagine valido (JPG, PNG, WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReferenceImageBase64(reader.result);
        setErrorMsg(null);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Errore durante la lettura del file immagine.');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      convertFileToBase64(file);
    }
  };

  const handleAnalyzeWithAI = async () => {
    if (!referenceImageBase64) {
      setErrorMsg('Carica prima una foto di riferimento del personaggio.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch('/api/analyze-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImageBase64,
          category,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || "Errore durante l'analisi AI dell'immagine."
        );
      }

      setVisualDescriptor(data.visualDescriptor);
      setSuccessMsg(
        'Identikit visivo generato con successo tramite Gemini Vision!'
      );
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
    try {
      const response = await fetch('/api/analyze-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImageBase64: char.referenceImageBase64,
          category: char.category,
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
      setSuccessMsg(`Identikit visivo di "${char.name}" rigenerato e salvato!`);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Errore durante la rigenerazione dell’identikit.'
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
      setErrorMsg('Inserisci il nome del personaggio.');
      return;
    }
    if (!referenceImageBase64) {
      setErrorMsg('Carica una foto di riferimento per il personaggio.');
      return;
    }
    if (!visualDescriptor.trim()) {
      setErrorMsg(
        'Inserisci o genera con AI il Visual Descriptor (in inglese) per garantire la coerenza visiva.'
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
        personality: personality.trim(),
        visualDescriptor: visualDescriptor.trim(),
        referenceImageBase64,
        ...(voiceId.trim() ? { voiceId: voiceId.trim() } : {}),
      };

      await onSaveCharacter(character);
      const wasEditing = Boolean(editingId);
      resetForm();
      setSuccessMsg(
        wasEditing
          ? 'Personaggio aggiornato su Server & IndexedDB!'
          : 'Nuovo personaggio salvato nel Cast Globale!'
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
      {/* PANNELLO LATERALE / FORM CREAZIONE & MODIFICA PERSONAGGIO */}
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
                  ? 'Modifica Personaggio'
                  : 'Nuovo Personaggio (Cast Globale)'}
              </h2>
              <p className="text-xs text-zinc-400">
                Disponibile per tutte le tue Serie TV e sincronizzato col Server
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

        {successMsg && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* UPLOAD DRAG & DROP FOTO RIFERIMENTO */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Foto di Riferimento (Alta Risoluzione Base64) *
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all overflow-hidden ${
                isDragging
                  ? 'border-violet-500 bg-violet-950/30'
                  : referenceImageBase64
                  ? 'border-zinc-700 bg-zinc-950/60 hover:border-violet-500/60'
                  : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) convertFileToBase64(file);
                }}
              />

              {referenceImageBase64 ? (
                <div className="relative group h-52 w-full bg-zinc-950 flex items-center justify-center">
                  <img
                    src={referenceImageBase64}
                    alt="Reference preview"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 text-zinc-200">
                    <Upload className="w-6 h-6 text-amber-400" />
                    <span className="text-xs font-medium">
                      Clicca o trascina per sostituire la foto
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-8 px-4 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3 text-violet-400">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-zinc-200">
                    Trascina qui la foto o{' '}
                    <span className="text-violet-400 underline">sfoglia</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    PNG, JPG, WEBP ad alta risoluzione
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* NOME E CATEGORIA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Nome Personaggio *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Zio Franco / Birba"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Categoria *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCategory('human')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    category === 'human'
                      ? 'bg-violet-600/25 border-violet-500 text-violet-200 shadow-sm'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <User className="w-4 h-4" />
                  Umano
                </button>
                <button
                  type="button"
                  onClick={() => setCategory('animal')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                    category === 'animal'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-200 shadow-sm'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Cat className="w-4 h-4" />
                  Animale
                </button>
              </div>
            </div>
          </div>

          {/* VISUAL DESCRIPTOR + PULSANTE ESTRAI/RIGENERA IDENTIKIT CON AI */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Identikit Visivo Fisso (EN) *
              </label>
              <button
                type="button"
                onClick={handleAnalyzeWithAI}
                disabled={isAnalyzing || !referenceImageBase64}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-amber-500 to-violet-600 hover:from-amber-400 hover:to-violet-500 text-zinc-950 font-bold shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analisi Vision AI...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-3.5 h-3.5" />
                    {visualDescriptor
                      ? 'Rigenera da Foto (AI)'
                      : 'Genera da Foto (AI)'}
                  </>
                )}
              </button>
            </div>
            <textarea
              rows={4}
              value={visualDescriptor}
              onChange={(e) => setVisualDescriptor(e.target.value)}
              placeholder="Click 'Genera da Foto (AI)' or write an ultra-specific English physical description..."
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
              placeholder="Es. Cinico, sarcastico, parla con accento romano marcato, dà sempre la colpa agli altri..."
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
            className="w-full py-3 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white font-semibold text-sm shadow-lg shadow-violet-600/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Salvataggio...
              </>
            ) : editingId ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Salva Modifiche Personaggio
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Aggiungi al Cast Globale
              </>
            )}
          </button>
        </form>
      </div>

      {/* GRIGLIA DELLE CARD DEI PERSONAGGI SALVATI */}
      <div className="xl:col-span-7 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl px-6 py-4">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-base font-bold text-zinc-100">
                Libreria Cast Globale ({cast.length})
              </h3>
              <p className="text-xs text-zinc-400">
                Tutti i personaggi sono condivisi tra tutte le tue Serie TV
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
              Nessun personaggio nel Cast Globale
            </h4>
            <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
              Carica una foto nel pannello a sinistra e usa{' '}
              <span className="text-amber-400 font-semibold">
                Genera da Foto (AI)
              </span>{' '}
              per estrarre l&apos;identikit visivo in inglese con Gemini 2.5 Flash.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cast.map((char) => {
              const isSelectedForEdit = editingId === char.id;
              const isRegenerating = regeneratingCardId === char.id;
              return (
                <div
                  key={char.id}
                  className={`group bg-zinc-900/90 border rounded-2xl overflow-hidden transition-all flex flex-col ${
                    isSelectedForEdit
                      ? 'border-violet-500 ring-2 ring-violet-500/30'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="relative h-56 w-full bg-zinc-950 overflow-hidden">
                    <img
                      src={char.referenceImageBase64}
                      alt={char.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />

                    {/* Badge Categoria */}
                    <div className="absolute top-3 left-3">
                      {char.category === 'human' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-600/90 text-white shadow-lg backdrop-blur-sm">
                          <User className="w-3.5 h-3.5" />
                          Umano
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/90 text-zinc-950 shadow-lg backdrop-blur-sm">
                          <Cat className="w-3.5 h-3.5" />
                          Animale
                        </span>
                      )}
                    </div>

                    {/* Azioni Rigenera AI / Modifica / Elimina */}
                    <div className="absolute top-3 right-3 flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isRegenerating}
                        onClick={() => handleRegenerateCardDescriptor(char)}
                        title="Rigenera Identikit Visivo da Foto con AI"
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
                        title="Modifica personaggio"
                        className="p-2 rounded-xl bg-zinc-900/85 hover:bg-violet-600 text-zinc-200 hover:text-white border border-zinc-700/80 transition backdrop-blur-sm"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCharacter(char.id)}
                        title="Elimina personaggio"
                        className="p-2 rounded-xl bg-zinc-900/85 hover:bg-red-600 text-zinc-200 hover:text-white border border-zinc-700/80 transition backdrop-blur-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
                      <div>
                        <h4 className="text-lg font-bold text-white drop-shadow">
                          {char.name}
                        </h4>
                        {char.voiceId && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-mono">
                            <Mic className="w-3 h-3" />
                            {char.voiceId}
                          </span>
                        )}
                      </div>
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
                        Visual Descriptor (EN)
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
