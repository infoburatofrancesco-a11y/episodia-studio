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
      description: 'Duration of the shot in seconds (always 5).',
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
        'Hyper-detailed visual prompt in ENGLISH for an Image-to-Video model. MUST faithfully incorporate the exact visualDescriptor of every character present in the shot, plus realistic 5-second physical actions, setting details, and who is speaking with what facial expression.',
    },
    speakerId: {
      type: Type.STRING,
      nullable: true,
      description:
        'Exact character ID of the single character speaking in this 5-second shot, or null if the shot is a silent reaction/action.',
    },
    dialogueIta: {
      type: Type.STRING,
      description:
        'Snappy, natural comedy line in ITALIAN spoken by speakerId (sized to fit naturally within 5 seconds, approx. 8-16 words), faithful to their personality and catchphrases. Empty string if speakerId is null.',
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, logline, shotCount = 4, cast } = body as {
      title?: string;
      logline?: string;
      shotCount?: number;
      cast?: Character[];
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

    const clampedShotCount = Math.min(6, Math.max(3, Number(shotCount) || 4));

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'la_tua_chiave_qui') {
      return NextResponse.json(
        {
          error:
            'GEMINI_API_KEY non configurata. Imposta una chiave valida nel file .env.local.',
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
You write tight, hilarious, high-rhythm micro-episodes divided into sequential 5-second shots.

STRICT PRODUCTION RULES:
1. Generate EXACTLY ${clampedShotCount} sequential shots (shotNumber 1 to ${clampedShotCount}), each with duration = 5.
2. Only use character IDs from the provided CAST ROSTER in "characterIds" and "speakerId".
3. For EVERY shot, the field "visualPromptEn" MUST be written in ENGLISH and MUST faithfully INCORPORATE the exact "Visual Descriptor" of every character present in that shot, followed by realistic 5-second physical movements, environment details, camera lighting, and explicitly stating who is speaking (or reacting) and with what facial expression.
4. For EVERY shot, the field "dialogueIta" MUST be written in natural, witty, rhythmic ITALIAN, strictly matching the speaking character's "Personality & Voice" (including their tone or catchphrases when fitting). Keep each line concise (approx. 8-15 words) so it can be spoken naturally in 5 seconds.
5. Build a clear comedic escalation across the ${clampedShotCount} shots ending with a punchline or hilarious reaction in the final shot.`;

    const userPrompt = `EPISODE TITLE: "${title}"
COMEDIC SITUATION / LOGLINE: "${logline}"
NUMBER OF 5-SECOND SHOTS REQUIRED: ${clampedShotCount}

CAST ROSTER AVAILABLE IN THIS EPISODE:
${castRosterText}

Generate the structured JSON array of ${clampedShotCount} shots now.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: scriptResponseSchema,
        temperature: 0.75,
      },
    });

    const rawText = response.text?.trim() || '[]';
    const parsedShots = JSON.parse(rawText) as Array<Omit<Shot, 'id' | 'status'>>;

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
        duration: 5,
        characterIds: ensuredChars,
        cameraAngle: s.cameraAngle || 'Medium selfie shot, handheld camera',
        visualPromptEn: s.visualPromptEn || '',
        speakerId,
        dialogueIta: s.dialogueIta || '',
        status: 'draft',
      };
    });

    return NextResponse.json({ shots });
  } catch (error: unknown) {
    console.error('Errore in /api/generate-script:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto durante la generazione della sceneggiatura.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

