import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';

export const maxDuration = 60;

interface VeoRequestBody {
  action: 'start' | 'poll';
  operationName?: string;
  customApiKey?: string;
  visualPromptEn?: string;
  dialogueIta?: string;
  speakerName?: string;
  characterNames?: string[];
  aspectRatio?: '9:16' | '16:9';
  referenceImagesBase64?: string[];
}

function parseDataUrl(
  dataUrl: string
): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VeoRequestBody;
    const apiKey = (
      body.customApiKey?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      ''
    );

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Chiave API Gemini mancante.' },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // AZIONE 2: POLLING DELL'OPERAZIONE VEO 3.1 SENZA TIMEOUT SU VERCEL
    if (body.action === 'poll' && body.operationName) {
      const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${body.operationName}?key=${encodeURIComponent(apiKey)}`;
      const pollRes = await fetch(pollUrl, { cache: 'no-store' });
      const pollData = await pollRes.json();

      if (!pollRes.ok) {
        return NextResponse.json(
          {
            done: false,
            error:
              pollData?.error?.message ||
              `Errore durante il controllo Veo (${pollRes.status})`,
          },
          { status: pollRes.status }
        );
      }

      if (!pollData.done) {
        return NextResponse.json({
          done: false,
          operationName: body.operationName,
        });
      }

      if (pollData.error) {
        return NextResponse.json(
          {
            done: true,
            error:
              pollData.error.message ||
              'Errore restituito da Google Veo 3.1 durante la generazione.',
          },
          { status: 500 }
        );
      }

      // Estrae l'URI o i byte del video MP4 generato da Veo 3.1
      const samples =
        pollData.response?.generateVideoResponse?.generatedSamples ||
        pollData.response?.generatedVideos ||
        [];
      const firstVideo = samples[0]?.video;

      if (firstVideo?.videoBytes) {
        return NextResponse.json({
          done: true,
          videoDataUrl: `data:${firstVideo.mimeType || 'video/mp4'};base64,${firstVideo.videoBytes}`,
        });
      }

      if (firstVideo?.uri) {
        const downloadUrl = firstVideo.uri.includes('?')
          ? `${firstVideo.uri}&key=${encodeURIComponent(apiKey)}`
          : `${firstVideo.uri}?key=${encodeURIComponent(apiKey)}`;
        const vidRes = await fetch(downloadUrl);
        if (vidRes.ok) {
          const arrayBuf = await vidRes.arrayBuffer();
          const b64 = Buffer.from(arrayBuf).toString('base64');
          return NextResponse.json({
            done: true,
            videoDataUrl: `data:video/mp4;base64,${b64}`,
          });
        }
      }

      return NextResponse.json(
        {
          done: true,
          error: 'Nessun file video restituito da Veo 3.1.',
        },
        { status: 500 }
      );
    }

    // AZIONE 1: AVVIO GENERAZIONE VIDEO REALE CON GOOGLE VEO 3.1 ("Ingredients to Video")
    const {
      visualPromptEn = '',
      dialogueIta = '',
      speakerName = '',
      characterNames = [],
      aspectRatio = '9:16',
      referenceImagesBase64 = [],
    } = body;

    const cleanDialogue = dialogueIta
      .trim()
      .replace(/^["“«]+|["”»]+$/g, '')
      .trim();

    // Costruiamo il prompt cinematografico con dialogo parlato nativo in italiano esattamente come fa l'app Gemini Web con Veo 3.1
    const fullVeoPrompt = [
      `Using the exact subjects from the provided reference photos (${characterNames.join(', ') || speakerName || 'the cast'}), create a realistic live-action animated video where the actors interact naturally with fluid movement and realistic facial expressions.`,
      visualPromptEn,
      cleanDialogue
        ? `${speakerName || 'The character'} speaks clearly in native Italian with natural lip-sync and expressive voice: "${cleanDialogue}"`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const parsedRefs = referenceImagesBase64
      .slice(0, 3)
      .map((r) => parseDataUrl(r))
      .filter(
        (r): r is { mimeType: string; data: string } => Boolean(r)
      );

    const veoModels = [
      'veo-3.1-generate-preview',
      'veo-3.0-generate-001',
      'veo-3.0-fast-generate-001',
      'veo-2.0-generate-001',
    ];

    let lastError = '';

    for (const modelName of veoModels) {
      try {
        // Per veo-3.1-generate-preview possiamo passare fino a 3 foto soggetto in referenceImages (Ingredients to Video)
        const isVeo31 = modelName.startsWith('veo-3.1');
        const operation = await ai.models.generateVideos({
          model: modelName,
          prompt: fullVeoPrompt,
          ...( !isVeo31 && parsedRefs[0]
            ? {
                image: {
                  imageBytes: parsedRefs[0].data,
                  mimeType: parsedRefs[0].mimeType,
                },
              }
            : {}),
          config: {
            aspectRatio: isVeo31 && parsedRefs.length > 1 ? '16:9' : aspectRatio,
            ...(isVeo31 && parsedRefs.length > 0
              ? {
                  referenceImages: parsedRefs.map((ref) => ({
                    image: {
                      imageBytes: ref.data,
                      mimeType: ref.mimeType,
                    },
                    referenceType: VideoGenerationReferenceType.ASSET,
                  })),
                }
              : {}),
          },
        });

        if (operation?.name) {
          return NextResponse.json({
            ok: true,
            operationName: operation.name,
            modelUsed: modelName,
          });
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // Se la chiave attuale inizia con "AQ." (Vertex Express Mode che blocca PredictLongRunning), restituiamo il motivo esatto
    const isBlockedVertexExpressKey = apiKey.startsWith('AQ.');
    return NextResponse.json(
      {
        ok: false,
        veoBlockedByKeyType: isBlockedVertexExpressKey,
        error: isBlockedVertexExpressKey
          ? 'La chiave attuale (AQ.Ab8RN...) è una chiave Vertex Express con PredictLongRunning bloccato da Google Cloud (API_KEY_SERVICE_BLOCKED). Inserisci una chiave Google AI Studio (AIzaSy...) per sbloccare Google Veo 3.1!'
          : `Impossibile avviare Veo 3.1: ${lastError}`,
      },
      { status: 403 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

