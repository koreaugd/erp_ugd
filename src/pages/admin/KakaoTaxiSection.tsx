// src/pages/admin/KakaoTaxiSection.tsx
// 관리자 > 법인택시 — 카카오T 비즈니스 이용내역 조회·이상 점검·직원 관리.
// 데이터는 저장하지 않고 카카오 API 를 실시간 조회한다(백엔드 프록시 경유 — gas/Code.gs, 로컬은 server.ts).
// 계산은 helpers/kakaoTaxi.ts·kakaoTaxiAnomaly.ts (순수 함수), 이 파일은 조회·표시·쓰기 흐름만 맡는다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthContext } from "../../contexts/AuthContext";
import { gasClient } from "../../api/gasClient";
import type { KakaoTaxiGroup, KakaoTaxiMember, KakaoTaxiMemberInput } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { formatNumber } from "../../utils/formatNumber";
import { addMonthsToMonthInputValue } from "../branch/helpers/formatters";
import {
  aggregateByBranch, aggregateByMember, buildOrdersExcelRows, KAKAO_BRANCH_ALIASES, memberAmountMap,
  normalizeKakaoTaxiOrders, verifyBranchTotals, verticalLabel, type NormalizedTaxiOrder,
} from "./helpers/kakaoTaxi";
import {
  DEFAULT_TAXI_THRESHOLDS, TAXI_ANOMALY_LABEL, detectMemberSurges, flagTaxiOrders,
} from "./helpers/kakaoTaxiAnomaly";
import {
  kakaoTaxiRequestsKey, REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, sortRequests, type KakaoTaxiRequest,
} from "./helpers/kakaoTaxiRequests";

export type KakaoTaxiView = "orders" | "anomaly" | "members" | "requests";

// 관리자 화면 오류 배너는 DESIGN_ADMIN.md §2-1 — bg-rose-50 은 관리자 스코프에서 '긍정색'으로
// 뒤집히므로 오류 hex 를 직접 박는다.
const ERROR_BANNER = "border rounded-xl px-4 py-3 text-xs font-bold bg-[#FDE2E2] border-[#C93A3A] text-[#B91C1C]";

const MEMBER_STATUS_LABEL: Record<string, string> = {
  created: "등록됨(미인증)", connected: "인증완료", refused: "거부", blocked: "휴직",
};

interface OrdersData {
  month: string;
  reportedCount: number;
  current: NormalizedTaxiOrder[];
  /** 전월 정규화 내역 — 아직 도착 전이거나 조회 실패 시 null (급증 비교만 비활성, 당월 화면은 정상 표시) */
  prev: NormalizedTaxiOrder[] | null;
}

export function KakaoTaxiSection({ view }: { view: KakaoTaxiView }) {
  // 백엔드의 카카오 액션은 전부 관리자 PIN 검증을 요구한다 — 로그인 세션의 pinHash 를 함께 보낸다.
  const { user } = useAuthContext();
  const adminPinHash = user?.pinHash || "";
  // toISOString()은 UTC 라 KST 월초 오전(00~08시)에 전월로 열리는 함정이 있다 — 로컬 기준으로 만든다.
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [ordersData, setOrdersData] = useState<OrdersData | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  /** 전월(급증 비교용) 조회가 아직 진행 중인지 — 당월 화면은 막지 않고 급증 표에만 안내를 띄운다 */
  const [prevLoading, setPrevLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const ordersGenRef = useRef(0);
  // "이 달은 이미 조회를 시작했다" 표식 — 탭 전환 시 중복 조회를 막되, 실패 시 무한 재시도
  // 루프에 빠지지 않게 상태(ordersData)가 아니라 ref 로 관리한다(실패 후 재시도는 새로고침 버튼).
  const ordersRequestedMonthRef = useRef<string | null>(null);
  const membersRequestedRef = useRef(false);

  const [membersData, setMembersData] = useState<{ members: KakaoTaxiMember[]; groups: KakaoTaxiGroup[] } | null>(null);
  /** 직원 관리 탭의 지점(부서) 필터 — "all" | "unassigned" | 지점명 */
  const [memberBranchFilter, setMemberBranchFilter] = useState("all");
  /** ERP 지점 목록 — 직원 수정 시 부서를 드롭다운으로 고르게 한다(오타로 미매핑되는 것 방지) */
  const [erpBranches, setErpBranches] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const membersGenRef = useRef(0);
  const [memberBusyId, setMemberBusyId] = useState("");

  const [branchFilter, setBranchFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all"); // 상세내역 직원 필터 (memberKey — 동명이인 구분)
  const [highFare, setHighFare] = useState(DEFAULT_TAXI_THRESHOLDS.highFare);

  // ---------- 지점 신청 관리 ----------
  const [requestsData, setRequestsData] = useState<{ items: KakaoTaxiRequest[]; failed: string[] } | null>(null);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState("");
  const requestsGenRef = useRef(0);
  // 조회 시작 표식 — 실패 시 무한 재시도 루프를 피하려고 상태가 아니라 ref 로 관리(orders/members 와 같은 패턴)
  const requestsRequestedRef = useRef(false);
  /** 지금 처리 중인 신청 id — 처리 중에는 모든 신청 버튼을 잠근다 */
  const [requestBusyId, setRequestBusyId] = useState("");
  /** 등록 신청 승인 폼 (그룹 확정용) */
  const [approveTarget, setApproveTarget] = useState<KakaoTaxiRequest | null>(null);
  const [approveGroupId, setApproveGroupId] = useState("");
  /** 반려 폼 */
  const [rejectTarget, setRejectTarget] = useState<KakaoTaxiRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  /** 수정 요청 승인 → 수정 카드 저장 성공 시 완료 처리할 신청 */
  const [linkedUpdateRequest, setLinkedUpdateRequest] = useState<KakaoTaxiRequest | null>(null);

  // forceRefresh=true 는 '새로고침' 버튼 전용 — 당월만 백엔드 캐시를 우회해 실시간 조회한다.
  // (전월은 마감된 불변 자료라 캐시를 그대로 쓴다 — 실패 후 재시도는 캐시가 없으니 자연히 재조회된다)
  const loadOrders = useCallback(async (forceRefresh?: boolean) => {
    const gen = ++ordersGenRef.current;
    const target = month;
    ordersRequestedMonthRef.current = target;
    setOrdersLoading(true);
    setOrdersError("");
    // 전월은 급증 비교용 보조 자료 — 당월과 병렬로 먼저 쏘아 두되, 화면은 당월 도착 즉시 그린다.
    // 실패해도 당월 화면을 막지 않는다(급증 표만 안내문으로 대체).
    setPrevLoading(true);
    const prevMonth = addMonthsToMonthInputValue(target, -1);
    const prevPromise = gasClient.getKakaoTaxiOrders(prevMonth, adminPinHash).catch(() => null);
    try {
      const [branchList, curr] = await Promise.all([
        gasClient.getBranchList(),
        gasClient.getKakaoTaxiOrders(target, adminPinHash, forceRefresh),
      ]);
      if (ordersGenRef.current !== gen) return;
      const erpNames = Array.from(new Set([...(branchList || []).map((b) => b.branchName).filter(Boolean), "본사"]));
      setOrdersData({
        month: target,
        reportedCount: curr.count,
        current: normalizeKakaoTaxiOrders(curr.orders, erpNames),
        prev: null, // 전월은 아래에서 도착하는 대로 채운다
      });
      setBranchFilter("all");
      setMemberFilter("all");
      void prevPromise.then((prev) => {
        if (ordersGenRef.current !== gen) return; // 그 사이 새 조회가 시작됐으면 그쪽이 채운다
        setOrdersData((cur) =>
          cur && cur.month === target
            ? { ...cur, prev: prev ? normalizeKakaoTaxiOrders(prev.orders, erpNames) : null }
            : cur
        );
        setPrevLoading(false);
      });
    } catch (e: any) {
      if (ordersGenRef.current !== gen) return;
      console.error("카카오T 이용내역 로드 실패:", e);
      setOrdersError(String(e?.message || "카카오T 이용내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."));
      setOrdersData(null);
      setPrevLoading(false);
    } finally {
      if (ordersGenRef.current === gen) setOrdersLoading(false);
    }
  }, [month, adminPinHash]);

  // 성공 시 새 목록을 반환하고, 실패 시 null 을 반환한다 — 쓰기 작업이 "재조회로 반영을 확인"할 때
  // 이 반환값을 쓴다(재조회 실패를 성공 알림으로 덮으면 안 되므로).
  // forceRefresh=true 는 '새로고침' 버튼 전용 — 백엔드 캐시를 우회해 카카오에서 실시간 조회한다.
  // 직원이 방금 카카오T 인증을 마쳐(우리가 무효화 못 하는 외부 변경) 목록에 아직 없을 때 즉시 반영.
  const loadMembers = useCallback(async (forceRefresh?: boolean): Promise<KakaoTaxiMember[] | null> => {
    const gen = ++membersGenRef.current;
    membersRequestedRef.current = true;
    setMembersLoading(true);
    setMembersError("");
    try {
      const [membersRes, groups, branchList] = await Promise.all([
        gasClient.getKakaoTaxiMembers(adminPinHash, forceRefresh),
        gasClient.getKakaoTaxiGroups(adminPinHash, forceRefresh),
        // 부서 드롭다운용 ERP 지점 목록 — 실패해도 직원 목록은 보여준다(드롭다운만 비게 됨)
        gasClient.getBranchList().catch(() => []),
      ]);
      const members = membersRes.members || [];
      if (membersGenRef.current === gen) {
        setMembersData({ members, groups: groups || [] });
        setErpBranches(Array.from(new Set([
          ...(branchList || []).filter((b) => b.role === "branch").map((b) => b.branchName).filter(Boolean),
          "본사",
        ])).sort((a, b) => a.localeCompare(b, "ko")));
      }
      return members;
    } catch (e: any) {
      if (membersGenRef.current === gen) {
        console.error("카카오T 직원 목록 로드 실패:", e);
        setMembersError(String(e?.message || "카카오T 직원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."));
        setMembersData(null);
      }
      return null;
    } finally {
      if (membersGenRef.current === gen) setMembersLoading(false);
    }
  }, [adminPinHash]);

  // 전 지점의 신청 배열을 취합한다. 조회 실패 지점은 빈 결과로 위장하지 않고 실패로 드러낸다
  // (급여 변동 이력 탭과 같은 규약 — 실패를 숨기면 대기 신청이 없는 것처럼 보인다).
  const loadRequests = useCallback(async () => {
    const gen = ++requestsGenRef.current;
    requestsRequestedRef.current = true;
    setRequestsLoading(true);
    setRequestsError("");
    try {
      const branchList = await gasClient.getBranchList();
      const branches = (branchList || []).filter((b) => b.role === "branch").map((b) => b.branchName).filter(Boolean);
      const failed: string[] = [];
      const results = await Promise.all(branches.map(async (branch) => {
        try {
          const arr = await gasClient.getSharedDataFromServer<KakaoTaxiRequest[]>(kakaoTaxiRequestsKey(branch));
          return Array.isArray(arr) ? arr : [];
        } catch {
          failed.push(branch);
          return [] as KakaoTaxiRequest[];
        }
      }));
      if (requestsGenRef.current !== gen) return;
      setRequestsData({ items: sortRequests(results.flat()), failed });
    } catch (e: any) {
      if (requestsGenRef.current !== gen) return;
      console.error("카카오T 신청 목록 로드 실패:", e);
      setRequestsError(String(e?.message || "신청 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."));
      setRequestsData(null);
    } finally {
      if (requestsGenRef.current === gen) setRequestsLoading(false);
    }
  }, []);

  // 세션 pinHash 가 바뀌면(재로그인) 이전 계정으로 받아둔 자료와 조회 표식을 비운다.
  useEffect(() => {
    ordersRequestedMonthRef.current = null;
    membersRequestedRef.current = false;
    requestsRequestedRef.current = false;
    setOrdersData(null);
    setMembersData(null);
    setRequestsData(null);
  }, [adminPinHash]);

  // 이용내역·이상 점검은 같은 자료를 쓴다. 이미 그 달의 조회를 시작했다면 탭 전환만으로 다시 부르지 않는다.
  // 신청 관리는 직원 목록(수정 처리·그룹 선택)도 필요해 members 를 함께 불러온다.
  useEffect(() => {
    if (view === "orders" || view === "anomaly") {
      if (ordersRequestedMonthRef.current !== month) void loadOrders();
    } else if (view === "members") {
      if (!membersRequestedRef.current) void loadMembers();
    } else if (view === "requests") {
      if (!membersRequestedRef.current) void loadMembers();
      if (!requestsRequestedRef.current) void loadRequests();
    }
  }, [view, month, loadOrders, loadMembers, loadRequests]);

  // ---------- 파생 데이터 ----------
  const rows = ordersData?.current ?? [];
  const shownMonth = ordersData?.month ?? month;
  const stale = ordersData != null && ordersData.month !== month;
  const branchTotals = useMemo(() => aggregateByBranch(rows), [rows]);
  const memberTotals = useMemo(() => aggregateByMember(rows), [rows]);
  const totalsOk = useMemo(() => verifyBranchTotals(rows, branchTotals), [rows, branchTotals]);
  const countMismatch = ordersData != null && ordersData.reportedCount !== rows.length;
  const totalAmount = useMemo(() => rows.reduce((acc, r) => acc + r.amount, 0), [rows]);
  const visibleRows = useMemo(
    () => {
      const filtered = rows.filter((r) =>
        (branchFilter === "all" || r.branchName === branchFilter) &&
        (memberFilter === "all" || r.memberKey === memberFilter)
      );
      // 최신 이용이 위로 오도록 이용일시(timeText = 출발시각||호출시각) 내림차순 정렬.
      // rows 원본을 변형하지 않게 복사 후 정렬하고, 날짜 파싱 불가 시 문자열 역순으로 폴백한다.
      return [...filtered].sort((a, b) => {
        const ta = Date.parse(a.timeText);
        const tb = Date.parse(b.timeText);
        if (!isNaN(ta) && !isNaN(tb)) return tb - ta;
        return String(b.timeText).localeCompare(String(a.timeText));
      });
    },
    [rows, branchFilter, memberFilter]
  );
  const thresholds = useMemo(() => ({ ...DEFAULT_TAXI_THRESHOLDS, highFare }), [highFare]);
  const flagged = useMemo(() => flagTaxiOrders(rows, thresholds), [rows, thresholds]);
  const surges = useMemo(
    () => (ordersData?.prev ? detectMemberSurges(rows, memberAmountMap(ordersData.prev), thresholds) : []),
    [rows, ordersData?.prev, thresholds]
  );
  // 직원 관리 탭의 지점 필터 — 부서 표기를 ERP 지점명(별칭 포함)으로 해석해 묶는다.
  const memberBranchOf = useCallback((m: KakaoTaxiMember): string => {
    const dept = (m.department || "").trim();
    if (!dept) return "";
    if (erpBranches.includes(dept)) return dept;
    const alias = KAKAO_BRANCH_ALIASES[dept];
    return alias && erpBranches.includes(alias) ? alias : dept;
  }, [erpBranches]);

  const memberBranchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of membersData?.members || []) {
      const b = memberBranchOf(m);
      if (b) set.add(b);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [membersData?.members, memberBranchOf]);

  const visibleMembers = useMemo(() => {
    const list = membersData?.members || [];
    if (memberBranchFilter === "all") return list;
    if (memberBranchFilter === "unassigned") return list.filter((m) => !(m.department || "").trim());
    return list.filter((m) => memberBranchOf(m) === memberBranchFilter);
  }, [membersData?.members, memberBranchFilter, memberBranchOf]);

  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of membersData?.groups ?? []) map.set(g.id, g.name);
    return map;
  }, [membersData?.groups]);

  const downloadExcel = async () => {
    if (stale || ordersLoading) { window.alert(`선택하신 ${month} 자료를 아직 불러오지 못했습니다. 조회가 끝난 뒤 다시 시도해주세요.`); return; }
    if (countMismatch) {
      // 불완전한 파일은 만들지 않는다 — 카카오 보고 건수와 수집 건수가 다르면 누락 가능성이 있다.
      window.alert(`카카오가 보고한 건수(${formatNumber(ordersData!.reportedCount)}건)와 수집된 건수(${formatNumber(rows.length)}건)가 달라 다운로드를 취소했습니다.\n'새로고침'을 눌러 다시 조회해주세요.`);
      return;
    }
    if (!visibleRows.length) { window.alert("내려받을 이용내역이 없습니다."); return; }
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildOrdersExcelRows(visibleRows)), "이용내역");
    const suffix = branchFilter === "all" ? "" : `_${branchFilter}`;
    XLSX.writeFile(wb, `카카오T택시_이용내역_${shownMonth}${suffix}.xlsx`);
  };

  // 직원 쓰기(등록·수정·휴직·삭제) 성공 후 — 부서(지점) 변경은 이용내역의 지점/직원 집계를 바꾼다.
  // 백엔드도 쓰기 시점에 이용내역 캐시를 무효화하므로, 화면의 조회 표식을 지워 다음에
  // 이용내역/이상 점검 탭을 열 때 새로 조회하게 한다(안 지우면 묵은 집계가 그대로 보인다).
  const markOrdersStaleAfterMemberWrite = () => {
    ordersRequestedMonthRef.current = null;
  };

  // ---------- 직원 쓰기 작업 (전부 확인 모달 → 성공 시 재조회, 낙관적 갱신 금지) ----------
  // 한 건이라도 쓰기가 진행 중이면 다른 행의 버튼도 전부 잠근다 — 동시 실행되면 busy 표시가
  // 서로를 덮어쓰고, 늦게 끝난 재조회가 최신 목록을 지워버린다.
  const memberWriteBusy = !!memberBusyId;
  // verify: 재조회한 목록에서 이 처리가 실제 반영됐는지 판정한다.
  // true=확인됨 / false=목록상 미반영 / null=목록만으로 판정 불가(예: 휴직 직원이 인증완료 목록에서 빠지는 경우).
  // "완료" 알림은 verify 가 true 일 때만 — 재조회 실패나 미반영을 성공이라고 말하지 않는다.
  const runMemberAction = async (
    member: KakaoTaxiMember,
    label: string,
    action: () => Promise<unknown>,
    verify: (list: KakaoTaxiMember[]) => boolean | null
  ) => {
    if (memberWriteBusy) return;
    if (!window.confirm(`${member.name || member.identifier} 님을 ${label} 처리할까요?\n카카오T 비즈니스에 바로 반영됩니다.`)) return;
    setMemberBusyId(member.id);
    try {
      await action();
      markOrdersStaleAfterMemberWrite();
      const list = await loadMembers();
      if (list === null) {
        window.alert(`${label} 요청은 접수됐지만 목록 재조회에 실패해 반영 여부를 확인하지 못했습니다.\n'새로고침'을 눌러 직접 확인해주세요.`);
      } else {
        const confirmed = verify(list);
        if (confirmed === true) {
          window.alert(`${label} 처리가 완료되었습니다. (목록에서 반영 확인됨)`);
        } else if (confirmed === false) {
          window.alert(`${label} 요청은 접수됐지만 목록에서 아직 반영이 확인되지 않습니다.\n잠시 후 '새로고침'으로 다시 확인해주세요.`);
        } else {
          window.alert(`${label} 요청이 접수되었습니다.\n이 화면은 인증완료 직원만 보여주는 카카오 정책상 반영 여부를 목록으로 단정할 수 없으니, 최종 상태는 카카오T 관리시스템에서 확인해주세요.`);
        }
      }
    } catch (e: any) {
      window.alert(`${label} 처리에 실패했습니다.\n${String(e?.message || e)}`);
    } finally {
      setMemberBusyId("");
    }
  };

  const sendTms = async (member: KakaoTaxiMember) => {
    if (memberWriteBusy) return;
    if (!window.confirm(`${member.name || member.identifier} 님에게 카카오T 인증 알림톡을 보낼까요?`)) return;
    setMemberBusyId(member.id);
    try {
      await gasClient.sendKakaoTaxiMemberTms(member.id, adminPinHash);
      window.alert("인증 알림톡을 보냈습니다.");
    } catch (e: any) {
      window.alert(`알림톡 발송에 실패했습니다.\n${String(e?.message || e)}`);
    } finally {
      setMemberBusyId("");
    }
  };

  // ---------- 등록 폼 ----------
  const [regName, setRegName] = useState("");
  const [regIdentifier, setRegIdentifier] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regDepartment, setRegDepartment] = useState("");
  const [regGroupId, setRegGroupId] = useState("");
  const [regBusy, setRegBusy] = useState(false);

  const submitRegister = async () => {
    if (regBusy || memberWriteBusy) return; // 수정/휴직 등 다른 쓰기와 동시 실행 금지 — 재조회가 서로를 덮는다
    const identifier = regIdentifier.trim() || regName.trim(); // 사번 문화가 없어 이름을 사번으로 쓰는 기존 관례(실데이터 확인)를 따른다
    const phone = regPhone.replace(/[^0-9]/g, "");
    if (!regName.trim()) { window.alert("이름을 입력해주세요."); return; }
    if (!/^01[0-9]{8,9}$/.test(phone)) { window.alert("휴대전화번호를 확인해주세요. (예: 01012345678)"); return; }
    if (!regGroupId) { window.alert("그룹을 선택해주세요."); return; }
    const groupName = groupNameById.get(regGroupId) || regGroupId;
    if (!window.confirm(`카카오T 비즈니스에 직원을 등록할까요?\n\n이름: ${regName.trim()}\n휴대전화: ${phone}\n그룹: ${groupName}${regDepartment.trim() ? `\n부서(지점): ${regDepartment.trim()}` : ""}`)) return;
    setRegBusy(true);
    try {
      const input: KakaoTaxiMemberInput = {
        identifier, mobile_phone: phone, group_ids: [regGroupId], name: regName.trim(),
        ...(regDepartment.trim() ? { department: regDepartment.trim() } : {}),
      };
      const created = await gasClient.registerKakaoTaxiMember(input, adminPinHash);
      markOrdersStaleAfterMemberWrite();
      setRegName(""); setRegIdentifier(""); setRegPhone(""); setRegDepartment("");
      // 등록 직후엔 '미인증' 상태라 인증완료 목록에 아직 안 보인다 — 알림톡으로 인증을 유도해야 목록에 들어온다.
      if (created?.id && window.confirm("등록되었습니다. 지금 바로 인증 알림톡을 보낼까요?\n(직원이 카카오T 앱에서 인증해야 법인택시를 쓸 수 있습니다)")) {
        try {
          await gasClient.sendKakaoTaxiMemberTms(created.id, adminPinHash);
          window.alert("인증 알림톡을 보냈습니다. 직원이 인증을 마치면 아래 목록에 나타납니다.");
        } catch (e: any) {
          window.alert(`등록은 되었지만 알림톡 발송에 실패했습니다.\n${String(e?.message || e)}`);
        }
      }
      await loadMembers();
    } catch (e: any) {
      window.alert(`직원 등록에 실패했습니다.\n${String(e?.message || e)}`);
    } finally {
      setRegBusy(false);
    }
  };

  // ---------- 직원 수정 폼 ----------
  const [editing, setEditing] = useState<KakaoTaxiMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDept, setEditDept] = useState("");
  const [editGroupIds, setEditGroupIds] = useState<string[]>([]);
  const [editBusy, setEditBusy] = useState(false);

  // 일반 수정(직원 관리 탭의 [수정])으로 진입할 때는 지점 요청 연결을 반드시 끊는다 —
  // 안 끊으면 무관한 직원을 저장했을 때 열려 있던 지점 수정요청이 "완료"로 잘못 처리된다.
  const startEdit = (m: KakaoTaxiMember, linkedRequest: KakaoTaxiRequest | null = null) => {
    setLinkedUpdateRequest(linkedRequest);
    setEditing(m);
    setEditName(m.name || "");
    setEditPhone(m.mobile_phone || "");
    setEditDept(m.department || "");
    setEditGroupIds(m.group_ids || []);
  };

  const toggleEditGroup = (id: string) => {
    setEditGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  // 그룹 선택지: 활성 그룹 전부 + (비활성이거나 목록에 없는) 직원의 현재 소속 그룹.
  // 현재 소속을 빼고 그리면 저장 시 소속이 조용히 떨어져 나간다 — 반드시 포함해 보여준다.
  const editGroupOptions = useMemo(() => {
    const groups = membersData?.groups ?? [];
    const known = new Set(groups.map((g) => g.id));
    const extras = (editing?.group_ids || []).filter((id) => !known.has(id)).map((id) => ({ id, name: `(알 수 없는 그룹 ${id})` }));
    return [
      ...groups
        .filter((g) => g.status === "enabled" || (editing?.group_ids || []).includes(g.id))
        .map((g) => ({ id: g.id, name: g.status === "enabled" ? g.name : `${g.name} (비활성)` })),
      ...extras,
    ];
  }, [membersData?.groups, editing]);

  const saveEdit = async () => {
    if (!editing || editBusy || memberWriteBusy || regBusy) return; // 등록 등 다른 쓰기와 동시 실행 금지
    const phone = editPhone.replace(/[^0-9]/g, "");
    if (!/^01[0-9]{8,9}$/.test(phone)) { window.alert("휴대전화번호를 확인해주세요. (예: 01012345678)"); return; }
    if (!editGroupIds.length) { window.alert("그룹을 최소 1개 선택해주세요."); return; }
    // [카카오 API 제한] 직원의 그룹을 '빼는' 수정은 카카오가 500(Internal Server Error)으로 거부한다
    // (그룹 추가·유지·부서·이름 변경은 정상). 500을 맞기 전에 막고 대안을 안내한다. 2026-07-26 실측 확인.
    const removedGroups = (editing.group_ids || []).filter((id) => !editGroupIds.includes(id));
    if (removedGroups.length) {
      const names = removedGroups.map((id) => groupNameById.get(id) || id).join(", ");
      window.alert(
        `카카오T API 제한으로 '그룹 빼기'는 현재 처리되지 않습니다(카카오 서버 오류).\n` +
        `빼려는 그룹: ${names}\n\n` +
        `• 그룹 추가·부서·이름 변경만 저장하거나\n` +
        `• 그룹 제거가 꼭 필요하면 카카오T 비즈니스 관리 웹에서 처리해주세요.`
      );
      return;
    }
    const phoneChanged = phone !== (editing.mobile_phone || "").replace(/[^0-9]/g, "");
    const groupNames = editGroupIds.map((id) => groupNameById.get(id) || id).join(", ");
    if (!window.confirm(
      `${editing.name || editing.identifier} 님의 정보를 수정할까요? 카카오T 비즈니스에 바로 반영됩니다.\n\n` +
      `이름: ${editName.trim() || "(공백)"}\n` +
      `휴대전화: ${phone}${phoneChanged ? "  ← 변경됨: 새 번호로 인증 알림톡이 자동 발송됩니다" : ""}\n` +
      `부서(지점): ${editDept.trim() || "(공백)"}\n그룹: ${groupNames}`
    )) return;
    setEditBusy(true);
    setMemberBusyId(editing.id);
    let claimedForUpdate = false; // 지점 요청 선점을 잡았는지 — 실패 시 되돌리기 위해
    try {
      // [동시 수정 방지] 카드를 열어둔 사이 다른 기기에서 이 직원이 바뀌었을 수 있다.
      // 저장 전에 최신본을 확인해, 스냅샷과 다르면 덮어쓰지 않고 최신 정보로 폼을 다시 연다.
      const freshList = await loadMembers();
      if (freshList === null) {
        // 최신 상태를 모르는 채 저장하면 이 방지 장치가 통째로 우회된다 — 확인 실패면 저장도 하지 않는다(fail-closed).
        window.alert("최신 직원 정보를 확인하지 못해 저장을 취소했습니다.\n네트워크 확인 후 다시 시도해주세요. (입력하신 내용은 그대로 남아 있습니다)");
        return;
      }
      {
        const fresh = freshList.find((x) => x.id === editing.id);
        if (!fresh) {
          window.alert("이 직원이 목록에서 사라졌습니다(다른 기기에서 삭제되었을 수 있음). 저장을 취소합니다.");
          setEditing(null);
          return;
        }
        const changedElsewhere =
          (fresh.name || "") !== (editing.name || "") ||
          (fresh.department || "") !== (editing.department || "") ||
          (fresh.mobile_phone || "") !== (editing.mobile_phone || "") ||
          JSON.stringify([...(fresh.group_ids || [])].sort()) !== JSON.stringify([...(editing.group_ids || [])].sort());
        if (changedElsewhere) {
          window.alert("카드를 열어둔 사이 이 직원의 정보가 다른 곳에서 바뀌었습니다.\n덮어쓰지 않도록 저장을 취소하고 최신 정보로 다시 열었으니, 확인 후 다시 저장해주세요.");
          startEdit(fresh, linkedUpdateRequest); // 지점 요청 연결은 유지 — 같은 직원이므로 재저장 시 그대로 완료 처리된다
          return;
        }
      }
      // 지점 '수정 요청'을 승인해 연 카드라면 **카카오 호출 직전에** 선점한다.
      // (카드를 열 때 선점하면 사람이 입력하는 몇 분 동안 '처리 중'으로 잠겨 고착 해제 규칙과 충돌한다.)
      // 두 관리자가 각자 카드를 열어도 먼저 저장한 한 명만 선점에 성공해 PUT 을 실행한다.
      if (linkedUpdateRequest && linkedUpdateRequest.memberId === editing.id) {
        if (!(await claimForProcessing(linkedUpdateRequest))) {
          setLinkedUpdateRequest(null);
          return; // 다른 관리자가 이미 처리했거나 처리 중 — 카카오를 부르지 않는다
        }
        claimedForUpdate = true;
      }
      await gasClient.updateKakaoTaxiMember(editing.id, {
        mobile_phone: phone,
        group_ids: editGroupIds,
        name: editName.trim(),
        department: editDept.trim(),
      }, adminPinHash);
      markOrdersStaleAfterMemberWrite();
      // 쓰기 성공 알림은 재조회로 실제 반영을 확인한 뒤에만 — runMemberAction 과 같은 규약
      const list = await loadMembers();
      if (list === null) {
        window.alert("수정 요청은 접수됐지만 목록 재조회에 실패해 반영 여부를 확인하지 못했습니다.\n'새로고침'을 눌러 직접 확인해주세요.");
      } else {
        const updated = list.find((x) => x.id === editing.id);
        const applied = !!updated
          && (updated.name || "") === editName.trim()
          && (updated.department || "") === editDept.trim()
          && JSON.stringify([...(updated.group_ids || [])].sort()) === JSON.stringify([...editGroupIds].sort());
        if (applied) window.alert("수정이 완료되었습니다. (목록에서 반영 확인됨)");
        else window.alert("수정 요청은 접수됐지만 목록에서 아직 반영이 확인되지 않습니다.\n잠시 후 '새로고침'으로 다시 확인해주세요.");
      }
      // 지점의 '수정 요청'을 승인해서 연 수정이었다면, 저장 성공으로 그 신청을 완료 처리한다.
      // 연결된 요청의 대상과 지금 저장한 직원이 같을 때만 — 중간에 다른 직원으로 바뀌었으면 건드리지 않는다.
      if (linkedUpdateRequest && linkedUpdateRequest.memberId === editing.id) {
        const rec = await recordRequestResult(linkedUpdateRequest, { status: "approved", resultNote: "정보 수정 완료" });
        claimedForUpdate = false; // 최종 상태까지 기록했으므로 되돌릴 선점이 없다
        if (rec === "recordFailed") {
          window.alert("수정은 반영됐지만 신청 상태 기록에 실패했습니다.\n신청 관리에서 새로고침 후 '처리 중'으로 남아 있으면 [처리 중 해제]로 정리해주세요(수정은 이미 반영됨).");
        } else if (rec === "already") {
          // CAS 충돌 — 내가 수정하는 사이 다른 관리자가 이 신청을 가로챘다.
          window.alert(
            "수정은 카카오T에 반영됐지만, 그 사이 다른 관리자가 이 신청을 처리했습니다.\n" +
            "중복 처리 흔적이 있을 수 있으니 신청 관리와 직원 관리에서 실제 상태를 확인해주세요."
          );
        }
        setLinkedUpdateRequest(null);
        void loadRequests();
      }
      setEditing(null);
    } catch (e: any) {
      // 카카오 호출 직전에 잡은 선점만 되돌린다 — 단, '실행되지 않은 것이 확실한' 오류일 때만.
      // 타임아웃·통신 끊김은 이미 반영됐을 수 있어 풀면 중복 수정이 된다.
      if (claimedForUpdate && linkedUpdateRequest && isDefinitelyNotExecuted(e)) {
        await releaseRequestClaim(linkedUpdateRequest);
        claimedForUpdate = false;
        void loadRequests();
        window.alert(`직원 수정에 실패했습니다. 해당 신청은 대기 상태로 되돌렸습니다.\n${String(e?.message || e)}`);
      } else if (claimedForUpdate && linkedUpdateRequest) {
        void loadRequests();
        window.alert(
          `수정 결과를 확인하지 못했습니다(응답 지연·통신 끊김).\n${String(e?.message || e)}\n\n` +
          `이미 반영됐을 수 있어 신청을 '처리 중'으로 남겨 둡니다. 목록에서 실제 값을 확인한 뒤 정리해주세요.`
        );
      } else {
        window.alert(`직원 수정에 실패했습니다.\n${String(e?.message || e)}`);
      }
    } finally {
      setEditBusy(false);
      setMemberBusyId("");
    }
  };

  // ---------- 신청 처리 (승인/반려) ----------
  // 선점 소유자 표식 — 같은 브라우저 세션이 잡은 선점만 스스로 풀 수 있게 한다.
  // 관리자 계정이 하나뿐이라 이름만으로는 기기 구분이 안 되므로 세션 고유값을 덧붙인다.
  const claimOwner = useMemo(
    () => `${user?.branchName || "관리자"}#${Math.random().toString(36).slice(2, 8)}`,
    // 세션(로그인) 단위로 고정 — 렌더마다 바뀌면 자기 선점도 못 푼다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.branchName]
  );
  /**
   * 이 오류를 보고 "카카오가 실행되지 않았다"고 단정할 수 있는가?
   *
   * 타임아웃·네트워크 단절은 **요청이 서버에 닿아 실행됐을 수도** 있다. 이때 선점을 풀면
   * 다른 관리자가 재승인해 중복 등록/삭제가 된다. 그런 오류는 'processing' 으로 남겨
   * 사람이 직원 관리에서 실제 반영을 확인한 뒤 [처리 중 해제]로 정리하게 한다.
   */
  const isDefinitelyNotExecuted = (e: any): boolean => {
    const msg = String(e?.message || e || "");
    const name = String(e?.name || "");
    if (name === "AbortError" || /aborted|timeout|시간이 초과|응답이 지연|network|Failed to fetch|NetworkError/i.test(msg)) return false;
    // 값 검증 실패 등 백엔드가 카카오를 부르기 전에 거부한 경우는 실행되지 않은 것이 확실하다.
    if (/필요합니다|올바르지 않|지정되지 않았습니다|관리자만|연동 정보가 없습니다/.test(msg)) return true;
    // 카카오가 명시적 오류코드를 준 경우도 실행 실패로 본다.
    if (/카카오T API 오류/.test(msg)) return true;
    return false; // 알 수 없는 오류는 안전한 쪽(실행됐을 수 있음)으로 본다
  };

  const requestBusy = !!requestBusyId;
  const anyWriteBusy = requestBusy || memberWriteBusy || regBusy || editBusy;

  /**
   * 카카오 API 를 부르기 **전에** 그 신청을 processing 으로 선점해 저장한다.
   * 두 관리자가 거의 동시에 승인해도 늦게 온 쪽은 pending 이 아니라 선점에 실패한다(이중 등록 방지).
   * 선점 자체가 실패하면 아무것도 실행하지 않는다(fail-closed).
   */
  const claimForProcessing = async (request: KakaoTaxiRequest): Promise<boolean> => {
    try {
      // [원자적 선점] 읽고-고치고-쓰기로는 두 관리자가 동시에 통과해 카카오 등록이 두 번 실행될 수 있다.
      // Firestore 트랜잭션 안에서 "아직 pending 일 때만" processing 으로 바꾼다 — 하나만 성공한다.
      const { outcome } = await gasClient.updateSharedArrayItem(
        kakaoTaxiRequestsKey(request.branchName), request.id, ["pending"],
        { status: "processing", claimedAt: new Date().toISOString(), claimedBy: claimOwner }
      );
      if (outcome !== "updated") {
        window.alert(outcome === "notFound"
          ? "이 신청을 찾을 수 없습니다(지점에서 삭제되었을 수 있음). 목록을 새로고침합니다."
          : "다른 관리자가 이미 처리 중이거나 처리를 마친 신청입니다. 목록을 새로고침합니다.");
        void loadRequests();
        return false;
      }
      return true;
    } catch (e) {
      console.error("신청 선점 실패:", e);
      window.alert("신청 상태를 확인하지 못해 처리를 취소했습니다. 네트워크 확인 후 다시 시도해주세요.");
      return false;
    }
  };

  /**
   * 카카오 실행이 실패했을 때 선점을 되돌린다.
   * [소유자 한정] 내가 잡은 선점(claimedBy === 나)만 푼다 — 조건 없이 풀면 그 사이 다른 관리자가
   * 새로 선점해 실행 중인 건까지 대기로 되돌려 이중 실행을 열어 준다.
   * 관리자가 화면에서 강제로 푸는 [처리 중 해제]는 소유자 무관이므로 force=true 로 부른다.
   */
  const releaseRequestClaim = async (request: KakaoTaxiRequest, force = false) => {
    try {
      await gasClient.updateSharedArrayItem(
        kakaoTaxiRequestsKey(request.branchName), request.id, ["processing"],
        { status: "pending", claimedAt: null, claimedBy: null },
        force ? undefined : { claimedBy: claimOwner }
      );
    } catch (e) {
      console.error("신청 선점 해제 실패:", e);
    }
  };

  /**
   * 처리 결과 기록도 원자적으로 — 배열 전체를 덮어쓰지 않으므로 그 사이 지점이 올린 신규 신청이 날아가지 않는다.
   *
   * [중요] 허용 상태가 승인과 반려에서 다르다.
   * - 승인 기록: ["processing"] — 내가 선점해 카카오를 실행한 건만 최종 승인으로 넘긴다.
   * - 반려: ["pending"] — 다른 관리자가 이미 선점(processing)해 카카오 작업 중인 건을 반려로 가로채면,
   *   카카오는 반영됐는데 기록은 반려인 불일치가 생긴다. 그래서 대기 상태에서만 반려한다.
   */
  const recordRequestResult = async (
    request: KakaoTaxiRequest,
    patch: { status: "approved" | "rejected"; rejectReason?: string; resultNote?: string }
  ): Promise<"ok" | "already" | "recordFailed"> => {
    if (patch.status === "rejected" && !patch.rejectReason?.trim()) return "recordFailed";
    // 반려: 대기 상태만(진행 중인 승인을 가로채지 않게).
    // 승인: **내가 선점한 processing 만** — status 만 보면, 내 처리가 늦어져 누가 강제 해제하고
    // 다시 선점한 사이에 내 늦은 기록이 도착해 남의 처리를 덮어쓴다(승인 이중 실행의 흔적을 지움).
    const expectStatus = patch.status === "rejected" ? ["pending"] : ["processing"];
    const expectMatch = patch.status === "rejected" ? undefined : { claimedBy: claimOwner };
    const payload = {
      status: patch.status,
      processedAt: new Date().toISOString(),
      // 최종 상태로 넘어가면 선점 표식은 정리한다(고착 판정·소유자 비교 대상에서 빠지게)
      claimedAt: null,
      claimedBy: null,
      ...(patch.rejectReason?.trim() ? { rejectReason: patch.rejectReason.trim() } : {}),
      ...(patch.resultNote ? { resultNote: patch.resultNote } : {}),
    };
    // 기록에 실패하면 신청이 'processing' 에 갇혀 아무도 처리할 수 없게 된다(카카오는 이미 실행된 상태).
    // 일시적 네트워크 오류를 넘기려고 한 번 더 시도한다. 그래도 실패하면 화면의 '처리 중 해제'로 푼다.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { outcome } = await gasClient.updateSharedArrayItem(
          kakaoTaxiRequestsKey(request.branchName), request.id, expectStatus, payload, expectMatch
        );
        if (outcome === "updated") return "ok";
        if (outcome === "conflict") return "already";
        return "recordFailed"; // notFound — 재시도해도 없다
      } catch (e) {
        console.error(`신청 상태 기록 실패(${attempt + 1}/2):`, e);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      }
    }
    return "recordFailed";
  };

  /**
   * '처리 중'에 갇힌 신청을 관리자가 수동으로 푼다.
   * 카카오 실행은 이미 끝났을 수 있으므로(기록만 실패한 경우), 되돌리기 전에 그 사실을 분명히 경고한다.
   *
   * [제한] 선점 직후에는 풀 수 없다 — 지금 다른 관리자가 정상 처리 중인 건을 풀어 버리면
   * 두 사람이 동시에 카카오를 실행하게 된다. 선점 후 STUCK_AFTER_MS 가 지난 건만 대상이다.
   */
  const unstickProcessing = async (request: KakaoTaxiRequest) => {
    if (anyWriteBusy) return;
    if (!isStuckProcessing(request)) {
      window.alert("다른 관리자가 방금 처리를 시작한 신청입니다.\n잠시 기다렸다 목록을 새로고침해주세요. (응답이 끊긴 경우에만 해제할 수 있습니다)");
      return;
    }
    if (!window.confirm(
      `'${request.name}' 신청을 대기 상태로 되돌릴까요?\n\n` +
      `※ 카카오T 작업이 이미 실행되고 기록만 실패했을 수 있습니다.\n` +
      `되돌린 뒤 그대로 다시 승인하면 중복 등록/삭제가 될 수 있으니,\n` +
      `먼저 '직원 관리' 탭에서 실제 반영 여부를 확인해주세요.`
    )) return;
    setRequestBusyId(request.id);
    try {
      await releaseRequestClaim(request, true); // 강제 — 남이 잡고 멈춘 건을 푸는 것이 이 버튼의 목적
      await loadRequests();
      window.alert("대기 상태로 되돌렸습니다. 직원 관리 탭에서 실제 반영 여부를 확인한 뒤 처리해주세요.");
    } finally {
      setRequestBusyId("");
    }
  };

  // 선점 후 이 시간이 지나도 '처리 중'이면 응답이 끊긴 것으로 보고 수동 해제를 허용한다.
  // 정상 처리(카카오 호출~기록)는 수 초면 끝나므로 5분은 충분히 여유 있는 값이다.
  const STUCK_AFTER_MS = 5 * 60 * 1000;
  const isStuckProcessing = (r: KakaoTaxiRequest): boolean => {
    if (r.status !== "processing") return false;
    if (!r.claimedAt) return true; // 선점 시각이 없는 옛 레코드는 고아로 보고 해제 허용
    const claimed = new Date(r.claimedAt).getTime();
    if (isNaN(claimed)) return true;
    return Date.now() - claimed >= STUCK_AFTER_MS;
  };

  /** 등록 신청 승인 폼의 그룹 기본값 — 지점명과 그룹명이 겹치면 추천, 아니면 관리자가 직접 선택 */
  const guessGroupId = (branch: string): string => {
    const enabled = (membersData?.groups || []).filter((g) => g.status === "enabled");
    const hit = enabled.find((g) => branch.includes(g.name) || g.name.includes(branch));
    return hit?.id || "";
  };

  const executeApproveRegister = async () => {
    if (!approveTarget || anyWriteBusy) return;
    const request = approveTarget;
    if (!request.phone) { window.alert("신청에 휴대전화번호가 없습니다 — 반려 처리해주세요."); return; }
    if (!approveGroupId) { window.alert("등록할 그룹을 선택해주세요."); return; }
    const groupName = groupNameById.get(approveGroupId) || approveGroupId;
    if (!window.confirm(
      `승인하고 카카오T 비즈니스에 등록할까요?\n\n지점: ${request.branchName}\n이름: ${request.name}\n휴대전화: ${request.phone}\n그룹: ${groupName}\n\n등록되면 직원 휴대폰으로 카카오T 인증 알림톡이 발송됩니다.`
    )) return;
    setRequestBusyId(request.id);
    let claimed = false;
    try {
      if (!(await claimForProcessing(request))) return;
      claimed = true;
      const created = await gasClient.registerKakaoTaxiMember({
        identifier: request.name,
        mobile_phone: request.phone,
        group_ids: [approveGroupId],
        name: request.name,
        department: request.branchName, // 부서=지점명 — 이용내역이 이 지점으로 집계되게 한다
      }, adminPinHash);
      markOrdersStaleAfterMemberWrite();
      let tmsNote = "인증 알림톡 발송됨";
      if (created?.id) {
        try {
          await gasClient.sendKakaoTaxiMemberTms(created.id, adminPinHash);
        } catch {
          tmsNote = "인증 알림톡 발송 실패 — 직원 관리에서 재발송 필요";
        }
      }
      const rec = await recordRequestResult(request, { status: "approved", resultNote: `카카오 등록 완료 · ${tmsNote}` });
      if (rec === "recordFailed") {
        window.alert(
          "카카오 등록은 완료됐지만 신청 상태 기록에 실패했습니다.\n" +
          "이 신청은 '처리 중'으로 남아 있습니다 — **다시 승인하지 마세요(중복 등록됩니다).**\n" +
          "새로고침 후에도 '처리 중'이면 [처리 중 해제]로 정리하고, 직원 관리 탭에서 등록 여부를 확인해주세요."
        );
      } else if (rec === "already") {
        window.alert("카카오 등록은 실행됐지만 이 신청은 그 사이 다른 곳에서 처리됐습니다.\n직원 관리에서 중복 등록 여부를 확인해주세요.");
      } else {
        window.alert(`승인 완료 — 카카오T에 등록했고, ${tmsNote}.`);
      }
      claimed = false; // 최종 상태 기록까지 끝났으므로 선점 해제 대상이 아니다
      setApproveTarget(null);
      await Promise.all([loadRequests(), loadMembers()]);
    } catch (e: any) {
      if (claimed && isDefinitelyNotExecuted(e)) {
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert(`등록 실행에 실패했습니다. 신청은 대기 상태로 되돌렸습니다.\n${String(e?.message || e)}`);
      } else {
        void loadRequests();
        window.alert(
          `등록 결과를 확인하지 못했습니다(응답 지연·통신 끊김).\n${String(e?.message || e)}\n\n` +
          `카카오T에 이미 등록됐을 수 있어 신청을 '처리 중'으로 남겨 둡니다.\n` +
          `직원 관리 탭에서 등록 여부를 확인한 뒤, 등록이 안 됐으면 [처리 중 해제] 후 다시 승인해주세요.`
        );
      }
    } finally {
      setRequestBusyId("");
    }
  };

  const executeApproveDelete = async (request: KakaoTaxiRequest) => {
    if (anyWriteBusy) return;
    if (!request.memberId) { window.alert("대상 인원 정보가 없는 신청입니다 — 반려 처리해주세요."); return; }
    if (!window.confirm(`삭제 요청을 승인할까요?\n\n지점: ${request.branchName}\n대상: ${request.name}\n사유: ${request.reason || "-"}\n\n카카오T 비즈니스에서 즉시 삭제됩니다.`)) return;
    setRequestBusyId(request.id);
    let claimed = false;
    try {
      if (!(await claimForProcessing(request))) return;
      claimed = true;
      await gasClient.deleteKakaoTaxiMember(request.memberId, adminPinHash);
      markOrdersStaleAfterMemberWrite();
      const list = await loadMembers();
      const note = list === null
        ? "삭제 실행됨 — 목록 재조회 실패로 반영 미확인"
        : list.some((x) => x.id === request.memberId)
          ? "삭제 접수됨 — 목록에서 아직 반영 미확인"
          : "카카오에서 삭제 확인됨";
      const rec = await recordRequestResult(request, { status: "approved", resultNote: note });
      if (rec === "recordFailed") {
        window.alert(`카카오 삭제는 실행됐지만(${note}) 신청 상태 기록에 실패했습니다.\n새로고침 후 '처리 중'으로 남아 있으면 [처리 중 해제]로 정리해주세요(삭제는 이미 실행됨).`);
      } else if (rec === "already") {
        // CAS 충돌 — 내가 삭제를 실행하는 사이 다른 관리자가 이 신청을 가로챘다.
        window.alert(
          `카카오 삭제는 실행됐지만, 그 사이 다른 관리자가 이 신청을 처리했습니다.\n` +
          `중복 처리 흔적이 있을 수 있으니 직원 관리 탭에서 실제 상태를 확인해주세요.`
        );
      } else {
        window.alert(`삭제 요청 승인 완료 — ${note}.`);
      }
      claimed = false;
      await loadRequests();
    } catch (e: any) {
      if (claimed && isDefinitelyNotExecuted(e)) {
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert(`삭제 실행에 실패했습니다. 신청은 대기 상태로 되돌렸습니다.\n${String(e?.message || e)}`);
      } else {
        void loadRequests();
        window.alert(
          `삭제 결과를 확인하지 못했습니다(응답 지연·통신 끊김).\n${String(e?.message || e)}\n\n` +
          `카카오T에서 이미 삭제됐을 수 있어 신청을 '처리 중'으로 남겨 둡니다.\n` +
          `직원 관리 탭에서 확인한 뒤 정리해주세요.`
        );
      }
    } finally {
      setRequestBusyId("");
    }
  };

  /**
   * 수정 요청 승인 — 카드를 열 때는 선점하지 않는다.
   *
   * 카드 작업은 사람이 입력하는 시간(수 분)이 걸려, 여기서 선점하면 그동안 '처리 중'으로 잠기고
   * 고착 해제(5분) 규칙과도 충돌한다. 대신 **저장 직전(saveEdit)에 선점**하므로,
   * 두 관리자가 각자 카드를 열어도 실제 카카오 수정은 먼저 저장한 한 명만 실행된다.
   */
  const startUpdateApproval = (request: KakaoTaxiRequest) => {
    if (anyWriteBusy) return;
    const member = (membersData?.members || []).find((x) => x.id === request.memberId);
    if (!member) {
      window.alert("대상 인원을 인증완료 목록에서 찾지 못했습니다.\n이미 삭제됐거나 미인증 상태일 수 있으니 확인 후 반려 처리해주세요.");
      return;
    }
    startEdit(member, request);
  };

  /** 수정 카드를 닫을 때 — 선점은 저장 직전에만 하므로 여기서 풀 것은 없다. */
  const closeEditCard = () => {
    setEditing(null);
    setLinkedUpdateRequest(null);
  };

  const executeReject = async () => {
    if (!rejectTarget || anyWriteBusy) return;
    const reason = rejectReason.trim();
    if (!reason) { window.alert("반려 사유를 입력해주세요. (지점 화면에 그대로 표시됩니다)"); return; }
    setRequestBusyId(rejectTarget.id);
    try {
      // 반려는 카카오를 부르지 않으므로 선점 없이 기록만 한다 — markProcessed 가 이미 처리된 건을 걸러준다.
      const rec = await recordRequestResult(rejectTarget, { status: "rejected", rejectReason: reason });
      if (rec === "recordFailed") window.alert("반려 기록에 실패했습니다. 잠시 후 다시 시도해주세요.");
      else if (rec === "already") window.alert("이미 처리됐거나 다른 관리자가 승인 처리 중인 신청이라 반려할 수 없습니다.\n목록을 새로고침해 현재 상태를 확인해주세요.");
      else window.alert("반려 처리했습니다. 지점 화면에 사유가 표시됩니다.");
      setRejectTarget(null);
      setRejectReason("");
      await loadRequests();
    } catch (e: any) {
      window.alert(`반려 처리에 실패했습니다.\n${String(e?.message || e)}`);
    } finally {
      setRequestBusyId("");
    }
  };

  // ---------- 공통 헤더 ----------
  const title = view === "orders" ? "택시 이용내역"
    : view === "anomaly" ? "이상 이용 점검"
    : view === "requests" ? "지점 신청 관리"
    : "카카오T 직원 관리";
  const needsMonth = view === "orders" || view === "anomaly";

  return (
    <section className="space-y-5">
      {/* 제목은 DESIGN_ADMIN 의 바닐라 알약(.admin-pill-title), 동작 버튼은 알약 칩(.admin-period-chip)
          — 분석 탭과 같은 양식(사용자 지시 2026-07-22 방향). 제목에 아이콘을 넣지 않는다. */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="admin-pill-title">{title}</h2>
        {needsMonth && (
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white"
            aria-label="조회 월"
          />
        )}
        <button
          onClick={() => {
            // 새로고침은 백엔드 캐시를 우회해 실시간 조회한다(조회 도중 생긴 새 이용·방금 인증한 직원 반영)
            if (needsMonth) void loadOrders(true);
            else if (view === "requests") { void loadRequests(); void loadMembers(true); }
            else void loadMembers(true);
          }}
          disabled={needsMonth ? ordersLoading : view === "requests" ? requestsLoading : membersLoading}
          className="admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black cursor-pointer disabled:opacity-50"
        >
          새로고침
        </button>
        {view === "orders" && (
          <button onClick={() => void downloadExcel()} className="admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black cursor-pointer">
            엑셀 다운로드
          </button>
        )}
      </div>

      {needsMonth && ordersError && <div className={ERROR_BANNER}>{ordersError}</div>}
      {view === "members" && membersError && <div className={ERROR_BANNER}>{membersError}</div>}
      {needsMonth && !ordersLoading && ordersData && countMismatch && (
        <div className={ERROR_BANNER}>
          카카오가 보고한 건수({formatNumber(ordersData.reportedCount)}건)와 수집된 건수({formatNumber(rows.length)}건)가 다릅니다.
          조회 도중 새 이용이 생겼을 수 있으니 '새로고침'을 눌러주세요.
        </div>
      )}
      {needsMonth && !ordersLoading && ordersData && !totalsOk && (
        <div className={ERROR_BANNER}>집계 검증에 실패했습니다. 화면 수치를 그대로 믿지 마시고 새로고침 후에도 반복되면 알려주세요.</div>
      )}

      {needsMonth && ordersLoading && <div className="py-20 text-center"><LoadingSpinner size="md" /></div>}

      {/* ---------- 이용내역 ---------- */}
      {view === "orders" && !ordersLoading && ordersData && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
              <p className="text-[11px] font-bold text-[#212121]/60">{shownMonth} 총 이용</p>
              <p className="text-lg font-black text-[#212121]">{formatNumber(rows.length)}건</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
              <p className="text-[11px] font-bold text-[#212121]/60">총 금액(요금+톨비)</p>
              <p className="text-lg font-black text-[#212121]">{formatNumber(totalAmount)}원</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
              <p className="text-[11px] font-bold text-[#212121]/60">이용 지점 수</p>
              <p className="text-lg font-black text-[#212121]">{formatNumber(branchTotals.length)}곳</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
              <p className="text-[11px] font-bold text-[#212121]/60">이용 직원 수</p>
              <p className="text-lg font-black text-[#212121]">{formatNumber(memberTotals.length)}명</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><h2 className="admin-pill-title">지점별 합계</h2></div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left">
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121]">지점</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">건수</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">금액</th>
                  </tr></thead>
                  <tbody>
                    {branchTotals.map((b) => (
                      <tr key={b.branchName}
                        onClick={() => { setBranchFilter(b.branchName); setMemberFilter("all"); }}
                        className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${branchFilter === b.branchName ? "bg-gray-100" : ""}`}
                        title="클릭하면 상세 내역이 이 지점만 표시됩니다">
                        <td className="px-4 py-2 font-bold text-[#212121]">
                          {b.branchName}
                          {b.unmapped && <span className="ml-1.5 text-[11px] font-bold text-[#B91C1C]">(미매핑)</span>}
                        </td>
                        <td className="px-4 py-2 text-right">{formatNumber(b.count)}</td>
                        <td className="px-4 py-2 text-right font-bold">{formatNumber(b.amount)}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><h2 className="admin-pill-title">직원별 합계</h2></div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left">
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121]">직원</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121]">지점</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">건수</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">금액</th>
                  </tr></thead>
                  <tbody>
                    {memberTotals.map((m) => (
                      <tr key={m.memberKey}
                        onClick={() => { setMemberFilter(m.memberKey); setBranchFilter("all"); }}
                        className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${memberFilter === m.memberKey ? "bg-gray-100" : ""}`}
                        title="클릭하면 상세 내역이 이 직원만 표시됩니다">
                        <td className="px-4 py-2 font-bold text-[#212121]">{m.name}</td>
                        <td className="px-4 py-2">{m.branchName}</td>
                        <td className="px-4 py-2 text-right">{formatNumber(m.count)}</td>
                        <td className="px-4 py-2 text-right font-bold">{formatNumber(m.amount)}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
              <h2 className="admin-pill-title">상세 내역</h2>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white"
                aria-label="지점 필터"
              >
                <option value="all">전체 지점</option>
                {branchTotals.map((b) => <option key={b.branchName} value={b.branchName}>{b.branchName}</option>)}
              </select>
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white"
                aria-label="직원 필터"
              >
                <option value="all">전체 직원</option>
                {memberTotals.map((m) => <option key={m.memberKey} value={m.memberKey}>{m.name} ({m.branchName})</option>)}
              </select>
              {(branchFilter !== "all" || memberFilter !== "all") && (
                <button
                  onClick={() => { setBranchFilter("all"); setMemberFilter("all"); }}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-black text-[#212121]"
                >필터 해제</button>
              )}
              <span className="text-[11px] font-bold text-[#212121]/60">{formatNumber(visibleRows.length)}건</span>
            </div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead><tr className="text-left">
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">이용일시</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">직원</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">지점</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">출발지 → 도착지</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">금액</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">구분</th>
                </tr></thead>
                <tbody>
                  {/* id 없는 주문이 섞여도 key 가 중복되지 않게 순번으로 폴백 — 필터/정렬 결과라 순번 key 로 충분 */}
                  {visibleRows.map(({ order, branchName, unmapped, amount, timeText }, i) => (
                    <tr key={order.id || `noid-${i}`} className="border-t border-gray-100">
                      <td className="px-4 py-2">{timeText}</td>
                      <td className="px-4 py-2 font-bold text-[#212121]">{order.member_name || "(이름 없음)"}</td>
                      <td className="px-4 py-2">
                        {branchName}
                        {unmapped && <span className="ml-1.5 text-[11px] font-bold text-[#B91C1C]">(미매핑)</span>}
                      </td>
                      <td className="px-4 py-2 max-w-[26rem] truncate" title={`${order.departure_point} → ${order.arrival_point}`}>
                        {order.departure_point} → {order.arrival_point}
                      </td>
                      <td className="px-4 py-2 text-right font-bold">{formatNumber(amount)}원</td>
                      <td className="px-4 py-2">{verticalLabel(order.vertical_code)}</td>
                    </tr>
                  ))}
                  {!visibleRows.length && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">이용내역이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---------- 이상 점검 ---------- */}
      {view === "anomaly" && !ordersLoading && ordersData && (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-bold text-[#212121]">
            <label className="flex items-center gap-2">
              고액 기준(건당)
              <input
                type="number"
                value={highFare}
                min={0}
                step={5000}
                onChange={(e) => setHighFare(Math.max(0, Number(e.target.value) || 0))}
                className="w-28 h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold font-mono bg-white text-right"
              />원 이상
            </label>
            <span className="text-[#212121]/60">급증 기준: 전월 대비 {DEFAULT_TAXI_THRESHOLDS.surgeRatio}배 이상이면서 +{formatNumber(DEFAULT_TAXI_THRESHOLDS.surgeMinIncrease)}원 이상</span>
            <span className="text-[#212121]/60">낮 시간대: {String(DEFAULT_TAXI_THRESHOLDS.dayStartHour).padStart(2, "0")}시~{DEFAULT_TAXI_THRESHOLDS.dayEndHour}시 (심야 퇴근 택시는 정상 패턴으로 봄)</span>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="admin-pill-title">직원별 급증 ({shownMonth} vs 전월) — {formatNumber(surges.length)}명</h2>
            </div>
            {prevLoading ? (
              <p className="px-4 py-6 text-xs font-bold text-[#212121]/50">전월 자료를 불러오는 중입니다… 잠시 후 이 표가 채워집니다.</p>
            ) : ordersData.prev == null ? (
              <p className="px-4 py-6 text-xs font-bold text-[#212121]/50">전월 자료를 불러오지 못해 급증 비교를 건너뛰었습니다. '새로고침'으로 다시 시도해주세요.</p>
            ) : surges.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead><tr className="text-left">
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121]">직원</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121]">지점</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">전월</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">이번달</th>
                    <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">증가액</th>
                  </tr></thead>
                  <tbody>
                    {surges.map((s) => (
                      <tr key={s.memberKey} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-bold text-[#212121]">{s.name}</td>
                        <td className="px-4 py-2">{s.branchName}</td>
                        <td className="px-4 py-2 text-right">{formatNumber(s.prevAmount)}원</td>
                        <td className="px-4 py-2 text-right font-bold">{formatNumber(s.currAmount)}원</td>
                        <td className="px-4 py-2 text-right font-bold">+{formatNumber(s.increase)}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-6 text-xs font-bold text-[#212121]/50">급증한 직원이 없습니다.</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="admin-pill-title">점검 대상 건 — {formatNumber(flagged.length)}건</h2></div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead><tr className="text-left">
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">사유</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">이용일시</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">직원</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">지점</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">출발지 → 도착지</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">금액</th>
                </tr></thead>
                <tbody>
                  {flagged.map(({ row, reasons }, i) => (
                    <tr key={row.order.id || `noid-${i}`} className="border-t border-gray-100">
                      <td className="px-4 py-2">
                        <span className="inline-flex flex-wrap gap-1">
                          {reasons.map((r) => (
                            <span key={r} className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--admin-vanilla)] text-[#212121]">
                              {TAXI_ANOMALY_LABEL[r]}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-4 py-2">{row.timeText}</td>
                      <td className="px-4 py-2 font-bold text-[#212121]">{row.order.member_name || "(이름 없음)"}</td>
                      <td className="px-4 py-2">{row.branchName}</td>
                      <td className="px-4 py-2 max-w-[22rem] truncate" title={`${row.order.departure_point} → ${row.order.arrival_point}`}>
                        {row.order.departure_point} → {row.order.arrival_point}
                      </td>
                      <td className="px-4 py-2 text-right font-bold">{formatNumber(row.amount)}원</td>
                    </tr>
                  ))}
                  {!flagged.length && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">점검 대상 건이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---------- 지점 신청 관리 ---------- */}
      {view === "requests" && (
        <>
          {requestsError && <div className={ERROR_BANNER}>{requestsError}</div>}
          {requestsLoading && !requestsData && <div className="py-20 text-center"><LoadingSpinner size="md" /></div>}
          {requestsData && (
            <>
              {requestsData.failed.length > 0 && (
                <div className={ERROR_BANNER}>
                  다음 지점의 신청 내역을 불러오지 못했습니다: {requestsData.failed.join(", ")} — 이 지점들의 대기 신청이 아래 목록에 빠져 있을 수 있습니다. '새로고침'을 눌러주세요.
                </div>
              )}

              {/* 등록 승인 — 그룹을 확정해야 카카오에 넣을 수 있다 */}
              {approveTarget && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
                  <h2 className="admin-pill-title">이용신청 승인 — {approveTarget.branchName} · {approveTarget.name}</h2>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[11px] font-bold text-[#212121]/60">휴대전화 {approveTarget.phone || "-"}</span>
                    <select value={approveGroupId} onChange={(e) => setApproveGroupId(e.target.value)} disabled={requestBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" aria-label="등록할 그룹">
                      <option value="">그룹 선택 (필수)</option>
                      {(membersData?.groups || []).filter((g) => g.status === "enabled").map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    <button onClick={() => void executeApproveRegister()} disabled={anyWriteBusy}
                      className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">
                      {requestBusy ? "처리 중..." : "승인하고 카카오T에 등록"}
                    </button>
                    <button onClick={() => setApproveTarget(null)} disabled={requestBusy}
                      className="admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black cursor-pointer disabled:opacity-50">취소</button>
                  </div>
                  <p className="text-[11px] font-bold text-[#212121]/60">부서는 신청 지점명({approveTarget.branchName})으로 자동 기입되어 이용내역이 그 지점으로 집계됩니다.</p>
                </div>
              )}

              {/* 반려 — 사유가 지점 화면에 그대로 보인다 */}
              {rejectTarget && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
                  <h2 className="admin-pill-title">반려 — {rejectTarget.branchName} · {rejectTarget.name}</h2>
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} disabled={requestBusy}
                    placeholder="반려 사유 (필수 — 지점 화면에 그대로 표시됩니다)"
                    className="w-full h-16 border border-gray-200 rounded-lg px-3 py-2 text-[11px] font-bold bg-white disabled:opacity-50 resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => void executeReject()} disabled={anyWriteBusy}
                      className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">
                      {requestBusy ? "처리 중..." : "반려 처리"}
                    </button>
                    <button onClick={() => { setRejectTarget(null); setRejectReason(""); }} disabled={requestBusy}
                      className="admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black cursor-pointer disabled:opacity-50">취소</button>
                  </div>
                </div>
              )}

              {/* 수정 요청 승인 시 아래 수정 카드가 열린다 — 직원 관리 탭과 같은 컴포넌트 */}
              {editing && view === "requests" && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
                  <h2 className="admin-pill-title">직원 정보 수정 — {editing.name || editing.identifier}</h2>
                  {linkedUpdateRequest?.reason && (
                    <p className="text-[11px] font-bold text-[#212121]">지점 요청 사유: {linkedUpdateRequest.reason}</p>
                  )}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="이름" disabled={editBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" />
                    <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="휴대전화" inputMode="numeric" disabled={editBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" />
                    {/* 부서(지점)는 드롭다운 — 손으로 치면 오타로 미매핑되어 이용내역이 지점에 안 잡힌다.
                        목록에 없는 기존 값(과거 표기)도 선택지에 남겨 실수로 지워지지 않게 한다. */}
                    <select value={editDept} onChange={(e) => setEditDept(e.target.value)} disabled={editBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" aria-label="부서(지점)">
                      <option value="">부서(지점) 없음</option>
                      {erpBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                      {editDept && !erpBranches.includes(editDept) && (
                        <option value={editDept}>{editDept} (현재 값 · ERP 지점명 아님)</option>
                      )}
                    </select>
                    <p className="text-[11px] font-bold text-[#212121]/60 self-center">사번(변경 불가): {editing.identifier || "-"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {editGroupOptions.map((g) => (
                      <label key={g.id}
                        className={`admin-period-chip h-8 px-3 rounded-full text-[11px] font-black inline-flex items-center ${editGroupIds.includes(g.id) ? "is-active" : ""} ${editBusy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                        <input type="checkbox" className="sr-only" checked={editGroupIds.includes(g.id)} disabled={editBusy} onChange={() => toggleEditGroup(g.id)} />
                        {g.name}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => void saveEdit()} disabled={editBusy || memberWriteBusy}
                      className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">
                      {editBusy ? "저장 중..." : "저장하고 요청 완료"}
                    </button>
                    <button onClick={closeEditCard} disabled={editBusy}
                      className="admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black cursor-pointer disabled:opacity-50">취소</button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="admin-pill-title">
                    신청 목록 — 대기 {formatNumber(requestsData.items.filter((r) => r.status === "pending").length)}건 / 전체 {formatNumber(requestsData.items.length)}건
                  </h2>
                </div>
                <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead><tr className="text-left">
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">신청일</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">지점</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">종류</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">대상</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">사유·메모</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">상태</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">처리</th>
                    </tr></thead>
                    <tbody>
                      {requestsData.items.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100">
                          <td className="px-4 py-2">{(r.requestedAt || "").slice(0, 16).replace("T", " ")}</td>
                          <td className="px-4 py-2 font-bold text-[#212121]">{r.branchName}</td>
                          <td className="px-4 py-2">{REQUEST_TYPE_LABEL[r.type]}</td>
                          <td className="px-4 py-2 font-bold text-[#212121]">{r.name}{r.phone ? ` (${r.phone})` : ""}</td>
                          <td className="px-4 py-2 max-w-[18rem] truncate" title={r.reason || r.memo || ""}>{r.reason || r.memo || "-"}</td>
                          <td className="px-4 py-2">
                            {REQUEST_STATUS_LABEL[r.status]}
                            {r.status === "rejected" && r.rejectReason ? ` — ${r.rejectReason}` : ""}
                            {r.status === "approved" && r.resultNote ? ` — ${r.resultNote}` : ""}
                          </td>
                          <td className="px-4 py-2">
                            {r.status === "pending" ? (
                              <span className="inline-flex gap-1.5">
                                <button
                                  onClick={() => {
                                    if (r.type === "register") { setApproveTarget(r); setApproveGroupId(guessGroupId(r.branchName)); setRejectTarget(null); }
                                    else if (r.type === "delete") void executeApproveDelete(r);
                                    else void startUpdateApproval(r);
                                  }}
                                  disabled={anyWriteBusy}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">승인</button>
                                <button onClick={() => { setRejectTarget(r); setRejectReason(""); setApproveTarget(null); }} disabled={anyWriteBusy}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black text-[#B91C1C] bg-white border border-[#C93A3A] disabled:opacity-50">반려</button>
                              </span>
                            ) : r.status === "processing" ? (
                              // 다른 관리자가 선점해 카카오 작업 중 — 여기서 승인·반려로 가로채면 실행과 기록이 어긋난다.
                              // 다만 기록 실패로 '처리 중'에 갇히면 아무도 손댈 수 없으므로 수동 해제 경로를 둔다.
                              <span className="inline-flex items-center gap-2">
                                <span className="text-[11px] font-bold text-[#212121]/60">
                                  {/* claimedBy 에는 기기 구분용 접미사(#xxxx)가 붙어 있다 — 화면에는 이름만 보인다 */}
                                  {r.claimedBy ? `${String(r.claimedBy).split("#")[0]} 처리 중` : "처리 중"}
                                </span>
                                {/* 해제 버튼은 '멈춘 지 오래된' 건에만 — 방금 시작한 남의 처리를 풀면 중복 실행된다 */}
                                {isStuckProcessing(r) && (
                                  <button onClick={() => void unstickProcessing(r)} disabled={anyWriteBusy}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50"
                                    title="응답이 끊겨 '처리 중'에 멈춘 신청을 대기로 되돌립니다">처리 중 해제</button>
                                )}
                              </span>
                            ) : (
                              <span className="text-[11px] font-bold text-[#212121]/50">{(r.processedAt || "").slice(0, 16).replace("T", " ") || "처리됨"}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!requestsData.items.length && (
                        <tr><td colSpan={7} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">지점에서 올라온 신청이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ---------- 직원 관리 ---------- */}
      {view === "members" && (
        <>
          {membersLoading && <div className="py-20 text-center"><LoadingSpinner size="md" /></div>}
          {!membersLoading && membersData && (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
                <h2 className="admin-pill-title">직원 등록</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="이름 (필수)"
                    className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white" />
                  <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="휴대전화 (필수)" inputMode="numeric"
                    className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white" />
                  <select value={regGroupId} onChange={(e) => setRegGroupId(e.target.value)}
                    className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white" aria-label="그룹 (필수)">
                    <option value="">그룹 선택 (필수)</option>
                    {(membersData.groups || []).filter((g) => g.status === "enabled").map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <input value={regDepartment} onChange={(e) => setRegDepartment(e.target.value)} placeholder="부서/지점명 (선택)"
                    className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white" />
                  <input value={regIdentifier} onChange={(e) => setRegIdentifier(e.target.value)} placeholder="사번 (비우면 이름 사용)"
                    className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white" />
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => void submitRegister()} disabled={regBusy || memberWriteBusy}
                    className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">
                    {regBusy ? "등록 중..." : "카카오T에 등록"}
                  </button>
                  <p className="text-[11px] font-bold text-[#212121]/60">
                    등록 후 직원이 인증 알림톡으로 카카오T 앱 인증을 마쳐야 아래 목록에 나타나고 법인택시를 쓸 수 있습니다.
                  </p>
                </div>
              </div>

              {editing && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
                  <h2 className="admin-pill-title">직원 정보 수정 — {editing.name || editing.identifier}</h2>
                  {/* 저장 중에는 입력을 전부 잠근다 — 제출값과 화면값이 어긋나거나, 완료 후 초기화로 입력이 사라지는 것 방지 */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="이름" disabled={editBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" />
                    <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="휴대전화" inputMode="numeric" disabled={editBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" />
                    {/* 부서(지점)는 드롭다운 — 손으로 치면 오타로 미매핑되어 이용내역이 지점에 안 잡힌다.
                        목록에 없는 기존 값(과거 표기)도 선택지에 남겨 실수로 지워지지 않게 한다. */}
                    <select value={editDept} onChange={(e) => setEditDept(e.target.value)} disabled={editBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" aria-label="부서(지점)">
                      <option value="">부서(지점) 없음</option>
                      {erpBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                      {editDept && !erpBranches.includes(editDept) && (
                        <option value={editDept}>{editDept} (현재 값 · ERP 지점명 아님)</option>
                      )}
                    </select>
                    <p className="text-[11px] font-bold text-[#212121]/60 self-center">사번(변경 불가): {editing.identifier || "-"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {editGroupOptions.map((g) => (
                      <label key={g.id}
                        className={`admin-period-chip h-8 px-3 rounded-full text-[11px] font-black inline-flex items-center ${editGroupIds.includes(g.id) ? "is-active" : ""} ${editBusy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                        <input type="checkbox" className="sr-only" checked={editGroupIds.includes(g.id)} disabled={editBusy} onChange={() => toggleEditGroup(g.id)} />
                        {g.name}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => void saveEdit()} disabled={editBusy || memberWriteBusy}
                      className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">
                      {editBusy ? "저장 중..." : "저장"}
                    </button>
                    <button onClick={closeEditCard} disabled={editBusy}
                      className="admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black cursor-pointer disabled:opacity-50">취소</button>
                    <p className="text-[11px] font-bold text-[#212121]/60">부서/지점명을 ERP 지점명과 똑같이 적으면 이용내역이 그 지점으로 집계됩니다. 전화번호를 바꾸면 새 번호로 인증 알림톡이 자동 발송됩니다.</p>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
                  <h2 className="admin-pill-title">
                    인증완료 직원 — {formatNumber(visibleMembers.length)}명
                    {memberBranchFilter !== "all" ? ` / 전체 ${formatNumber(membersData.members.length)}명` : ""}
                  </h2>
                  <select value={memberBranchFilter} onChange={(e) => setMemberBranchFilter(e.target.value)}
                    className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white" aria-label="지점 필터">
                    <option value="all">전체 지점</option>
                    {memberBranchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                    <option value="unassigned">부서 미지정</option>
                  </select>
                  <span className="text-[11px] font-bold text-[#212121]/50">(등록 후 아직 인증하지 않은 직원은 카카오 정책상 목록에 나오지 않습니다)</span>
                </div>
                <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead><tr className="text-left">
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">이름</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">부서/지점</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">휴대전화</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">그룹</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">상태</th>
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">관리</th>
                    </tr></thead>
                    <tbody>
                      {visibleMembers.map((m) => {
                        // 어떤 행이든 쓰기가 진행 중이면 전 행을 잠근다(동시 쓰기 race 방지)
                        const busy = memberWriteBusy || regBusy;
                        return (
                          <tr key={m.id} className="border-t border-gray-100">
                            <td className="px-4 py-2 font-bold text-[#212121]">{m.name || "(이름 없음)"}</td>
                            <td className="px-4 py-2">{m.department || "-"}</td>
                            <td className="px-4 py-2">{m.mobile_phone || "-"}</td>
                            <td className="px-4 py-2">{(m.group_ids || []).map((id) => groupNameById.get(id) || id).join(", ") || "-"}</td>
                            <td className="px-4 py-2">{MEMBER_STATUS_LABEL[m.status] || m.status}</td>
                            <td className="px-4 py-2">
                              <span className="inline-flex gap-1.5">
                                <button onClick={() => startEdit(m)} disabled={busy}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">수정</button>
                                <button onClick={() => void sendTms(m)} disabled={busy}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">알림톡</button>
                                {m.status === "blocked" ? (
                                  <button onClick={() => void runMemberAction(m, "휴직 해제", () => gasClient.unblockKakaoTaxiMember([m.id], adminPinHash),
                                    // 재조회 목록에 여전히 있고 blocked 가 풀렸으면 확인, 목록에서 사라졌으면 판정 불가
                                    (list) => { const f = list.find((x) => x.id === m.id); return f ? f.status !== "blocked" : null; })} disabled={busy}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">휴직 해제</button>
                                ) : (
                                  <button onClick={() => void runMemberAction(m, "휴직", () => gasClient.blockKakaoTaxiMember([m.id], adminPinHash),
                                    (list) => { const f = list.find((x) => x.id === m.id); return f ? f.status === "blocked" : null; })} disabled={busy}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">휴직</button>
                                )}
                                <button onClick={() => void runMemberAction(m, "삭제", () => gasClient.deleteKakaoTaxiMember(m.id, adminPinHash),
                                  // 삭제는 목록에서 사라져야 반영된 것 — 남아 있으면 미반영으로 알린다
                                  (list) => !list.some((x) => x.id === m.id))} disabled={busy}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black text-[#B91C1C] bg-white border border-[#C93A3A] disabled:opacity-50">삭제</button>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {!visibleMembers.length && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">
                          {memberBranchFilter === "all" ? "인증완료 직원이 없습니다." : "이 필터에 해당하는 직원이 없습니다."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
