/* =====================================================================
   Insegnante — 로그인 · 회원가입 · 후기 쓰기 · 후기 보기 페이지가 함께 쓰는 코드
   1) Firebase 연결 (firebase-config.js 의 설정 사용)
   2) 로그인 상태 확인 → 회원 정보(닉네임) · 관리자 여부
   3) 페이지 맨 위 메뉴 그리기
   4) 자주 쓰는 도구 함수 (글자 안전하게 넣기, 별점, 날짜 등)
   ===================================================================== */

/* ---------- 1) Firebase 연결 ---------- */
let fb = null;   // { db: 데이터베이스(Firestore), auth: 로그인(Authentication) }

function firebaseEnabled() {
  return !!(window.FIREBASE_CONFIG && window.firebase);
}

function initFirebase() {
  if (fb || !firebaseEnabled()) return fb;
  try {
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
    fb = { db: app.firestore(), auth: app.auth() };
  } catch (e) {
    console.error('Firebase 연결 실패', e);
    fb = null;
  }
  return fb;
}

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

/* ---------- 2) 로그인 상태 ---------- */
let profile = null;   // 로그인했으면 { uid, email, nickname, isAdmin }, 아니면 null

// 페이지가 열릴 때 로그인 상태를 한 번 확인할 때까지 기다리는 약속(Promise)
const authReady = new Promise(resolve => {
  document.addEventListener('DOMContentLoaded', () => {
    renderHeader();
    if (!initFirebase()) { resolve(null); return; }
    let first = true;
    fb.auth.onAuthStateChanged(async user => {
      if (user && !user.isAnonymous) {
        let nickname = '', isAdmin = false;
        try {
          const u = await fb.db.collection('users').doc(user.uid).get();
          if (u.exists) nickname = u.data().nickname || '';
        } catch (e) { /* 회원 정보가 아직 없을 수 있음 */ }
        try {
          isAdmin = (await fb.db.collection('admins').doc(user.uid).get()).exists;
        } catch (e) { /* 관리자 아님 */ }
        profile = { uid: user.uid, email: user.email || '', nickname: nickname || (user.email || '회원').split('@')[0], isAdmin };
      } else {
        profile = null;
      }
      renderHeader();
      if (first) { first = false; resolve(profile); }
      document.dispatchEvent(new CustomEvent('authchange', { detail: profile }));
    });
  });
});

async function logout() {
  if (!confirm('로그아웃할까요?')) return;
  try { await fb.auth.signOut(); } catch (e) { }
  location.reload();
}

// 지금 페이지 주소 (로그인 후 돌아올 곳)
function currentPage() {
  return (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
}

// 로그인 페이지로 보내기 (로그인이 끝나면 지금 페이지로 돌아옴)
function goLogin() {
  location.href = 'login.html?next=' + encodeURIComponent(currentPage());
}

// 다른 사이트로 튀어 나가지 않도록, 같은 폴더의 페이지 주소만 허용
function safeNext(next) {
  if (!next || /^[a-z]+:|^\/\/|^\\/i.test(next)) return 'index.html';
  return next;
}

/* ---------- 3) 맨 위 메뉴 ---------- */
function renderHeader() {
  const box = document.getElementById('site-header');
  if (!box) return;
  const page = location.pathname.split('/').pop() || 'index.html';
  const on = p => (page === p ? ' class="on"' : '');
  const right = profile
    ? `<span class="hd-user">${profile.isAdmin ? '<span class="admin-badge">관리자</span>' : ''}${esc(profile.nickname)}님</span>
       <button class="hd-btn ghost" onclick="logout()">로그아웃</button>`
    : `<a class="hd-btn ghost" href="login.html?next=${encodeURIComponent(currentPage())}">로그인</a>
       <a class="hd-btn" href="signup.html?next=${encodeURIComponent(currentPage())}">회원가입</a>`;
  box.innerHTML = `
    <div class="hd-inner">
      <a class="hd-logo" href="index.html">Insegnante</a>
      <nav class="hd-menu">
        <a href="index.html">선생님 찾기</a>
        <a href="reviews.html"${on('reviews.html')}>수강 후기</a>
        <a href="write.html"${on('write.html')}>후기 쓰기</a>
        ${profile && profile.isAdmin ? '<a href="index.html#admin" class="hd-admin">관리자</a>' : ''}
      </nav>
      <div class="hd-auth">${right}</div>
    </div>`;
}

/* ---------- 4) 도구 함수 ---------- */
// 사용자가 쓴 글을 화면에 안전하게 넣기 (HTML 코드로 실행되지 않게)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stars(n) {
  n = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function fmtDate(ts) {
  if (!ts || !ts.toDate) return '';
  const d = ts.toDate(), p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function timeOf(r) {
  return r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : Date.now();
}

// 주소의 ?이름=값 읽기
function qs(name) {
  return new URLSearchParams(location.search).get(name) || '';
}

const NO_SERVER_HTML = `
  <div class="notice">후기 서버가 아직 연결되지 않았어요.<br>
  <b>firebase-config.js</b>에 Firebase 설정값을 넣고, Live Server 등으로 페이지를 열어 주세요.</div>`;

/* ---------- 선생님 목록 (teacher-list.js + 관리자가 추가한 선생님) ---------- */
let teacherList = (window.TEACHER_LIST || []).map(t => ({ ...t }));

async function loadTeacherList() {
  if (!initFirebase()) return teacherList;
  try {
    const snap = await fb.db.collection('teacherEdits').get();
    snap.docs.forEach(d => {
      const e = d.data();
      if (!e.name || e.hidden) return;
      let t = teacherList.find(x => x.n === e.name);
      if (!t) { t = { n: e.name, p: [], s: [], c: [] }; teacherList.push(t); }
      if (e.platform && !t.p.includes(e.platform)) t.p.push(e.platform);
      (e.courses || []).forEach(c => { if (c.title && !t.c.includes(c.title)) t.c.unshift(c.title); });
    });
  } catch (e) { console.warn('관리자 수정 정보를 불러오지 못했어요', e); }
  teacherList.sort((a, b) => a.n.localeCompare(b.n, 'ko'));
  return teacherList;
}

function findTeacherInfo(name) {
  return teacherList.find(t => t.n === name) || null;
}

// <datalist> 로 선생님 이름 자동완성
function fillTeacherDatalist(id) {
  const dl = document.getElementById(id);
  if (dl) dl.innerHTML = teacherList.map(t => `<option value="${esc(t.n)}">${esc(t.p.join(' · '))} · ${esc(t.s.join(', '))}</option>`).join('');
}
