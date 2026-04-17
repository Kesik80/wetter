export default async function handler(req, res) {
  console.log('=== TTS API Called ===');
  console.log('Method:', req.method);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, id } = req.body;
  console.log('Request:', { text: text?.substring(0, 30), id });
  
  if (!text || !id) {
    return res.status(400).json({ error: 'Text and ID required' });
  }

  // Безопасное имя файла
  const safeId = id.replace(/[^a-z0-9_-]/gi, '').substring(0, 50);
  console.log('Safe ID:', safeId);

  const REPO_OWNER = 'kesik80';
  const REPO_NAME = 'wetter';
  
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  console.log('GITHUB_TOKEN exists:', !!GITHUB_TOKEN);
  console.log('ELEVEN_API_KEY exists:', !!ELEVEN_API_KEY);
  console.log('ELEVEN_API_KEY prefix:', ELEVEN_API_KEY?.substring(0, 10));

  if (!ELEVEN_API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  const AUDIO_PATH = `audio/${safeId}.mp3`;

  try {
    // 1. Проверяем кэш в GitHub
    console.log('Checking GitHub cache...');
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

    if (checkRes.status === 200) {
      const fileData = await checkRes.json();
      console.log('Found in cache');
      return res.json({ url: fileData.download_url, cached: true });
    }
    console.log('Not in cache, generating...');

    // 2. Генерируем через ElevenLabs
    const voiceId = 'rDmv3mOhK6TnhYWckFaD';
    const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    console.log('ElevenLabs URL:', elevenUrl);
    
    const requestBody = {
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    };
    console.log('Request body:', JSON.stringify(requestBody).substring(0, 100));

    const elevenRes = await fetch(elevenUrl, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVEN_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    console.log('ElevenLabs status:', elevenRes.status);

    if (!elevenRes.ok) {
      const errorText = await elevenRes.text();
      console.error('ElevenLabs error:', errorText);
      return res.status(500).json({ 
        error: 'ElevenLabs error', 
        status: elevenRes.status,
        details: errorText 
      });
    }

    const audioBuffer = await elevenRes.arrayBuffer();
    console.log('Audio received, size:', audioBuffer.byteLength);
    
    if (audioBuffer.byteLength === 0) {
      return res.status(500).json({ error: 'Empty audio response' });
    }

    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    console.log('Base64 length:', base64Audio.length);

    // 3. Сохраняем в GitHub
    console.log('Saving to GitHub...');
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

    console.log('GitHub status:', createRes.status);

    if (!createRes.ok) {
      const ghError = await createRes.text();
      console.error('GitHub error:', ghError);
      return res.status(500).json({ 
        error: 'GitHub error', 
        status: createRes.status,
        details: ghError
      });
    }

    const result = await createRes.json();
    console.log('Success! URL:', result.content.download_url);
    
    return res.json({ 
      url: result.content.download_url, 
      cached: false 
    });

  } catch (error) {
    console.error('Catch error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}
