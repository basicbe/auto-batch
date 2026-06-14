// Supabase 연결 확인 (읽기 전용).  npm run db:test
const db = require('../src/db');

(async () => {
  console.log('DB 모드:', db.mode);
  if (db.mode === 'file') {
    console.error('✗ Supabase 설정이 없습니다. .env 에 SUPABASE_URL + 키(또는 DATABASE_URL)를 넣으세요.');
    process.exit(1);
  }
  try {
    const s = await db.load();
    console.log('✓ Supabase 연결 성공');
    console.log('  저장된 상태:', s ? `있음 (configured=${s.configured})` : '없음 (앱 첫 실행 시 생성됨)');
    process.exit(0);
  } catch (e) {
    if (e.tableMissing) {
      console.log('✓ 연결/인증 성공! 테이블만 만들면 됩니다.');
      console.log('  → Supabase 대시보드 → SQL Editor 에서 supabase/schema.sql 내용을 실행한 뒤 다시 시도하세요.');
      process.exit(2);
    }
    console.error('✗ 연결 실패:', e.message);
    console.error('  SUPABASE_URL / 키 값을 확인하세요.');
    process.exit(1);
  }
})();
