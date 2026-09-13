(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const plans = Array.from(document.querySelectorAll('#plans > li'), node => ({
    start: node.dataset.start, end: node.dataset.end,
    url: node.querySelector('a').getAttribute('href'), title: node.querySelector('.t').textContent
  }));
  let days = [], loaded = false, loading = false, map, markers = [], mapLoading, revision = 0;
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const identity = p => p.name.replace(/\s/g, '') + '|' + p.address.replace(/\s/g, '');
  const inPeriod = date => date.startsWith($('record-period').value);
  const visitedPlaces = day => day.places.filter(p => !p.transport);
  const isDone = day => day.date <= today;
  const categories = [
    ['movie', '영화'], ['cafe', '카페'], ['board', '보드게임'], ['food', '맛집'],
    ['walk', '산책·나들이'], ['culture', '전시·공연'], ['escape', '방탈출·체험'],
    ['play', '만화·게임·노래방'], ['drink', '술·바'], ['stay', '숙박·휴식'], ['other', '기타']
  ];
  const cuisines = [['korean', '한식'], ['chinese', '중식'], ['japanese', '일식'],
    ['western', '양식'], ['asian', '동남아'], ['other', '기타 음식']];
  let selectedCategory = 'all', selectedCuisine = 'all';
  async function load() {
    if (loaded || loading) return;
    loading = true; $('records-retry').hidden = true;
    $('record-status').textContent = '일정을 불러오고 있어요.';
    const classificationRequest = fetch('assets/classifications.json', { signal: AbortSignal.timeout(15000) })
      .then(response => { if (!response.ok) throw new Error('Classifications unavailable'); return response.json(); })
      .then(data => { if (data.version !== 1 || !data.plans || typeof data.plans !== 'object') throw new Error('Invalid classifications'); return data; })
      .catch(() => null);
    const results = await Promise.allSettled(plans.map(async plan => {
      const response = await fetch(plan.url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Plan unavailable');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const places = new Map(Array.from(doc.querySelectorAll('[data-location]'), node => {
        const p = JSON.parse(node.dataset.location);
        const addressLabel = Array.from(node.querySelectorAll('dt')).find(dt => dt.textContent === '주소');
        const address = addressLabel?.nextElementSibling?.textContent.trim() || '';
        const parts = address.split(/\s+/);
        const regions = { '서울특별시': '서울', '경기도': '경기', '인천광역시': '인천', '부산광역시': '부산', '대구광역시': '대구', '경상북도': '경북' };
        parts[0] = regions[parts[0]] || parts[0];
        return [p.id, { ...p, address, region: parts.length > 1 ? parts.slice(0, 2).join(' ') : '지역 미상' }];
      }));
      return Array.from(doc.querySelectorAll('.day'), section => {
        const date = section.dataset.day || plan.start;
        const route = JSON.parse(section.querySelector('[data-route]')?.dataset.route || '[]');
        const unique = new Map();
        route.forEach(stop => {
          const place = places.get(stop.placeId);
          if (!place || place.name === '미정') return;
          const p = { ...place, key: identity(place) };
          p.transport = /역$|터미널|정류장|공항/.test(p.name);
          unique.set(p.key, p);

        });
        return { id: plan.url + '|' + date, date, plan, places: [...unique.values()], activities: [], classified: false };
      });
    }));
    days = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value).sort((a,b) => a.date.localeCompare(b.date));
    const classification = await classificationRequest;
    days.forEach(day => {
      const slug = decodeURIComponent(day.plan.url.replace(/\/$/, ''));
      const record = classification?.plans[slug];
      if (!record || !Array.isArray(record.activities)) return;
      day.classified = true;
      day.activities = record.activities.filter(a => a.date === day.date && a.url === day.plan.url &&
        typeof a.key === 'string' && typeof a.name === 'string' && typeof a.activity === 'string' &&
        categories.some(c => c[0] === a.category) &&
        (a.category === 'food' ? cuisines.some(c => c[0] === a.cuisine) : a.cuisine === null));
    });
    const failures = results.filter(r => r.status === 'rejected').length;
    loaded = failures === 0 && classification !== null; loading = false;
    $('record-status').textContent = failures ? `${failures}개 일정을 불러오지 못했어요. 현재 요약에는 불러온 일정만 포함돼요.` : '오늘까지의 모든 일정을 다녀온 것으로 집계해요. 역·터미널 등 이동 장소는 제외해요.';
    $('records-retry').hidden = !failures && classification !== null;
    const previous = $('record-period').value;
    const months = [...new Set(days.map(d => d.date.slice(0,7)))].sort().reverse();
    const years = [...new Set(months.map(m => m.slice(0,4)))];
    $('record-period').innerHTML = years.map(year => `<option value="${year}">${year}년 전체</option>` + months.filter(m => m.startsWith(year)).map(m => `<option value="${m}">${year}년 ${Number(m.slice(5))}월</option>`).join('')).join('');
    const valid = [...years, ...months];
    $('record-period').value = valid.includes(previous) ? previous : valid.includes(today.slice(0,7)) ? today.slice(0,7) : valid[0] || '';
    render();
  }
  function aggregate(records) {
    const places = new Map(), regions = new Map();
    records.forEach(day => visitedPlaces(day).forEach(p => {
      if (!places.has(p.key)) places.set(p.key, { ...p, dates: new Set(), url: day.plan.url });
      places.get(p.key).dates.add(day.date);
      if (p.region !== '지역 미상') {
        if (!regions.has(p.region)) regions.set(p.region, new Set());
        regions.get(p.region).add(day.date);
      }
    }));
    return { places: [...places.values()].sort((a,b) => b.dates.size - a.dates.size || a.name.localeCompare(b.name, 'ko')), regions: [...regions].sort((a,b) => b[1].size - a[1].size || a[0].localeCompare(b[0], 'ko')) };
  }
  function render() {
    const complete = days.filter(isDone), current = complete.filter(d => inPeriod(d.date));
    const data = aggregate(current);
    const firstVisits = new Map();
    complete.forEach(d => visitedPlaces(d).forEach(p => { if (!firstVisits.has(p.key)) firstVisits.set(p.key, d.date); }));
    const fresh = data.places.filter(p => inPeriod(firstVisits.get(p.key))).length;
    const cards = [ ['함께한 날', new Set(current.map(d => d.date)).size + '일', '같은 날짜는 한 번만'], ['방문한 장소', data.places.length + '곳', '중복 장소 제외'], ['처음 기록한 곳', fresh + '곳', '전체 일정의 방문 기록 기준'], ['자주 간 지역', data.regions[0]?.[0] || '아직 없어요', data.regions.length ? data.regions[0][1].size + '일 함께했어요' : '이 기간의 방문 지역이 없어요'] ];
    $('record-stats').innerHTML = cards.map(([label, value, note]) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
    $('region-ranking').innerHTML = data.regions.slice(0,3).map(([name, dates]) => `<li>${esc(name)}<span>${dates.size}일</span></li>`).join('') || '<li class="empty-record">다녀온 지역이 여기에 모여요.</li>';
    $('place-ranking').innerHTML = data.places.slice(0,3).map(p => `<li><a href="${esc(p.url)}">${esc(p.name)}</a><span>${p.dates.size}일</span></li>`).join('') || '<li class="empty-record">우리의 단골을 발견해봐요.</li>';
    $('visited-places').innerHTML = data.places.map(p => `<a href="${esc(p.url)}" title="${esc(p.name)} 데이트 일정 보기">${esc(p.name)} · ${p.dates.size}일</a>`).join('');
    const year = $('record-period').value.slice(0,4);
    $('timeline-heading').textContent = year + '년 월별 함께한 날';
    const counts = Array.from({length:12}, (_,i) => new Set(complete.filter(d => d.date.startsWith(year + '-' + String(i+1).padStart(2,'0'))).map(d => d.date)).size);
    const max = Math.max(2, Math.ceil(Math.max(...counts) / 2) * 2);
    const x = i => 28 + i * 28;
    const y = n => 146 - n / max * 112;
    const description = counts.map((n, i) => `${i + 1}월 ${n}일`).join(', ');
    const grid = [0, max / 2, max].map(n => `<line x1="28" y1="${y(n)}" x2="336" y2="${y(n)}" class="chart-grid"/><text x="20" y="${y(n) + 3}" text-anchor="end">${n}</text>`).join('');
    const points = counts.map((n, i) => `${x(i)},${y(n)}`).join(' ');
    $('record-timeline').innerHTML = `<svg class="month-chart" viewBox="0 0 360 180" role="img" aria-labelledby="month-chart-title month-chart-desc"><title id="month-chart-title">${year}년 월별 함께한 날</title><desc id="month-chart-desc">${description}. 가로축은 월, 세로축은 함께한 날 수입니다.</desc><text x="8" y="16">일</text>${grid}<polyline points="${points}" class="chart-line"/>${counts.map((n, i) => `<circle cx="${x(i)}" cy="${y(n)}" r="3.5" class="chart-dot"/><text x="${x(i)}" y="${y(n) - 10}" text-anchor="middle" class="chart-value">${n}</text><text x="${x(i)}" y="168" text-anchor="middle">${i + 1}월</text>`).join('')}</svg>`;
    const pending = new Set(current.filter(day => !day.classified).map(day => day.plan.url)).size;
    $('classification-status').textContent = pending ? `${pending}개 일정의 분류가 준비되지 않았어요. 종류·음식 집계에는 분류가 완료된 일정만 포함돼요.` : '전체 일정과 메뉴를 함께 읽어 분류한 결과예요.';
    renderCategories(current);
    renderCuisines(current);
    drawMap(data.places);
  }
  function renderCategories(records) {
    const entries = [...new Map(records.flatMap(day => day.activities).map(a => [a.key, a])).values()]
      .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'ko'));
    const totals = new Map(categories.map(([id]) => [id, entries.filter(a => a.category === id).length]));
    const top = categories.filter(([id]) => totals.get(id) > 0)
      .sort((a, b) => totals.get(b[0]) - totals.get(a[0])).slice(0, 3);
    if (!top.some(([id]) => id === selectedCategory)) selectedCategory = 'all';
    const largest = Math.max(1, ...totals.values());
    $('category-board').innerHTML = `<button type="button" class="category-all" data-category="all" aria-pressed="${selectedCategory === 'all'}" aria-controls="category-visits">전체 <strong>${entries.length}회</strong></button>` + top.map(category => {
      const id = category[0], count = totals.get(id);
      return `<button type="button" class="category-tile" data-category="${id}" aria-pressed="${selectedCategory === id}" aria-controls="category-visits"><span>${category[1]}</span><strong>${count}<small>회</small></strong><span class="category-track" aria-hidden="true"><span style="width:${count / largest * 100}%"></span></span></button>`;
    }).join('');
    const filtered = selectedCategory === 'all' ? entries : entries.filter(a => a.category === selectedCategory);
    const label = selectedCategory === 'all' ? '전체 활동' : categories.find(c => c[0] === selectedCategory)[1];
    $('category-result-heading').textContent = `${label} · ${filtered.length}회`;
    $('category-visits').innerHTML = filtered.map(a => `<li><a href="${esc(a.url)}"><span class="category-visit-title">${esc(a.name)}</span><span class="category-visit-meta">${esc(a.date)} · ${esc(a.activity || categories.find(c => c[0] === a.category)[1])}</span><span class="category-arrow" aria-hidden="true">↗</span></a></li>`).join('') || `<li class="empty-record">${records.some(d => !d.classified) ? '일정 분류가 준비되면 여기에 표시돼요.' : '이 기간에는 해당 종류의 데이트가 없어요.'}</li>`;
  }
  $('category-board').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    selectedCategory = button.dataset.category;
    renderCategories(days.filter(day => isDone(day) && inPeriod(day.date)));
    $('category-board').querySelector(`[data-category="${selectedCategory}"]`).focus({ preventScroll: true });
  });
  function renderCuisines(records) {
    const entries = [...new Map(records.flatMap(day => day.activities).filter(a => a.category === 'food').map(a => [a.key, a])).values()]
      .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'ko'));
    const totals = new Map(cuisines.map(([id]) => [id, entries.filter(a => a.cuisine === id).length]));
    const top = cuisines.filter(([id]) => totals.get(id) > 0)
      .sort((a, b) => totals.get(b[0]) - totals.get(a[0])).slice(0, 3);
    if (!top.some(([id]) => id === selectedCuisine)) selectedCuisine = 'all';
    $('cuisine-board').innerHTML = `<button type="button" class="category-all" data-cuisine="all" aria-pressed="${selectedCuisine === 'all'}" aria-controls="cuisine-visits">음식 전체 <strong>${entries.length}회</strong></button>` + top.map(([id, label]) => {
      const count = totals.get(id);
      return `<button type="button" class="category-tile" data-cuisine="${id}" aria-pressed="${selectedCuisine === id}" aria-controls="cuisine-visits"><span>${label}</span><strong>${count}<small>회</small></strong></button>`;
    }).join('');
    const filtered = selectedCuisine === 'all' ? entries : entries.filter(a => a.cuisine === selectedCuisine);
    const label = selectedCuisine === 'all' ? '음식 전체' : cuisines.find(c => c[0] === selectedCuisine)[1];
    $('cuisine-result-heading').textContent = `${label} · ${filtered.length}회`;
    $('cuisine-visits').innerHTML = filtered.map(a => `<li><a href="${esc(a.url)}"><span class="category-visit-title">${esc(a.name)}</span><span class="category-visit-meta">${esc(a.date)} · ${cuisines.find(c => c[0] === a.cuisine)[1]} · ${esc(a.activity)}</span><span class="category-arrow" aria-hidden="true">↗</span></a></li>`).join('') || `<li class="empty-record">${records.some(d => !d.classified) ? '음식 분류가 준비되면 여기에 표시돼요.' : '이 기간에는 해당 음식의 방문 기록이 없어요.'}</li>`;
  }
  $('cuisine-board').addEventListener('click', event => {
    const button = event.target.closest('[data-cuisine]');
    if (!button) return;
    selectedCuisine = button.dataset.cuisine;
    renderCuisines(days.filter(day => isDone(day) && inPeriod(day.date)));
    $('cuisine-board').querySelector(`[data-cuisine="${selectedCuisine}"]`).focus({ preventScroll: true });
  });
  async function ensureMap() {
    if (window.kakao?.maps?.Map) return;
    if (!mapLoading) mapLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(fail, 12000);
      function fail() { clearTimeout(timer); script.remove(); reject(new Error('Map unavailable')); }
      script.onerror = fail;
      script.onload = () => {
        if (!window.kakao?.maps) { fail(); return; }
        window.kakao.maps.load(() => { clearTimeout(timer); resolve(); });
      };
      script.src = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=' + encodeURIComponent(document.querySelector('meta[name="kakao-maps-js-key"]').content);
      document.head.appendChild(script);
    }).catch(error => { mapLoading = null; throw error; });
    return mapLoading;
  }
  async function drawMap(places) {
    const version = ++revision;
    markers.forEach(m => m.setMap(null)); markers = [];
    const located = places.filter(p => Array.isArray(p.point) && p.point.length === 2 && p.point.every(Number.isFinite));
    $('map-retry').hidden = true;
    $('record-map').hidden = !located.length;
    if (!located.length) {
      $('map-status').textContent = places.length ? '좌표가 등록된 장소가 없어요. 아래 장소를 누르면 일정을 볼 수 있어요.' : '이 기간에는 오늘까지 다녀온 장소가 없어요. 다른 기간을 선택해보세요.';
      return;
    }
    $('map-status').textContent = '방문 지도를 불러오고 있어요.';
    try {
      await ensureMap();
      if (version !== revision) return;
      const k = window.kakao.maps;
      if (!map) {
        map = new k.Map($('record-map'), { center: new k.LatLng(...located[0].point), level: 6 });
        map.addControl(new k.ZoomControl(), k.ControlPosition.RIGHT);
        new ResizeObserver(() => { if (!$('records-view').hidden) map.relayout(); }).observe($('record-map'));
      }
      map.relayout();
      const bounds = new k.LatLngBounds();
      located.forEach(p => {
        const position = new k.LatLng(...p.point);
        const marker = new k.Marker({ map, position, title: p.name });
        k.event.addListener(marker, 'click', () => { window.location.href = p.url; });
        markers.push(marker); bounds.extend(position);
      });
      if (located.length === 1) { map.setCenter(new k.LatLng(...located[0].point)); map.setLevel(5); }
      else map.setBounds(bounds);
      $('map-status').textContent = `${located.length}곳을 지도에 표시했어요.${places.length > located.length ? ' 좌표가 없는 장소는 목록에서 볼 수 있어요.' : ''} 장소를 누르면 데이트 일정으로 이동해요.`;
    } catch {
      if (version !== revision) return;
      $('record-map').hidden = true;
      $('map-status').textContent = '지도를 연결하지 못했어요. 아래 장소 목록에서 일정을 볼 수 있어요.';
      $('map-retry').hidden = false;
    }
  }
  function showView(view) {
    const records = view === 'records';
    $('schedule-view').hidden = records; $('records-view').hidden = !records;
    document.querySelectorAll('[data-home-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.homeView === view)));
    if (records) { if (loaded) render(); else load(); }
  }
  document.querySelector('.home-switch').hidden = false;
  document.querySelectorAll('[data-home-view]').forEach(button => button.addEventListener('click', () => { location.hash = button.dataset.homeView; }));
  window.addEventListener('hashchange', () => showView(location.hash === '#records' ? 'records' : 'schedule'));
  $('record-period').addEventListener('change', render);
  $('records-retry').addEventListener('click', load);
  $('map-retry').addEventListener('click', render);
  showView(location.hash === '#records' ? 'records' : 'schedule');
})();
