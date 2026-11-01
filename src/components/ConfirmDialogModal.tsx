import React from 'react';
import { Trash2, Check, X, Sparkles } from 'lucide-react';

export interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  itemHighlight?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'info';
  hideCancel?: boolean;
  onConfirm: () => void;
}

interface ConfirmDialogModalProps {
  dialog: ConfirmDialogState | null;
  onClose: () => void;
}

export const ConfirmDialogModal: React.FC<ConfirmDialogModalProps> = ({ dialog, onClose }) => {
  if (!dialog || !dialog.isOpen) return null;

  const isDanger = (dialog.variant || 'danger') === 'danger';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/65 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border-2 border-sky-200 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Banner */}
        <div
          className={`px-5 py-4 flex items-center justify-between border-b ${
            isDanger
              ? 'bg-rose-50 border-rose-200'
              : 'bg-sky-50 border-sky-200'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-sm flex-shrink-0 ${
                isDanger ? 'bg-rose-600' : 'bg-sky-500'
              }`}
            >
              {isDanger ? <Trash2 className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-800 leading-tight truncate">
              {dialog.title}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/80 transition flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 sm:p-6 space-y-4">
          <p className="text-sm sm:text-base text-slate-700 leading-relaxed font-medium">
            {dialog.message}
          </p>

          {dialog.itemHighlight && (
            <div
              className={`p-3.5 rounded-2xl border font-extrabold text-sm break-words ${
                isDanger
                  ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                  : 'bg-sky-50/70 border-sky-200 text-sky-950'
              }`}
            >
              {dialog.itemHighlight}
            </div>
          )}

          {isDanger && (
            <p className="text-xs font-bold text-rose-600">
              ⚠️ Questa operazione è immediata e non può essere annullata.
            </p>
          )}
        </div>

        {/* Action Buttons — Mobile First (Stacked on small phones, side-by-side on larger screens) */}
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          {!dialog.hideCancel && (
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-white hover:bg-slate-100 text-slate-700 border-2 border-slate-200 font-extrabold text-sm text-center transition"
            >
              {dialog.cancelLabel || 'Annulla'}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              dialog.onConfirm();
              onClose();
            }}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-black text-sm shadow-md transition ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-sky-500 hover:bg-sky-600'
            }`}
          >
            {isDanger ? <Trash2 className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>{dialog.confirmLabel || (isDanger ? 'Sì, Elimina Ora' : 'Conferma')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
