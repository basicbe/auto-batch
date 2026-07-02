// 도크 정의 및 타이밍 설정

// 전체 18개 도크 (B27, B39 없음). 배열 순서 = 물리적 순서 = FIFO 동순위 보조정렬 기준.
const DOCK_DEFS = [
  ['B22', '2번 대형'], ['B23', '2번 대형'], ['B24', '2번 대형'], ['B25', '2번 대형'], ['B26', '2번 대형'],
  ['B28', '2번 대형'], ['B29', '2번 대형'], ['B30', '2번 대형'], ['B31', '2번 대형'],
  ['B32', '1번 대형'], ['B33', '1번 대형'], ['B34', '1번 대형'], ['B35', '1번 대형'], ['B36', '1번 대형'],
  ['B37', '1번 대형'], ['B38', '1번 대형'], ['B40', '1번 대형'], ['B41', '1번 대형'],
];

// 휴게 시작 후 ASSIGN_DELAY_SEC가 지나면 그 작업자에게 대기열의 가장 오래된 도크를 배정한다(기본 6분 30초).
// BREAK_DELAY_SEC는 실제 휴게 길이(기본 9분 50초) — 배정~복귀 사이 "복귀중" 표시에만 사용.
// 두 값은 기본값일 뿐 — 관리 화면 요약줄의 "배정/휴게"를 눌러 실시간 변경 가능(state에 저장, 이쪽이 우선).
// 데모로 빠르게 보려면 환경변수로 짧게: ASSIGN_DELAY_SEC=8 BREAK_DELAY_SEC=12 npm start
const ASSIGN_DELAY_SEC = Number(process.env.ASSIGN_DELAY_SEC || 390);
const BREAK_DELAY_SEC = Number(process.env.BREAK_DELAY_SEC || 590);

// 빠른 배정 윈도우: 아래 구간에 휴게가 시작되면 배정을 ASSIGN_DELAY_SEC 대신
// FAST_ASSIGN_DELAY_SEC(기본 2초)로 — "바로바로" 배치.
//   ① 작업 시작 후 FAST_AFTER_START_MIN 분 이내 (기본 56분)
//   ② 밥시간 직후 FAST_AFTER_MEAL_MIN 분 (KST). 기본 밥 00:00~01:00 → 빠른배정 01:00~01:56.
//      밥시간은 세팅에서 수정 가능(state.mealStart/mealEnd). 아래는 기본값. 서버가 해외여도 KST 기준.
const FAST_ASSIGN_DELAY_SEC = Number(process.env.FAST_ASSIGN_DELAY_SEC || 2);
const FAST_HIGHLIGHT_SEC = Number(process.env.FAST_HIGHLIGHT_SEC || 120); // 빠른배정 시 "→ 이동" 강조 유지(초, 기본 2분)
const FAST_AFTER_START_MIN = Number(process.env.FAST_AFTER_START_MIN || 56);
const FAST_AFTER_MEAL_MIN = Number(process.env.FAST_AFTER_MEAL_MIN || 56); // 밥시간 직후 빠른배정 길이(분)
const MEAL_START_DEFAULT = process.env.MEAL_START || '00:00';
const MEAL_END_DEFAULT = process.env.MEAL_END || '01:00';
const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? 9); // KST = UTC+9

// "종료 취소" 허용 시간(초): 작업종료를 누른 뒤 이 시간 안에만 되돌리기 가능/표시
const UNDO_WINDOW_SEC = Number(process.env.UNDO_WINDOW_SEC || 60);

// 타이머 누락/재시작 대비 주기적 점검 간격
const SWEEP_INTERVAL_MS = 4000;

module.exports = {
  DOCK_DEFS, ASSIGN_DELAY_SEC, BREAK_DELAY_SEC, SWEEP_INTERVAL_MS, UNDO_WINDOW_SEC,
  FAST_ASSIGN_DELAY_SEC, FAST_HIGHLIGHT_SEC, FAST_AFTER_START_MIN, FAST_AFTER_MEAL_MIN,
  MEAL_START_DEFAULT, MEAL_END_DEFAULT, TZ_OFFSET_HOURS,
};
