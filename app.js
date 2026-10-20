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
    const payload = {
      zip,
      radius: state.radius,
      date: elements.dateInput.value,
      time: state.preferredTime,
      players: state.players,
    };

    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Search failed');
    }

    const data = await response.json();
    const courses = Array.isArray(data.courses) ? data.courses : [];

    if (!courses.length) {
      elements.results.innerHTML = '<div class="empty-state">No nearby courses were found for that ZIP code.</div>';
      elements.resultCount.textContent = '0 courses';
      setStatus(`No nearby public golf courses were found for ${zip}.`);
      return;
    }

    renderResults(courses, zip);
  } catch (error) {
    console.error(error);
    elements.results.innerHTML = '<div class="empty-state">The course search could not complete right now.</div>';
    elements.resultCount.textContent = 'Error';
    setStatus('The live search was unavailable. Try again in a moment.');
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function renderResults(courses, zip) {
  elements.results.innerHTML = courses.map(buildCourseCard).join('');
  elements.resultCount.textContent = `${courses.length} course${courses.length === 1 ? '' : 's'}`;
  setStatus(`Found ${courses.length} nearby options for ${zip}.`);
}

function buildCourseCard(course) {
  const slots = Array.isArray(course.slots) && course.slots.length
    ? course.slots.map((slot) => `<li>${slot}</li>`).join('')
    : '<li>No live tee times available.</li>';

  const weatherText = course.weather && course.weather.temp !== 'n/a'
    ? `Weather: ${course.weather.temp}°F / ${course.weather.rainChance}% rain chance`
    : 'Weather: Not available';

  return `
    <article class="course-card">
      <h3>${course.name}</h3>
      <div class="course-meta">
        <span class="meta-chip">${course.recommendation || 'medium'}</span>
        <span>•</span>
        <span>${course.distance} miles away</span>
      </div>

      <div class="condition-box">
        <strong>Why this course:</strong> ${course.why || 'Good fit for your preferences.'}
      </div>

      <ul class="tee-times">
        ${slots}
        <li>${weatherText}</li>
      </ul>

      <div class="course-links">
        <a href="${course.website}" target="_blank" rel="noreferrer">
          ${Array.isArray(course.slots) && course.slots.length ? 'Book tee time' : 'View course booking'}
        </a>
      </div>
    </article>
  `;
}

init();
