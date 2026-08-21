import { env } from "../config.js";

/**
 * Speech-to-text via Groq's OpenAI-compatible Whisper endpoint (same API key
 * as the chat model). Feeds the exact same order pipeline as typed messages:
 * voice note -> transcript -> AI parse -> human approval.
 */
export type TranscribeInput = {
  buffer: Buffer;
  filename: string;
  mime?: string;
};

export class TranscribeError extends Error {
  constructor(
    message: string,
    readonly stage: "not_configured" | "http" | "empty" | "bad_input",
  ) {
    super(message);
  }
}

const MAX_BYTES = 25 * 1024 * 1024;

export async function transcribeAudio(input: TranscribeInput): Promise<{ text: string }> {
  if (!env.llmApiKey) throw new TranscribeError("LLM_API_KEY is not set", "not_configured");
  if (!input.buffer || input.buffer.length < 512) {
    throw new TranscribeError("audio file too small or empty", "bad_input");
  }
  if (input.buffer.length > MAX_BYTES) {
    throw new TranscribeError("audio file exceeds the 25MB transcription limit", "bad_input");
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.buffer)], { type: input.mime || "application/octet-stream" });
  form.append("file", blob, input.filename || "audio.ogg");
  form.append("model", env.whisperModel);
  form.append("response_format", "json");
  form.append("temperature", "0");

  let res: Response;
  try {
    res = await fetch(`${env.llmBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.llmApiKey}` },
      body: form,
    });
  } catch (err) {
    throw new TranscribeError(
      `transcription request failed: ${err instanceof Error ? err.message : String(err)}`,
      "http",
    );
  }

  if (!res.ok) {
    throw new TranscribeError(`Whisper HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, "http");
  }

  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) throw new TranscribeError("transcription came back empty", "empty");

  return { text };
}
