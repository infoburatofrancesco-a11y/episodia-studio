import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import type { Character, Shot } from '@/types/episodia';

const shotSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    shotNumber: {
      type: Type.INTEGER,
      description: 'Sequential number of the shot starting from 1.',
    },
    duration: {
      type: Type.INTEGER,
      description: 'Duration of the shot in seconds (always 10).',
    },
    characterIds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Array of exact character IDs present in this shot.',
    },
    cameraAngle: {
      type: Type.STRING,
      description:
        'Cinematic camera framing and movement in English (e.g., "Medium selfie shot, handheld camera", "Close-up reaction shot", "Two-shot over the shoulder").',
    },
    visualPromptEn: {
      type: Type.STRING,
      description:
        'Hyper-detailed visual prompt in ENGLISH for an Image-to-Video model. MUST faithfully incorporate the exact visualDescriptor of every character present in the shot, plus realistic 10-second physical actions, setting details, and who is speaking with what facial expression.',
    },
    speakerId: {
      type: Type.STRING,
      nullable: true,
      description:
        'Exact character ID of the single character speaking in this 10-second shot, or null if the shot is a silent reaction/action.',
    },
    dialogueIta: {
      type: Type.STRING,
      description:
        'Snappy, natural comedy line in ITALIAN spoken by speakerId (sized to fit naturally within 10 seconds, approx. 16-30 words), faithful to their personality and catchphrases. Empty string if speakerId is null.',
    },
  },
  required: [
    'shotNumber',
    'duration',
    'characterIds',
    'cameraAngle',
    'visualPromptEn',
    'speakerId',
    'dialogueIta',
  ],
};

const scriptResponseSchema: Schema = {
  type: Type.ARRAY,
  items: shotSchema,
  description: 'Ordered sequence of 5-second shots composing the episode.',
};

const GEMINI_SCRIPT_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

function buildFallbackShots(
  cast: Character[],
  shotCount: number,
  title: string,
  logline: string
): Shot[] {
  const angles = [
    'Medium selfie shot, handheld camera',
    'Close-up reaction shot, shallow depth of field',
    'Two-shot over the shoulder, dynamic sitcom framing',
    'Wide shot in room, expressive body language',
    'Extreme close-up on eyes, comedic timing',
    'Medium two-shot, final punchline reaction',
  ];

  return Array.from({ length: shotCount }, (_, idx) => {
    const speaker = cast[idx % cast.length];
    const secondChar = cast[(idx + 1) % cast.length];
    const presentChars =
      cast.length > 1 && idx % 2 === 1
        ? [speaker.id, secondChar.id]
        : [speaker.id];

    const descriptors = presentChars
      .map((id) => cast.find((c) => c.id === id))
      .filter((c): c is Character => Boolean(c))
      .map((c) => `[${c.name}: ${c.visualDescriptor}]`)
      .join(' ');

    const cameraAngle = angles[idx % angles.length];

    let dialogueIta = '';
    if (idx === 0) {
      dialogueIta = `Ragazzi, parliamoci chiaro su "${title}": qui qualcuno sta nascondendo la verità!`;
    } else if (idx === shotCount - 1) {
      dialogueIta = `E va bene, lo ammetto... ma giuro che sembrava un'ottima idea sul momento!`;
    } else {
      dialogueIta = `Ma io che c'entro?! Guardate che ero qui solo di passaggio!`;
    }

    return {
      id: `shot-${Date.now()}-${idx + 1}`,
      shotNumber: idx + 1,
      duration: 10,
      characterIds: presentChars,
      cameraAngle,
      visualPromptEn: `${cameraAngle}. ${descriptors}. Scene context: ${logline.slice(0, 120)}. ${speaker.name} is speaking expressively to the camera with animated gestures.`,
      speakerId: speaker.id,
      dialogueIta,
      status: 'draft',
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title,
      logline,
      shotCount = 4,
      cast,
      customApiKey,
    } = body as {
      title?: string;
      logline?: string;
      shotCount?: number;
      cast?: Character[];
      customApiKey?: string;
    };

    if (!title || !logline || !Array.isArray(cast) || cast.length === 0) {
      return NextResponse.json(
        {
          error:
            'Parametri mancanti: fornisci titolo, soggetto (logline) e almeno un personaggio del cast.',
        },
        { status: 400 }
      );
    }

    const clampedShotCount = Math.min(6, Math.max(1, Number(shotCount) || 4));

    const apiKey = customApiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'la_tua_chiave_qui') {
      return NextResponse.json(
        {
          error:
            'GEMINI_API_KEY non configurata. Imposta una chiave valida.',
        },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const castRosterText = cast
      .map(
        (c, idx) =>
          `CHARACTER #${idx + 1}:
- ID: "${c.id}"
- Name: "${c.name}"
- Category: "${c.category}"
- Personality & Voice (Italian): "${c.personality}"
- MANDATORY Visual Descriptor (English): "${c.visualDescriptor}"`
      )
      .join('\n\n');

    const systemInstruction = `You are a brilliant TV & Social Series (Reels/TikTok) Sitcom Screenwriter and AI Video Director.
You write tight, hilarious, high-rhythm micro-episodes divided into sequential 10-second shots.

STRICT PRODUCTION RULES:
1. Generate EXACTLY ${clampedShotCount} sequential shots (shotNumber 1 to ${clampedShotCount}), each with duration = 10.
2. Only use character IDs from the provided CAST ROSTER in "characterIds" and "speakerId".
3. For EVERY shot, the field "visualPromptEn" MUST be written in ENGLISH and MUST faithfully INCORPORATE the exact "Visual Descriptor" of every character present in that shot, followed by realistic 10-second physical movements, environment details, camera lighting, and explicitly stating who is speaking (or reacting) and with what facial expression.
4. For EVERY shot, the field "dialogueIta" MUST be written in natural, witty, rhythmic ITALIAN, strictly matching the speaking character's "Personality & Voice" (including their tone or catchphrases when fitting). Keep each line around 16-30 words so it can be spoken naturally in a 10-second clip.
5. Build a clear comedic escalation across the ${clampedShotCount} shots ending with a punchline or hilarious reaction in the final shot.`;

    const userPrompt = `EPISODE TITLE: "${title}"
COMEDIC SITUATION / LOGLINE: "${logline}"
NUMBER OF 10-SECOND SHOTS REQUIRED: ${clampedShotCount}

CAST ROSTER AVAILABLE IN THIS EPISODE:
${castRosterText}

Generate the structured JSON array of ${clampedShotCount} shots now.`;

    let lastError = '';
    for (const modelName of GEMINI_SCRIPT_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: scriptResponseSchema,
            temperature: 0.75,
          },
        });

        const rawText = response.text?.trim() || '[]';
        const parsedShots = JSON.parse(rawText) as Array<
          Omit<Shot, 'id' | 'status'>
        >;

        const validCastIds = new Set(cast.map((c) => c.id));

        const shots: Shot[] = parsedShots.map((s, index) => {
          const filteredChars = Array.isArray(s.characterIds)
            ? s.characterIds.filter((id) => validCastIds.has(id))
            : [];
          const ensuredChars =
            filteredChars.length > 0 ? filteredChars : [cast[0].id];
          const speakerId =
            s.speakerId && validCastIds.has(s.speakerId) ? s.speakerId : null;

          return {
            id: `shot-${Date.now()}-${index + 1}`,
            shotNumber: index + 1,
            duration: 10,
            characterIds: ensuredChars,
            cameraAngle: s.cameraAngle || 'Medium selfie shot, handheld camera',
            visualPromptEn: s.visualPromptEn || '',
            speakerId,
            dialogueIta: s.dialogueIta || '',
            status: 'draft',
          };
        });

        return NextResponse.json({ shots, modelUsed: modelName });
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
      const fallbackShots = buildFallbackShots(
        cast,
        clampedShotCount,
        title,
        logline
      );
      return NextResponse.json({
        shots: fallbackShots,
        warning:
          'Sceneggiatura generata in modalità Studio Template perché la chiave Google AI Studio attuale ha "Prepayment credits depleted" (402). Puoi modificare liberamente tutte le battute nello Storyboard!',
      });
    }

    return NextResponse.json(
      {
        error:
          lastError ||
          'Errore imprevisto durante la generazione della sceneggiatura.',
      },
      { status: 500 }
    );
  } catch (error: unknown) {
    console.error('Errore in /api/generate-script:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto durante la generazione della sceneggiatura.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
