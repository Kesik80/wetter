// api/voices.js — возвращает список Default voices ElevenLabs доступных на free tier
// Вызывается при загрузке страницы, результат кэшируется в браузере 1 час

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVEN_API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }

  try {
    // Запрашиваем все голоса пользователя
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': ELEVEN_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'ElevenLabs API error', status: response.status });
    }

    const data = await response.json();

    // Фильтруем только Default voices (category === 'premade')
    // Это именно те голоса, что доступны на бесплатном плане через API
    const defaultVoices = data.voices
      .filter(v => v.category === 'premade')
      .map(v => ({
        voice_id: v.voice_id,
        name: v.name,
        gender: v.labels?.gender || '',
        accent: v.labels?.accent || '',
        description: v.labels?.description || '',
        age: v.labels?.age || '',
        preview_url: v.preview_url || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Кэшируем ответ в браузере на 1 час
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({ voices: defaultVoices, total: defaultVoices.length });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
