// api/tts.js — Vercel Serverless Function
// Поддерживает выбор голоса ElevenLabs + кэш в GitHub по голосу

const REPO_OWNER = 'kesik80';
const REPO_NAME  = 'wetter';

// Разрешённые бесплатные голоса ElevenLabs
// Default voices — гарантированно доступны на free tier
const ALLOWED_VOICES = {
  'CwhRBWXzGAHq8TQ4Fs17': 'Roger',
  'FGY2WhTYpPnrIDTdsKH5': 'Laura',
  'TX3LPaxmHKxFdv7VOQHJ': 'Liam',
  'XrExE9yKIg1WjnnlVkGX': 'Matilda',
  'bIHbv24MWmeRgasZH58o': 'Will',
  'cgSgspJ2msm6clMCkdW9': 'Jessica',
  'cjVigY5qzO86Huf0OWal': 'Eric',
  'nPczCjzI2devNBz1zQrb': 'Brian',
  'onwK4e9ZLuTAKqWW03F9': 'Daniel',
  'pFZP5JQG7iQjIQuC4Bku': 'Lily',
  'pqHfZKP75CvOlQylNhV4': 'Bill',
  // My Voices (сохранённые — работают если аккаунт их поддерживает)
  'AnvlJBAqSLDzEevYr9Ap': 'Ava',
  'rDmv3mOhK6TnhYWckFaD': 'Felix Serenitas',
  'J5U94vRbS9drxnawJcoc': 'Herr Gruber',
  '7eVMgwCnXydb3CikjV7a': 'Lea',
  'dCnu06FiOZma2KVNUoPZ': 'Mila Winter',
  'lx8LAX2EUAKftVz0Dk5z': 'Juan Schubert Pro',
};

const DEFAULT_VOICE = 'CwhRBWXzGAHq8TQ4Fs17'; // Roger

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, voiceId } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  // Валидация голоса — только из белого списка
  const safeVoiceId = ALLOWED_VOICES[voiceId] ? voiceId : DEFAULT_VOICE;
  const voiceName   = ALLOWED_VOICES[safeVoiceId].toLowerCase();

  // Читаемое имя файла из текста: "die Wettervorhersage" → "die_Wettervorhersage_(Liam).mp3"
  function makeReadableFilename(text, voice) {
    const clean = text
      .trim()
      .replace(/\s+/g, '_')          // пробелы → подчёркивания
      .replace(/[^a-zA-Z0-9_äöüÄÖÜß]/g, '') // убираем спецсимволы кроме немецких букв
      .substring(0, 60);
    return `${clean}_(${voice}).mp3`;
  }

  const filename = makeReadableFilename(text, ALLOWED_VOICES[safeVoiceId]);
  // Путь: audio/bella/die_Wettervorhersage_(Bella).mp3
  const AUDIO_PATH = `audio/${voiceName}/${filename}`;

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

