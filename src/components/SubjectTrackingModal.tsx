import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Check, X, RotateCcw, Sparkles, Video, Image as ImageIcon } from 'lucide-react';
import { CastMember, CharacterBoundingBox } from '../types/studio';

interface SubjectTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaTitle: string;
  mediaType: 'PHOTO' | 'VIDEO';
  mediaUrl: string;
  fallbackImageUrl?: string;
  cast: CastMember[];
  selectedCharacterIds: string[];
  initialActiveCharacterId?: string;
  characterBoxes?: Record<string, CharacterBoundingBox>;
  initialBoxes?: Record<string, CharacterBoundingBox>;
  onSaveTracking?: (
    updatedCharacterIds: string[],
    updatedBoxes: Record<string, CharacterBoundingBox>
  ) => void;
  onSaveBoxes?: (updatedBoxes: Record<string, CharacterBoundingBox>) => void;
}

const TRACKING_COLORS = [
  { border: '#facc15', bg: 'rgba(250, 204, 21, 0.16)', badge: 'bg-amber-400 text-slate-950' },
  { border: '#f472b6', bg: 'rgba(244, 114, 182, 0.16)', badge: 'bg-pink-400 text-slate-950' },
  { border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.16)', badge: 'bg-sky-400 text-slate-950' },
  { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.16)', badge: 'bg-purple-400 text-white' },
  { border: '#34d399', bg: 'rgba(52, 211, 153, 0.16)', badge: 'bg-emerald-400 text-slate-950' }
];

function createDefaultBoxForIndex(idx: number, total: number, charId?: string): CharacterBoundingBox {
  if (total <= 1) {
    return {
      characterId: charId,
      x: 0.22,
      y: 0.14,
      width: 0.56,
      height: 0.68,
      mouthX: 0.5,
      mouthY: 0.54
    };
  }
  const slotW = Math.min(0.44, 0.88 / total);
  const gap = (1 - slotW * total) / (total + 1);
  const x = gap + idx * (slotW + gap);
  const y = 0.16;
  const height = 0.66;
  return {
    characterId: charId,
    x: Number(x.toFixed(3)),
    y,
    width: Number(slotW.toFixed(3)),
    height,
    mouthX: Number((x + slotW * 0.5).toFixed(3)),
    mouthY: Number((y + height * 0.6).toFixed(3))
  };
}

type GestureAction =
  | 'NONE'
  | 'MOVE_BOX'
  | 'RESIZE_TL'
  | 'RESIZE_TR'
  | 'RESIZE_BL'
  | 'RESIZE_BR'
  | 'DRAW_NEW_BOX'
  | 'MOVE_MOUTH';

export const SubjectTrackingModal: React.FC<SubjectTrackingModalProps> = ({
  isOpen,
  onClose,
  mediaTitle,
  mediaType,
  mediaUrl,
  fallbackImageUrl,
  cast,
  selectedCharacterIds,
  initialActiveCharacterId,
  characterBoxes,
  initialBoxes,
  onSaveTracking,
  onSaveBoxes
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const sourceBoxes = characterBoxes || initialBoxes;

  const [presentIds, setPresentIds] = useState<string[]>(
    selectedCharacterIds.length > 0 ? selectedCharacterIds : cast[0] ? [cast[0].id] : []
  );
  const [activeCharId, setActiveCharId] = useState<string>(
    initialActiveCharacterId || selectedCharacterIds[0] || cast[0]?.id || ''
  );
  const [boxes, setBoxes] = useState<Record<string, CharacterBoundingBox>>({});
  const [touchToolMode, setTouchToolMode] = useState<'BOX' | 'MOUTH'>('BOX');
  const [gestureAction, setGestureAction] = useState<GestureAction>('NONE');
  const [gestureStart, setGestureStart] = useState<{
    ptX: number;
    ptY: number;
    box: CharacterBoundingBox;
  } | null>(null);

  // Exact media aspect ratio so the touch surface matches 100% of the photo/video without black bars
  const [mediaAspect, setMediaAspect] = useState<number>(9 / 12);
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [videoSeekSec, setVideoSeekSec] = useState<number>(0.5);

  useEffect(() => {
    if (!isOpen) return;
    const initIds =
      selectedCharacterIds.length > 0 ? selectedCharacterIds : cast[0] ? [cast[0].id] : [];
    setPresentIds(initIds);
    const targetActive =
      initialActiveCharacterId && initIds.includes(initialActiveCharacterId)
        ? initialActiveCharacterId
        : initIds[0] || cast[0]?.id || '';
    setActiveCharId(targetActive);
    setTouchToolMode('BOX');

    const nextBoxes: Record<string, CharacterBoundingBox> = { ...(sourceBoxes || {}) };
    initIds.forEach((id, idx) => {
      if (!nextBoxes[id]) {
        nextBoxes[id] = createDefaultBoxForIndex(idx, initIds.length, id);
      }
    });
    setBoxes(nextBoxes);
  }, [isOpen, selectedCharacterIds, initialActiveCharacterId, sourceBoxes, cast]);

  if (!isOpen) return null;

  const getColorForCharacter = (charId: string) => {
    const idx = Math.max(0, cast.findIndex((c) => c.id === charId));
    return TRACKING_COLORS[idx % TRACKING_COLORS.length];
  };

  const getNormalizedPointer = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
    const x = Math.max(0.01, Math.min(0.99, (clientX - rect.left) / rect.width));
    const y = Math.max(0.01, Math.min(0.99, (clientY - rect.top) / rect.height));
    return { x, y };
  };

  const clampBox = (b: CharacterBoundingBox, charId: string): CharacterBoundingBox => {
    const width = Math.max(0.14, Math.min(0.96, b.width));
    const height = Math.max(0.14, Math.min(0.96, b.height));
    const x = Math.max(0.02, Math.min(0.98 - width, b.x));
    const y = Math.max(0.02, Math.min(0.98 - height, b.y));
    const mouthX = Math.max(
      x + 0.02,
      Math.min(x + width - 0.02, b.mouthX ?? x + width * 0.5)
    );
    const mouthY = Math.max(
      y + 0.02,
      Math.min(y + height - 0.02, b.mouthY ?? y + height * 0.6)
    );
    return {
      characterId: charId,
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      width: Number(width.toFixed(3)),
      height: Number(height.toFixed(3)),
      mouthX: Number(mouthX.toFixed(3)),
      mouthY: Number(mouthY.toFixed(3))
    };
  };

  const handleSelectOrToggleCharacter = (charId: string) => {
    if (!presentIds.includes(charId)) {
      const nextIds = [...presentIds, charId];
      setPresentIds(nextIds);
      setActiveCharId(charId);
      if (!boxes[charId]) {
        setBoxes((prev) => ({
          ...prev,
          [charId]: createDefaultBoxForIndex(nextIds.length - 1, nextIds.length, charId)
        }));
      }
    } else {
      setActiveCharId(charId);
    }
  };

  const handleRemoveCharacterFromScene = (charId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (presentIds.length <= 1) return;
    const nextIds = presentIds.filter((id) => id !== charId);
    setPresentIds(nextIds);
    if (activeCharId === charId) {
      setActiveCharId(nextIds[0] || '');
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeCharId) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on older mobile browsers
    }

    const pt = getNormalizedPointer(e.clientX, e.clientY);
    const currentBox =
      boxes[activeCharId] || createDefaultBoxForIndex(0, 1, activeCharId);

    // 1. If user is in MOUTH tool mode, or touched near the 👄 icon (generous 9% touch radius for mobile fingers!)
    const mx = currentBox.mouthX ?? currentBox.x + currentBox.width * 0.5;
    const my = currentBox.mouthY ?? currentBox.y + currentBox.height * 0.6;
    const distToMouth = Math.hypot(pt.x - mx, pt.y - my);

    if (touchToolMode === 'MOUTH' || distToMouth < 0.085) {
      setGestureAction('MOVE_MOUTH');
      setGestureStart({ ptX: pt.x, ptY: pt.y, box: currentBox });
      setBoxes((prev) => ({
        ...prev,
        [activeCharId]: {
          ...currentBox,
          mouthX: Number(pt.x.toFixed(3)),
          mouthY: Number(pt.y.toFixed(3))
        }
      }));
      return;
    }

    // 2. Check if user touched one of the 4 corner resize handles of the active box (generous 8% radius for mobile fingers!)
    const cornerRadius = 0.085;
    if (Math.hypot(pt.x - currentBox.x, pt.y - currentBox.y) < cornerRadius) {
      setGestureAction('RESIZE_TL');
      setGestureStart({ ptX: pt.x, ptY: pt.y, box: currentBox });
      return;
    }
    if (
      Math.hypot(pt.x - (currentBox.x + currentBox.width), pt.y - currentBox.y) <
      cornerRadius
    ) {
      setGestureAction('RESIZE_TR');
      setGestureStart({ ptX: pt.x, ptY: pt.y, box: currentBox });
      return;
    }
    if (
      Math.hypot(pt.x - currentBox.x, pt.y - (currentBox.y + currentBox.height)) <
      cornerRadius
    ) {
      setGestureAction('RESIZE_BL');
      setGestureStart({ ptX: pt.x, ptY: pt.y, box: currentBox });
      return;
    }
    if (
      Math.hypot(
        pt.x - (currentBox.x + currentBox.width),
        pt.y - (currentBox.y + currentBox.height)
      ) < cornerRadius
    ) {
      setGestureAction('RESIZE_BR');
      setGestureStart({ ptX: pt.x, ptY: pt.y, box: currentBox });
      return;
    }

    // 3. Check if user touched inside ANOTHER character's box to switch active character
    const insideCurrent =
      pt.x >= currentBox.x &&
      pt.x <= currentBox.x + currentBox.width &&
      pt.y >= currentBox.y &&
      pt.y <= currentBox.y + currentBox.height;

    if (!insideCurrent) {
      for (const otherId of presentIds) {
        if (otherId === activeCharId) continue;
        const ob = boxes[otherId];
        if (
          ob &&
          pt.x >= ob.x &&
          pt.x <= ob.x + ob.width &&
          pt.y >= ob.y &&
          pt.y <= ob.y + ob.height
        ) {
          setActiveCharId(otherId);
          setGestureAction('MOVE_BOX');
          setGestureStart({ ptX: pt.x, ptY: pt.y, box: ob });
          return;
        }
      }
    }

    // 4. If touched inside the active box: smoothly DRAG/MOVE the whole box!
    if (insideCurrent) {
      setGestureAction('MOVE_BOX');
      setGestureStart({ ptX: pt.x, ptY: pt.y, box: currentBox });
      return;
    }

    // 5. If tapped/dragged OUTSIDE the active box:
    // Immediately center the box on the tapped point (so a single tap on mobile positions the subject!)
    // AND if the user keeps dragging, allow drawing a custom box!
    const centeredBox = clampBox(
      {
        ...currentBox,
        x: pt.x - currentBox.width / 2,
        y: pt.y - currentBox.height / 2,
        mouthX: pt.x,
        mouthY: pt.y + currentBox.height * 0.08
      },
      activeCharId
    );
    setBoxes((prev) => ({
      ...prev,
      [activeCharId]: centeredBox
    }));
    setGestureAction('DRAW_NEW_BOX');
    setGestureStart({ ptX: pt.x, ptY: pt.y, box: centeredBox });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gestureAction === 'NONE' || !activeCharId || !gestureStart) return;
    e.preventDefault();
    const pt = getNormalizedPointer(e.clientX, e.clientY);
    const dx = pt.x - gestureStart.ptX;
    const dy = pt.y - gestureStart.ptY;
    const orig = gestureStart.box;

    if (gestureAction === 'MOVE_MOUTH') {
      setBoxes((prev) => {
        const cur = prev[activeCharId] || orig;
        return {
          ...prev,
          [activeCharId]: {
            ...cur,
            mouthX: Number(pt.x.toFixed(3)),
            mouthY: Number(pt.y.toFixed(3))
          }
        };
      });
      return;
    }

    if (gestureAction === 'MOVE_BOX') {
      const origMouthOffsetX = (orig.mouthX ?? orig.x + orig.width * 0.5) - orig.x;
      const origMouthOffsetY = (orig.mouthY ?? orig.y + orig.height * 0.6) - orig.y;
      const nextX = Math.max(0.02, Math.min(0.98 - orig.width, orig.x + dx));
      const nextY = Math.max(0.02, Math.min(0.98 - orig.height, orig.y + dy));
      setBoxes((prev) => ({
        ...prev,
        [activeCharId]: {
          ...orig,
          characterId: activeCharId,
          x: Number(nextX.toFixed(3)),
          y: Number(nextY.toFixed(3)),
          mouthX: Number(Math.max(0.03, Math.min(0.97, nextX + origMouthOffsetX)).toFixed(3)),
          mouthY: Number(Math.max(0.03, Math.min(0.97, nextY + origMouthOffsetY)).toFixed(3))
        }
      }));
      return;
    }

    if (gestureAction === 'RESIZE_BR') {
      const nextW = Math.max(0.14, Math.min(0.98 - orig.x, orig.width + dx));
      const nextH = Math.max(0.14, Math.min(0.98 - orig.y, orig.height + dy));
      setBoxes((prev) => ({
        ...prev,
        [activeCharId]: clampBox(
          {
            ...orig,
            width: nextW,
            height: nextH,
            mouthX: orig.x + nextW * 0.5,
            mouthY: orig.y + nextH * 0.6
          },
          activeCharId
        )
      }));
      return;
    }

    if (gestureAction === 'RESIZE_TL') {
      const right = orig.x + orig.width;
      const bottom = orig.y + orig.height;
      const nextX = Math.max(0.02, Math.min(right - 0.14, orig.x + dx));
      const nextY = Math.max(0.02, Math.min(bottom - 0.14, orig.y + dy));
      const nextW = right - nextX;
      const nextH = bottom - nextY;
      setBoxes((prev) => ({
        ...prev,
        [activeCharId]: clampBox(
          {
            ...orig,
            x: nextX,
            y: nextY,
            width: nextW,
            height: nextH,
            mouthX: nextX + nextW * 0.5,
            mouthY: nextY + nextH * 0.6
          },
          activeCharId
        )
      }));
      return;
    }

    if (gestureAction === 'RESIZE_TR') {
      const bottom = orig.y + orig.height;
      const nextY = Math.max(0.02, Math.min(bottom - 0.14, orig.y + dy));
      const nextW = Math.max(0.14, Math.min(0.98 - orig.x, orig.width + dx));
      const nextH = bottom - nextY;
      setBoxes((prev) => ({
        ...prev,
        [activeCharId]: clampBox(
          {
            ...orig,
            y: nextY,
            width: nextW,
            height: nextH,
            mouthX: orig.x + nextW * 0.5,
            mouthY: nextY + nextH * 0.6
          },
          activeCharId
        )
      }));
      return;
    }

    if (gestureAction === 'RESIZE_BL') {
      const right = orig.x + orig.width;
      const nextX = Math.max(0.02, Math.min(right - 0.14, orig.x + dx));
      const nextW = right - nextX;
      const nextH = Math.max(0.14, Math.min(0.98 - orig.y, orig.height + dy));
      setBoxes((prev) => ({
        ...prev,
        [activeCharId]: clampBox(
          {
            ...orig,
            x: nextX,
            width: nextW,
            height: nextH,
            mouthX: nextX + nextW * 0.5,
            mouthY: orig.y + nextH * 0.6
          },
          activeCharId
        )
      }));
      return;
    }

    if (gestureAction === 'DRAW_NEW_BOX') {
      // Only switch from centered tap to custom drawn rectangle if user dragged at least 7% of screen
      if (Math.hypot(dx, dy) < 0.07) return;
      const minX = Math.min(gestureStart.ptX, pt.x);
      const minY = Math.min(gestureStart.ptY, pt.y);
      const width = Math.max(0.16, Math.min(0.96 - minX, Math.abs(dx)));
      const height = Math.max(0.18, Math.min(0.96 - minY, Math.abs(dy)));
      setBoxes((prev) => ({
        ...prev,
        [activeCharId]: clampBox(
          {
            characterId: activeCharId,
            x: minX,
            y: minY,
            width,
            height,
            mouthX: minX + width * 0.5,
            mouthY: minY + height * 0.6
          },
          activeCharId
        )
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gestureAction !== 'NONE') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      setGestureAction('NONE');
      setGestureStart(null);
    }
  };

  const handleScaleActiveBox = (scaleFactor: number) => {
    if (!activeCharId) return;
    const cur = boxes[activeCharId] || createDefaultBoxForIndex(0, 1, activeCharId);
    const cx = cur.x + cur.width / 2;
    const cy = cur.y + cur.height / 2;
    const nextW = Math.max(0.16, Math.min(0.94, cur.width * scaleFactor));
    const nextH = Math.max(0.18, Math.min(0.94, cur.height * scaleFactor));
    setBoxes((prev) => ({
      ...prev,
      [activeCharId]: clampBox(
        {
          ...cur,
          x: cx - nextW / 2,
          y: cy - nextH / 2,
          width: nextW,
          height: nextH
        },
        activeCharId
      )
    }));
  };

  const applyPresetPosition = (preset: 'LEFT' | 'CENTER' | 'RIGHT') => {
    if (!activeCharId) return;
    const newBox: CharacterBoundingBox =
      preset === 'LEFT'
        ? {
            characterId: activeCharId,
            x: 0.05,
            y: 0.14,
            width: 0.44,
            height: 0.68,
            mouthX: 0.27,
            mouthY: 0.55
          }
        : preset === 'RIGHT'
        ? {
            characterId: activeCharId,
            x: 0.51,
            y: 0.14,
            width: 0.44,
            height: 0.68,
            mouthX: 0.73,
            mouthY: 0.55
          }
        : {
            characterId: activeCharId,
            x: 0.22,
            y: 0.12,
            width: 0.56,
            height: 0.72,
            mouthX: 0.5,
            mouthY: 0.55
          };

    setBoxes((prev) => ({
      ...prev,
      [activeCharId]: newBox
    }));
  };

  const autoDistributeAllPresent = () => {
    const updated: Record<string, CharacterBoundingBox> = { ...boxes };
    presentIds.forEach((id, idx) => {
      updated[id] = createDefaultBoxForIndex(idx, presentIds.length, id);
    });
    setBoxes(updated);
  };

  const handleConfirmAndSave = () => {
    onSaveTracking?.(presentIds, boxes);
    onSaveBoxes?.(boxes);
    onClose();
  };

  const activeMember = cast.find((c) => c.id === activeCharId) || cast[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-1.5 sm:p-4">
      <div className="bg-slate-900 border-2 border-amber-400/90 rounded-3xl shadow-2xl w-full max-w-3xl max-h-[96dvh] flex flex-col overflow-hidden text-white">
        {/* TOP HEADER COMPACT FOR MOBILE */}
        <div className="flex items-center justify-between px-3.5 sm:px-5 py-2.5 sm:py-3 bg-slate-950 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 sm:p-2 rounded-xl bg-amber-400 text-slate-950 shadow flex-shrink-0">
              <Crosshair className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-base font-black text-amber-300 truncate">
                🎯 Inquadra Soggetto &amp; Bocca (Insta360 Touch)
              </h3>
              <p className="text-[11px] text-slate-300 truncate">
                Tocca il soggetto per centrare il riquadro o trascinalo col dito!
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-2.5 sm:p-4 space-y-2.5">
          {/* 1. SELEZIONE PERSONAGGIO + SELETTORE MODALITÀ TOUCH (RIQUADRO vs BOCCA 👄) */}
          <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {cast.map((member) => {
                  const isPresent = presentIds.includes(member.id);
                  const isActive = activeCharId === member.id;
                  const colorSpec = getColorForCharacter(member.id);
                  const photo =
                    member.referencePhotos?.find((p) => !p.startsWith('data:image/svg+xml')) ||
                    member.referencePhotos?.[0];

                  return (
                    <div
                      key={member.id}
                      onClick={() => handleSelectOrToggleCharacter(member.id)}
                      style={{
                        borderColor: isActive ? colorSpec.border : isPresent ? '#475569' : '#334155'
                      }}
                      className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2 text-xs font-extrabold transition select-none ${
                        isActive
                          ? 'bg-slate-950 text-white shadow-md scale-[1.02]'
                          : isPresent
                          ? 'bg-slate-900/90 text-slate-200'
                          : 'bg-slate-900/40 text-slate-400 opacity-65'
                      }`}
                    >
                      {photo && (
                        <img
                          src={photo}
                          alt={member.name}
                          className="w-4 h-4 sm:w-5 sm:h-5 rounded-full object-cover bg-slate-700"
                        />
                      )}
                      <span>
                        {member.type === 'ANIMAL' ? '🐾' : '🧑'} {member.name}
                      </span>
                      {isPresent && presentIds.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => handleRemoveCharacterFromScene(member.id, e)}
                          className="ml-0.5 p-0.5 rounded-full hover:bg-rose-500/30 text-slate-400 hover:text-rose-300"
                          title="Rimuovi personaggio"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* PULSANTE SWITCH MODALITÀ DITO PER SMARTPHONE: SPOSTA RIQUADRO vs SPOSTA PUNTO BOCCA 👄 */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-700 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setTouchToolMode('BOX')}
                  className={`flex-1 sm:flex-initial px-2.5 py-1.5 rounded-lg text-[11px] font-black transition ${
                    touchToolMode === 'BOX'
                      ? 'bg-amber-400 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  📦 1. Tocca/Sposta Riquadro
                </button>
                <button
                  type="button"
                  onClick={() => setTouchToolMode('MOUTH')}
                  className={`flex-1 sm:flex-initial px-2.5 py-1.5 rounded-lg text-[11px] font-black transition ${
                    touchToolMode === 'MOUTH'
                      ? 'bg-rose-500 text-white shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  👄 2. Tocca Punto Bocca
                </button>
              </div>
            </div>

            {/* BARRA CONTROLLI RAPIDI PER SMARTPHONE: POSIZIONE E GRANDEZZA RIQUADRO */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-700/80">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => applyPresetPosition('LEFT')}
                  className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-bold text-slate-100"
                >
                  ⬅️ Sinistra
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetPosition('CENTER')}
                  className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-bold text-slate-100"
                >
                  🎯 Centro
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetPosition('RIGHT')}
                  className="px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-bold text-slate-100"
                >
                  ➡️ Destra
                </button>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-slate-400 mr-0.5">Grandezza:</span>
                <button
                  type="button"
                  onClick={() => handleScaleActiveBox(0.86)}
                  className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-black text-amber-300"
                >
                  ➖ Rimpicciolisci
                </button>
                <button
                  type="button"
                  onClick={() => handleScaleActiveBox(1.15)}
                  className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-black text-amber-300"
                >
                  ➕ Ingrandisci
                </button>
                {presentIds.length > 1 && (
                  <button
                    type="button"
                    onClick={autoDistributeAllPresent}
                    className="px-2 py-1 rounded-lg bg-amber-400/20 border border-amber-400/50 text-[11px] font-extrabold text-amber-300 inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Separa
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 2. AREA VISIVA ADATTIVA SENZA BANDE NERE (100% FEDELE ALLA FOTO/VIDEO ANCHE IN VERTICALE DA TELEFONO) */}
          <div className="flex flex-col items-center justify-center">
            <div
              ref={viewportRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                aspectRatio: `${mediaAspect}`,
                maxHeight: '54dvh'
              }}
              className="relative w-auto max-w-full bg-slate-950 rounded-2xl overflow-hidden border-2 border-amber-400/60 cursor-crosshair select-none touch-none flex items-center justify-center shadow-xl mx-auto"
            >
              {mediaType === 'VIDEO' && mediaUrl ? (
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(e) => {
                    const dur = e.currentTarget.duration || 5;
                    setVideoDuration(dur);
                    if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) {
                      setMediaAspect(
                        e.currentTarget.videoWidth / e.currentTarget.videoHeight
                      );
                    }
                    e.currentTarget.currentTime = Math.min(0.5, dur * 0.25);
                  }}
                  className="w-full h-full object-fill pointer-events-none block"
                />
              ) : mediaUrl || fallbackImageUrl ? (
                <img
                  src={mediaUrl || fallbackImageUrl}
                  alt={mediaTitle}
                  draggable={false}
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth && e.currentTarget.naturalHeight) {
                      setMediaAspect(
                        e.currentTarget.naturalWidth / e.currentTarget.naturalHeight
                      );
                    }
                  }}
                  className="w-full h-full object-fill pointer-events-none block"
                />
              ) : (
                <div className="p-12 text-slate-500 flex flex-col items-center gap-2">
                  <ImageIcon className="w-10 h-10" />
                  <span className="text-xs font-bold">Anteprima Media</span>
                </div>
              )}

              {/* RENDER DI TUTTI I RIQUADRI DI TRACKING DEI PERSONAGGI PRESENTI */}
              {presentIds.map((charId, idx) => {
                const box = boxes[charId];
                if (!box) return null;
                const member = cast.find((c) => c.id === charId);
                if (!member) return null;

                const isCurrentActive = charId === activeCharId;
                const colorSpec = getColorForCharacter(charId);
                const mouthX = box.mouthX ?? box.x + box.width * 0.5;
                const mouthY = box.mouthY ?? box.y + box.height * 0.6;

                return (
                  <React.Fragment key={charId}>
                    {/* Bounding Box Insta360 (pointer-events-none così il contenitore padre gestisce touch, drag e maniglie senza conflitti!) */}
                    <div
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                        borderColor: colorSpec.border,
                        backgroundColor: isCurrentActive ? colorSpec.bg : 'rgba(15, 23, 42, 0.15)',
                        boxShadow: isCurrentActive
                          ? `0 0 0 2px rgba(0,0,0,0.65), 0 0 20px ${colorSpec.border}66`
                          : '0 0 0 1px rgba(0,0,0,0.5)'
                      }}
                      className={`absolute rounded-xl border-2 pointer-events-none ${
                        isCurrentActive ? 'z-20' : 'z-10 opacity-80'
                      }`}
                    >
                      {/* Maniglie Angolari Grandi per Touch Mobile (Corner Handles Stile Insta360) */}
                      <div
                        style={{ backgroundColor: colorSpec.border }}
                        className="absolute -top-2 -left-2 w-5 h-5 rounded-full border-2 border-slate-950 shadow"
                      />
                      <div
                        style={{ backgroundColor: colorSpec.border }}
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-slate-950 shadow"
                      />
                      <div
                        style={{ backgroundColor: colorSpec.border }}
                        className="absolute -bottom-2 -left-2 w-5 h-5 rounded-full border-2 border-slate-950 shadow"
                      />
                      <div
                        style={{ backgroundColor: colorSpec.border }}
                        className="absolute -bottom-2 -right-2 w-5 h-5 rounded-full border-2 border-slate-950 shadow"
                      />

                      {/* Etichetta Soggetto */}
                      <div
                        style={{ backgroundColor: colorSpec.border }}
                        className="absolute -top-6 left-1 px-2 py-0.5 rounded-md text-slate-950 font-black text-[10px] shadow flex items-center gap-1 whitespace-nowrap"
                      >
                        <span>
                          #{idx + 1} {member.type === 'ANIMAL' ? '🐾' : '🧑'} {member.name.toUpperCase()}
                        </span>
                      </div>

                      {/* Mirino Centrale Soggetto */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-55">
                        <Crosshair
                          style={{ color: colorSpec.border }}
                          className="w-5 h-5 drop-shadow"
                        />
                      </div>
                    </div>

                    {/* Punto Ancoraggio Labiale / Bocca / Muso (👄) */}
                    <div
                      style={{
                        left: `${mouthX * 100}%`,
                        top: `${mouthY * 100}%`,
                        borderColor: touchToolMode === 'MOUTH' && isCurrentActive ? '#f43f5e' : colorSpec.border
                      }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 z-30 px-2 py-0.5 rounded-full bg-slate-950/95 border-2 text-xs font-black text-amber-300 shadow-lg flex items-center gap-1 pointer-events-none ${
                        touchToolMode === 'MOUTH' && isCurrentActive ? 'scale-125 ring-4 ring-rose-500/50' : ''
                      }`}
                    >
                      <span>👄</span>
                      <span className="text-[9px]">{member.name}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="mt-1.5 text-center text-[11px] font-bold text-amber-300">
              {touchToolMode === 'MOUTH'
                ? `👄 Tocca o trascina esattamente sulla bocca/muso di ${activeMember?.name}`
                : `📦 Trascina il riquadro col dito per spostarlo, tira i 4 pallini agli angoli per ridimensionarlo, o tocca il soggetto!`}
            </div>

            {/* Se è un VIDEO: cursore per scegliere il fotogramma */}
            {mediaType === 'VIDEO' && (
              <div className="w-full max-w-xl mt-2 flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-xs">
                <Video className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span className="font-bold text-slate-300 whitespace-nowrap">
                  Frame ({videoSeekSec.toFixed(1)}s):
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, videoDuration)}
                  step={0.1}
                  value={videoSeekSec}
                  onChange={(e) => {
                    const t = parseFloat(e.target.value);
                    setVideoSeekSec(t);
                    if (videoRef.current) {
                      videoRef.current.currentTime = t;
                    }
                  }}
                  className="flex-1 accent-amber-400"
                />
              </div>
            )}
          </div>
        </div>

        {/* FOOTER ACTIONS */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-950 border-t border-slate-800 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleConfirmAndSave}
            className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs sm:text-sm shadow-lg inline-flex items-center justify-center gap-1.5 transition"
          >
            <Check className="w-4 h-4" />
            <span>✅ Conferma Riquadro &amp; Bocca ({presentIds.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
