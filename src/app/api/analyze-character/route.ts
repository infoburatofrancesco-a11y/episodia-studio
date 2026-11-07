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

export const runtime = 'edge';
export const maxDuration = 60;

const GEMINI_VISION_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      referenceImageBase64,
      referenceImagesBase64,
      category,
      name,
      customApiKey,
    } = body as {
      referenceImageBase64?: string;
      referenceImagesBase64?: string[];
      category?: 'human' | 'animal';
      name?: string;
      customApiKey?: string;
    };

    const imagesList: string[] =
      Array.isArray(referenceImagesBase64) && referenceImagesBase64.length > 0
        ? referenceImagesBase64
        : referenceImageBase64
        ? [referenceImageBase64]
        : [];

    if (imagesList.length === 0) {
      return NextResponse.json(
        { error: 'Carica almeno una foto di riferimento del personaggio.' },
        { status: 400 }
      );
    }

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

    const subjectHint =
      category === 'animal'
        ? 'an animal character (focus on breed/species, coat/fur colors and patterns, eye color, ear/snout shape, collar, clothing, hats, glasses, or accessories, and facial expression across all angles)'
        : 'a human character (focus on apparent age, gender presentation, skin tone, facial structure, hairstyle and hair color, facial hair, eye details, makeup, headwear/hats, eyewear/glasses, exact clothing items with colors/fabrics, and accessories across all provided reference photos)';

    const systemInstruction = `You are a Senior Visual Continuity Supervisor for AI Cinema & Image-to-Video production.
Your task is to inspect all ${imagesList.length} provided reference photo(s) of ${subjectHint} and produce an ultra-specific, fixed, hyper-detailed 360-degree visual descriptor strictly in ENGLISH.
Rules:
1. Synthesize details from ALL ${imagesList.length} uploaded angles/expressions into a single, dense, comma-separated descriptive paragraph (approx. 55-95 words) ready to be embedded directly inside Image-to-Video prompts.
2. Include exact physical traits (apparent age or breed, facial features/fur texture and colors, eyes, hair/coat), facial expression, exact clothing (colors, textures, neckline, layers), hats/headwear, glasses/eyewear, makeup, jewelry, or distinctive accessories.
3. Output ONLY the raw English visual descriptor text without markdown or intro phrases.`;

    const imageParts = imagesList.slice(0, 6).map((imgUrl) => {
      const { mimeType, base64Data } = parseDataUrl(imgUrl);
      return {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      };
    });

    let lastError = '';
    for (const modelName of GEMINI_VISION_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                ...imageParts,
                {
                  text: `Analyze all ${imageParts.length} reference photo(s) of this ${
                    category === 'animal' ? 'animal' : 'human'
                  } character${
                    name ? ` named "${name}"` : ''
                  } and extract a unified, hyper-detailed English visual descriptor for consistent AI video generation.`,
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
        if (visualDescriptor) {
          return NextResponse.json({
            visualDescriptor,
            modelUsed: modelName,
            photosAnalyzed: imageParts.length,
          });
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        // Se è un errore 402 (crediti prepagati esauriti sulla chiave), non serve ciclare altri modelli a pagamento
        if (lastError.includes('402') || lastError.includes('prepayment credits')) {
          break;
        }
      }
    }

    // Se la chiave Google AI Studio ha i crediti prepagati a 0 (errore 402), forniamo un identikit base pre-compilato + avviso chiaro
    if (lastError.includes('402') || lastError.includes('prepayment credits')) {
      const fallbackDescriptor =
        category === 'animal'
          ? `Expressive ${name || 'pet'} animal character, detailed natural fur texture, bright expressive eyes, distinct facial markings, high-definition studio lighting, consistent physical appearance across all camera angles (${imageParts.length} reference photos).`
          : `Expressive ${name || 'adult'} human character matching the exact face, hairstyle, eyes, smile, and clothing from the attached reference photos (${imageParts.length} reference photos).`;

      return NextResponse.json({
        visualDescriptor: fallbackDescriptor,
        warning:
          'Nota Google AI Studio (Codice 402): la tua API Key attuale appartiene a un progetto Google con "Prepayment credits depleted" (crediti prepagati esauriti). Ho generato per te un Identikit Visivo base (che puoi personalizzare e salvare subito nel Database Casting!), oppure puoi creare una API Key gratuita su un nuovo progetto Free Tier in aistudio.google.com/apikey.',
      });
    }

    return NextResponse.json(
      {
        error:
          lastError ||
          "Errore imprevisto durante l'analisi AI delle foto del personaggio.",
      },
      { status: 500 }
    );
  } catch (error: unknown) {
    console.error('Errore in /api/analyze-character:', error);
    const message =
      error instanceof Error
        ? error.message
        : "Errore imprevisto durante l'analisi AI del personaggio.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
