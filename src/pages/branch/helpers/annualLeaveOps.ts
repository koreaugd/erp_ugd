// src/pages/branch/helpers/annualLeaveOps.ts
// 연차관리 화면(관리자 섹션·지점 탭)의 직원 지점이동/행삭제 공용 로직.
// 명부(branch_own_rosters)가 원본이고, 연차 데이터 3종(annual_leave / 부여 수동값 / 사용 보정값)이 직원을 따라간다.
//
// 원칙:
// · 모든 쓰기는 트랜잭션(mutate*)으로 한다 — 읽어둔 값 위에 통째로 저장하면 그 사이 다른 기기의
//   저장분이 사라진다(Codex 지적 2026-08-04).
// · 받는 지점부터 쓴다 — 중간에 실패하면 '중복'이 남지 '유실'이 나지 않는다. 중복 상태에서 재시도하면
//   각 단계가 no-op(재개)으로 처리되어 끝까지 완주한다.
// · 알려진 잔여 경쟁: 두 관리자가 같은 순간 같은 직원을 서로 다른 지점으로 옮기면 두 지점에 모두
//   추가될 수 있다(원본 제거는 한 번만 일어남). 화면에 중복으로 드러나며 행삭제로 정리 가능 — 수용.
import { gasClient } from "../../../api/gasClient";
import { ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX, ANNUAL_LEAVE_USED_ADJUST_PREFIX, LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX, mergeLegacyGrantOverrides } from "../../../utils/annualLeavePolicy";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// RosterTab의 recordStaffMovement와 같은 키·형태로 남긴다(관리자 이동기록 감사 흔적).
const recordMovement = async (fromBranch: string, type: string, employeeName: string, toBranch: string) => {
  await gasClient.mutateSharedData<any[]>(`staff_movements:${fromBranch}`, (current) => [{
    id: `movement-${Date.now()}`,
    type,
    employeeName,
    fromBranch,
    toBranch,
    effectiveDate: todayStr(),
    createdAt: new Date().toISOString()
  }, ...(Array.isArray(current) ? current : [])]);
};

/**
 * 보내는 지점에 남은 그 직원의 연차 데이터(사용기록·부여 수동값·사용 보정값)를 걷어낸다.
 * 각 단계가 "있을 때만 지우는" no-op 안전 형태라 몇 번을 다시 불러도 결과가 같다(중단된 이동의 재개에 쓴다).
 */
async function cleanupSourceLeaveData(fromBranch: string, employeeId: string, dropLegacyGrant = false): Promise<void> {
  await gasClient.mutateSharedData<any[]>(`annual_leave:${fromBranch}`, (current) => {
    const list = Array.isArray(current) ? current : [];
    return list.some((entry: any) => entry.employeeId === employeeId) ? list.filter((entry: any) => entry.employeeId !== employeeId) : null;
  });
  const dropKey = (current: Record<string, number> | null) => {
    if (!current || !(employeeId in current)) return null;
    const next = { ...current };
    delete next[employeeId];
    return next;
  };
  await gasClient.mutateSharedData<Record<string, number>>(`${ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX}${fromBranch}`, dropKey);
  await gasClient.mutateSharedData<Record<string, number>>(`${ANNUAL_LEAVE_USED_ADJUST_PREFIX}${fromBranch}`, dropKey);
  // 옛 키는 **실제로 값을 옮겼을 때만** 지운다. 안 지우면 그 직원이 나중에 이 지점으로 돌아왔을 때
  // 이미 옮겨 간 값이 되살아나 두 지점에서 서로 다른 부여일수가 보이기 때문이다.
  // 반대로 옮기지 않은 값(옛 기본값 15 등)까지 지우면, 화면에 쓰이지도 않는 데이터를 말없이 파괴하는 셈이라
  // 그대로 둔다(Codex 지적 2026-08-04).
  if (dropLegacyGrant) {
    await gasClient.mutateSharedData<Record<string, number>>(`${LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX}${fromBranch}`, dropKey);
  }
}

/**
 * 직원을 다른 지점 명부로 옮기고 연차 데이터(사용기록·부여 수동값·사용 보정값)를 함께 이동한다.
 *
 * @param allowedTargets 이 계정이 다룰 수 있는 지점("all"=총괄). **화면에서 드롭다운을 좁히는 것만으로는
 *   부족하다** — 저장을 부르는 경로가 화면 하나뿐이라는 보장이 없으므로, 실제로 쓰는 이 함수가 직접 막는다
 *   (Codex 지적 2026-08-04). 다만 이것도 브라우저 안의 방어라, 완전한 차단은 Firestore 규칙이 맡아야 한다.
 */
export async function moveAnnualLeaveEmployee(
  fromBranch: string,
  toBranch: string,
  employeeId: string,
  allowedTargets: string[] | "all"
): Promise<{ ok: boolean; message: string }> {
  if (!toBranch || fromBranch === toBranch) return { ok: false, message: "이동할 지점이 현재 지점과 같습니다." };
  if (allowedTargets !== "all") {
    const allowed = Array.isArray(allowedTargets) ? allowedTargets : [];
    if (!allowed.includes(toBranch)) return { ok: false, message: `[${toBranch}] 지점으로 옮길 권한이 없습니다. 담당 지점으로만 이동할 수 있습니다.` };
    if (!allowed.includes(fromBranch)) return { ok: false, message: `[${fromBranch}] 지점의 직원을 옮길 권한이 없습니다.` };
  }

  // ── 0) 원자적 선점(claim) ────────────────────────────────────────────────
  // 원본 행에 `movingTo`를 트랜잭션으로 찍어 **한 사람만** 이동을 시작하게 한다.
  // 이게 없으면 두 관리자가 같은 직원을 서로 다른 지점으로 동시에 옮길 때 양쪽 명부에 모두 복사된다(Codex 지적).
  // 같은 목적지로 다시 부르면 no-op이라 중단된 이동을 이어서 완주할 수 있다.
  const claim = await gasClient.mutateBranchOwnRoster(fromBranch, (roster) => {
    const found = roster.find((item: any) => item.id === employeeId);
    if (!found) return null;                                   // 원본에 없음 — 아래에서 재개 여부를 따진다
    if ((found as any).movingTo === toBranch) return null;      // 내가 이미 선점함(재시도) — 그대로 진행
    if ((found as any).movingTo) return null;                   // 다른 목적지로 선점됨 — 아래에서 막는다
    return roster.map((item: any) => item.id === employeeId ? { ...item, movingTo: toBranch } : item);
  });
  let target = claim.employees.find((item: any) => item.id === employeeId);

  if (target && (target as any).movingTo && (target as any).movingTo !== toBranch) {
    return { ok: false, message: `이 직원은 [${(target as any).movingTo}] 지점으로 이동이 진행되다 중단된 상태입니다.\n같은 지점으로 다시 이동해 마무리한 뒤 옮겨주세요.` };
  }

  if (!target) {
    // 원본에 없다 = ①이미 이동 완료 ②원본 삭제까지만 되고 뒷정리가 끊긴 상태.
    // 목적지에 있으면 ②로 보고 **뒷정리만** 이어서 끝낸다(예전엔 여기서 그냥 반환해 고아 데이터가 남았다).
    const toRoster = (await gasClient.getBranchOwnRosterFromServer(toBranch)) || [];
    const landed = toRoster.find((item: any) => item.id === employeeId);
    if (!landed) return { ok: false, message: "지점 명부에서 해당 직원을 찾지 못했습니다. 새로고침 후 다시 시도해주세요." };
    await cleanupSourceLeaveData(fromBranch, employeeId);
    return { ok: true, message: `[${landed.name}] 님은 이미 ${toBranch} 지점으로 옮겨져 있어, 남은 연차 데이터 정리만 마쳤습니다.` };
  }
  target = { ...target };
  delete (target as any).movingTo; // 목적지 명부에는 선점 표시를 남기지 않는다

  // 이동할 연차 데이터도 서버 기준으로 확정한다. 여기서 실패하면 아직 목적지를 쓰기 전 — 중단이 안전하다.
  // 부여 수동값은 **옛 키까지 합쳐서** 읽는다 — 화면은 옛 값을 승계해 보여주는데 이동은 새 키만 챙기면,
  // 옛 키에만 있던 예외값(예: 20일)이 옮기는 순간 사라진다(Codex 지적 2026-08-04).
  const [fromEntries, fromGrants, fromLegacyGrants, fromAdjust] = await Promise.all([
    gasClient.getSharedDataFromServer<any[]>(`annual_leave:${fromBranch}`),
    gasClient.getSharedDataFromServer<Record<string, number>>(`${ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX}${fromBranch}`),
    gasClient.getSharedDataFromServer<Record<string, number>>(`${LEGACY_ANNUAL_LEAVE_GRANTS_PREFIX}${fromBranch}`),
    gasClient.getSharedDataFromServer<Record<string, number>>(`${ANNUAL_LEAVE_USED_ADJUST_PREFIX}${fromBranch}`)
  ]);
  const movingEntries = (fromEntries || []).filter((entry: any) => entry.employeeId === employeeId).map((entry: any) => ({ ...entry, branchName: toBranch }));
  // 합친 값을 **새 키로** 옮긴다 — 옛 키는 보내는 지점에서 정리되고 목적지에는 새 키만 남는다.
  const grantValue = mergeLegacyGrantOverrides(fromLegacyGrants, fromGrants)[employeeId];
  const adjustValue = (fromAdjust || {})[employeeId];
  const moved = { ...target, fromBranch, transferDate: todayStr(), addReason: "지점이동" };

  // 1) 받는 지점부터 — 입사일(entryDate)은 그대로 두어 근속·부여일수 계산이 끊기지 않는다. 이동 흔적만 남긴다.
  //    이미 있으면(이전 시도가 중간에 끊긴 재개) 추가는 건너뛰고, 받는 지점의 '나감' 표시만 풀고 이어서 진행한다.
  await gasClient.addToBranchOwnRoster(toBranch, moved);
  if (movingEntries.length) {
    await gasClient.mutateSharedData<any[]>(`annual_leave:${toBranch}`, (current) => {
      const list = Array.isArray(current) ? current : [];
      const existingIds = new Set(list.map((entry: any) => entry.id));
      const fresh = movingEntries.filter((entry: any) => !existingIds.has(entry.id));
      return fresh.length ? [...fresh, ...list] : null; // 재시도 시 이미 복사된 기록은 다시 쌓지 않는다
    });
  }
  if (grantValue !== undefined) {
    await gasClient.mutateSharedData<Record<string, number>>(`${ANNUAL_LEAVE_GRANT_OVERRIDES_PREFIX}${toBranch}`, (current) =>
      (current || {})[employeeId] === grantValue ? null : { ...(current || {}), [employeeId]: grantValue });
  }
  if (adjustValue !== undefined) {
    await gasClient.mutateSharedData<Record<string, number>>(`${ANNUAL_LEAVE_USED_ADJUST_PREFIX}${toBranch}`, (current) =>
      (current || {})[employeeId] === adjustValue ? null : { ...(current || {}), [employeeId]: adjustValue });
  }

  // 2) 보내는 지점 정리 — 명부 행(선점 표시 포함)을 지우고 연차 데이터를 걷어낸다.
  //    각 단계가 "있을 때만 지우는" no-op 안전 형태라 재시도에도 안전하다.
  // '방금 나감' 표시를 함께 남긴다 — 직원 명단 탭 등이 낡은 목록을 통째로 저장해도 이 직원은 되살아나지 않는다.
  await gasClient.removeFromBranchOwnRoster(fromBranch, employeeId);
  // 옛 키 정리는 그 값을 실제로 목적지로 옮겼을 때만(grantValue 가 있을 때만) 한다.
  await cleanupSourceLeaveData(fromBranch, employeeId, grantValue !== undefined);

  // 3) 이동 기록 — 기록 실패가 이동 자체를 되돌리지는 않는다.
  try { await recordMovement(fromBranch, "지점이동", target.name || "-", toBranch); } catch (err) { console.warn("지점이동 기록 저장 실패", err); }
  return { ok: true, message: `[${target.name}] 님을 ${fromBranch} → ${toBranch} 지점으로 이동했습니다.` };
}

/**
 * 직원 행을 지점 명부에서 삭제한다. 연차 사용기록 등 데이터는 지우지 않는다 —
 * 명부에서 빠지면 화면에는 안 보이고, 같은 직원을 되살리면 기록도 다시 이어진다(비파괴 원칙).
 */
export async function deleteAnnualLeaveEmployee(branchName: string, employeeId: string): Promise<{ ok: boolean; message: string }> {
  const roster = (await gasClient.getBranchOwnRosterFromServer(branchName)) || [];
  const target = roster.find((item: any) => item.id === employeeId);
  if (!target) return { ok: false, message: "지점 명부에서 해당 직원을 찾지 못했습니다. 새로고침 후 다시 시도해주세요." };
  // 삭제도 '방금 나감' 표시를 남긴다 — 다른 화면의 낡은 통째 저장이 지운 직원을 되살리지 못하게.
  await gasClient.removeFromBranchOwnRoster(branchName, employeeId);
  try { await recordMovement(branchName, "삭제(연차관리)", target.name || "-", "-"); } catch (err) { console.warn("삭제 기록 저장 실패", err); }
  return { ok: true, message: `[${target.name}] 님을 ${branchName} 명부에서 삭제했습니다.` };
}
