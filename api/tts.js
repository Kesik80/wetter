// api/tts.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, id } = req.body;
  
  if (!text || !id) {
    return res.status(400).json({ error: 'Text and ID required' });
  }

  // ═══════════════════════════════════════════════════
  // ТВОИ ДАННЫЕ:
  const REPO_OWNER = 'kesik80';
  const REPO_NAME = 'wetter';
  // ═══════════════════════════════════════════════════

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
  const AUDIO_PATH = `audio/weather_${id}.mp3`;

  // Проверка ключей
  if (!ELEVEN_API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  try {
    // 1. Проверяем, есть ли уже файл в репозитории
    const checkRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${AUDIO_PATH}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    // Если файл существует - возвращаем его URL
    if (checkRes.status === 200) {
      const fileData = await checkRes.json();
      return res.json({ 
        url: fileData.download_url, 
        cached: true 
      });
    }

    // 2. Генерируем аудио через ElevenLabs
    const elevenRes = await fetch('https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB', {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVEN_API_KEY
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!elevenRes.ok) {
      const errorText = await elevenRes.text();
      throw new Error(`ElevenLabs error: ${elevenRes.status} - ${errorText}`);
    }

    const audioBuffer = await elevenRes.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    // 3. Сохраняем в GitHub
    const createRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${AUDIO_PATH}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          message: `Add TTS: ${text.substring(0, 50)}...`,
          content: base64Audio,
          branch: 'main'
        })
      }
    );

    if (!createRes.ok) {
      const ghError = await createRes.text();
      throw new Error(`GitHub error: ${createRes.status} - ${ghError}`);
    }

    const result = await createRes.json();
    
    return res.json({ 
      url: result.content.download_url, 
      cached: false 
    });

  } catch (error) {
    console.error('TTS Error:', error);
    res.status(500).json({ error: error.message });
  }
}

