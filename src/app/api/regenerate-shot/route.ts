import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import type { Character, Shot } from '@/types/episodia';

const singleShotSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    cameraAngle: {
      type: Type.STRING,
      description:
        'Cinematic camera framing and movement in English (e.g., "Medium selfie shot, handheld camera", "Close-up reaction shot").',
    },
    visualPromptEn: {
      type: Type.STRING,
      description:
        'Hyper-detailed visual prompt in ENGLISH for an Image-to-Video model. MUST faithfully incorporate the exact visualDescriptor of every character present in the shot, plus realistic 10-second physical actions and facial expressions.',
    },
    speakerId: {
      type: Type.STRING,
      nullable: true,
      description:
        'Exact character ID of the single character speaking in this 10-second shot, or null if silent.',
    },
    dialogueIta: {
      type: Type.STRING,
      description:
        'Fresh, witty, natural comedy line in ITALIAN spoken by speakerId (approx. 16-30 words to fit in 10 seconds), faithful to their personality.',
    },
  },
  required: ['cameraAngle', 'visualPromptEn', 'speakerId', 'dialogueIta'],
};

export const runtime = 'edge';
export const maxDuration = 60;

const GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      episodeTitle,
      episodeLogline,
      shot,
      allShots,
      cast,
      customInstruction,
    } = body as {
      episodeTitle?: string;
      episodeLogline?: string;
      shot?: Shot;
      allShots?: Shot[];
      cast?: Character[];
      customInstruction?: string;
    };

    if (!shot || !Array.isArray(cast) || cast.length === 0) {
      return NextResponse.json(
        { error: 'Dati dello shot o del cast mancanti per la rigenerazione.' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'la_tua_chiave_qui') {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY non configurata.' },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const shotCast = cast.filter((c) => shot.characterIds.includes(c.id));
    const activeChars = shotCast.length > 0 ? shotCast : cast;

    const castRosterText = activeChars
      .map(
        (c) =>
          `- ID: "${c.id}" | Name: "${c.name}" (${c.category})
  Personality (ITA): "${c.personality}"
  MANDATORY Visual Descriptor (EN): "${c.visualDescriptor}"`
      )
      .join('\n');

    const contextText = Array.isArray(allShots)
      ? allShots
          .map(
            (s) =>
              `Shot #${s.shotNumber}${
                s.id === shot.id ? ' [THIS SHOT TO REGENERATE]' : ''
              }: Speaker=${s.speakerId || 'None'} | Dialogue="${s.dialogueIta}"`
          )
          .join('\n')
      : '';

    const systemInstruction = `You are a Sitcom Screenwriter and AI Video Director.
Your task is to REGENERATE a fresh, funnier, and more dynamic version of Shot #${shot.shotNumber} (duration: 10 seconds) for the episode "${episodeTitle || ''}".
RULES:
1. "visualPromptEn" MUST be in ENGLISH and MUST faithfully embed the exact "Visual Descriptor" of every character in this shot, plus a realistic 10-second action and facial expression.
2. "dialogueIta" MUST be a brand-new, hilarious, natural line in ITALIAN (16-30 words) matching the speaking character's personality.
3. Make sure this new version differs from the previous line ("${shot.dialogueIta}") while staying coherent with the episode plot.`;

    const userPrompt = `EPISODE TITLE: "${episodeTitle || ''}"
EPISODE PLOT / LOGLINE: "${episodeLogline || ''}"
SHOT NUMBER TO REGENERATE: #${shot.shotNumber} of ${allShots?.length || '?'}
PREVIOUS VERSION OF THIS SHOT:
- Camera: "${shot.cameraAngle}"
- Dialogue (ITA): "${shot.dialogueIta}"
- Visual Prompt (EN): "${shot.visualPromptEn}"
${customInstruction ? `\nUSER DIRECTION FOR REGENERATION: "${customInstruction}"` : ''}

CHARACTERS PRESENT IN THIS SHOT:
${castRosterText}

FULL EPISODE CONTEXT:
${contextText}

Regenerate Shot #${shot.shotNumber} now as structured JSON.`;

    let lastError = '';
    for (const modelName of GEMINI_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: singleShotSchema,
            temperature: 0.85,
          },
        });

        const parsed = JSON.parse(response.text?.trim() || '{}');
        const validIds = new Set(activeChars.map((c) => c.id));

        return NextResponse.json({
          shot: {
            ...shot,
            cameraAngle: parsed.cameraAngle || shot.cameraAngle,
            visualPromptEn: parsed.visualPromptEn || shot.visualPromptEn,
            speakerId:
              parsed.speakerId && validIds.has(parsed.speakerId)
                ? parsed.speakerId
                : activeChars[0]?.id || null,
            dialogueIta: parsed.dialogueIta ?? shot.dialogueIta,
          },
        });
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        if (
          lastError.includes('402') ||
          lastError.includes('prepayment credits')
        ) {
          break;
        }
      }
    }

    if (lastError.includes('402') || lastError.includes('prepayment credits')) {
      const speaker = activeChars[0];
      return NextResponse.json({
        shot: {
          ...shot,
          cameraAngle: 'Close-up reaction shot, dynamic handheld camera',
          dialogueIta: `Aspettate un secondo... state dicendo sul serio o è uno scherzo?!`,
          visualPromptEn: `Close-up reaction shot. [${speaker.name}: ${speaker.visualDescriptor}]. ${speaker.name} reacts with wide eyes and speaks animatedly to the camera.`,
        },
      });
    }

    return NextResponse.json(
      { error: lastError || 'Errore durante la rigenerazione dello shot.' },
      { status: 500 }
    );
  } catch (error: unknown) {
    console.error('Errore in /api/regenerate-shot:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Errore durante la rigenerazione dello shot.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
