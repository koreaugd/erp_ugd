// server.ts
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
    ["관리자", "[삭제]", "admin", "TRUE", "본사"]
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

  const db = { settings, master, expenses, staff, logs };
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  return db;
}

function readDB(): LocalDB {
  if (!fs.existsSync(DB_PATH)) {
    return initLocalDB();
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (e) {
    return initLocalDB();
  }
}

function writeDB(db: LocalDB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
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

    switch (action) {
      case "verifyPin": {
        const { pinHash } = req.body;
        const cleanPinHash = String(pinHash || "").trim().toLowerCase();
        const found = db.settings.find(s => {
          if (!s.is_active) return false;
          if (s.pin_hash === cleanPinHash) return true;
          // admin 호환성
          if (s.role === "admin") {
            const isDbAdminHash = (s.pin_hash === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || s.pin_hash === "[해시삭제]");
            const isInputAdminHash = (cleanPinHash === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || cleanPinHash === "[해시삭제]");
            if (isDbAdminHash && isInputAdminHash) return true;
          }
          return false;
        });
        if (found) {
          return res.json({
            success: true,
            data: {
              branchName: found.branch_name,
              role: found.role,
              brand: found.brand
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
        const { master, expenses, staff } = req.body;
        const recordId = master.recordId || `uid-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        
        // 중복 체크 및 구글 시크릿 오버라이트 대응
        const dupIdx = db.master.findIndex(m => m.branch_name === master.branchName && m.settle_date === master.settleDate);
        
        const totalSales = Number(master.cashSales || 0) + 
                           Number(master.cardSales || 0) + 
                           Number(master.transferSales || 0) + 
                           Number(master.deliverySales || 0);

        const masterEntry = {
          record_id: recordId,
          branch_name: master.branchName,
          settle_date: master.settleDate,
          cash_sales: Number(master.cashSales || 0),
          card_sales: Number(master.cardSales || 0),
          transfer_sales: Number(master.transferSales || 0),
          delivery_sales: Number(master.deliverySales || 0),
          total_sales: totalSales,
          memo: master.memo || "",
          submitted_at: new Date().toISOString(),
          submitted_by: master.submittedBy || "branch",
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
        const { recordId, masterData, expenses, staff, modifiedBy } = req.body;
        const masterIdx = db.master.findIndex(m => m.record_id === recordId);
        if (masterIdx === -1) {
          return res.json({ success: false, error: "정산 레코드를 찾을 수 없습니다." });
        }

        const oldRow = db.master[masterIdx];
        const modifiedAt = new Date().toISOString();

        // 필드 단위 모니터링하여 수정로그 주입
        const fields = ["cash_sales", "card_sales", "transfer_sales", "delivery_sales", "memo"];
        const mapping: Record<string, string> = {
          "cash_sales": "cashSales",
          "card_sales": "cardSales",
          "transfer_sales": "transferSales",
          "delivery_sales": "deliverySales",
          "memo": "memo"
        };

        fields.forEach(f => {
          const payloadKey = mapping[f];
          if (masterData[payloadKey] !== undefined) {
            const oldVal = oldRow[f];
            const newVal = masterData[payloadKey];
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
