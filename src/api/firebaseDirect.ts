// src/api/firebaseDirect.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  getDocs,
  getDocsFromServer,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocFromServer,
  runTransaction,
  query,
  where,
  or,
  getCountFromServer
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { gasClient, MasterDaily, ExpenseDetail, StaffRecord, DailyListRow } from "./gasClient";

const firebaseRecordId = (branchName: string, settleDate: string) => `${encodeURIComponent(branchName)}--${settleDate}`;

async function waitForFirebaseUser(timeoutMs = 7000) {
  const auth = getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig));
  if (auth.currentUser) return auth.currentUser;

  return await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Firebase 로그인 세션 복원이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."));
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      window.clearTimeout(timeoutId);
      unsubscribe();
      if (user) resolve(user);
      else reject(new Error("Firebase 로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요."));
    }, (error) => {
      window.clearTimeout(timeoutId);
      unsubscribe();
      reject(error);
    });
  });
}

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

// master 안의 필드는 현행(camelCase)과 레거시/미러백업(snake_case)이 섞여 있다(toMaster가 둘 다 정규화).
// 그래서 타깃 쿼리는 두 표기를 or 로 모두 잡아야 "전체 스캔 + toMaster 필터"와 동일한 문서 집합이 된다.
// (한 문서는 두 표기 중 하나에만 값을 담으므로 or 로 정확히 같은 집합을 얻는다.)
function dailyDocsQuery(branchName: string) {
  const coll = collection(getDirectDb(), "daily_settles");
  return query(coll, or(where("master.branchName", "==", branchName), where("master.branch_name", "==", branchName)));
}
function dailyDateQuery(settleDate: string) {
  const coll = collection(getDirectDb(), "daily_settles");
  return query(coll, or(where("master.settleDate", "==", settleDate), where("master.settle_date", "==", settleDate)));
}

// 타깃 쿼리(primary)를 서버에서 읽되, 인덱스 미비 등(quota 아님)으로 실패하면 전체 컬렉션으로 폴백한다.
// 핵심: 인덱스 실패일 때는 캐시 폴백도 fullColl 로 한다 — 같은 인덱스 오류를 낼 타깃 쿼리로 재시도하지 않는다(Codex 지적 반영).
// quota 초과·오프라인 등 "서버 도달 실패"는 인덱스 문제가 아니므로 타깃 쿼리 그대로 캐시에서 읽는다.
async function readDailyDocs(primary: any, fullColl: any, postFilter: (item: any) => boolean) {
  const mapDocs = (snapshot: any) => snapshot.docs.map((item: any) => {
    const data: any = item.data();
    return { id: item.id, ...data, master: toMaster(data.master || {}) };
  }).filter(postFilter);

  try {
    return mapDocs(await getDocsFromServer(primary));
  } catch (error) {
    const code = (error as any)?.code;
    if (primary !== fullColl && code !== "resource-exhausted") {
      console.warn("[Firebase Direct] Targeted daily query failed; falling back to full scan.", error);
      try {
        return mapDocs(await getDocsFromServer(fullColl));
      } catch (serverError) {
        console.warn("[Firebase Direct] Full server scan also failed; using cached full collection.", serverError);
        return mapDocs(await getDocs(fullColl));
      }
    }
    console.warn("[Firebase Direct] Server read failed for daily_settles; falling back to cached docs.", error);
    return mapDocs(await getDocs(primary));
  }
}

async function findDailyDocs(branchName?: string) {
  await waitForFirebaseUser();
  const fullColl = collection(getDirectDb(), "daily_settles");
  // 지점을 지정하면 전 지점·전 기간을 통째로 읽지 않고 그 지점 문서만 읽는다.
  // 이것이 무료 등급 하루 읽기 한도(5만)를 소진해 전 지점이 "빈 화면"으로 보이던 사고의 핵심 수정이다.
  const primary = branchName ? dailyDocsQuery(branchName) : fullColl;
  return readDailyDocs(primary, fullColl, (item: any) => !branchName || item.master.branchName === branchName);
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
  // 로그인 인증이 준비된 뒤 제출한다. 인증 없이 쓰면 거부(permission-denied)돼 마감이 조용히 유실된다
  // (유휴 자동 로그아웃 뒤 제출하는 경우가 특히 위험 — 화면엔 남아 있는데 서버엔 안 올라간다).
  await waitForFirebaseUser();
  const recordId = firebaseRecordId(master.branchName, master.settleDate);
  const recordRef = doc(getDirectDb(), "daily_settles", recordId);
  let existing;
  try {
    existing = await getDocFromServer(recordRef);
  } catch {
    existing = await getDoc(recordRef);
  }
  const now = new Date().toISOString();
  const savedMaster = {
    ...master,
    recordId,
    totalSales: Number(master.cashSales || 0) + Number(master.cardSales || 0) + Number(master.transferSales || 0) + Number(master.deliverySales || 0),
    submittedAt: existing.exists() ? existing.data().master.submittedAt : now,
    submittedByUid: master.submittedByUid || "",
    modifiedAt: existing.exists() ? now : "",
    // 거짓 작성자 금지(설계서 §7) — 실제 값이 없으면 "branch" 같은 대체 문구 대신 빈 문자열로 남긴다.
    modifiedBy: existing.exists() ? master.submittedBy || "" : "",
    modifiedByUid: existing.exists() ? master.submittedByUid || "" : ""
  };
  await setDoc(recordRef, { recordId, master: savedMaster, expenses, staff, updatedAt: now });
  return { recordId };
}

export async function firebaseGetDailyDetail(recordId: string) {
  await waitForFirebaseUser();
  const recordRef = doc(getDirectDb(), "daily_settles", recordId);
  let snapshot;
  try {
    snapshot = await getDocFromServer(recordRef);
  } catch (error) {
    console.warn("[Firebase Direct] Server read failed for daily detail; falling back to cached doc.", error);
    snapshot = await getDoc(recordRef);
  }
  if (!snapshot.exists()) throw new Error("해당 마감 데이터를 찾을 수 없습니다.");
  const data: any = snapshot.data();
  return { master: toMaster(data.master), expenses: data.expenses || [], staff: data.staff || [] };
}

// 서버 문서만 읽는 상세(캐시 폴백 없음, 실패 시 throw).
// 급여대장 초과근무 집계처럼 부분/스테일 데이터가 '정상 집계'로 둔갑하면 위험한 화면 전용.
export async function firebaseGetDailyDetailFromServer(recordId: string) {
  await waitForFirebaseUser();
  const snapshot = await getDocFromServer(doc(getDirectDb(), "daily_settles", recordId));
  if (!snapshot.exists()) throw new Error("해당 마감 데이터를 찾을 수 없습니다.");
  const data: any = snapshot.data();
  return { master: toMaster(data.master), expenses: data.expenses || [], staff: data.staff || [] };
}

export async function firebaseGetBranchHistory(branchName: string, month?: string): Promise<MasterDaily[]> {
  return (await findDailyDocs(branchName)).map((item: any) => toMaster(item.master))
    .filter((master) => !month || master.settleDate.startsWith(month))
    .sort((a, b) => b.settleDate.localeCompare(a.settleDate));
}

// 서버 문서만 읽어 지점 마감 히스토리를 반환한다(캐시 폴백 없음). 서버 도달 실패 시 그대로 throw.
// 월말마감 엑셀처럼 "빈/오래된 데이터로 조용히 채우면 위험한" 경우 전용 — 호출부가 실패를 감지해 다운로드를 취소할 수 있게 한다.
export async function firebaseGetBranchHistoryFromServer(branchName: string, month?: string): Promise<MasterDaily[]> {
  await waitForFirebaseUser();
  let snapshot;
  try {
    // 전체 스캔 대신 지점 문서만 서버에서 읽는다(관리자 전지점 루프가 매 지점 전체 스캔하던 최악 증폭원 제거).
    snapshot = await getDocsFromServer(dailyDocsQuery(branchName));
  } catch (error) {
    // serverOnly 는 "신선한 서버 값"이 계약이라 캐시로는 폴백하지 않는다. 한도 초과면 그대로 throw.
    // 타깃 쿼리가 인덱스 미비로 실패한 경우에만 전체 스캔(여전히 서버·신선)으로 폴백한다.
    if ((error as any)?.code === "resource-exhausted") throw error;
    console.warn("[Firebase Direct] Targeted server-only daily query failed; full scan fallback.", error);
    snapshot = await getDocsFromServer(collection(getDirectDb(), "daily_settles"));
  }
  return snapshot.docs
    .map((item) => toMaster((item.data() as any).master || {}))
    .filter((master) => master.branchName === branchName)
    .filter((master) => !month || master.settleDate.startsWith(month))
    .sort((a, b) => b.settleDate.localeCompare(a.settleDate));
}

export async function firebaseGetEditLogs() {
  await waitForFirebaseUser(); // 인증 전 거부를 "이력 없음"으로 오해하지 않도록 로그인 복원을 기다린다.
  const snapshot = await getDocs(collection(getDirectDb(), "edit_logs"));
  return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as any) }))
    .sort((a: any, b: any) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function firebaseDeleteEditLog(logId: string) {
  await waitForFirebaseUser(); // 인증 준비 후 삭제(인증 없으면 거부).
  await deleteDoc(doc(getDirectDb(), "edit_logs", logId));
  return { success: true };
}

export async function firebaseUpdateDaily(recordId: string, masterData: Partial<MasterDaily>, expenses?: ExpenseDetail[], staff?: StaffRecord[], modifiedBy?: string, modifiedByUid?: string) {
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

  // 거짓 작성자 금지(설계서 §7) — 실제 값이 없으면 "관리자" 같은 대체 문구 대신 빈 문자열로 남긴다.
  const master = { ...detail.master, ...masterData, modifiedAt: now, modifiedBy: modifiedBy || "", modifiedByUid: modifiedByUid || "" };
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

  // 본문 저장은 이미 끝났다 — 이력 기록 실패로 저장 자체를 막지 않는다(설계서 §7).
  // 다만 실패를 그냥 삼키면 "수정됐는데 이력만 없는" 상태를 아무도 모르게 되므로, 호출부가 알 수 있게 플래그로 반환한다.
  let editLogFailed = false;
  try {
    const logId = `${recordId}-${Date.now()}`;
    await setDoc(doc(getDirectDb(), "edit_logs", logId), {
      id: logId,
      recordId,
      branchName: master.branchName,
      settleDate: master.settleDate,
      modifiedAt: now,
      modifiedBy: modifiedBy || "",
      modifiedByUid: modifiedByUid || "",
      before: beforeState,
      after: afterState
    });
  } catch (err) {
    console.warn("Failed to write edit log to Firebase:", err);
    editLogFailed = true;
  }

  return { success: true, editLogFailed };
}

export async function firebaseDeleteDaily(recordId: string) {
  await waitForFirebaseUser(); // 인증 준비 후 삭제(인증 없으면 거부).
  await deleteDoc(doc(getDirectDb(), "daily_settles", recordId));
  return { success: true };
}

export async function firebaseGetStaffRoster(branchName: string) {
  await waitForFirebaseUser(); // 인증 전 거부를 "명단 없음"으로 오해하지 않도록 로그인 복원을 기다린다.
  const directDoc = await getDocFromServer(doc(getDirectDb(), "staff_rosters", encodeURIComponent(branchName)));
  if (directDoc.exists()) return (directDoc.data() as any)?.employees || [];
  const snapshot = await getDocs(collection(getDirectDb(), "staff_rosters"));
  const entry = snapshot.docs.map((item) => item.data() as any).find((item) => item.branchName === branchName);
  return entry?.employees || [];
}

export async function firebaseSaveStaffRoster(branchName: string, employees: any[]) {
  await waitForFirebaseUser(); // 인증 복원 전 쓰기는 거부돼 명단 수정이 유실될 수 있다 — 기다렸다 저장한다.
  await setDoc(doc(getDirectDb(), "staff_rosters", encodeURIComponent(branchName)), { branchName, employees, updatedAt: new Date().toISOString() });
  return { success: true, employees };
}

// 지점이 직접 등록·관리하는 직원 명단 (관리자 직원명부와 분리된 컬렉션)
export async function firebaseGetBranchOwnRoster(branchName: string) {
  await waitForFirebaseUser(); // 인증 전 거부를 "명단 없음"으로 오해하지 않도록 로그인 복원을 기다린다.
  const directDoc = await getDocFromServer(doc(getDirectDb(), "branch_own_rosters", encodeURIComponent(branchName)));
  if (directDoc.exists()) return (directDoc.data() as any)?.employees || [];
  const snapshot = await getDocs(collection(getDirectDb(), "branch_own_rosters"));
  const entry = snapshot.docs.map((item) => item.data() as any).find((item) => item.branchName === branchName);
  return entry?.employees || [];
}

// 서버 문서만 읽는 지점 자체 명단 조회(직접 문서·레거시 컬렉션 폴백 모두 서버 전용, 캐시 폴백 없음).
// 실패 시 throw. 월말마감 엑셀처럼 오래된 로스터로 급여시트를 만들면 안 되는 fail-closed 산출물 전용.
export async function firebaseGetBranchOwnRosterFromServer(branchName: string) {
  await waitForFirebaseUser(); // 인증 전 거부를 "명단 없음"으로 오해하지 않도록 로그인 복원을 기다린다.
  const directDoc = await getDocFromServer(doc(getDirectDb(), "branch_own_rosters", encodeURIComponent(branchName)));
  if (directDoc.exists()) return (directDoc.data() as any)?.employees || [];
  const snapshot = await getDocsFromServer(collection(getDirectDb(), "branch_own_rosters"));
  const entry = snapshot.docs.map((item) => item.data() as any).find((item) => item.branchName === branchName);
  return entry?.employees || [];
}

export async function firebaseSaveBranchOwnRoster(branchName: string, employees: any[]) {
  await waitForFirebaseUser(); // 인증 복원 전 쓰기는 거부돼 명단이 유실될 수 있다 — 기다렸다 저장한다.
  await setDoc(doc(getDirectDb(), "branch_own_rosters", encodeURIComponent(branchName)), { branchName, employees, updatedAt: new Date().toISOString() });
  return { success: true, employees };
}

export async function firebaseGetSharedData(dataKey: string) {
  const recordRef = doc(getDirectDb(), "shared_data", encodeURIComponent(dataKey));
  let snapshot;
  try {
    // 로그인(인증) 복원을 먼저 기다린다. shared_data는 인증이 없으면 읽기가 거부(permission-denied)되는데,
    // 그걸 "서버에 값 없음(null)"으로 오해하면 다른 노트북에서 화면이 비어 버린다. 준비되면 읽는다.
    await waitForFirebaseUser();
    snapshot = await getDocFromServer(recordRef);
  } catch (error) {
    console.warn("[Firebase Direct] Server read failed for shared_data; falling back to cached doc.", error);
    snapshot = await getDoc(recordRef);
  }
  return snapshot.exists() ? snapshot.data().value ?? null : null;
}

// 마감 검증처럼 캐시로 승인되면 안 되는 경우 전용: 서버 문서만 읽는다.
// 오프라인/서버 도달 실패 시 캐시로 폴백하지 않고 그대로 throw하여 호출부가 마감을 막을 수 있게 한다.
export async function firebaseGetSharedDataFromServer(dataKey: string) {
  await waitForFirebaseUser(); // 인증 전 거부를 "값 없음"으로 오해하지 않도록 로그인 복원을 기다린다.
  const recordRef = doc(getDirectDb(), "shared_data", encodeURIComponent(dataKey));
  const snapshot = await getDocFromServer(recordRef);
  return snapshot.exists() ? snapshot.data().value ?? null : null;
}

export async function firebaseGetBranchList() {
  const snapshot = await getDocs(collection(getDirectDb(), "public_branches"));
  return snapshot.docs.map((item) => item.data() as any).filter((branch) => branch.isActive !== false);
}

export async function firebaseGetDailyList(settleDate: string): Promise<DailyListRow[]> {
  await waitForFirebaseUser();
  const fullColl = collection(getDirectDb(), "daily_settles");
  // 전 지점·전 기간을 통째로 읽지 않고, 그 날짜의 마감 문서만 읽는다(관리자 제출현황이 매번 전체 스캔하던 문제 수정).
  const [branches, settlements] = await Promise.all([
    firebaseGetBranchList(),
    readDailyDocs(dailyDateQuery(settleDate), fullColl, (item: any) => item.master?.settleDate === settleDate)
  ]);
  const byBranch = new Map<string, MasterDaily>(
    settlements
      .filter((item: any) => item.master?.settleDate === settleDate)
      .map((item: any) => [item.master.branchName, item.master as MasterDaily])
  );
  return branches.filter((branch: any) => branch.role === "branch").map((branch: any) => ({ branchName: branch.branchName, brand: branch.brand, role: "branch", submitted: byBranch.has(branch.branchName), record: byBranch.get(branch.branchName) || null }));
}

export async function firebaseSaveSharedData(dataKey: string, value: unknown) {
  await waitForFirebaseUser(); // 인증 복원 전 쓰기는 거부된다 — 준비될 때까지 기다렸다 저장한다.
  const db = getDirectDb();
  const encodedKey = encodeURIComponent(dataKey);
  const recordRef = doc(db, "shared_data", encodedKey);
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    const currentSnapshot = await getDoc(recordRef);
    if (currentSnapshot.exists()) {
      const current = currentSnapshot.data();
      // 백업은 '요일 슬롯' 7개에 돌려쓴다(--slot0 ~ --slot6). 같은 요일에 다시 저장하면 그 슬롯을 덮어써서
      // 최근 7일치가 자동으로 유지되고, 오래된 백업이 쌓이지 않아 별도 정리(삭제)가 필요 없다.
      //
      // 예전에는 타임스탬프 ID로 쌓고 컬렉션 전체를 훑어 오래된 것을 지웠는데, 그 전체 조회는
      // 급여대장 백업에 지점별 권한이 생긴 뒤로 권한 없는 사용자에게 거부된다 —
      // 그러면 정리가 조용히 멈춰 급여·주민번호·계좌가 담긴 옛 백업이 무한정 남는다(Codex 지적 2026-07-27).
      // 문서 ID 앞부분은 그대로라 규칙의 급여 판별(isSalaryKey/salaryBranchOf)은 동일하게 동작한다.
      const slot = now.getDay();   // 0=일 ~ 6=토
      await setDoc(doc(db, "shared_data_backups", `${encodedKey}--slot${slot}`), {
        dataKey,
        value: current.value ?? null,
        sourceUpdatedAt: current.updatedAt || current._updatedAt || null,
        backedUpAt: nowIso
      });
    }
  } catch (error) {
    console.warn("[Shared Data Backup] Backup skipped; continuing primary save.", error);
  }

  await setDoc(recordRef, { value, updatedAt: nowIso });
  return { success: true };
}

/**
 * 자가복구 전용: 서버에 문서가 없을 때만 원자적으로 만든다(create-only).
 *
 * 트랜잭션 안에서 서버 문서를 다시 읽어, 여전히 없을 때만 쓴다. 그 사이 다른 기기가 값을 올렸으면
 * 트랜잭션이 자동 재시도되며 이번엔 "값 있음"을 보고 아무것도 쓰지 않는다 → 남의 최신 값을 덮어쓸 수 없다.
 * (일반 저장 firebaseSaveSharedData는 last-write-wins 그대로 두고, 자가복구만 이 no-overwrite 계약을 쓴다.)
 * 오프라인이면 트랜잭션이 서버에 못 닿아 throw된다 — 호출부(healSharedIfServerMissing)가 건너뛴다.
 */
export async function firebaseCreateSharedDataIfMissing(dataKey: string, value: unknown) {
  await waitForFirebaseUser(); // 자가복구 쓰기도 인증이 준비된 뒤 실행해야 거부되지 않는다.
  const db = getDirectDb();
  const recordRef = doc(db, "shared_data", encodeURIComponent(dataKey));
  const nowIso = new Date().toISOString();
  const created = await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(recordRef);
    const existing = snapshot.exists() ? snapshot.data().value : undefined;
    // 이미 값이 있으면(빈 배열 [] 포함) 건드리지 않는다 — 의도적으로 비운 것도 덮지 않는다.
    if (existing !== null && existing !== undefined) return false;
    tx.set(recordRef, { value, updatedAt: nowIso });
    return true;
  });
  return { created };
}

/**
 * 배열형 공유데이터의 특정 항목을 **원자적으로** 조건부 갱신한다(compare-and-set).
 *
 * 트랜잭션 안에서 서버 문서를 다시 읽어 조건(expectStatus)을 확인하고, 맞을 때만 그 항목을 바꾼다.
 * 두 사람이 동시에 같은 항목을 선점하려 하면 하나만 성공한다 — 읽고-고치고-쓰는 방식으로는
 * 둘 다 통과해 카카오 등록이 이중 실행될 수 있어(비즈니스택시 승인), 그 경로는 반드시 이 함수를 쓴다.
 *
 * 반환 outcome: "updated"(내가 선점/갱신함) | "notFound"(항목 없음) | "conflict"(다른 상태 — 남이 먼저 처리)
 */
export async function firebaseUpdateSharedArrayItem(
  dataKey: string,
  itemId: string,
  expectStatus: string[],
  patch: Record<string, unknown>,
  /** 추가 조건 — 이 필드들이 모두 일치할 때만 갱신한다(예: 자기가 잡은 선점만 풀도록 claimedBy 확인). */
  expectMatch?: Record<string, unknown>
): Promise<{ outcome: "updated" | "notFound" | "conflict"; list: any[] }> {
  await waitForFirebaseUser();
  const db = getDirectDb();
  const recordRef = doc(db, "shared_data", encodeURIComponent(dataKey));
  const nowIso = new Date().toISOString();
  return await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(recordRef);
    const raw = snapshot.exists() ? snapshot.data().value : [];
    const list: any[] = Array.isArray(raw) ? raw : [];
    const index = list.findIndex((item) => item && item.id === itemId);
    if (index < 0) return { outcome: "notFound" as const, list };
    if (!expectStatus.includes(String(list[index].status))) return { outcome: "conflict" as const, list };
    if (expectMatch && !Object.entries(expectMatch).every(([k, v]) => list[index][k] === v)) {
      return { outcome: "conflict" as const, list };
    }
    const next = list.map((item, i) => (i === index ? { ...item, ...patch } : item));
    tx.set(recordRef, { value: next, updatedAt: nowIso });
    return { outcome: "updated" as const, list: next };
  });
}

/**
 * 배열형 공유데이터에 항목을 **원자적으로** 추가한다(중복 검사 포함).
 *
 * 읽고-고치고-쓰면 두 사람이 동시에 제출했을 때 나중 저장이 먼저 것을 통째로 덮어써 신청이 사라진다.
 * 트랜잭션 안에서 최신 배열을 다시 읽어 중복을 확인하고 이어붙이므로, 동시 제출도 둘 다 남는다.
 *
 * dedupeMatch: 이 필드들이 모두 같고 상태가 dedupeStatuses 에 속하는 항목이 있으면 중복으로 본다.
 * (함수는 트랜잭션에 넘길 수 없어 "필드 동등 비교" 형태로 조건을 받는다.)
 */
export async function firebaseAppendSharedArrayItem(
  dataKey: string,
  item: Record<string, unknown>,
  dedupe?: { match: Record<string, unknown>; statuses: string[] }
): Promise<{ outcome: "appended" | "duplicate"; list: any[] }> {
  await waitForFirebaseUser();
  const db = getDirectDb();
  const recordRef = doc(db, "shared_data", encodeURIComponent(dataKey));
  const nowIso = new Date().toISOString();
  return await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(recordRef);
    const raw = snapshot.exists() ? snapshot.data().value : [];
    const list: any[] = Array.isArray(raw) ? raw : [];
    if (dedupe) {
      const hit = list.some((existing) =>
        existing
        && dedupe.statuses.includes(String(existing.status))
        && Object.entries(dedupe.match).every(([k, v]) => existing[k] === v)
      );
      if (hit) return { outcome: "duplicate" as const, list };
    }
    const next = [item, ...list];
    tx.set(recordRef, { value: next, updatedAt: nowIso });
    return { outcome: "appended" as const, list: next };
  });
}

export async function firebaseGetAllManualOvertimes() {
  await waitForFirebaseUser(); // 인증 전 거부를 빈 목록으로 오해하지 않도록 로그인 복원을 기다린다.
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
  await waitForFirebaseUser(); // 인증 전 거부를 빈 목록으로 오해하지 않도록 로그인 복원을 기다린다.
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

// 파트타이머 근로계약서 양식(전 지점 공통 1개).
// 메타와 파일 본문을 나눠 저장한다 — 한 문서에 몰면 지점이 탭을 열 때마다,
// 버튼 하나 그리자고 1MB짜리 파일을 통째로 내려받게 된다.
const TEMPLATE_META_KEY = "labor_contract_template_parttime_meta";
// 파일은 업로드마다 새 fileId로 따로 저장한다. 한 키를 덮어쓰면 메타 쓰기가 실패했을 때
// "옛 파일명·옛 형식 정보로 새 파일 내용을 받는" 어긋난 상태가 된다.
const templateFileKey = (fileId: string) => `labor_contract_template_parttime_file_${fileId}`;

export async function firebaseGetLaborContractTemplateMeta() {
  return await firebaseGetSharedData(TEMPLATE_META_KEY);
}

export async function firebaseGetLaborContractTemplateFile(fileId: string) {
  if (!fileId) return null;
  const value = await firebaseGetSharedData(templateFileKey(fileId));
  return value ? (value as { dataBase64?: string }).dataBase64 ?? null : null;
}

export async function firebaseSaveLaborContractTemplate(meta: { fileId: string }, dataBase64: string) {
  // 새 fileId에 파일을 먼저 쓴다 — 기존 파일을 건드리지 않으므로, 아래 메타 쓰기가 실패해도
  // 지점은 옛 메타로 옛 파일을 그대로 받는다(어긋나지 않는다). 실패한 새 파일은 고아로 남을 뿐이다.
  // 메타 쓰기가 성공하는 순간에만 지점이 새 파일을 보게 된다 — 이 한 번의 쓰기가 곧 전환점이다.
  await firebaseSaveSharedData(templateFileKey(meta.fileId), { dataBase64 });
  await firebaseSaveSharedData(TEMPLATE_META_KEY, meta);
  return { success: true };
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
    // 개수만 필요하므로 문서를 전부 읽지 않고 count 집계를 쓴다(전체 스캔이 읽기 한도를 태우던 문제 수정).
    // count 집계는 1000건당 1 read 로 과금돼 전체 문서 읽기보다 훨씬 싸다.
    const [settleCount, settingCount] = await Promise.all([
      getCountFromServer(collection(db, "daily_settles")),
      getCountFromServer(collection(db, "settings"))
    ]);

    return {
      success: true,
      connected: true,
      projectId: firebaseConfig.projectId,
      totalSettles: settleCount.data().count,
      totalSettings: settingCount.data().count
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

async function upsertPublicBranchDirect(branchName: string, data: any, isAdminSession = false) {
  const role = data?.role || "branch";
  if (role !== "branch") return;

  const db = getDirectDb();
  const currentUser = getAuth(appInstance || getApp()).currentUser;
  // 전환기: 공유 관리자 PIN(admin@ugd-erp.example) 계정 || 개인 관리자 세션(role=admin).
  if (currentUser?.email !== "admin@ugd-erp.example" && !isAdminSession) {
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
export async function backupSettingDirect(branchName: string, data: any, isAdminSession = false) {
  if (!isFirebaseConfigValid()) return;
  try {
    const db = getDirectDb();
    const docRef = doc(db, "settings", branchName.trim());
    // [Codex P0 2026-07-27] 전달된 필드만 merge 로 쓴다. 예전엔 누락 필드를 기본값(brand "기타",
    // role "branch", pin_hash "")으로 채워 통째로 setDoc 덮어쓰기 했는데, 그러면 PIN만 바꾸는
    // updateBranchPin·활성만 바꾸는 toggleBranchActive 가 관리자 행 role 이나 기존 pin_hash 를 오염시킨다.
    const payload: Record<string, unknown> = {
      branch_name: branchName.trim(),
      _updatedAt: new Date().toISOString()
    };
    const pinHash = data?.pinHash ?? data?.pin_hash;
    if (pinHash) payload.pin_hash = pinHash;
    if (data?.brand !== undefined) payload.brand = data.brand;
    if (data?.role !== undefined) payload.role = data.role;
    if (data?.isActive !== undefined || data?.is_active !== undefined) {
      payload.is_active = data?.isActive !== false && data?.is_active !== false;
    }
    await setDoc(docRef, payload, { merge: true });
    await upsertPublicBranchDirect(branchName, data, isAdminSession);
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
export async function restoreDirectFromFirebase(isAdminSession = false) {
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
        await gasClient.addBranch(branchName, pinHash, brand, role, undefined, isAdminSession);
        await gasClient.toggleBranchActive(branchName, isActive, isAdminSession);
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
