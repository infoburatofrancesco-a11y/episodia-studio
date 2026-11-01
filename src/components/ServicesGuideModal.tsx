import React, { useState } from 'react';
import {
  Settings,
  X,
  CheckCircle2,
  Key,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Cpu
} from 'lucide-react';
import { ApiKeysConfig } from '../types/studio';

interface ServicesGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKeys: ApiKeysConfig;
  onSaveApiKeys: (config: ApiKeysConfig) => void;
}

export const ServicesGuideModal: React.FC<ServicesGuideModalProps> = ({
  isOpen,
  onClose,
  apiKeys,
  onSaveApiKeys
}) => {
  const [form, setForm] = useState<ApiKeysConfig>(apiKeys);
  const [activeTab, setActiveTab] = useState<'STATUS' | 'KEYS' | 'GUIDE'>('STATUS');

  if (!isOpen) return null;

  const hasGemini = form.geminiApiKey.trim().length > 10;
  const hasVeo =
    form.googleCloudProjectId.trim().length > 2 && form.vertexAiAccessToken.trim().length > 15;

  const handleSave = () => {
    onSaveApiKeys(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white border-t-2 sm:border-2 border-sky-200 rounded-t-3xl sm:rounded-2xl shadow-xl w-full max-w-5xl max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-sky-50 border-b border-sky-200 flex-shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 bg-sky-500 text-white rounded-2xl shadow-sm flex-shrink-0">
              <Settings className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-extrabold text-slate-800 truncate">
                ⚙️ Stato Servizi & Chiavi AI
              </h2>
              <p className="text-xs text-slate-600 hidden sm:block">
                Stato dei motori integrati e configurazione delle tue API personali
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-sky-100 rounded-xl flex-shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-3 gap-1.5 px-3 sm:px-6 py-2.5 bg-sky-50/70 border-b border-sky-200 flex-shrink-0">
          <button
            onClick={() => setActiveTab('STATUS')}
            className={`px-2 sm:px-4 py-2 rounded-xl font-extrabold text-xs sm:text-sm transition text-center ${
              activeTab === 'STATUS'
                ? 'bg-sky-500 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-sky-200 hover:bg-sky-100'
            }`}
          >
            📊 Stato AI
          </button>
          <button
            onClick={() => setActiveTab('KEYS')}
            className={`px-2 sm:px-4 py-2 rounded-xl font-extrabold text-xs sm:text-sm transition text-center ${
              activeTab === 'KEYS'
                ? 'bg-sky-500 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-sky-200 hover:bg-sky-100'
            }`}
          >
            🔑 Chiavi API
          </button>
          <button
            onClick={() => setActiveTab('GUIDE')}
            className={`px-2 sm:px-4 py-2 rounded-xl font-extrabold text-xs sm:text-sm transition text-center ${
              activeTab === 'GUIDE'
                ? 'bg-sky-500 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-sky-200 hover:bg-sky-100'
            }`}
          >
            🧭 Guida Setup
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'STATUS' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                <ShieldCheck className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-emerald-900">
                  <strong>Modalità Zero-Block Attiva fin dal Primo Secondo:</strong> Tutte le funzionalità
                  dell&apos;app (Calcolatore tempi al secondo, Estrazione solo audio da video musicali,
                  Storyboard con battute, Voci sintetizzate, Animazione foto Ken Burns + Lip-Sync ed Export
                  Video MP4/WebM a 60fps) sono <strong>già operative al 100% gratuitamente</strong>. Quando
                  incolli la tua chiave Gemini / Vertex AI, l&apos;app passa automaticamente ai modelli Cloud
                  coperti dal tuo piano <strong>Google AI Ultra</strong>.
                </div>
              </div>

              <div className="overflow-x-auto border border-sky-200 rounded-2xl">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-sky-100/80 text-sky-950 font-extrabold border-b border-sky-200">
                      <th className="p-3.5">Servizio / Tecnologia Integrata</th>
                      <th className="p-3.5">Funzione in SkySketch Studio</th>
                      <th className="p-3.5">Stato Attuale</th>
                      <th className="p-3.5">Costo con Piano Google AI Ultra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sky-100">
                    <tr>
                      <td className="p-3.5 font-bold text-slate-800">
                        1. Gemini 2.5 Flash API (Vision + JSON)
                      </td>
                      <td className="p-3.5 text-slate-600">
                        Riconoscimento Cast dai fotogrammi video, calcolo tempi al secondo e copione
                      </td>
                      <td className="p-3.5">
                        {hasGemini ? (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                            ✅ Cloud Attivo
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-bold">
                            ⚡ Motore Locale Smart Attivo
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-700">
                        100% Gratuito (Free Tier AI Studio) / Coperto da Crediti Google AI Ultra
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3.5 font-bold text-slate-800">
                        2. Vertex AI Veo 3.1 (Image-to-Video)
                      </td>
                      <td className="p-3.5 text-slate-600">
                        Generazione clip video 9:16 dalle foto dei protagonisti (Umani e Animali)
                      </td>
                      <td className="p-3.5">
                        {hasVeo ? (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                            ✅ Veo 3.1 Cloud Attivo
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-bold">
                            ⚡ Animatore Canvas Ken Burns + Lip-Sync Attivo
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-semibold text-sky-900">
                        Coperto dai Crediti Mensili Google Cloud inclusi in Google AI Ultra (oltre i crediti: ~$0.35/clip)
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3.5 font-bold text-slate-800">
                        3. Google Cloud TTS / Web Speech & Synth
                      </td>
                      <td className="p-3.5 text-slate-600">
                        Voci espressive in italiano per personaggi e pensieri degli animali
                      </td>
                      <td className="p-3.5">
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                          ✅ Attivo & Pronto
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-700">
                        100% Gratuito (1 Milione caratteri/mese gratis su Cloud TTS + Web Speech nativo)
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3.5 font-bold text-slate-800">
                        4. Web Audio API (Audio Extractor & Auto-Ducking)
                      </td>
                      <td className="p-3.5 text-slate-600">
                        Estrae nel browser solo l&apos;audio da video musicali (.mp4/.mov) e abbassa il volume al 15% durante i dialoghi
                      </td>
                      <td className="p-3.5">
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                          ✅ 100% Nativo Browser
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-700">
                        100% Gratuito (Zero server esterni)
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3.5 font-bold text-slate-800">
                        5. Motore Video 9:16 HTML5 Canvas 60fps + MediaRecorder GPU
                      </td>
                      <td className="p-3.5 text-slate-600">
                        Montaggio Sigla + Video + Foto AI + Sottotitoli + Titoli di Coda ed esportazione MP4
                      </td>
                      <td className="p-3.5">
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                          ✅ 100% Nativo GPU
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-700">
                        100% Gratuito (Illimitato)
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3.5 font-bold text-slate-800">
                        6. Database Locale IndexedDB + LocalStorage
                      </td>
                      <td className="p-3.5 text-slate-600">
                        Salvataggio immediato di Serie, Cast, Foto, Video e Puntate
                      </td>
                      <td className="p-3.5">
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                          ✅ Attivo nel Browser
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-700">
                        100% Gratuito (Nessun abbonamento DB)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'KEYS' && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 space-y-4">
                <div className="flex items-center gap-2 font-extrabold text-sky-900">
                  <Key className="w-5 h-5 text-sky-600" />
                  1. Google Gemini API Key (Consigliata — Attiva subito Gemini 2.5 Flash)
                </div>
                <input
                  type="password"
                  placeholder="Incolla qui la tua chiave AIzaSy... da Google AI Studio"
                  value={form.geminiApiKey}
                  onChange={(e) => setForm({ ...form, geminiApiKey: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border border-sky-300 bg-white font-mono text-sm"
                />
                <p className="text-xs text-slate-600">
                  Usata per analizzare i fotogrammi dei tuoi video, riconoscere Francesco, Zora e Uma e scrivere
                  le battute calibrate al secondo.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-extrabold text-sky-900">
                    <Cpu className="w-5 h-5 text-sky-600" />
                    2. Google Cloud Vertex AI — Veo 3.1 & Cloud TTS (Opzionale — Sfrutta i Crediti Ultra)
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-sky-800">
                    <input
                      type="checkbox"
                      checked={form.preferVeoCloud}
                      onChange={(e) => setForm({ ...form, preferVeoCloud: e.target.checked })}
                      className="w-4 h-4 accent-sky-500"
                    />
                    Usa Veo 3.1 Cloud se configurato
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Google Cloud Project ID
                    </label>
                    <input
                      type="text"
                      placeholder="es. skysketch-ultra-prod"
                      value={form.googleCloudProjectId}
                      onChange={(e) => setForm({ ...form, googleCloudProjectId: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl border border-sky-200 bg-white text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Regione Vertex AI
                    </label>
                    <input
                      type="text"
                      placeholder="us-central1"
                      value={form.googleCloudLocation}
                      onChange={(e) => setForm({ ...form, googleCloudLocation: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl border border-sky-200 bg-white text-sm font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Vertex AI OAuth Bearer Token (per chiamate dirette Veo 3.1 dal browser)
                  </label>
                  <input
                    type="password"
                    placeholder="ya29.a0..."
                    value={form.vertexAiAccessToken}
                    onChange={(e) => setForm({ ...form, vertexAiAccessToken: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-sky-200 bg-white text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Google Cloud Text-to-Speech API Key (Opzionale, se diversa da Gemini Key)
                  </label>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    value={form.cloudTtsApiKey}
                    onChange={(e) => setForm({ ...form, cloudTtsApiKey: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-sky-200 bg-white text-sm font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'GUIDE' && (
            <div className="space-y-4 text-sm text-slate-700">
              <div className="p-5 rounded-2xl bg-sky-50 border border-sky-200 space-y-2">
                <h3 className="font-extrabold text-base text-sky-950 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-sky-500" />
                  Passo 1: Come ottenere la Gemini API Key (30 secondi — Gratis)
                </h3>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    Apri{' '}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-600 font-bold underline inline-flex items-center gap-1"
                    >
                      Google AI Studio (aistudio.google.com/app/apikey){' '}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>{' '}
                    accedendo con il tuo account Google AI Ultra.
                  </li>
                  <li>
                    Clicca sul pulsante blu <strong>&quot;Create API key&quot;</strong>.
                  </li>
                  <li>
                    Copia la stringa che inizia con <code className="bg-white px-1.5 py-0.5 rounded">AIzaSy...</code> e incollala nella scheda{' '}
                    <strong>&quot;🔑 Inserisci Chiavi API Personali&quot;</strong> qui sopra.
                  </li>
                </ol>
              </div>

              <div className="p-5 rounded-2xl bg-sky-50 border border-sky-200 space-y-2">
                <h3 className="font-extrabold text-base text-sky-950 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-sky-500" />
                  Passo 2: Come riscattare i Crediti Cloud del tuo piano Google AI Ultra per Veo 3.1
                </h3>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    Visita il tuo profilo{' '}
                    <a
                      href="https://developers.google.com/profile/u/0/dashboard"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-600 font-bold underline inline-flex items-center gap-1"
                    >
                      Google Developer Program Premium Dashboard{' '}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>{' '}
                    incluso in Google AI Ultra e copia i tuoi crediti mensili Google Cloud.
                  </li>
                  <li>
                    Apri la{' '}
                    <a
                      href="https://console.cloud.google.com/vertex-ai/model-garden"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-600 font-bold underline inline-flex items-center gap-1"
                    >
                      Console Google Cloud Vertex AI <ExternalLink className="w-3.5 h-3.5" />
                    </a>{' '}
                    e abilita l&apos;API <strong>Vertex AI API</strong> e <strong>Cloud Text-to-Speech API</strong>.
                  </li>
                  <li>
                    Inserisci il tuo <strong>Project ID</strong> nella scheda Chiavi. Finché non lo inserisci,
                    SkySketch Studio usa automaticamente il <strong>Motore Locale Canvas 60fps</strong> senza alcun
                    blocco!
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 px-4 sm:px-6 py-3.5 bg-sky-50 border-t border-sky-200 flex-shrink-0">
          <div className="hidden sm:block text-xs font-semibold text-slate-600">
            Le chiavi vengono salvate esclusivamente in locale nel tuo browser (`localStorage`).
          </div>
          <div className="flex gap-2.5 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 py-3 rounded-2xl bg-sky-100 text-sky-800 hover:bg-sky-200 font-extrabold text-xs sm:text-sm text-center"
            >
              Chiudi
            </button>
            <button
              onClick={handleSave}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-black text-xs sm:text-sm shadow-sm"
            >
              <CheckCircle2 className="w-4 h-4" /> Salva Configurazione API
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
