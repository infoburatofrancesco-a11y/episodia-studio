import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

function parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1],
      base64Data: match[2],
    };
  }
  return {
    mimeType: 'image/jpeg',
    base64Data: dataUrl,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { referenceImageBase64, category } = body as {
      referenceImageBase64?: string;
      category?: 'human' | 'animal';
    };

    if (!referenceImageBase64) {
      return NextResponse.json(
        { error: 'Immagine di riferimento (referenceImageBase64) mancante.' },
        { status: 400 }
      );
    }

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
    const { mimeType, base64Data } = parseDataUrl(referenceImageBase64);

    const subjectHint =
      category === 'animal'
        ? 'an animal character (focus on breed/species, coat/fur colors and patterns, eye color, ear/snout shape, collar, clothing, hats, glasses, or accessories, and facial expression)'
        : 'a human character (focus on apparent age, gender presentation, skin tone, facial structure, hairstyle and hair color, facial hair, eye details, makeup, headwear/hats, eyewear/glasses, exact clothing items with colors/fabrics, and accessories)';

    const systemInstruction = `You are a Senior Visual Continuity Supervisor for AI Cinema & Image-to-Video production.
Your task is to inspect the provided reference image of ${subjectHint} and produce an ultra-specific, fixed, hyper-detailed visual descriptor strictly in ENGLISH.
Rules:
1. Write a single, dense, comma-separated descriptive paragraph (approx. 50-90 words) ready to be embedded directly inside Image-to-Video prompts.
2. Include exact physical traits (apparent age or breed, facial features/fur texture and colors, eyes, hair/coat), facial expression, exact clothing (colors, textures, neckline, layers), hats/headwear, glasses/eyewear, makeup, jewelry, or distinctive accessories.
3. Do NOT include intro/outro filler phrases like "Here is the description" or markdown formatting. Output ONLY the raw English visual descriptor text.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: `Analyze this ${category === 'animal' ? 'animal' : 'human'} character reference photo and extract a hyper-detailed English visual descriptor for consistent AI video generation.`,
            },
          ],
        },
      ],
      config: {
        systemInstruction,
        temperature: 0.2,
      },
    });

    const visualDescriptor = response.text?.trim() || '';

    if (!visualDescriptor) {
      return NextResponse.json(
        { error: 'Il modello non ha restituito una descrizione valida.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ visualDescriptor });
  } catch (error: unknown) {
    console.error('Errore in /api/analyze-character:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto durante l\'analisi AI del personaggio.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

