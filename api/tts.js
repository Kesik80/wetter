// api/tts.js — Vercel Serverless Function
// Поддерживает выбор голоса ElevenLabs + кэш в GitHub по голосу

const REPO_OWNER = 'kesik80';
const REPO_NAME  = 'wetter';

// Разрешённые бесплатные голоса ElevenLabs
const ALLOWED_VOICES = {
  'EXAVITQu4vr4xnSDxMaL': 'Bella',
  'pNInz6obpgDQGcFmaJgB': 'Adam',
  'ErXwobaYiN019PkySvjV': 'Antoni',
  'VR6AewLTigWG4xSOukaG': 'Arnold',
  'yoZ06aMxZJJ28mfd3POQ': 'Sam',
  '21m00Tcm4TlvDq8ikWAM': 'Rachel',
};

const DEFAULT_VOICE = 'EXAVITQu4vr4xnSDxMaL'; // Bella

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, id, voiceId } = req.body;

  if (!text || !id) {
    return res.status(400).json({ error: 'Text and ID required' });
  }

  // Валидация голоса — только из белого списка
  const safeVoiceId = ALLOWED_VOICES[voiceId] ? voiceId : DEFAULT_VOICE;
  const voiceName   = ALLOWED_VOICES[safeVoiceId].toLowerCase();

  // Безопасное имя файла
  const safeId = id.replace(/[^a-z0-9_-]/gi, '').substring(0, 80);

  // Путь кэша включает имя голоса: audio/bella/das_wetter_xxxx.mp3
  const AUDIO_PATH = `audio/${voiceName}/${safeId}.mp3`;

  const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
  const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;

  if (!ELEVEN_API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  const githubHeaders = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // ── 1. Проверяем кэш в GitHub ──────────────────────────────
    const checkRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${AUDIO_PATH}`,
      { headers: githubHeaders }
    );

    if (checkRes.status === 200) {
      const fileData = await checkRes.json();
      return res.json({
        url: fileData.download_url,
        cached: true,
        voice: voiceName,
      });
    }

    // ── 2. Генерируем через ElevenLabs ─────────────────────────
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${safeVoiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVEN_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elevenRes.ok) {
      const errorText = await elevenRes.text();
      return res.status(502).json({
        error: 'ElevenLabs error',
        status: elevenRes.status,
        details: errorText,
      });
    }

    const audioBuffer = await elevenRes.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    // ── 3. Сохраняем в GitHub ──────────────────────────────────
    const createRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${AUDIO_PATH}`,
      {
        method: 'PUT',
        headers: { ...githubHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `TTS [${voiceName}]: ${text.substring(0, 50)}`,
          content: base64Audio,
          branch: 'main',
        }),
      }
    );

    if (!createRes.ok) {
      const errBody = await createRes.text();
      return res.status(502).json({
        error: 'GitHub save error',
        status: createRes.status,
        details: errBody,
      });
    }

    const result = await createRes.json();
    return res.json({
      url: result.content.download_url,
      cached: false,
      voice: voiceName,
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
