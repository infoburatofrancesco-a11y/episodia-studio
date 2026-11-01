import React from 'react';
import {
  ArrowLeft,
  Users,
  Film,
  Plus,
  Play,
  Trash2,
  Clock,
  Sparkles,
  Dog,
  User,
  Check
} from 'lucide-react';
import { Series, SeriesGenreStyle, SERIES_GENRE_STYLES } from '../types/studio';

interface SeriesDetailViewProps {
  series: Series;
  onBackToAllSeries: () => void;
  onOpenCastModal: () => void;
  onOpenBrandingModal: () => void;
  onSelectEpisodeToEdit: (episodeId: string, startStep?: 1 | 2 | 3) => void;
  onCreateNewEpisode: () => void;
  onDeleteEpisode: (episodeId: string) => void;
  onDeleteCurrentSeries: () => void;
  onUpdateSeriesMeta: (
    title: string,
    description: string,
    genreStyle?: SeriesGenreStyle,
    customStylePrompt?: string
  ) => void;
}

export const SeriesDetailView: React.FC<SeriesDetailViewProps> = ({
  series,
  onBackToAllSeries,
  onOpenCastModal,
  onOpenBrandingModal,
  onSelectEpisodeToEdit,
  onCreateNewEpisode,
  onDeleteEpisode,
  onDeleteCurrentSeries,
  onUpdateSeriesMeta
}) => {
  const activeGenreId: SeriesGenreStyle = series.genreStyle || 'COMEDY';
  const activeGenrePreset =
    SERIES_GENRE_STYLES.find((g) => g.id === activeGenreId) || SERIES_GENRE_STYLES[0];

  return (
    <div className="space-y-8 pb-12">
      {/* 1. INTESTAZIONE SERIE + AZIONI CAST E SIGLA */}
      <div className="bg-white border-2 border-sky-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sky-100 pb-4">
          <button
            type="button"
            onClick={onBackToAllSeries}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-sm transition"
          >
            <ArrowLeft className="w-4 h-4" /> ← Tutte le Serie (Progetti)
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-extrabold ${activeGenrePreset.badgeColor}`}
            >
              {activeGenrePreset.emoji} Stile: {activeGenrePreset.label}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-extrabold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" /> Livello 2 di 3 • Gestione Serie, Cast & Puntate
            </span>
            <button
              type="button"
              onClick={onDeleteCurrentSeries}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-extrabold text-xs transition"
            >
              <Trash2 className="w-4 h-4" /> Elimina questa Serie
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-2">
            <label className="text-[11px] font-extrabold uppercase tracking-wider text-sky-700">
              Titolo della Serie Attiva (clicca per rinominare)
            </label>
            <input
              type="text"
              value={series.title}
              onChange={(e) =>
                onUpdateSeriesMeta(
                  e.target.value,
                  series.description,
                  series.genreStyle,
                  series.customStylePrompt
                )
              }
              className="w-full text-2xl sm:text-3xl font-black text-slate-800 bg-transparent border-b-2 border-transparent hover:border-sky-300 focus:border-sky-500 focus:outline-none pb-1"
            />
            <input
              type="text"
              value={series.description}
              onChange={(e) =>
                onUpdateSeriesMeta(
                  series.title,
                  e.target.value,
                  series.genreStyle,
                  series.customStylePrompt
                )
              }
              className="w-full text-sm sm:text-base text-slate-600 bg-transparent border-b border-transparent hover:border-sky-200 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-5 flex flex-wrap sm:flex-nowrap gap-3 justify-end">
            <button
              type="button"
              onClick={onOpenCastModal}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-sm transition shadow-sm"
            >
              <Users className="w-5 h-5 text-sky-600" />
              👥 Gestisci Cast ({series.cast.length})
            </button>
            <button
              type="button"
              onClick={onOpenBrandingModal}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-sm transition shadow-sm"
            >
              <Film className="w-5 h-5 text-sky-600" />
              🎬 Sigla & Coda ({series.branding.introDurationSec}s +{' '}
              {series.branding.outroDurationSec}s)
            </button>
          </div>
        </div>

        {/* SELETTORE STILE E GENERE DELLA SERIE (COMEDY, ROMANTICO, HORROR/THRILLER, AZIONE, ECC.) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-sky-50 via-indigo-50/50 to-amber-50/40 border-2 border-sky-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-extrabold uppercase tracking-wider text-sky-950 flex items-center gap-1.5">
                🎭 Stile & Genere di questa Serie (Guida Regia, Dialoghi e Montaggio AI):
              </span>
              <p className="text-xs text-slate-600 mt-0.5">
                Seleziona lo stile della serie: lo Storyboard AI e le battute dei personaggi si adatteranno automaticamente!
              </p>
            </div>
            <span
              className={`px-3 py-1 rounded-xl border text-xs font-black ${activeGenrePreset.badgeColor}`}
            >
              Attivo: {activeGenrePreset.emoji} {activeGenrePreset.label}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
            {SERIES_GENRE_STYLES.map((preset) => {
              const isSelected = activeGenreId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    onUpdateSeriesMeta(
                      series.title,
                      series.description,
                      preset.id,
                      series.customStylePrompt || preset.shortDesc
                    )
                  }
                  className={`p-2.5 rounded-2xl border-2 text-left transition flex flex-col justify-between gap-1 ${
                    isSelected
                      ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                      : 'bg-white hover:bg-sky-50 text-slate-800 border-sky-200'
                  }`}
                >
                  <div className="font-extrabold text-xs flex items-center justify-between gap-1">
                    <span className="truncate">
                      {preset.emoji} {preset.label.split('/')[0].trim()}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  </div>
                  <p
                    className={`text-[10px] leading-tight line-clamp-2 ${
                      isSelected ? 'text-sky-100' : 'text-slate-500'
                    }`}
                  >
                    {preset.shortDesc}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center pt-1">
            <label className="sm:col-span-4 text-[11px] font-extrabold text-sky-950">
              ✨ Sfumatura di Stile / Atmosfera della Serie:
            </label>
            <div className="sm:col-span-8">
              <input
                type="text"
                value={series.customStylePrompt ?? activeGenrePreset.shortDesc}
                onChange={(e) =>
                  onUpdateSeriesMeta(
                    series.title,
                    series.description,
                    activeGenreId,
                    e.target.value
                  )
                }
                placeholder="Es. Atmosfera horror-thriller piena di suspense ma con battute finali buffe..."
                className="w-full px-3.5 py-2 rounded-xl border border-sky-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* RIEPILOGO VISIVO DEL CAST DI QUESTA SERIE */}
        <div className="p-5 rounded-2xl bg-sky-50 border border-sky-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-sky-900">
              👥 Protagonisti configurati per questa Serie:
            </span>
            <button
              type="button"
              onClick={onOpenCastModal}
              className="text-xs font-extrabold text-sky-600 hover:underline"
            >
              + Aggiungi o modifica personaggi di questa serie →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {series.cast.map((member) => (
              <div
                key={member.id}
                onClick={onOpenCastModal}
                className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-sky-200 hover:border-sky-400 cursor-pointer transition shadow-sm"
              >
                <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-sky-300 bg-sky-100 flex-shrink-0 flex items-center justify-center">
                  {member.referencePhotos[0] ? (
                    <img
                      src={member.referencePhotos[0]}
                      alt={member.name}
                      className="w-full h-full object-cover"
                    />
                  ) : member.type === 'ANIMAL' ? (
                    <Dog className="w-6 h-6 text-amber-600" />
                  ) : (
                    <User className="w-6 h-6 text-sky-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-slate-800 truncate">{member.name}</div>
                  <div className="text-xs font-bold text-sky-700">
                    {member.type === 'ANIMAL' ? '🐾 Animale (Pensiero)' : '🧑 Umano (Voce)'}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {member.defaultCreditRole}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. ARCHIVIO E GESTIONE PUNTATE DELLA SERIE */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-2xl font-black text-slate-800">
              🎞️ Puntate di &quot;{series.title}&quot; ({series.episodes.length})
            </h3>
            <p className="text-sm text-slate-600">
              Seleziona una puntata per modificarla o guardarla, oppure crea o elimina puntate in
              questa serie
            </p>
          </div>

          <button
            type="button"
            onClick={onCreateNewEpisode}
            className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-base shadow-md hover:shadow-lg transition"
          >
            <Plus className="w-5 h-5" /> + Crea Nuova Puntata in questa Serie
          </button>
        </div>

        {series.episodes.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-sky-300 rounded-2xl p-10 text-center space-y-4">
            <div className="text-lg font-black text-sky-950">
              Nessuna puntata presente in questa serie
            </div>
            <p className="text-sm text-slate-600">
              Hai eliminato tutte le puntate precedenti. Clicca qui sotto per creare una nuova puntata!
            </p>
            <button
              type="button"
              onClick={onCreateNewEpisode}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-sm shadow-md"
            >
              <Plus className="w-5 h-5" /> + Crea Prima Puntata
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {series.episodes.map((ep) => {
              const isReadyToWatch = ep.scenes.length > 0;
              return (
                <div
                  key={ep.id}
                  className="bg-white border-2 border-sky-200 hover:border-sky-400 rounded-2xl p-6 shadow-sm flex flex-col justify-between space-y-4 transition"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-xl bg-sky-500 text-white font-black text-xs">
                          PUNTATA #{ep.episodeNumber}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-sky-50 border border-sky-200 text-xs font-extrabold text-sky-900">
                          <Clock className="w-3.5 h-3.5 text-sky-600" />
                          {ep.targetTotalDurationSec}s ({ep.scenes.length} Scene)
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onDeleteEpisode(ep.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-extrabold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition"
                        title="Elimina questa Puntata"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Elimina Puntata
                      </button>
                    </div>

                    <h4 className="text-xl font-black text-slate-800">{ep.title}</h4>
                    <p className="text-sm text-slate-600 line-clamp-2">
                      {ep.rawIdea || 'Nessuno spunto inserito — clicca su Modifica per iniziare.'}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-sky-100 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectEpisodeToEdit(ep.id, 1)}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-xs text-center transition"
                    >
                      ✏️ ① Durata & Materiale
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectEpisodeToEdit(ep.id, 2)}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-xs text-center transition"
                    >
                      💬 ② Fumetto & Battute
                    </button>
                    {isReadyToWatch && (
                      <button
                        type="button"
                        onClick={() => onSelectEpisodeToEdit(ep.id, 3)}
                        className="py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-extrabold text-xs inline-flex items-center gap-1 shadow-sm transition"
                      >
                        <Play className="w-3.5 h-3.5" /> ③ Guarda
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
