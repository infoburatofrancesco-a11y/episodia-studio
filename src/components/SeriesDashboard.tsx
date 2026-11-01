import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Users,
  Film,
  Sparkles,
  Check,
  X,
  Upload,
  Dog,
  User
} from 'lucide-react';
import {
  Series,
  CastMember,
  CastType,
  SeriesGenreStyle,
  SERIES_GENRE_STYLES
} from '../types/studio';
import { fileToDataUrl } from '../services/audioExtractorService';

interface SeriesDashboardProps {
  seriesList: Series[];
  onSelectSeries: (seriesId: string) => void;
  onCreateSeries: (newSeries: Series) => void;
  onDeleteSeries: (seriesId: string) => void;
  onExportBackup?: () => void;
  onImportBackup?: (file: File) => void;
}

export const SeriesDashboard: React.FC<SeriesDashboardProps> = ({
  seriesList,
  onSelectSeries,
  onCreateSeries,
  onDeleteSeries,
  onExportBackup,
  onImportBackup
}) => {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genreStyle, setGenreStyle] = useState<SeriesGenreStyle>('COMEDY');
  const [customStylePrompt, setCustomStylePrompt] = useState('');
  const [introSec, setIntroSec] = useState(3.0);
  const [outroSec, setOutroSec] = useState(4.0);
  const [introSecInput, setIntroSecInput] = useState('3');
  const [outroSecInput, setOutroSecInput] = useState('4');
  const [themeColor, setThemeColor] = useState('#0284c7');
  const [draftCast, setDraftCast] = useState<CastMember[]>([
    {
      id: `cast-init-1`,
      name: 'Protagonista 1',
      type: 'HUMAN',
      referencePhotos: [],
      personalityPrompt: 'Simpatico, ironico ed espressivo.',
      voiceConfig: {
        voiceName: 'it-IT-Wavenet-C',
        pitch: 1.0,
        speed: 1.05,
        stylePrompt: 'Tono colloquiale brillante'
      },
      subtitleStyle: {
        textColor: '#0c4a6e',
        bgColor: '#e0f2fe',
        badgeText: '🗣️ Protagonista 1:'
      },
      defaultCreditRole: 'Ideatore & Protagonista',
      memoryGags: []
    }
  ]);

  const handleOpenNewSeriesWizard = () => {
    setTitle('');
    setDescription('');
    setGenreStyle('COMEDY');
    setCustomStylePrompt('');
    setIntroSec(3.0);
    setOutroSec(4.0);
    setIntroSecInput('3');
    setOutroSecInput('4');
    setThemeColor('#0284c7');
    setDraftCast([
      {
        id: `cast-${Date.now()}-1`,
        name: 'Protagonista 1',
        type: 'HUMAN',
        referencePhotos: [],
        personalityPrompt: 'Simpatico, ironico ed espressivo.',
        voiceConfig: {
          voiceName: 'it-IT-Wavenet-C',
          pitch: 1.0,
          speed: 1.05,
          stylePrompt: 'Tono colloquiale'
        },
        subtitleStyle: {
          textColor: '#0c4a6e',
          bgColor: '#e0f2fe',
          badgeText: '🗣️ Parla:'
        },
        defaultCreditRole: 'Protagonista Principale',
        memoryGags: []
      }
    ]);
    setIsWizardOpen(true);
  };

  const handleAddDraftCast = (type: CastType) => {
    const isAnimal = type === 'ANIMAL';
    const idx = draftCast.length + 1;
    setDraftCast((prev) => [
      ...prev,
      {
        id: `cast-${Date.now()}-${idx}`,
        name: isAnimal ? `Animale ${idx}` : `Personaggio ${idx}`,
        type,
        referencePhotos: [],
        personalityPrompt: isAnimal
          ? 'Buffo, goloso e pieno di pensieri segreti divertenti.'
          : 'Ironico, espressivo e complice delle gag.',
        voiceConfig: {
          voiceName: isAnimal ? 'it-IT-Wavenet-B' : 'it-IT-Wavenet-A',
          pitch: isAnimal ? 1.2 : 1.0,
          speed: 1.05,
          stylePrompt: isAnimal ? 'Voce allegra e buffa' : 'Voce naturale'
        },
        subtitleStyle: {
          textColor: isAnimal ? '#78350f' : '#0c4a6e',
          bgColor: isAnimal ? '#fef3c7' : '#e0f2fe',
          badgeText: isAnimal ? '🐕 Pensiero:' : '🗣️ Parla:'
        },
        defaultCreditRole: isAnimal ? 'Special Guest a 4 Zampe' : 'Co-Protagonista',
        memoryGags: []
      }
    ]);
  };

  const handlePhotoUploadForDraft = async (memberId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const dataUrl = await fileToDataUrl(files[0]);
    setDraftCast((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, referencePhotos: [dataUrl] } : m))
    );
  };

  const handleConfirmCreateSeries = () => {
    const cleanTitle = title.trim() || `Nuova Serie TV #${seriesList.length + 1}`;
    const presetObj =
      SERIES_GENRE_STYLES.find((g) => g.id === genreStyle) || SERIES_GENRE_STYLES[0];
    const cleanDesc =
      description.trim() ||
      `Serie ${presetObj.label} creata in SkySketch Studio.`;

    const finalizedCast = draftCast.map((c) => ({
      ...c,
      subtitleStyle: {
        ...c.subtitleStyle,
        badgeText:
          c.type === 'ANIMAL' ? `🐕 Pensiero di ${c.name}:` : `🗣️ ${c.name}:`
      }
    }));

    const firstEpId = `ep-${Date.now()}`;
    const newSeries: Series = {
      id: `series-${Date.now()}`,
      title: cleanTitle,
      description: cleanDesc,
      genreStyle,
      customStylePrompt: customStylePrompt.trim() || presetObj.shortDesc,
      cast: finalizedCast,
      branding: {
        introEnabled: true,
        introDurationSec: introSec,
        introBgVideoOrImage: '',
        introJingleUrl: '',
        introThemeColor: themeColor,
        outroEnabled: true,
        outroDurationSec: outroSec,
        autoListDetectedCast: true,
        aiFunnyRoles: true,
        footerText: `Guarda tutte le puntate di "${cleanTitle}" • Seguici!`
      },
      episodes: [
        {
          id: firstEpId,
          episodeNumber: 1,
          title: 'Puntata #1 — Il Debutto',
          rawIdea: `Primo episodio in stile ${presetObj.label} della serie "${cleanTitle}" con ${finalizedCast
            .map((c) => c.name)
            .join(', ')}.`,
          targetTotalDurationSec: 60,
          netContentDurationSec: Math.max(10, Math.round(60 - introSec - outroSec)),
          detectedCastIds: finalizedCast.map((c) => c.id),
          funnyRolesByCastId: {},
          uploadedMedia: [],
          scenes: finalizedCast.map((c, idx) => ({
            id: `scene-init-${Date.now()}-${idx}`,
            order: idx + 1,
            sceneType: 'AI_PHOTO_VIDEO',
            characterId: c.id,
            durationSec: Math.floor((60 - introSec - outroSec) / finalizedCast.length),
            dialogueOrThought:
              c.type === 'ANIMAL'
                ? `Benvenuti nella nostra nuova serie! Io sono ${c.name} e ho già fame!`
                : `Ciao a tutti! Io sono ${c.name} e questa è la prima puntata di ${cleanTitle}!`,
            aiPhotoSourceUrl: c.referencePhotos[0] || '',
            veoMotionPrompt: 'Expressive introduction looking at camera in 9:16',
            status: 'READY'
          }))
        }
      ]
    };

    onCreateSeries(newSeries);
    setIsWizardOpen(false);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* HERO BANNER CHIARO E GUIDATO */}
      <div className="bg-white border-2 border-sky-200 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-extrabold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> Livello 1 di 3 • I Tuoi Progetti / Serie TV
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800">
            📺 Scegli una Serie esistente o crea un Nuovo Progetto
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Ogni <strong>Progetto (Serie)</strong> ha il suo <strong>Cast di Personaggi</strong>{' '}
            dedicato (Umani e Animali), la sua <strong>Sigla</strong> e l&apos;archivio di tutte le
            sue <strong>Puntate</strong>. Clicca su una serie qui sotto per aprirla!
          </p>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full md:w-auto">
          {onExportBackup && (
            <button
              type="button"
              onClick={onExportBackup}
              className="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-xs sm:text-sm transition"
              title="Salva un file di backup con tutte le Serie, i Personaggi e i Campioni Voce per passarli dal PC al Telefono"
            >
              💾 Esporta Backup (PC ↔ Telefono)
            </button>
          )}
          {onImportBackup && (
            <label className="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-extrabold text-xs sm:text-sm cursor-pointer transition">
              📂 Carica Backup
              <input
                type="file"
                accept=".json"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    onImportBackup(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
            </label>
          )}
          <button
            type="button"
            onClick={handleOpenNewSeriesWizard}
            className="inline-flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-sm sm:text-base shadow-md hover:shadow-lg transition flex-shrink-0"
          >
            <Plus className="w-5 h-5" /> + Crea Nuovo Progetto (Serie)
          </button>
        </div>
      </div>

      {/* GRIGLIA DELLE SERIE */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {seriesList.map((series) => {
          const genrePreset =
            SERIES_GENRE_STYLES.find((g) => g.id === (series.genreStyle || 'COMEDY')) ||
            SERIES_GENRE_STYLES[0];
          return (
            <div
              key={series.id}
              onClick={() => onSelectSeries(series.id)}
              className="group bg-white border-2 border-sky-200 hover:border-sky-500 rounded-2xl p-6 shadow-sm hover:shadow-md transition cursor-pointer flex flex-col justify-between space-y-5"
            >
              <div className="space-y-4">
                {/* Top badge + genre badge + delete always visible */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      style={{ backgroundColor: series.branding.introThemeColor || '#0284c7' }}
                      className="px-3 py-1 rounded-xl text-white font-extrabold text-xs uppercase tracking-wider shadow-sm"
                    >
                      🎬 {series.episodes.length}{' '}
                      {series.episodes.length === 1 ? 'Puntata' : 'Puntate'}
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-xl border text-xs font-extrabold ${genrePreset.badgeColor}`}
                    >
                      {genrePreset.emoji} {genrePreset.label}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSeries(series.id);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-extrabold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition"
                    title="Elimina questa Serie"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Elimina Serie
                  </button>
                </div>

                <div>
                  <h3 className="text-xl font-black text-slate-800 group-hover:text-sky-600 transition">
                    {series.title}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1 line-clamp-2">{series.description}</p>
                </div>

                {/* Cast Avatars Strip */}
                <div className="pt-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-sky-800 mb-2 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-sky-500" />
                    Cast della Serie ({series.cast.length} Protagonisti):
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {series.cast.map((member) => (
                      <div
                        key={member.id}
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-sky-50 border border-sky-200"
                      >
                        <div className="w-7 h-7 rounded-full overflow-hidden bg-sky-200 flex items-center justify-center flex-shrink-0">
                          {member.referencePhotos[0] ? (
                            <img
                              src={member.referencePhotos[0]}
                              alt={member.name}
                              className="w-full h-full object-cover"
                            />
                          ) : member.type === 'ANIMAL' ? (
                            <Dog className="w-4 h-4 text-amber-700" />
                          ) : (
                            <User className="w-4 h-4 text-sky-700" />
                          )}
                        </div>
                        <span className="text-xs font-extrabold text-slate-800">{member.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-sky-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                  <Film className="w-3.5 h-3.5 text-sky-500" />
                  Sigla {series.branding.introDurationSec}s + Coda {series.branding.outroDurationSec}s
                </span>
                <span className="px-4 py-2 rounded-xl bg-sky-500 group-hover:bg-sky-600 text-white font-extrabold text-xs shadow-sm transition">
                  Apri Serie & Puntate →
                </span>
              </div>
            </div>
          );
        })}

        {/* Card "+ Crea Nuova Serie" */}
        <button
          type="button"
          onClick={handleOpenNewSeriesWizard}
          className="border-2 border-dashed border-sky-300 hover:border-sky-500 bg-sky-50/60 hover:bg-sky-100/60 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-3 transition min-h-[260px]"
        >
          <div className="w-14 h-14 rounded-2xl bg-sky-500 text-white flex items-center justify-center shadow-sm">
            <Plus className="w-8 h-8" />
          </div>
          <div className="font-black text-lg text-sky-950">
            + Crea un Nuovo Progetto (Nuova Serie)
          </div>
          <p className="text-xs text-slate-600 max-w-xs">
            Definisci il titolo della nuova serie, lo stile (Comedy, Romantico, Horror/Thriller...) e
            aggiungi i protagonisti
          </p>
        </button>
      </div>

      {/* MODALE WIZARD CREAZIONE NUOVO PROGETTO / SERIE (OTTIMIZZATO PER TELEFONO E PC) */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white border-t-2 sm:border-2 border-sky-200 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-sky-50 border-b border-sky-200">
              <div className="min-w-0 pr-2">
                <h2 className="text-base sm:text-xl font-black text-slate-800 truncate">
                  ✨ Crea Nuovo Progetto (Nuova Serie TV)
                </h2>
                <p className="text-xs text-slate-600">
                  Imposta nome, stile/genere della serie, sigla e definisci i protagonisti
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsWizardOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-800 rounded-xl flex-shrink-0"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* 1. Dati Generali Serie */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-extrabold uppercase text-sky-900 mb-1">
                    1. Titolo della Serie / Progetto
                  </label>
                  <input
                    type="text"
                    placeholder="Es. Le Avventure di Leo & Mia"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-sky-200 font-bold text-slate-800 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold uppercase text-sky-900 mb-1">
                    Descrizione / Tema della Serie
                  </label>
                  <input
                    type="text"
                    placeholder="Es. Gag quotidiane, misteri in salotto o avventure romantiche"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-sky-200 text-sm text-slate-700 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* 1B. GENERE E STILE DELLA SERIE */}
              <div className="p-4 rounded-2xl bg-sky-50/80 border-2 border-sky-200 space-y-3">
                <div>
                  <label className="block text-xs font-extrabold uppercase text-sky-900">
                    🎭 Stile & Genere della Serie (Guida Regia, Battute e Montaggio AI)
                  </label>
                  <p className="text-xs text-slate-600">
                    Scegli l&apos;atmosfera della serie: l&apos;AI adatterà dialoghi, tono, inquadrature e ritmo delle puntate!
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {SERIES_GENRE_STYLES.map((preset) => {
                    const isSelected = genreStyle === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setGenreStyle(preset.id);
                          if (!customStylePrompt.trim()) {
                            setCustomStylePrompt(preset.shortDesc);
                          }
                        }}
                        className={`p-3 rounded-2xl border-2 text-left transition flex flex-col justify-between gap-1 ${
                          isSelected
                            ? 'bg-sky-600 text-white border-sky-700 shadow-sm'
                            : 'bg-white hover:bg-sky-50 text-slate-800 border-sky-200'
                        }`}
                      >
                        <div className="font-extrabold text-xs sm:text-sm flex items-center justify-between gap-1">
                          <span>
                            {preset.emoji} {preset.label}
                          </span>
                          {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                        </div>
                        <p
                          className={`text-[11px] leading-snug ${
                            isSelected ? 'text-sky-100' : 'text-slate-500'
                          }`}
                        >
                          {preset.shortDesc}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="block text-[11px] font-extrabold uppercase text-sky-900 mb-1">
                    Note di Stile / Atmosfera Personalizzata per il Regista AI (Opzionale)
                  </label>
                  <input
                    type="text"
                    value={customStylePrompt}
                    onChange={(e) => setCustomStylePrompt(e.target.value)}
                    placeholder="Es. Stile thriller misterioso ma con finale comico, oppure romantico da film..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-sky-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* 2. Sigla & Coda predefinite */}
              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-sky-900 mb-1">
                    🎬 Durata Sigla Apertura (sec)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(0.5, Math.round((introSec - 1) * 10) / 10);
                        setIntroSec(next);
                        setIntroSecInput(String(next));
                      }}
                      className="w-9 h-10 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-black"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="0.5"
                      max="120"
                      step="0.5"
                      value={introSecInput}
                      onChange={(e) => {
                        setIntroSecInput(e.target.value);
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v >= 0) setIntroSec(v);
                      }}
                      onBlur={() => {
                        const valid = Math.max(0.5, parseFloat(introSecInput) || 3);
                        setIntroSec(valid);
                        setIntroSecInput(String(valid));
                      }}
                      className="w-full px-3 py-2 rounded-xl border-2 border-sky-200 focus:border-sky-500 focus:outline-none font-extrabold text-center bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(0.5, Math.round((introSec + 1) * 10) / 10);
                        setIntroSec(next);
                        setIntroSecInput(String(next));
                      }}
                      className="w-9 h-10 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-black"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-sky-900 mb-1">
                    🏁 Durata Titoli di Coda (sec)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(0.5, Math.round((outroSec - 1) * 10) / 10);
                        setOutroSec(next);
                        setOutroSecInput(String(next));
                      }}
                      className="w-9 h-10 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-black"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="0.5"
                      max="120"
                      step="0.5"
                      value={outroSecInput}
                      onChange={(e) => {
                        setOutroSecInput(e.target.value);
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v >= 0) setOutroSec(v);
                      }}
                      onBlur={() => {
                        const valid = Math.max(0.5, parseFloat(outroSecInput) || 4);
                        setOutroSec(valid);
                        setOutroSecInput(String(valid));
                      }}
                      className="w-full px-3 py-2 rounded-xl border-2 border-sky-200 focus:border-sky-500 focus:outline-none font-extrabold text-center bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(0.5, Math.round((outroSec + 1) * 10) / 10);
                        setOutroSec(next);
                        setOutroSecInput(String(next));
                      }}
                      className="w-9 h-10 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-black"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-sky-900 mb-1">
                    🎨 Colore Tema Serie
                  </label>
                  <input
                    type="color"
                    value={themeColor}
                    onChange={(e) => setThemeColor(e.target.value)}
                    className="w-full h-10 rounded-xl border border-sky-200 cursor-pointer bg-white"
                  />
                </div>
              </div>

              {/* 3. Definisci il Cast di questa Serie */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-slate-800">
                      👥 2. Definisci i Personaggi di questa Serie ({draftCast.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Aggiungi gli umani e gli animali protagonisti di questa serie (potrai modificarli anche dopo)
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddDraftCast('HUMAN')}
                      className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" /> + Aggiungi Umano
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDraftCast('ANIMAL')}
                      className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" /> + Aggiungi Animale
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {draftCast.map((member, idx) => (
                    <div
                      key={member.id}
                      className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
                    >
                      {/* Photo upload */}
                      <div className="sm:col-span-2 flex items-center gap-2">
                        <label className="w-16 h-16 rounded-2xl border-2 border-dashed border-sky-300 bg-white hover:bg-sky-50 flex flex-col items-center justify-center cursor-pointer overflow-hidden flex-shrink-0">
                          {member.referencePhotos[0] ? (
                            <img
                              src={member.referencePhotos[0]}
                              alt={member.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <>
                              <Upload className="w-4 h-4 text-sky-500" />
                              <span className="text-[10px] font-bold text-sky-700">Foto</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handlePhotoUploadForDraft(member.id, e.target.files)}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Name & Type */}
                      <div className="sm:col-span-4 space-y-1">
                        <label className="text-[11px] font-bold text-sky-900">
                          Nome Personaggio #{idx + 1}
                        </label>
                        <input
                          type="text"
                          value={member.name}
                          onChange={(e) =>
                            setDraftCast((prev) =>
                              prev.map((m) =>
                                m.id === member.id ? { ...m, name: e.target.value } : m
                              )
                            )
                          }
                          className="w-full px-3 py-2 rounded-xl border border-sky-200 font-bold text-sm bg-white"
                        />
                        <div className="flex gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftCast((prev) =>
                                prev.map((m) =>
                                  m.id === member.id ? { ...m, type: 'HUMAN' } : m
                                )
                              )
                            }
                            className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${
                              member.type === 'HUMAN'
                                ? 'bg-sky-500 text-white'
                                : 'bg-white text-slate-600 border border-sky-200'
                            }`}
                          >
                            🧑 Umano
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraftCast((prev) =>
                                prev.map((m) =>
                                  m.id === member.id ? { ...m, type: 'ANIMAL' } : m
                                )
                              )
                            }
                            className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${
                              member.type === 'ANIMAL'
                                ? 'bg-amber-500 text-white'
                                : 'bg-white text-slate-600 border border-sky-200'
                            }`}
                          >
                            🐾 Animale
                          </button>
                        </div>
                      </div>

                      {/* Personality */}
                      <div className="sm:col-span-5 space-y-1">
                        <label className="text-[11px] font-bold text-sky-900">
                          Carattere / Umorismo
                        </label>
                        <input
                          type="text"
                          value={member.personalityPrompt}
                          onChange={(e) =>
                            setDraftCast((prev) =>
                              prev.map((m) =>
                                m.id === member.id
                                  ? { ...m, personalityPrompt: e.target.value }
                                  : m
                              )
                            )
                          }
                          className="w-full px-3 py-2 rounded-xl border border-sky-200 text-xs bg-white"
                        />
                      </div>

                      {/* Delete */}
                      <div className="sm:col-span-1 flex justify-end">
                        {draftCast.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setDraftCast((prev) => prev.filter((m) => m.id !== member.id))
                            }
                            className="p-2 text-slate-400 hover:text-rose-600 rounded-xl"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 px-4 sm:px-6 py-3.5 bg-sky-50 border-t border-sky-200">
              <button
                type="button"
                onClick={() => setIsWizardOpen(false)}
                className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-sky-100 text-sky-800 font-extrabold text-sm text-center"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleConfirmCreateSeries}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-sm shadow-sm"
              >
                <Check className="w-4 h-4" /> Crea Serie e Vai alle Puntate →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
