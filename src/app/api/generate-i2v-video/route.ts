import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 60;

interface I2VRequestBody {
  frameImageBase64: string;
  visualPromptEn?: string;
  dialogueIta?: string;
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

async function uploadImageToGradioSpace(
  spaceBase: string,
  imgBytes: Uint8Array,
  mimeType: string
): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append(
      'files',
      new Blob([imgBytes.buffer as ArrayBuffer], { type: mimeType }),
      'frame.jpg'
    );
    const uploadRes = await fetch(`${spaceBase}/gradio_api/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!uploadRes.ok) return null;
    const uploadJson = (await uploadRes.json()) as string[];
    return uploadJson?.[0] || null;
  } catch {
    return null;
  }
}

async function runGradioSpaceI2V(
  spaceBase: string,
  endpointName: string,
  dataPayload: unknown[]
): Promise<string | null> {
  try {
    const startRes = await fetch(
      `${spaceBase}/gradio_api/call/${endpointName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataPayload }),
      }
    );
    if (!startRes.ok) return null;

    const startJson = (await startRes.json()) as { event_id?: string };
    if (!startJson.event_id) return null;

    const sseRes = await fetch(
      `${spaceBase}/gradio_api/call/${endpointName}/${startJson.event_id}`
    );
    if (!sseRes.ok) return null;

    const sseText = await sseRes.text();
    const dataMatch = sseText.match(
      /event:\s*complete[\s\S]*?data:\s*(\[[\s\S]*?\])\r?\n/
    );
    if (!dataMatch) return null;

    const parsedData = JSON.parse(dataMatch[1]);
    const firstItem = parsedData?.[0];
    const videoObj = firstItem?.video || firstItem;
    const videoUrl: string | undefined =
      videoObj?.url ||
      (videoObj?.path
        ? `${spaceBase}/gradio_api/file=${videoObj.path}`
        : undefined);

    if (!videoUrl) return null;

    const mp4Res = await fetch(videoUrl);
    if (!mp4Res.ok) return null;

    const mp4Buf = await mp4Res.arrayBuffer();
    if (mp4Buf.byteLength < 5000) return null;

    const mp4Base64 = uint8ArrayToBase64(new Uint8Array(mp4Buf));
    return `data:video/mp4;base64,${mp4Base64}`;
  } catch {
    return null;
  }
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
    const heightUi = aspectRatio === '9:16' ? 704 : 512;
    const widthUi = aspectRatio === '9:16' ? 512 : 704;

    const cleanContext = visualPromptEn
      .replace(/casual indoor bathrobe\/homewear/gi, '')
      .slice(0, 220);

    const motionPrompt = `${
      characterNames.length > 1
        ? `Real-time normal speed live-action video: the exact people (${characterNames.join(', ')}) from the image interact naturally together; ${speakerName} speaks expressively to the camera with natural mouth movement, lively hand gestures, and warm facial expressions while the others react and smile.`
        : `Real-time normal speed live-action video: ${speakerName} from the image speaks expressively to the camera with natural mouth movement, head nods, blinking eyes, and lively hand gestures.`
    } Keep the exact facial features, hair, and clothing from the starting image unchanged. ${cleanContext}`;

    const negativePrompt =
      'slow motion, slow-mo, worst quality, inconsistent motion, blurry, jittery, distorted, morphing face, deformed face, static photo';

    // MOTORE 1: DeepRat LTX-Video ZeroGPU Optimized (single-pass improve_texture=false per preservare il volto 1:1 e velocità reale slow_motion=false)
    {
      const base = 'https://deeprat-ltx-video-zerogpu-optimized.hf.space';
      const uploadedPath = await uploadImageToGradioSpace(
        base,
        imgBytes,
        parsed.mimeType
      );
      if (uploadedPath) {
        const videoDataUrl = await runGradioSpaceI2V(base, 'image_to_video', [
          motionPrompt,
          negativePrompt,
          {
            path: uploadedPath,
            orig_name: 'frame.jpg',
            mime_type: parsed.mimeType,
            meta: { _type: 'gradio.FileData' },
          },
          null,
          heightUi,
          widthUi,
          'image-to-video',
          4.0,
          9,
          42,
          true,
          1.0,
          false, // improve_texture_flag = false -> NON altera il volto della foto di partenza e usa metà quota GPU!
          false, // slow_motion_flag = false -> Velocità reale 1.0x!
        ]);
        if (videoDataUrl) {
          return NextResponse.json({
            ok: true,
            videoDataUrl,
            engine: 'ltx-deeprat-realtime',
          });
        }
      }
    }

    // MOTORE 2: Upsampler LTX 2.3 22B Distilled (ImageConditioningInput strength=1.0, zero rumore sul volto)
    {
      const base = 'https://upsampler-ltx-video.hf.space';
      const uploadedPath = await uploadImageToGradioSpace(
        base,
        imgBytes,
        parsed.mimeType
      );
      if (uploadedPath) {
        const h23 = aspectRatio === '9:16' ? 768 : 512;
        const w23 = aspectRatio === '9:16' ? 512 : 768;
        const videoDataUrl = await runGradioSpaceI2V(base, 'generate_video', [
          {
            path: uploadedPath,
            orig_name: 'frame.jpg',
            mime_type: parsed.mimeType,
            meta: { _type: 'gradio.FileData' },
          },
          motionPrompt,
          3.5,
          false,
          42,
          true,
          h23,
          w23,
        ]);
        if (videoDataUrl) {
          return NextResponse.json({
            ok: true,
            videoDataUrl,
            engine: 'ltx-2.3-distilled',
          });
        }
      }
    }

    // MOTORE 3: Lightricks LTX-Video Distilled (single-pass improve_texture=false per preservare il volto 1:1)
    {
      const base = 'https://lightricks-ltx-video-distilled.hf.space';
      const uploadedPath = await uploadImageToGradioSpace(
        base,
        imgBytes,
        parsed.mimeType
      );
      if (uploadedPath) {
        const videoDataUrl = await runGradioSpaceI2V(base, 'image_to_video', [
          motionPrompt,
          negativePrompt,
          {
            path: uploadedPath,
            orig_name: 'frame.jpg',
            mime_type: parsed.mimeType,
            meta: { _type: 'gradio.FileData' },
          },
          null,
          heightUi,
          widthUi,
          'image-to-video',
          4.0,
          9,
          42,
          true,
          1.0,
          false, // improve_texture_flag = false -> preserva il volto 1:1!
        ]);
        if (videoDataUrl) {
          return NextResponse.json({
            ok: true,
            videoDataUrl,
            engine: 'ltx-lightricks-singlepass',
          });
        }
      }
    }

    // MOTORE 4: Wan 2.2 I2V Lightning 4-Step
    {
      const base = 'https://saravutw-wan2-2-i2v-lightning-4-8step-custom.hf.space';
      const uploadedPath = await uploadImageToGradioSpace(
        base,
        imgBytes,
        parsed.mimeType
      );
      if (uploadedPath) {
        const fileObj = {
          path: uploadedPath,
          orig_name: 'frame.jpg',
          mime_type: parsed.mimeType,
          meta: { _type: 'gradio.FileData' },
        };
        const videoDataUrl = await runGradioSpaceI2V(base, 'generate_video', [
          fileObj,
          null,
          motionPrompt,
          4,
          negativePrompt,
          3.5,
          1,
          1,
          42,
          true,
          5,
          'UniPCMultistep',
          3,
          '16',
          false,
          true,
        ]);
        if (videoDataUrl) {
          return NextResponse.json({
            ok: true,
            videoDataUrl,
            engine: 'wan-2.2-lightning',
          });
        }
      }
    }

    return NextResponse.json(
      { error: 'Tutti i motori Image-to-Video sono momentaneamente occupati.' },
      { status: 502 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
