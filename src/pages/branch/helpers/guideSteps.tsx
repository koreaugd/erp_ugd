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

// 현금·카드 지출 시트의 조작법. 두 섹션 안내에 같은 내용이 들어가므로 한곳에 둔다.
const Key = ({ children }: { children: ReactNode }) => (
  <b className="font-black text-zinc-900 bg-zinc-100 border border-zinc-300 rounded px-1 mx-px">{children}</b>
);

// 칸 이동 방법은 표 위의 SheetKeyHint 칩이 늘 보여준다 — 말풍선에서 되풀이하지 않는다.
// 여기 남기는 것은 칩만 봐서는 모르는 사실 하나뿐이다: 마지막 줄에서 행이 늘어난다는 것.
const ExpenseSheetGuide = () => (
  <div className="mt-2.5 pt-2.5 border-t border-zinc-200">
    <p>
      <Key>↓</Key> <Key>Enter</Key>{" "}
      <b className="font-black text-rose-700">맨 아랫줄에서 ↓ 또는 Enter를 누르면 새 행이 생깁니다.</b>
    </p>
  </div>
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
    // 자릿값 입력칸에 붙인다. below로 두면 아래 매입매출 표의 말풍선과 같은 자리로 떨어져 가려지므로
    // above(상단)로 띄운다(사용자 요청 2026-07-18).
    anchor: "sales-summary-seat-charge",
    title: "자릿값(예약정산금)",
    placement: "above",
    width: 400,
    body: (
      <Bullets
        items={[
          <>캐치테이블 이용 매장은 <b className="font-black text-rose-700">캐치테이블 관리자페이지 → 정산 →<br />부가세 참고자료 → 해당 월 선택</b> 후 나오는 금액을 입력하세요.</>,
        ]}
      />
    ),
  },
  {
    // 매출집계 카드의 결산월 달력 선택칸에 붙인다.
    anchor: "sales-summary-month",
    title: "결산월 선택과 마감",
    placement: "below",
    arrow: "center",
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
    // 체크박스 규칙 + 비알 작성법을 한 말풍선에 좌우로 담고 가운데 세로 회색선으로 나눈다.
    // 표/버튼을 잠깐 가려도 되도록 위쪽(above)에 배치한다(사용자 요청).
    anchor: "purchase-table",
    id: "purchase-table-guide",
    title: "거래처 표 작성방법",
    placement: "above",
    width: 860,
    body: (
      // 좌우 2열은 말풍선이 860px를 다 펼치는 넓은 화면(lg)에서만. 그 아래에선 단일 열로 쌓고 가로선으로 구분.
      // (sm에서 2열로 바꾸면 왼쪽 5컬럼 표가 들어갈 폭이 부족해 넘친다 — 몸통은 클릭 통과라 손으로 밀 수도 없다.)
      <div className="flex flex-col lg:flex-row lg:gap-4">
        {/* 왼쪽 — 체크박스와 금액칸 */}
        <div className="lg:flex-1 lg:min-w-0">
          <p className="mb-2 text-[12px] font-black text-zinc-900">체크박스와 금액칸</p>
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

        {/* 가운데 구분선 — 넓은 화면은 세로선, 좁은 화면은 오른쪽 블록 위쪽 가로선 */}
        <div className="hidden lg:block w-px bg-zinc-300 self-stretch" />

        {/* 오른쪽 — 비알(BR) 작성방법 */}
        <div className="mt-3 pt-3 border-t border-zinc-200 lg:mt-0 lg:pt-0 lg:border-t-0 lg:w-[240px] lg:shrink-0">
          <p className="mb-2 text-[12px] font-black text-zinc-900">비알(BR) 작성방법</p>
          <p className="mb-2">
            <b className="font-black text-rose-700">비알(BR)</b>은 한 업체지만 <b className="font-black">품목별로 행을 나눠</b> 적습니다.
            <br />
            행마다 은행·계좌번호를 각각 넣어주세요.
          </p>
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

// 일일마감정산 탭 — 각 섹션 작성 안내. 화면 위→아래 순서.
export const dailySettleGuideSteps: GuideStep[] = [
  {
    anchor: "daily-settle-date",
    title: "마감 대상 날짜",
    placement: "below",
    width: 300,
    body: (
      <p>
        마감할 <b className="font-black text-rose-700">영업일 날짜가 맞는지</b> 꼭 확인하세요.
      </p>
    ),
  },
  {
    // 금고 현금 잔액 칸에 붙인다. 아래(below)면 그 밑 지출 섹션 안내와 겹치므로 위(above)에 두고 꼬리는 칸을 가리키게.
    anchor: "daily-cash-balance",
    title: "금고 현금 잔액",
    placement: "above",
    arrow: "anchor",
    width: 340,
    body: (
      // 넓은 화면은 한 줄, 좁은 화면(<sm)은 폭이 줄어 잘리므로 줄바꿈 허용.
      <p className="sm:whitespace-nowrap">
        <b className="font-black text-rose-700">매장에 있는 실제 현금을 세어서</b> 적어주세요.
      </p>
    ),
  },
  {
    // 금일 네이버 리뷰 칸에 붙인다. 금고잔액 안내와 같은 줄이므로 아래(below)로 내려 겹침을 피한다.
    anchor: "daily-naver-review",
    title: "당일 신규 리뷰",
    placement: "below",
    arrow: "anchor",
    width: 320,
    body: (
      <p>
        네이버플레이스에서 <b className="font-black text-rose-700">오늘 달린 리뷰 갯수</b>를 확인해 적어주세요.
      </p>
    ),
  },
  {
    // 근무자 섹션 제목에 붙인다. 위/아래 섹션과 겹치지 않게 오른쪽(right)으로 낸다.
    anchor: "daily-staff-limit",
    title: "근무자 · 기준 한도시간",
    placement: "right",
    width: 700,
    body: (
      // xl(1280)+에서만 한 줄로 우측 길게 — 지점 화면은 사이드바(220px) 때문에 그보다 좁으면
      // 오른쪽에 700px가 안 들어가 아래로 폴백된다. 폴백 구간에서 nowrap이 켜지면 어색하므로 xl에서만 켠다.
      <Bullets
        items={[
          <span className="xl:whitespace-nowrap"><b className="font-black">주 6일 근무한 경우</b>, 휴무를 반납하고 근무를 한 것이니 <b className="font-black text-rose-700">주 6일 중 하루는 기준 한도시간을 0으로</b> 체크하세요.</span>,
          <span className="xl:whitespace-nowrap">본사 지원, 타매장 직원 지원은 <b className="font-black text-rose-700">파트타이머로</b> 잡아주세요.</span>,
        ]}
      />
    ),
  },
  {
    // 현금 지출 내역 섹션 헤더. 아래(below)에 붙인다.
    // above로 두면 카드 밖 위쪽(매출 카드)까지 튀어 올라가 날짜·금고잔액 안내와 겹친다.
    // below면 자기 카드 안에 머무르고, 지출 카드는 좌우 2열이라 카드 지출 안내와도 안 부딪힌다.
    // (좁은 화면에서 두 카드가 세로로 쌓일 때도 아래쪽 카드 안내가 위 카드를 덮지 않는다.)
    anchor: "daily-cash-expense",
    title: "현금 지출 내역",
    placement: "below",
    width: 420,
    body: (
      <>
        <p>
          <b className="font-black text-rose-700">매장 계좌로 현금을 입금</b>한 경우에도 이곳에 적어주세요.
          <br />
          지출 분류에서 <b className="font-black text-rose-700">현금입금</b>을 선택하면 됩니다.
        </p>
        <ExpenseSheetGuide />
      </>
    ),
  },
  {
    // 현금 지출 안내와 같은 이유로 below. (위 주석 참고)
    anchor: "daily-card-expense",
    title: "카드 지출 내역",
    placement: "below",
    width: 420,
    body: (
      <>
        <p>
          <b className="font-black text-rose-700">계좌이체 요청 건을 포함한 모든 결제</b>를 입력하세요.
          <br />
          인터넷 즉시결제·카드결제 등 모두 포함됩니다.
          <br />
          계좌이체로 요청할 건은 사용처에서 <b className="font-black text-rose-700">계좌이체</b>를 선택하세요.
        </p>
        <ExpenseSheetGuide />
      </>
    ),
  },
  {
    anchor: "daily-other-memo",
    title: "기타 전달 메모",
    placement: "above",
    width: 580,
    body: (
      // 넓은 화면은 한 줄로 우측으로 길게, 좁은 화면(<sm)은 줄바꿈.
      <p className="sm:whitespace-nowrap">
        <b className="font-black">ERP 시스템 개선</b>에 대한 의견을 적어주세요. 적어주신 내용은 <b className="font-black text-rose-700">ERP 성능 개선에 활용</b>됩니다.
      </p>
    ),
  },
];

export const orderGuideSteps: GuideStep[] = [
  {
    // 대분류 칸과 거래처명 칸을 따로 가리키던 말풍선 둘을 하나로 합쳤다.
    // 둘은 같은 입력 줄에 붙어 있어 말풍선끼리 겹쳤고, 어차피 왼→오 한 흐름이라 나눌 이유가 없었다.
    // 앵커는 입력 줄 전체(선택 → 거래처명 → 추가)라 빨간 테두리가 그 줄을 통째로 감싼다.
    // above: 아래로 내리면 바로 밑 거래처 칩 목록을 덮는다. 위쪽은 빈 여백이라 가릴 것이 없다.
    anchor: "order-vendor-add",
    title: "거래처 추가하기",
    placement: "above",
    // 폭은 가장 긴 줄(둘째 줄)에 맞춘다. 넉넉히 잡으면 오른쪽이 텅 빈 채로 화면만 가린다.
    // 글머리표 들여쓰기(pl-4)만큼 예전 400px보다 넓게 잡았다.
    width: 430,
    body: (
      <Bullets
        items={[
          <span className="lg:whitespace-nowrap">
            <b className="font-black text-rose-700">대분류를 먼저 고른 뒤</b> 오른쪽에 거래처명을 적습니다.
          </span>,
          <span className="lg:whitespace-nowrap">
            여러 곳을 한 번에 넣으려면 <b className="font-black text-rose-700">쉼표나 줄바꿈</b>으로 구분해 적으세요.
          </span>
        ]}
      />
    ),
  },
  {
    anchor: "order-report-category",
    title: "대분류별 거래처 보기 · 지우기",
    // above다. 다른 배치는 모두 아래 발주내역 표의 말풍선(inside-top-right)과 같은 자리로 떨어진다.
    //   - below: 곧장 표 위로 떨어져 겹친다.
    //   - right: 오른쪽 공간이 모자라면 GuideCallouts가 below로 폴백한다(태블릿 폭에서도 걸린다) — 결국 같은 충돌.
    // 예전에 above가 위쪽 '거래처 추가' 카드의 대분류 안내와 겹쳤지만, 그 안내는 거래처명 안내와 합쳐져
    // 입력 줄 위(order-vendor-add)로 올라갔다. 이제 이 말풍선이 올라오는 칩 목록 자리는 비어 있다.
    placement: "above",
    width: 370,
    // 줄바꿈은 sm부터 막는다(lg가 아니라). 위로 올라가는 말풍선이라 줄이 늘면 그만큼 더 높이 올라가
    // 입력 줄 위의 order-vendor-add 말풍선에 닿는다. 세 줄로 묶어두면 올라가는 높이가 고정된다.
    body: (
      <Bullets
        items={[
          <span className="sm:whitespace-nowrap">
            분류를 선택하면 <b className="font-black text-rose-700">거래처 목록이 보입니다.</b>
          </span>,
          <span className="sm:whitespace-nowrap">
            상단에 있는 거래처 이름 옆 <b className="font-black text-rose-700">X</b>로 지웁니다.
          </span>,
          <span className="sm:whitespace-nowrap">
            거래처를 삭제해도 <b className="font-black text-rose-700">이미 입력한 발주금액은 남습니다.</b>
          </span>
        ]}
      />
    ),
  },
  {
    anchor: "order-matrix",
    title: "발주내역 표 작성방법",
    // 표 안쪽 오른쪽 위. above로 두면 위 섹션의 말풍선과 겹친다.
    placement: "inside-top-right",
    // 줄바꿈을 막았으므로 폭이 모자라면 글자가 말풍선 밖으로 삐져나간다.
    // 가장 긴 줄("금액이 있는 칸을 고른 뒤 …")이 약 485px라 여유를 두고 잡는다.
    width: 545,
    body: (
      <>
        <Bullets
          items={[
            <span className="lg:whitespace-nowrap">
              그날 받은 <b className="font-black text-rose-700">명세서(거래명세표)의 금액</b>을 해당 날짜 · 거래처 칸에 적습니다.
            </span>,
            <span className="lg:whitespace-nowrap">
              명세서가 없으면 <b className="font-black text-rose-700">실제 발주한 금액</b>을 적습니다.
            </span>
          ]}
        />
        <div className="mt-2.5 pt-2.5 border-t border-zinc-200 space-y-1.5">
          <p className="font-black text-zinc-900">특이사항은 칸에 메모로 남기세요</p>
          <Bullets
            items={[
              <span className="lg:whitespace-nowrap">
                금액이 있는 칸을 고른 뒤 <b className="font-black text-rose-700">메모 아이콘</b>을 누르거나 <b className="font-black text-rose-700">우클릭</b>하면 메모창이 열립니다.
              </span>,
              <span className="lg:whitespace-nowrap">
                <b className="font-black text-rose-700">금액을 지우면 메모도 함께 사라집니다</b> (지우기 전에 물어봅니다).
              </span>
            ]}
          />
        </div>
        {/* 이름 고치기 안내를 여기 붙인 이유: 고치는 자리가 이 표의 머리글이다.
            위 '대분류별 거래처 보기·지우기' 말풍선에 넣으면, 그 말풍선은 above라 줄이 늘수록 더 높이 올라가
            바로 위 '거래처 추가' 말풍선에 닿는다(그 주석에 적혀 있는 제약). */}
        <div className="mt-2.5 pt-2.5 border-t border-zinc-200 space-y-1.5">
          <p className="font-black text-zinc-900">거래처 이름은 표에서 바로 고칩니다</p>
          <Bullets
            items={[
              <span className="lg:whitespace-nowrap">
                맨 윗줄 <b className="font-black text-rose-700">거래처 이름을 더블클릭</b>하거나 <b className="font-black text-rose-700">연필</b>을 누르면 고쳐집니다.
              </span>,
              <span className="lg:whitespace-nowrap">
                고치면 <b className="font-black text-rose-700">거래처 목록과 이미 적은 발주금액이 함께 바뀝니다.</b>
              </span>,
              <span className="lg:whitespace-nowrap">
                <b className="font-black text-rose-700">발주내역이 있는 다른 거래처 이름</b>으로는 바꿀 수 없습니다.
              </span>
            ]}
          />
        </div>
      </>
    ),
  },
];

// 정직원 급여대장 탭 — 본사 급여 담당의 제출 규칙을 말풍선 하나에 세 단락(기본·증빙·기타내용)으로 담는다.
export const fullTimeSalaryGuideSteps: GuideStep[] = [
  {
    anchor: "fulltime-salary-table",
    title: "정직원 급여대장 작성방법",
    placement: "inside-top-right",
    width: 620,
    body: (
      <>
        <Bullets
          items={[
            <>직원현황의 정직원이 자동으로 채워집니다. 명단에 없으면 <b className="font-black">직원 추가</b>로 넣으세요.</>,
            <>연장근무는 <b className="font-black">근무시간 × 시급 = 계</b>로 자동 계산되어 총 금액에 합산됩니다.</>,
            <>추가근무분은 <b className="font-black text-rose-700">급여대장과 초과근무일지 모두</b> 작성해야 합니다.</>,
          ]}
        />
        <div className="mt-2.5 pt-2.5 border-t border-zinc-200 space-y-1.5">
          <p className="font-black text-zinc-900">개인지출 증빙 (최대한 자제해주세요)</p>
          <Bullets
            items={[
              <>교통비 — <b className="font-black text-rose-700">카카오비즈니스 이용내역은 제외</b>하고, 입금받아야 할 것만 추려서 보내주세요.</>,
              <>개인지출 — <b className="font-black text-rose-700">영수증을 첨부</b>해서 보내주세요.</>,
            ]}
          />
        </div>
        <div className="mt-2.5 pt-2.5 border-t border-zinc-200 space-y-1.5">
          <p className="font-black text-zinc-900">기타내용 기재 규칙 (근무지 이동 · 퇴사 · 급여변동)</p>
          <Bullets
            items={[
              <>근무지 이동 — <b className="font-black text-rose-700">이동 전후 근무지 + 출근일자</b>를 기재하세요.</>,
              <>퇴사예정자 — <b className="font-black text-rose-700">마지막 근무일 기준</b>으로 표기하고, <b className="font-black text-rose-700">사유와 퇴직금 정산여부</b>도 같이 적어주세요.</>,
              <>대장 제출 후 갑자기 당월 퇴사자가 생기면 <b className="font-black text-rose-700">톡으로 바로</b> 알려주세요.</>,
              <><b className="font-black text-rose-700">급여 변동 이유와 상여금 종류</b>도 함께 기재하세요.</>,
            ]}
          />
        </div>
      </>
    ),
  },
];

export const liquorGuideSteps: GuideStep[] = [
  {
    anchor: "liquor-product-add",
    title: "주류 상품 등록",
    // 폼 바깥 왼쪽 위 — 말풍선 오른쪽 아래 모서리가 폼의 왼쪽 위 모서리에 닿는다.
    placement: "outside-top-left",
    width: 520,
    body: (
      <Bullets
        items={[
          <span className="lg:whitespace-nowrap">
            분류를 고르고 상품명을 적어 <b className="font-black text-rose-700">상품 추가</b>를 누르면 아래 시트에 줄이 생깁니다.
          </span>,
          <span className="lg:whitespace-nowrap">
            여러 개를 한 번에 넣으려면 <b className="font-black text-rose-700">쉼표나 줄바꿈</b>으로 구분해 적으세요.
          </span>
        ]}
      />
    ),
  },
  {
    anchor: "liquor-month-sheet",
    title: "재고 시트 작성방법",
    placement: "inside-top-right",
    width: 560,
    body: (
      <>
        <Bullets
          items={[
            <span className="lg:whitespace-nowrap">
              날짜마다 입 · 판 · 재 세 칸이 붙어 있습니다. <b className="font-black text-rose-700">입(입고) · 판(판매)만 적으세요.</b>
            </span>,
            <span className="lg:whitespace-nowrap">
              재고가 <b className="font-black text-rose-700">음수(빨간색)</b>면 입고를 빠뜨렸거나 판매를 과하게 적은 것입니다.
            </span>
          ]}
        />
        <div className="mt-2.5 pt-2.5 border-t border-zinc-200 space-y-1.5">
          <p className="font-black text-zinc-900">가격과 상품 삭제</p>
          <Bullets
            items={[
              <span className="lg:whitespace-nowrap">
                <b className="font-black text-rose-700">입고가 · 판매가</b>를 적으면 마진률이 자동으로 나옵니다 (날짜와 무관한 상품 정보입니다).
              </span>,
              <span className="lg:whitespace-nowrap">
                상품을 지우려면 상품명 오른쪽 끝의 <b className="font-black text-rose-700">X</b>를 누르세요.
              </span>
            ]}
          />
        </div>
      </>
    ),
  },
];
