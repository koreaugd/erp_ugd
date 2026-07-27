// src/pages/admin/AccountManagementSection.tsx
// 관리자 > 인사 > 계정 관리 — 개인 계정(users/{uid})의 역할·탭·지점 권한·상태를 관리한다.
//
// 이 컬렉션은 firestore.rules에서 개인 관리자(loginType "personal")만 읽고 쓸 수 있다(isPersonalAdmin()).
// PIN 관리자(admin@ugd-erp.example)는 규칙에서 의도적으로 배제돼 있어 목록 조회 자체가 permission-denied로
// 거부된다 — 그래서 로드를 시도하기 전에 currentUid(개인 계정일 때만 전달됨)로 걸러 안내만 보여준다.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import LoadingSpinner from "../../components/LoadingSpinner";
import { listUserProfiles, updateUserProfile, type UserProfile } from "../../api/userProfile";
import { getFirebaseLoginBranches, type LoginBranch } from "../../api/firebaseAuth";
import { type PermKey } from "../branch/tabRegistry";
import { ADMIN_TAB_KEYS, ADMIN_TAB_LABELS, ADMIN_SENSITIVE_TAB_KEYS, type AdminPermKey } from "./adminTabRegistry";

// registry에는 라벨이 없다(지점 화면 내비게이션 좌표만 들고 있음) — 계정 관리 화면 전용 한글 라벨.
const TAB_LABELS: Record<PermKey, string> = {
  "dashboard": "대시보드",
  "daily.settle": "일일마감정산",
  "daily.orders": "발주관리",
  "daily.liquorInventory": "주류 재고",
  "daily.officeWorkLog": "근무내역",
  "daily.overtimeLog": "초과근무일지",
  "daily.partTimeLog": "파트타이머일지",
  "daily.roster": "직원현황",
  "monthly.fullTimeSalary": "정직원 급여대장",
  "monthly.purchaseSales": "매입매출",
  "monthly.partTimeSalary": "파트타이머 급여대장",
  "monthly.cashManagement": "현금관리",
  "monthly.cashExpenses": "현금지출",
  "monthly.cardExpenses": "카드지출",
  "laborContract": "근로계약서",
  "businessTaxi": "비즈니스택시",
  "annualLeave": "연차관리",
};
// 지점 사이드바와 같은 묶음으로 그룹화 — 그룹 단위 전체선택을 지원한다(사용자 요청 2026-07-25).
const TAB_GROUPS: Array<{ label: string; keys: PermKey[] }> = [
  { label: "메인", keys: ["dashboard"] },
  { label: "일일 업무", keys: ["daily.settle", "daily.orders", "daily.liquorInventory", "daily.officeWorkLog", "daily.overtimeLog", "daily.partTimeLog", "daily.roster"] },
  { label: "월말 업무", keys: ["monthly.fullTimeSalary", "monthly.purchaseSales", "monthly.partTimeSalary", "monthly.cashManagement", "monthly.cashExpenses", "monthly.cardExpenses"] },
  { label: "인사 · 기타", keys: ["laborContract", "businessTaxi", "annualLeave"] },
];

const ROLE_LABEL: Record<UserProfile["role"], string> = { admin: "관리자", branch: "지점" };
const STATUS_LABEL: Record<UserProfile["status"], string> = { active: "사용중", suspended: "정지" };

type EditState = {
  role: UserProfile["role"];
  status: UserProfile["status"];
  allowedTabs: string[] | "all";
  allowedBranches: string[] | "all";
  allowedAdminTabs: string[] | "all";
};

function summarizeTabs(allowedTabs: string[] | "all"): string {
  return allowedTabs === "all" ? "전체" : `${allowedTabs.length}개`;
}
function summarizeBranches(allowedBranches: string[] | "all"): string {
  return allowedBranches === "all" ? "전체" : `${allowedBranches.length}개`;
}
function summarizeAdminTabs(allowedAdminTabs: string[] | "all" | undefined): string {
  return allowedAdminTabs === undefined || allowedAdminTabs === "all" ? "전체" : `${allowedAdminTabs.length}개`;
}
function formatDate(iso: unknown): string {
  return typeof iso === "string" ? iso.slice(0, 10) : "-";
}

export function AccountManagementSection({ currentUid }: { currentUid?: string }) {
  // currentUid가 없다는 것은 "개인 관리자 세션이 아니다"의 신호다(AdminPage가 그렇게 넘긴다).
  // PIN 관리자는 users 컬렉션 읽기 권한이 없어 listUserProfiles()를 부르면 permission-denied로 실패하므로,
  // 아예 시도하지 않고 안내만 보여준다.
  const isPersonalAdminSession = !!currentUid;

  const [profiles, setProfiles] = useState<UserProfile[] | null>(null);
  const [branches, setBranches] = useState<LoginBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmingUid, setConfirmingUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPersonalAdminSession) return;
    setLoading(true);
    setLoadError("");
    try {
      const [profileList, branchList] = await Promise.all([listUserProfiles(), getFirebaseLoginBranches()]);
      setProfiles(profileList);
      setBranches(branchList);
    } catch (e) {
      console.error("계정 목록 로드 실패:", e);
      setLoadError("계정 목록을 불러오지 못했습니다. 네트워크 확인 후 새로고침해주세요.");
      setProfiles(null);
    } finally {
      setLoading(false);
    }
  }, [isPersonalAdminSession]);

  useEffect(() => { void load(); }, [load]);

  const newSignups = (profiles || []).filter((p) => !p.reviewedByAdmin).length;

  const startEdit = (profile: UserProfile) => {
    setSaveError("");
    setEditingUid(profile.uid);
    if (profile.uid === currentUid) {
      // 본인 문서는 규칙상 관리자라도 수정 불가(firestore.rules) — 폼은 만들지 않고 안내만 보여준다.
      setEdit(null);
      return;
    }
    setEdit({
      role: profile.role,
      status: profile.status,
      allowedTabs: profile.allowedTabs === "all" ? "all" : [...profile.allowedTabs],
      allowedBranches: profile.allowedBranches === "all" ? "all" : [...profile.allowedBranches],
      allowedAdminTabs: profile.allowedAdminTabs === undefined || profile.allowedAdminTabs === "all" ? "all" : [...profile.allowedAdminTabs],
    });
  };

  const cancelEdit = () => { setEditingUid(null); setEdit(null); setSaveError(""); };

  const toggleTab = (key: PermKey) => {
    if (!edit || edit.allowedTabs === "all") return;
    const has = edit.allowedTabs.includes(key);
    setEdit({ ...edit, allowedTabs: has ? edit.allowedTabs.filter((k) => k !== key) : [...edit.allowedTabs, key] });
  };
  const toggleAllTabs = (checked: boolean) => {
    if (!edit) return;
    setEdit({ ...edit, allowedTabs: checked ? "all" : [] });
  };
  // 그룹 단위 전체선택: 체크 시 그룹 키 전부 추가(합집합), 해제 시 그룹 키만 제거.
  const toggleTabGroup = (keys: PermKey[], checked: boolean) => {
    if (!edit || edit.allowedTabs === "all") return;
    const current = edit.allowedTabs;
    const next = checked
      ? [...current, ...keys.filter((k) => !current.includes(k))]
      : current.filter((k) => !keys.includes(k as PermKey));
    setEdit({ ...edit, allowedTabs: next });
  };
  const toggleAdminTab = (key: AdminPermKey) => {
    if (!edit || edit.allowedAdminTabs === "all") return;
    const has = edit.allowedAdminTabs.includes(key);
    setEdit({ ...edit, allowedAdminTabs: has ? edit.allowedAdminTabs.filter((k) => k !== key) : [...edit.allowedAdminTabs, key] });
  };
  const toggleAllAdminTabs = (checked: boolean) => {
    if (!edit) return;
    setEdit({ ...edit, allowedAdminTabs: checked ? "all" : [] });
  };
  const toggleBranch = (branchName: string) => {
    if (!edit || edit.allowedBranches === "all") return;
    const has = edit.allowedBranches.includes(branchName);
    setEdit({ ...edit, allowedBranches: has ? edit.allowedBranches.filter((b) => b !== branchName) : [...edit.allowedBranches, branchName] });
  };
  const toggleAllBranches = (checked: boolean) => {
    if (!edit) return;
    setEdit({ ...edit, allowedBranches: checked ? "all" : [] });
  };

  const save = async () => {
    if (!editingUid || !edit || saving) return;   // saving 가드 — 삭제와 동시 실행 방지
    setSaving(true);
    setSaveError("");
    try {
      await updateUserProfile(editingUid, edit);
      const patch = edit;
      setProfiles((prev) => prev && prev.map((p) => (p.uid === editingUid ? { ...p, ...patch } : p)));
      cancelEdit();
    } catch (e) {
      console.error("계정 수정 실패:", e);
      setSaveError("저장하지 못했습니다. 권한이 없거나 네트워크 문제일 수 있습니다.");
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async () => {
    if (!editingUid || !edit || saving || confirmingUid !== null) return;   // 확인 처리 진행 중 삭제 금지
    const target = (profiles || []).find((p) => p.uid === editingUid);
    const ok = window.confirm(
      `'${target?.name || "이 계정"}'을(를) 삭제할까요?\n\n` +
      "삭제는 계정 기록 초기화입니다 — 이 사용자가 다시 로그인하면 신규 계정으로 재가입됩니다.\n" +
      "접근을 막으려는 목적이라면 삭제 대신 상태를 '정지'로 바꾸세요."
    );
    if (!ok) return;
    setSaving(true);
    setSaveError("");
    try {
      const { deleteUserProfile } = await import("../../api/userProfile");
      await deleteUserProfile(editingUid);
      setProfiles((prev) => prev && prev.filter((p) => p.uid !== editingUid));
      cancelEdit();
    } catch (e) {
      console.error("계정 삭제 실패:", e);
      setSaveError("삭제하지 못했습니다. 권한이 없거나 네트워크 문제일 수 있습니다.");
    } finally {
      setSaving(false);
    }
  };

  const markReviewed = async (uid: string) => {
    setConfirmingUid(uid);
    try {
      // 승인은 권한 편집 상태와 원자적으로 저장한다 — 관리자가 조정한 지점·탭 제한이 승인과 함께 반영되도록.
      // 승인만 따로 저장하면 신규 기본값(all 탭/all 지점)이 그대로 남아 의도보다 넓은 권한이 부여된다(Codex 지적 2026-07-27).
      // 편집을 안 건드렸으면 edit은 startEdit이 로드한 현재값(신규=all)이라 정책(신규 전체 허용, 이후 제한)과 일치한다.
      const patch = (uid === editingUid && edit) ? { ...edit, reviewedByAdmin: true } : { reviewedByAdmin: true };
      await updateUserProfile(uid, patch);
      setProfiles((prev) => prev && prev.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
      if (uid === editingUid) cancelEdit();
    } catch (e) {
      console.error("확인 처리 실패:", e);
      window.alert("확인 처리에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.");
    } finally {
      setConfirmingUid(null);
    }
  };

  if (!isPersonalAdminSession) {
    return (
      <section className="space-y-5 animate-fade-in">
        {/* 새 관리자 탭 제목은 바닐라 알약(DESIGN.md §6-4, 분석 탭과 동일) */}
        <h2 className="admin-pill-title">계정 관리</h2>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>개인 관리자 계정 전용 화면입니다. 개인 계정으로 로그인해 주세요.</span>
        </div>
      </section>
    );
  }

  const editingProfile = (profiles || []).find((p) => p.uid === editingUid) || null;

  return (
    <section className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          {/* 새 관리자 탭 제목은 바닐라 알약(DESIGN.md §6-4, 분석 탭과 동일) */}
          <h2 className="admin-pill-title">계정 관리</h2>
          <p className="text-[11px] font-semibold text-zinc-400">
            개인 계정 가입자의 역할·허용 탭·허용 지점·상태를 관리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {newSignups > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#212121] bg-[var(--admin-vanilla)] px-3 py-1.5 text-[11px] font-black text-[#212121]">
              신규 {newSignups}건
            </span>
          )}
          <button onClick={() => void load()} disabled={loading}
            className="p-2 px-3 rounded-xl border border-gray-200 text-xs font-black cursor-pointer disabled:opacity-40">
            {loading ? "확인 중..." : "새로고침"}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-[#C93A3A] bg-[#FDE2E2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{loadError}</div>
      )}

      {/* 카드=검정 1px 테두리, 헤더 라벨=엘리스 배경+100% 검정 11px 볼드(DESIGN.md §4·§9-1 — text-gray-*는 흐려져 금지) */}
      {loading ? <LoadingSpinner /> : profiles === null ? null : (
        <div className="bg-white rounded-2xl border border-[#212121] overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-[var(--admin-alice)]">
              <tr className="text-[11px] font-black text-[#212121]">
                <th className="px-4 py-3 text-left">이름</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-left">역할</th>
                <th className="px-4 py-3 text-left">허용 탭</th>
                <th className="px-4 py-3 text-left">허용 지점</th>
                <th className="px-4 py-3 text-left">상태</th>
                <th className="px-4 py-3 text-left">가입일</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profiles.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-16 text-center text-gray-400">등록된 개인 계정이 없습니다.</td></tr>
              ) : profiles.map((p) => {
                const isSelf = p.uid === currentUid;
                const isEditingRow = p.uid === editingUid;
                return (
                  <tr key={p.uid}
                    onClick={() => startEdit(p)}
                    className={`hover:bg-gray-50/60 cursor-pointer ${isEditingRow ? "bg-[var(--admin-alice)]/40" : ""}`}
                  >
                    <td className="px-4 py-3 font-bold whitespace-nowrap">
                      {String(p.name || "")}
                      {!p.reviewedByAdmin && <span className="ml-1.5 inline-block rounded-full border border-[#212121] bg-[var(--admin-vanilla)] px-1.5 py-0.5 text-[9px] font-black">신규</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{String(p.email || "")}</td>
                    <td className="px-4 py-3">{ROLE_LABEL[p.role]}</td>
                    <td className="px-4 py-3">
                      {summarizeTabs(p.allowedTabs)}
                      {p.role === "admin" && (
                        <span className="block text-[10px] font-bold text-zinc-400 mt-0.5">관리자탭: {summarizeAdminTabs(p.allowedAdminTabs)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{summarizeBranches(p.allowedBranches)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full border border-[#212121] px-2 py-0.5 text-[10px] font-black ${p.status === "active" ? "bg-[var(--admin-honey)]" : "bg-white"}`}>
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {isSelf ? (
                        <span className="text-[10px] font-bold text-zinc-400">본인 계정</span>
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-300 ml-auto" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingUid && editingProfile && (
        editingProfile.uid === currentUid ? (
          <div className="rounded-2xl border border-[#212121] bg-white p-5 text-xs font-bold text-zinc-500">
            본인 계정은 다른 관리자 또는 Firebase 콘솔에서 수정해주세요.
          </div>
        ) : edit && (
          <div className="rounded-2xl border border-[#212121] bg-white p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-black text-[#212121]">{editingProfile.name} ({editingProfile.email})</h4>
              <button onClick={cancelEdit} className="text-[11px] font-black text-zinc-400 cursor-pointer">닫기</button>
            </div>

            {/* 가입 시 받은 연락처·근무지점 — 관리자가 누구를 승인하는지 확인하는 근거(2026-07-27). */}
            <p className="text-[11px] font-bold text-zinc-500">
              근무지점: {editingProfile.workBranch || "-"} · 연락처: {editingProfile.phone || "-"}
            </p>

            {!editingProfile.reviewedByAdmin && (
              <div className="rounded-xl border border-gray-200 bg-[var(--admin-ghost)] px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold text-zinc-600">신규 가입 미확인 상태입니다.</span>
                <div className="flex items-center gap-2">
                  {/* 낯선 가입자를 확인 단계에서 바로 거부하는 동선(사용자 요청 2026-07-25) — 하단 삭제 버튼과 같은 핸들러 */}
                  <button onClick={() => void removeAccount()} disabled={saving || confirmingUid === editingProfile.uid}
                    className="px-3 py-1.5 rounded-xl border border-[#C93A3A] text-[#B91C1C] text-[11px] font-black cursor-pointer disabled:opacity-40">
                    계정 삭제
                  </button>
                  <button onClick={() => void markReviewed(editingProfile.uid)} disabled={saving || confirmingUid === editingProfile.uid}
                    className="px-3 py-1.5 rounded-xl border border-[#212121] text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-40">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {confirmingUid === editingProfile.uid ? "처리 중..." : "확인 처리"}
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="block text-[11px] font-black text-gray-700">역할</span>
                <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as UserProfile["role"] })}
                  className="w-full p-2 px-3 border border-gray-200 rounded-xl text-xs font-bold">
                  <option value="branch">지점</option>
                  <option value="admin">관리자</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="block text-[11px] font-black text-gray-700">상태</span>
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as UserProfile["status"] })}
                  className="w-full p-2 px-3 border border-gray-200 rounded-xl text-xs font-bold">
                  <option value="active">사용중</option>
                  <option value="suspended">정지</option>
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[11px] font-black text-gray-700 cursor-pointer">
                <input type="checkbox" checked={edit.allowedTabs === "all"} onChange={(e) => toggleAllTabs(e.target.checked)} />
                전체 허용
              </label>
              <div className="space-y-2.5">
                {TAB_GROUPS.map((group) => {
                  const groupAll = edit.allowedTabs === "all" || group.keys.every((k) => (edit.allowedTabs as string[]).includes(k));
                  return (
                    <div key={group.label} className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5 space-y-1.5">
                      <label className={`flex items-center gap-2 text-[11px] font-black ${edit.allowedTabs === "all" ? "text-zinc-300" : "text-gray-700 cursor-pointer"}`}>
                        <input type="checkbox"
                          checked={groupAll}
                          disabled={edit.allowedTabs === "all"}
                          onChange={(e) => toggleTabGroup(group.keys, e.target.checked)}
                        />
                        {group.label} 전체
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pl-5">
                        {group.keys.map((key) => (
                          <label key={key} className={`flex items-center gap-1.5 text-[11px] font-bold ${edit.allowedTabs === "all" ? "text-zinc-300" : "text-gray-600 cursor-pointer"}`}>
                            <input type="checkbox"
                              checked={edit.allowedTabs === "all" || edit.allowedTabs.includes(key)}
                              disabled={edit.allowedTabs === "all"}
                              onChange={() => toggleTab(key)}
                            />
                            {TAB_LABELS[key]}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {edit.role === "admin" && (
              <div className="space-y-2">
                <span className="block text-[11px] font-black text-gray-700">관리자 화면 탭</span>
                <label className="flex items-center gap-2 text-[11px] font-black text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={edit.allowedAdminTabs === "all"} onChange={(e) => toggleAllAdminTabs(e.target.checked)} />
                  전체 허용
                </label>
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {ADMIN_TAB_KEYS.map((key) => (
                      <label key={key} className={`flex items-center gap-1.5 text-[11px] font-bold ${edit.allowedAdminTabs === "all" ? "text-zinc-300" : "text-gray-600 cursor-pointer"}`}>
                        <input type="checkbox"
                          checked={edit.allowedAdminTabs === "all" || edit.allowedAdminTabs.includes(key)}
                          disabled={edit.allowedAdminTabs === "all"}
                          onChange={() => toggleAdminTab(key)}
                        />
                        {ADMIN_TAB_LABELS[key]}
                        {/* --branch-* 토큰은 관리자 화면에서 색이 뒤집히는 함정이 있어(erp_salary_change_history_tab
                            교훈) 관리자 배지 팔레트(amber)를 그대로 쓴다. */}
                        {ADMIN_SENSITIVE_TAB_KEYS.includes(key) && (
                          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700">개인정보</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[11px] font-black text-gray-700 cursor-pointer">
                <input type="checkbox" checked={edit.allowedBranches === "all"} onChange={(e) => toggleAllBranches(e.target.checked)} />
                전체 지점
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {branches.map((b) => (
                  <label key={b.branchId} className={`flex items-center gap-1.5 text-[11px] font-bold ${edit.allowedBranches === "all" ? "text-zinc-300" : "text-gray-600 cursor-pointer"}`}>
                    <input type="checkbox"
                      checked={edit.allowedBranches === "all" || edit.allowedBranches.includes(b.branchName)}
                      disabled={edit.allowedBranches === "all"}
                      onChange={() => toggleBranch(b.branchName)}
                    />
                    {b.branchName}
                  </label>
                ))}
              </div>
            </div>

            {saveError && (
              <div className="rounded-xl border border-[#C93A3A] bg-[#FDE2E2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{saveError}</div>
            )}

            <div className="flex items-center justify-between gap-2">
              {/* 삭제 = 계정 기록 초기화. Auth 계정은 남아 재로그인 시 신규 기본값으로 재가입된다 —
                  접근 차단이 목적이면 삭제가 아니라 상태 "정지"를 써야 한다(버튼 확인창에도 명시). */}
              <button onClick={() => void removeAccount()} disabled={saving || confirmingUid !== null}
                className="p-2 px-4 rounded-xl border border-[#C93A3A] text-[#B91C1C] text-[11px] font-black cursor-pointer disabled:opacity-40">
                {saving ? "처리 중..." : "계정 삭제"}
              </button>
              <div className="flex gap-2">
                <button onClick={cancelEdit} disabled={saving}
                  className="p-2 px-4 rounded-xl border border-gray-200 text-xs font-black cursor-pointer disabled:opacity-40">
                  취소
                </button>
                <button onClick={() => void save()} disabled={saving}
                  className="p-2 px-4 rounded-xl bg-[#212121] text-white text-xs font-black cursor-pointer disabled:opacity-40">
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </section>
  );
}
