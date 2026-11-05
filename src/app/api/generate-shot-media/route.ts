import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Estende il timeout delle Serverless Functions su Vercel fino a 60 secondi
export const maxDuration = 60;

const GOOGLE_CLOUD_PROJECT_NUMBER = '444672191323';

interface GenerateShotMediaBody {
  visualPromptEn: string;
  dialogueIta?: string;
  speakerName?: string;
  speakerCategory?: 'human' | 'animal';
  aspectRatio?: '9:16' | '16:9';
  referenceImagesBase64?: string[];
  shotNumber?: number;
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

// Converte audio PCM 16-bit 24kHz mono (restituito da Gemini TTS) in un file WAV standard Base64
function pcm24kMonoToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  const pcmBuffer = Buffer.from(pcmBase64, 'base64');
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + dataSize, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(dataSize, 40);

  const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
  return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
}

const VOICE_POOL = ['Puck', 'Kore', 'Aoede', 'Charon', 'Fenrir'];

function pickVoiceForSpeaker(speakerName?: string): string {
  if (!speakerName) return 'Puck';
  let hash = 0;
  for (let i = 0; i < speakerName.length; i++) {
    hash = (hash * 31 + speakerName.charCodeAt(i)) % 1000;
  }
  return VOICE_POOL[hash % VOICE_POOL.length];
}

async function generateSingleNanoBananaFrame(
  ai: GoogleGenAI,
  refParts: Array<{ inlineData: { mimeType: string; data: string } }>,
  promptText: string
): Promise<string | null> {
  const nanoBananaModels = [
    'gemini-nano-banana-2.1',
    'nano-banana-pro-preview',
    'gemini-3.1-flash-image',
    'gemini-2.5-flash-image',
  ];

  for (const modelName of nanoBananaModels) {
    try {
      const res = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [...refParts, { text: promptText }],
          },
        ],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      });

      const parts = res.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (
          p.inlineData?.data &&
          p.inlineData?.mimeType?.startsWith('image/')
        ) {
          return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
        }
      }
    } catch (err) {
      console.warn(`Fallback Nano Banana model (${modelName}):`, err);
    }
  }
  return null;
}

/**
 * Converte il fotogramma generato da Nano Banana in un VERO VIDEO MP4 ANIMATO FLUIDO
 * tramite Google Veo 3 (Vertex AI Image-to-Video) sul progetto Cloud 444672191323.
 */
async function tryGenerateFluidVeoVideoFromFrame(
  apiKey: string,
  frameDataUrl: string,
  visualPromptEn: string,
  dialogueIta: string | undefined,
  aspectRatio: '9:16' | '16:9'
): Promise<{ videoBase64: string | null; vertexNotice?: string }> {
  const parsed = parseDataUrl(frameDataUrl);
  if (!parsed) return { videoBase64: null };

  const veoModels = [
    'veo-3.0-fast-generate-001',
    'veo-3.0-generate-001',
    'veo-2.0-generate-001',
  ];

  const fullPrompt = dialogueIta?.trim()
    ? `${visualPromptEn}. Natural fluid human/animal movement, expressive gesturing and speaking in Italian: "${dialogueIta.trim()}"`
    : `${visualPromptEn}. Natural fluid character movement and expressive acting.`;

  for (const veoModel of veoModels) {
    try {
      const startUrl = `https://aiplatform.googleapis.com/v1beta1/projects/${GOOGLE_CLOUD_PROJECT_NUMBER}/locations/us-central1/publishers/google/models/${veoModel}:predictLongRunning?key=${apiKey}`;

      const startRes = await fetch(startUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [
            {
              prompt: fullPrompt,
              image: {
                bytesBase64Encoded: parsed.data,
                mimeType: parsed.mimeType,
              },
            },
          ],
          parameters: {
            aspectRatio,
            sampleCount: 1,
            durationSeconds: 5,
            personGeneration: 'allow_all',
          },
        }),
      });

      if (!startRes.ok) {
        const errText = await startRes.text();
        if (errText.includes('SERVICE_DISABLED') || startRes.status === 403) {
          return {
            videoBase64: null,
            vertexNotice: `Per il movimento video fluido nativo con Google Veo 3 abilita con 1 clic l'API Vertex AI sul tuo progetto Google Cloud: https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=${GOOGLE_CLOUD_PROJECT_NUMBER}`,
          };
        }
        continue;
      }

      const opData = await startRes.json();
      const opName: string | undefined = opData.name;
      if (!opName) continue;

      // Polling dell'operazione Veo 3 (fino a ~42 secondi)
      const fetchOpUrl = `https://aiplatform.googleapis.com/v1beta1/projects/${GOOGLE_CLOUD_PROJECT_NUMBER}/locations/us-central1/publishers/google/models/${veoModel}:fetchPredictOperation?key=${apiKey}`;

      for (let attempt = 0; attempt < 14; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollRes = await fetch(fetchOpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationName: opName }),
        });

        if (!pollRes.ok) continue;
        const pollJson = await pollRes.json();
        if (pollJson.done) {
          const videos =
            pollJson.response?.videos ||
            pollJson.response?.generatedSamples ||
            [];
          const firstVid = videos[0]?.video || videos[0];
          if (firstVid?.bytesBase64Encoded) {
            const mime = firstVid.mimeType || 'video/mp4';
            return {
              videoBase64: `data:${mime};base64,${firstVid.bytesBase64Encoded}`,
            };
          }
          break;
        }
      }
    } catch (veoErr) {
      console.warn(`Fallback da Veo (${veoModel}):`, veoErr);
    }
  }

  return { videoBase64: null };
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'inserisci_qui_la_tua_chiave_gemini') {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY mancante in .env.local o su Vercel.' },
        { status: 500 }
      );
    }

    const body = (await req.json()) as GenerateShotMediaBody;
    const {
      visualPromptEn,
      dialogueIta,
      speakerName,
      aspectRatio = '9:16',
      referenceImagesBase64 = [],
    } = body;

    const ai = new GoogleGenAI({ apiKey });

    const refParts: Array<{ inlineData: { mimeType: string; data: string } }> =
      [];
    for (const refImg of referenceImagesBase64.slice(0, 2)) {
      const parsed = parseDataUrl(refImg);
      if (parsed) {
        refParts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      }
    }

    const orientationLabel =
      aspectRatio === '9:16'
        ? 'vertical 9:16 portrait smartphone social format'
        : 'horizontal 16:9 widescreen cinematic format';

    const beatPrompts = [
      `Generate a photorealistic cinematic TV series frame in ${orientationLabel}. Keep the exact face and identity of the reference character photo(s). Scene: ${visualPromptEn}. Pose A: Character is looking at the camera, gesturing naturally with hands and speaking with mouth open. No text overlays.`,
      `Generate a photorealistic cinematic TV series frame in ${orientationLabel} in the exact same room and lighting. Keep the exact face and identity of the reference character photo(s). Scene: ${visualPromptEn}. Pose B: Character shifts posture dynamically with an expressive comedic facial reaction and animated gesture. No text overlays.`,
    ];

    const [frame1, frame2, audioWavBase64] = await Promise.all([
      generateSingleNanoBananaFrame(ai, refParts, beatPrompts[0]),
      generateSingleNanoBananaFrame(ai, refParts, beatPrompts[1]),
      (async (): Promise<string | null> => {
        if (!dialogueIta || !dialogueIta.trim()) return null;
        const voiceName = pickVoiceForSpeaker(speakerName);
        const ttsModels = [
          'gemini-3.8-flash-tts',
          'gemini-2.5-flash-preview-tts',
          'gemini-3.8-flash-lite-tts',
        ];
        for (const ttsModel of ttsModels) {
          try {
            const ttsRes = await ai.models.generateContent({
              model: ttsModel,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: `Recita in italiano in modo espressivo, brillante e naturale questa battuta (massimo 5 secondi): "${dialogueIta.trim()}"`,
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName,
                    },
                  },
                },
              },
            });

            const audioPart = ttsRes.candidates?.[0]?.content?.parts?.find(
              (p) => p.inlineData?.data
            );
            if (audioPart?.inlineData?.data) {
              const mime =
                audioPart.inlineData.mimeType || 'audio/L16;rate=24000';
              if (mime.includes('wav')) {
                return `data:audio/wav;base64,${audioPart.inlineData.data}`;
              }
              return pcm24kMonoToWavBase64(audioPart.inlineData.data, 24000);
            }
          } catch (ttsErr) {
            console.warn(`Fallback modello TTS (${ttsModel}):`, ttsErr);
          }
        }
        return null;
      })(),
    ]);

    const framesBase64 = [frame1, frame2].filter((f): f is string =>
      Boolean(f)
    );

    if (framesBase64.length === 0 && referenceImagesBase64.length > 0) {
      framesBase64.push(...referenceImagesBase64.slice(0, 2));
    }

    // Se abbiamo il fotogramma generato da Nano Banana, proviamo a convertirlo in un vero video MP4 fluido con Veo 3!
    let veoVideoBase64: string | null = null;
    let vertexNotice: string | undefined;
    if (framesBase64[0]) {
      const veoResult = await tryGenerateFluidVeoVideoFromFrame(
        apiKey,
        framesBase64[0],
        visualPromptEn,
        dialogueIta,
        aspectRatio
      );
      veoVideoBase64 = veoResult.videoBase64;
      vertexNotice = veoResult.vertexNotice;
    }

    return NextResponse.json({
      frameImageBase64: framesBase64[0] || null,
      framesBase64,
      audioWavBase64,
      veoVideoBase64,
      vertexNotice,
      modelUsed: veoVideoBase64
        ? 'gemini-nano-banana-2.1 + veo-3.0-fast-generate-001'
        : 'gemini-nano-banana-2.1',
    });
  } catch (error: unknown) {
    console.error('Errore in /api/generate-shot-media:', error);
    const msg =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto durante la generazione Nano Banana + Veo dello shot.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
