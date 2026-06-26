// src/api/firebaseDirect.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocFromServer
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { gasClient, MasterDaily, ExpenseDetail, StaffRecord } from "./gasClient";

const firebaseRecordId = (branchName: string, settleDate: string) => `${encodeURIComponent(branchName)}--${settleDate}`;

function toMaster(data: any): MasterDaily {
  // Firebase 전환 전의 백업은 snake_case, 전환 후 저장본은 camelCase입니다.
  // 두 형식을 모두 같은 화면에서 읽을 수 있도록 경계에서 하나로 정규화합니다.
  return {
    ...data,
    recordId: data?.recordId || data?.record_id || "",
    branchName: data?.branchName || data?.branch_name || "",
    settleDate: data?.settleDate || data?.settle_date || "",
    cashSales: Number(data?.cashSales ?? data?.cash_sales ?? 0),
    cardSales: Number(data?.cardSales ?? data?.card_sales ?? 0),
    transferSales: Number(data?.transferSales ?? data?.transfer_sales ?? 0),
    deliverySales: Number(data?.deliverySales ?? data?.delivery_sales ?? 0),
    totalSales: Number(data?.totalSales ?? data?.total_sales ?? 0),
    memo: data?.memo || "",
    submittedAt: data?.submittedAt || data?.submitted_at || "",
    submittedBy: data?.submittedBy || data?.submitted_by || "",
    modifiedAt: data?.modifiedAt || data?.modified_at || "",
    modifiedBy: data?.modifiedBy || data?.modified_by || ""
  } as MasterDaily;
}

async function findDailyDocs(branchName?: string) {
  const snapshot = await getDocs(collection(getDirectDb(), "daily_settles"));
  return snapshot.docs.map((item) => {
    const data: any = item.data();
    return { id: item.id, ...data, master: toMaster(data.master || {}) };
  }).filter((item: any) => !branchName || item.master.branchName === branchName);
}

export async function firebaseGetDailyFormBootstrap(branchName: string, settleDate: string) {
  const items = await findDailyDocs(branchName);
  const duplicate = items.find((item: any) => item.master?.settleDate === settleDate);
  const previous = items.filter((item: any) => item.master?.settleDate < settleDate)
    .sort((a: any, b: any) => b.master.settleDate.localeCompare(a.master.settleDate))[0];
  let previousCash = "0";
  try { previousCash = String(JSON.parse(String(previous?.master?.memo || "").split("\n---\nMETADATA:")[1]).cashBalance ?? "0"); } catch {}
  return { exists: !!duplicate, recordId: duplicate?.recordId || duplicate?.id || null, record: duplicate?.master || null, previousCash };
}

export async function firebaseSubmitDaily(master: MasterDaily, expenses: ExpenseDetail[], staff: StaffRecord[]) {
  const recordId = firebaseRecordId(master.branchName, master.settleDate);
  const existing = await getDoc(doc(getDirectDb(), "daily_settles", recordId));
  const now = new Date().toISOString();
  const savedMaster = {
    ...master,
    recordId,
    totalSales: Number(master.cashSales || 0) + Number(master.cardSales || 0) + Number(master.transferSales || 0) + Number(master.deliverySales || 0),
    submittedAt: existing.exists() ? existing.data().master.submittedAt : now,
    modifiedAt: existing.exists() ? now : "",
    modifiedBy: existing.exists() ? master.submittedBy || "branch" : ""
  };
  await setDoc(doc(getDirectDb(), "daily_settles", recordId), { recordId, master: savedMaster, expenses, staff, updatedAt: now });
  return { recordId };
}

export async function firebaseGetDailyDetail(recordId: string) {
  const snapshot = await getDoc(doc(getDirectDb(), "daily_settles", recordId));
  if (!snapshot.exists()) throw new Error("해당 마감 데이터를 찾을 수 없습니다.");
  const data: any = snapshot.data();
  return { master: toMaster(data.master), expenses: data.expenses || [], staff: data.staff || [] };
}

export async function firebaseGetBranchHistory(branchName: string, month?: string): Promise<MasterDaily[]> {
  return (await findDailyDocs(branchName)).map((item: any) => toMaster(item.master))
    .filter((master) => !month || master.settleDate.startsWith(month))
    .sort((a, b) => b.settleDate.localeCompare(a.settleDate));
}

export async function firebaseGetEditLogs() {
  const snapshot = await getDocs(collection(getDirectDb(), "edit_logs"));
  return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as any) }))
    .sort((a: any, b: any) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function firebaseDeleteEditLog(logId: string) {
  await deleteDoc(doc(getDirectDb(), "edit_logs", logId));
  return { success: true };
}

export async function firebaseUpdateDaily(recordId: string, masterData: Partial<MasterDaily>, expenses?: ExpenseDetail[], staff?: StaffRecord[], modifiedBy?: string) {
  const detail = await firebaseGetDailyDetail(recordId);
  const now = new Date().toISOString();

  const beforeState = {
    cashSales: Number(detail.master?.cashSales || 0),
    cardSales: Number(detail.master?.cardSales || 0),
    transferSales: Number(detail.master?.transferSales || 0),
    deliverySales: Number(detail.master?.deliverySales || 0),
    memo: detail.master?.memo || "",
    expenses: detail.expenses || [],
    staff: detail.staff || []
  };

  const master = { ...detail.master, ...masterData, modifiedAt: now, modifiedBy: modifiedBy || "관리자" };
  master.totalSales = Number(master.cashSales || 0) + Number(master.cardSales || 0) + Number(master.transferSales || 0) + Number(master.deliverySales || 0);

  const afterExpenses = expenses ?? detail.expenses;
  const afterStaff = staff ?? detail.staff;

  const afterState = {
    cashSales: Number(master.cashSales || 0),
    cardSales: Number(master.cardSales || 0),
    transferSales: Number(master.transferSales || 0),
    deliverySales: Number(master.deliverySales || 0),
    memo: master.memo || "",
    expenses: afterExpenses,
    staff: afterStaff
  };

  await setDoc(doc(getDirectDb(), "daily_settles", recordId), { recordId, master, expenses: afterExpenses, staff: afterStaff, updatedAt: now });

  try {
    const logId = `${recordId}-${Date.now()}`;
    await setDoc(doc(getDirectDb(), "edit_logs", logId), {
      id: logId,
      recordId,
      branchName: master.branchName,
      settleDate: master.settleDate,
      modifiedAt: now,
      modifiedBy: modifiedBy || "관리자",
      before: beforeState,
      after: afterState
    });
  } catch (err) {
    console.warn("Failed to write edit log to Firebase:", err);
  }

  return { success: true };
}

export async function firebaseDeleteDaily(recordId: string) {
  await deleteDoc(doc(getDirectDb(), "daily_settles", recordId));
  return { success: true };
}

export async function firebaseGetStaffRoster(branchName: string) {
  const snapshot = await getDocs(collection(getDirectDb(), "staff_rosters"));
  const entry = snapshot.docs.map((item) => item.data() as any).find((item) => item.branchName === branchName);
  return entry?.employees || [];
}

export async function firebaseSaveStaffRoster(branchName: string, employees: any[]) {
  await setDoc(doc(getDirectDb(), "staff_rosters", encodeURIComponent(branchName)), { branchName, employees, updatedAt: new Date().toISOString() });
  return { success: true, employees };
}

// 지점이 직접 등록·관리하는 직원 명단 (관리자 직원명부와 분리된 컬렉션)
export async function firebaseGetBranchOwnRoster(branchName: string) {
  const snapshot = await getDocs(collection(getDirectDb(), "branch_own_rosters"));
  const entry = snapshot.docs.map((item) => item.data() as any).find((item) => item.branchName === branchName);
  return entry?.employees || [];
}

export async function firebaseSaveBranchOwnRoster(branchName: string, employees: any[]) {
  await setDoc(doc(getDirectDb(), "branch_own_rosters", encodeURIComponent(branchName)), { branchName, employees, updatedAt: new Date().toISOString() });
  return { success: true, employees };
}

export async function firebaseGetSharedData(dataKey: string) {
  const snapshot = await getDoc(doc(getDirectDb(), "shared_data", encodeURIComponent(dataKey)));
  return snapshot.exists() ? snapshot.data().value ?? null : null;
}

export async function firebaseGetBranchList() {
  const snapshot = await getDocs(collection(getDirectDb(), "public_branches"));
  return snapshot.docs.map((item) => item.data() as any).filter((branch) => branch.isActive !== false);
}

export async function firebaseGetDailyList(settleDate: string) {
  const [branches, settlements] = await Promise.all([firebaseGetBranchList(), findDailyDocs()]);
  const byBranch = new Map(settlements.filter((item: any) => item.master?.settleDate === settleDate).map((item: any) => [item.master.branchName, item.master]));
  return branches.filter((branch: any) => branch.role === "branch").map((branch: any) => ({ branchName: branch.branchName, brand: branch.brand, role: "branch", submitted: byBranch.has(branch.branchName), record: byBranch.get(branch.branchName) || null }));
}

export async function firebaseSaveSharedData(dataKey: string, value: unknown) {
  await setDoc(doc(getDirectDb(), "shared_data", encodeURIComponent(dataKey)), { value, updatedAt: new Date().toISOString() });
  return { success: true };
}

export async function firebaseGetAllManualOvertimes() {
  const snapshot = await getDocs(collection(getDirectDb(), "shared_data"));
  const allOvertimes: any[] = [];
  snapshot.forEach((doc) => {
    const key = decodeURIComponent(doc.id);
    if (key.startsWith("manual_overtime:")) {
      const branchName = key.replace("manual_overtime:", "");
      const list = doc.data().value || [];
      if (Array.isArray(list)) {
        list.forEach((item: any) => {
          allOvertimes.push({
            ...item,
            branchName,
          });
        });
      }
    }
  });
  return allOvertimes;
}

export async function firebaseGetAllLaborContracts() {
  const snapshot = await getDocs(collection(getDirectDb(), "shared_data"));
  const allContracts: any[] = [];
  snapshot.forEach((doc) => {
    const key = decodeURIComponent(doc.id);
    if (key.startsWith("labor_contracts:")) {
      const branchName = key.replace("labor_contracts:", "");
      const list = doc.data().value || [];
      if (Array.isArray(list)) {
        list.forEach((item: any) => {
          allContracts.push({
            ...item,
            branchName,
          });
        });
      }
    }
  });
  return allContracts;
}

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

async function findPublicBranchDocId(branchName: string) {
  const db = getDirectDb();
  const snapshot = await getDocs(collection(db, "public_branches"));
  const existing = snapshot.docs.find((item) => String((item.data() as any).branchName || "").trim() === branchName.trim());
  if (existing) return existing.id;

  const numericIds = snapshot.docs
    .map((item) => Number((item.data() as any).branchId || item.id))
    .filter((value) => Number.isFinite(value));
  const nextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : snapshot.size + 1;
  return String(nextId).padStart(2, "0");
}

async function ensureBranchAuthUser(loginEmail: string, rawPin?: string) {
  if (!rawPin?.trim()) return;
  const password = `ugd-${rawPin.trim()}`;
  if (password.length < 6) return;

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: loginEmail, password, returnSecureToken: false })
  });
  if (response.ok) return;

  const body = await response.json().catch(() => ({}));
  const message = String(body?.error?.message || "");
  if (message.includes("EMAIL_EXISTS")) return;
  throw new Error(message || `Failed to create Firebase Auth user: ${loginEmail}`);
}

async function upsertPublicBranchDirect(branchName: string, data: any) {
  const role = data?.role || "branch";
  if (role !== "branch") return;

  const db = getDirectDb();
  const currentUser = getAuth(appInstance || getApp()).currentUser;
  if (currentUser?.email !== "admin@ugd-erp.example") {
    throw new Error("Firebase 관리자 인증이 준비되지 않아 로그인 지점 목록을 갱신하지 못했습니다. 관리자 PIN 인증 후 다시 시도해 주세요.");
  }

  const branchId = await findPublicBranchDocId(branchName);
  const loginEmail = `branch-${branchId}@ugd-erp.example`;
  await ensureBranchAuthUser(loginEmail, data?.rawPin);

  await setDoc(doc(db, "public_branches", branchId), {
    branchId,
    branchName: branchName.trim(),
    brand: data?.brand || branchName.trim(),
    role: "branch",
    loginEmail,
    isActive: data?.isActive !== false && data?.is_active !== false,
    updatedAt: new Date().toISOString()
  }, { merge: true });
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
    await upsertPublicBranchDirect(branchName, data);
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
    const publicBranchId = await findPublicBranchDocId(branchName);
    await deleteDoc(doc(db, "public_branches", publicBranchId));
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
