'use client';

import React, { useState, useEffect } from 'react';
import {
  Clapperboard,
  Sparkles,
  Check,
  Users,
  Film,
  Clock,
  Loader2,
  AlertCircle,
  ArrowRight,
  Trash2,
  User,
  Cat,
  Wand2,
  Tv,
  Save,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import type { Character, Series, Episode, Shot } from '@/types/episodia';

interface WritersRoomViewProps {
  cast: Character[];
  seriesList: Series[];
  activeSeries: Series;
  episodes: Episode[];
  activeEpisodeId: string | null;
  onSelectSeries: (seriesId: string) => void;
  onSaveSeriesDraft: (seriesItem: Series) => Promise<void>;
  onEpisodeCreated: (episode: Episode) => Promise<void>;
  onUpdateEpisode: (episode: Episode) => Promise<void>;
  onSelectEpisode: (episodeId: string) => void;
  onDeleteEpisode: (episodeId: string) => Promise<void>;
  onGoToCast: () => void;
}

const SAMPLE_PROMPTS = [
  "Siamo in cucina dopo una festa in maschera e discutiamo su chi ha fatto sparire l'ultima bottiglia",
  "Riunione di condominio d'emergenza sul divano: qualcuno ha ordinato 40 pizze a nome dell'amministratore",
  'In macchina fermi nel traffico: il navigatore dà indicazioni assurde e ognuno sostiene di conoscere una scorciatoia segreta',
];

export default function WritersRoomView({
  cast,
  seriesList,
  activeSeries,
  episodes,
  activeEpisodeId,
  onSelectSeries,
  onSaveSeriesDraft,
  onEpisodeCreated,
  onUpdateEpisode,
  onSelectEpisode,
  onDeleteEpisode,
  onGoToCast,
}: WritersRoomViewProps) {
  const [title, setTitle] = useState(activeSeries.draftTitle || '');
  const [logline, setLogline] = useState(activeSeries.draftLogline || '');
  const [shotCount, setShotCount] = useState<number>(
    activeSeries.draftShotCount || 4
  );
  const [selectedCastIds, setSelectedCastIds] = useState<string[]>(() => {
    if (activeSeries.draftCastIds && activeSeries.draftCastIds.length > 0) {
      return activeSeries.draftCastIds.filter((id) =>
        cast.some((c) => c.id === id)
      );
    }
    if (activeSeries.castIds && activeSeries.castIds.length > 0) {
      return activeSeries.castIds.filter((id) =>
        cast.some((c) => c.id === id)
      );
    }
    return cast.map((c) => c.id);
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingEpisodeId, setRegeneratingEpisodeId] = useState<
    string | null
  >(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draftSavedBadge, setDraftSavedBadge] = useState<string | null>(null);

  // Ripristina la bozza salvata quando si cambia Serie TV attiva
  useEffect(() => {
    setTitle(activeSeries.draftTitle || '');
    setLogline(activeSeries.draftLogline || '');
    setShotCount(activeSeries.draftShotCount || 4);

    if (activeSeries.draftCastIds && activeSeries.draftCastIds.length > 0) {
      const validDraft = activeSeries.draftCastIds.filter((id) =>
        cast.some((c) => c.id === id)
      );
      if (validDraft.length > 0) {
        setSelectedCastIds(validDraft);
        return;
      }
    }
    if (activeSeries.castIds && activeSeries.castIds.length > 0) {
      const validSeries = activeSeries.castIds.filter((id) =>
        cast.some((c) => c.id === id)
      );
      if (validSeries.length > 0) {
        setSelectedCastIds(validSeries);
        return;
      }
    }
    setSelectedCastIds(cast.map((c) => c.id));
  }, [activeSeries.id, cast]);

  // Auto-salvataggio di Titolo, Trama e Personaggi sulla Serie anche senza generare il file
  useEffect(() => {
    const timer = setTimeout(() => {
      if (
        title !== (activeSeries.draftTitle || '') ||
        logline !== (activeSeries.draftLogline || '') ||
        shotCount !== (activeSeries.draftShotCount || 4) ||
        JSON.stringify(selectedCastIds) !==
          JSON.stringify(activeSeries.draftCastIds || [])
      ) {
        onSaveSeriesDraft({
          ...activeSeries,
          draftTitle: title,
          draftLogline: logline,
          draftCastIds: selectedCastIds,
          draftShotCount: shotCount,
        });
        setDraftSavedBadge(
          new Date().toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        );
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [title, logline, shotCount, selectedCastIds]);

  const seriesEpisodes = episodes.filter(
    (ep) => ep.seriesId === activeSeries.id
  );

  const toggleCharacter = (id: string) => {
    setSelectedCastIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllCast = () => {
    setSelectedCastIds(cast.map((c) => c.id));
  };

  const selectSeriesDefaultCast = () => {
    if (activeSeries.castIds.length > 0) {
      setSelectedCastIds(activeSeries.castIds);
    } else {
      selectAllCast();
    }
  };

  // Salva subito la puntata (Titolo + Trama + Personaggi) anche senza generare con AI o salvare file video
  const handleSaveEpisodeMetadataOnly = async () => {
    setErrorMsg(null);
    if (!title.trim() && !logline.trim()) {
      setErrorMsg(
        'Inserisci almeno un Titolo o una Trama per salvare la scheda della puntata.'
      );
      return;
    }

    const activeCast = cast.filter((c) => selectedCastIds.includes(c.id));
    const fallbackCastIds =
      activeCast.length > 0
        ? activeCast.map((c) => c.id)
        : cast[0]
        ? [cast[0].id]
        : [];

    const nextEpNumber =
      seriesEpisodes.length > 0
        ? Math.max(...seriesEpisodes.map((ep) => ep.episodeNumber)) + 1
        : 1;

    const placeholderShots: Shot[] = Array.from(
      { length: shotCount },
      (_, idx) => ({
        id: `shot-${Date.now()}-${idx + 1}`,
        shotNumber: idx + 1,
        duration: 10,
        characterIds: fallbackCastIds,
        cameraAngle: 'Medium selfie shot, handheld camera',
        visualPromptEn: '',
        speakerId: fallbackCastIds[0] || null,
        dialogueIta: '',
        status: 'draft',
      })
    );

    const newEpisode: Episode = {
      id: `ep-${Date.now()}`,
      seriesId: activeSeries.id,
      episodeNumber: nextEpNumber,
      title: title.trim() || `Puntata #${nextEpNumber}`,
      logline: logline.trim() || 'Trama in fase di definizione',
      selectedCastIds: fallbackCastIds,
      shots: placeholderShots,
      createdAt: new Date().toISOString(),
    };

    await onEpisodeCreated(newEpisode);
  };

  const handleGenerateEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const activeCast = cast.filter((c) => selectedCastIds.includes(c.id));
    if (activeCast.length === 0) {
      setErrorMsg(
        'Seleziona almeno un personaggio del Cast per generare la puntata.'
      );
      return;
    }
    if (!title.trim()) {
      setErrorMsg("Inserisci il titolo dell'episodio.");
      return;
    }
    if (!logline.trim()) {
      setErrorMsg('Inserisci il soggetto o la situazione comica della puntata.');
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${activeSeries.title} - ${title.trim()}`,
          logline: `[Serie: ${activeSeries.title} (${activeSeries.genre}) - ${activeSeries.description}] Situazione episodio: ${logline.trim()}`,
          shotCount,
          cast: activeCast,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'Errore durante la generazione della sceneggiatura.'
        );
      }

      const generatedShots: Shot[] = data.shots;
      const nextEpNumber =
        seriesEpisodes.length > 0
          ? Math.max(...seriesEpisodes.map((ep) => ep.episodeNumber)) + 1
          : 1;

      const newEpisode: Episode = {
        id: `ep-${Date.now()}`,
        seriesId: activeSeries.id,
        episodeNumber: nextEpNumber,
        title: title.trim(),
        logline: logline.trim(),
        selectedCastIds: activeCast.map((c) => c.id),
        shots: generatedShots,
        createdAt: new Date().toISOString(),
      };

      await onEpisodeCreated(newEpisode);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Errore imprevisto nella chiamata a Gemini.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Rigenera interamente la sceneggiatura di un episodio esistente mantenendo Titolo, Trama e Cast
  const handleRegenerateExistingEpisode = async (ep: Episode) => {
    setErrorMsg(null);
    const epCast = cast.filter((c) => ep.selectedCastIds.includes(c.id));
    const effectiveCast = epCast.length > 0 ? epCast : cast;

    if (effectiveCast.length === 0) {
      setErrorMsg('Aggiungi almeno un personaggio nel Cast per rigenerare.');
      return;
    }

    setRegeneratingEpisodeId(ep.id);
    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${activeSeries.title} - ${ep.title}`,
          logline: `[Serie: ${activeSeries.title} (${activeSeries.genre})] Situazione episodio: ${ep.logline}`,
          shotCount: ep.shots.length || 4,
          cast: effectiveCast,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'Errore nella rigenerazione della puntata.'
        );
      }

      const updatedEp: Episode = {
        ...ep,
        shots: data.shots,
      };

      await onUpdateEpisode(updatedEp);
      onSelectEpisode(updatedEp.id);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Errore durante la rigenerazione della puntata.'
      );
    } finally {
      setRegeneratingEpisodeId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* FORM PRINCIPALE WRITER'S ROOM */}
      <div className="xl:col-span-8 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-400">
              <Clapperboard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-100">
                Writer&apos;s Room — Sceneggiatura per &quot;{activeSeries.title}&quot;
              </h2>
              <p className="text-xs text-zinc-400">
                Titolo, Trama e Personaggi vengono salvati automaticamente sul Server mentre scrivi
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {draftSavedBadge && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-[11px] text-emerald-300">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                Bozza salvata ({draftSavedBadge})
              </span>
            )}

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800">
              <Tv className="w-3.5 h-3.5 text-violet-400" />
              <select
                value={activeSeries.id}
                onChange={(e) => onSelectSeries(e.target.value)}
                className="bg-transparent text-xs font-bold text-zinc-200 focus:outline-none"
              >
                {seriesList.map((s) => (
                  <option key={s.id} value={s.id} className="bg-zinc-900">
                    Serie: {s.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>
                <strong className="text-amber-400">{shotCount * 10}s</strong> (
                {shotCount} shot da 10s)
              </span>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleGenerateEpisode} className="space-y-6">
          {/* 1. SELETTORE VISIVO DEL CAST */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Users className="w-4 h-4 text-violet-400" />
                1. Personaggi della Puntata ({selectedCastIds.length} selezionati)
              </label>
              {cast.length > 0 && (
                <div className="flex items-center gap-2">
                  {activeSeries.castIds.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={selectSeriesDefaultCast}
                        className="text-xs text-amber-400 hover:text-amber-300 font-medium"
                      >
                        Cast fisso della serie
                      </button>
                      <span className="text-zinc-700">•</span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={selectAllCast}
                    className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                  >
                    Tutti i personaggi
                  </button>
                  <span className="text-zinc-700">•</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCastIds([])}
                    className="text-xs text-zinc-500 hover:text-zinc-300 font-medium"
                  >
                    Deseleziona
                  </button>
                </div>
              )}
            </div>

            {cast.length === 0 ? (
              <div className="p-8 rounded-2xl bg-zinc-950/70 border border-dashed border-zinc-800 text-center">
                <p className="text-sm text-zinc-300 font-medium mb-2">
                  Non hai ancora aggiunto personaggi nel Cast Globale.
                </p>
                <button
                  type="button"
                  onClick={onGoToCast}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition"
                >
                  Vai a Cast Globale
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {cast.map((char) => {
                  const isSelected = selectedCastIds.includes(char.id);
                  const isSeriesRegular = activeSeries.castIds.includes(
                    char.id
                  );
                  return (
                    <button
                      key={char.id}
                      type="button"
                      onClick={() => toggleCharacter(char.id)}
                      className={`group relative text-left rounded-xl overflow-hidden border transition-all ${
                        isSelected
                          ? 'border-violet-500 ring-2 ring-violet-500/40 bg-violet-950/20'
                          : 'border-zinc-800 bg-zinc-950/60 opacity-65 hover:opacity-100 hover:border-zinc-700'
                      }`}
                    >
                      <div className="relative h-28 w-full bg-zinc-950">
                        <img
                          src={char.referenceImageBase64}
                          alt={char.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                        <div
                          className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition ${
                            isSelected
                              ? 'bg-violet-600 text-white shadow-md'
                              : 'bg-zinc-900/80 text-zinc-500 border border-zinc-700'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </div>
                        <div className="absolute top-2 left-2 flex items-center gap-1">
                          {char.category === 'human' ? (
                            <span className="p-1 rounded-md bg-violet-600/90 text-white inline-flex">
                              <User className="w-3 h-3" />
                            </span>
                          ) : (
                            <span className="p-1 rounded-md bg-amber-500/90 text-zinc-950 inline-flex">
                              <Cat className="w-3 h-3" />
                            </span>
                          )}
                          {isSeriesRegular && (
                            <span className="px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-bold text-amber-300 border border-amber-500/40">
                              Fisso
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs font-bold text-zinc-100 truncate">
                          {char.name}
                        </p>
                        <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                          {char.personality}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. TITOLO EPISODIO E NUMERO DI INQUADRATURE (3-6 SHOT) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-7">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                2. Titolo della Puntata (Auto-salvato) *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Es. Il Mistero dell'Ultima Bottiglia"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div className="md:col-span-5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                3. Inquadrature (3 - 6 Clip da 10s) *
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[3, 4, 5, 6].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setShotCount(num)}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center ${
                      shotCount === num
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>{num} Shot</span>
                    <span className="text-[10px] font-normal opacity-75">
                      {num * 10} sec
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. SOGGETTO / TRAMA DELLA PUNTATA */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                4. Trama / Soggetto della Puntata (Auto-salvato) *
              </label>
              <span className="text-[11px] text-zinc-500">
                Salvato anche se non generi il file video
              </span>
            </div>
            <textarea
              rows={4}
              value={logline}
              onChange={(e) => setLogline(e.target.value)}
              placeholder="Siamo in cucina dopo una festa in maschera e discutiamo su chi ha fatto sparire l'ultima bottiglia"
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition leading-relaxed"
            />

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 mr-1">
                Idee rapide:
              </span>
              {SAMPLE_PROMPTS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setLogline(sample);
                    if (!title.trim()) {
                      setTitle(
                        idx === 0
                          ? "L'Ultima Bottiglia"
                          : idx === 1
                          ? "40 Pizze per l'Amministratore"
                          : 'Scorciatoia Segreta'
                      );
                    }
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-amber-300 transition truncate max-w-xs"
                >
                  “{sample.slice(0, 48)}...”
                </button>
              ))}
            </div>
          </div>

          {/* AZIONI: SALVA SOLO SCHEDA PUNTATA OPPURE GENERA CON GEMINI */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <button
              type="button"
              onClick={handleSaveEpisodeMetadataOnly}
              className="sm:col-span-5 py-4 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-bold text-xs flex items-center justify-center gap-2 transition"
              title="Salva subito Titolo, Trama e Personaggi come puntata della serie anche senza generare gli shot con AI"
            >
              <Save className="w-4 h-4 text-amber-400" />
              Salva Puntata (Titolo, Trama e Cast)
            </button>

            <button
              type="submit"
              disabled={isGenerating || cast.length === 0}
              className="sm:col-span-7 py-4 px-6 rounded-xl bg-gradient-to-r from-violet-600 via-violet-500 to-amber-500 hover:from-violet-500 hover:to-amber-400 text-white font-bold text-sm shadow-xl shadow-violet-600/25 flex items-center justify-center gap-2.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Scrittura Sceneggiatura con Gemini...
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  Genera / Rigenera Episodio con Gemini
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* COLONNA LATERALE: EPISODI SALVATI DELLA SERIE + RIGENERAZIONE */}
      <div className="xl:col-span-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-zinc-100">
                Puntate di &quot;{activeSeries.title}&quot; ({seriesEpisodes.length})
              </h3>
              <p className="text-[11px] text-zinc-400">
                Titolo, trama e cast sempre salvati sul Server
              </p>
            </div>
          </div>
        </div>

        {seriesEpisodes.length === 0 ? (
          <div className="py-10 px-4 text-center rounded-xl bg-zinc-950/50 border border-dashed border-zinc-800">
            <Sparkles className="w-7 h-7 text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-400">
              Nessuna puntata ancora salvata per <strong>{activeSeries.title}</strong>.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
            {seriesEpisodes.map((ep) => {
              const isCurrent = ep.id === activeEpisodeId;
              const isRegen = regeneratingEpisodeId === ep.id;
              const epChars = cast.filter((c) =>
                ep.selectedCastIds.includes(c.id)
              );

              return (
                <div
                  key={ep.id}
                  className={`p-4 rounded-xl border transition cursor-pointer ${
                    isCurrent
                      ? 'bg-violet-950/30 border-violet-500/80'
                      : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700'
                  }`}
                  onClick={() => onSelectEpisode(ep.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 mb-1.5">
                        Ep. #{ep.episodeNumber} • {ep.shots.length} Shot
                      </span>
                      <h4 className="text-sm font-bold text-zinc-100">
                        {ep.title}
                      </h4>
                    </div>
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={isRegen}
                        onClick={() => handleRegenerateExistingEpisode(ep)}
                        className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-violet-600 text-amber-300 hover:text-white border border-zinc-800 text-[10px] font-bold flex items-center gap-1 transition"
                        title="Rigenera da zero la sceneggiatura di questa puntata mantenendo Titolo, Trama e Personaggi"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${isRegen ? 'animate-spin' : ''}`}
                        />
                        Rigenera
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteEpisode(ep.id)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition"
                        title="Elimina episodio"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 line-clamp-2 mt-1">
                    {ep.logline}
                  </p>

                  {/* Avatar dei personaggi salvati nella puntata */}
                  {epChars.length > 0 && (
                    <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                      {epChars.map((c) => (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300"
                        >
                          <img
                            src={c.referenceImageBase64}
                            alt={c.name}
                            className="w-3.5 h-3.5 rounded-full object-cover"
                          />
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTitle(ep.title);
                        setLogline(ep.logline);
                        setSelectedCastIds(ep.selectedCastIds);
                        setShotCount(ep.shots.length || 4);
                      }}
                      className="text-amber-400 hover:underline font-medium"
                    >
                      Carica nei campi
                    </button>
                    <span className="text-violet-400 font-semibold flex items-center gap-1">
                      Apri Storyboard
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
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
