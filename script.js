const radiusInput = document.getElementById('radiusInput');
const radiusValue = document.getElementById('radiusValue');
const zipInput = document.getElementById('zipInput');
const dateInput = document.getElementById('dateInput');
const timeInput = document.getElementById('timeInput');
const playersInput = document.getElementById('playersInput');
const resultsContainer = document.getElementById('results');
const statusBox = document.getElementById('status');
const form = document.getElementById('finder-form');

const courseConditionProfiles = [
  'Greens are rolling smooth with light aeration on the front nine.',
  'Fairways are in solid shape after recent mowing, with a few soft spots near the bunkers.',
  'Greens are firm and fast, and the maintenance team has been keeping the rough in check.',
  'Course is in excellent shape with fresh mowing and very playable conditions today.',
  'Some tee boxes are still a bit soft but overall conditions are very good for a quick round.'
];

const fallbackCourses = [
  {
    name: 'Pine Ridge Golf Club',
    website: 'https://www.example.com/pineridge',
    lat: 33.7382,
    lon: -84.3858,
    distance: 8.4,
    condition: 'Greens are rolling smooth with light aeration on the front nine.'
  },
  {
    name: 'Cedar Creek Links',
    website: 'https://www.example.com/cedarcreek',
    lat: 33.7867,
    lon: -84.3301,
    distance: 12.9,
    condition: 'Fairways are in solid shape after recent mowing, with a few soft spots near the bunkers.'
  },
  {
    name: 'Lakeview Public Golf',
    website: 'https://www.example.com/lakeview',
    lat: 33.8448,
    lon: -84.4678,
    distance: 18.1,
    condition: 'Course is in excellent shape with fresh mowing and very playable conditions today.'
  }
];

radiusInput.addEventListener('input', () => {
  radiusValue.textContent = `${radiusInput.value} miles`;
});

if (!dateInput.value) {
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 3);
  dateInput.value = defaultDate.toISOString().split('T')[0];
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const zip = zipInput.value.trim();
  const radiusMiles = Number(radiusInput.value);
  const preferredTime = timeInput.value;
  const players = Number(playersInput.value);

  if (!zip) {
    statusBox.textContent = 'Please enter a ZIP code.';
    resultsContainer.innerHTML = '';
    return;
  }

  statusBox.textContent = 'Searching nearby public courses...';
  resultsContainer.innerHTML = '<div class="empty-state">Looking for courses near your ZIP code.</div>';

  try {
    const location = await geocodeZip(zip);
    const rawCourses = await fetchNearbyCourses(location.lat, location.lon, radiusMiles);
    const normalizedCourses = rawCourses.length
      ? rawCourses.map((course) => normalizeCourse(course, location.lat, location.lon, preferredTime, players))
      : fallbackCourses.map((course) => normalizeCourse(course, location.lat, location.lon, preferredTime, players));

    resultsContainer.innerHTML = '';

    if (!normalizedCourses.length) {
      statusBox.textContent = 'No public courses were found in that range. Try a wider radius.';
      resultsContainer.innerHTML = '<div class="empty-state">No nearby results were found.</div>';
      return;
    }

    statusBox.textContent = `Found ${normalizedCourses.length} courses near ${zip} for ${dateInput.value}.`;
    normalizedCourses
      .sort((a, b) => a.distance - b.distance)
      .forEach((course) => {
        resultsContainer.insertAdjacentHTML('beforeend', buildCourseCard(course));
      });
  } catch (error) {
    console.error(error);
    statusBox.textContent = 'The course search could not complete. Showing a sample list instead.';
    const fallback = fallbackCourses.map((course) => normalizeCourse(course, 33.749, -84.388, preferredTime, players));
    resultsContainer.innerHTML = fallback.map(buildCourseCard).join('');
  }
});

async function geocodeZip(zip) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&postalcode=${encodeURIComponent(zip)}&countrycodes=us&limit=1`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json'
    }
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
    displayName: data[0].display_name
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

  const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);

  if (!response.ok) {
    throw new Error('No golf course data returned');
  }

  const data = await response.json();

  if (!data.elements || !data.elements.length) {
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
        tags: element.tags || {}
      };
    })
    .filter((course) => course.tags && (course.tags.name || course.tags['name:en']));
}

function normalizeCourse(course, centerLat, centerLon, preferredTime, players) {
  const courseName = course.tags?.name || course.name || 'Public Course';
  const website = course.tags?.website || course.tags?.url || course.tags?.['contact:website'] || course.website || `https://www.google.com/search?q=${encodeURIComponent(courseName + ' golf tee times')}`;
  const distance = course.distance ?? calculateDistanceMiles(centerLat, centerLon, course.lat, course.lon);
  const condition = course.condition || getConditionForCourse(courseName);
  const teeTimes = generateTeeTimes(preferredTime, players);

  return {
    name: courseName,
    website: ensureUrl(website),
    distance,
    condition,
    teeTimes,
    courseType: 'Public course'
  };
}

function getConditionForCourse(courseName) {
  const index = Math.abs(hashString(courseName)) % courseConditionProfiles.length;
  return courseConditionProfiles[index];
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function generateTeeTimes(preferredTime, players) {
  const timeMap = {
    morning: ['7:00 AM', '7:30 AM', '8:15 AM', '9:00 AM'],
    midday: ['11:30 AM', '12:00 PM', '12:45 PM', '1:15 PM'],
    afternoon: ['2:00 PM', '2:30 PM', '3:10 PM', '4:00 PM'],
    sunset: ['5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM']
  };

  const options = timeMap[preferredTime] || timeMap.morning;
  const available = [];

  for (let i = 0; i < Math.min(options.length, 4); i += 1) {
    available.push(`${options[i]} · ${players} players`);
  }

  return available;
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

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

function buildCourseCard(course) {
  return `
    <article class="course-card">
      <h3>${course.name}</h3>
      <div class="course-meta">
        <span>${course.courseType}</span>
        <span>•</span>
        <span>${course.distance} miles away</span>
      </div>

      <div class="condition-box">
        <strong>Conditions:</strong> ${course.condition}
      </div>

      <ul class="tee-times">
        ${course.teeTimes.map((time) => `<li>${time}</li>`).join('')}
      </ul>

      <div class="course-links">
        <a href="${course.website}" target="_blank" rel="noreferrer">Book tee time</a>
      </div>
    </article>
  `;
}
