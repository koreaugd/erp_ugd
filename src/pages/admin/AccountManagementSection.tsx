// src/pages/admin/AccountManagementSection.tsx
// 관리자 > 인사 > 계정 관리 — 개인 계정(users/{uid})의 역할·탭·지점 권한·상태를 관리한다.
//
// 이 컬렉션은 firestore.rules에서 개인 관리자(loginType "personal")만 읽고 쓸 수 있다(isPersonalAdmin()).
// PIN 관리자(admin@ugd-erp.example)는 규칙에서 의도적으로 배제돼 있어 목록 조회 자체가 permission-denied로
// 거부된다 — 그래서 로드를 시도하기 전에 currentUid(개인 계정일 때만 전달됨)로 걸러 안내만 보여준다.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import LoadingSpinner from "../../components/LoadingSpinner";
import { listUserProfiles, updateUserProfile, withEncodedBranchLists, type UserProfile } from "../../api/userProfile";
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

// 화면에 보이는 이름만 바꾼 것이다 — 내부 값 "admin"은 규칙·세션·기존 문서가 모두 쓰고 있어 절대 바꾸지 않는다(설계서 §15.1).
// 역할 드롭다운 순서 — 권한이 낮은 것부터.
const ROLE_OPTIONS: Array<{ value: UserProfile["role"]; label: string; hint: string }> = [
  { value: "branch", label: "지점", hint: "지점 업무만. 급여대장은 볼 수 없습니다." },
  { value: "branchAdmin", label: "지점관리자", hint: "허용된 지점의 급여대장을 보고 작성할 수 있습니다." },
  { value: "admin", label: "총괄관리자", hint: "관리자 화면 + 전 지점 급여대장." },
];

// 권한 있는 역할은 색으로 구분한다(사용자 지시 2026-07-30) — 목록을 훑을 때 누가 관리자인지 바로 보이게.
// 색은 DESIGN_ADMIN.md 토큰만 쓴다: 바닐라=주의(최고 권한), 허니듀=긍정·보조(지점관리자), 지점=기본 흰색.
// 표 헤더가 엘리스블루라 그 색은 쓰지 않는다(헤더와 섞여 구분이 안 된다).
const ROLE_SELECT_STYLE: Record<UserProfile["role"], string> = {
  admin: "border-[#212121] bg-[var(--admin-vanilla)] font-black",
  branchAdmin: "border-[#212121] bg-[var(--admin-honey)] font-black",
  branch: "border-gray-200 bg-white font-bold",
};
const STATUS_LABEL: Record<UserProfile["status"], string> = { active: "사용중", suspended: "정지" };

type EditState = {
  // 이름·연락처는 가입자가 잘못 적어도 본인이 고칠 수 없다(온보딩 1회 입력) — 관리자가 여기서 정정한다(2026-07-29).
  name: string;
  phone: string;
  role: UserProfile["role"];
  status: UserProfile["status"];
  allowedTabs: string[] | "all";
  allowedBranches: string[] | "all";
  allowedAdminTabs: string[] | "all";
  // 정직원 급여대장 열람 허용 지점. "all"=총관리자(전 지점), []=열람 불가(기본).
  salaryBranches: string[] | "all";
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
  // 상세 패널을 연 시점의 스냅샷 — 저장할 때 이 값과 다른 필드만 보낸다.
  // 전체를 통째로 보내면, 패널을 열어 둔 사이 다른 관리자가 행에서 바꾼 역할·상태·지점이
  // 옛 스냅샷으로 되돌아간다(Codex 지적 2026-07-29).
  const [editBaseline, setEditBaseline] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmingUid, setConfirmingUid] = useState<string | null>(null);
  // 기존 계정 허용지점 일괄 축소 패널(2026-07-28 전환 작업)
  const [scopePanelOpen, setScopePanelOpen] = useState(false);
  const [scopeRunning, setScopeRunning] = useState(false);
  const [scopeResult, setScopeResult] = useState<{ done: number; failed: string[] } | null>(null);
  // 아래 목록 인라인 편집·인덱스 복구·지점 필터용 상태.
  // ⚠ 훅은 전부 여기(조기 return 위)에 모아 둔다 — 아래쪽 `if (!isPersonalAdminSession) return`보다 뒤에 두면
  //   PIN 관리자↔개인 관리자로 세션이 바뀔 때 렌더마다 훅 개수가 달라져 React가 터진다.
  const [rowSavingUid, setRowSavingUid] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ uid: string; message: string } | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [branchFilter, setBranchFilter] = useState<string>("");
  // '전체 지점 펼치기'는 저장 전에 지점 목록을 다시 받아오는 구간이 있어, 그 사이 두 번째 클릭이 들어올 수 있다.
  // 상태 갱신은 즉시 반영되지 않으므로(같은 tick의 두 클릭이 둘 다 통과) 판정은 ref로, 버튼 비활성화는 state로 한다.
  const expandingRef = useRef(false);
  const [expandingUid, setExpandingUid] = useState<string | null>(null);
  // 비밀번호 재설정 메일 전송 상태(2026-07-29). Spark 요금제라 관리자가 남의 비밀번호를 직접 정할 수 없어
  // 본인 메일로 재설정 링크를 보내는 방식만 가능하다.
  const [resetSendingUid, setResetSendingUid] = useState<string | null>(null);
  const [resetSentUid, setResetSentUid] = useState<string | null>(null);
  // 상세 패널은 표 아래에 붙는다 — 행을 클릭하면 패널까지 자동으로 스크롤한다(2026-07-29, 사용자 요청).
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!editingUid) return;
    detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editingUid]);

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
    const snapshot: EditState = {
      name: String(profile.name || ""),
      phone: String(profile.phone || ""),
      role: profile.role,
      status: profile.status,
      allowedTabs: profile.allowedTabs === "all" ? "all" : [...profile.allowedTabs],
      allowedBranches: profile.allowedBranches === "all" ? "all" : [...profile.allowedBranches],
      allowedAdminTabs: profile.allowedAdminTabs === undefined || profile.allowedAdminTabs === "all" ? "all" : [...profile.allowedAdminTabs],
      // 미지정(기존 문서)은 열람 불가([])로 시작 — 권한은 관리자가 명시적으로 준다(fail-closed).
      salaryBranches: profile.salaryBranches === "all" ? "all" : [...(profile.salaryBranches ?? [])],
    };
    setEdit(snapshot);
    // 수정은 항상 새 객체/배열을 만들어 setEdit 하므로, 같은 객체를 기준선으로 둬도 안전하다(값 비교는 JSON).
    setEditBaseline(snapshot);
  };

  const cancelEdit = () => { setEditingUid(null); setEdit(null); setEditBaseline(null); setSaveError(""); };

  /**
   * 기준선(패널을 연 시점)과 달라진 필드만 담은 패치를 만든다(Codex 지적 2026-07-29 — 전체 저장은
   * 다른 관리자의 동시 변경을 덮어쓴다). 권한류(역할·상태·탭·지점·급여지점)는 서로 규칙이 얽혀 있어
   * (normalizeSalaryBranches, 인코딩본 동반 갱신) 하나라도 바뀌면 묶음으로 보낸다.
   * 이름·연락처는 비어 있으면 보내지 않는다(기존 값 보존).
   */
  const buildDirtyPatch = (current: EditState, base: EditState): Partial<Omit<UserProfile, "uid" | "createdAt" | "email">> => {
    const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    const patch: Partial<Omit<UserProfile, "uid" | "createdAt" | "email">> = {};
    const name = current.name.trim();
    const phone = current.phone.trim();
    if (name && name !== base.name.trim()) patch.name = name;
    if (phone && phone !== base.phone.trim()) patch.phone = phone;
    const permTouched = current.role !== base.role
      || current.status !== base.status
      || differs(current.allowedTabs, base.allowedTabs)
      || differs(current.allowedBranches, base.allowedBranches)
      || differs(current.allowedAdminTabs, base.allowedAdminTabs)
      || differs(current.salaryBranches, base.salaryBranches);
    if (permTouched) {
      patch.role = current.role;
      patch.status = current.status;
      patch.allowedTabs = current.allowedTabs;
      // allowedBranches 는 항상 함께 — 규칙이 보는 인코딩본(allowedBranchesEncoded)이 이때 갱신된다.
      patch.allowedBranches = current.allowedBranches;
      patch.allowedAdminTabs = current.allowedAdminTabs;
      patch.salaryBranches = normalizeSalaryBranches(current.role, current.salaryBranches, current.allowedBranches);
    }
    return patch;
  };

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
  // 급여대장 열람 지점 — 일반 지점 권한(allowedBranches)과 별개로 관리한다(급여는 개인정보라 더 좁게).
  const toggleSalaryBranch = (branchName: string) => {
    if (!edit || edit.salaryBranches === "all") return;
    const has = edit.salaryBranches.includes(branchName);
    setEdit({ ...edit, salaryBranches: has ? edit.salaryBranches.filter((b) => b !== branchName) : [...edit.salaryBranches, branchName] });
  };
  const toggleAllSalaryBranches = (checked: boolean) => {
    if (!edit) return;
    setEdit({ ...edit, salaryBranches: checked ? "all" : [] });
  };

  const save = async () => {
    if (!editingUid || !edit || !editBaseline || saving) return;   // saving 가드 — 삭제와 동시 실행 방지
    if (!edit.name.trim()) { setSaveError("이름을 입력해 주세요."); return; }
    if (!edit.phone.trim()) { setSaveError("연락처를 입력해 주세요."); return; }
    setSaving(true);
    setSaveError("");
    try {
      // 달라진 필드만 보낸다 — 전체 저장은 패널을 열어 둔 사이 다른 관리자가 바꾼 값을 덮어쓴다.
      // 권한류는 buildDirtyPatch 가 묶음으로 정규화(normalizeSalaryBranches)까지 처리한다.
      const patch = buildDirtyPatch(edit, editBaseline);
      if (Object.keys(patch).length === 0) { cancelEdit(); return; }   // 바뀐 것이 없다
      await updateUserProfile(editingUid, patch);
      // 화면 목록에도 **인코딩본까지** 반영한다 — 저장은 updateUserProfile 안에서 인코딩본을 함께 쓰는데,
      // 여기서 그걸 빼고 병합하면 방금 지점관리자로 올린 계정이 "권한 인덱스 없음"으로 잘못 잡혀
      // 빨간 복구 배너가 헛되이 뜬다(서버 문서는 멀쩡한데 화면만 오판 — 사용자 지적 2026-07-30).
      setProfiles((prev) => prev && prev.map((p) => (p.uid === editingUid ? { ...p, ...withEncodedBranchLists(patch) } : p)));
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
      // 승인은 편집으로 **달라진 필드**와 원자적으로 저장한다 — 관리자가 조정한 지점·탭 제한이 승인과
      // 함께 반영되도록(Codex 지적 2026-07-27). 다만 안 건드린 필드는 보내지 않는다 — 전체를 보내면
      // 패널을 열어 둔 사이 다른 관리자가 바꾼 값을 옛 스냅샷으로 덮어쓴다(Codex 지적 2026-07-29).
      // 이름·연락처를 비운 채 승인하면 그 필드는 패치에서 빠져 기존 값이 보존된다(buildDirtyPatch 규칙).
      const patch = (uid === editingUid && edit && editBaseline)
        ? { ...buildDirtyPatch(edit, editBaseline), reviewedByAdmin: true }
        : { reviewedByAdmin: true };
      await updateUserProfile(uid, patch);
      setProfiles((prev) => prev && prev.map((p) => (p.uid === uid ? { ...p, ...withEncodedBranchLists(patch) } : p)));
      if (uid === editingUid) cancelEdit();
    } catch (e) {
      console.error("확인 처리 실패:", e);
      window.alert("확인 처리에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.");
    } finally {
      setConfirmingUid(null);
    }
  };

  // 비밀번호 재설정 메일 — Auth 비밀번호는 관리자가 직접 바꿀 수 없어(서버 없음) 본인 메일로 링크를 보낸다.
  const sendResetMail = async (profile: UserProfile) => {
    if (resetSendingUid) return;
    const email = String(profile.email || "").trim();
    if (!email) { window.alert("이 계정에는 이메일이 없어 재설정 메일을 보낼 수 없습니다."); return; }
    if (!window.confirm(`${String(profile.name || email)} 계정의 이메일(${email})로 비밀번호 재설정 메일을 보낼까요?`)) return;
    setResetSendingUid(profile.uid);
    setResetSentUid(null);
    try {
      const { getAuth, sendPasswordResetEmail } = await import("firebase/auth");
      const auth = getAuth();          // 개인 관리자 세션 = 기본 앱이 이미 초기화돼 있다
      auth.languageCode = "ko";        // 한국어 메일
      await sendPasswordResetEmail(auth, email);
      setResetSentUid(profile.uid);
    } catch (e) {
      console.error("비밀번호 재설정 메일 전송 실패:", e);
      window.alert("재설정 메일을 보내지 못했습니다. 네트워크 확인 후 다시 시도해주세요.");
    } finally {
      setResetSendingUid(null);
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

  // 역할을 바꿀 때 급여대장 허용 지점을 함께 손본다(설계서 §15.3).
  // - 지점관리자로 올리면: 그 사람의 근무지점을 자동으로 넣어 준다. 매번 따로 체크하지 않아도 자기 지점은 바로 열린다.
  // - 지점으로 내리면: 급여 허용 지점을 비운다. 권한 데이터가 남아 있다가 나중에 역할이 다시 올라갈 때
  //   의도치 않게 되살아나는 것을 막는다(fail-closed).
  // - 총괄은 지점 목록과 무관하게 전 지점이므로 건드리지 않는다.
  const changeRole = (nextRole: UserProfile["role"]) => {
    if (!edit) return;
    const home = String(editingProfile?.workBranch || "").trim();
    const seeded = nextRole === "branchAdmin" && edit.salaryBranches !== "all" && home && !edit.salaryBranches.includes(home)
      ? [...edit.salaryBranches, home]
      : edit.salaryBranches;
    setEdit({ ...edit, role: nextRole, salaryBranches: normalizeSalaryBranches(nextRole, seeded, edit.allowedBranches) });
  };

  // ---- 기존 계정 허용지점 일괄 축소 (2026-07-28 전환 작업, 설계서 §11) ----
  //
  // 왜 화면에서 하나: users 문서는 firestore.rules 상 '개인 관리자'만 쓸 수 있고, PIN 관리자 계정은
  // 의도적으로 배제돼 있다. 스크립트는 PIN 계정으로만 로그인할 수 있어 users를 읽지도 쓰지도 못한다.
  // 그래서 이 정리는 총괄이 로그인한 이 화면에서 돌린다 — 대상은 한 번에 다 처리하므로 '일괄'은 그대로다.
  //
  // 대상: 역할이 '지점'이고 허용지점이 '전체'인 계정. 근무지점(workBranch) 한 곳으로 좁힌다.
  // 건너뜀: 근무지점이 비었거나 현재 지점 목록에 없는 이름 — 임의로 추정하지 않고 그대로 남긴다(fail-closed).
  const scopeTargets = (profiles || []).filter(
    (p) => p.role === "branch" && p.allowedBranches === "all" && p.uid !== currentUid
  );
  const branchNameSet = new Set(branches.map((b) => String(b.branchName || "").trim()));
  const scopeReady = scopeTargets.filter((p) => {
    const home = String(p.workBranch || "").trim();
    return home !== "" && branchNameSet.has(home);
  });
  const scopeSkipped = scopeTargets.filter((p) => !scopeReady.includes(p));

  // ---- 목록에서 바로 고치기(행 안 드롭다운) ----
  //
  // 역할·허용지점·상태는 자주 손대는 값이라, 아래 상세 패널을 열지 않고 행에서 바로 바꾸고 즉시 저장한다.
  // 저장 중인 행은 흐리게 처리하고, 실패하면 그 행 아래에 사유를 남긴다(조용히 삼키지 않는다).
  /**
   * 역할에 맞게 급여대장 허용 지점을 정리한다. 화면·규칙·저장이 같은 규칙을 쓰도록 한 곳에 둔다.
   *   총괄       : 목록과 무관하게 전 지점이므로 건드리지 않는다.
   *   지점       : 급여 권한 없음 → 비운다(fail-closed).
   *   지점관리자 : '전체'는 쓸 수 없고(사용자 지시: 전체매장이 아니라 허용된 지점만),
   *                허용지점 밖의 지점도 남기지 않는다(못 들어가는 지점의 급여를 볼 수는 없다).
   */
  const normalizeSalaryBranches = (
    role: UserProfile["role"],
    salary: string[] | "all",
    allowed: string[] | "all"
  ): string[] | "all" => {
    if (role === "admin") return salary;
    if (role !== "branchAdmin") return [];
    const list = salary === "all" ? (allowed === "all" ? [] : [...allowed]) : salary;
    if (allowed === "all") return list;
    return list.filter((b) => allowed.includes(b));
  };

  /** 행에서 고친 값을 바로 저장한다. 급여 허용 지점은 위 규칙으로 함께 맞춘다. */
  const applyRowPatch = async (profile: UserProfile, patch: Partial<UserProfile>) => {
    if (rowSavingUid || profile.uid === currentUid) return;
    const nextRole = (patch.role ?? profile.role) as UserProfile["role"];
    const nextAllowed = (patch.allowedBranches ?? profile.allowedBranches) as string[] | "all";
    const currentSalary = profile.salaryBranches === "all" ? "all" : [...(profile.salaryBranches ?? [])];
    // 지점관리자로 올릴 때는 근무지점을 기본으로 넣어 준다(허용지점 안에 있을 때만).
    const seeded = nextRole === "branchAdmin" && currentSalary !== "all"
      ? (() => {
          const home = String(profile.workBranch || "").trim();
          const inScope = home && (nextAllowed === "all" || nextAllowed.includes(home));
          return inScope && !currentSalary.includes(home) ? [...currentSalary, home] : currentSalary;
        })()
      : currentSalary;
    const nextSalary = normalizeSalaryBranches(nextRole, seeded, nextAllowed);
    // allowedBranches를 항상 함께 보낸다 — 규칙이 보는 인코딩본(allowedBranchesEncoded)이 이때 갱신된다.
    // 역할만 바꾸고 지점을 안 보내면 인코딩본이 없는 채로 남아, 방금 올린 지점관리자가 규칙에서 막힌다.
    const fullPatch = { ...patch, allowedBranches: nextAllowed, salaryBranches: nextSalary };

    setRowSavingUid(profile.uid);
    setRowError(null);
    try {
      await updateUserProfile(profile.uid, fullPatch);
      setProfiles((prev) => prev && prev.map((p) => (p.uid === profile.uid ? { ...p, ...withEncodedBranchLists(fullPatch) } : p)));
    } catch (e) {
      console.error("계정 즉시 수정 실패:", e);
      setRowError({ uid: profile.uid, message: "저장하지 못했습니다. 본인 계정이거나 권한·네트워크 문제일 수 있습니다." });
    } finally {
      setRowSavingUid(null);
    }
  };

  const addAllowedBranch = (profile: UserProfile, branchName: string) => {
    if (!branchName) return;
    if (branchName === "__all__") {
      void applyRowPatch(profile, { allowedBranches: "all" });
      return;
    }
    const current = profile.allowedBranches === "all" ? [] : [...profile.allowedBranches];
    if (current.includes(branchName)) return;
    void applyRowPatch(profile, { allowedBranches: [...current, branchName] });
  };

  const removeAllowedBranch = (profile: UserProfile, branchName: string) => {
    // '전체'에서 하나를 빼는 것은 뜻이 모호하다 — 전체 해제는 칩의 '전체' 배지를 눌러 목록형으로 바꾼 뒤 고른다.
    if (profile.allowedBranches === "all") return;
    const next = profile.allowedBranches.filter((b) => b !== branchName);
    // 마지막 하나를 빼면 그 계정은 어느 지점에도 못 들어간다 — 실수로 접근을 끊는 일이 잦은 자리라 한 번 묻는다.
    if (next.length === 0
      && !window.confirm(`${String(profile.name || profile.email || "이 계정")}의 허용 지점이 하나도 남지 않습니다.\n이 계정은 어느 지점에도 들어갈 수 없게 됩니다. 계속할까요?`)) {
      return;
    }
    void applyRowPatch(profile, { allowedBranches: next });
  };

  /**
   * '전체 지점' → 목록형 전환. 빈 목록이 아니라 '지금 있는 모든 지점'을 펼친다.
   * 빈 목록으로 떨어뜨리면 지점을 다시 고르기 전까지 그 계정이 전 지점 접근을 잃는다(Codex 지적 2026-07-28).
   * 펼친 직후에는 접근 범위가 그대로이고, 관리자가 필요 없는 지점을 하나씩 빼면 된다.
   */
  const expandAllBranches = async (profile: UserProfile) => {
    // 목록을 다시 받는 동안 두 번째 클릭이 같은 저장을 또 시작하지 않게 막는다(Codex 지적 2026-07-28).
    if (rowSavingUid || expandingRef.current) return;
    expandingRef.current = true;
    setExpandingUid(profile.uid);
    try {
      // 화면을 연 뒤 지점이 새로 생겼을 수 있다. 그때 화면에 남아 있던 옛 목록을 그대로 굳혀 저장하면
      // '전체'였던 계정이 새 지점만 조용히 잃는다 — 그래서 저장 직전에 목록을 다시 받는다.
      let list = branches;
      try {
        const fresh = await getFirebaseLoginBranches();
        if (!Array.isArray(fresh) || fresh.length === 0) throw new Error("빈 지점 목록");
        list = fresh;
        setBranches(fresh);
      } catch (e) {
        console.error("지점 목록 갱신 실패:", e);
        window.alert("지점 목록을 새로 불러오지 못해 전환을 멈췄습니다. 네트워크 확인 후 다시 시도해주세요.");
        return;   // 옛 목록으로 굳히지 않는다(fail-closed)
      }
      const all = list.map((b) => String(b.branchName || "").trim()).filter(Boolean);
      if (all.length === 0) return;
      await applyRowPatch(profile, { allowedBranches: all });
    } finally {
      expandingRef.current = false;
      setExpandingUid(null);
    }
  };

  // ---- 권한 인덱스 복구 ----
  //
  // firestore.rules는 한글 지점명을 원문으로 비교할 수 없어(규칙에 URL 디코딩이 없다) 인코딩본
  // (salaryBranchesEncoded / allowedBranchesEncoded)을 본다. 이 값은 이 화면의 저장 경로가 채운다.
  // 앱 밖(콘솔 등)에서 직접 만든 문서에는 빠져 있을 수 있고, 그러면 화면은 통과하는데 급여 문서만
  // 조용히 막힌다 — 원인을 찾기 어려운 고장이라 눈에 보이게 두고 한 번에 고친다.
  const indexBrokenProfiles = (profiles || []).filter(
    (p) => p.role === "branchAdmin" && (p.allowedBranchesEncoded === undefined || p.salaryBranchesEncoded === undefined)
  );
  const repairPermissionIndexes = async () => {
    if (repairing || indexBrokenProfiles.length === 0) return;
    setRepairing(true);
    try {
      for (const p of indexBrokenProfiles) {
        // 값은 그대로 두고 다시 저장한다 — 저장 경로가 인코딩본을 채워 준다.
        await updateUserProfile(p.uid, {
          allowedBranches: p.allowedBranches,
          salaryBranches: p.salaryBranches === "all" ? "all" : [...(p.salaryBranches ?? [])]
        });
      }
      await load();
    } catch (e) {
      console.error("권한 인덱스 복구 실패:", e);
      window.alert("권한 인덱스 복구에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.");
    } finally {
      setRepairing(false);
    }
  };

  // ---- 지점 필터 ----
  // 그 지점과 관련된 계정만 본다: 가입할 때 고른 지점이거나, 허용지점에 들어 있는 계정.
  // 허용지점이 '전체'인 계정은 어느 지점을 골라도 나온다 — 실제로 그 지점에 들어갈 수 있기 때문이다.
  const matchesBranchFilter = (p: UserProfile) => {
    if (!branchFilter) return true;
    if (String(p.workBranch || "").trim() === branchFilter) return true;
    if (p.allowedBranches === "all") return true;
    return Array.isArray(p.allowedBranches) && p.allowedBranches.includes(branchFilter);
  };
  const visibleProfiles = (profiles || []).filter(matchesBranchFilter);

  const runBranchScopeCleanup = async () => {
    if (scopeRunning || scopeReady.length === 0) return;
    setScopeRunning(true);
    setScopeResult(null);
    const failed: string[] = [];
    let done = 0;
    // 한 건씩 순차 처리한다 — 한 계정이 실패해도 나머지는 계속 진행하고, 실패한 이름만 그대로 보고한다.
    for (const profile of scopeReady) {
      try {
        await updateUserProfile(profile.uid, { allowedBranches: [String(profile.workBranch).trim()] });
        done += 1;
      } catch (e) {
        console.error("허용지점 축소 실패:", profile.uid, e);
        failed.push(String(profile.name || profile.email || profile.uid));
      }
    }
    setScopeResult({ done, failed });
    setScopeRunning(false);
    await load();
  };

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
          {scopeTargets.length > 0 && (
            <button onClick={() => { setScopePanelOpen((open) => !open); setScopeResult(null); }}
              className="p-2 px-3 rounded-xl border border-[#212121] bg-[var(--admin-vanilla)] text-xs font-black cursor-pointer">
              허용지점 정리 {scopeTargets.length}건
            </button>
          )}
          <button onClick={() => void load()} disabled={loading}
            className="p-2 px-3 rounded-xl border border-gray-200 text-xs font-black cursor-pointer disabled:opacity-40">
            {loading ? "확인 중..." : "새로고침"}
          </button>
        </div>
      </div>

      {/* 허용지점 일괄 축소 — 가입 기본값이 '전체'이던 시절 계정을 근무지점 한 곳으로 좁힌다.
          되돌리기가 없으므로 무엇이 바뀌는지 전부 보여준 뒤에만 실행한다. */}
      {scopePanelOpen && scopeTargets.length > 0 && (
        <div className="rounded-2xl border border-[#212121] bg-white p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-black text-[#212121]">기존 계정 허용지점 정리</p>
            <p className="text-[11px] font-bold text-zinc-500">
              허용지점이 '전체'인 지점 계정을, 가입할 때 고른 근무지점 한 곳으로 좁힙니다.
              여러 지점을 오가던 사람은 한 곳만 보이게 되므로, 필요한 계정은 정리 후 개별로 다시 넓혀 주세요.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-black text-gray-700">바꿀 계정 {scopeReady.length}건</p>
            {scopeReady.length === 0 ? (
              <p className="text-[11px] font-bold text-zinc-400">바꿀 계정이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {scopeReady.map((p) => (
                  <p key={p.uid} className="text-[11px] font-bold text-zinc-600">
                    {String(p.name || p.email || p.uid)} · 전체 → <span className="font-black text-[#212121]">{String(p.workBranch).trim()}</span>
                  </p>
                ))}
              </div>
            )}
          </div>

          {scopeSkipped.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-gray-200 bg-[var(--admin-ghost)] p-3">
              <p className="text-[11px] font-black text-[#B91C1C]">건너뛸 계정 {scopeSkipped.length}건</p>
              <p className="text-[10px] font-bold text-zinc-500">
                근무지점이 비었거나 지금 지점 목록에 없는 이름입니다. 임의로 정하지 않고 그대로 두니, 계정을 눌러 직접 지정해 주세요.
              </p>
              {scopeSkipped.map((p) => (
                <p key={p.uid} className="text-[11px] font-bold text-zinc-600">
                  {String(p.name || p.email || p.uid)} · 근무지점 "{String(p.workBranch || "").trim() || "(없음)"}"
                </p>
              ))}
            </div>
          )}

          {scopeResult && (
            <div className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-bold text-zinc-600">
              {scopeResult.done}건 반영 완료
              {scopeResult.failed.length > 0 && (
                <span className="block text-[#B91C1C]">실패 {scopeResult.failed.length}건: {scopeResult.failed.join(", ")}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={() => void runBranchScopeCleanup()} disabled={scopeRunning || scopeReady.length === 0}
              className="p-2 px-4 rounded-xl border border-[#212121] bg-[var(--admin-honey)] text-xs font-black cursor-pointer disabled:opacity-40">
              {scopeRunning ? "반영 중..." : `${scopeReady.length}건 반영`}
            </button>
            <button onClick={() => setScopePanelOpen(false)} disabled={scopeRunning}
              className="p-2 px-4 rounded-xl border border-gray-200 text-xs font-black cursor-pointer disabled:opacity-40">
              닫기
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-[#C93A3A] bg-[#FDE2E2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{loadError}</div>
      )}

      {indexBrokenProfiles.length > 0 && (
        <div className="rounded-2xl border border-[#C93A3A] bg-[#FDE2E2] px-4 py-3 space-y-2">
          <p className="text-xs font-black text-[#B91C1C]">급여대장 권한이 서버에서 막히는 계정 {indexBrokenProfiles.length}건</p>
          <p className="text-[11px] font-bold text-[#B91C1C]">
            {indexBrokenProfiles.map((p) => String(p.name || p.email || p.uid)).join(", ")} — 지점관리자인데 권한 인덱스가 없습니다.
            화면에서는 권한이 있어 보여도 급여대장 데이터를 못 읽습니다. 아래 버튼을 누르면 값은 그대로 두고 인덱스만 다시 만듭니다.
          </p>
          <button onClick={() => void repairPermissionIndexes()} disabled={repairing}
            className="p-2 px-4 rounded-xl border border-[#212121] bg-white text-xs font-black cursor-pointer disabled:opacity-40">
            {repairing ? "복구 중..." : "권한 인덱스 복구"}
          </button>
        </div>
      )}

      {/* 지점 필터 — 그 지점 소속(가입 시 선택)이거나 그 지점에 들어갈 수 있는 계정만 추린다. */}
      {profiles !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black text-gray-700">지점</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
            className="p-2 px-3 border border-gray-200 rounded-xl text-xs font-bold">
            <option value="">전체 지점</option>
            {branches.map((b) => (
              <option key={b.branchId} value={b.branchName}>{b.branchName}</option>
            ))}
          </select>
          <span className="text-[11px] font-bold text-zinc-400">
            {branchFilter
              ? `${visibleProfiles.length}건 · 선택지점이 ${branchFilter}이거나 허용지점에 ${branchFilter}이 포함된 계정`
              : `${visibleProfiles.length}건`}
          </span>
        </div>
      )}

      {/* 카드=검정 1px 테두리, 헤더 라벨=엘리스 배경+100% 검정 11px 볼드(DESIGN.md §4·§9-1 — text-gray-*는 흐려져 금지) */}
      {/* 계정이 많아 표가 화면을 넘긴다 — 높이를 끊고 표 안에서 스크롤한다(사용자 지시 2026-07-29).
          머리글은 sticky 로 붙여 두어 스크롤해도 어느 칸인지 보이게 한다. */}
      {loading ? <LoadingSpinner /> : profiles === null ? null : (
        <div id="account-management-table" className="bg-white rounded-2xl border border-[#212121] overflow-x-auto max-h-[34rem] overflow-y-auto">
          <table className="w-full min-w-[1080px] text-xs">
            {/* sticky·배경은 index.css 에서 th 에 직접 준다 — thead/tr 배경은 본문이 지나갈 때 헤더를 덮지 못한다
                (마감 이력 점검 표에서 검증된 패턴). */}
            <thead className="bg-[var(--admin-alice)]">
              <tr className="text-[11px] font-black text-[#212121]">
                {/* 승인은 맨 왼쪽 — 신청관리 탭과 같은 자리(사용자 지시 2026-07-29) */}
                <th className="px-3 py-2 text-left">승인</th>
                <th className="px-3 py-2 text-left">이름</th>
                <th className="px-3 py-2 text-left">이메일</th>
                <th className="px-3 py-2 text-left">역할</th>
                {/* 선택지점 = 가입할 때 본인이 고른 근무지점(workBranch). 허용 지점을 넓혀도 이 칸은 바뀌지 않는다. */}
                <th className="px-3 py-2 text-left">선택지점</th>
                <th className="px-3 py-2 text-left">허용 탭</th>
                <th className="px-3 py-2 text-left">허용 지점</th>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2 text-left">가입일</th>
                <th className="px-3 py-2 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleProfiles.length === 0 ? (
                <tr><td colSpan={10} className="px-5 py-16 text-center text-gray-400">
                  {profiles.length === 0 ? "등록된 개인 계정이 없습니다." : "이 지점에 해당하는 계정이 없습니다."}
                </td></tr>
              ) : visibleProfiles.map((p) => {
                const isSelf = p.uid === currentUid;
                const isEditingRow = p.uid === editingUid;
                const rowBusy = rowSavingUid === p.uid || expandingUid === p.uid;
                // 본인 계정은 규칙상 수정 불가(firestore.rules) — 드롭다운도 잠근다.
                const rowLocked = isSelf || rowBusy;
                const allowedList = p.allowedBranches === "all" ? [] : p.allowedBranches;
                const addableBranches = branches.filter((b) => !allowedList.includes(b.branchName));
                return (
                  <Fragment key={p.uid}>
                    <tr
                      onClick={() => startEdit(p)}
                      className={`hover:bg-gray-50/60 cursor-pointer ${isEditingRow ? "bg-[var(--admin-alice)]/40" : ""} ${rowBusy ? "opacity-50" : ""}`}
                    >
                      {/* 승인 — 맨 왼쪽 칸. 미확인 계정만 버튼이 뜨고, 확인된 계정은 '완료'로 표시한다.
                          행 클릭(상세 열기)과 겹치지 않게 stopPropagation. */}
                      <td className="px-3 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {!p.reviewedByAdmin ? (
                          <button type="button" disabled={rowBusy || confirmingUid === p.uid}
                            onClick={() => void markReviewed(p.uid)}
                            title="이 계정을 확인 처리합니다. 권한을 조정하려면 행을 눌러 상세를 여세요."
                            className="rounded-full border border-[#212121] bg-[var(--admin-honey)] px-2.5 py-0.5 text-[11px] font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                            {confirmingUid === p.uid ? "처리 중..." : "승인"}
                          </button>
                        ) : (
                          <span className="rounded-full border border-gray-200 bg-[var(--admin-ghost)] px-2.5 py-0.5 text-[11px] font-black text-[#212121]/70">완료</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-bold whitespace-nowrap">
                        {String(p.name || "")}
                        {!p.reviewedByAdmin && (
                          <span className="ml-1.5 inline-block rounded-full border border-[#212121] bg-[var(--admin-vanilla)] px-1.5 py-0.5 text-[9px] font-black">신규</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">{String(p.email || "")}</td>
                      {/* 아래 세 칸은 상세 패널을 열지 않고 그 자리에서 바꾼다. 행 클릭(상세 열기)과 겹치지 않게 stopPropagation. */}
                      <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <select value={p.role} disabled={rowLocked}
                          onChange={(e) => void applyRowPatch(p, { role: e.target.value as UserProfile["role"] })}
                          className={`h-7 px-2 border rounded-lg text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${ROLE_SELECT_STYLE[p.role]}`}>
                          {ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{String(p.workBranch || "").trim() || "-"}</td>
                      <td className="px-3 py-1.5">
                        {summarizeTabs(p.allowedTabs)}
                        {p.role === "admin" && (
                          <span className="block text-[10px] font-bold text-zinc-400 mt-0.5">관리자탭: {summarizeAdminTabs(p.allowedAdminTabs)}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 min-w-[240px]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center gap-1">
                          {p.allowedBranches === "all" ? (
                            <button type="button" disabled={rowLocked || branches.length === 0}
                              onClick={() => void expandAllBranches(p)}
                              title="누르면 전 지점이 목록으로 펼쳐집니다. 접근 범위는 그대로이고, 필요 없는 지점을 하나씩 빼면 됩니다."
                              className="rounded-full border border-[#212121] bg-[var(--admin-honey)] px-2 py-0.5 text-[10px] font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                              전체 지점
                            </button>
                          ) : allowedList.length === 0 ? (
                            <span className="text-[10px] font-bold text-[#B91C1C]">없음</span>
                          ) : (
                            allowedList.map((b) => (
                              <span key={b} className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-black">
                                {b}
                                <button type="button" disabled={rowLocked} onClick={() => removeAllowedBranch(p, b)}
                                  aria-label={`${b} 제거`} title="이 지점을 뺍니다"
                                  className="text-zinc-400 hover:text-[#B91C1C] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                                  ×
                                </button>
                              </span>
                            ))
                          )}
                          {/* 추가 버튼 — 여러 지점을 맡는 계정은 여기서 하나씩 더한다. */}
                          <select value="" disabled={rowLocked || (p.allowedBranches !== "all" && addableBranches.length === 0)}
                            onChange={(e) => addAllowedBranch(p, e.target.value)}
                            className="h-6 px-1.5 border border-gray-200 rounded-lg text-[10px] font-black bg-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                            <option value="">+ 추가</option>
                            {p.allowedBranches !== "all" && <option value="__all__">전체 지점</option>}
                            {addableBranches.map((b) => (
                              <option key={b.branchId} value={b.branchName}>{b.branchName}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <select value={p.status} disabled={rowLocked}
                          onChange={(e) => void applyRowPatch(p, { status: e.target.value as UserProfile["status"] })}
                          className={`h-7 px-2 border border-[#212121] rounded-lg text-[11px] font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${p.status === "active" ? "bg-[var(--admin-honey)]" : "bg-white"}`}>
                          <option value="active">{STATUS_LABEL.active}</option>
                          <option value="suspended">{STATUS_LABEL.suspended}</option>
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                      <td className="px-3 py-1.5 text-right">
                        {isSelf ? (
                          <span className="text-[10px] font-bold text-zinc-400">본인 계정</span>
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-300 ml-auto" />
                        )}
                      </td>
                    </tr>
                    {rowError?.uid === p.uid && (
                      <tr>
                        <td colSpan={10} className="px-4 pb-3 text-[10px] font-black text-[#B91C1C]">{rowError.message}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingUid && editingProfile && (
        editingProfile.uid === currentUid ? (
          <div ref={detailPanelRef} className="rounded-2xl border border-[#212121] bg-white p-5 text-xs font-bold text-zinc-500">
            본인 계정은 다른 관리자 또는 Firebase 콘솔에서 수정해주세요.
          </div>
        ) : edit && (
          <div ref={detailPanelRef} className="rounded-2xl border border-[#212121] bg-white p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-black text-[#212121]">{editingProfile.name} ({editingProfile.email})</h4>
              <button onClick={cancelEdit} className="text-[11px] font-black text-zinc-400 cursor-pointer">닫기</button>
            </div>

            {/* 이름·연락처는 가입 후 본인이 고칠 수 없어 관리자가 여기서 정정한다(2026-07-29).
                근무지점(가입 시 선택)은 허용 지점과 별개의 참고값이라 표시만 한다. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="space-y-1.5">
                <span className="block text-[11px] font-black text-gray-700">이름</span>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  className="w-full p-2 px-3 border border-gray-200 rounded-xl text-[11px] font-bold" />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[11px] font-black text-gray-700">연락처</span>
                <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                  className="w-full p-2 px-3 border border-gray-200 rounded-xl text-[11px] font-bold" />
              </label>
              <div className="space-y-1.5">
                <span className="block text-[11px] font-black text-gray-700">근무지점 (가입 시 선택)</span>
                <p className="p-2 px-1 text-xs font-bold text-zinc-500">{editingProfile.workBranch || "-"}</p>
              </div>
            </div>

            {/* 비밀번호는 Firebase Auth 소관이라 관리자가 직접 정할 수 없다 — 본인 메일로 재설정 링크만 보낸다. */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void sendResetMail(editingProfile)}
                disabled={resetSendingUid !== null || !String(editingProfile.email || "").trim()}
                className="px-3 py-1.5 rounded-xl border border-[#212121] bg-white text-[11px] font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                {resetSendingUid === editingProfile.uid ? "메일 보내는 중..." : "비밀번호 재설정 메일 보내기"}
              </button>
              {resetSentUid === editingProfile.uid ? (
                <span className="text-[11px] font-black text-[#212121]">메일을 보냈습니다 — 스팸함도 확인하라고 안내해 주세요.</span>
              ) : (
                <span className="text-[10px] font-bold text-zinc-500">구글 로그인 계정은 비밀번호가 없어 이 메일로는 바뀌지 않습니다.</span>
              )}
            </div>

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
                <select value={edit.role} onChange={(e) => changeRole(e.target.value as UserProfile["role"])}
                  className={`w-full p-2 px-3 border rounded-xl text-[11px] ${ROLE_SELECT_STYLE[edit.role]}`}>
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <span className="block text-[10px] font-bold text-zinc-500">
                  {ROLE_OPTIONS.find((option) => option.value === edit.role)?.hint}
                </span>
              </label>
              <label className="space-y-1.5">
                <span className="block text-[11px] font-black text-gray-700">상태</span>
                {/* 입력칸·셀렉트는 11px — DESIGN.md §6-0-1 폰트 기준표(역할 셀렉트와 같은 크기로 맞춘다) */}
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as UserProfile["status"] })}
                  className="w-full p-2 px-3 border border-gray-200 rounded-xl text-[11px] font-bold">
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

            {/* 급여대장 열람 지점 — 급여·주민번호·계좌가 담긴 자료라 일반 지점 권한과 분리해 좁게 준다.
                체크한 지점만 그 계정이 급여대장을 볼 수 있다(firestore.rules canReadSalary가 실제로 차단).
                정직원·파트타이머 두 대장에 같은 목록이 적용된다(2026-07-28). */}
            <div className="space-y-2 rounded-xl border border-gray-200 bg-[var(--admin-ghost)] p-4">
              <div className="space-y-0.5">
                <p className="text-[11px] font-black text-gray-700">급여대장 열람 지점 (정직원 · 파트타이머)</p>
                <p className="text-[10px] font-bold text-zinc-500">체크한 지점의 급여대장만 열람·작성할 수 있습니다. 아무것도 체크하지 않으면 열람할 수 없습니다.</p>
                {edit.role === "branch" && (
                  <p className="text-[10px] font-black text-[#B91C1C]">
                    지점 역할은 급여대장을 열 수 없습니다. 여기서 지점을 체크해도 적용되지 않습니다 — 먼저 역할을 지점관리자로 바꿔 주세요.
                  </p>
                )}
                {edit.role === "admin" && (
                  <p className="text-[10px] font-bold text-zinc-500">총괄관리자는 이 목록과 무관하게 전 지점을 열람·작성합니다.</p>
                )}
              </div>
              {/* '전체 지점'은 총괄관리자만 쓸 수 있다 — 지점관리자에게 전체를 주는 것은 요구사항에 어긋난다. */}
              <label className={`flex items-center gap-2 text-[11px] font-black ${edit.role === "admin" ? "text-gray-700 cursor-pointer" : "text-zinc-300"}`}>
                <input type="checkbox" disabled={edit.role !== "admin"}
                  checked={edit.salaryBranches === "all"} onChange={(e) => toggleAllSalaryBranches(e.target.checked)} />
                전체 지점 (총괄관리자 전용)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {branches.map((b) => (
                  <label key={b.branchId} className={`flex items-center gap-1.5 text-[11px] font-bold ${edit.salaryBranches === "all" ? "text-zinc-300" : "text-gray-600 cursor-pointer"}`}>
                    <input type="checkbox"
                      checked={edit.salaryBranches === "all" || edit.salaryBranches.includes(b.branchName)}
                      disabled={edit.salaryBranches === "all"}
                      onChange={() => toggleSalaryBranch(b.branchName)}
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
