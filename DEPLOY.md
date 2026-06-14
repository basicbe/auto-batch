# Render 배포 가이드

이 앱은 Node 서버 하나(화면+백엔드 통합)라 Render에 **하나만** 올리면 된다.
코드는 GitHub에 올리고 Render가 그 저장소를 받아 빌드·실행한다. **비밀 키는 코드가 아니라 Render 환경변수로** 넣는다(`.env`는 안 올라감).

---

## 1단계 — GitHub에 코드 올리기

GitHub 계정이 없으면 https://github.com 에서 무료 가입.

1. GitHub에서 **New repository** → 이름 `auto-batch`, **Private** 추천 → **Create repository**
   (README/.gitignore 추가 옵션은 체크하지 말 것 — 이미 있음)
2. 이 폴더에서 터미널로:
   ```bash
   git remote add origin https://github.com/<내아이디>/auto-batch.git
   git push -u origin main
   ```
   로그인 창이 뜨면 GitHub 계정으로. (비밀번호 대신 토큰을 요구하면:
   GitHub → Settings → Developer settings → Personal access tokens 에서 발급)

> ✅ `.env`(Supabase 키·비밀번호)는 `.gitignore`에 있어 **절대 안 올라간다.**
> 확인: `git status` 에 `.env` 가 안 보이면 정상.

---

## 2단계 — Render에서 웹 서비스 만들기

Render 계정이 없으면 https://render.com 에서 **GitHub로 가입**(무료, 카드 불필요).

1. 대시보드 → **New +** → **Web Service**
2. **Build and deploy from a Git repository** → `auto-batch` 저장소 선택
   (처음이면 "Connect GitHub"로 권한 허용)
3. 설정값:
   - **Name**: `auto-batch` (주소가 `auto-batch.onrender.com` 처럼 됨)
   - **Region**: 가까운 곳 (예: Singapore)
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
4. **Environment Variables** — "Add Environment Variable" 로 3개 추가:

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | 당신의 `https://....supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 |
   | `MANAGER_PASSWORD` | 원하는 관리자 비밀번호 |

5. **Create Web Service** → 빌드가 끝나면 `https://auto-batch.onrender.com` 주소가 생긴다.

---

## 3단계 — 사용

- 관리자: `https://<주소>/manager.html` (비밀번호 입력)
- 세팅: `https://<주소>/setup.html`
- 보드: `https://<주소>/board.html` (현장 화면 — QR로 벽에 붙여두면 편함)

---

## 참고

- 코드를 고친 뒤 `git push` 하면 Render가 **자동 재배포**한다.
- 무료 플랜은 15분간 아무 접속이 없으면 잠들고, 다음 접속 시 ~50초 깨어난다. **데이터는 Supabase에 안전.** 관리자/보드 화면이 열려 있으면 연결이 유지돼 잘 안 잠든다.
- 항상 즉시 응답이 필요하면 유료(~$7/월)로 올려 슬립을 없앨 수 있다.
- DB 테이블(`app_state`)은 앱이 처음 켜질 때… 가 아니라 **supabase-js 모드라 미리 만들어 둬야 한다** — 이미 만들어 뒀으면 그대로 동작.
