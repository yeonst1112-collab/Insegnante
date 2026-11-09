/* =====================================================================
   Insegnante — 수강생 후기 · 정보 수정 제보 · 내 선생님 등록
   - 후기/제보 저장: Firebase Firestore (firebase-config.js 설정 필요)
   - 수강 인증: 진도율 10% 이상 + 수강 화면 캡처 → 관리자 승인 후 공개
   - 내 선생님 목록: 이 브라우저(localStorage)에 저장
   ===================================================================== */

/* ---------- Firebase 준비 ---------- */
let fb = null;            // { db, auth }
let fbReady = null;       // 로그인 완료 Promise

function firebaseEnabled() {
  return !!(window.FIREBASE_CONFIG && window.firebase);
}

function initFirebase() {
  if (fb || !firebaseEnabled()) return fb;
  try {
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
    fb = { db: app.firestore(), auth: app.auth() };
  } catch (e) {
    console.error('Firebase 초기화 실패', e);
    fb = null;
  }
  return fb;
}

// 로그인한 회원인지 확인 (auth.js 의 이메일 로그인). silent: 로그인 창을 띄우지 않음
function ensureSignedIn(opts = {}) {
  if (!initFirebase()) return Promise.reject(new Error('no-firebase'));
  const u = fb.auth.currentUser;
  if (u && !u.isAnonymous) return Promise.resolve(u);
  if (!opts.silent && typeof openLogin === 'function') openLogin('이 기능은 로그인 후 사용할 수 있어요.');
  return Promise.reject(new Error('login-required'));
}

/* 후기 공개 방식: 관리자 페이지에서 설정 (settings/reviews 문서의 autoApprove)
   - false(기본): 관리자 승인 후 공개
   - true: 작성 즉시 모든 사용자에게 공개 (보안 규칙에서도 같은 설정을 확인함) */
let reviewModeCache = null;
async function getAutoApprove() {
  if (reviewModeCache && Date.now() - reviewModeCache.at < 60000) return reviewModeCache.value;
  let value = false;
  try {
    const doc = await fb.db.collection('settings').doc('reviews').get();
    value = !!(doc.exists && doc.data().autoApprove === true);
  } catch (e) { console.warn('후기 공개 방식 확인 실패 (기본: 승인 후 공개)', e); }
  reviewModeCache = { value, at: Date.now() };
  return value;
}

const NO_SERVER_HTML = `
  <div class="notice-box">
    ⚠️ 후기 서버가 아직 연결되지 않았어요.<br>
    관리자가 <b>firebase-config.js</b>에 Firebase 설정을 넣으면 후기를 보고 쓸 수 있어요.
  </div>`;

/* ---------- 공통 모달 ---------- */
function showModal(html) {
  const body = document.getElementById('detail-body');
  body.innerHTML = `<button class="modal-close" onclick="closeDetail()" aria-label="닫기">✕</button>` + html;
  document.getElementById('detail-modal').classList.add('open');
  body.scrollTop = 0;
}

// onclick 속성 안에 안전하게 넣을 수 있는 JS 문자열 인자
function jsArg(s) {
  return esc(JSON.stringify(String(s)));
}

function findTeacher(name) {
  return teachers.find(t => t.name === name);
}

function stars(n) {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function fmtDate(ts) {
  if (!ts || !ts.toDate) return '';
  const d = ts.toDate();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/* =====================================================================
   1) 수강생 후기 보기 · 2) 후기 쓰기 → 별도 페이지로 이동
      - reviews.html : 후기 보기 (관리자는 승인·반려·수정·삭제)
      - write.html   : 후기 쓰기 (로그인 필요, 관리자는 수정)
   ===================================================================== */
function openReviews(t) {
  if (!t) return;
  location.href = 'reviews.html?teacher=' + encodeURIComponent(t.name);
}

function openWriteReview(t) {
  location.href = 'write.html' + (t ? '?teacher=' + encodeURIComponent(t.name) : '');
}

/* =====================================================================
   3) 정보 수정 제보
   ===================================================================== */
function openCorrection(t) {
  if (!t) return;
  const nameJs = jsArg(t.name);
  showModal(`
    <h3>🛠 정보 수정 제보</h3>
    <p class="review-guide"><b>${esc(t.name)}</b> 선생님 정보 중 틀리거나 바뀐 내용을 알려 주세요.
    확인 후 반영할게요.</p>
    ${initFirebase() ? '' : NO_SERVER_HTML}
    <form class="form" onsubmit="submitCorrection(event, ${nameJs})">
      <label>어떤 정보인가요?
        <select id="cr-field" required>
          <option>소속 플랫폼 (예: 이투스 → 메가스터디)</option>
          <option>강좌 리스트 / 커리큘럼</option>
          <option>강사 특징 / 수업 스타일</option>
          <option>링크</option>
          <option>기타</option>
        </select>
      </label>
      <label>내용
        <textarea id="cr-text" rows="5" minlength="5" maxlength="1000" required
          placeholder="예: 2026년부터 이투스에서 메가스터디로 옮겼어요. (출처 링크가 있으면 함께 적어 주세요)"></textarea>
      </label>
      <p id="cr-error" class="field-msg error"></p>
      <button class="link-btn as-btn" type="submit" id="cr-submit">제보하기</button>
      <button class="ghost-btn" type="button" onclick="openReviews(findTeacher(${nameJs}))">← 돌아가기</button>
    </form>`);
}

async function submitCorrection(ev, teacherName) {
  ev.preventDefault();
  const err = document.getElementById('cr-error');
  const btn = document.getElementById('cr-submit');
  const field = document.getElementById('cr-field').value;
  const text = document.getElementById('cr-text').value.trim();
  if (text.length < 5) return (err.textContent = '내용을 5자 이상 적어 주세요.');
  if (!firebaseEnabled()) return (err.textContent = '후기 서버가 아직 연결되지 않았어요.');

  btn.disabled = true; btn.textContent = '보내는 중...';
  try {
    const user = await ensureSignedIn();
    await fb.db.collection('corrections').add({
      teacher: teacherName, field, text, status: 'open', uid: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showModal(`
      <h3>🙏 제보 고마워요!</h3>
      <p class="review-guide">확인 후 선생님 정보에 반영할게요.</p>
      <button class="link-btn as-btn" onclick="closeDetail()">닫기</button>`);
  } catch (e) {
    console.error(e);
    err.textContent = '제보에 실패했어요. 잠시 후 다시 시도해 주세요.';
    btn.disabled = false; btn.textContent = '제보하기';
  }
}


/* =====================================================================
   4) 내 선생님(듣고 있는 쌤 · 최애쌤) 등록 — 이 브라우저에 저장
      - 시작 화면 왼쪽 위에 과목별로 얼굴(사진)과 이름 표시
      - 얼굴 둘레 링 + 배지로 '인증한 수강률(완강 %)' 표시
   ===================================================================== */
const FAV_KEY = 'insegnante.myTeachers';
const PHOTO_KEY = 'insegnante.photos';
const PROG_KEY = 'insegnante.progress';

function loadJSON(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
}

function getFavs() { return loadJSON(FAV_KEY, []); }
function setFavs(list) { saveJSON(FAV_KEY, list); renderMyPanel(); }

function toggleFav(name, kind) {
  const list = getFavs();
  const i = list.findIndex(f => f.name === name);
  if (i >= 0 && list[i].kind === kind) list.splice(i, 1);   // 같은 버튼 다시 누르면 해제
  else if (i >= 0) list[i].kind = kind;
  else list.push({ name, kind });
  setFavs(list);
  renderMyTeachers();
}

/* ---------- 얼굴 사진 (학생이 직접 등록, 이 브라우저에만 저장) ---------- */
function getPhoto(name) { return loadJSON(PHOTO_KEY, {})[name] || null; }

function pickPhoto(name) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const url = await squareThumb(f, 160);
      const photos = loadJSON(PHOTO_KEY, {});
      photos[name] = url;
      if (!saveJSON(PHOTO_KEY, photos)) alert('사진을 저장할 공간이 부족해요.');
      renderMyPanel(); renderMyTeachers();
    } catch (e) { alert('이미지를 읽을 수 없어요.'); }
  };
  input.click();
}

function removePhoto(name) {
  const photos = loadJSON(PHOTO_KEY, {});
  delete photos[name];
  saveJSON(PHOTO_KEY, photos);
  renderMyPanel(); renderMyTeachers();
}

// 가운데를 정사각형으로 잘라 작은 썸네일로 저장
function squareThumb(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', .8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- 인증 수강률 ---------- */
function getMyProgress(name) { return loadJSON(PROG_KEY, {})[name] || null; }

function saveMyProgress(name, p) {
  const all = loadJSON(PROG_KEY, {});
  const cur = all[name];
  // 승인된 기록이 있으면 더 높은 승인 기록으로만 덮어씀, 대기 중인 기록은 따로 보관
  if (p.status === 'approved') {
    if (!cur || cur.status !== 'approved' || p.progress >= cur.progress) all[name] = p;
  } else if (!cur || cur.status !== 'approved') {
    if (!cur || p.progress >= cur.progress) all[name] = p;
  } else {
    all[name] = { ...cur, pendingProgress: Math.max(p.progress, cur.pendingProgress || 0) };
  }
  saveJSON(PROG_KEY, all);
  renderMyPanel();
}

// 서버에서 내 후기들의 승인 상태를 가져와 수강률 갱신
async function syncMyProgress() {
  if (!firebaseEnabled() || (!getFavs().length && !getMyReviews().length)) return;
  try {
    const user = await ensureSignedIn({ silent: true });
    const snap = await fb.db.collection('reviews').where('uid', '==', user.uid).get();
    syncMyReviews(snap);
    const fresh = {};
    snap.docs.forEach(d => {
      const r = d.data();
      if (r.status === 'rejected') return;
      const cur = fresh[r.teacher];
      const better = !cur
        || (r.status === 'approved' && cur.status !== 'approved')
        || (r.status === cur.status && r.progress > cur.progress);
      if (better) fresh[r.teacher] = { progress: r.progress, course: r.course, status: r.status };
    });
    const all = loadJSON(PROG_KEY, {});
    Object.keys(all).forEach(k => { if (!fresh[k]) delete all[k]; });   // 반려·삭제된 인증은 제거
    Object.assign(all, fresh);
    saveJSON(PROG_KEY, all);
    renderMyPanel();
  } catch (e) {
    console.warn('수강률 동기화 실패', e);
  }
}

/* ---------- 얼굴 + 수강률 링 ---------- */
function avatarHTML(name, kind) {
  const photo = getPhoto(name);
  const prog = getMyProgress(name);
  const pct = prog ? Math.round(prog.progress) : 0;
  const pending = prog && prog.status !== 'approved';
  const badge = !prog ? '<span class="pct-badge none">미인증</span>'
    : pending ? `<span class="pct-badge pending">${pct}% 대기</span>`
    : `<span class="pct-badge">완강 ${pct}%</span>`;
  return `<div class="avatar-ring${pending ? ' pending' : ''}" style="--p:${pct}"
      title="${prog ? (pending ? '승인 대기 중인 수강률' : '인증된 수강률') + ' ' + pct + '% · ' + esc(prog.course) : '아직 수강 인증 전이에요'}">
    ${kind === 'love' ? '<span class="love-mark">💖</span>' : ''}
    <div class="avatar">${photo ? `<img src="${photo}" alt="">` : esc(name.charAt(0))}</div>
    ${badge}
  </div>`;
}

/* ---------- 시작 화면 왼쪽 위 패널 ---------- */
function renderMyPanel() {
  const panel = document.getElementById('my-panel');
  if (!panel) return;
  const favs = getFavs().filter(f => findTeacher(f.name));
  if (!favs.length) { panel.innerHTML = ''; return; }

  const order = Object.keys(labelMap.subject);           // 수학, 국어, 영어, 과학, 사회 순서
  const groups = {};
  favs.forEach(f => {
    const t = findTeacher(f.name);
    (groups[t.subject] = groups[t.subject] || []).push({ f, t });
  });

  panel.innerHTML = order.filter(s => groups[s]).map(s => `
    <div class="mp-group">
      <div class="mp-subject">${esc(labelMap.subject[s])}</div>
      <div class="mp-row">
        ${groups[s].map(({ f, t }) => `
          <button class="mp-t" onclick="openDetail(findTeacher(${jsArg(f.name)}))">
            ${avatarHTML(f.name, f.kind)}
            <span class="mp-name">${esc(f.name)}</span>
            <span class="mp-sub">${esc(t.subSubject ? labelMap.subSubject[t.subSubject] : t.platform.split('/')[0].trim())}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

/* ---------- 내 선생님 등록 모달 ---------- */
let favSubject = 'math';

function openMyTeachers() {
  showModal(`
    <h3>⭐ 내 선생님 등록</h3>
    <p class="review-guide">지금 듣고 있는 선생님이나 최애쌤을 등록하면 시작 화면 왼쪽 위에 과목별로 보여요.
    강좌를 <b>10% 이상 수강 인증</b>하면 얼굴 옆에 <b>완강 %</b>가 표시되고 후기도 쓸 수 있어요.</p>
    <button class="ghost-btn" style="margin-bottom:6px" onclick="openMyReviews()">내가 쓴 수강 후기 보기 (${getMyReviews().length}개)</button>
    <div class="modal-section"><h4>📌 내가 등록한 선생님</h4><div id="my-list"></div></div>
    <div class="modal-section"><h4>🔍 선생님 찾기</h4>
      <div class="filter-row" id="fav-subjects"></div>
      <div id="fav-pick"></div>
    </div>`);
  renderMyTeachers();
}

function renderMyTeachers() {
  const my = document.getElementById('my-list');
  if (!my) return;
  const favs = getFavs().filter(f => findTeacher(f.name));
  my.innerHTML = favs.length ? favs.map(f => {
    const t = findTeacher(f.name);
    const n = jsArg(f.name);
    const prog = getMyProgress(f.name);
    return `<div class="my-item">
      <div class="my-left">
        ${avatarHTML(f.name, f.kind)}
        <div><b>${esc(f.name)}</b> <span class="kind-badge ${f.kind}">${f.kind === 'love' ? '💖 최애쌤' : '📖 듣는 중'}</span>
          <div class="muted small">${esc(t.platform)} · ${esc(labelMap.subject[t.subject])}</div>
          ${prog ? `<div class="muted small">📚 ${esc(prog.course)}</div>` : ''}
        </div>
      </div>
      <div class="my-actions">
        <button class="mini-btn photo-btn" onclick="pickPhoto(${n})">사진</button>
        ${getPhoto(f.name) ? `<button class="mini-btn photo-btn" onclick="removePhoto(${n})">사진 삭제</button>` : ''}
        <button class="mini-btn accent" onclick="openWriteReview(findTeacher(${n}))">${prog ? '진도 업데이트' : '수강 인증 · 후기'}</button>
      </div></div>`;
  }).join('') : '<p class="empty-note">아직 등록한 선생님이 없어요. 아래에서 골라 주세요.</p>';

  const sf = document.getElementById('fav-subjects');
  sf.innerHTML = Object.entries(labelMap.subject).map(([k, v]) =>
    `<button class="chip${favSubject === k ? ' on' : ''}" onclick="favSubject='${k}';renderMyTeachers()">${v}</button>`).join('');

  const seen = new Set();
  const list = teachers.filter(t => t.subject === favSubject && !seen.has(t.name) && seen.add(t.name));
  const favMap = Object.fromEntries(getFavs().map(f => [f.name, f.kind]));

  // 플랫폼별로 나눠서 보여주기 (메가스터디 / 대성마이맥 / 이투스 / EBS / 기타)
  const byPlatform = {};
  list.forEach(t => { const p = platformGroup(t.platform); (byPlatform[p] = byPlatform[p] || []).push(t); });

  document.getElementById('fav-pick').innerHTML = PLATFORM_ORDER.filter(p => byPlatform[p]).map(p => `
    <div class="platform-group">
      <div class="platform-title">${esc(p)} <span class="muted small">${byPlatform[p].length}명</span></div>
      ${byPlatform[p].map(t => {
        const n = jsArg(t.name);
        const k = favMap[t.name];
        return `<div class="pick-item">
          <div><b>${esc(t.name)}</b><div class="muted small">${esc(t.platform)}${t.subSubject ? ' · ' + esc(labelMap.subSubject[t.subSubject]) : ''}</div></div>
          <div class="my-actions">
            <button class="mini-btn${k === 'taking' ? ' on' : ''}" onclick="toggleFav(${n},'taking')">듣는 중</button>
            <button class="mini-btn${k === 'love' ? ' on' : ''}" onclick="toggleFav(${n},'love')">최애</button>
          </div></div>`;
      }).join('')}
    </div>`).join('');
}

const PLATFORM_ORDER = ['메가스터디', '대성마이맥', '이투스', 'EBS', '기타'];
// "EBS / 이투스"처럼 여러 곳이면 앞에 적힌 곳 기준
function platformGroup(platform) {
  const first = platform.split('/')[0].trim();
  return PLATFORM_ORDER.find(p => first.includes(p)) || '기타';
}

function initMyTeachers() {
  renderMyPanel();
  syncMyProgress();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMyTeachers);
else initMyTeachers();

/* =====================================================================
   5) 내가 쓴 수강 후기 — 이 브라우저에 보관 + 서버의 승인 상태와 동기화
   ===================================================================== */
const MYREV_KEY = 'insegnante.myReviews';

function getMyReviews() { return loadJSON(MYREV_KEY, []); }

function saveMyReview(r) {
  const list = getMyReviews().filter(x => x.id !== r.id);
  list.unshift(r);
  saveJSON(MYREV_KEY, list);
}

// 서버에서 가져온 내 후기들로 상태(대기/공개/반려)를 갱신하고, 다른 기기에서 쓴 것도 추가
function syncMyReviews(snap) {
  const local = getMyReviews();
  const byId = Object.fromEntries(local.map(r => [r.id, r]));
  snap.docs.forEach(d => {
    const r = d.data();
    const created = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toISOString() : (byId[d.id] || {}).createdAt;
    byId[d.id] = {
      ...(byId[d.id] || {}), id: d.id, teacher: r.teacher, course: r.course, progress: r.progress,
      rating: r.rating, text: r.text, nickname: r.nickname, status: r.status, createdAt: created
    };
  });
  const list = Object.values(byId).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  saveJSON(MYREV_KEY, list);
}

const STATUS_LABEL = {
  pending: ['승인 대기', 'pending'],
  approved: ['공개됨', 'approved'],
  rejected: ['반려됨', 'rejected']
};

async function openMyReviews() {
  showModal(`
    <h3>내가 쓴 수강 후기</h3>
    <p class="review-guide">내가 작성한 후기와 관리자 확인 상태예요.
      <b>승인 대기</b>는 수강 인증 캡처를 확인 중이고, <b>공개됨</b>은 다른 학생들에게 보이는 후기예요.</p>
    <div id="my-reviews"><p class="empty-note">불러오는 중...</p></div>
    <div class="modal-actions">
      <button class="ghost-btn" onclick="openMyTeachers()">← 내 선생님으로</button>
    </div>`);
  // 서버와 동기화 후 다시 그림 (서버가 없으면 이 브라우저에 저장된 것만 보여줌)
  renderMyReviews();
  if (firebaseEnabled()) {
    try {
      const user = await ensureSignedIn({ silent: true });
      const snap = await fb.db.collection('reviews').where('uid', '==', user.uid).get();
      syncMyReviews(snap);
      renderMyReviews();
    } catch (e) { console.warn('내 후기 동기화 실패', e); }
  }
}

function renderMyReviews() {
  const box = document.getElementById('my-reviews');
  if (!box) return;
  const list = getMyReviews();
  if (!list.length) {
    box.innerHTML = `<p class="empty-note">아직 작성한 후기가 없어요.<br>
      선생님 카드의 <b>수강생 후기 → 후기 쓰기</b>에서 강좌를 10% 이상 수강 인증하고 후기를 남길 수 있어요.</p>`;
    return;
  }
  box.innerHTML = list.map(r => {
    const [lbl, cls] = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
    const d = r.createdAt ? new Date(r.createdAt) : null;
    const date = d && !isNaN(d) ? `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` : '';
    const t = findTeacher(r.teacher);
    return `<div class="review-item my-review">
      <div class="review-head">
        <b>${esc(r.teacher)}</b>
        <span class="rv-status ${cls}">${lbl}</span>
      </div>
      <div class="review-head" style="margin-top:4px">
        <span class="stars">${stars(Number(r.rating) || 0)}</span>
        <span class="verified">수강 인증 ${Math.round(r.progress || 0)}%</span>
      </div>
      <div class="review-course">📚 ${esc(r.course || '')}</div>
      <div class="review-text">${esc(r.text || '')}</div>
      <div class="review-meta">${esc(r.nickname || '익명')} · ${date}
        ${t ? ` · <a href="#" onclick="openReviews(findTeacher(${jsArg(r.teacher)}));return false;">이 선생님 후기 전체 보기</a>` : ''}</div>
      ${r.status === 'rejected' ? '<p class="field-msg error" style="margin-top:6px">수강 인증을 확인하지 못해 공개되지 않았어요. 진도율이 보이는 캡처로 다시 작성해 주세요.</p>' : ''}
    </div>`;
  }).join('');
}
/* =====================================================================
   6) 정보 제보 / 수정 요청 — 목록에 없는 선생님, 바뀐 강좌·가격·소속 등
   ===================================================================== */
const REPORT_TYPES = [
  ['add', '목록에 없는 선생님 추가 요청'],
  ['course', '강좌·커리큘럼이 바뀌었어요'],
  ['price', '강좌 가격·수강 기간이 달라요'],
  ['platform', '소속 사이트가 바뀌었어요 (이적 등)'],
  ['leave', '더 이상 강의하지 않아요'],
  ['etc', '기타 (잘못된 정보 등)']
];
const MYREPORT_KEY = 'insegnante.myReports';

function openReport(prefill = {}) {
  if (typeof toggleSearch === 'function') toggleSearch(false);
  if (typeof requireLogin === 'function' && !requireLogin('정보 제보는 로그인 후 보낼 수 있어요.', () => openReport(prefill))) return;
  const opt = (v, l) => `<option value="${v}"${prefill.type === v ? ' selected' : ''}>${l}</option>`;
  showModal(`
    <h3>정보 제보 · 수정 요청</h3>
    <p class="review-guide">목록에 없는 선생님이 있거나, 강좌·가격·소속이 바뀐 경우 알려 주세요.
      관리자가 확인한 뒤 반영할게요. <b>공식 사이트 링크</b>를 함께 적어 주시면 더 빨리 반영돼요.</p>
    ${initFirebase() ? '' : '<div class="notice-box">⚠️ 제보 서버가 아직 연결되지 않아서, 지금은 이 브라우저에만 저장돼요. 서버가 연결되면 관리자에게 전달돼요.</div>'}
    <form class="form" onsubmit="submitReport(event)">
      <label>어떤 내용인가요?
        <select id="rp-type" required>${REPORT_TYPES.map(([v, l]) => opt(v, l)).join('')}</select>
      </label>
      <label>선생님 이름
        <input id="rp-name" type="text" maxlength="30" required placeholder="예: 홍길동" value="${esc(prefill.name || '')}">
      </label>
      <div class="form-row">
        <label>사이트
          <select id="rp-platform">
            ${['메가스터디', '이투스', '대성마이맥', 'EBS', '기타'].map(p => `<option${prefill.platform && prefill.platform.includes(p) ? ' selected' : ''}>${p}</option>`).join('')}
          </select>
        </label>
        <label>과목
          <select id="rp-subject">
            ${Object.entries(labelMap.subject).map(([k, v]) => `<option value="${k}"${prefill.subject === k ? ' selected' : ''}>${v}</option>`).join('')}
            <option value="etc">기타</option>
          </select>
        </label>
      </div>
      <label>내용
        <textarea id="rp-text" rows="5" minlength="5" maxlength="1000" required
          placeholder="예: 2027 강좌 '○○○ 개념완성'이 새로 열렸어요 / 이투스에서 메가스터디로 옮겼어요 / 목록에 ○○○ 선생님(사회문화)이 없어요"></textarea>
      </label>
      <label>참고 링크 <span class="muted">(선택 · 선생님 페이지나 강좌 페이지)</span>
        <input id="rp-link" type="url" maxlength="300" placeholder="https://">
      </label>
      <p id="rp-error" class="field-msg error"></p>
      <button class="link-btn as-btn" type="submit" id="rp-submit">제보하기</button>
      <button class="ghost-btn" type="button" onclick="openMyReports()">내가 보낸 제보 보기</button>
    </form>`);
}

async function submitReport(ev) {
  ev.preventDefault();
  const err = document.getElementById('rp-error');
  const btn = document.getElementById('rp-submit');
  const type = document.getElementById('rp-type').value;
  const name = document.getElementById('rp-name').value.trim();
  const platform = document.getElementById('rp-platform').value;
  const subject = document.getElementById('rp-subject').value;
  const text = document.getElementById('rp-text').value.trim();
  const link = document.getElementById('rp-link').value.trim();
  if (!name) return (err.textContent = '선생님 이름을 적어 주세요.');
  if (text.length < 5) return (err.textContent = '내용을 5자 이상 적어 주세요.');
  if (link && !/^https?:\/\//i.test(link)) return (err.textContent = '링크는 http:// 또는 https:// 로 시작해야 해요.');

  const typeLabel = (REPORT_TYPES.find(x => x[0] === type) || [, '기타'])[1];
  const record = { type, field: typeLabel, teacher: name, platform, subject, text, link, createdAt: new Date().toISOString(), sent: false };

  btn.disabled = true; btn.textContent = '보내는 중...';
  if (firebaseEnabled()) {
    try {
      const user = await ensureSignedIn();
      await fb.db.collection('corrections').add({
        teacher: name, field: typeLabel, type, platform, subject, link,
        text, status: 'open', uid: user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      record.sent = true;
    } catch (e) {
      console.error(e);
    }
  }
  const list = loadJSON(MYREPORT_KEY, []);
  list.unshift(record);
  saveJSON(MYREPORT_KEY, list.slice(0, 50));

  showModal(`
    <h3>제보 고마워요!</h3>
    <p class="review-guide">${record.sent ? '관리자에게 전달됐어요. 확인 후 선생님 정보에 반영할게요.'
      : '제보 서버에 연결되지 않아 이 브라우저에 저장해 두었어요.'}</p>
    <div class="modal-actions">
      <button class="link-btn as-btn" onclick="openReport()">다른 내용 제보하기</button>
      <button class="ghost-btn" onclick="openMyReports()">내가 보낸 제보 보기</button>
    </div>`);
}

function openMyReports() {
  const list = loadJSON(MYREPORT_KEY, []);
  showModal(`
    <h3>내가 보낸 제보</h3>
    ${list.length ? list.map(r => {
      const d = new Date(r.createdAt);
      const date = isNaN(d) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      const safeLink = r.link && /^https?:\/\//i.test(r.link) ? r.link : '';
      return `<div class="review-item">
        <div class="review-head"><b>${esc(r.teacher)}</b>
          <span class="rv-status ${r.sent ? 'approved' : 'pending'}">${r.sent ? '전달됨' : '이 브라우저에만 저장'}</span></div>
        <div class="review-course">${esc(r.field)} · ${esc(r.platform)} · ${esc(labelMap.subject[r.subject] || '기타')}</div>
        <div class="review-text">${esc(r.text)}</div>
        ${safeLink ? `<div class="review-meta"><a href="${esc(safeLink)}" target="_blank" rel="noopener">${esc(safeLink)}</a></div>` : ''}
        <div class="review-meta">${date}</div>
      </div>`;
    }).join('') : '<p class="empty-note">아직 보낸 제보가 없어요.</p>'}
    <div class="modal-actions"><button class="link-btn as-btn" onclick="openReport()">새로 제보하기</button></div>`);
}

// 선생님 후기 창의 '정보가 틀렸어요'도 같은 제보 양식을 사용 (선생님 정보 미리 채움)
openCorrection = function (t) { if (t) openReport({ name: t.name, platform: t.platform, subject: t.subject, type: 'course' }); };


// 로그인/로그아웃하면 '내 선생님' 수강률·후기 상태 다시 확인
if (typeof onAuthChange === 'function') onAuthChange(p => { if (p) syncMyProgress(); });
