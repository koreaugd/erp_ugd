// src/api/firebaseDirect.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc,
  getDocFromServer
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { gasClient, MasterDaily, ExpenseDetail, StaffRecord } from "./gasClient";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path
  };
  console.error("Direct Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let appInstance: any = null;
let dbInstance: any = null;

/**
 * 프로젝트 루트의 firebase-applet-config.json 구성 값이 유효한지 검사
 */
export function isFirebaseConfigValid(): boolean {
  return !!(firebaseConfig && firebaseConfig.projectId && firebaseConfig.apiKey);
}

/**
 * 프론트엔드 다이렉트 Firestore DB 인스턴스 지연 초기화 반환
 */
export function getDirectDb() {
  if (!isFirebaseConfigValid()) {
    throw new Error("firebase-applet-config.json 구성 파일이 누락되었거나 불완전합니다.");
  }
  
  if (!dbInstance) {
    if (getApps().length === 0) {
      appInstance = initializeApp(firebaseConfig);
    } else {
      appInstance = getApp();
    }
    // 프레임워크 스키마 내 firestoreDatabaseId를 정규 인수로 지정하여 초기화
    dbInstance = getFirestore(appInstance, firebaseConfig.firestoreDatabaseId);
    
    // 부팅 시점에 1회 커넥션을 시범적으로 점검 (Skill 요구사항 충족)
    testConnection(dbInstance);
  }
  return dbInstance;
}

async function testConnection(db: any) {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("offline")) {
      console.error("[Firebase Direct Connection Test Warn] 클라이언트가 오프라인이거나 파이어베이스 설정이 잘못되었습니다.");
    }
  }
}

/**
 * Netlify 등 정적 호스팅 환경용: 직접 Firestore 상태 모니터링
 */
export async function getDirectFirebaseStatus() {
  if (!isFirebaseConfigValid()) {
    return {
      success: true,
      connected: false,
      projectId: "",
      totalSettles: 0,
      totalSettings: 0
    };
  }

  try {
    const db = getDirectDb();
    const settleSnap = await getDocs(collection(db, "daily_settles"));
    const settingSnap = await getDocs(collection(db, "settings"));
    
    return {
      success: true,
      connected: true,
      projectId: firebaseConfig.projectId,
      totalSettles: settleSnap.size,
      totalSettings: settingSnap.size
    };
  } catch (err: any) {
    return {
      success: true,
      connected: true,
      projectId: firebaseConfig.projectId,
      error: "정적 자바스크립트 직접 상태 조회 실패: " + err.message,
      totalSettles: 0,
      totalSettings: 0
    };
  }
}

/**
 * Netlify 등 정적 호스팅 환경용: 실시간 지점 정보 개별 다이렉트 백업
 */
export async function backupSettingDirect(branchName: string, data: any) {
  if (!isFirebaseConfigValid()) return;
  try {
    const db = getDirectDb();
    const docRef = doc(db, "settings", branchName.trim());
    const payload = {
      branch_name: branchName.trim(),
      pin_hash: data?.pinHash || data?.pin_hash || "",
      brand: data?.brand || "기타",
      role: data?.role || "branch",
      is_active: data?.isActive !== false && data?.is_active !== false,
      _updatedAt: new Date().toISOString()
    };
    await setDoc(docRef, payload);
    console.log(`[Firebase Direct] setting backed up: ${branchName}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `settings/${branchName}`);
  }
}

/**
 * 정적 호스팅 환경용: 실시간 지점 정보 개별 삭제 동정화
 */
export async function deleteSettingDirect(branchName: string) {
  if (!isFirebaseConfigValid()) return;
  try {
    const db = getDirectDb();
    const docRef = doc(db, "settings", branchName.trim());
    await deleteDoc(docRef);
    console.log(`[Firebase Direct] setting deleted: ${branchName}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `settings/${branchName}`);
  }
}

/**
 * Netlify 등 정적 호스팅 환경용: 실시간 마감정산 개별 다이렉트 백업
 */
export async function backupSettleDirect(recordId: string, payload: { master: any; expenses: any[]; staff: any[] }) {
  if (!isFirebaseConfigValid()) return;
  if (!payload || !payload.master) {
    console.warn("[backupSettleDirect] payload.master가 누락되어 Firebase 백업을 건너뜁니다.", { recordId, payload });
    return;
  }
  try {
    const db = getDirectDb();
    const docRef = doc(db, "daily_settles", recordId);

    const masterData = payload.master || {};

    const masterObj = {
      record_id: recordId,
      branch_name: masterData.branchName || masterData.branch_name || "Unknown Branch",
      settle_date: masterData.settleDate || masterData.settle_date || new Date().toISOString().split('T')[0],
      cash_sales: Number(masterData.cashSales ?? masterData.cash_sales ?? 0),
      card_sales: Number(masterData.cardSales ?? masterData.card_sales ?? 0),
      transfer_sales: Number(masterData.transferSales ?? masterData.transfer_sales ?? 0),
      delivery_sales: Number(masterData.deliverySales ?? masterData.delivery_sales ?? 0),
      total_sales: Number(masterData.totalSales ?? masterData.total_sales ?? 0),
      memo: masterData.memo || "",
      submitted_at: masterData.submittedAt || masterData.submitted_at || new Date().toISOString(),
      submitted_by: masterData.submittedBy || masterData.submitted_by || "branch",
      modified_at: masterData.modifiedAt || masterData.modified_at || "",
      modified_by: masterData.modifiedBy || masterData.modified_by || ""
    };

    const expensesArr = (payload.expenses || []).map((e: any) => ({
      record_id: recordId,
      expense_type: e?.expenseType || e?.expense_type || "현금지출",
      item_name: e?.itemName || e?.item_name || "",
      amount: Number(e?.amount || 0)
    }));

    const staffArr = (payload.staff || []).map((s: any) => ({
      record_id: recordId,
      staff_name: s?.staffName || s?.staff_name || "",
      work_hours: Number(s?.workHours || s?.work_hours || 0)
    }));

    const finalBackup = {
      recordId,
      master: masterObj,
      expenses: expensesArr,
      staff: staffArr,
      _updatedAt: new Date().toISOString()
    };

    await setDoc(docRef, finalBackup);
    console.log(`[Firebase Direct] daily_settles backed up: ${recordId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `daily_settles/${recordId}`);
  }
}

/**
 * Netlify 등 정적 호스팅 환경용: 브라우저 직접 구글시트 -> Firestore 업로드 싱크 가동
 */
export async function syncDirectToFirebase() {
  try {
    const db = getDirectDb();
    
    // 1. 전체 설정 동기화
    const branches = await gasClient.getBranchListAll();
    const existingSettingsSnap = await getDocs(collection(db, "settings"));
    const existingSettingsMap = new Map();
    existingSettingsSnap.forEach(docSnap => {
      existingSettingsMap.set(docSnap.id, docSnap.data());
    });

    let settingsCount = 0;
    for (const b of branches) {
      const existing = existingSettingsMap.get(b.branchName) || {};
      const dataToSave = {
        branch_name: b.branchName,
        pin_hash: (b as any).pinHash || existing.pin_hash || "",
        role: b.role || existing.role || "branch",
        is_active: b.isActive !== false,
        brand: b.brand || existing.brand || "기타",
        _updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, "settings", b.branchName), dataToSave);
      settingsCount++;
    }

    // 2. 전체 이력 동기화
    let settlesCount = 0;
    for (const b of branches) {
      const history = await gasClient.getBranchHistory(b.branchName);
      for (const item of history) {
        if (!item.recordId) continue;
        
        // 지출 및 근무 인적 세부 정보 획득
        const detail = await gasClient.getDailyDetail(item.recordId);
        
        const masterObj = {
          record_id: item.recordId,
          branch_name: item.branchName,
          settle_date: item.settleDate,
          cash_sales: Number(item.cashSales || 0),
          card_sales: Number(item.cardSales || 0),
          transfer_sales: Number(item.transferSales || 0),
          delivery_sales: Number(item.deliverySales || 0),
          total_sales: Number(item.totalSales || 0),
          memo: item.memo || "",
          submitted_at: item.submittedAt || "",
          submitted_by: item.submittedBy || "",
          modified_at: item.modifiedAt || "",
          modified_by: item.modifiedBy || ""
        };
        
        const expensesArr = (detail.expenses || []).map((e: any) => ({
          record_id: item.recordId,
          expense_type: e.expenseType,
          item_name: e.itemName,
          amount: Number(e.amount)
        }));
        
        const staffArr = (detail.staff || []).map((s: any) => ({
          record_id: item.recordId,
          staff_name: s.staffName,
          work_hours: Number(s.workHours)
        }));

        const backupObj = {
          recordId: item.recordId,
          master: masterObj,
          expenses: expensesArr,
          staff: staffArr,
          _updatedAt: new Date().toISOString()
        };
        
        await setDoc(doc(db, "daily_settles", item.recordId), backupObj);
        settlesCount++;
      }
    }

    return {
      success: true,
      message: `[Netlify 프론트 다이렉트 백업 성공] 클라우드 로컬 동기화 완료! 지점 설정 ${settingsCount}개, 일일 마감서 ${settlesCount}개가 Firestore에 안전하게 업로드 보존 처리되었습니다.`
    };
  } catch (err: any) {
    return {
      success: false,
      error: "정상 직접 업로드 실패: " + err.message
    };
  }
}

/**
 * Netlify 등 정적 호스팅 환경용: Firestore 클라우드 원본 -> 브라우저 직접 구글시트 복원 전송 가동
 */
export async function restoreDirectFromFirebase() {
  try {
    const db = getDirectDb();

    // 1. Settings 원격 복조
    const settingSnap = await getDocs(collection(db, "settings"));
    let settingsCount = 0;
    if (settingSnap.size > 0) {
      for (const docSnap of settingSnap.docs) {
        const d = docSnap.data();
        const branchName = d.branch_name || docSnap.id;
        const brand = d.brand || "기타";
        const pinHash = d.pin_hash || "";
        const role = d.role || "branch";
        const isActive = d.is_active !== false;

        // 구글 앱스 스크립트(GAS) 또는 로컬 대체처로 개별 오버라이트 주입 실행
        await gasClient.addBranch(branchName, pinHash, brand, role);
        await gasClient.toggleBranchActive(branchName, isActive);
        settingsCount++;
      }
    }

    // 2. Daily Settle 원격 복조
    const settleSnap = await getDocs(collection(db, "daily_settles"));
    let settlesCount = 0;
    if (settleSnap.size > 0) {
      for (const docSnap of settleSnap.docs) {
        const d = docSnap.data();
        if (d.master) {
          const master: MasterDaily = {
            recordId: d.master.record_id,
            branchName: d.master.branch_name,
            settleDate: d.master.settle_date,
            cashSales: d.master.cash_sales,
            cardSales: d.master.card_sales,
            transferSales: d.master.transfer_sales,
            deliverySales: d.master.delivery_sales,
            totalSales: d.master.total_sales,
            memo: d.master.memo,
            submittedAt: d.master.submitted_at,
            submittedBy: d.master.submitted_by,
            modifiedAt: d.master.modified_at,
            modifiedBy: d.master.modified_by
          };

          const expenses: ExpenseDetail[] = (d.expenses || []).map((e: any) => ({
            expenseType: e.expense_type,
            itemName: e.item_name,
            amount: e.amount
          }));

          const staff: StaffRecord[] = (d.staff || []).map((s: any) => ({
            staffName: s.staff_name,
            workHours: s.work_hours
          }));

          await gasClient.submitDaily(master, expenses, staff);
          settlesCount++;
        }
      }
    }

    return {
      success: true,
      message: `[Netlify 프론트 다이렉트 복구 성공] Firestore 클라우드 클러스터로부터 지점 설정 ${settingsCount}개, 일일 마감 정산서 ${settlesCount}개를 현업 원격지로 온전히 복토 복구에 인계하였습니다!`
    };
  } catch (err: any) {
    return {
      success: false,
      error: "정상 복원 실패: " + err.message
    };
  }
}
