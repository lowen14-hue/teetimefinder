import express from 'express';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(process.cwd()));

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const timeLabels = {
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  sunset: 'Sunset',
};

function getTimeLabel(value) {
  return timeLabels[value] || 'Morning';
}

async function geocodeZip(zip) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&postalcode=${encodeURIComponent(zip)}&countrycodes=us&limit=1`
  );

  if (!response.ok) {
    throw new Error('ZIP lookup failed');
  }

  const data = await response.json();
  if (!data || !data.length) {
    throw new Error('ZIP code not found');
  }

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
  };
}

async function fetchNearbyCourses(lat, lon, radiusMiles) {
  const radiusMeters = Math.round(radiusMiles * 1609.34);
  const query = `
    [out:json][timeout:25];
    (
      node["leisure"="golf_course"](around:${radiusMeters},${lat},${lon});
      way["leisure"="golf_course"](around:${radiusMeters},${lat},${lon});
      relation["leisure"="golf_course"](around:${radiusMeters},${lat},${lon});
    );
    out center;
  `;

  const response = await fetch(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const elements = data.elements || [];

  return elements
    .map((element) => {
      const center = element.center || element;
      return {
        id: element.id,
        lat: center.lat,
        lon: center.lon,
        name: element.tags?.name || element.tags?.['name:en'] || 'Golf Course',
        website:
          element.tags?.website ||
          element.tags?.url ||
          element.tags?.['contact:website'] ||
          `https://www.google.com/search?q=${encodeURIComponent(
            `${element.tags?.name || 'golf course'} tee times`
          )}`,
      };
    })
    .filter((course) => course.name && course.name !== 'Golf Course');
}

async function getWeather(lat, lon, date) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&daily=temperature_2m_max,precipitation_probability_max&timezone=auto&forecast_days=7';

  const response = await fetch(url);
  if (!response.ok) {
    return { temp: 'n/a', rainChance: 'n/a' };
  }

  const data = await response.json();
  const dayIndex = data.daily?.time?.indexOf(date);

  if (dayIndex === undefined || dayIndex === -1) {
    return { temp: 'n/a', rainChance: 'n/a' };
  }

  return {
    temp: data.daily.temperature_2m_max[dayIndex],
    rainChance: data.daily.precipitation_probability_max[dayIndex],
  };
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusMiles * c).toFixed(1));
}

function ensureUrl(value) {
  if (!value) {
    return 'https://www.google.com/search?q=golf+tee+times';
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

async function fetchTeeTimeInventory(course, date, preferredTime, players) {
  // This app does not have a provider API key configured yet.
  // The real architecture is to call a tee-time provider here, but we must not fabricate slots.
  // If no provider is configured, return an empty inventory and let the frontend say so.
  const providerApiKey = process.env.TEE_TIME_PROVIDER_API_KEY;
  if (!providerApiKey) {
    return [];
  }

  // Example hook for a real provider integration:
  // const response = await fetch('https://provider.example.com/tee-times', {...})
  // return await response.json();
  return [];
}

app.post('/api/search', async (req, res) => {
  try {
    const { zip, radius, date, time, players } = req.body || {};

    if (!zip) {
      return res.status(400).json({ error: 'ZIP code is required.' });
    }

    const selectedRadius = Number(radius) || 25;
    const selectedDate = date || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const selectedTime = time || 'morning';
    const playerCount = Number(players) || 4;

    const location = await geocodeZip(zip);
    const rawCourses = await fetchNearbyCourses(location.lat, location.lon, selectedRadius);

    if (!rawCourses.length) {
      return res.json({ courses: [] });
    }

    const courses = await Promise.all(
      rawCourses.slice(0, 10).map(async (course) => {
        const weather = await getWeather(course.lat, course.lon, selectedDate);
        const distance = calculateDistanceMiles(location.lat, location.lon, course.lat, course.lon);
        const slots = await fetchTeeTimeInventory(course, selectedDate, selectedTime, playerCount);

        return {
          name: course.name,
          website: ensureUrl(course.website),
          distance,
          weather,
          preferredTime: selectedTime,
          preferredTimeLabel: getTimeLabel(selectedTime),
          players: playerCount,
          date: selectedDate,
          slots,
        };
      })
    );

    const ranked = courses
      .map((course) => ({
        ...course,
        why: `Nearby golf course matching your ${getTimeLabel(course.preferredTime).toLowerCase()} search preference for ${course.players} players.`,
        recommendation: course.distance <= 15 ? 'high' : 'medium',
      }))
      .sort((a, b) => a.distance - b.distance);

    if (openai) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: `Rank these real golf course matches using only the supplied data. Do not invent course names, websites, or tee times. Return JSON only: {"courses":[{"name":"...","why":"...","recommendation":"high|medium|low"}]}. Data: ${JSON.stringify(
                ranked.map(({ name, distance, weather, preferredTimeLabel, players, website }) => ({
                  name,
                  distance,
                  weather,
                  preferredTimeLabel,
                  players,
                  website,
                })),
                null,
                2
              )}`,
            },
          ],
        });

        const aiData = JSON.parse(completion.choices[0].message.content || '{}');
        const aiMap = new Map((aiData.courses || []).map((item) => [item.name, item]));

        return res.json({
          courses: ranked.map((course) => ({
            ...course,
            why: aiMap.get(course.name)?.why || course.why,
            recommendation: aiMap.get(course.name)?.recommendation || course.recommendation,
          })),
        });
      } catch (error) {
        console.error('AI ranking failed, using real course ordering instead:', error);
      }
    }

    return res.json({ courses: ranked });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Unable to fetch courses right now.' });
  }
});

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Tee Time Finder is running on http://localhost:${PORT}`);
});
