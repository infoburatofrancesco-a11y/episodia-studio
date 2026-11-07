import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 60;

const LTX_SPACE_BASE = 'https://lightricks-ltx-video-distilled.hf.space';

interface I2VRequestBody {
  frameImageBase64: string;
  visualPromptEn?: string;
  speakerName?: string;
  characterNames?: string[];
  aspectRatio?: '9:16' | '16:9';
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

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(sub));
  }
  return btoa(binary);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as I2VRequestBody;
    const {
      frameImageBase64,
      visualPromptEn = '',
      speakerName = 'The character',
      characterNames = [],
      aspectRatio = '9:16',
    } = body;

    const parsed = parseDataUrl(frameImageBase64);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Immagine sorgente non valida per Image-to-Video.' },
        { status: 400 }
      );
    }

    const imgBytes = base64ToUint8Array(parsed.data);
    const formData = new FormData();
    formData.append(
      'files',
      new Blob([imgBytes.buffer as ArrayBuffer], { type: parsed.mimeType }),
      'frame.jpg'
    );

    const uploadRes = await fetch(`${LTX_SPACE_BASE}/gradio_api/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok) {
      return NextResponse.json(
        { error: `Upload I2V non riuscito (${uploadRes.status})` },
        { status: 502 }
      );
    }

    const uploadJson = (await uploadRes.json()) as string[];
    const uploadedFilePath = uploadJson?.[0];
    if (!uploadedFilePath) {
      return NextResponse.json(
        { error: 'Percorso file I2V mancante.' },
        { status: 502 }
      );
    }

    const heightUi = aspectRatio === '9:16' ? 704 : 512;
    const widthUi = aspectRatio === '9:16' ? 512 : 704;

    const motionPrompt = `${
      characterNames.length > 1
        ? `The people (${characterNames.join(', ')}) in the image interact naturally with each other; ${speakerName} speaks expressively to the camera with fluid mouth movement, natural head nods, and lively hand gestures.`
        : `${speakerName} in the image speaks expressively to the camera with fluid mouth movement, natural head nods, blinking eyes, and lively hand gestures.`
    } ${visualPromptEn}. Photorealistic, smooth 24fps live-action video motion.`;

    const startRes = await fetch(
      `${LTX_SPACE_BASE}/gradio_api/call/image_to_video`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            motionPrompt,
            'worst quality, inconsistent motion, blurry, jittery, distorted, static, morphing face',
            {
              path: uploadedFilePath,
              orig_name: 'frame.jpg',
              mime_type: parsed.mimeType,
              meta: { _type: 'gradio.FileData' },
            },
            null,
            heightUi,
            widthUi,
            'image-to-video',
            6,
            9,
            42,
            true,
            1,
            true,
          ],
        }),
      }
    );

    if (!startRes.ok) {
      return NextResponse.json(
        { error: `Avvio I2V non riuscito (${startRes.status})` },
        { status: 502 }
      );
    }

    const startJson = (await startRes.json()) as { event_id?: string };
    if (!startJson.event_id) {
      return NextResponse.json(
        { error: 'Nessun event_id restituito da I2V.' },
        { status: 502 }
      );
    }

    const sseRes = await fetch(
      `${LTX_SPACE_BASE}/gradio_api/call/image_to_video/${startJson.event_id}`
    );
    const sseText = await sseRes.text();

    // Estraiamo l'URL del file MP4 dall'evento SSE "event: complete\ndata: [...]"
    const dataMatch = sseText.match(/event:\s*complete[\s\S]*?data:\s*(\[[\s\S]*?\])\r?\n/);
    if (!dataMatch) {
      return NextResponse.json(
        { error: 'Generazione I2V non completata.' },
        { status: 502 }
      );
    }

    const parsedData = JSON.parse(dataMatch[1]);
    const videoObj = parsedData?.[0]?.video;
    const videoUrl: string | undefined =
      videoObj?.url ||
      (videoObj?.path
        ? `${LTX_SPACE_BASE}/gradio_api/file=${videoObj.path}`
        : undefined);

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'URL video MP4 non trovato nella risposta I2V.' },
        { status: 502 }
      );
    }

    const mp4Res = await fetch(videoUrl);
    if (!mp4Res.ok) {
      return NextResponse.json(
        { error: 'Download MP4 I2V non riuscito.' },
        { status: 502 }
      );
    }

    const mp4Buf = await mp4Res.arrayBuffer();
    const mp4Base64 = uint8ArrayToBase64(new Uint8Array(mp4Buf));

    return NextResponse.json({
      ok: true,
      videoDataUrl: `data:video/mp4;base64,${mp4Base64}`,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
