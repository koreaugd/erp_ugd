// src/pages/branch/helpers/guideSteps.tsx
// 탭별 "작성방법 보기" 안내 말풍선 문구. 화면을 그리지 않고 문구와 앵커 이름만 담는다.
// 새 탭에 안내를 붙일 때는 여기에 목록을 추가하고 그 탭 요소에 data-guide 속성을 달면 된다.
// 문구에 표(JSX)가 들어가므로 .tsx.
import type { ReactNode } from "react";
import { Square, SquareCheck } from "lucide-react";
import type { GuideStep } from "../../../components/GuideCallouts";

const Bullets = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc pl-4 space-y-1.5">
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

// 체크 상태는 ☐/☑ 문자 대신 SVG 아이콘으로 그린다.
// 한글 글꼴에 U+2610/U+2611 글리프가 없어 빈 네모나 물음표로 깨지는 것을 피한다.
const Unchecked = () => (
  <span className="inline-flex items-center justify-center">
    <Square className="w-3.5 h-3.5 text-zinc-400" aria-label="해제" />
  </span>
);
const Checked = () => (
  <span className="inline-flex items-center justify-center">
    <SquareCheck className="w-3.5 h-3.5 text-rose-600" aria-label="체크" />
  </span>
);

// 체크박스 조합에 따른 금액칸 규칙. 넓은 화면의 표와 좁은 화면의 카드가 이 하나를 공유한다.
const CHECKBOX_RULES: Array<{ situation: string; prepaid: ReactNode; transferNeeded: ReactNode; usage: ReactNode; input: ReactNode }> = [
  {
    situation: "이번 달 송금 예정",
    prepaid: <Unchecked />,
    transferNeeded: (
      <span className="inline-flex items-center gap-1"><Checked /><span className="text-[10px] text-zinc-500">기본</span></span>
    ),
    usage: <span className="text-zinc-500">자동으로 따라 들어감</span>,
    input: <b className="font-black">이체필요 금액</b>,
  },
  {
    situation: "이미 결제 완료",
    prepaid: <Unchecked />,
    transferNeeded: <Unchecked />,
    usage: "직접 입력",
    input: <><b className="font-black">실제 이달사용액</b>만. 이체필요 금액은 잠김</>,
  },
  {
    situation: "선입금(충전) 업체",
    prepaid: <Checked />,
    transferNeeded: <span className="text-[10px] text-zinc-500">상황에 따라</span>,
    usage: "직접 입력 (발주액 합계)",
    input: <><b className="font-black">충전금액</b> + <b className="font-black">실제 이달사용액</b></>,
  },
];

export const purchaseSalesGuideSteps: GuideStep[] = [
  {
    // 자릿값 입력칸에 직접 붙인다(작은 앵커 → 아래에 배치해 칸을 가리지 않는다).
    anchor: "sales-summary-seat-charge",
    title: "자릿값(예약정산금)",
    placement: "below",
    width: 400,
    body: (
      <Bullets
        items={[
          <>자릿값(예약정산금)은 <b className="font-black">매출 합계에 들어가지 않습니다.</b> 별도 정산 항목이라 검산에서 빠집니다.</>,
          <>캐치테이블 이용 매장은 <b className="font-black text-rose-700">캐치테이블 관리자페이지 → 정산 → 부가세 참고자료 → 해당 월 선택</b> 후 나오는 금액을 입력하세요.</>,
        ]}
      />
    ),
  },
  {
    // 매출집계 카드의 결산월 달력 선택칸에 붙인다.
    anchor: "sales-summary-month",
    title: "결산월 선택과 마감",
    placement: "below",
    // 첫 줄이 한 줄에 들어가도록 폭을 잡았다(whitespace-nowrap과 짝).
    width: 560,
    body: (
      <Bullets
        items={[
          // 좁은 화면에서는 말풍선 폭이 화면에 맞춰 줄어드니 줄바꿈을 허용한다(안 그러면 글자가 잘린다).
          <span className="sm:whitespace-nowrap">마감 버튼은 <b className="font-black">두 개</b>입니다. 위쪽 매출집계와 아래쪽 매입매출은 서로 독립적입니다.</span>,
          <>확정하면 입력칸이 잠깁니다. 고치려면 <b className="font-black">수정</b> 버튼으로 잠금을 풀어주세요.</>,
        ]}
      />
    ),
  },
  {
    // 표 안쪽 오른쪽 위 — 체크박스 규칙
    anchor: "purchase-table",
    id: "purchase-table-checkbox",
    title: "체크박스와 금액칸",
    width: 580,
    body: (
      <div>
        {/* 가로 스크롤을 두지 않는다 — 말풍선 몸통은 클릭이 통과하므로 손으로 밀 수 없기 때문.
            대신 좁은 화면(<sm)에서는 5컬럼 표가 뭉개지므로 카드 형태로 바꿔 그린다.
            두 형태 모두 CHECKBOX_RULES 하나에서 그려 내용이 어긋나지 않게 한다. */}
        <table className="hidden sm:table w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-zinc-100 text-zinc-600">
              <th className="text-left font-black py-1.5 px-2 whitespace-nowrap">상황</th>
              <th className="text-center font-black py-1.5 px-2">선입금?</th>
              <th className="text-center font-black py-1.5 px-2">이체필요?</th>
              <th className="text-left font-black py-1.5 px-2">실제사용금액</th>
              <th className="text-left font-black py-1.5 px-2">입력할 칸</th>
            </tr>
          </thead>
          <tbody className="font-semibold">
            {CHECKBOX_RULES.map((rule) => (
              <tr key={rule.situation} className="border-t border-gray-100">
                <td className="py-1.5 px-2 whitespace-nowrap">{rule.situation}</td>
                <td className="py-1.5 px-2 text-center">{rule.prepaid}</td>
                <td className="py-1.5 px-2 text-center">{rule.transferNeeded}</td>
                <td className="py-1.5 px-2">{rule.usage}</td>
                <td className="py-1.5 px-2">{rule.input}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sm:hidden space-y-2">
          {CHECKBOX_RULES.map((rule) => (
            <div key={rule.situation} className="rounded-lg border border-gray-200 p-2 space-y-1">
              <p className="font-black text-zinc-900">{rule.situation}</p>
              <p className="flex items-center gap-1.5 text-[11px]">
                <span className="text-zinc-500">선입금?</span> {rule.prepaid}
                <span className="text-zinc-500 ml-2">이체필요?</span> {rule.transferNeeded}
              </p>
              <p className="text-[11px]"><span className="text-zinc-500">실제사용금액</span> {rule.usage}</p>
              <p className="text-[11px]"><span className="text-zinc-500">입력할 칸</span> {rule.input}</p>
            </div>
          ))}
        </div>

        {/* 참고 박스: 본문 규칙이 아니라 보충 예시임을 회색 배경 + '참고' 라벨로 구분한다. */}
        <div className="mt-2.5 rounded-lg bg-zinc-100 px-3 py-2 text-[11px] text-zinc-600">
          <span className="inline-flex items-center gap-1 font-black text-zinc-500">💡 참고</span>
          <p className="mt-1">
            <b className="font-black text-zinc-700">선입금(충전) 업체 예</b> — 찬수산, 영평, 마블러스푸드, SPC 등 미리 충전해 둔 잔액에서 차감해 쓰는 업체입니다.
          </p>
        </div>

        <p className="mt-2.5 text-[11.5px] text-zinc-600">
          다음 달로 넘어가면 거래처명·은행·계좌는 그대로 이월되고 <b className="font-black">금액만 비워집니다.</b>
        </p>
      </div>
    ),
  },
  {
    // 같은 표에 붙지만 위쪽에 놓아 표 안 오른쪽 위의 체크박스 말풍선과 겹치지 않게 한다.
    // 비알(BR)은 한 업체지만 품목별로 행을 나눠 적는다 — 기존 엑셀 월말마감 안내에 있던 규칙.
    anchor: "purchase-table",
    id: "purchase-table-bial",
    title: "비알(BR) 작성방법",
    placement: "above",
    width: 330,
    body: (
      <div>
        <p className="mb-2">
          <b className="font-black text-rose-700">비알(BR)</b>은 한 업체지만 <b className="font-black">품목별로 행을 나눠</b> 적습니다.
          <br />
          행마다 은행·계좌번호를 각각 넣어주세요.
        </p>
        <div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-zinc-100 text-zinc-600">
                <th className="text-left font-black py-1.5 px-2">분류항목</th>
                <th className="text-left font-black py-1.5 px-2">업체명</th>
              </tr>
            </thead>
            <tbody className="font-semibold">
              {[
                ["식재료비", "비알/식재료"],
                ["주류비", "비알/음료"],
                ["식음료외 기타", "비알/소모품"],
                ["식음료외 기타", "비알/부식비"],
              ].map(([category, vendor]) => (
                <tr key={vendor} className="border-t border-gray-100">
                  <td className="py-1.5 px-2">{category}</td>
                  <td className="py-1.5 px-2 font-mono font-black text-zinc-900">{vendor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ),
  },
];
