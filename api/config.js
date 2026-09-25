export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const mode = process.env.APP_MODE === 'local' ? 'local' : 'strava';

  if (mode === 'local') {
    // Local mode never talks to Strava, so no client id is needed.
    return res.status(200).json({ mode });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({
      error: 'Missing STRAVA_CLIENT_ID. Configure it in .env.local or Vercel environment variables.'
    });
  }

  return res.status(200).json({
    mode,
    stravaClientId: clientId
  });
}
