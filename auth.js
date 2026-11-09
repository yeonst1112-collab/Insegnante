/* =====================================================================
   Insegnante — 로그인 시스템 (Firebase Authentication · 이메일/비밀번호)
   - 일반 사용자: 회원가입 → 로그인 → 후기 쓰기 · 내 후기 · 정보 제보
   - 관리자: Firestore 'admins/{uid}' 문서가 있는 계정 → 관리자 페이지 사용
   - 로그인하지 않아도 선생님 찾기 · 후기 읽기는 가능
   ===================================================================== */

let currentProfile = null;          // { uid, email, nickname, isAdmin } 또는 null
const authListeners = [];
let pendingAfterLogin = null;       // 로그인 성공 후 이어서 할 동작 (예: 후기 쓰기 창 다시 열기)

function onAuthChange(fn) { authListeners.push(fn); }
function isLoggedIn() { return !!currentProfile; }
function isAdminUser() { return !!(currentProfile && currentProfile.isAdmin); }

/* ---------- 로그인 상태 감시 ---------- */
function initAuth() {
  renderAuthMenu();
  if (!initFirebase()) return;
  fb.auth.onAuthStateChanged(async user => {
    if (user && user.isAnonymous) { try { await fb.auth.signOut(); } catch (e) { } return; }   // 예전 익명 로그인 정리
    if (user) {
      let nickname = '', isAdmin = false;
      try {
        const p = await fb.db.collection('users').doc(user.uid).get();
        if (p.exists) nickname = p.data().nickname || '';
      } catch (e) { console.warn('프로필 불러오기 실패', e); }
      try {
        const a = await fb.db.collection('admins').doc(user.uid).get();
        isAdmin = a.exists;
      } catch (e) { /* 관리자 아님 */ }
      const keep = currentProfile && currentProfile.uid === user.uid ? currentProfile.nickname : '';
      currentProfile = { uid: user.uid, email: user.email || '', nickname: nickname || keep || (user.email || '사용자').split('@')[0], isAdmin };
    } else {
      currentProfile = null;
    }
    renderAuthMenu();
    authListeners.forEach(fn => { try { fn(currentProfile); } catch (e) { console.error(e); } });
    if (currentProfile && pendingAfterLogin) { const f = pendingAfterLogin; pendingAfterLogin = null; f(); }
  });
}

/* ---------- 상단 메뉴: 로그인 버튼 / 닉네임 ---------- */
function renderAuthMenu() {
  const area = document.getElementById('gnb-auth');
  const adminBtn = document.getElementById('gnb-admin');
  if (adminBtn) adminBtn.style.display = isAdminUser() ? '' : 'none';
  if (!area) return;
  if (!currentProfile) {
    area.innerHTML = `<button class="gnb-user" onclick="openLogin()">로그인</button>
      <button class="gnb-login" onclick="openLogin('', 'signup')">회원가입</button>`;
  } else {
    area.innerHTML = `<button class="gnb-user" onclick="openAccount()">
      ${isAdminUser() ? '<span class="admin-badge">관리자</span>' : ''}${esc(currentProfile.nickname)}님 ▾</button>`;
  }
}

/* 로그인이 필요한 기능 앞에서 호출: 로그인 안 했으면 로그인 페이지로 보내고 false */
function requireLogin(message, after) {
  if (isLoggedIn()) return true;
  if (!firebaseEnabled()) { showModal(`<h3>로그인이 필요해요</h3>${NO_SERVER_HTML}`); return false; }
  if (!confirm((message || '로그인이 필요해요.') + '\n로그인 페이지로 이동할까요?')) return false;
  openLogin(message);
  return false;
}

/* ---------- 로그인 / 회원가입: 별도 페이지 (login.html · signup.html) ----------
   로그인이 끝나면 ?next= 에 적힌 지금 페이지로 돌아옴 */
function openLogin(message, tab) {
  const here = (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
  location.href = (tab === 'signup' ? 'signup.html' : 'login.html') + '?next=' + encodeURIComponent(here);
}

async function doLogout() {
  if (!confirm('로그아웃할까요?')) return;
  try { await fb.auth.signOut(); } catch (e) { }
  currentProfile = null;
  renderAuthMenu();
  closeDetail();
  const cur = document.querySelector('.screen.active');
  if (cur && cur.id === 'admin-screen') goScreen('start-screen');
}

/* ---------- 내 계정 창 ---------- */
function openAccount() {
  if (!currentProfile) return openLogin();
  showModal(`
    <h3>${esc(currentProfile.nickname)}님</h3>
    <div class="teacher-platform">${esc(currentProfile.email)}${isAdminUser() ? ' · <b>관리자</b>' : ''}</div>
    <div class="modal-actions">
      ${isAdminUser() ? '<button class="link-btn as-btn" onclick="closeDetail();openAdmin()">관리자 페이지</button>' : ''}
      <a class="ghost-btn" style="text-align:center;text-decoration:none" href="write.html">수강 후기 쓰기</a>
      <button class="ghost-btn" onclick="openMyReviews()">내가 쓴 수강 후기</button>
      <button class="ghost-btn" onclick="openMyReports()">내가 보낸 제보</button>
      <button class="ghost-btn" onclick="openMyTeachers()">내 선생님</button>
      <button class="ghost-btn" onclick="openNicknameEdit()">닉네임 바꾸기</button>
      <button class="ghost-btn" onclick="doLogout()">로그아웃</button>
    </div>`);
}

function openNicknameEdit() {
  showModal(`
    <h3>닉네임 바꾸기</h3>
    <form class="form" onsubmit="saveNickname(event)">
      <label>새 닉네임 <span class="muted">(2~12자)</span>
        <input id="nk-new" type="text" required minlength="2" maxlength="12" value="${esc(currentProfile.nickname)}">
      </label>
      <p id="nk-error" class="field-msg error"></p>
      <button class="link-btn as-btn" type="submit">저장</button>
      <button class="ghost-btn" type="button" onclick="openAccount()">← 돌아가기</button>
    </form>`);
}

async function saveNickname(ev) {
  ev.preventDefault();
  const v = document.getElementById('nk-new').value.trim();
  const err = document.getElementById('nk-error');
  if (v.length < 2 || v.length > 12) return (err.textContent = '닉네임은 2~12자로 정해 주세요.');
  try {
    await fb.db.collection('users').doc(currentProfile.uid).set({ nickname: v }, { merge: true });
    currentProfile.nickname = v;
    renderAuthMenu();
    openAccount();
  } catch (e) { err.textContent = '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'; }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuth);
else initAuth();
