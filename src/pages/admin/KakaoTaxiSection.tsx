// src/pages/admin/KakaoTaxiSection.tsx
// 관리자 > 법인택시 — 카카오T 비즈니스 이용내역 조회·이상 점검·직원 관리.
// 데이터는 저장하지 않고 카카오 API 를 실시간 조회한다(백엔드 프록시 경유 — gas/Code.gs, 로컬은 server.ts).
// 계산은 helpers/kakaoTaxi.ts·kakaoTaxiAnomaly.ts (순수 함수), 이 파일은 조회·표시·쓰기 흐름만 맡는다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthContext } from "../../contexts/AuthContext";
import { gasClient } from "../../api/gasClient";
import type { KakaoTaxiAccountError, KakaoTaxiGroup, KakaoTaxiMember, KakaoTaxiMemberInput } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { formatNumber } from "../../utils/formatNumber";
import { addMonthsToMonthInputValue } from "../branch/helpers/formatters";
import {
  accountLabel, aggregateByBranch, aggregateByMember, buildOrdersExcelRows, KAKAO_BRANCH_ALIASES,
  kakaoTaxiAccountForBranch, memberAmountMap, normalizeKakaoTaxiOrders, shortTimeText, verifyBranchTotals, verticalLabel,
  type NormalizedTaxiOrder,
} from "./helpers/kakaoTaxi";
import {
  DEFAULT_TAXI_THRESHOLDS, detectMemberSurges, excludeLogisticsOrders, flagTaxiOrders,
  type FlaggedTaxiOrder, type TaxiAnomalyReason,
} from "./helpers/kakaoTaxiAnomaly";
import {
  kakaoTaxiRequestsKey, normalizePhone, REQUEST_TYPE_LABEL, sortRequests, type KakaoTaxiRequest,
} from "./helpers/kakaoTaxiRequests";
import {
  KAKAO_TAXI_BRANCH_HISTORY_KEY, appendBranchHistory, appendBranchHistoryOrWarn, appendBranchHistoryReversal,
  buildBranchHistoryMap, createBranchHistoryEntry, isKakaoWriteDefinitelyNotExecuted as isDefinitelyNotExecuted,
  type KakaoTaxiBranchHistoryEntry,
} from "./helpers/kakaoTaxiBranchHistory";
import { getKakaoTaxiOrdersShared, invalidateKakaoTaxiOrdersShared } from "./helpers/kakaoTaxiOrdersCache";

export type KakaoTaxiView = "orders" | "anomaly" | "members" | "requests";

// 관리자 화면 오류 배너는 DESIGN_ADMIN.md §2-1 — bg-rose-50 은 관리자 스코프에서 '긍정색'으로
// 뒤집히므로 오류 hex 를 직접 박는다.
const ERROR_BANNER = "border rounded-xl px-4 py-3 text-xs font-bold bg-[#FDE2E2] border-[#C93A3A] text-[#B91C1C]";

// 엑셀 형식 표의 본문 셀(DESIGN.md §9-1) — 헤더만 검정 격자로 또렷하게, 본문은 옅은 격자.
// 첫 칸은 왼쪽 선까지 그어야 표가 닫힌다(`first:border-l`).
const SHEET_TD = "border-r border-b border-black/10 first:border-l px-2 py-1.5 align-top";

/**
 * 신청일 표기 — `26-07-31 14:30`.
 * 표 안에서는 세기(20)까지 적을 이유가 없어 두 자리로 줄인다. 일자·시각은 남긴다 —
 * 언제 올라온 신청인지가 처리 순서를 정하는 근거라서 날짜만으로는 부족하다.
 */
const formatRequestedAt = (iso?: string): string => {
  const s = String(iso || "");
  return s.length >= 16 ? s.slice(2, 16).replace("T", " ") : s;
};

const MEMBER_STATUS_LABEL: Record<string, string> = {
  created: "등록됨(미인증)", connected: "인증완료", refused: "거부", blocked: "이용중지",
};

// 로컬(KST) 기준 오늘 날짜 — toISOString()은 UTC 라 월초·자정 부근에 전날로 어긋난다(month 초기값과 같은 함정).
function todayDateText(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// 그룹 선택 드롭다운(등록·승인) 전용 합성 키 — 계정마다 카카오가 그룹 id 를 따로 채번해
// 서로 다른 계정의 그룹이 같은 id 를 가질 수 있다("계정|id" 로 묶지 않으면 잘못된 계정의
// 그룹을 골라 그 계정으로 등록·발송하는 사고가 난다 — F1, 코덱스 리뷰 2026-07-28).
function groupOptionKey(g: KakaoTaxiGroup): string {
  return `${g.account_key}|${g.id}`;
}
function findGroupByOptionKey(groups: KakaoTaxiGroup[], key: string): KakaoTaxiGroup | undefined {
  const idx = key.indexOf("|");
  if (idx < 0) return undefined;
  const accountKey = key.slice(0, idx);
  const id = key.slice(idx + 1);
  return groups.find((g) => g.account_key === accountKey && g.id === id);
}

interface OrdersData {
  month: string;
  reportedCount: number;
  current: NormalizedTaxiOrder[];
  /** 전월 정규화 내역 — 아직 도착 전이거나 조회 실패 시 null (급증 비교만 비활성, 당월 화면은 정상 표시) */
  prev: NormalizedTaxiOrder[] | null;
  /** 당월 조회에서 실패한 계정 목록 — 이 데이터(ordersData)에 실린 채로 함께 다닌다.
   * 전역 상태로 따로 두면 다른 뷰의 조회가 끝난 뒤 탭을 오가는 사이에 실제로는 여전히 값이 빠진
   * 이 데이터의 실패 표시가 지워지는 문제가 있었다(코덱스 리뷰 2026-07-28) — 데이터와 함께 저장해
   * "지금 화면에 보이는 이 데이터가 실제로 완전한지"를 항상 정확히 반영하게 한다. */
  accountErrors: KakaoTaxiAccountError[];
  /** 지점 변경 이력 로드 실패 — 이때 과거 이용분이 '현재 지점' 기준으로 보일 수 있어 배너로 알린다.
   * accountErrors 와 같은 이유로 데이터에 귀속시킨다(탭을 오가도 이 데이터의 상태가 정확해야 한다). */
  historyLoadFailed: boolean;
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

  // accountErrors 도 이 데이터에 함께 실어 보낸다 — 이유는 OrdersData.accountErrors 주석과 동일
  // (탭을 오가도 "지금 이 members/groups 가 실제로 완전한지"가 항상 정확해야 한다).
  const [membersData, setMembersData] = useState<{ members: KakaoTaxiMember[]; groups: KakaoTaxiGroup[]; accountErrors: KakaoTaxiAccountError[] } | null>(null);
  /** 직원 관리 탭의 지점(부서) 필터 — "all" | "unassigned" | 지점명 */
  const [memberBranchFilter, setMemberBranchFilter] = useState("all");
  /** 직원 관리 탭의 이름 검색(2026-07-29 사용자 요청) — 부분 일치 */
  const [memberNameFilter, setMemberNameFilter] = useState("");
  /** ERP 지점 목록 — 직원 수정 시 부서를 드롭다운으로 고르게 한다(오타로 미매핑되는 것 방지) */
  const [erpBranches, setErpBranches] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const membersGenRef = useRef(0);
  const [memberBusyId, setMemberBusyId] = useState("");

  const [branchFilter, setBranchFilter] = useState("all");
  // 상세내역 직원 필터 — 이름을 직접 친다(사용자 지시 2026-07-31, 드롭다운은 인원이 많아 찾기 어려웠다).
  // 빈 문자열이면 전체. 공백을 지운 부분일치로 찾는다("홍 길동"과 "홍길동"을 같게 본다).
  const [memberFilter, setMemberFilter] = useState("");
  // 신청 목록 필터(사용자 지시 2026-07-31) — 지점·이름·종류.
  // 이름은 드롭다운이 아니라 직접 입력이다(신청자는 계속 바뀌어 목록으로 만들면 금세 낡는다).
  const [reqBranchFilter, setReqBranchFilter] = useState("");
  const [reqNameFilter, setReqNameFilter] = useState("");
  const [reqTypeFilter, setReqTypeFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("all"); // 계정 필터 — "all" | "acct1" | "acct2"
  // 상세내역 구분 필터 — "all" | "logistics". 퀵·택배 표를 클릭하면 상세 내역을 그 건만 좁혀 본다(2026-07-29).
  const [verticalFilter, setVerticalFilter] = useState("all");
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
  /** 지점변경 승인 폼 — 변경신청(branchChange)과, 레거시 삭제요청의 '지점변경으로 처리'가 함께 쓴다 */
  const [branchChangeTarget, setBranchChangeTarget] = useState<KakaoTaxiRequest | null>(null);
  const [branchChangeBranch, setBranchChangeBranch] = useState("");
  const [branchChangeDate, setBranchChangeDate] = useState("");
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
    // 공유 캐시 경유 — 대시보드(점검 대상 계산)가 먼저 받아 둔 같은 달 결과를 재사용해 즉시 뜬다.
    const prevPromise = getKakaoTaxiOrdersShared(prevMonth, adminPinHash).catch(() => null);
    // 지점 변경 이력 — 이용일 기준 지점 판정에 필요(2026-07-29). 문서가 아직 없으면 null(정상)이고,
    // 조회 실패는 따로 표시해 "과거 이용분이 현재 지점 기준으로 보일 수 있음"을 배너로 알린다.
    let historyLoadFailed = false;
    const historyPromise = gasClient
      .getSharedDataFromServer<KakaoTaxiBranchHistoryEntry[]>(KAKAO_TAXI_BRANCH_HISTORY_KEY)
      .catch(() => { historyLoadFailed = true; return null; });
    try {
      const [branchList, curr, historyRaw] = await Promise.all([
        gasClient.getBranchList(),
        getKakaoTaxiOrdersShared(target, adminPinHash, forceRefresh),
        historyPromise,
      ]);
      if (ordersGenRef.current !== gen) return;
      const erpNames = Array.from(new Set([...(branchList || []).map((b) => b.branchName).filter(Boolean), "본사"]));
      const historyMap = buildBranchHistoryMap(Array.isArray(historyRaw) ? historyRaw : []);
      setOrdersData({
        month: target,
        reportedCount: curr.count,
        current: normalizeKakaoTaxiOrders(curr.orders, erpNames, historyMap),
        prev: null, // 전월은 아래에서 도착하는 대로 채운다
        // 당월 조회의 계정 실패만 배너에 반영한다. 전월(prev)은 급증 비교용 보조 자료일 뿐이라
        // 실패해도 이미 "전월 자료를 불러오지 못해 급증 비교를 건너뛰었습니다" 안내가 별도로 뜬다 —
        // 여기서까지 겹쳐 보여주면 당월 조회 실패처럼 오인될 수 있어 의도적으로 무시한다.
        accountErrors: curr.accountErrors || [],
        historyLoadFailed,
      });
      setBranchFilter("all");
      setMemberFilter("");
      setVerticalFilter("all"); // 새 자료를 받으면 구분 필터도 함께 풀어 '0건' 화면으로 열리지 않게 한다
      void prevPromise.then((prev) => {
        if (ordersGenRef.current !== gen) return; // 그 사이 새 조회가 시작됐으면 그쪽이 채운다
        setOrdersData((cur) =>
          cur && cur.month === target
            ? { ...cur, prev: prev ? normalizeKakaoTaxiOrders(prev.orders, erpNames, historyMap) : null }
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
      const [membersRes, groupsRes, branchList] = await Promise.all([
        gasClient.getKakaoTaxiMembers(adminPinHash, forceRefresh),
        gasClient.getKakaoTaxiGroups(adminPinHash, forceRefresh),
        // 부서 드롭다운용 ERP 지점 목록 — 실패해도 직원 목록은 보여준다(드롭다운만 비게 됨)
        gasClient.getBranchList().catch(() => []),
      ]);
      const members = membersRes.members || [];
      const groups = groupsRes.groups || [];
      if (membersGenRef.current === gen) {
        // 직원 목록 조회와 그룹 목록 조회는 계정별로 각각 실패할 수 있다 — 두 실패 목록을 합쳐서
        // membersData 에 함께 싣는다(전역 상태로 따로 두지 않는 이유는 OrdersData.accountErrors 주석 참고).
        setMembersData({ members, groups, accountErrors: [...(membersRes.accountErrors || []), ...(groupsRes.accountErrors || [])] });
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
  // allRows = 계정 필터 적용 전 정규화 결과(카카오 보고 건수 대사·엑셀 오류 메시지는 이 값을 써야 한다 —
  // 계정 필터가 걸려 있어도 "수집 자체가 누락됐는지"는 전체 기준으로 판단해야 하므로).
  const allRows = ordersData?.current ?? [];
  // rows = 계정 필터가 적용된 정규화 결과. 아래 집계(aggregateByBranch·aggregateByMember)·이상 점검·
  // 상세 내역이 전부 이 rows 를 받으므로 계정 필터가 자동으로 반영된다.
  const rows = useMemo(
    () => (accountFilter === "all" ? allRows : allRows.filter((r) => r.accountKey === accountFilter)),
    [allRows, accountFilter]
  );
  // 지금 뷰가 실제로 그리고 있는 데이터의 accountErrors 만 뽑는다 — 이용내역/이상 점검은 ordersData,
  // 직원 관리는 membersData 에 실려 있다. 전역 상태 하나를 두 로드가 덮어쓰던 이전 방식은 다른 뷰의
  // 조회가 끝난 뒤 탭을 오가면(캐시 표식 때문에 재조회가 안 되어) 실제로는 여전히 값이 빠진 화면인데도
  // 배너가 사라지는 문제가 있었다(코덱스 리뷰 2026-07-28) — 데이터에 귀속시켜 이 문제를 없앤다.
  // requests 뷰도 membersData 로 승인 UI(그룹·회원 목록)를 그리므로 members 와 같은 배너를 본다
  // (F4, 코덱스 리뷰 2026-07-28 — 신청 승인 화면이 정작 계정 조회 실패를 경고받지 못하던 문제).
  const visibleAccountErrors =
    view === "orders" || view === "anomaly" ? (ordersData?.accountErrors ?? [])
    : view === "members" || view === "requests" ? (membersData?.accountErrors ?? [])
    : [];
  // 배너 라벨 중복 제거 — 회원 조회 실패와 그룹 조회 실패가 같은 계정이면(멤버·그룹 두 API 가 같은
  // 계정에서 함께 실패) 라벨이 "2계정, 2계정"으로 겹쳐 보인다(F5). 계정(key) 기준 첫 항목만 남긴다.
  const dedupedAccountErrors = visibleAccountErrors.filter(
    (e, i) => visibleAccountErrors.findIndex((x) => x.key === e.key) === i
  );
  const shownMonth = ordersData?.month ?? month;
  const stale = ordersData != null && ordersData.month !== month;
  const branchTotals = useMemo(() => aggregateByBranch(rows), [rows]);
  const memberTotals = useMemo(() => aggregateByMember(rows), [rows]);
  const totalsOk = useMemo(() => verifyBranchTotals(rows, branchTotals), [rows, branchTotals]);
  const countMismatch = ordersData != null && ordersData.reportedCount !== allRows.length;
  const totalAmount = useMemo(() => rows.reduce((acc, r) => acc + r.amount, 0), [rows]);
  const visibleRows = useMemo(
    () => {
      const nameNeedle = memberFilter.replace(/\s+/g, "");
      const filtered = rows.filter((r) =>
        (branchFilter === "all" || r.branchName === branchFilter) &&
        (!nameNeedle || String(r.order.member_name || "").replace(/\s+/g, "").includes(nameNeedle)) &&
        // 구분(vertical_code) 필터 — 퀵·택배 표에서 넘어온 경우에만 걸린다. 옛 캐시엔 필드가 없어 `|| ""` 필수.
        (verticalFilter === "all" || String(r.order.vertical_code || "") === verticalFilter)
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
    [rows, branchFilter, memberFilter, verticalFilter]
  );
  const thresholds = useMemo(() => ({ ...DEFAULT_TAXI_THRESHOLDS, highFare }), [highFare]);
  const flagged = useMemo(() => flagTaxiOrders(rows, thresholds), [rows, thresholds]);
  // [사유별 분리] 단일 '점검 대상 건' 표를 대표 사유 3개(고액·낮 시간대·지점 미매핑) 카드로 나눈다
  // (사용자 지시 2026-07-29) — 고액·낮 시간대는 '지출 행태 점검'이고 지점 미매핑은 '데이터 정비'라
  // 봐야 할 목적이 다르다. 한 표에 섞여 있으면 매번 눈으로 걸러내야 했다.
  // flagged 는 이미 대표 사유(reasons[0])로 묶이고 묶음 안에서 최신순이라 여기서는 나누기만 한다
  // — 정렬·대표 사유 판정은 kakaoTaxiAnomaly.ts 한 곳에만 둔다.
  const flaggedByReason = useMemo(() => {
    const groups: Record<TaxiAnomalyReason, FlaggedTaxiOrder[]> = { highFare: [], daytime: [], unmapped: [] };
    for (const f of flagged) {
      const primary = f.reasons[0];
      if (primary && groups[primary]) groups[primary].push(f);
    }
    return groups;
  }, [flagged]);
  // 이상 점검에서 최근 3일(오늘 포함) 이용 건을 하이라이트 — 새로 생긴 점검 대상이 눈에 띄게(2026-07-29).
  // 로컬(KST) 기준 날짜 비교 — timeText 는 "YYYY-MM-DD HH:mm:ss" 형태라 앞 10자리 문자열 비교로 충분.
  const recentSinceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [ordersData?.month]);   // 조회를 다시 하면 기준일도 갱신
  const isRecentOrder = (timeText: string) => String(timeText || "").slice(0, 10) >= recentSinceDate;
  // 사유별 카드 3개가 컬럼·스타일을 어긋남 없이 공유하도록 표 한 벌만 두고 사유마다 호출한다.
  // '겹친 사유' 칸은 삭제했다(사용자 지시 2026-07-29) — 카드 제목이 이미 대표 사유라 뱃지 칸이
  // 자리만 차지했다. 겹친 사유가 궁금하면 해당 사유의 카드에서 같은 건이 다시 보인다.
  const renderAnomalyCard = (
    title: string,
    list: FlaggedTaxiOrder[],
    emptyText: string,
    note?: string,
  ) => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="admin-pill-title">{title} — {formatNumber(list.length)}건</h2>
        {note && <p className="mt-1 text-[11px] font-bold text-[#212121]/60">{note}</p>}
      </div>
      <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
        <table className="w-full text-xs whitespace-nowrap">
          {/* 일시·직원·지점은 px-2 로 좁혀 이용사유 자리를 냈다 */}
          <thead><tr className="text-left">
            <th className="px-2 py-2 text-[11px] font-black text-[#212121]">이용일시</th>
            <th className="px-2 py-2 text-[11px] font-black text-[#212121]">직원</th>
            <th className="px-2 py-2 text-[11px] font-black text-[#212121]">지점</th>
            <th className="px-4 py-2 text-[11px] font-black text-[#212121]">출발지 → 도착지</th>
            <th className="px-4 py-2 text-[11px] font-black text-[#212121]">이용사유</th>
            <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">금액</th>
          </tr></thead>
          <tbody>
            {list.map(({ row }, i) => (
              <tr key={row.order.id || `noid-${i}`}
                className={`border-t border-gray-100 ${isRecentOrder(row.timeText) ? "bg-[var(--admin-vanilla)]/45" : ""}`}>
                {/* 표시만 축약(MM-DD HH:mm) — '최근 3일' 판정(isRecentOrder)과 정렬은 원본 timeText 그대로다 */}
                <td className="px-2 py-2" title={row.timeText}>
                  {shortTimeText(row.timeText)}
                  {isRecentOrder(row.timeText) && (
                    <span className="ml-1.5 rounded-full border border-[#212121] bg-[var(--admin-vanilla)] px-1.5 py-0.5 text-[10px] font-black">최근 3일</span>
                  )}
                </td>
                <td className="px-2 py-2 font-bold text-[#212121]">{row.order.member_name || "(이름 없음)"}</td>
                <td className="px-2 py-2">{row.branchName}</td>
                <td className="px-4 py-2 max-w-[22rem] truncate" title={`${row.order.departure_point} → ${row.order.arrival_point}`}>
                  {row.order.departure_point} → {row.order.arrival_point}
                </td>
                {/* 직원이 카카오T 앱에 적은 자유 입력 — 옛 캐시·미배포 GAS 에는 필드가 없어 `|| ""` 필수 */}
                <td className="px-4 py-2 max-w-[10rem] truncate" title={row.order.use_code || ""}>{row.order.use_code || ""}</td>
                <td className="px-4 py-2 text-right font-bold">{formatNumber(row.amount)}원</td>
              </tr>
            ))}
            {!list.length && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">{emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
  // 전월 비교값도 당월과 같은 기준(퀵·택배 제외)으로 만든다 — 한쪽만 걸러내면 전월에 퀵이 섞인
  // 직원의 비교 기준이 부풀어 진짜 급증을 놓친다(excludeLogisticsOrders 주석 참고, 2026-07-29).
  const surges = useMemo(
    () => (ordersData?.prev ? detectMemberSurges(rows, memberAmountMap(excludeLogisticsOrders(ordersData.prev)), thresholds) : []),
    [rows, ordersData?.prev, thresholds]
  );
  // 퀵·택배(vertical_code="logistics") 전용 조회 뷰 — 이상 점검에서 뺀 대신 여기서 사람이 직접 본다(2026-07-29).
  // [집계 불변] 지점별/직원별 합계·상단 카드·verifyBranchTotals 는 그대로 rows(퀵 포함) 를 쓴다.
  // 이 목록은 순수 뷰이며 지점/직원 필터는 적용하지 않는다(합계 표들과 같이 계정 필터만 따른다).
  const logisticsRows = useMemo(
    () => rows
      .filter((r) => String(r.order.vertical_code || "") === "logistics")
      // 상세 내역(visibleRows)과 '같은' 비교기로 최신순 정렬 — Date.parse 우선, 파싱 불가 시 문자열 역순 폴백.
      // 형식이 흔들리는 건이 섞였을 때 두 표의 순서가 어긋나지 않게 한다(코덱스 리뷰 P1, 2026-07-29).
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.timeText);
        const tb = Date.parse(b.timeText);
        if (!isNaN(ta) && !isNaN(tb)) return tb - ta;
        return String(b.timeText).localeCompare(String(a.timeText));
      }),
    [rows]
  );
  const logisticsAmount = useMemo(() => logisticsRows.reduce((acc, r) => acc + r.amount, 0), [logisticsRows]);
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
    const all = membersData?.members || [];
    const branchFiltered =
      memberBranchFilter === "all" ? all
      : memberBranchFilter === "unassigned" ? all.filter((m) => !(m.department || "").trim())
      : all.filter((m) => memberBranchOf(m) === memberBranchFilter);
    // 이름 검색 — 부분 일치(대소문자 무시). 지점 필터와 겹쳐 쓸 수 있다.
    const query = memberNameFilter.trim().toLowerCase();
    const list = query
      ? branchFiltered.filter((m) => String(m.name || "").toLowerCase().includes(query))
      : branchFiltered;

    // 최근 등록순으로 보여준다(사용자 지시 2026-07-28).
    // 카카오 목록 응답은 우리가 타입으로 선언한 필드 말고도 그대로 넘어오므로, 등록 시각으로 쓸 만한
    // 필드를 순서대로 찾아 쓴다. 하나도 없으면 시각을 지어내지 않고 받은 순서의 역순으로 둔다
    // (목록이 오래된 순으로 오는 것을 전제한 차선책 — 순서가 기대와 다르면 ERP 등록로그를 기준으로 바꿔야 한다).
    const registeredAt = (member: KakaoTaxiMember) => {
      const raw = member as unknown as Record<string, unknown>;
      for (const key of ["created_at", "createdAt", "registered_at", "registeredAt", "confirmed_at"]) {
        const value = String(raw[key] ?? "").trim();
        if (value) return value;
      }
      return "";
    };
    return list
      .map((member, index) => ({ member, index }))
      .sort((a, b) => {
        const left = registeredAt(a.member);
        const right = registeredAt(b.member);
        if (left && right && left !== right) return right.localeCompare(left);
        if (left && !right) return -1;
        if (!left && right) return 1;
        return b.index - a.index;
      })
      .map((entry) => entry.member);
  }, [membersData?.members, memberBranchFilter, memberNameFilter, memberBranchOf]);

  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of membersData?.groups ?? []) map.set(g.id, g.name);
    return map;
  }, [membersData?.groups]);

  const downloadExcel = async () => {
    if (stale || ordersLoading) { window.alert(`선택하신 ${month} 자료를 아직 불러오지 못했습니다. 조회가 끝난 뒤 다시 시도해주세요.`); return; }
    if (ordersData?.historyLoadFailed) {
      // 이력 없이 뽑은 파일은 지점 귀속이 틀릴 수 있다 — 배너만 띄우고 내려받게 두면 틀린 보고서가 돌게 된다(Codex 지적 2026-07-29).
      window.alert("지점 변경 이력을 불러오지 못해 지점 귀속이 정확하지 않을 수 있어 다운로드를 취소했습니다.\n'새로고침'으로 다시 조회한 뒤 시도해주세요.");
      return;
    }
    if (countMismatch) {
      // 불완전한 파일은 만들지 않는다 — 카카오 보고 건수와 수집 건수가 다르면 누락 가능성이 있다.
      window.alert(`카카오가 보고한 건수(${formatNumber(ordersData!.reportedCount)}건)와 수집된 건수(${formatNumber(allRows.length)}건)가 달라 다운로드를 취소했습니다.\n'새로고침'을 눌러 다시 조회해주세요.`);
      return;
    }
    if (!visibleRows.length) { window.alert("내려받을 이용내역이 없습니다."); return; }
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildOrdersExcelRows(visibleRows)), "이용내역");
    // 파일명에 걸린 필터를 그대로 적는다 — 내려받은 파일은 화면(visibleRows)과 같은 범위라
    // 구분 필터가 빠지면 퀵·택배만 담긴 파일이 전체 내역처럼 보관·전달된다(코덱스 리뷰 2026-07-29).
    const suffix = (branchFilter === "all" ? "" : `_${branchFilter}`) + (verticalFilter === "logistics" ? "_퀵택배" : "");
    XLSX.writeFile(wb, `카카오T택시_이용내역_${shownMonth}${suffix}.xlsx`);
  };

  // 직원 쓰기(등록·수정·휴직·삭제) 성공 후 — 부서(지점) 변경은 이용내역의 지점/직원 집계를 바꾼다.
  // 백엔드도 쓰기 시점에 이용내역 캐시를 무효화하므로, 화면의 조회 표식을 지워 다음에
  // 이용내역/이상 점검 탭을 열 때 새로 조회하게 한다(안 지우면 묵은 집계가 그대로 보인다).
  const markOrdersStaleAfterMemberWrite = () => {
    ordersRequestedMonthRef.current = null;
    invalidateKakaoTaxiOrdersShared();   // 공유 캐시도 함께 — 묵은 집계가 캐시로 되살아나지 않게
  };

  // ---------- 지점 변경 이력 (2026-07-29) ----------
  // 부서(지점) 변경·삭제 시 이력을 남겨, 이용내역 집계가 "이용일 기준 지점"을 쓸 수 있게 한다.
  // [공용] appendBranchHistory / appendBranchHistoryOrWarn / appendBranchHistoryReversal 과
  // isDefinitelyNotExecuted 는 helpers/kakaoTaxiBranchHistory.ts 에 있다 — 지점 화면(BusinessTaxiTab)의
  // 전입 처리도 **같은 함수**를 쓴다. 한쪽만 규약이 달라지면 그 경로로 바꾼 직원이 소급 집계된다.

  /**
   * 삭제 전 현재 지점 스냅샷 — 카카오에서 회원을 삭제하면 과거 이용내역의 부서가 null 이 되어
   * 지점 집계에서 빠진다(실측, KAKAO_RETIRED_MEMBER_BRANCH 하드코딩의 원인). 삭제 전에 현재 부서를
   * 이력으로 남겨 과거 집계를 보존한다. 기록에 실패하면 throw — 스냅샷 없이 지우면 과거 금액이
   * '미지정'으로 새므로 삭제 자체를 멈춘다(fail-closed).
   * 이미 이 직원의 이력이 있으면 남기지 않는다 — 1970 스냅샷이 기존 이력의 fromBranch 판정을 가리면
   * 변경일 이전 이용이 엉뚱한 지점으로 집계된다.
   */
  const ensureBranchSnapshotBeforeDelete = async (member: KakaoTaxiMember) => {
    const dept = (member.department || "").trim();
    if (!dept) return; // 부서가 원래 없던 직원은 남길 스냅샷이 없다(기존 미지정 집계와 동일)
    let existing: KakaoTaxiBranchHistoryEntry[] | null;
    try {
      existing = await gasClient.getSharedDataFromServer<KakaoTaxiBranchHistoryEntry[]>(KAKAO_TAXI_BRANCH_HISTORY_KEY);
    } catch (e) {
      console.error("지점 변경 이력 조회 실패(삭제 전 확인):", e);
      throw new Error("삭제 전 지점 기록(과거 이용내역 보존용)을 확인하지 못해 삭제를 멈췄습니다.\n네트워크 확인 후 다시 시도해주세요.");
    }
    const hasHistory = (existing || []).some(
      (e) => e && String(e.memberId) === String(member.id) && String(e.accountKey || "acct1") === String(member.account_key || "acct1")
    );
    if (hasHistory) return; // 기존 이력이 과거 지점을 이미 설명한다
    const ok = await appendBranchHistory(createBranchHistoryEntry({
      accountKey: member.account_key,
      memberId: member.id,
      memberName: member.name || "",
      fromBranch: dept,
      toBranch: dept,
      effectiveDate: "1970-01-01", // 전 기간 = 현재 부서. 이력이 없던 직원에게만 쓴다(위 가드).
      note: "삭제 전 지점 스냅샷",
    }));
    if (!ok) {
      throw new Error("삭제 전 지점 기록(과거 이용내역 보존용)에 실패해 삭제를 멈췄습니다.\n네트워크 확인 후 다시 시도해주세요.");
    }
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
      await gasClient.sendKakaoTaxiMemberTms(member.id, adminPinHash, member.account_key);
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
    // 등록 계정은 선택한 그룹이 속한 계정을 그대로 쓴다 — 그룹 드롭다운이 이미 두 계정 그룹을 모두
    // 담고 있으므로, 화면에 계정 선택지를 따로 두지 않고 그룹 선택으로 계정까지 결정한다.
    // [F1] 값은 "계정|그룹id" 합성키 — id 만으로 찾으면 계정이 다른 동일 id 그룹을 잘못 집을 수 있다.
    const selectedGroup = findGroupByOptionKey(membersData?.groups || [], regGroupId);
    if (!selectedGroup) { window.alert("선택한 그룹을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해주세요."); return; }
    const groupName = selectedGroup.name;
    if (!window.confirm(`카카오T 비즈니스에 직원을 등록할까요?\n\n이름: ${regName.trim()}\n휴대전화: ${phone}\n그룹: ${groupName}${regDepartment.trim() ? `\n부서(지점): ${regDepartment.trim()}` : ""}`)) return;
    setRegBusy(true);
    try {
      // **부서는 비워 두지 않는다 — 안 적었으면 그룹명으로 채운다**(사용자 지시 2026-07-31).
      // 이용내역의 지점 판정이 부서를 먼저 보기 때문에, 부서가 비면 그 사람 이용이 미매핑으로 샌다.
      //
      // 다만 **그룹명이 곧 지점명은 아니다** — '기본그룹'·'사카바단단 본사'처럼 지점이 아닌 그룹이 실재한다.
      // 그런 이름을 부서에 넣으면 오히려 확실한 미매핑이 되므로, ERP 지점 목록에 있는 이름일 때만 쓴다.
      const autoDepartment = erpBranches.includes(groupName) ? groupName : "";
      const department = regDepartment.trim() || autoDepartment;
      if (!department) {
        window.alert(
          `부서(지점)를 입력해주세요.\n\n선택한 그룹 '${groupName}'은 지점명이 아니라서 부서를 자동으로 채울 수 없습니다.\n` +
          `부서가 비면 이 직원의 이용내역이 어느 지점 것인지 알 수 없게 됩니다.`
        );
        setRegBusy(false);
        return;
      }
      const input: KakaoTaxiMemberInput = {
        identifier, mobile_phone: phone, group_ids: [selectedGroup.id], name: regName.trim(), department,
      };
      const created = await gasClient.registerKakaoTaxiMember(input, adminPinHash, selectedGroup.account_key);
      markOrdersStaleAfterMemberWrite();
      setRegName(""); setRegIdentifier(""); setRegPhone(""); setRegDepartment("");
      // 등록 직후엔 '미인증' 상태라 인증완료 목록에 아직 안 보인다 — 알림톡으로 인증을 유도해야 목록에 들어온다.
      if (created?.id && window.confirm("등록되었습니다. 지금 바로 인증 알림톡을 보낼까요?\n(직원이 카카오T 앱에서 인증해야 법인택시를 쓸 수 있습니다)")) {
        try {
          await gasClient.sendKakaoTaxiMemberTms(created.id, adminPinHash, selectedGroup.account_key);
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
  // 부서(지점)를 바꿀 때의 적용일 — 이 날짜부터의 이용만 새 지점으로 집계된다(지점 변경 이력, 2026-07-29).
  // 과거 날짜를 넣으면 이미 옮겨버린 직원의 과거 집계도 소급 보정할 수 있다.
  const [editEffectiveDate, setEditEffectiveDate] = useState("");
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
    setEditEffectiveDate(todayDateText());
  };

  const toggleEditGroup = (id: string) => {
    setEditGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  // 그룹 선택지: 활성 그룹 전부 + (비활성이거나 목록에 없는) 직원의 현재 소속 그룹.
  // 현재 소속을 빼고 그리면 저장 시 소속이 조용히 떨어져 나간다 — 반드시 포함해 보여준다.
  // [F6] 반드시 이 직원이 속한 계정의 그룹으로만 좁힌다 — 안 그러면 다른 계정의 그룹을(계정 간
  // id 가 우연히 같을 수도 있어) 저장 시 group_ids 에 잘못 태그해 넣을 수 있다(코덱스 리뷰 2026-07-28).
  const editGroupOptions = useMemo(() => {
    const groups = editing ? (membersData?.groups ?? []).filter((g) => g.account_key === editing.account_key) : [];
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
    // 부서(지점) 변경이면 적용일이 필요하다 — 이 날짜부터의 이용만 새 지점으로 집계된다(지점 변경 이력).
    const deptChanged = editDept.trim() !== (editing.department || "").trim();
    // [계정 간 이동 금지] 부서를 다른 카카오 계정 소속 지점명으로 바꾸면, 그 지점 화면은 다른 계정을
    // 조회해 이 직원이 보이지 않는데 관리자 집계만 그 지점으로 잡혀 택시비가 엉뚱하게 귀속된다.
    // 지점변경 승인 폼과 같은 규칙(Codex 지적 2026-07-29). 바꾸지 않은 기존 부서에는 적용하지 않는다
    // (레거시 표기가 걸려 무관한 수정까지 막히는 것 방지).
    if (deptChanged && editDept.trim() && kakaoTaxiAccountForBranch(editDept.trim()) !== editing.account_key) {
      window.alert(
        `'${editDept.trim()}'은(는) 다른 카카오T 계정(${accountLabel(kakaoTaxiAccountForBranch(editDept.trim()))}) 소속 지점입니다.\n` +
        `계정 간 이동은 지원되지 않습니다 — 기존 계정에서 삭제 후 새 계정으로 새로 등록해주세요.`
      );
      return;
    }
    if (deptChanged && !/^\d{4}-\d{2}-\d{2}$/.test(editEffectiveDate)) {
      window.alert("지점 변경 적용일을 선택해주세요. (이 날짜부터의 이용만 새 지점으로 집계됩니다)");
      return;
    }
    const groupNames = editGroupIds.map((id) => groupNameById.get(id) || id).join(", ");
    if (!window.confirm(
      `${editing.name || editing.identifier} 님의 정보를 수정할까요? 카카오T 비즈니스에 바로 반영됩니다.\n\n` +
      `이름: ${editName.trim() || "(공백)"}\n` +
      `휴대전화: ${phone}${phoneChanged ? "  ← 변경됨: 새 번호로 인증 알림톡이 자동 발송됩니다" : ""}\n` +
      `부서(지점): ${editDept.trim() || "(공백)"}${deptChanged ? `  ← 변경됨: ${editEffectiveDate}부터의 이용만 새 지점으로 집계됩니다` : ""}\n그룹: ${groupNames}`
    )) return;
    setEditBusy(true);
    setMemberBusyId(editing.id);
    let claimedForUpdate = false; // 지점 요청 선점을 잡았는지 — 실패 시 되돌리기 위해
    let historyEntry: KakaoTaxiBranchHistoryEntry | null = null; // 선기록한 이력 — 카카오 확정 실패 시 보정용
    try {
      // [동시 수정 방지] 카드를 열어둔 사이 다른 기기에서 이 직원이 바뀌었을 수 있다.
      // 저장 전에 최신본을 확인해, 스냅샷과 다르면 덮어쓰지 않고 최신 정보로 폼을 다시 연다.
      // forceRefresh=true — 캐시본으로 검사하면 이 방지 장치가 무력화된다(Codex 4R, 승인 경로와 동일 규약).
      const freshList = await loadMembers(true);
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
      // [이력 선기록] 부서 변경은 이력을 카카오 반영보다 먼저 남긴다(Codex 2R 반영) —
      // 카카오만 바뀌고 이력이 없으면 과거 내역이 통째로 새 지점으로 소급되는데, 그 상태는
      // 재시도할 방법이 없다(부서가 이미 새 값이라 변경 전 지점을 모른다). 기록 실패면 저장 자체를
      // 취소한다 — 아무것도 안 바뀐 상태라 그냥 다시 저장하면 된다(fail-closed).
      if (deptChanged) {
        historyEntry = createBranchHistoryEntry({
          accountKey: editing.account_key,
          memberId: editing.id,
          memberName: editName.trim() || editing.name || "",
          fromBranch: (editing.department || "").trim(),
          toBranch: editDept.trim(),
          effectiveDate: editEffectiveDate,
          note: "직원 수정",
        });
        if (!(await appendBranchHistoryOrWarn(historyEntry))) {
          historyEntry = null;
          // 카카오는 아직 부르지 않았다 — 선점만 되돌리면 깨끗한 재시도가 된다.
          if (claimedForUpdate && linkedUpdateRequest) {
            await releaseRequestClaim(linkedUpdateRequest);
            claimedForUpdate = false;
            void loadRequests();
          }
          return;
        }
      }
      await gasClient.updateKakaoTaxiMember(editing.id, {
        mobile_phone: phone,
        group_ids: editGroupIds,
        name: editName.trim(),
        department: editDept.trim(),
      }, adminPinHash, editing.account_key);
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
      // 이력을 선기록했는데 카카오가 '확실히' 실행되지 않았다면 보정 이력으로 집계를 되돌린다.
      // (타임아웃·통신 끊김은 반영됐을 수 있으므로 선기록을 그대로 둔다 — 의도한 값과 일치)
      if (historyEntry && isDefinitelyNotExecuted(e)) {
        await appendBranchHistoryReversal(historyEntry);
      }
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
  // "이 오류를 보고 카카오가 실행되지 않았다고 단정할 수 있는가"(선점 해제·이력 보정의 전제)는
  // helpers/kakaoTaxiBranchHistory.ts 의 isKakaoWriteDefinitelyNotExecuted 로 옮겼다 —
  // 지점 화면의 전입 처리도 같은 판정을 써야 한쪽만 잘못 되돌리는 일이 없다.

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

  /**
   * 승인은 났는데 **아직 직원 본인 인증이 안 끝난** 등록 신청인가.
   *
   * 카카오는 인증을 마친 직원만 목록으로 돌려준다(`/external/v2/members/connected`, Code.gs).
   * 그래서 승인 직후에는 관리자 직원 관리 탭에도, 카카오T 홈페이지에도 그 사람이 보이지 않는다.
   * 아무 표시가 없으면 "정상 승인했는데 어디에도 없다"로 읽혀 중복 등록을 시도하게 된다
   * (실제 문의 2026-07-31 — 대물섬 한남점 박찬호 건).
   *
   * 판단은 전화번호로 한다. 이름은 동명이인이 있고 예금주명처럼 다르게 적히기도 한다.
   * 직원 목록을 아직 못 불러왔으면(로딩 중·조회 실패) 표시하지 않는다 — 없는 것을 "인증 안 됨"으로
   * 단정하면 멀쩡히 인증한 사람까지 대기 중으로 보인다.
   */
  const registerAuthState = (request: KakaoTaxiRequest): "pending" | "done" | "refused" | "blocked" | "unknown" => {
    if (request.type !== "register" || request.status !== "approved") return "unknown";
    // 목록을 아직 못 받았으면 아무것도 단정하지 않는다.
    if (!membersData || membersLoading) return "unknown";
    // 계정 조회가 하나라도 실패했으면 목록이 통째로 빠진 계정이 있다는 뜻이다.
    // 그 상태에서 "목록에 없음 = 인증 안 함"으로 읽으면 멀쩡히 인증한 사람을 대기 중으로 몰고,
    // 반대로 "있음 = 인증 완료"도 근거가 약해진다.
    if ((membersData.accountErrors || []).length > 0) return "unknown";
    // 전화번호가 없는 옛 레코드는 대조할 열쇠가 없다.
    const phone = normalizePhone(request.phone || "");
    if (!phone) return "unknown";
    // **목록에 있다고 인증이 끝난 게 아니다.** 멤버 상태는 네 가지다
    // (created=등록만 됨 / connected=인증 완료 / refused=초대 거부 / blocked=이용 중지).
    // 번호만 있으면 done 으로 보던 종전 판정은, 아직 인증 안 한 사람까지 완료로 적었다(Codex P0 2026-07-31).
    const found = (membersData.members || []).find((m) => normalizePhone(m.mobile_phone || "") === phone);
    if (!found) return "pending";
    if (found.status === "connected") return "done";
    if (found.status === "created") return "pending";
    // **거부·이용중지를 '모름'으로 뭉개지 않는다.** 셋 다 "등록됨"으로만 보이면 관리자는
    // 왜 이 사람이 못 타는지 알 수 없고, 초대를 거부한 사람을 두고 인증을 기다리게 된다.
    if (found.status === "refused") return "refused";
    if (found.status === "blocked") return "blocked";
    return "unknown"; // 모르는 값 — 단정하지 않는다.
  };

  /**
   * 상태 칸에 짧게 적을 말.
   *
   * 저장된 처리 메모(resultNote)를 그대로 찍으면 한 줄이 화면 절반을 먹어 표를 읽을 수 없다
   * ("승인 — 카카오 등록 완료 · 인증 알림톡 발송됨 (직원이 앱에서 인증하면 '등록된 인원'에 표시)").
   * 여기서는 **무슨 일이 끝났는지만** 한마디로 적고, 자세한 내용은 마우스를 올렸을 때 보여준다.
   */
  /**
   * 이용 중지(휴직)를 되돌린다.
   *
   * 휴직시키면 그 사람은 직원 관리 목록에서 사라진다 — 카카오가 **인증 완료자만** 목록으로 주기 때문이다.
   * 그래서 거기 있는 [휴직 해제] 버튼에는 손이 닿지 않는다. 되돌릴 길이 이 신청 줄뿐이라 여기에 둔다
   * (퇴사 취소·재입사에서 실제로 필요하다).
   *
   * 계정은 신청 지점의 매핑에서 얻는다 — 신청 레코드에는 계정이 없고, 목록에도 없어 조회할 수 없다.
   */
  /**
   * 신청의 대상 인원을 **계정까지 확정해서** 찾는다.
   *
   * 카카오 member id 는 계정별로 발급돼 **다른 계정에 같은 id 가 있을 수 있다.** id 만으로 찾아
   * 그 사람의 account_key 로 쓰면 엉뚱한 계정의 직원을 건드린다(삭제 승인이 같은 사고 때문에
   * id+계정으로 확인한다). 확정하지 못하면 실행하지 않는다 — 잘못 푸는 것보다 안 하는 게 낫다.
   */
  const resolveMemberForRequest = (request: KakaoTaxiRequest): KakaoTaxiMember | null => {
    const all = membersData?.members || [];
    // **신청에 계정이 적혀 있으면 그것이 유일한 근거다.** 목록 상태(조회 실패·동일 id)에
    // 흔들리지 않는다 — 지점이 신청할 때 그 사람의 계정을 함께 못 박아 두기 때문이다.
    if (request.accountKey) {
      const exact = all.find((m) => m.id === request.memberId && m.account_key === request.accountKey);
      if (exact) return exact;
      window.alert("신청에 적힌 카카오T 계정에서 대상 인원을 찾지 못했습니다.\n'새로고침'으로 목록을 다시 불러온 뒤 시도해주세요.");
      return null;
    }
    // 옛 신청(계정 미기재) — 목록으로 확정한다. 확정이 안 되면 실행하지 않는다.
    // 계정 조회가 하나라도 실패했으면 목록이 불완전해 **어떤 판정도 믿을 수 없다.**
    // "1건뿐"이라는 것도 다른 계정이 통째로 빠졌기 때문일 수 있다(Codex P0 2026-07-31).
    if (!membersData || (membersData.accountErrors || []).length > 0) {
      window.alert("일부 카카오T 계정 조회에 실패해 대상 계정을 확정할 수 없습니다.\n'새로고침'으로 목록을 다시 불러온 뒤 시도해주세요.");
      return null;
    }
    const matches = all.filter((m) => m.id === request.memberId);
    if (!matches.length) {
      window.alert("대상 인원을 현재 직원 목록에서 찾지 못해 어느 계정인지 알 수 없습니다.\n'새로고침'으로 목록을 다시 불러온 뒤 시도해주세요.");
      return null;
    }
    // 여러 계정에 같은 id 가 있으면 신청 지점이 매핑된 계정만 받아들인다.
    if (matches.length === 1) return matches[0];
    const mapped = matches.find((m) => m.account_key === kakaoTaxiAccountForBranch(request.branchName));
    if (!mapped) {
      window.alert("같은 id 의 직원이 여러 카카오T 계정에 있어 어느 계정인지 확정할 수 없습니다.\n직원 관리 탭에서 확인한 뒤 처리해주세요.");
      return null;
    }
    return mapped;
  };

  const resumeBlockedMember = async (request: KakaoTaxiRequest) => {
    if (anyWriteBusy || !request.memberId) return;
    const target = resolveMemberForRequest(request);
    if (!target) return;
    const accountKey = target.account_key;
    if (!window.confirm(
      `${request.name} 님의 이용중지를 풀까요?\n\n지점: ${request.branchName}\n\n` +
      `다시 법인택시를 탈 수 있게 되고, 인증이 살아 있으면 직원 관리 목록에도 다시 나타납니다.`
    )) return;
    setRequestBusyId(request.id);
    try {
      await gasClient.unblockKakaoTaxiMember([request.memberId], adminPinHash, accountKey);
      markOrdersStaleAfterMemberWrite();
      await Promise.all([loadMembers(true), loadRequests()]);
      window.alert(`${request.name} 님의 이용중지를 풀었습니다.`);
    } catch (e: any) {
      window.alert(`이용재개에 실패했습니다.\n${String(e?.message || e)}`);
    } finally {
      setRequestBusyId("");
    }
  };

  /**
   * 상태 칸에 그릴 알약.
   *
   * '대기'·'승인'이라는 말은 쓰지 않는다(사용자 지시 2026-07-31).
   * 등록 승인은 곧 '끝'이 아니라 그 뒤에 직원 본인 인증이 남아 있어서, '승인'이라고 적어 두면
   * 최종 처리가 끝난 것으로 읽힌다. **무엇이 실제로 끝났는지**만 적는다.
   * 처리 전(대기)은 왼쪽에 [승인]·[반려] 버튼이 그대로 있어 굳이 글자로 알릴 필요가 없다.
   *
   * 색은 상태 칩 규약을 따른다 — 연하게 만들지 않고 원래 채도를 쓴다(DESIGN_ADMIN §2-1).
   * 관리자 스코프가 표준 rose/emerald 를 뒤집거나 죽이므로 hex 로 못 박는다(§2-1 P0).
   */
  const statusChip = (r: KakaoTaxiRequest): { label: string; className: string } | null => {
    const pill = "inline-block w-fit rounded-full px-2 py-0.5 text-[10px] font-black";
    if (r.status === "pending") return null; // 왼쪽 [승인]·[반려] 버튼이 곧 '대기' 표시다
    if (r.status === "processing") return { label: "처리 중", className: `${pill} bg-[#D8DFE9] text-[#1A1A1A]` };
    // **지금 이용중지된 사람이면 그것이 결론이다.** 신청 기록상 반려로 남아 있어도, 그 뒤 다른 경로로
    // 이용중지가 된 경우가 있다(이선복·김미화). 그때 '반려'라고만 적으면 아직 처리가 안 된 것으로
    // 읽혀 같은 요청을 또 올리게 된다(사용자 지시 2026-07-31).
    if (r.memberId && isMemberBlockedNow(r)) {
      return { label: "이용중지", className: `${pill} bg-[#18181B] text-white` };
    }
    if (r.status === "rejected") return { label: "반려", className: `${pill} bg-[#FDE2E2] text-[#B91C1C] border border-[#C93A3A]` };
    if (r.type === "register") {
      const auth = registerAuthState(r);
      // 확실할 때만 '인증 완료'라고 적는다. 목록을 못 받았거나 일부 계정 조회가 실패한 상태에서
      // 단정하면, 정작 인증을 안 한 사람을 끝난 것으로 믿고 넘어가게 된다.
      if (auth === "done") return { label: "인증 완료", className: "" }; // 사용자 지시 — 이것만 알약 없이 그대로 둔다
      if (auth === "pending") return null; // 옆에 '인증 대기 중' 알약이 따로 붙는다
      // 거부·이용중지는 각각 다른 조치가 필요하다 — 거부는 다시 초대해야 하고, 이용중지는 재개하면 된다.
      // 둘을 '등록됨' 하나로 묶으면 왜 못 타는지 알 수 없어 손을 못 쓴다(stop-hook 지적 2026-07-31).
      if (auth === "refused") return { label: "인증 거부", className: `${pill} bg-[#FDE2E2] text-[#B91C1C] border border-[#C93A3A]` };
      if (auth === "blocked") return { label: "이용중지", className: `${pill} bg-[#18181B] text-white` };
      // 남은 건 진짜 '모름'뿐 — 목록을 못 받았거나 계정 조회가 실패한 상태다.
      return { label: "등록됨", className: `${pill} border border-gray-200 bg-[var(--admin-ghost)] text-[#212121]/70` };
    }
    // 지점변경은 처리되면 끝이다 — 상태는 승인(인증완료)/반려 둘 중 하나로만 보인다(사용자 지시 2026-07-31).
    // (반려는 위에서 이미 걸러졌으므로 여기 오는 건 승인된 건뿐이다.)
    if (r.type === "branchChange") return { label: "인증완료", className: `${pill} bg-[#CFDECA] text-[#1A1A1A]` };
    if (r.type === "delete") return { label: "이용중지", className: `${pill} bg-[#18181B] text-white` };
    if (r.type === "resume") return { label: "이용재개", className: `${pill} bg-[#CFDECA] text-[#1A1A1A]` };
    return { label: "처리 완료", className: `${pill} bg-[#CFDECA] text-[#1A1A1A]` };
  };

  /** 마우스를 올렸을 때 보여줄 전체 내용 — 짧게 줄인 상태 칸이 정보를 잃지 않게 한다. */
  /**
   * 비고 칸에 적을 말.
   *
   * 지점이 적어 보낸 사유·메모와 처리 결과를 한 줄로 합친다. 종전에는 '사유·메모' 칸과
   * 상태 칸에 흩어져 있어, 반려 사유를 보려면 두 칸을 번갈아 봐야 했다.
   * 변경신청은 옮겨간 지점·이동일이 곧 핵심이라 앞에 세운다.
   */
  /** 필터 선택지는 **실제로 올라온 신청에 있는 값**으로만 만든다 — 고를 수 있는 게 곧 존재하는 값이 된다. */
  const requestBranchOptions = useMemo(
    () => Array.from(new Set<string>((requestsData?.items || []).map((r) => r.branchName).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "ko")),
    [requestsData]
  );
  const requestTypeOptions = useMemo(
    () => Array.from(new Set((requestsData?.items || []).map((r) => r.type).filter(Boolean))),
    [requestsData]
  );
  /** 화면에 실제로 보이는 신청 — 건수 표시도 이 값을 기준으로 한다(필터를 걸었는데 건수가 전체면 헷갈린다). */
  const visibleRequests = useMemo(() => {
    const name = reqNameFilter.trim();
    return (requestsData?.items || []).filter((r) => {
      if (reqBranchFilter && r.branchName !== reqBranchFilter) return false;
      if (reqTypeFilter && r.type !== reqTypeFilter) return false;
      if (name && !String(r.name || "").includes(name)) return false;
      return true;
    });
  }, [requestsData, reqBranchFilter, reqTypeFilter, reqNameFilter]);

  /**
   * 이 신청의 대상이 **지금** 이용중지 상태인가.
   *
   * 신청 기록의 status 는 그때 무엇을 했는지일 뿐, 지금 그 사람이 탈 수 있는지가 아니다.
   * 목록을 못 받았으면 아무것도 단정하지 않는다(false) — 모르는 걸 이용중지로 적으면 안 된다.
   */
  const isMemberBlockedNow = (r: KakaoTaxiRequest): boolean => {
    if (!r.memberId || !membersData || membersLoading) return false;
    if ((membersData.accountErrors || []).length > 0) return false;
    // 계정까지 맞춰 본다 — id 는 계정별로 발급돼 다른 계정의 동명 id 가 blocked 면 엉뚱한 줄이
    // 이용중지로 보인다(쓰기 경로는 이미 계정을 검증하지만, 표시도 같은 기준이어야 헷갈리지 않는다).
    return (membersData.members || []).some((m) =>
      m.id === r.memberId && m.status === "blocked" && (!r.accountKey || m.account_key === r.accountKey));
  };

  const requestRemark = (r: KakaoTaxiRequest): string => {
    const parts: string[] = [];
    // 지금 이용중지 상태면 그 사실을 먼저 적는다 — 기록상 반려여도 결론은 이용중지다.
    if (r.memberId && isMemberBlockedNow(r)) parts.push("이용중지 승인됨 — 다시 쓰려면 [이용재개]");
    if (r.type === "branchChange") {
      // 어디서 어디로 가는지 한눈에 보이게 **이전 지점부터** 적는다(사용자 지시 2026-07-31).
      // 신청을 올린 지점(branchName)이 곧 이전 소속이다.
      if (r.targetBranch) parts.push(`${r.branchName} → ${r.targetBranch}`);
      if (r.effectiveDate) parts.push(`이동일 ${r.effectiveDate}`);
    }
    if (r.status === "rejected" && r.rejectReason) parts.push(`반려 사유: ${r.rejectReason}`);
    else if (r.type === "register") {
      // 등록 건은 **지금 실제 상태**를 우선한다. 저장된 처리 메모는 승인 순간의 기록이라
      // ("등록 완료 · 알림톡 발송") 나중에 직원이 거부하거나 이용중지되면 사실과 어긋난다.
      // 상태 칸은 '인증 거부'인데 비고는 '완료'라고 하면 재초대가 필요한지 알 수 없다(Codex 2026-07-31).
      const auth = registerAuthState(r);
      // 인증까지 끝난 사람에게는 알림톡 안내를 남기지 않는다 — 할 일이 없는데 뭔가 더 해야
      // 하는 것처럼 읽힌다(사용자 지시 2026-07-31). 끝났다는 말만 남긴다.
      if (auth === "done") parts.push("카카오 등록완료");
      else if (auth === "refused") parts.push("직원이 카카오T 초대를 거부했습니다 — 재초대 필요");
      else if (auth === "blocked") parts.push("이용중지 — 이용재개 필요");
      else if (r.resultNote) parts.push(r.resultNote);
    } else if (r.resultNote) parts.push(r.resultNote);
    if (r.processedAt) parts.push(`처리 ${formatRequestedAt(r.processedAt)}`);
    // **지점이 적어 보낸 사유는 맨 뒤에.** 앞에 두면 사람마다 길이가 제각각이라 표가 지저분해지고,
    // 정작 먼저 봐야 할 처리 결과가 뒤로 밀린다(사용자 지시 2026-07-31).
    // 메모는 사유와 다를 때만 붙인다 — 같은 말을 두 번 적으면 그게 곧 중복이다.
    const reasonText = [r.reason, r.memo && r.memo !== r.reason ? r.memo : ""].filter(Boolean).join(" / ");
    if (reasonText) parts.push(`사유: ${reasonText}`);
    return parts.join(" · ");
  };

  const statusDetail = (r: KakaoTaxiRequest): string => {
    // 툴팁도 비고와 같은 기준으로 적는다 — 한쪽만 옛 처리 메모를 보여주면
    // 마우스를 올렸을 때 상태 칸과 다른 말이 나온다(Codex 2026-07-31).
    let head = r.status === "rejected" ? r.rejectReason : r.resultNote;
    if (r.status !== "rejected" && r.type === "register") {
      const auth = registerAuthState(r);
      if (auth === "refused") head = "직원이 카카오T 초대를 거부했습니다 — 재초대 필요";
      else if (auth === "blocked") head = "이용중지 상태 — 이용재개 필요";
    }
    return [head, r.processedAt ? `처리: ${r.processedAt.slice(0, 16).replace("T", " ")}` : ""]
      .filter(Boolean).join("\n");
  };

  /**
   * 등록 신청 승인 폼의 그룹 기본값 — 지점명과 그룹명이 겹치면 추천, 아니면 관리자가 직접 선택.
   * [F1] 반드시 그 지점이 매핑된 계정의 그룹으로만 좁혀서 이름을 비교한다 — 계정 #1 에도
   * '사카바단단'·'8번대물집' 이름의 껍데기 그룹이 남아 있어, 계정을 안 가리면 이름매칭이
   * 그 껍데기 그룹을 집어 엉뚱한 계정으로 등록하는 사고가 난다(코덱스 리뷰 2026-07-28).
   * 반환값은 승인 드롭다운의 "계정|그룹id" 합성키 — 후보가 없으면 빈 문자열(관리자 직접 선택).
   */
  const guessGroupId = (branch: string): string => {
    const account = kakaoTaxiAccountForBranch(branch);
    const enabled = (membersData?.groups || []).filter((g) => g.status === "enabled" && g.account_key === account);
    const hit = enabled.find((g) => branch.includes(g.name) || g.name.includes(branch));
    return hit ? groupOptionKey(hit) : "";
  };

  const executeApproveRegister = async () => {
    if (!approveTarget || anyWriteBusy) return;
    const request = approveTarget;
    if (!request.phone) { window.alert("신청에 휴대전화번호가 없습니다 — 반려 처리해주세요."); return; }
    if (!approveGroupId) { window.alert("등록할 그룹을 선택해주세요."); return; }
    // 등록 계정 = 선택한 그룹의 소속 계정. 신규 등록 폼(submitRegister)과 같은 규칙 —
    // 그룹 드롭다운 값은 "계정|그룹id" 합성키(F1)이므로 둘 다로 찾는다(id 만으로 찾으면
    // 계정이 다른 동일 id 그룹을 잘못 집을 수 있다).
    const approveGroup = findGroupByOptionKey(membersData?.groups || [], approveGroupId);
    if (!approveGroup) { window.alert("선택한 그룹을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해주세요."); return; }
    const groupName = approveGroup.name;
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
        group_ids: [approveGroup.id],
        name: request.name,
        // 부서 = 그룹명과 같게 맞춘다(사용자 지시 2026-07-31) — 둘이 다르면 그 차이가 그대로 미매핑이 된다.
        // 단 **그룹명이 지점명일 때만**이다. '기본그룹'·'사카바단단 본사'처럼 지점이 아닌 그룹이 실재하므로,
        // 그런 이름을 부서에 넣으면 오히려 확실한 미매핑이 된다. 그때는 신청 지점명이 정확한 값이다.
        department: erpBranches.includes(groupName) ? groupName : request.branchName,
      }, adminPinHash, approveGroup.account_key);
      markOrdersStaleAfterMemberWrite();
      // 메모는 짧게 — 신청 목록 '상태' 칸에 그대로 들어가는 값이다(길면 표를 읽을 수 없다).
      let tmsNote = "알림톡 발송";
      if (created?.id) {
        try {
          await gasClient.sendKakaoTaxiMemberTms(created.id, adminPinHash, approveGroup.account_key);
        } catch {
          tmsNote = "알림톡 실패(직원 관리에서 재발송 필요)";
        }
      }
      const rec = await recordRequestResult(request, { status: "approved", resultNote: `등록 완료 · ${tmsNote}` });
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

  /**
   * 이용재개 요청 승인 — 이용중지된 사람이 복귀했을 때 지점이 올린 요청(2026-07-31).
   *
   * 계정은 **추측하지 않는다.** 이용중지된 사람도 목록에는 남아 있으므로(카카오가 blocked 를 함께 준다)
   * 실제 목록에서 id 로 찾아 그 계정으로만 푼다 — 지점명으로 추측하면 같은 id 가 있는 다른 계정을
   * 건드릴 수 있다(삭제 승인이 같은 사고 때문에 목록 확인을 하는 것과 같은 이유).
   */
  const executeApproveResume = async (request: KakaoTaxiRequest) => {
    if (anyWriteBusy) return;
    if (!request.memberId) { window.alert("대상 인원 정보가 없는 신청입니다 — 반려 처리해주세요."); return; }
    const target = resolveMemberForRequest(request);
    if (!target) return;
    if (!window.confirm(
      `이용재개 요청을 승인할까요?\n\n지점: ${request.branchName}\n대상: ${request.name}\n사유: ${request.reason || "-"}\n\n` +
      `다시 법인택시를 탈 수 있게 되고, 인증이 살아 있으면 '등록된 인원'에도 다시 나타납니다.`
    )) return;
    setRequestBusyId(request.id);
    let claimed = false;
    try {
      if (!(await claimForProcessing(request))) return;
      claimed = true;
      await gasClient.unblockKakaoTaxiMember([request.memberId], adminPinHash, target.account_key);
      markOrdersStaleAfterMemberWrite();
      const list = await loadMembers(true);
      const note = list === null
        ? "이용재개 실행됨 — 목록 재조회 실패로 반영 미확인"
        : list.some((x) => x.id === request.memberId && x.status === "connected")
          ? "이용재개 확인됨"
          : "이용재개 실행됨 — 직원 인증 상태에 따라 목록 반영이 늦을 수 있음";
      const rec = await recordRequestResult(request, { status: "approved", resultNote: note });
      if (rec === "recordFailed") {
        window.alert(`이용재개는 실행됐지만(${note}) 신청 상태 기록에 실패했습니다.\n새로고침 후 '처리 중'으로 남아 있으면 [처리 중 해제]로 정리해주세요.`);
      } else if (rec === "already") {
        window.alert("이용재개는 실행됐지만, 그 사이 다른 관리자가 이 신청을 처리했습니다.\n직원 관리 탭에서 실제 상태를 확인해주세요.");
      } else {
        window.alert(`이용재개 승인 완료 — ${note}.`);
      }
      claimed = false;
      await loadRequests();
    } catch (e: any) {
      if (claimed && isDefinitelyNotExecuted(e)) {
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert(`이용재개 실행에 실패했습니다. 신청은 대기 상태로 되돌렸습니다.\n${String(e?.message || e)}`);
      } else {
        void loadRequests();
        window.alert(
          `이용재개 결과를 확인하지 못했습니다(응답 지연·통신 끊김).\n${String(e?.message || e)}\n\n` +
          `이미 재개됐을 수 있어 신청을 '처리 중'으로 남겨 둡니다. 직원 관리 탭에서 확인한 뒤 정리해주세요.`
        );
      }
    } finally {
      setRequestBusyId("");
    }
  };

  const executeApproveDelete = async (request: KakaoTaxiRequest) => {
    if (anyWriteBusy) return;
    if (!request.memberId) { window.alert("대상 인원 정보가 없는 신청입니다 — 반려 처리해주세요."); return; }
    // 신청 레코드는 계정을 저장하지 않는다 — 삭제할 계정은 현재 불러온 직원 목록에서 대상 id 로 찾아
    // 그 직원의 account_key 를 쓴다(고정값 "acct1" 을 추측해서 쓰지 않는다: Task 8 전까지는 이 방법뿐).
    // 목록에 없으면(다른 기기에서 이미 삭제됐거나 목록 로드가 실패한 경우) 계정을 알 수 없으니
    // 잘못된 계정으로 삭제를 쏘지 않고 여기서 막는다.
    // [F2] id 만으로 찾으면 계정이 다른 동명이인 id 충돌에 걸려 엉뚱한 계정의 직원을 삭제할 수
    // 있다 — 신청 지점이 매핑된 계정까지 함께 확인해야 그 사고를 막는다(코덱스 리뷰 2026-07-28).
    const targetMember = (membersData?.members || []).find(
      // 신청에 계정이 적혀 있으면 그것을 쓴다(2026-07-31) — 지점 매핑은 옛 신청용 폴백이다.
      // 매핑은 추정이라, 매핑과 다른 계정에 있는 직원은 못 찾거나 엉뚱한 계정을 잡을 수 있다.
      (x) => x.id === request.memberId
        && x.account_key === (request.accountKey || kakaoTaxiAccountForBranch(request.branchName))
    );
    if (!targetMember) {
      window.alert("삭제 대상 인원을 현재 직원 목록에서 찾지 못해 어느 계정인지 알 수 없습니다.\n'새로고침'으로 직원 목록을 다시 불러온 뒤 다시 시도하거나, 이미 삭제된 인원이면 반려 처리해주세요.");
      return;
    }
    if (!window.confirm(
      `삭제 요청(이용중지)을 승인할까요?\n\n지점: ${request.branchName}\n대상: ${request.name}\n사유: ${request.reason || "-"}\n\n` +
      `이 인원이 이용중지되어 지점 목록에서 사라지고 택시를 탈 수 없게 됩니다.\n` +
      `**계정과 과거 이용내역은 지우지 않습니다** — 지난 이용분의 지점 집계가 그대로 남습니다.\n` +
      `다시 쓰게 하려면 이 신청 목록에서 [이용재개]를 누르면 됩니다.\n` +
      `(이용중지하면 직원 관리 목록에서는 사라집니다 — 카카오가 인증 완료자만 목록으로 주기 때문입니다)`
    )) return;
    setRequestBusyId(request.id);
    // 지점 스냅샷 — 이용 중지 뒤에도 과거 이용내역의 지점 판정이 흔들리지 않게 먼저 남긴다(fail-closed).
    // 선점(claim) 전에 남긴다: 스냅샷 실패가 '카카오 실행 여부 불명' 경로로 오인되지 않게 한다.
    try {
      await ensureBranchSnapshotBeforeDelete(targetMember);
    } catch (e: any) {
      window.alert(String(e?.message || e));
      setRequestBusyId("");
      return;
    }
    let claimed = false;
    try {
      if (!(await claimForProcessing(request))) return;
      claimed = true;
      // **계정을 지우지 않는다.** 예전에는 여기서 deleteKakaoTaxiMember 로 계정을 통째로 지웠는데,
      // 그러면 그 사람의 과거 이용내역이 어느 지점 것인지까지 잃었다(2026-07-29 사고).
      // 휴직(block)은 이용만 막고 계정·이용내역을 남긴다. 지점 목록은 인증완료자만 보여주므로
      // 휴직 즉시 목록에서도 사라진다 — 지점이 기대하는 "삭제"가 화면상으로는 그대로 이뤄진다.
      await gasClient.blockKakaoTaxiMember([request.memberId], adminPinHash, targetMember.account_key);
      markOrdersStaleAfterMemberWrite();
      const list = await loadMembers();
      const note = list === null
        ? "이용중지(인증 해제) 실행됨 — 목록 재조회 실패로 반영 미확인"
        : list.some((x) => x.id === request.memberId)
          ? "이용중지 접수됨 — 목록에서 아직 반영 미확인"
          : "이용중지 확인됨(계정·이용내역은 보존)";
      const rec = await recordRequestResult(request, { status: "approved", resultNote: note });
      if (rec === "recordFailed") {
        window.alert(`이용중지는 실행됐지만(${note}) 신청 상태 기록에 실패했습니다.\n새로고침 후 '처리 중'으로 남아 있으면 [처리 중 해제]로 정리해주세요(이용중지는 이미 실행됨).`);
      } else if (rec === "already") {
        // CAS 충돌 — 내가 이용 중지를 실행하는 사이 다른 관리자가 이 신청을 가로챘다.
        window.alert(
          `이용중지는 실행됐지만, 그 사이 다른 관리자가 이 신청을 처리했습니다.\n` +
          `중복 처리 흔적이 있을 수 있으니 직원 관리 탭에서 실제 상태를 확인해주세요.`
        );
      } else {
        window.alert(`삭제 요청(이용중지) 승인 완료 — ${note}.`);
      }
      claimed = false;
      await loadRequests();
    } catch (e: any) {
      if (claimed && isDefinitelyNotExecuted(e)) {
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert(`이용중지 실행에 실패했습니다. 신청은 대기 상태로 되돌렸습니다.\n${String(e?.message || e)}`);
      } else {
        void loadRequests();
        window.alert(
          `이용중지 결과를 확인하지 못했습니다(응답 지연·통신 끊김).\n${String(e?.message || e)}\n\n` +
          `카카오T에서 이미 이용중지됐을 수 있어 신청을 '처리 중'으로 남겨 둡니다.\n` +
          `직원 관리 탭에서 확인한 뒤 정리해주세요.`
        );
      }
    } finally {
      setRequestBusyId("");
    }
  };

  /**
   * 지점변경 승인 폼 열기 — 변경신청(branchChange)과 레거시 삭제요청의 [지점변경으로 처리]가 함께 쓴다.
   * 다른 승인/반려 폼은 닫는다(동시에 여러 폼이 떠서 서로 다른 신청을 헷갈리는 것 방지).
   */
  const startBranchChangeApproval = (request: KakaoTaxiRequest) => {
    if (anyWriteBusy) return;
    setBranchChangeTarget(request);
    setBranchChangeBranch(request.targetBranch || "");
    setBranchChangeDate(/^\d{4}-\d{2}-\d{2}$/.test(request.effectiveDate || "") ? String(request.effectiveDate) : todayDateText());
    setApproveTarget(null);
    setRejectTarget(null);
  };

  /**
   * 지점변경 승인 실행 — 직원을 지우지 않고 카카오 부서(department)만 새 지점으로 바꾼 뒤,
   * 지점 변경 이력을 남긴다(적용일부터의 이용만 새 지점으로 집계). 선점·기록 규약은 삭제 승인과 동일.
   */
  const executeApproveBranchChange = async () => {
    if (!branchChangeTarget || anyWriteBusy) return;
    const request = branchChangeTarget;
    if (!request.memberId) { window.alert("대상 인원 정보가 없는 신청입니다 — 반려 처리해주세요."); return; }
    const newBranch = branchChangeBranch.trim();
    if (!newBranch) { window.alert("옮길 지점을 선택해주세요."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(branchChangeDate)) { window.alert("적용일을 선택해주세요."); return; }
    // [F2] 신청 지점이 매핑된 계정까지 함께 확인 — id 만으로 찾으면 다른 계정의 동일 id 직원을 잘못 집는다.
    const targetMember = (membersData?.members || []).find(
      // 신청에 계정이 적혀 있으면 그것을 쓴다(2026-07-31) — 지점 매핑은 옛 신청용 폴백이다.
      // 매핑은 추정이라, 매핑과 다른 계정에 있는 직원은 못 찾거나 엉뚱한 계정을 잡을 수 있다.
      (x) => x.id === request.memberId
        && x.account_key === (request.accountKey || kakaoTaxiAccountForBranch(request.branchName))
    );
    if (!targetMember) {
      window.alert("대상 인원을 현재 직원 목록에서 찾지 못했습니다.\n'새로고침'으로 직원 목록을 다시 불러온 뒤 다시 시도하거나, 이미 삭제된 인원이면 반려 처리해주세요.");
      return;
    }
    const fromBranch = (targetMember.department || "").trim();
    if (fromBranch === newBranch) {
      window.alert(
        `이미 '${newBranch}' 소속입니다. 다른 지점을 선택하거나 반려 처리해주세요.\n` +
        `(이전 처리에서 카카오 반영까지 끝난 신청이라면 반려 사유에 '이미 반영됨'으로 남겨 정리해주세요)`
      );
      return;
    }
    // [계정 간 이동 불가] 지점↔계정 매핑이 하드코딩이라(acct1↔acct2) 부서만 바꾸면 집계 계정이 어긋난다.
    if (kakaoTaxiAccountForBranch(newBranch) !== targetMember.account_key) {
      window.alert(
        `'${newBranch}'는 다른 카카오T 계정(${accountLabel(kakaoTaxiAccountForBranch(newBranch))}) 소속 지점입니다.\n` +
        `계정 간 이동은 지원되지 않습니다 — 기존 계정에서 삭제 후 새 계정으로 새로 등록해주세요.`
      );
      return;
    }
    if (!window.confirm(
      `지점 변경을 승인할까요?\n\n대상: ${request.name}\n${fromBranch || "(부서 없음)"} → ${newBranch}\n` +
      `적용일: ${branchChangeDate} — 이 날짜부터의 이용만 새 지점으로 집계되고, 이전 이용은 기존 지점에 남습니다.\n\n` +
      `직원 계정은 삭제되지 않습니다.`
    )) return;
    setRequestBusyId(request.id);
    let claimed = false;
    let historyEntry: KakaoTaxiBranchHistoryEntry | null = null; // 선기록한 이력 — 카카오 확정 실패 시 보정용
    try {
      if (!(await claimForProcessing(request))) return;
      claimed = true;
      // [동시 수정 방지] confirm 을 띄워 둔 사이 다른 관리자가 이 직원을 바꿨을 수 있다(Codex 3R).
      // 선점 직후 서버에서 재조회해 최신 값으로 가드를 다시 검증하고, PUT·이력도 최신 값으로 만든다 —
      // 오래된 스냅샷으로 실행하면 남의 부서·전화 수정을 되돌린다. 확인 실패면 실행하지 않는다(fail-closed).
      // forceRefresh=true 필수 — 캐시를 우회해 카카오 실시간 값을 본다(캐시본이면 이 검사가 무력화됨, Codex 4R).
      const freshList = await loadMembers(true);
      if (freshList === null) {
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert("최신 직원 정보를 확인하지 못해 지점 변경을 취소했습니다.\n네트워크 확인 후 다시 승인해주세요.");
        return;
      }
      const fresh = freshList.find((x) => x.id === request.memberId && x.account_key === targetMember.account_key);
      if (!fresh) {
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert("이 직원이 목록에서 사라졌습니다(다른 기기에서 삭제되었을 수 있음). 지점 변경을 취소했습니다.\n확인 후 필요하면 반려 처리해주세요.");
        return;
      }
      const freshDept = (fresh.department || "").trim();
      if (freshDept !== fromBranch) {
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert(
          `승인 창을 띄워 둔 사이 이 직원의 부서가 '${fromBranch || "(없음)"}'에서 '${freshDept || "(없음)"}'(으)로 바뀌었습니다.\n` +
          `덮어쓰지 않도록 지점 변경을 취소했습니다. 현재 상태를 확인한 뒤 다시 승인해주세요.`
        );
        return;
      }
      // [이력 선기록] 카카오 반영보다 먼저 남긴다(Codex 2R 반영) — 기록 실패면 아무것도 실행하지 않고
      // 대기로 되돌린다(아무것도 안 바뀐 상태라 재승인이 곧 깨끗한 재시도다). 카카오가 확실히 실패하면
      // 아래 catch 가 보정 이력으로 집계를 되돌린다.
      const entry = createBranchHistoryEntry({
        accountKey: fresh.account_key,
        memberId: fresh.id,
        memberName: fresh.name || request.name || "",
        fromBranch,
        toBranch: newBranch,
        effectiveDate: branchChangeDate,
        note: "변경신청 승인",
      });
      if (!(await appendBranchHistoryOrWarn(entry))) {
        await releaseRequestClaim(request);   // 카카오는 부르지 않았다 — 안내는 appendBranchHistoryOrWarn 이 했다
        claimed = false;
        void loadRequests();
        return;
      }
      historyEntry = entry;
      // 4개 필드를 항상 함께 보낸다 — 안 보내면 카카오가 name/department 를 공백으로 지운다(GAS 규약).
      // 값은 방금 재조회한 최신본(fresh) 기준 — 다른 관리자의 전화·그룹 수정을 되돌리지 않는다.
      await gasClient.updateKakaoTaxiMember(request.memberId, {
        mobile_phone: (fresh.mobile_phone || "").replace(/[^0-9]/g, ""),
        group_ids: fresh.group_ids || [],
        name: fresh.name || "",
        department: newBranch,
      }, adminPinHash, fresh.account_key);
      markOrdersStaleAfterMemberWrite();
      const note = `지점 변경 완료: ${fromBranch || "(부서 없음)"} → ${newBranch} · 적용일 ${branchChangeDate}`;
      const rec = await recordRequestResult(request, { status: "approved", resultNote: note });
      if (rec === "recordFailed") {
        window.alert(
          `지점 변경은 카카오에 반영됐지만 신청 상태 기록에 실패했습니다.\n` +
          `새로고침 후 '처리 중'으로 남아 있으면 [처리 중 해제]로 정리해주세요(변경은 이미 반영됨 — 다시 승인하지 마세요).`
        );
      } else if (rec === "already") {
        window.alert("지점 변경은 반영됐지만, 그 사이 다른 관리자가 이 신청을 처리했습니다.\n직원 관리 탭에서 실제 상태를 확인해주세요.");
      } else {
        window.alert(`지점 변경 승인 완료 — ${request.name}: ${fromBranch || "(부서 없음)"} → ${newBranch} (적용일 ${branchChangeDate})`);
      }
      claimed = false;
      setBranchChangeTarget(null);
      await Promise.all([loadRequests(), loadMembers()]);
    } catch (e: any) {
      if (claimed && isDefinitelyNotExecuted(e)) {
        // 선기록한 이력을 보정으로 상쇄한 뒤 대기로 되돌린다 — 재승인이 처음부터 다시 진행된다.
        if (historyEntry) await appendBranchHistoryReversal(historyEntry);
        await releaseRequestClaim(request); claimed = false; void loadRequests();
        window.alert(`지점 변경 실행에 실패했습니다. 신청은 대기 상태로 되돌렸습니다.\n${String(e?.message || e)}`);
      } else {
        // 반영 여부 불명 — 선기록 이력은 의도한 값과 일치하므로 그대로 둔다.
        void loadRequests();
        window.alert(
          `지점 변경 결과를 확인하지 못했습니다(응답 지연·통신 끊김).\n${String(e?.message || e)}\n\n` +
          `이미 반영됐을 수 있어 신청을 '처리 중'으로 남겨 둡니다. 직원 관리 탭에서 부서를 확인한 뒤 정리해주세요.`
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
    // [F2] id 만으로 찾으면 계정이 다른 동일 id 충돌에 걸려 엉뚱한 계정의 직원 카드를 열 수 있다 —
    // 신청 지점이 매핑된 계정까지 함께 확인한다(코덱스 리뷰 2026-07-28).
    const member = (membersData?.members || []).find(
      // 신청에 계정이 적혀 있으면 그것을 쓴다(2026-07-31) — 지점 매핑은 옛 신청용 폴백이다.
      // 매핑은 추정이라, 매핑과 다른 계정에 있는 직원은 못 찾거나 엉뚱한 계정을 잡을 수 있다.
      (x) => x.id === request.memberId
        && x.account_key === (request.accountKey || kakaoTaxiAccountForBranch(request.branchName))
    );
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
      {/* 계정 일부 조회 실패 — 지금 뷰가 그리는 데이터(ordersData/membersData)에 실린 값만 본다.
          로드가 아직 안 끝났거나 실패해 데이터 자체가 없으면(옛 조회의 잔재와 헷갈리지 않게) 보여주지 않는다.
          requests 뷰는 membersData 로 승인 UI를 그리므로 members 와 같은 로딩 상태로 게이트한다(F4). */}
      {((needsMonth && !ordersLoading && ordersData) || ((view === "members" || view === "requests") && !membersLoading && membersData)) && dedupedAccountErrors.length > 0 && (
        <div className={ERROR_BANNER}>
          {dedupedAccountErrors.map((e) => e.label).join(", ")} 조회 실패 — 아래 집계에 해당 계정 내역이 빠져 있습니다.
          잠시 후 새로고침해주세요. ({dedupedAccountErrors[0].message})
        </div>
      )}
      {/* 지점 변경 이력을 못 읽었으면 과거 이용분이 '현재 지점' 기준으로 보일 수 있다 — 숨기지 않고 알린다 */}
      {needsMonth && !ordersLoading && ordersData && ordersData.historyLoadFailed && (
        <div className={ERROR_BANNER}>
          지점 변경 이력을 불러오지 못했습니다 — 지점을 옮긴 직원의 과거 이용분이 현재 지점 기준으로 집계되어 보일 수 있습니다. '새로고침'을 눌러주세요.
        </div>
      )}
      {needsMonth && !ordersLoading && ordersData && countMismatch && (
        <div className={ERROR_BANNER}>
          카카오가 보고한 건수({formatNumber(ordersData.reportedCount)}건)와 수집된 건수({formatNumber(allRows.length)}건)가 다릅니다.
          조회 도중 새 이용이 생겼을 수 있으니 '새로고침'을 눌러주세요.
        </div>
      )}
      {needsMonth && !ordersLoading && ordersData && !totalsOk && (
        <div className={ERROR_BANNER}>집계 검증에 실패했습니다. 화면 수치를 그대로 믿지 마시고 새로고침 후에도 반복되면 알려주세요.</div>
      )}

      {/* 로딩 중임을 글로 명시한다 — 스피너만 있으면 멈춘 것인지 로딩인지 구분이 안 된다(사용자 지적 2026-07-29) */}
      {needsMonth && ordersLoading && (
        <div className="py-20 text-center space-y-3">
          <LoadingSpinner size="md" />
          <p className="text-xs font-bold text-[#212121]/60">
            카카오T에서 {month} 이용내역을 불러오는 중입니다… 처음 조회는 10초 정도 걸릴 수 있습니다.
          </p>
        </div>
      )}

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

          {/* 합계 3분할 — [지점별 합계] [직원별 합계] [퀵·택배 내역](2026-07-29 신설). 앞의 두 표는
              내부 마크업을 바꾸지 않고 폭만 줄어든다. */}
          <div className="grid lg:grid-cols-3 gap-5">
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
                    {/* 클릭 = "이 지점의 상세를 보여줘" — 구분 필터도 함께 풀어야 그 뜻이 유지된다 */}
                    {branchTotals.map((b) => (
                      <tr key={b.branchName}
                        onClick={() => { setBranchFilter(b.branchName); setMemberFilter(""); setVerticalFilter("all"); }}
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
                    {/* 지점별 합계와 같은 규칙 — 이 직원의 상세를 보는 것이므로 구분 필터는 푼다.
                        직원 필터가 이름 입력으로 바뀌었으므로 여기서도 이름을 넣는다.
                        **지점도 함께 건다** — 이름만 걸면 동명이인이 한 화면에 섞여, 남의 이용까지
                        그 사람 것으로 읽힌다(이 표가 계정·지점까지 갈라 세는 이유가 그것이다). */}
                    {memberTotals.map((m) => (
                      <tr key={m.memberKey}
                        onClick={() => { setMemberFilter(m.name); setBranchFilter(m.branchName); setVerticalFilter("all"); }}
                        className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${memberFilter && memberFilter === m.name && branchFilter === m.branchName ? "bg-gray-100" : ""}`}
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
            {/* 퀵·택배 내역 — 이상 점검에서 뺀 logistics 건을 사람이 직접 보는 자리(2026-07-29).
                순수 조회용 뷰라 위 두 합계·상단 카드의 집계 입력은 건드리지 않는다(퀵 포함 현행 유지). */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
                <h2 className="admin-pill-title">퀵·택배 내역</h2>
                <span className="text-[11px] font-bold text-[#212121]/60">
                  {formatNumber(logisticsRows.length)}건 · {formatNumber(logisticsAmount)}원
                </span>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                {logisticsRows.length ? (
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead><tr className="text-left">
                      <th className="px-2 py-2 text-[11px] font-black text-[#212121]">일시</th>
                      <th className="px-2 py-2 text-[11px] font-black text-[#212121]">직원</th>
                      <th className="px-2 py-2 text-[11px] font-black text-[#212121]">상품</th>
                      <th className="px-2 py-2 text-[11px] font-black text-[#212121] text-right">금액</th>
                    </tr></thead>
                    <tbody>
                      {/* 경로는 폭이 없어 컬럼으로 두지 않고 행 툴팁으로만 보여준다(기존 툴팁 유지, 클릭 안내만 덧붙였다).
                          행 클릭은 지점별/직원별 합계와 같은 UX — 상세 내역을 퀵·택배 건만으로 좁힌다(2026-07-29).
                          이 표에는 행별 필터 대상이 따로 없어 어느 행을 눌러도 결과가 같다(표 전체 = logistics). */}
                      {logisticsRows.map((r, i) => (
                        <tr key={r.order.id ? `${r.accountKey}|${r.order.id}` : `noid-${i}`}
                          onClick={() => { setVerticalFilter("logistics"); setBranchFilter("all"); setMemberFilter(""); }}
                          className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${verticalFilter === "logistics" ? "bg-gray-100" : ""}`}
                          title={`${r.timeText}\n${r.order.departure_point} → ${r.order.arrival_point}\n클릭하면 상세 내역이 퀵·택배 건만 표시됩니다`}>
                          <td className="px-2 py-2">{shortTimeText(r.timeText)}</td>
                          <td className="px-2 py-2 font-bold text-[#212121]">{r.order.member_name || "(이름 없음)"}</td>
                          <td className="px-2 py-2 max-w-[8rem] truncate" title={r.order.vertical_product_name || ""}>
                            {r.order.vertical_product_name || verticalLabel(r.order.vertical_code)}
                          </td>
                          <td className="px-2 py-2 text-right font-bold">{formatNumber(r.amount)}원</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-6 text-xs font-bold text-[#212121]/50">이번 달 퀵·택배 이용이 없습니다.</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
              <h2 className="admin-pill-title">상세 내역</h2>
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white"
                aria-label="계정 필터"
              >
                <option value="all">전체 계정</option>
                <option value="acct1">1계정</option>
                <option value="acct2">2계정</option>
              </select>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white"
                aria-label="지점 필터"
              >
                <option value="all">전체 지점</option>
                {branchTotals.map((b) => <option key={b.branchName} value={b.branchName}>{b.branchName}</option>)}
              </select>
              {/* 직원은 드롭다운이 아니라 **직접 입력**으로 찾는다(사용자 지시 2026-07-31).
                  인원이 많아 목록에서 눈으로 찾기 어려웠다. 이름 일부만 쳐도 걸린다. */}
              <input
                type="text"
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                placeholder="직원 이름"
                aria-label="직원 이름으로 찾기"
                className="h-8 w-32 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white"
              />
              {/* 구분 필터는 드롭다운이 없어 화면에 흔적이 남지 않는다 — 걸려 있으면 칩으로 드러낸다.
                  안 그러면 좁혀진 결과가 0건일 때 "이용내역이 없습니다"가 전체 0건으로 오인된다
                  (코덱스 리뷰 2026-07-29). 해제는 아래 '필터 해제' 버튼이 맡으므로 클릭 동작은 없다. */}
              {verticalFilter === "logistics" && (
                <span
                  className="h-8 inline-flex items-center border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-gray-100"
                  title="구분 필터가 걸려 있습니다 — 퀵·택배 이용만 보고 있습니다"
                >구분: 퀵·택배</span>
              )}
              {/* 구분 필터는 드롭다운이 없고 퀵·택배 표 클릭으로만 걸리므로, 해제 버튼이 유일한 출구다 */}
              {(accountFilter !== "all" || branchFilter !== "all" || memberFilter !== "" || verticalFilter !== "all") && (
                <button
                  onClick={() => { setAccountFilter("all"); setBranchFilter("all"); setMemberFilter(""); setVerticalFilter("all"); }}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-[11px] font-black text-[#212121]"
                >필터 해제</button>
              )}
              <span className="text-[11px] font-bold text-[#212121]/60">{formatNumber(visibleRows.length)}건</span>
            </div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full text-xs whitespace-nowrap">
                {/* 계정 컬럼은 제거하고(상단 계정 필터 드롭다운으로 대체) 그 폭을 '이용사유'에 넘겼다(2026-07-29) */}
                <thead><tr className="text-left">
                  <th className="px-2 py-2 text-[11px] font-black text-[#212121]">이용일시</th>
                  <th className="px-2 py-2 text-[11px] font-black text-[#212121]">직원</th>
                  <th className="px-2 py-2 text-[11px] font-black text-[#212121]">지점</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">출발지 → 도착지</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">이용사유</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121] text-right">금액</th>
                  <th className="px-4 py-2 text-[11px] font-black text-[#212121]">구분</th>
                </tr></thead>
                <tbody>
                  {/* id 없는 주문이 섞여도 key 가 중복되지 않게 순번으로 폴백 — 필터/정렬 결과라 순번 key 로 충분 */}
                  {visibleRows.map(({ order, branchName, unmapped, amount, timeText }, i) => (
                    <tr key={order.id || `noid-${i}`} className="border-t border-gray-100">
                      {/* 표시만 축약(MM-DD HH:mm) — 정렬·비교는 위에서 원본 timeText 로 한다. 전체 시각은 툴팁 */}
                      <td className="px-2 py-2" title={timeText}>{shortTimeText(timeText)}</td>
                      <td className="px-2 py-2 font-bold text-[#212121]">{order.member_name || "(이름 없음)"}</td>
                      <td className="px-2 py-2">
                        {branchName}
                        {unmapped && <span className="ml-1.5 text-[11px] font-bold text-[#B91C1C]">(미매핑)</span>}
                      </td>
                      <td className="px-4 py-2 max-w-[26rem] truncate" title={`${order.departure_point} → ${order.arrival_point}`}>
                        {order.departure_point} → {order.arrival_point}
                      </td>
                      {/* 자유 입력이라 길 수 있어 잘라 보이고 전체는 툴팁. 옛 캐시·미배포 GAS 에는 필드가 없어 `|| ""` 필수 */}
                      <td className="px-4 py-2 max-w-[10rem] truncate" title={order.use_code || ""}>{order.use_code || ""}</td>
                      <td className="px-4 py-2 text-right font-bold">{formatNumber(amount)}원</td>
                      <td className="px-4 py-2">{verticalLabel(order.vertical_code)}</td>
                    </tr>
                  ))}
                  {!visibleRows.length && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">이용내역이 없습니다.</td></tr>
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

          {/* 점검 대상 건을 대표 사유별 3개 카드로 나눠 세로로 쌓는다(사용자 지시 2026-07-29) */}
          {renderAnomalyCard("고액", flaggedByReason.highFare, "고액 건이 없습니다.")}
          {renderAnomalyCard("낮 시간대 이용", flaggedByReason.daytime, "낮 시간대 이용 건이 없습니다.")}
          {renderAnomalyCard(
            "지점 미매핑", flaggedByReason.unmapped, "지점 미매핑 건이 없습니다.",
            "부서(지점) 미기입·미인식 건 — 직원 관리에서 부서를 채우면 목록에서 사라집니다",
          )}
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
                      {/* [F1] 이 신청 지점이 매핑된 계정의 그룹만 보여준다 — 계정 #1 의 껍데기 그룹까지
                          섞어 보여주면 이름이 같은 그룹을 잘못 골라 엉뚱한 계정에 등록하게 된다. */}
                      {(membersData?.groups || [])
                        .filter((g) => g.status === "enabled" && g.account_key === kakaoTaxiAccountForBranch(approveTarget.branchName))
                        .map((g) => (
                          <option key={groupOptionKey(g)} value={groupOptionKey(g)}>{`${g.name} (${accountLabel(g.account_key)})`}</option>
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

              {/* 지점변경 승인 — 직원을 지우지 않고 소속 지점만 옮긴다(변경신청·레거시 삭제요청 공용) */}
              {branchChangeTarget && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
                  <h2 className="admin-pill-title">지점변경 승인 — {branchChangeTarget.branchName} · {branchChangeTarget.name}</h2>
                  {branchChangeTarget.reason && (
                    <p className="text-[11px] font-bold text-[#212121]">지점 요청 사유: {branchChangeTarget.reason}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <select value={branchChangeBranch} onChange={(e) => setBranchChangeBranch(e.target.value)} disabled={requestBusy}
                      className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" aria-label="옮길 지점">
                      <option value="">옮길 지점 선택 (필수)</option>
                      {erpBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-[11px] font-bold text-[#212121]">
                      적용일
                      <input type="date" value={branchChangeDate} onChange={(e) => setBranchChangeDate(e.target.value)} disabled={requestBusy}
                        className="h-8 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white disabled:opacity-50" aria-label="적용일" />
                    </label>
                    <button onClick={() => void executeApproveBranchChange()} disabled={anyWriteBusy}
                      className="h-8 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-50">
                      {requestBusy ? "처리 중..." : "지점변경 승인"}
                    </button>
                    <button onClick={() => setBranchChangeTarget(null)} disabled={requestBusy}
                      className="admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black cursor-pointer disabled:opacity-50">취소</button>
                  </div>
                  <p className="text-[11px] font-bold text-[#212121]/60">
                    적용일부터의 이용만 새 지점으로 집계되고, 이전 이용은 기존 지점에 남습니다. 직원 계정은 삭제되지 않습니다.
                  </p>
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
                    {/* 부서(지점)를 바꿀 때만 — 이 날짜부터의 이용만 새 지점으로 집계된다(지점 변경 이력, 2026-07-29).
                        과거 날짜를 넣으면 이미 옮겨버린 직원의 지난달 집계도 소급 보정된다. */}
                    {editDept.trim() !== (editing.department || "").trim() && (
                      <label className="flex items-center gap-2 text-[11px] font-bold text-[#212121]">
                        <span className="whitespace-nowrap">지점 변경 적용일</span>
                        <input type="date" value={editEffectiveDate} onChange={(e) => setEditEffectiveDate(e.target.value)} disabled={editBusy}
                          title="이 날짜부터의 이용만 새 지점으로 집계됩니다 (이전 이용은 기존 지점 유지)"
                          className="h-8 flex-1 min-w-0 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white disabled:opacity-50" />
                      </label>
                    )}
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
                <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
                  <h2 className="admin-pill-title">
                    {/* 필터를 걸면 건수도 필터 기준이 된다 — 그때 전체 대기 건수를 함께 적어
                        "다른 지점에 대기 건이 있는데 없다고 오해"하는 일을 막는다(Codex P2 2026-07-31). */}
                    신청 목록 — 대기 {formatNumber(visibleRequests.filter((r) => r.status === "pending").length)}건 / 전체 {formatNumber(visibleRequests.length)}건
                    {(reqBranchFilter || reqNameFilter || reqTypeFilter) &&
                      ` · 필터 제외 포함 전체 대기 ${formatNumber(requestsData.items.filter((r) => r.status === "pending").length)}건`}
                  </h2>
                  {/* 필터는 제목 옆에 둔다(사용자 지시 2026-07-31). 지점·종류는 실제 값으로만 목록을 만들어
                      고를 수 있는 게 곧 존재하는 값이 되게 하고, 이름은 직접 입력한다. */}
                  <select value={reqBranchFilter} onChange={(e) => setReqBranchFilter(e.target.value)}
                    className="h-8 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white" aria-label="지점 필터">
                    <option value="">지점 전체</option>
                    {requestBranchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <input value={reqNameFilter} onChange={(e) => setReqNameFilter(e.target.value)} placeholder="이름"
                    className="h-8 w-24 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white" aria-label="이름 필터" />
                  <select value={reqTypeFilter} onChange={(e) => setReqTypeFilter(e.target.value)}
                    className="h-8 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white" aria-label="종류 필터">
                    <option value="">종류 전체</option>
                    {requestTypeOptions.map((t) => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t as KakaoTaxiRequest["type"]] || t}</option>)}
                  </select>
                  {(reqBranchFilter || reqNameFilter || reqTypeFilter) && (
                    <button onClick={() => { setReqBranchFilter(""); setReqNameFilter(""); setReqTypeFilter(""); }}
                      className="admin-period-chip h-8 px-3 rounded-full text-[11px] font-black cursor-pointer">필터 해제</button>
                  )}
                </div>
                <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                  {/* 엑셀 형식(DESIGN.md §9-1) — 헤더는 바닐라 배경 + 사방 검정 격자,
                      본문 셀은 옅은 격자, 표는 border-separate·사각 모서리.
                      [주의] 관리자 화면이므로 **`--admin-vanilla`** 를 쓴다. 지점 hex(#EFF0A3)를
                      그대로 박으면 다크 모드에서 관리자 바닐라(#F4F2CC)로 안 바뀌어 혼자 튄다. */}
                  <table className="w-full text-xs whitespace-nowrap border-separate" style={{ borderSpacing: 0 }}>
                    {/* 컬럼 순서는 사용자 지시(2026-07-31): 신청일·지점·대상·종류·상태·비고.
                        승인/반려는 별도 '처리' 칸을 두지 않고 **상태 칸 안에** 둔다 — 아직 처리 안 한
                        건이 곧 그 줄의 상태이고, 눌러야 할 것과 상태를 한 곳에서 보게 된다. */}
                    <thead><tr className="text-left">
                      {["신청일", "지점", "대상", "종류", "상태", "비고"].map((h, i) => (
                        <th key={h}
                          className={`bg-[var(--admin-vanilla)] border-t border-r border-b border-[#212121] px-2 py-1.5 text-[11px] font-black text-[#212121] ${i === 0 ? "border-l" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {visibleRequests.map((r) => (
                        <tr key={r.id}>
                          <td className={SHEET_TD}>{formatRequestedAt(r.requestedAt)}</td>
                          <td className={`${SHEET_TD} font-bold text-[#212121]`}>{r.branchName}</td>
                          <td className={`${SHEET_TD} font-bold text-[#212121]`}>{r.name}{r.phone ? ` (${r.phone})` : ""}</td>
                          <td className={SHEET_TD}>{REQUEST_TYPE_LABEL[r.type]}</td>
                          {/* 상태 — 아직 처리 안 한 건은 여기에 [승인]·[반려]가 그대로 뜬다(사용자 지시 2026-07-31).
                              처리 끝난 건은 상태 알약이 뜬다. 자세한 내용은 마우스를 올렸을 때 보여준다. */}
                          <td className={`${SHEET_TD} align-top`} title={statusDetail(r)}>
                            {r.status === "pending" ? (
                              <span className="inline-flex gap-1.5">
                                {/* 승인은 이 줄의 주된 행동이라 검정 알약으로 세운다(DESIGN.md §10 — 강조 버튼은 검정+밝은 글자).
                                    옆의 보조 버튼(지점변경으로 처리)·반려와 눈에 띄게 갈라져 무엇을 누를지 헷갈리지 않는다. */}
                                <button
                                  onClick={() => {
                                    if (r.type === "register") { setApproveTarget(r); setApproveGroupId(guessGroupId(r.branchName)); setRejectTarget(null); setBranchChangeTarget(null); }
                                    else if (r.type === "resume") void executeApproveResume(r);
                                    else if (r.type === "delete") void executeApproveDelete(r);
                                    else if (r.type === "branchChange") startBranchChangeApproval(r);
                                    else void startUpdateApproval(r);
                                  }}
                                  disabled={anyWriteBusy}
                                  className="px-3 py-1 rounded-lg text-[11px] font-black bg-[#212121] text-[var(--admin-ghost)] border border-[#212121] disabled:opacity-50">
                                  {r.type === "delete" ? "삭제 승인" : r.type === "resume" ? "이용재개 승인" : "승인"}
                                </button>
                                {/* 레거시 삭제요청 — 사유가 지점 이동이면 직원을 지우지 않고 소속만 옮긴다(2026-07-29) */}
                                {r.type === "delete" && (
                                  <button onClick={() => startBranchChangeApproval(r)} disabled={anyWriteBusy}
                                    title="직원을 삭제하지 않고 소속 지점만 옮깁니다"
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">지점변경으로 처리</button>
                                )}
                                {/* 지점이 종류를 잘못 골라 올리는 일이 있다 — 퇴사자인데 '수정요청'으로 온 경우
                                    (장용혁 건, 2026-07-31). 저장된 종류를 고치는 대신 **처리 방식을 바꿔** 받는다.
                                    위 [지점변경으로 처리]와 같은 방식이라 규약이 하나로 유지된다. */}
                                {r.type === "update" && (
                                  <button onClick={() => void executeApproveDelete(r)} disabled={anyWriteBusy}
                                    title="퇴사자로 보고 이용중지 처리합니다(계정·과거 이용내역은 남습니다)"
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">퇴사(이용중지)로 처리</button>
                                )}
                                <button onClick={() => { setRejectTarget(r); setRejectReason(""); setApproveTarget(null); setBranchChangeTarget(null); }} disabled={anyWriteBusy}
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
                              // 처리 끝난 건 — 상태 알약으로 결과를 말한다(승인/반려/인증 완료 등).
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                {(() => {
                                  const chip = statusChip(r);
                                  if (!chip) return null;
                                  return <span className={chip.className}>{chip.label}</span>;
                                })()}
                                {/* 승인했는데 직원 목록에 없으면 '아직 본인 인증 전'이다.
                                    카카오는 인증 완료자만 목록으로 돌려주므로(Code.gs /members/connected),
                                    이 표시가 없으면 "승인했는데 왜 아무 데도 안 보이지?"가 된다(실제 문의 2026-07-31). */}
                                {registerAuthState(r) === "pending" && (
                                  <span className="inline-block w-fit rounded-full bg-[#EFF0A3] px-2 py-0.5 text-[10px] font-black text-[#212121]"
                                    title="카카오T에 등록은 됐지만 직원이 아직 본인 인증(알림톡 수락)을 하지 않았습니다. 인증을 마치면 직원 관리 목록에 나타납니다.">
                                    인증 대기 중
                                  </span>
                                )}
                                {/* 이용중지된 사람은 직원 관리 목록에서 사라진다(카카오가 인증 완료자만 준다).
                                    그래서 거기 있는 [휴직 해제] 버튼에 손이 닿지 않는다 — 되돌릴 길이 이 줄뿐이다. */}
                                {r.status === "approved" && r.type === "delete" && r.memberId && (
                                  <button onClick={() => void resumeBlockedMember(r)} disabled={anyWriteBusy}
                                    className="w-fit px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50"
                                    title="이용중지를 풀어 다시 택시를 탈 수 있게 합니다">이용재개</button>
                                )}
                              </span>
                            )}
                          </td>
                          {/* 비고 — 지점이 적어 보낸 사유·메모와 처리 결과를 한 칸에 모은다.
                              변경신청은 옮겨간 지점·이동일까지, 반려는 사유를, 처리된 건은 처리 시각을 덧붙인다.
                              길면 잘라 두고 전체는 마우스를 올렸을 때 보여준다. */}
                          <td className={`${SHEET_TD} max-w-[22rem] truncate`} title={requestRemark(r)}>
                            {requestRemark(r) || "-"}
                          </td>
                        </tr>
                      ))}
                      {!visibleRequests.length && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">
                          {(reqBranchFilter || reqNameFilter || reqTypeFilter)
                            ? "필터에 해당하는 신청이 없습니다."
                            : "지점에서 올라온 신청이 없습니다."}
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
                    {/* 관리자 직접 등록은 특정 지점에 매인 폼이 아니라 두 계정 그룹을 모두 보여준다
                        (라벨에 계정 표시가 이미 있음) — [F1] 값은 "계정|그룹id" 합성키로 충돌을 막는다. */}
                    {(membersData.groups || []).filter((g) => g.status === "enabled").map((g) => (
                      <option key={groupOptionKey(g)} value={groupOptionKey(g)}>{`${g.name} (${accountLabel(g.account_key)})`}</option>
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
                    {/* 부서(지점)를 바꿀 때만 — 이 날짜부터의 이용만 새 지점으로 집계된다(지점 변경 이력, 2026-07-29).
                        과거 날짜를 넣으면 이미 옮겨버린 직원의 지난달 집계도 소급 보정된다. */}
                    {editDept.trim() !== (editing.department || "").trim() && (
                      <label className="flex items-center gap-2 text-[11px] font-bold text-[#212121]">
                        <span className="whitespace-nowrap">지점 변경 적용일</span>
                        <input type="date" value={editEffectiveDate} onChange={(e) => setEditEffectiveDate(e.target.value)} disabled={editBusy}
                          title="이 날짜부터의 이용만 새 지점으로 집계됩니다 (이전 이용은 기존 지점 유지)"
                          className="h-8 flex-1 min-w-0 border border-gray-200 rounded-lg px-2 text-[11px] font-bold bg-white disabled:opacity-50" />
                      </label>
                    )}
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
                    <p className="text-[11px] font-bold text-[#212121]/60">부서/지점명을 ERP 지점명과 똑같이 적으면 이용내역이 그 지점으로 집계됩니다. 지점을 바꾸면 적용일부터의 이용만 새 지점으로 집계됩니다(이전 이용은 기존 지점 유지). 전화번호를 바꾸면 새 번호로 인증 알림톡이 자동 발송됩니다.</p>
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
                  <input value={memberNameFilter} onChange={(e) => setMemberNameFilter(e.target.value)}
                    placeholder="이름 검색" aria-label="이름 검색"
                    className="h-8 w-32 border border-gray-200 rounded-lg px-3 text-[11px] font-bold bg-white" />
                  <span className="text-[11px] font-bold text-[#212121]/50">(등록 후 아직 인증하지 않은 직원은 카카오 정책상 목록에 나오지 않습니다)</span>
                </div>
                <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead><tr className="text-left">
                      <th className="px-4 py-2 text-[11px] font-black text-[#212121]">계정</th>
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
                            <td className="px-4 py-2">{accountLabel(m.account_key)}</td>
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
                                  <button onClick={() => void runMemberAction(m, "이용중지 해제", () => gasClient.unblockKakaoTaxiMember([m.id], adminPinHash, m.account_key),
                                    // 재조회 목록에 여전히 있고 blocked 가 풀렸으면 확인, 목록에서 사라졌으면 판정 불가
                                    (list) => { const f = list.find((x) => x.id === m.id); return f ? f.status !== "blocked" : null; })} disabled={busy}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">이용중지 해제</button>
                                ) : (
                                  <button onClick={() => void runMemberAction(m, "이용중지", () => gasClient.blockKakaoTaxiMember([m.id], adminPinHash, m.account_key),
                                    (list) => { const f = list.find((x) => x.id === m.id); return f ? f.status === "blocked" : null; })} disabled={busy}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white border border-gray-200 disabled:opacity-50">이용중지</button>
                                )}
                                <button onClick={() => void runMemberAction(m, "삭제", async () => {
                                    // 삭제 전 지점 스냅샷 — 실패 시 throw 로 삭제 자체를 멈춘다(과거 이용내역 지점 보존)
                                    await ensureBranchSnapshotBeforeDelete(m);
                                    await gasClient.deleteKakaoTaxiMember(m.id, adminPinHash, m.account_key);
                                  },
                                  // 삭제는 목록에서 사라져야 반영된 것 — 남아 있으면 미반영으로 알린다
                                  (list) => !list.some((x) => x.id === m.id))} disabled={busy}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-black text-[#B91C1C] bg-white border border-[#C93A3A] disabled:opacity-50">삭제</button>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {!visibleMembers.length && (
                        <tr><td colSpan={7} className="px-4 py-10 text-center text-xs font-bold text-[#212121]/50">
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
