// src/pages/admin/helpers/closedBranches.ts
// 휴업 지점 — 관리자 화면에서 감춘다. **기록은 지우지 않는다.**
//
// [왜 목록을 여기 한 곳에 두나]
// 화면마다 `if (지점명 !== "오키스테이크하우스")` 를 적으면 반드시 빠뜨리는 곳이 생긴다.
// 실제로 '본사'를 월말업무에서 빼는 규칙(MONTHLY_WORK_EXEMPT_BRANCHES)도 표에서만 숨겼다가
// 미제출 카운트·배치 다운로드·드롭다운에 그대로 남아 다시 손봤던 적이 있다.
// 그래서 **지점 목록을 읽는 자리마다 같은 함수를 통과**시키고, 목록은 여기서만 고친다.
//
// [무엇을 감추고 무엇을 남기나]
// · 감춘다 — 지점 선택 드롭다운, 제출/미제출 점검, 미작성 지점, 근로계약서·현금관리 등
//            "지금 운영 중인 지점"을 대상으로 도는 화면.
// · 남긴다 — 서버에 저장된 과거 기록 자체. 삭제하지 않으므로 목록에서 이름만 빼면
//            언제든 다시 보이게 되돌릴 수 있다(아래 배열에서 지우면 끝).
//
// [지점 화면에는 걸지 않는다] 이 필터는 관리자 화면 전용이다. 지점 로그인·지점 화면은
// gasClient.getBranchList() 를 그대로 쓰므로, 휴업 지점이 다시 영업해도 로그인은 막히지 않는다.

import { gasClient } from "../../../api/gasClient";

/** 휴업 중이라 관리자 화면에서 감추는 지점. 영업을 재개하면 이 줄에서 이름만 빼면 된다. */
export const CLOSED_BRANCHES: string[] = [
  "오키스테이크하우스", // 휴업 (2026-08-03 사용자 지시)
];

/** 이 이름이 휴업 지점인가. 공백이 섞여 들어오는 데이터가 있어 trim 해서 본다. */
export function isClosedBranch(branchName: unknown): boolean {
  return CLOSED_BRANCHES.includes(String(branchName || "").trim());
}

/** 지점명이 담긴 아무 목록에서나 휴업 지점을 걸러낸다(매출 행·이상치·마감 기록 등 공용). */
export function withoutClosedBranches<T>(rows: T[], pick: (row: T) => unknown): T[] {
  return rows.filter((row) => !isClosedBranch(pick(row)));
}

/**
 * 관리자 화면에서 쓰는 지점 목록. `gasClient.getBranchList()` 대신 **항상 이걸 쓴다.**
 * 휴업 지점만 걷어내고 나머지(본사 포함)는 그대로 둔다 — '본사'를 빼는 것은
 * 월말업무 전용 규칙이라 그쪽(isMonthlyWorkBranch)이 따로 맡는다.
 */
export async function getAdminBranchList(): Promise<any[]> {
  const list = await gasClient.getBranchList();
  return (Array.isArray(list) ? list : []).filter((b: any) => !isClosedBranch(b?.branchName));
}
