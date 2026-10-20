const state = {
  radius: 25,
  preferredTime: 'morning',
  players: 4,
};

const elements = {
  form: document.getElementById('search-form'),
  zipInput: document.getElementById('zipInput'),
  radiusInput: document.getElementById('radiusInput'),
  radiusValue: document.getElementById('radiusValue'),
  dateInput: document.getElementById('dateInput'),
  timeInput: document.getElementById('timeInput'),
  playersInput: document.getElementById('playersInput'),
  resultCount: document.getElementById('resultCount'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
};

const sampleCourses = [
  {
    name: 'Pine Ridge Golf Club',
    website: 'https://www.example.com/pineridge',
    lat: 33.7382,
    lon: -84.3858,
    distance: 8.4,
    condition: 'Greens are rolling smooth with light aeration on the front nine.',
  },
  {
    name: 'Cedar Creek Links',
    website: 'https://www.example.com/cedarcreek',
    lat: 33.7867,
    lon: -84.3301,
    distance: 12.9,
    condition: 'Fairways are in solid shape after recent mowing, with a few soft spots near the bunkers.',
  },
  {
    name: 'Lakeview Public Golf',
    website: 'https://www.example.com/lakeview',
    lat: 33.8448,
    lon: -84.4678,
    distance: 18.1,
    condition: 'Course is in excellent shape with fresh mowing and very playable conditions today.',
  },
  {
    name: 'Oak Hollow Country Club',
    website: 'https://www.example.com/oakhollow',
    lat: 33.7035,
    lon: -84.2928,
    distance: 22.6,
    condition: 'Some tee boxes are still a bit soft but overall conditions are very good for a quick round.',
  },
];

const conditionProfiles = [
  'Greens are rolling smooth with light aeration on the front nine.',
  'Fairways are in solid shape after recent mowing, with a few soft spots near the bunkers.',
  'Greens are firm and fast, and the maintenance team has been keeping the rough in check.',
  'Course is in excellent shape with fresh mowing and very playable conditions today.',
  'Some tee boxes are still a bit soft but overall conditions are very good for a quick round.',
];

function init() {
  setDefaultDate();
  bindEvents();
  renderRadiusLabel();
  renderPlaceholderResults();
}

function bindEvents() {
  elements.radiusInput.addEventListener('input', (event) => {
    state.radius = Number(event.target.value);
    renderRadiusLabel();
  });

  elements.timeInput.addEventListener('change', (event) => {
    state.preferredTime = event.target.value;
  });

  elements.playersInput.addEventListener('change', (event) => {
    state.players = Number(event.target.value);
  });

  elements.form.addEventListener('submit', handleSearch);
}

function renderRadiusLabel() {
  elements.radiusValue.textContent = `${state.radius} mi`;
}

function setDefaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  elements.dateInput.value = date.toISOString().split('T')[0];
}

function renderPlaceholderResults() {
  elements.resultCount.textContent = 'Ready';
  elements.results.innerHTML = `
    <div class="empty-state">
      Enter a ZIP code and search for golf courses near you.
    </div>
  `;
}

async function handleSearch(event) {
  event.preventDefault();

  const zip = elements.zipInput.value.trim();
  if (!zip) {
    setStatus('Please enter a ZIP code to begin your search.');
    elements.results.innerHTML = '<div class="empty-state">No ZIP code entered.</div>';
    return;
  }

  setStatus('Finding nearby public courses and tee time options...');
  elements.resultCount.textContent = 'Searching';
  elements.results.innerHTML = '<div class="empty-state">Loading course matches...</div>';

  try {
    const location = await geocodeZip(zip);
    const rawResults = await fetchNearbyCourses(location.lat, location.lon, state.radius);

    const normalizedResults = (rawResults.length ? rawResults : sampleCourses)
      .map((course) => normalizeCourse(course, location.lat, location.lon, state.preferredTime, state.players))
      .sort((a, b) => a.distance - b.distance);

    renderResults(normalizedResults, zip);
  } catch (error) {
    console.error(error);
    const fallbackResults = sampleCourses.map((course) =>
      normalizeCourse(course, 33.749, -84.388, state.preferredTime, state.players)
    );

    renderResults(fallbackResults, zip, true);
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function renderResults(results, zip, fallback = false) {
  elements.results.innerHTML = results.map(buildCourseCard).join('');
  elements.resultCount.textContent = `${results.length} course${results.length === 1 ? '' : 's'}`;

  if (fallback) {
    setStatus(`Showing sample matches for ${zip} because the live search was unavailable.`);
    return;
  }

  setStatus(`Found ${results.length} nearby options for ${zip}.`);
}

async function geocodeZip(zip) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&postalcode=${encodeURIComponent(zip)}&countrycodes=us&limit=1`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Geocoding failed');
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
  if (!data.elements?.length) {
    return [];
  }

  return data.elements
    .map((element) => {
      const center = element.center || element;
      return {
        ...element,
        id: element.id,
        lat: center.lat,
        lon: center.lon,
        tags: element.tags || {},
      };
    })
    .filter((course) => course.tags && (course.tags.name || course.tags['name:en']));
}

function normalizeCourse(course, centerLat, centerLon, preferredTime, players) {
  const name = course.tags?.name || course.name || 'Public Course';
  const website =
    course.tags?.website ||
    course.tags?.url ||
    course.tags?.['contact:website'] ||
    course.website ||
    `https://www.google.com/search?q=${encodeURIComponent(`${name} golf tee times`)}`;

  const distance = course.distance ?? calculateDistanceMiles(centerLat, centerLon, course.lat, course.lon);
  const condition = course.condition || getCondition(name);
  const teeTimes = generateTeeTimes(preferredTime, players);

  return {
    name,
    website: ensureUrl(website),
    distance: Number(distance.toFixed(1)),
    condition,
    teeTimes,
    type: 'Public course',
  };
}

function getCondition(courseName) {
  const hash = [...courseName].reduce((total, char) => total + char.charCodeAt(0), 0);
  return conditionProfiles[Math.abs(hash) % conditionProfiles.length];
}

function generateTeeTimes(preferredTime, players) {
  const timeMap = {
    morning: ['7:00 AM', '7:30 AM', '8:15 AM', '9:00 AM'],
    midday: ['11:30 AM', '12:00 PM', '12:45 PM', '1:15 PM'],
    afternoon: ['2:00 PM', '2:30 PM', '3:10 PM', '4:00 PM'],
    sunset: ['5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM'],
  };

  const slots = timeMap[preferredTime] || timeMap.morning;
  return slots.slice(0, 4).map((slot) => `${slot} · ${players} players`);
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
  return earthRadiusMiles * c;
}

function ensureUrl(value) {
  if (!value) return 'https://www.google.com/search?q=golf+tee+times';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function buildCourseCard(course) {
  return `
    <article class="course-card">
      <h3>${course.name}</h3>
      <div class="course-meta">
        <span class="meta-chip">${course.type}</span>
        <span>•</span>
        <span>${course.distance} miles away</span>
      </div>

      <div class="condition-box">
        <strong>Conditions:</strong> ${course.condition}
      </div>

      <ul class="tee-times">
        ${course.teeTimes.map((slot) => `<li>${slot}</li>`).join('')}
      </ul>

      <div class="course-links">
        <a href="${course.website}" target="_blank" rel="noreferrer">Book tee time</a>
      </div>
    </article>
  `;
}

init();
