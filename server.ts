// server.ts
import "dotenv/config"; // .env의 KAKAO_T_* 등 로컬 개발 비밀값 로드 (파일 없으면 조용히 무시)
import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDocs, collection, writeBatch, getDoc, deleteDoc } from "firebase/firestore";

const app = express();
const PORT = 3000;

app.use(express.json());

// ----------------------------------------------------
// 파이어베이스(Firebase) - Firestore 연동 및 초기화 
// ----------------------------------------------------
let dbFirebase: any = null;
let firebaseProjectID = "";
let isFirebaseConnected = false;

try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const rawConf = fs.readFileSync(firebaseConfigPath, "utf8");
    const parsedConf = JSON.parse(rawConf);
    firebaseProjectID = parsedConf.projectId;
    
    const firebaseApp = initializeApp({
      apiKey: parsedConf.apiKey,
      authDomain: parsedConf.authDomain,
      projectId: parsedConf.projectId,
      storageBucket: parsedConf.storageBucket,
      messagingSenderId: parsedConf.messagingSenderId,
      appId: parsedConf.appId
    });
    
    dbFirebase = parsedConf.firestoreDatabaseId 
      ? getFirestore(firebaseApp, parsedConf.firestoreDatabaseId)
      : getFirestore(firebaseApp);
    isFirebaseConnected = true;
    console.log(`[Firebase Initialized] Cloud Firestore is ready! Project ID: ${firebaseProjectID}`);
  } else {
    console.warn("[Firebase Warn] firebase-applet-config.json not found. Live cloud backup is disabled until config is available.");
  }
} catch (error) {
  console.error("[Firebase Error] Initialization failed:", error);
}

// 개별 데이터 Firestore 실시간 자동 백업 도구
async function safeBackupToFirestore(collectionName: string, docId: string, data: any) {
  if (!dbFirebase) return;
  try {
    const cleanData = JSON.parse(JSON.stringify(data));
    cleanData._updatedAt = new Date().toISOString();
    await setDoc(doc(dbFirebase, collectionName, docId), cleanData);
    console.log(`[Firestore Live Backup] Saved: ${collectionName}/${docId}`);
  } catch (err) {
    console.error(`[Firestore Backup Fall] Failed to save ${collectionName}/${docId}:`, err);
  }
}


// ----------------------------------------------------
// 로컬 파일 기반 DB 시뮬레이션 설정
// ----------------------------------------------------
const DB_PATH = path.join(process.cwd(), "db_simulation.json");

interface LocalDB {
  settings: any[];
  master: any[];
  expenses: any[];
  staff: any[];
  staff_roster: any[];
  logs: any[];
}

const getTodayDateString = () => {
  const local = new Date();
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function initLocalDB(): LocalDB {
  const hashOf = (pin: string) => {
    return crypto.createHash("sha256").update(pin.trim()).digest("hex");
  };

  const initialBranches = [
    ["대물섬 한남점", "1234", "branch", "TRUE", "대물섬"],
    ["카라멘야 신촌점", "2345", "branch", "TRUE", "카라멘야"],
    ["남산광어", "3456", "branch", "TRUE", "남산광어"],
    ["사카바단단", "4567", "branch", "TRUE", "사카바단단"],
    ["카츠스위스", "5678", "branch", "TRUE", "카츠스위스"],
    ["금샤빠", "6789", "branch", "TRUE", "금샤빠"],
    ["대학로고래", "7890", "branch", "TRUE", "대학로고래"],
    ["마음죽", "8901", "branch", "TRUE", "마음죽"],
    ["연하동", "9012", "branch", "TRUE", "연하동"],
    ["헴프리스", "0123", "branch", "TRUE", "헴프리스"],
    ["8번대물집", "1357", "branch", "TRUE", "대물섬"],
    ["강남대골뼈국", "2468", "branch", "TRUE", "강남대골뼈국"],
    ["대물섬 강남점", "3579", "branch", "TRUE", "대물섬"],
    ["관리자", "admin0000", "admin", "TRUE", "본사"]
  ];

  const settings = initialBranches.map(b => ({
    branch_name: b[0],
    pin_hash: hashOf(b[1]),
    role: b[2],
    is_active: b[3] === "TRUE",
    brand: b[4]
  }));

  // 미리보기 화면 채우기를 위해 2개 지점의 당일 모의 마감 데이터 미리 삽입
  const todayStr = getTodayDateString();
  const mockRecordId1 = "mock-uuid-hannam-001";
  const mockRecordId2 = "mock-uuid-sinchon-002";

  const master = [
    {
      record_id: mockRecordId1,
      branch_name: "대물섬 한남점",
      settle_date: todayStr,
      cash_sales: 350000,
      card_sales: 1200000,
      transfer_sales: 150000,
      delivery_sales: 450000,
      total_sales: 2150000,
      memo: "저녁 피크타임 주류 매출 증가 및 단체 예약 손님으로 특수 매출 상승.\n\n[근무 일지 요약]\n- 김철수 (정직원): 출근 09:00, 퇴근 18:00 [기준 9h, 근무 9h, 초과 0h]\n- 이영희 (정직원): 출근 09:00, 퇴근 21:00 [기준 9h, 근무 12h, 초과 +3h] (사유: 저녁 피크타임 단체 예약 대응)\n- 최정우 (파트타이머): 출근 18:00, 퇴근 22:00 [기준 0h, 근무 4h, 초과 +4h] (사유: 마감 정리 지연)\n---\nMETADATA:\n" + JSON.stringify({
        staffRows: [
          { division: "정직원", name: "김철수", standardHours: 9, clockIn: "09:00", clockOut: "18:00", workHours: 9, overtime: 0, overtimeReason: "" },
          { division: "정직원", name: "이영희", standardHours: 9, clockIn: "09:00", clockOut: "21:00", workHours: 12, overtime: 3, overtimeReason: "저녁 피크타임 단체 예약 대응" },
          { division: "파트타이머", name: "최정우", standardHours: 0, clockIn: "18:00", clockOut: "22:00", workHours: 4, overtime: 4, overtimeReason: "마감 정리 지연" }
        ],
        cashExpenses: [
          { classification: "소모품등 기타", usage: "그외기타", detail: "퀵서비스 비품(물티슈 급)", amount: "15000" }
        ],
        cardExpenses: [
          { classification: "부식비", usage: "그외기타", detail: "야간 택시비 (홍길동)", amount: "12000" }
        ]
      }),
      submitted_at: new Date().toISOString(),
      submitted_by: "홍길동 점장",
      modified_at: "",
      modified_by: ""
    },
    {
      record_id: mockRecordId2,
      branch_name: "카라멘야 신촌점",
      settle_date: todayStr,
      cash_sales: 120000,
      card_sales: 980000,
      transfer_sales: 0,
      delivery_sales: 320000,
      total_sales: 1420000,
      memo: "우천 영업 여파로 방문 고객 소폭 감소, 배달 비중 상승함.\n\n[근무 일지 요약]\n- 박민수 (파트타이머): 출근 10:00, 퇴근 17:30 [기준 0h, 근무 7.5h, 초과 +7.5h] (사유: 오픈 지원)\n---\nMETADATA:\n" + JSON.stringify({
        staffRows: [
          { division: "파트타이머", name: "박민수", standardHours: 0, clockIn: "10:00", clockOut: "17:30", workHours: 7.5, overtime: 7.5, overtimeReason: "오픈 지원" }
        ],
        cashExpenses: [
          { classification: "식재료", usage: "인근매장", detail: "음료 대포장 얼음비", amount: "8000" }
        ],
        cardExpenses: []
      }),
      submitted_at: new Date().toISOString(),
      submitted_by: "백종원 매니저",
      modified_at: "",
      modified_by: ""
    }
  ];

  const expenses = [
    { record_id: mockRecordId1, expense_type: "현금지출", item_name: "퀵서비스 비품(물티슈 급)", amount: 15000 },
    { record_id: mockRecordId1, expense_type: "카드지출", item_name: "야간 택시비 (홍길동)", amount: 12000 },
    { record_id: mockRecordId2, expense_type: "현금지출", item_name: "음료 대포장 얼음비", amount: 8000 }
  ];

  const staff = [
    { record_id: mockRecordId1, staff_name: "김철수", work_hours: 9 },
    { record_id: mockRecordId1, staff_name: "이영희", work_hours: 8 },
    { record_id: mockRecordId2, staff_name: "박민수", work_hours: 7.5 }
  ];

  const logs: any[] = [];

  const db = { settings, master, expenses, staff, staff_roster: [], logs };
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  return db;
}

function readDB(): LocalDB {
  if (!fs.existsSync(DB_PATH)) {
    return initLocalDB();
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as LocalDB;
    if (!Array.isArray(db.staff_roster)) db.staff_roster = [];
    return db;
  } catch (e) {
    return initLocalDB();
  }
}

function writeDB(db: LocalDB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// ----------------------------------------------------
// 카카오T 비즈니스(법인택시) API 프록시 — 로컬 개발용
// 운영은 gas/Code.gs 의 동일 액션이 처리한다(시크릿은 GAS 스크립트 속성).
// 로컬은 .env 의 KAKAO_T_CORP_ID / KAKAO_T_SECRET 를 쓴다. 양쪽 로직을 같이 고칠 것.
// ----------------------------------------------------
const KAKAO_TAXI_BASE = "https://b2b-api.kakaomobility.com";

// PIN 해시 → 지점_설정 행 조회. verifyPin 액션과 카카오 관리자 게이트가 같은 규칙을 쓰도록
// 한 곳에 모았다(admin 해시 2종 호환 포함 — 복원 데이터가 구 해시를 들고 있어도 로그인과 어긋나지 않게).
function findLocalSettingByPinHash(db: LocalDB, pinHash: unknown) {
  const cleanPinHash = String(pinHash || "").trim().toLowerCase();
  if (!cleanPinHash) return undefined;
  return db.settings.find(s => {
    if (!s.is_active) return false;
    if (s.pin_hash === cleanPinHash) return true;
    // admin 호환성
    if (s.role === "admin") {
      const isDbAdminHash = (s.pin_hash === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || s.pin_hash === "53d6316bd7b9044e6bb5deaa87fe8316c2fde3938b78f8448875b08e551ccc95");
      const isInputAdminHash = (cleanPinHash === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || cleanPinHash === "53d6316bd7b9044e6bb5deaa87fe8316c2fde3938b78f8448875b08e551ccc95");
      if (isDbAdminHash && isInputAdminHash) return true;
    }
    return false;
  });
}

// 관리자 PIN 검증 게이트 — gas/Code.gs requireKakaoTaxiAdmin 과 같은 규칙.
// 실패 유형과 무관하게 같은 문구로 답해 PIN 존재 여부를 밖에서 구분할 수 없게 한다.
// [주의] 로컬 로그인은 Firebase(운영 지점목록)를 탈 수 있어, db_simulation.json 의 관리자
// pin_hash 가 운영 관리자 PIN 의 해시와 같아야 로컬에서 이 게이트를 통과한다.
function requireKakaoTaxiAdmin(db: LocalDB, adminPinHash: unknown) {
  const denied = new Error("법인택시 메뉴는 관리자만 사용할 수 있습니다. 다시 로그인해주세요.");
  const setting = findLocalSettingByPinHash(db, adminPinHash);
  if (!setting || setting.role !== "admin") throw denied;
}

// 쓰기 액션 전용 — 계정을 반드시 명시받는다. 기본값을 두면 엉뚱한 계정에 삭제·수정이 나간다.
// gas/Code.gs requireKakaoAccountKey 와 동일 로직.
function requireKakaoAccountKey(accountKey: unknown): string {
  const key = String(accountKey || "").trim();
  if (!key) throw new Error("대상 카카오T 계정이 지정되지 않았습니다. 화면을 새로고침한 뒤 다시 시도해주세요.");
  kakaoTaxiCredentials(key); // 등록된 계정인지 확인 — 아니면 던진다
  return key;
}

// 카카오T 액션 목록 — 이 액션들은 GAS 웹앱과 같은 규약으로 응답한다(오류도 HTTP 200 + success:false).
// 500으로 주면 클라이언트 callApi 가 본문을 읽지 않아 사용자에게 "HTTP Error 500"만 보인다.
const KAKAO_TAXI_ACTIONS = new Set([
  "getKakaoTaxiOrders", "getKakaoTaxiGroups", "getKakaoTaxiMembers",
  "registerKakaoTaxiMember", "updateKakaoTaxiMember", "blockKakaoTaxiMember", "unblockKakaoTaxiMember",
  "deleteKakaoTaxiMember", "sendKakaoTaxiMemberTms",
]);

async function runKakaoTaxiAction(action: string, body: any): Promise<any> {
  switch (action) {
    case "getKakaoTaxiOrders":
      return kakaoTaxiOrders(String(body.month || ""));
    case "getKakaoTaxiGroups":
      return kakaoTaxiGroups();
    case "getKakaoTaxiMembers":
      return kakaoTaxiMembers();
    case "registerKakaoTaxiMember":
      return kakaoTaxiRegisterMember(requireKakaoAccountKey(body.accountKey), body.member);
    case "updateKakaoTaxiMember":
      return kakaoTaxiUpdateMember(requireKakaoAccountKey(body.accountKey), String(body.memberId || ""), body.member);
    case "blockKakaoTaxiMember":
      return kakaoTaxiSetBlocked(requireKakaoAccountKey(body.accountKey), body.memberIds, true);
    case "unblockKakaoTaxiMember":
      return kakaoTaxiSetBlocked(requireKakaoAccountKey(body.accountKey), body.memberIds, false);
    case "deleteKakaoTaxiMember": {
      const accountKey = requireKakaoAccountKey(body.accountKey);
      const memberId = String(body.memberId || "");
      if (!memberId) throw new Error("삭제할 직원이 지정되지 않았습니다.");
      await kakaoTaxiFetch(accountKey, "DELETE", "/external/v1/members/" + encodeURIComponent(memberId));
      return { success: true };
    }
    case "sendKakaoTaxiMemberTms": {
      const accountKey = requireKakaoAccountKey(body.accountKey);
      const memberId = String(body.memberId || "");
      if (!memberId) throw new Error("알림톡을 보낼 직원이 지정되지 않았습니다.");
      await kakaoTaxiFetch(accountKey, "POST", "/external/v1/members/" + encodeURIComponent(memberId) + "/send_tms");
      return { success: true };
    }
    default:
      throw new Error("알 수 없는 카카오T 액션: " + action);
  }
}

// [동기화] gas/Code.gs 의 KAKAO_TAXI_ACCOUNTS 와 같게 유지할 것.
// 계정 #1 은 기존 환경변수 이름을 그대로 쓴다 — .env 재작성 없이 기존 동작이 유지된다.
const KAKAO_TAXI_ACCOUNTS = [
  { key: "acct1", label: "1계정", corpIdEnv: "KAKAO_T_CORP_ID", secretEnv: "KAKAO_T_SECRET" },
  { key: "acct2", label: "2계정", corpIdEnv: "KAKAO_T_CORP_ID_2", secretEnv: "KAKAO_T_SECRET_2" },
] as const;

interface KakaoAccount { key: string; label: string; corpId: string; secret: string }

function kakaoTaxiAccounts(): KakaoAccount[] {
  const out: KakaoAccount[] = [];
  for (const acc of KAKAO_TAXI_ACCOUNTS) {
    const corpId = process.env[acc.corpIdEnv];
    const secret = process.env[acc.secretEnv];
    if (corpId && secret) out.push({ key: acc.key, label: acc.label, corpId, secret });
  }
  if (!out.length) {
    throw new Error("카카오T 연동 정보가 없습니다. .env 에 KAKAO_T_CORP_ID / KAKAO_T_SECRET 를 등록해주세요.");
  }
  return out;
}

function kakaoTaxiCredentials(accountKey: string): KakaoAccount {
  const found = kakaoTaxiAccounts().find((a) => a.key === accountKey);
  if (!found) throw new Error(`등록되지 않은 카카오T 계정입니다: ${accountKey}`);
  return found;
}

// 등록된 계정을 순회해 합치고, 실패한 계정은 accountErrors 로 알린다. 전부 실패면 던진다.
// gas/Code.gs 의 kakaoTaxiCollect 와 같은 규칙.
async function kakaoTaxiCollect<T extends Record<string, unknown>>(
  collect: (acc: KakaoAccount) => Promise<T[]>
): Promise<{ items: T[]; accountErrors: Array<{ key: string; label: string; message: string }> }> {
  const accounts = kakaoTaxiAccounts();
  const items: T[] = [];
  const accountErrors: Array<{ key: string; label: string; message: string }> = [];
  for (const acc of accounts) {
    try {
      const got = await collect(acc);
      for (const row of got) {
        (row as Record<string, unknown>).account_key = acc.key;
        items.push(row);
      }
    } catch (e) {
      accountErrors.push({ key: acc.key, label: acc.label, message: String((e as Error)?.message || e) });
    }
  }
  if (accountErrors.length === accounts.length) {
    throw new Error(`카카오T 조회에 실패했습니다: ${accountErrors[0].message}`);
  }
  return { items, accountErrors };
}

async function kakaoTaxiFetch(accountKey: string, method: string, apiPath: string, query?: string | null, body?: unknown): Promise<any> {
  const { corpId, secret } = kakaoTaxiCredentials(accountKey);
  // [주의] 서명 URL에는 쿼리 파라미터를 넣지 않는다.
  // 넣으면 카카오가 90003("인증 토큰이 유효하지 않습니다")을 돌려준다 — 2026-07-24 실계정에서 확인.
  const signUrl = KAKAO_TAXI_BASE + apiPath;
  const nonce = String(Math.floor(Math.random() * 100000));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = `${nonce}\n${signUrl}\n${method}\n${corpId}\n${timestamp}\n${nonce}`;
  const token = crypto.createHmac("sha1", secret).update(message, "utf8").digest("base64");
  const headers: Record<string, string> = {
    "Authorization": "Token " + token,
    "x-mob-b2b-corp-id": corpId,
    "x-mob-b2b-nonce": nonce,
    "x-mob-b2b-timestamp": timestamp
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(KAKAO_TAXI_BASE + apiPath + (query ? "?" + query : ""), init);
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error) detail = parsed.error;
    } catch { /* 본문이 JSON이 아니면 원문 그대로 */ }
    throw new Error(`카카오T API 오류(${response.status}): ${detail}`);
  }
  if (!text) return null; // send_tms 등 본문 없는 성공 응답
  try { return JSON.parse(text); } catch { return null; }
}

function kakaoTaxiMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("조회 월 형식이 올바르지 않습니다(YYYY-MM): " + month);
  }
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

// [성능] 카카오 목록 API(100건/페이지) 병렬 수집 — gas/Code.gs kakaoTaxiFetchAllPages 와 동일 로직.
// 1페이지로 총 건수를 알아낸 뒤 나머지 페이지를 한꺼번에 받는다. 50페이지(5,000건) 상한.
async function kakaoTaxiFetchAllPages(accountKey: string, apiPath: string, baseQuery: string, listKey: string) {
  const pageQuery = (page: number) => (baseQuery ? baseQuery + "&" : "") + `per=100&page=${page}`;
  const first = await kakaoTaxiFetch(accountKey, "GET", apiPath, pageQuery(1));
  const firstBatch: any[] = first?.[listKey] || [];
  const reportedCount = typeof first?.count === "number" ? first.count : firstBatch.length;
  const items = [...firstBatch];
  const totalPages = Math.min(50, Math.ceil(reportedCount / 100));
  if (firstBatch.length >= 100 && totalPages > 1) {
    // 한 페이지라도 실패하면 전체 실패 — 일부 누락본을 정상 자료처럼 돌려주지 않는다.
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => kakaoTaxiFetch(accountKey, "GET", apiPath, pageQuery(i + 2)))
    );
    for (const res of rest) items.push(...((res?.[listKey] as any[]) || []));
  }
  return { count: reportedCount, items };
}

// 이용내역 — 로컬은 캐시 없이 매번 실시간 조회한다(GAS 의 ScriptCache 최적화는 운영 전용).
// gas/Code.gs getKakaoTaxiOrders 와 같은 반환 형태(account_key 는 kakaoTaxiCollect 가 채운다).
async function kakaoTaxiOrders(month: string) {
  const range = kakaoTaxiMonthRange(month);
  const collected = await kakaoTaxiCollect(async (acc) =>
    (await kakaoTaxiFetchAllPages(acc.key, "/external/v2/orders",
      `start_date=${range.start}&end_date=${range.end}`, "orders")).items
  );
  return { month, count: collected.items.length, orders: collected.items, accountErrors: collected.accountErrors };
}

// 그룹 목록 — 로컬은 캐시 없이 매번 실시간 조회한다. gas/Code.gs getKakaoTaxiGroups 와 같은 반환 형태.
async function kakaoTaxiGroups() {
  const collected = await kakaoTaxiCollect(async (acc) =>
    (await kakaoTaxiFetch(acc.key, "GET", "/external/v1/groups", null, null)) || []
  );
  return { groups: collected.items, accountErrors: collected.accountErrors };
}

// 쓰기 경로 전용 — 특정 계정의 그룹만 실시간으로 받는다(캐시 미사용).
// 방금 만든/바꾼 그룹을 못 찾아 오등록되는 것을 막기 위해 조회용 캐시를 쓰지 않는다.
// gas/Code.gs kakaoTaxiAccountGroups 와 동일 로직.
async function kakaoTaxiAccountGroups(accountKey: string) {
  const groups: any[] = (await kakaoTaxiFetch(accountKey, "GET", "/external/v1/groups", null, null)) || [];
  for (const g of groups) g.account_key = accountKey;
  return groups;
}

async function kakaoTaxiMembers() {
  const collected = await kakaoTaxiCollect(async (acc) =>
    (await kakaoTaxiFetchAllPages(acc.key, "/external/v2/members/connected", "", "members")).items
  );
  return { count: collected.items.length, members: collected.items, accountErrors: collected.accountErrors };
}

// 카카오 부서 표기 → ERP 지점명 별칭표.
// [동기화] src/pages/admin/helpers/kakaoTaxi.ts 의 KAKAO_BRANCH_ALIASES, gas/Code.gs 와 세 곳을 같게 유지할 것.
const KAKAO_TAXI_BRANCH_ALIASES: Record<string, string> = {
  "금샤빠 을지로": "금샤빠",
  "대물섬 한남동": "대물섬 한남점",
  "대골뼈국": "강남대골뼈국",
  "대물섬종로점": "대물섬 종로점",
};

// 지점 → 카카오T 계정. 미기재 지점은 계정 #1(기본값).
// [동기화] gas/Code.gs, src/pages/admin/helpers/kakaoTaxi.ts 와 세 곳을 같게 유지할 것.
const KAKAO_ACCOUNT_BY_BRANCH: Record<string, string> = {
  "사카바단단": "acct2",
  "8번대물집": "acct2",
};

function kakaoTaxiAccountForBranch(branchName: string): string {
  return KAKAO_ACCOUNT_BY_BRANCH[String(branchName || "").trim()] || "acct1";
}

// 지점 화면용 — 타 지점 직원 정보가 새지 않도록 필터는 반드시 백엔드에서. gas/Code.gs 동일 로직.
async function kakaoTaxiBranchMembers(db: LocalDB, pinHash: unknown, branchName: string) {
  const denied = new Error("지점 인증에 실패했습니다. 다시 로그인해주세요.");
  if (!pinHash || !branchName) throw denied;
  const setting = findLocalSettingByPinHash(db, pinHash);
  if (!setting) throw denied;
  // 지점 PIN 은 자기 지점만, 관리자 PIN 은 어느 지점이든(관리자가 지점 화면을 볼 때)
  if (setting.role !== "admin" && setting.branch_name !== branchName) throw denied;
  const all = (await kakaoTaxiMembers()).members || [];
  return all.filter((m: any) => {
    const dept = String(m?.department || "").trim();
    if (!dept) return false;
    return dept === branchName || KAKAO_TAXI_BRANCH_ALIASES[dept] === branchName;
  });
}

// 검증은 정규화(숫자만 남긴 전화·공백 제거한 그룹id) 이후 값으로 한다 — raw 값만 보면
// "---" 같은 전화나 [""] 그룹이 통과해 카카오까지 갔다가 애매한 오류로 돌아온다. gas/Code.gs 와 동일 기준.
function kakaoTaxiNormalizeContact(member: any) {
  const m = member || {};
  return {
    phone: String(m.mobile_phone || "").replace(/[^0-9]/g, ""),
    groupIds: (Array.isArray(m.group_ids) ? m.group_ids : [])
      .map((id: unknown) => String(id || "").trim())
      .filter(Boolean)
  };
}

async function kakaoTaxiRegisterMember(accountKey: string, member: any) {
  const m = member || {};
  const norm = kakaoTaxiNormalizeContact(m);
  if (!m.identifier || !norm.phone || !norm.groupIds.length) {
    throw new Error("직원 등록에는 사번(identifier)·휴대전화번호·그룹이 모두 필요합니다.");
  }
  const body: any = {
    identifier: String(m.identifier),
    mobile_phone: norm.phone,
    group_ids: norm.groupIds
  };
  if (m.name) body.name = String(m.name);
  if (m.department) body.department = String(m.department);
  return kakaoTaxiFetch(accountKey, "POST", "/external/v1/members", null, body);
}

// [P1] 지점별 자동등록 쿨다운(반복 알림톡 방지). 프로세스 메모리 — 로컬 dev 재시작 시 리셋된다.
const kakaoRegCooldown = new Map<string, number>();

interface KakaoGroupResolution { accountKey: string; groupId: string | null }

// 지점명 → { 계정, 활성(enabled) 그룹 id }. 지점 자동등록은 지점이 그룹을 직접 고르지 않으므로
// 백엔드가 정한다. 못 찾으면 groupId 가 null → 호출부가 거부(오등록 방지).
// [주의] 계정 #1 에도 사카바단단·8번대물집 이름의 껍데기 그룹이 있으므로 반드시 매핑표가 정한
// 계정 안에서만 찾는다. 계정 전체를 뒤지면 엉뚱한 계정에 등록된다.
// gas/Code.gs kakaoTaxiGroupIdForBranch 와 동일 로직으로 유지할 것.
async function kakaoTaxiGroupIdForBranch(branchName: string): Promise<KakaoGroupResolution> {
  const target = String(branchName || "").trim();
  const accountKey = kakaoTaxiAccountForBranch(target);
  if (!target) return { accountKey, groupId: null };
  // [쓰기 경로] 이 그룹 id 로 실제 카카오 등록이 실행된다 — 항상 실시간 조회한다(캐시 미사용).
  const groups = await kakaoTaxiAccountGroups(accountKey);
  let fallback: string | null = null;
  for (const g of groups) {
    if (String(g.status) !== "enabled") continue;
    const gn = String(g.name || "").trim();
    if (gn === target || KAKAO_TAXI_BRANCH_ALIASES[gn] === target) return { accountKey, groupId: g.id };
    fallback = fallback === null ? g.id : fallback;
  }
  // 계정 #2 처럼 지점명 그룹이 없고 활성 그룹이 '기본그룹' 하나뿐이면 그 그룹에 넣는다.
  // 지점 판정은 부서(department=지점명) 우선이라 집계는 정상 동작한다.
  const enabledCount = groups.filter((g: any) => String(g.status) === "enabled").length;
  if (enabledCount === 1 && fallback) return { accountKey, groupId: fallback };
  return { accountKey, groupId: null };
}

// 지점 자동 등록 — 지점 PIN 게이트로 관리자 승인 없이 카카오 등록 + 인증 알림톡 발송.
// 안전장치: 지점 PIN(자기 지점만)·이름/전화 형식·지점↔그룹 자동매핑(못 찾으면 거부)·중복 전화 차단.
// gas/Code.gs submitBranchKakaoRegister 와 동일 로직으로 유지할 것.
async function kakaoTaxiSubmitBranchRegister(db: LocalDB, pinHash: unknown, branchName: string, name: string, phone: string) {
  const denied = new Error("지점 인증에 실패했습니다. 다시 로그인해주세요.");
  if (!pinHash || !branchName) throw denied;
  const setting = findLocalSettingByPinHash(db, pinHash);
  if (!setting) throw denied;
  if (setting.role !== "admin" && setting.branch_name !== branchName) throw denied;

  const cleanName = String(name || "").trim();
  const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
  if (!cleanName) throw new Error("이름을 입력해주세요.");
  if (!/^01[0-9]{8,9}$/.test(cleanPhone)) throw new Error("휴대전화번호를 확인해주세요. (예: 01012345678)");

  const resolved = await kakaoTaxiGroupIdForBranch(branchName);
  const groupId = resolved.groupId;
  const accountKey = resolved.accountKey;
  if (!groupId) throw new Error("이 지점에 해당하는 카카오T 그룹을 찾지 못했습니다. 관리자에게 문의해주세요.");

  // 중복 방지 — 어느 소속(지점)에 이미 있는지 알려주고 거부(전입 직원이 이전 지점으로 등록된 상황 파악).
  // 등록된 전 계정을 대상으로 확인한다(kakaoTaxiMembers/kakaoTaxiGroups 는 캐시 없이 항상 실시간).
  const existing = (await kakaoTaxiMembers()).members || [];
  const allGroups = (await kakaoTaxiGroups()).groups || [];
  for (const m of existing) {
    if (String(m.mobile_phone || "").replace(/[^0-9]/g, "") === cleanPhone) {
      let where = String(m.department || "").trim();
      if (!where && Array.isArray(m.group_ids) && m.group_ids.length) {
        // 그룹 id 대조에 account_key 를 함께 본다 — 계정이 다르면 같은 그룹 id 가 존재할 수 있다.
        const g = allGroups.find((x: any) => x.id === m.group_ids[0] && x.account_key === m.account_key);
        if (g) where = String(g.name || "");
      }
      if (!where) where = "다른 지점";
      throw new Error(`${m.name || cleanName} 님(${cleanPhone})은 이미 '${where}'에 등록돼 있습니다. 같은 번호는 중복 등록할 수 없습니다. 전입한 직원이라면 관리자에게 소속(그룹) 변경을 요청해주세요.`);
    }
  }

  // [P1] 반복 등록 방지 — 같은 지점이 20초 내 연속 등록을 막아 알림톡 남발을 차단.
  const nowTs = Date.now();
  if (nowTs - (kakaoRegCooldown.get(branchName) || 0) < 20000) {
    throw new Error("방금 등록 요청이 처리되었습니다. 잠시(약 20초) 후 다음 직원을 등록해주세요.");
  }

  // register 는 카카오가 이미 존재하는 번호(인증 대기 등 connected 목록에 안 보이는 경우)를 400 으로 막는다 — 친절히 안내.
  let member: any;
  try {
    member = await kakaoTaxiRegisterMember(accountKey, {
      identifier: cleanName, mobile_phone: cleanPhone, group_ids: [groupId], name: cleanName, department: branchName
    });
  } catch (e: any) {
    const em = String(e?.message || e);
    if (em.includes("이미 존재") || em.includes("(400)")) {
      throw new Error(`이 전화번호(${cleanPhone})는 이미 카카오T에 등록돼 있습니다(인증 대기 중이거나 다른 소속일 수 있음). 관리자에게 확인을 요청해주세요.`);
    }
    throw e;
  }
  kakaoRegCooldown.set(branchName, Date.now()); // 등록 성공 → 쿨다운 설정
  // 알림톡 발송은 일시 실패가 잦아 짧게 3회까지 재시도한다(복구). 그래도 실패하면 직원이
  // 카카오T 앱 > 비즈니스에서 회사 초대를 직접 확인해 인증할 수 있으므로 등록 자체는 유효하다.
  let tmsSent = false;
  if (member?.id) {
    for (let t = 0; t < 3 && !tmsSent; t++) {
      try {
        await kakaoTaxiFetch(accountKey, "POST", "/external/v1/members/" + encodeURIComponent(member.id) + "/send_tms");
        tmsSent = true;
      } catch { if (t < 2) await new Promise((r) => setTimeout(r, 700)); }
    }
  }
  return { member, tmsSent };
}

async function kakaoTaxiUpdateMember(accountKey: string, memberId: string, member: any) {
  if (!memberId) throw new Error("수정할 직원이 지정되지 않았습니다.");
  const m = member || {};
  const norm = kakaoTaxiNormalizeContact(m);
  if (!norm.phone || !norm.groupIds.length) {
    throw new Error("직원 수정에는 휴대전화번호와 그룹이 모두 필요합니다.");
  }
  // [함정] 카카오 수정 API 는 name/department 를 보내지 않으면(null) 공백으로 지워버린다 — 4개 필드를 항상 모두 보낸다.
  // 전화번호가 실제로 바뀐 경우 카카오가 새 번호로 인증 알림톡을 자동 발송한다(문서 명시). gas/Code.gs 와 동일 로직.
  const body = {
    mobile_phone: norm.phone,
    group_ids: norm.groupIds,
    name: m.name ? String(m.name) : "",
    department: m.department ? String(m.department) : ""
  };
  return kakaoTaxiFetch(accountKey, "PUT", "/external/v1/members/" + encodeURIComponent(memberId), null, body);
}

async function kakaoTaxiSetBlocked(accountKey: string, memberIds: unknown, blocked: boolean) {
  const ids = (Array.isArray(memberIds) ? memberIds : []).filter(Boolean).map(String);
  if (!ids.length) throw new Error("휴직 처리할 직원이 지정되지 않았습니다.");
  const apiPath = blocked ? "/external/v1/members/block" : "/external/v1/members/unblock";
  const results: any[] = (await kakaoTaxiFetch(accountKey, "POST", apiPath, null, { members: ids.join(",") })) || [];
  const failed = results.filter((r) => r && r.status_code !== 0);
  if (failed.length) {
    throw new Error("일부 직원 처리 실패: " + failed.map((r) => `${r.id}(${r.status_msg || "실패"})`).join(", "));
  }
  return results;
}

// ----------------------------------------------------
// API 라우터 구현 (GAS Proxy 및 로컬 DB 대체)
// ----------------------------------------------------
app.post("/api/gas", async (req: Request, res: Response) => {
  const gasUrl = (req.headers["x-custom-gas-url"] as string) || process.env.VITE_GAS_URL || process.env.GAS_URL;
  
  // 구글 앱스 스크립트 웹 앱이 정상 연동된 상태라면, 실제 구글 시트를 사용
  if (gasUrl && gasUrl.trim() !== "" && gasUrl.includes("script.google.com")) {
    try {
      console.log(`GAS Proxying action [${req.body.action}] to: ${gasUrl}`);
      const response = await fetch(gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(req.body)
      });
      
      const resText = await response.text();
      let resJson;
      try {
        resJson = JSON.parse(resText);
      } catch (e) {
        return res.status(500).json({ success: false, error: "GAS Web App이 JSON 형식이 아닌 에러를 반환했습니다. 브라우저 확인 필요\n" + resText });
      }

      // [신공방어 폴백] 사용자의 구글 웹앱 버전이 낮아서 신규 핵심 액션인 getBranchHistory가 정의되어 있지 않은 경우,
      // 오류를 뿜고 마감 차트나 마감 정산 화면이 깨지는 대신 빈 히스토리 배열을 제공하여 안정 가동되게 처리합니다.
      if (resJson && !resJson.success && req.body.action === "getBranchHistory") {
        console.warn("Google Apps Script getBranchHistory not implemented on spreadsheet, utilizing empty fallback array.");
        return res.json({ success: true, data: [] });
      }

      return res.json(resJson);
    } catch (e: any) {
      console.error("GAS Proxy error:", e);
      return res.status(500).json({ success: false, error: "구글 시트 웹 앱 통신 실패: " + e.message });
    }
  }

  // 구글 시트 연동 전: 로컬 시뮬레이션용 데이터 프로세서 가동
  try {
    const { action } = req.body;
    const db = readDB();

    console.log(`Fallback Local Simulation database call for [${action}]`);

    // ---------- 카카오T 비즈니스(법인택시) — 운영은 gas/Code.gs 동일 액션 ----------
    // 지점용 인원 조회 — 지점 PIN(또는 관리자 PIN)으로 자기 지점 매핑 인원만.
    if (action === "getKakaoTaxiBranchMembers") {
      try {
        return res.json({
          success: true,
          data: await kakaoTaxiBranchMembers(db, req.body.pinHash, String(req.body.branchName || "")),
        });
      } catch (error: any) {
        return res.json({ success: false, error: error?.message || String(error) });
      }
    }

    // 지점 자동 등록 — 지점 PIN 게이트(관리자 승인 없이 카카오 등록 + 인증 알림톡).
    if (action === "submitBranchKakaoRegister") {
      try {
        return res.json({
          success: true,
          data: await kakaoTaxiSubmitBranchRegister(db, req.body.pinHash, String(req.body.branchName || ""), String(req.body.name || ""), String(req.body.phone || "")),
        });
      } catch (error: any) {
        return res.json({ success: false, error: error?.message || String(error) });
      }
    }

    // 조회·쓰기 모두 관리자 PIN 검증을 강제한다(직원 삭제·휴직 같은 쓰기가 특히 위험).
    // 오류는 GAS 와 같은 규약(HTTP 200 + success:false)으로 반환해 화면에 메시지가 그대로 보이게 한다.
    if (KAKAO_TAXI_ACTIONS.has(action)) {
      try {
        requireKakaoTaxiAdmin(db, req.body.adminPinHash);
        return res.json({ success: true, data: await runKakaoTaxiAction(action, req.body) });
      } catch (error: any) {
        return res.json({ success: false, error: error?.message || String(error) });
      }
    }

    switch (action) {
      case "verifyPin": {
        const { pinHash } = req.body;
        const found = findLocalSettingByPinHash(db, pinHash);
        if (found) {
          const branches = db.settings
            .filter(s => s.is_active)
            .map(s => ({
              branchName: s.branch_name,
              brand: s.brand,
              role: s.role
            }));
          return res.json({
            success: true,
            data: {
              branchName: found.branch_name,
              role: found.role,
              brand: found.brand,
              branches
            }
          });
        }
        return res.json({ success: false, error: "PIN 번호가 올바르지 않거나 비활성화된 지점입니다." });
      }

      case "getBranchList": {
        const list = db.settings
          .filter(s => s.is_active)
          .map(s => ({
            branchName: s.branch_name,
            brand: s.brand,
            role: s.role
          }));
        return res.json({ success: true, data: list });
      }

      case "getStaffRoster": {
        const { branchName } = req.body;
        const roster = db.staff_roster || [];
        return res.json({ success: true, data: roster.filter((employee: any) => employee.branch_name === branchName) });
      }

      case "saveStaffRoster": {
        const { branchName } = req.body;
        const employees = Array.isArray(req.body.employees) ? req.body.employees : [];
        db.staff_roster = (db.staff_roster || []).filter((employee: any) => employee.branch_name !== branchName);
        db.staff_roster.push(...employees
          .filter((employee: any) => employee && String(employee.name || "").trim())
          .map((employee: any) => ({ ...employee, branch_name: branchName })));
        writeDB(db);
        return res.json({ success: true, data: { success: true, employees } });
      }

      case "getBranchListAll": {
        const list = db.settings.map(s => ({
          branchName: s.branch_name,
          brand: s.brand,
          role: s.role,
          isActive: s.is_active !== false && String(s.is_active).toUpperCase() !== "FALSE"
        }));
        return res.json({ success: true, data: list });
      }

      case "addBranch": {
        const { branchName, pinHash, brand, role } = req.body;
        const exists = db.settings.find(s => String(s.branch_name).trim() === String(branchName).trim());
        if (exists) {
          return res.json({ success: false, error: "이미 존재하는 지점명입니다." });
        }
        const newBranchObj = {
          branch_name: branchName.trim(),
          pin_hash: pinHash.trim(),
          role: role || "branch",
          is_active: true,
          brand: brand.trim()
        };
        db.settings.push(newBranchObj);
        writeDB(db);
        // Firebase Cloud Live Backup
        safeBackupToFirestore("settings", branchName.trim(), newBranchObj);
        return res.json({ success: true });
      }

      case "toggleBranchActive": {
        const { branchName, isActive } = req.body;
        const found = db.settings.find(s => String(s.branch_name).trim() === String(branchName).trim());
        if (!found) {
          return res.json({ success: false, error: "존재하지 않는 지점입니다." });
        }
        found.is_active = isActive;
        writeDB(db);
        // Firebase Cloud Live Backup
        safeBackupToFirestore("settings", branchName.trim(), found);
        return res.json({ success: true });
      }

      case "updateBranchPin": {
        const { branchName, pinHash } = req.body;
        const found = db.settings.find(s => String(s.branch_name).trim() === String(branchName).trim());
        if (!found) {
          return res.json({ success: false, error: "존재하지 않는 지점입니다." });
        }
        found.pin_hash = pinHash.trim();
        writeDB(db);
        // Firebase Cloud Live Backup
        safeBackupToFirestore("settings", branchName.trim(), found);
        return res.json({ success: true });
      }

      case "deleteBranch": {
        const { branchName } = req.body;
        const oLength = db.settings.length;
        db.settings = db.settings.filter(s => String(s.branch_name).trim() !== String(branchName).trim());
        if (db.settings.length === oLength) {
          return res.json({ success: false, error: "존재하지 않는 지점입니다." });
        }
        writeDB(db);
        // Firebase Delete Sync
        if (dbFirebase) {
          deleteDoc(doc(dbFirebase, "settings", branchName.trim())).catch(e => console.error(e));
        }
        return res.json({ success: true });
      }


      case "checkDuplicate": {
        const { branchName, settleDate } = req.body;
        const record = db.master.find(m => m.branch_name === branchName && m.settle_date === settleDate);
        if (record) {
          return res.json({
            success: true,
            data: {
              exists: true,
              recordId: record.record_id,
              record: {
                recordId: record.record_id,
                branchName: record.branch_name,
                settleDate: record.settle_date,
                cashSales: record.cash_sales,
                cardSales: record.card_sales,
                transferSales: record.transfer_sales,
                deliverySales: record.delivery_sales,
                totalSales: record.total_sales,
                memo: record.memo,
                submittedAt: record.submitted_at
              }
            }
          });
        }
        return res.json({ success: true, data: { exists: false, record: null } });
      }

      case "submitDaily": {
        const { master, masterData } = req.body;
        const expenses = Array.isArray(req.body.expenses) ? req.body.expenses : [];
        const staff = Array.isArray(req.body.staff) ? req.body.staff : [];
        const m = master || masterData || {};

        // 중복 체크 및 구글 시크릿 오버라이트 대응
        const bName = m.branchName || m.branch_name || "Unknown Branch";
        const sDate = m.settleDate || m.settle_date || new Date().toISOString().split('T')[0];
        // 이 값이 Firestore daily_settles 의 문서 ID가 된다(아래 safeBackupToFirestore).
        // 무작위 ID로 떨어지면 '지점+날짜로 콕 집어 읽기'가 그 문서를 못 찾아 대시보드가 그 날을
        // '미제출'로 보여준다. 클라이언트가 recordId 를 안 보낸 경우에도 규칙 ID로 맞춘다
        // (firebaseDirect.ts firebaseRecordId 와 같은 형식, Codex 지적 2026-07-28).
        const recordId = m.recordId || m.record_id || `${encodeURIComponent(bName)}--${sDate}`;
        const dupIdx = db.master.findIndex(item => item.branch_name === bName && item.settle_date === sDate);
        
        const totalSales = Number(m.cashSales || m.cash_sales || 0) + 
                           Number(m.cardSales || m.card_sales || 0) + 
                           Number(m.transferSales || m.transfer_sales || 0) + 
                           Number(m.deliverySales || m.delivery_sales || 0);

        const masterEntry = {
          record_id: recordId,
          branch_name: bName,
          settle_date: sDate,
          cash_sales: Number(m.cashSales || m.cash_sales || 0),
          card_sales: Number(m.cardSales || m.card_sales || 0),
          transfer_sales: Number(m.transferSales || m.transfer_sales || 0),
          delivery_sales: Number(m.deliverySales || m.delivery_sales || 0),
          total_sales: totalSales,
          memo: m.memo || "",
          submitted_at: new Date().toISOString(),
          submitted_by: m.submittedBy || m.submitted_by || "branch",
          modified_at: "",
          modified_by: ""
        };

        if (dupIdx !== -1) {
          // 중복 제출 시 덮어쓰기 업데이트
          db.master[dupIdx] = masterEntry;
          
          // 기존 상세 내역 지우기
          db.expenses = db.expenses.filter(e => e.record_id !== recordId);
          db.staff = db.staff.filter(s => s.record_id !== recordId);
        } else {
          db.master.push(masterEntry);
        }

        // 지출 및 인원 상세 삽입
        expenses.forEach((e: any) => {
          db.expenses.push({
            record_id: recordId,
            expense_type: e.expenseType,
            item_name: e.itemName,
            amount: Number(e.amount)
          });
        });

        staff.forEach((s: any) => {
          db.staff.push({
            record_id: recordId,
            staff_name: s.staffName,
            work_hours: Number(s.workHours)
          });
        });

        writeDB(db);

        // Firebase Cloud Live Backup (master, expenses, staff 묶어서 보관)
        const liveBackup = {
          recordId,
          master: db.master.find(m => m.record_id === recordId),
          expenses: db.expenses.filter(e => e.record_id === recordId),
          staff: db.staff.filter(s => s.record_id === recordId)
        };
        safeBackupToFirestore("daily_settles", recordId, liveBackup);

        return res.json({ success: true, data: { recordId } });
      }

      case "updateDaily": {
        const { recordId, master, masterData, modifiedBy } = req.body;
        const expenses = Array.isArray(req.body.expenses) ? req.body.expenses : undefined;
        const staff = Array.isArray(req.body.staff) ? req.body.staff : undefined;
        const masterIdx = db.master.findIndex(m => m.record_id === recordId);
        if (masterIdx === -1) {
          return res.json({ success: false, error: "정산 레코드를 찾을 수 없습니다." });
        }

        const oldRow = db.master[masterIdx];
        const modifiedAt = new Date().toISOString();

        // 필드 단위 모니터링하여 수정로그 주입
        const fields = ["cash_sales", "card_sales", "transfer_sales", "delivery_sales", "memo"];
        const mapping: Record<string, string[]> = {
          "cash_sales": ["cashSales", "cash_sales"],
          "card_sales": ["cardSales", "card_sales"],
          "transfer_sales": ["transferSales", "transfer_sales"],
          "delivery_sales": ["deliverySales", "delivery_sales"],
          "memo": ["memo"]
        };

        const mData = masterData || master || {};

        fields.forEach(f => {
          const payloadKeys = mapping[f];
          const foundKey = payloadKeys.find(key => mData[key] !== undefined);
          if (foundKey !== undefined) {
            const oldVal = oldRow[f];
            const newVal = mData[foundKey];
            if (String(oldVal) !== String(newVal)) {
              db.logs.push({
                log_id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                record_id: recordId,
                changed_field: f,
                old_value: String(oldVal),
                new_value: String(newVal),
                modified_by: modifiedBy || "admin",
                modified_at: modifiedAt
              });
              oldRow[f] = newVal;
            }
          }
        });

        // 합산 및 상태 업데이트
        oldRow.total_sales = Number(oldRow.cash_sales || 0) + 
                             Number(oldRow.card_sales || 0) + 
                             Number(oldRow.transfer_sales || 0) + 
                             Number(oldRow.delivery_sales || 0);
        oldRow.modified_at = modifiedAt;
        oldRow.modified_by = modifiedBy || "admin";

        // 상세 내용 업데이트
        if (expenses) {
          db.expenses = db.expenses.filter(e => e.record_id !== recordId);
          expenses.forEach((e: any) => {
            db.expenses.push({
              record_id: recordId,
              expense_type: e.expenseType,
              item_name: e.itemName,
              amount: Number(e.amount)
            });
          });
        }

        if (staff) {
          db.staff = db.staff.filter(s => s.record_id !== recordId);
          staff.forEach((s: any) => {
            db.staff.push({
              record_id: recordId,
              staff_name: s.staffName,
              work_hours: Number(s.workHours)
            });
          });
        }

        writeDB(db);

        // Firebase Cloud Live Backup (수정본 묶어서 동시 업데이트)
        const updatedBackup = {
          recordId,
          master: db.master.find(m => m.record_id === recordId),
          expenses: db.expenses.filter(e => e.record_id === recordId),
          staff: db.staff.filter(s => s.record_id === recordId)
        };
        safeBackupToFirestore("daily_settles", recordId, updatedBackup);

        return res.json({ success: true, data: { success: true } });
      }

      case "getDailyList": {
        const { settleDate } = req.body;
        // 특정 날짜 마스터 딕셔너리 구성
        const dailyMasters: Record<string, any> = {};
        db.master.forEach(m => {
          if (m.settle_date === settleDate) {
            dailyMasters[m.branch_name] = {
              recordId: m.record_id,
              branchName: m.branch_name,
              settleDate: m.settle_date,
              cashSales: m.cash_sales,
              cardSales: m.card_sales,
              transferSales: m.transfer_sales,
              deliverySales: m.delivery_sales,
              totalSales: m.total_sales,
              memo: m.memo,
              submittedAt: m.submitted_at,
              submittedBy: m.submitted_by,
              modifiedAt: m.modified_at,
              modifiedBy: m.modified_by
            };
          }
        });

        // 지점 목록 매칭
        const list = db.settings
          .filter(s => s.role === "branch")
          .map(s => {
            const m = dailyMasters[s.branch_name];
            return {
              branchName: s.branch_name,
              brand: s.brand,
              role: s.role,
              submitted: !!m,
              record: m || null
            };
          });

        return res.json({ success: true, data: list });
      }

      case "getDailyDetail": {
        const { recordId } = req.body;
        const m = db.master.find(m => m.record_id === recordId);
        if (!m) {
          return res.json({ success: false, error: "상세 자료를 찾을 수 없습니다." });
        }

        const masterData = {
          recordId: m.record_id,
          branchName: m.branch_name,
          settleDate: m.settle_date,
          cashSales: m.cash_sales,
          cardSales: m.card_sales,
          transferSales: m.transfer_sales,
          deliverySales: m.delivery_sales,
          totalSales: m.total_sales,
          memo: m.memo,
          submittedAt: m.submitted_at,
          submittedBy: m.submitted_by,
          modifiedAt: m.modified_at,
          modifiedBy: m.modified_by
        };

        const listExpenses = db.expenses
          .filter(e => e.record_id === recordId)
          .map(e => ({
            expenseType: e.expense_type,
            itemName: e.item_name,
            amount: e.amount
          }));

        const listStaff = db.staff
          .filter(s => s.record_id === recordId)
          .map(s => ({
            staffName: s.staff_name,
            workHours: s.work_hours
          }));

        return res.json({
          success: true,
          data: {
            master: masterData,
            expenses: listExpenses,
            staff: listStaff
          }
        });
      }

      case "getBranchHistory": {
        const { branchName } = req.body;
        const history = db.master
          .filter(m => m.branch_name === branchName)
          .map(m => ({
            recordId: m.record_id,
            branchName: m.branch_name,
            settleDate: m.settle_date,
            cashSales: m.cash_sales,
            cardSales: m.card_sales,
            transferSales: m.transfer_sales,
            deliverySales: m.delivery_sales,
            totalSales: m.total_sales,
            memo: m.memo,
            submittedAt: m.submitted_at,
            submittedBy: m.submitted_by,
            modifiedAt: m.modified_at,
            modifiedBy: m.modified_by
          }));
        history.sort((a, b) => b.settleDate.localeCompare(a.settleDate));
        return res.json({ success: true, data: history });
      }

      default:
        return res.status(400).json({ success: false, error: "알 수 없는 액션 요청: " + action });
    }
  } catch (error: any) {
    console.error("Local Simulation logic error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 파이어베이스(Firebase) - 전용 보조 모니터링 및 복구 API
// ----------------------------------------------------
app.get("/api/firebase/status", async (req: Request, res: Response) => {
  if (!isFirebaseConnected) {
    return res.json({
      success: true,
      connected: false,
      projectId: "",
      totalSettles: 0,
      totalSettings: 0
    });
  }

  try {
    const settleSnap = await getDocs(collection(dbFirebase, "daily_settles"));
    const settingSnap = await getDocs(collection(dbFirebase, "settings"));
    
    return res.json({
      success: true,
      connected: true,
      projectId: firebaseProjectID,
      totalSettles: settleSnap.size,
      totalSettings: settingSnap.size
    });
  } catch (err: any) {
    return res.json({
      success: true,
      connected: true,
      projectId: firebaseProjectID,
      error: "상태 조회 실패: " + err.message,
      totalSettles: 0,
      totalSettings: 0
    });
  }
});

app.post("/api/firebase/sync-to-cloud", async (req: Request, res: Response) => {
  if (!dbFirebase) {
    return res.json({ success: false, error: "Firebase Firestore가 연결되지 않았습니다." });
  }
  try {
    const db = readDB();
    let settingsCount = 0;
    let settlesCount = 0;

    // 1. settings 싱크
    for (const s of db.settings) {
      await safeBackupToFirestore("settings", s.branch_name, s);
      settingsCount++;
    }

    // 2. master + expenses + staff 패키지 싱크
    for (const m of db.master) {
      const recordId = m.record_id;
      const liveBackup = {
        recordId,
        master: m,
        expenses: db.expenses.filter(e => e.record_id === recordId),
        staff: db.staff.filter(s => s.record_id === recordId)
      };
      await safeBackupToFirestore("daily_settles", recordId, liveBackup);
      settlesCount++;
    }

    return res.json({
      success: true,
      message: `클라우드 동기화 완료! 지점 설정 ${settingsCount}개, 일일 마감서 ${settlesCount}개가 Firestore에 무사 백업 보존되었습니다.`
    });
  } catch (err: any) {
    return res.json({ success: false, error: "클라우드 싱크 실패: " + err.message });
  }
});

app.post("/api/firebase/restore-from-cloud", async (req: Request, res: Response) => {
  if (!dbFirebase) {
    return res.json({ success: false, error: "Firebase Firestore가 연결되지 않았습니다." });
  }
  try {
    const db = readDB();

    // 1. Settings 원격 복조
    const settingSnap = await getDocs(collection(dbFirebase, "settings"));
    if (settingSnap.size > 0) {
      const restoredSettings: any[] = [];
      settingSnap.forEach(docSnap => {
        const d = docSnap.data();
        restoredSettings.push({
          branch_name: d.branch_name || docSnap.id,
          pin_hash: d.pin_hash,
          role: d.role || "branch",
          is_active: d.is_active !== false,
          brand: d.brand || "기타"
        });
      });
      db.settings = restoredSettings;
    }

    // 2. Daily Settle 원격 복조
    const settleSnap = await getDocs(collection(dbFirebase, "daily_settles"));
    if (settleSnap.size > 0) {
      const restoredMaster: any[] = [];
      const restoredExpenses: any[] = [];
      const restoredStaff: any[] = [];

      settleSnap.forEach(docSnap => {
        const d = docSnap.data();
        if (d.master) {
          restoredMaster.push(d.master);
        }
        if (d.expenses && Array.isArray(d.expenses)) {
          restoredExpenses.push(...d.expenses);
        }
        if (d.staff && Array.isArray(d.staff)) {
          restoredStaff.push(...d.staff);
        }
      });

      if (restoredMaster.length > 0) {
        db.master = restoredMaster;
        db.expenses = restoredExpenses;
        db.staff = restoredStaff;
      }
    }

    writeDB(db);

    return res.json({
      success: true,
      message: "Firestore 클라우드로부터 모든 영업 지정 설정과 마감 정산 보존 대장을 안전히 복토해 왔습니다!"
    });
  } catch (err: any) {
    return res.json({ success: false, error: "원격 복원 중 치명적인 장애 발생: " + err.message });
  }
});


// ----------------------------------------------------
// Vite 및 프로덕션 정적 자원 가동 핸들러
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[ERP_UGD System Server] listening on http://localhost:${PORT}`);
    if (process.env.VITE_GAS_URL) {
      console.log(`[ERP_UGD System Server] Google Sheets GAS Integration mode active.`);
    } else {
      console.log(`[ERP_UGD System Server] Spreadsheet URL lacks .env setting. Active local persistence simulation mode instead.`);
    }
  });
}

startServer();
