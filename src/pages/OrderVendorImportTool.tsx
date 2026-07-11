// src/pages/OrderVendorImportTool.tsx
// [일회성 관리 도구] 매입매출(월말마감) 거래처를 발주관리 거래처 목록으로 복사한다.
// - 발주관리가 "비어있는"(사용자가 아무것도 안 넣은) 지점만 채운다. 이미 입력한 지점은 건드리지 않는다.
// - 각 지점의 "가장 최근에 거래처가 입력된 월"의 매입매출을 기준으로 한다.
// - 분류 매핑: 식재료비→식자재, 주류비→주류, 식음료외 기타(거래처명에 '부식' 포함→부식비, 아니면 식음료외 기타).
// 이 도구는 일회성이다. 한 번 실행해 결과를 확인한 뒤 제거한다.
//
// [경쟁(TOCTOU) 안전] 저장 직전 checkWritable로 재확인하지만, 백엔드(GAS/시트)에 조건부 원자 쓰기(CAS)가 없어
// 재확인~저장 사이의 찰나(수백 ms)에 지점이 발주관리를 쓰면 이론상 덮어쓸 수 있다. 삭제 예정 일회성 도구라
// 백엔드 트랜잭션을 새로 만들지 않고, **지점이 발주관리를 쓰지 않는 시간(영업시간 외)에 실행**하는 것으로 이 창을 없앤다.
// (비어있던 지점이 하필 그 수백 ms 창에 새 거래처를 입력할 확률은 영업시간 외엔 사실상 0.)
import { useState } from "react";
import { gasClient } from "../api/gasClient";
import { ORDER_CATEGORIES, ORDER_DEFAULT_VENDORS } from "./branch/helpers/orderHelpers";
import type { OrderCategory } from "./branch/types";

type PurchaseRow = { category?: string; vendorName?: string };
type OrderVendorMap = Record<OrderCategory, string[]>;

// 매입매출 분류 + 거래처명 → 발주관리 분류
function mapOrderCategory(purchaseCategory: string, vendorName: string): OrderCategory {
  if (purchaseCategory === "식재료비") return "식자재";
  if (purchaseCategory === "주류비") return "주류";
  // 식음료외 기타: 거래처명에 '부식'이 들어가면 부식비로, 아니면 식음료외 기타로.
  return vendorName.includes("부식") ? "부식비" : "식음료외 기타";
}

// 서버의 order_vendors 원본을 분류별 맵으로 정규화한다. OrderManagementTabV2의 normalizeRemoteOrderVendors와 동일 규칙.
// - null/undefined: 저장된 적 없음 → map=null (비어있음 후보)
// - 배열(레거시 string[]): 첫 분류(식자재)에 담아 기본거래처와 합침 → 사용자가 넣은 거래처가 살아있음
// - 객체: 분류별 배열
// - 그 외(문자열/숫자 등 예상 밖): unknown=true → 절대 건드리지 않는다(오판 덮어쓰기 방지)
function normalizeVendors(value: unknown): { map: OrderVendorMap | null; unknown: boolean } {
  if (value === null || value === undefined) return { map: null, unknown: false };
  if (Array.isArray(value)) {
    const map = {} as OrderVendorMap;
    for (const cat of ORDER_CATEGORIES) map[cat] = [...(ORDER_DEFAULT_VENDORS[cat] || [])];
    const first = ORDER_CATEGORIES[0];
    map[first] = Array.from(new Set([...(ORDER_DEFAULT_VENDORS[first] || []), ...value.filter((x): x is string => typeof x === "string")]));
    return { map, unknown: false };
  }
  if (typeof value === "object") {
    const src = value as Partial<Record<OrderCategory, unknown>>;
    const map = {} as OrderVendorMap;
    for (const cat of ORDER_CATEGORIES) {
      map[cat] = Array.isArray(src[cat])
        ? (src[cat] as unknown[]).filter((x): x is string => typeof x === "string")
        : [...(ORDER_DEFAULT_VENDORS[cat] || [])];
    }
    return { map, unknown: false };
  }
  return { map: null, unknown: true };
}

// 기본 거래처 외에 사용자가 추가한 것이 하나라도 있으면 true(=이미 사용 중, 건드리지 않음).
function hasCustomVendors(map: OrderVendorMap | null): boolean {
  if (!map) return false;
  for (const cat of ORDER_CATEGORIES) {
    const defaults = ORDER_DEFAULT_VENDORS[cat] || [];
    if ((map[cat] || []).some((v) => !defaults.includes(v))) return true;
  }
  return false;
}

// 이 지점이 지금 채워도 되는 상태(비어있음)인지 서버 최신값으로 판정한다.
// 저장 직전에 한 번 더 호출해, 읽은 뒤~저장 사이에 지점이 입력한 데이터를 덮어쓰는 경쟁을 막는다.
async function checkWritable(branch: string): Promise<{ ok: boolean; reason?: string; vendorMap?: OrderVendorMap | null }> {
  const [rawVendors, orders] = await Promise.all([
    gasClient.getSharedDataFromServer<unknown>(`order_vendors:${branch}`),
    gasClient.getSharedDataFromServer<unknown>(`orders:${branch}`),
  ]);
  const { map, unknown } = normalizeVendors(rawVendors);
  if (unknown) return { ok: false, reason: "거래처 형식을 알 수 없어 건너뜀" };
  if ((Array.isArray(orders) && orders.length > 0) || hasCustomVendors(map)) return { ok: false, reason: "이미 발주관리 사용 중 — 건너뜀" };
  return { ok: true, vendorMap: map };
}

// 매입매출 데이터가 실제 저장된 키(shared_data의 monthly_purchases:{지점}:{월})에서 지점과 거래처를 직접 뽑는다.
// 별도 지점목록(예: 관리자 GAS 목록)에 의존하지 않으므로 지점명 소스 불일치가 원천적으로 없다.
// 각 지점의 '거래처가 있는 가장 최근 월' 행을 반환한다.
async function discoverPurchasesByBranch(): Promise<Map<string, { month: string; rows: PurchaseRow[] }>> {
  const entries = await gasClient.getSharedDataByPrefix("monthly_purchases:");
  const byBranch = new Map<string, { month: string; rows: PurchaseRow[] }>();
  for (const { key, value } of entries) {
    // 키 형식: monthly_purchases:{지점명}:{YYYY-MM}. 지점명엔 콜론이 없고 월은 끝에 오므로 마지막 콜론으로 분리.
    const rest = key.slice("monthly_purchases:".length);
    const sep = rest.lastIndexOf(":");
    if (sep < 0) continue;
    const branch = rest.slice(0, sep);
    const month = rest.slice(sep + 1);
    if (!branch || !month) continue;
    const rows = Array.isArray(value) ? (value as PurchaseRow[]).filter((r) => (r?.vendorName || "").trim()) : [];
    if (rows.length === 0) continue;
    const prev = byBranch.get(branch);
    if (!prev || month > prev.month) byBranch.set(branch, { month, rows }); // "YYYY-MM" 문자열 비교로 최신월 선택
  }
  return byBranch;
}

type Result = { branch: string; status: "filled" | "skipped" | "no-purchase" | "error"; detail: string };

export function OrderVendorImportTool() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [progress, setProgress] = useState("");

  const run = async () => {
    if (running) return;
    if (!window.confirm("발주관리가 비어있는 지점에 매입매출 거래처를 복사합니다.\n이미 거래처를 입력한 지점은 건드리지 않습니다.\n\n⚠️ 반드시 지점이 발주관리를 쓰지 않는 시간(영업시간 외)에 실행하세요.\n지금 실행할까요?")) return;

    setRunning(true);
    setResults(null);
    const out: Result[] = [];
    try {
      // 지점 목록을 매입매출 데이터가 실제 저장된 키에서 뽑는다(지점명 소스 불일치 방지 = 이번 버그의 근본 원인).
      const purchasesByBranch = await discoverPurchasesByBranch();
      const branches = Array.from(purchasesByBranch.keys()).sort();

      if (branches.length === 0) {
        setResults([{ branch: "-", status: "no-purchase", detail: "매입매출 거래처가 저장된 지점이 없습니다." }]);
        return;
      }

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        setProgress(`${i + 1} / ${branches.length} · ${branch}`);
        try {
          const vendorKey = `order_vendors:${branch}`;
          const latest = purchasesByBranch.get(branch)!;

          const check = await checkWritable(branch);
          if (!check.ok) {
            out.push({ branch, status: "skipped", detail: check.reason || "건너뜀" });
            continue;
          }

          // 기본 거래처 → 기존 서버값 → 매입매출 거래처 순으로 분류별 합친다(전부 보존, 중복 제거).
          const merged = {} as OrderVendorMap;
          for (const cat of ORDER_CATEGORIES) merged[cat] = [...(ORDER_DEFAULT_VENDORS[cat] || [])];
          if (check.vendorMap) {
            for (const cat of ORDER_CATEGORIES) {
              for (const v of check.vendorMap[cat]) if (!merged[cat].includes(v)) merged[cat].push(v);
            }
          }
          let added = 0;
          for (const row of latest.rows) {
            const name = (row.vendorName || "").trim();
            if (!name) continue;
            const cat = mapOrderCategory(row.category || "", name);
            if (!merged[cat].includes(name)) {
              merged[cat].push(name);
              added += 1;
            }
          }

          if (added === 0) {
            out.push({ branch, status: "no-purchase", detail: "추가할 새 거래처 없음 — 건너뜀" });
            continue;
          }

          // 저장 직전 재확인: 읽은 뒤 지점이 데이터를 입력했으면 덮어쓰지 않는다.
          const recheck = await checkWritable(branch);
          if (!recheck.ok) {
            out.push({ branch, status: "skipped", detail: "확인 중 지점이 사용 시작 — 건너뜀" });
            continue;
          }

          await gasClient.saveSharedData(vendorKey, merged);
          out.push({ branch, status: "filled", detail: `${latest.month} 기준 ${added}곳 추가` });
        } catch (err) {
          out.push({ branch, status: "error", detail: `오류: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      setResults(out);
    } catch (err) {
      setResults([{ branch: "-", status: "error", detail: `지점 목록을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setProgress("");
      setRunning(false);
    }
  };

  const badge = (status: Result["status"]) => {
    const map: Record<Result["status"], string> = {
      filled: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      skipped: "bg-zinc-100 text-zinc-500 ring-zinc-200",
      "no-purchase": "bg-amber-50 text-amber-700 ring-amber-100",
      error: "bg-rose-50 text-rose-700 ring-rose-100",
    };
    const label: Record<Result["status"], string> = { filled: "채움", skipped: "건너뜀", "no-purchase": "건너뜀", error: "오류" };
    return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ring-1 ${map[status]}`}>{label[status]}</span>;
  };

  const filledCount = results?.filter((r) => r.status === "filled").length ?? 0;

  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-black text-amber-900">[일회성] 매입매출 거래처 → 발주관리 복사</h3>
          <p className="text-[11px] text-amber-800/80 font-semibold mt-1 leading-relaxed">
            발주관리가 <b>비어있는 지점만</b> 채웁니다. 이미 입력한 지점은 건드리지 않습니다.<br />
            각 지점의 가장 최근 매입매출 월 기준 · 분류 자동 매핑(부식은 이름으로 분리).<br />
            <b className="text-rose-700">⚠️ 지점이 발주관리를 쓰지 않는 시간(영업시간 외)에 실행하세요.</b>
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {running ? "실행 중…" : "복사 실행"}
        </button>
      </div>

      {running && <p className="text-[11px] font-mono text-amber-700">{progress || "지점 목록 불러오는 중…"}</p>}

      {results && (
        <div className="space-y-2">
          <p className="text-xs font-black text-amber-900">
            완료 — 채움 {filledCount}곳 / 전체 {results.length}지점
          </p>
          <div className="max-h-[320px] overflow-y-auto rounded-xl border border-amber-100 bg-white divide-y divide-gray-50">
            {results.map((r) => (
              <div key={r.branch} className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]">
                <span className="font-bold text-gray-700 truncate">{r.branch}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-400">{r.detail}</span>
                  {badge(r.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
