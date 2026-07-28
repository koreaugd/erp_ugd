// src/pages/branch/components/SalaryAccessGate.tsx
// 급여대장(정직원·파트타이머) 공통 출입문. 원래 정직원 탭 안에만 있던 잠금 화면을 꺼내 두 탭이 함께 쓴다.
//
// 통과 순서는 반드시 (1) 역할·지점 권한 → (2) 비밀번호 다.
// 비밀번호를 아는 지점 직원이 우회하지 못하게 하는 것이 이 순서의 목적이다(설계서 §15.4, 사용자 지시 2026-07-28).
//
// 자식(실제 급여대장 표)은 두 관문을 다 통과한 뒤에만 마운트된다 — 잠긴 동안에는 급여 데이터를 조회조차 하지 않는다.
import { useState, useEffect, useCallback, useSyncExternalStore, type ReactNode } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { useAuthContext } from "../../../contexts/AuthContext";
import { canReadSalaryBranch, salaryAccessDenialMessage } from "../../../utils/salaryAccess";

// 잠금 해제 상태(모듈 전역). 정직원·파트타이머가 같은 비밀번호를 쓰므로 해제도 함께 본다 —
// 한 번 푼 뒤 두 탭을 오갈 때 비밀번호를 두 번 묻지 않기 위해서다.
// 탭을 떠나면(언마운트) / 화면이 오래 숨겨졌다 열리면 아래 effect가 false로 되돌려 재잠금한다.
//
// 이 값을 게이트 밖에서도 봐야 한다: 급여 마감 버튼은 표가 아니라 월말마감 헤더에 있어서,
// 게이트로 감싸이지 않는다. 잠긴 채로 마감을 눌러 급여 데이터를 읽고 쓰는 우회를 막으려면
// 그쪽에서도 같은 상태를 봐야 한다(Codex 정지게이트 지적 2026-07-28).
let salaryUnlocked = false;
const unlockListeners = new Set<() => void>();

function setSalaryUnlocked(next: boolean) {
  if (salaryUnlocked === next) return;
  salaryUnlocked = next;
  unlockListeners.forEach((listener) => listener());
}

function subscribeUnlock(listener: () => void) {
  unlockListeners.add(listener);
  return () => { unlockListeners.delete(listener); };
}

// 잠금·안내 화면 공통 스타일. DESIGN.md 지점 화면 규칙에 맞춘다(§5 색 치환표 · §6-0-1 글자 크기 · §10 버튼).
//   - 색: indigo/rose 같은 원색 대신 --branch-* 토큰. 강조 버튼은 검정 배경 + ghost 글자.
//   - 크기: 제목 알약·버튼·안내문 모두 11px(본문·버튼에 text-sm 금지).
const SCREEN_CLASS = "flex flex-col items-center justify-center animate-fade-in min-h-[320px] py-6";
const ICON_BOX_CLASS = "w-14 h-14 rounded-2xl bg-[var(--branch-alice)] flex items-center justify-center text-[#212121] mb-4";
// 제목 알약 — DESIGN.md §6: inline-flex · width:fit-content · radius 999px · padding 6px 12px [강제] ·
// 11px [강제] · line-height 1 · 900 · 1px 검정 테두리 · 바닐라 배경.
const TITLE_PILL_CLASS = "inline-flex w-fit items-center gap-2 rounded-full border border-[#212121] bg-[var(--branch-vanilla)] px-3 py-1.5 text-[11px] font-black leading-none text-[#212121]";
const BODY_CLASS = "mt-2 text-[11px] font-bold text-zinc-500 text-center leading-relaxed max-w-md";
const ACTION_BUTTON_CLASS = "h-9 px-5 rounded-xl bg-[#212121] text-[#F6F5FA] text-[11px] font-black flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed";
// 오류 글자색은 #8F1F1F — DESIGN.md §5 표에서 #C93A3A는 '테두리' 색이고 글자는 따로 있다.
const ERROR_CLASS = "text-xs font-bold text-[#8F1F1F] mt-3";

/** 개발 서버에서는 비밀번호를 건너뛴다(아래 devUnlockBypass와 같은 기준) — 마감 버튼도 함께 열어 준다. */
const devUnlockBypass = () => Boolean((import.meta as any).env?.DEV);

/**
 * 지금 급여대장 비밀번호가 풀려 있는가. 게이트 밖(월말마감 헤더의 마감 버튼 등)에서 쓴다.
 * 역할·지점 권한은 별도다 — 이 훅과 canReadSalaryBranch를 반드시 함께 확인할 것.
 */
export function useSalaryUnlocked(): boolean {
  const unlocked = useSyncExternalStore(subscribeUnlock, () => salaryUnlocked, () => false);
  return unlocked || devUnlockBypass();
}

/** 이벤트 핸들러처럼 렌더 밖에서 확인할 때 쓴다(fail-closed 가드용). */
export function isSalaryUnlockedNow(): boolean {
  return salaryUnlocked || devUnlockBypass();
}

export function SalaryAccessGate({
  branchName,
  title,
  guideAnchor,
  children
}: {
  branchName: string;
  /** 잠금 화면 제목. 예: "정직원 급여대장 - 보안 잠금" */
  title: string;
  /**
   * 잠금 화면에도 달아 줄 data-guide 앵커.
   * 앵커가 없으면 GuideCallouts가 조용히 건너뛰어 '작성방법 보기' 버튼이 무반응처럼 보인다.
   */
  guideAnchor?: string;
  children: ReactNode;
}) {
  const { user } = useAuthContext();

  // 총괄이 역할·급여지점을 강등해도, 이미 열려 있는 화면은 세션(sessionStorage)에 담긴 옛 값을 본다.
  // 급여·주민번호·계좌가 걸린 화면이라 게이트에 들어올 때 서버 프로필을 한 번 다시 확인한다.
  //   조회 성공 + 권한 없음 → 잠근다.
  //   조회 실패             → 역시 잠근다(fail-closed). 세션 판정으로 열어 주면, 강등된 사람이 통신이 끊긴 상태에서
  //     기기에 남아 있던 급여 자료를 그대로 볼 수 있다(Codex 정지게이트 지적 2026-07-28).
  //     오프라인이어도 캐시된 프로필이 있으면 조회는 성공하므로 실제로 여기 걸리는 경우는 드물고,
  //     걸리더라도 '다시 시도'로 바로 회복된다.
  const [revokedByServer, setRevokedByServer] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  // 재확인이 끝나기 전에는 표를 띄우지 않는다. 확인 중에 자식이 먼저 마운트되면 그 사이 급여 데이터를
  // 조회하게 되고, 서버가 막아도 화면은 기기에 남아 있던 값을 보여줄 수 있다(Codex 지적 2026-07-28).
  const [serverCheck, setServerCheck] = useState<"idle" | "pending" | "done">("idle");
  const uid = user?.loginType === "personal" ? user.uid : undefined;
  useEffect(() => {
    let cancelled = false;
    // 계정이나 지점이 바뀌면 앞선 판정은 버린다 — 남겨 두면 A 계정의 '차단' 결과가
    // B 계정이나 다른 지점에까지 따라붙어, 조회가 실패하는 동안 정당한 사용자를 잠근다(Codex 지적 2026-07-28).
    setRevokedByServer(false);
    setCheckFailed(false);
    if (!uid) { setServerCheck("idle"); return; }
    setServerCheck("pending");
    (async () => {
      try {
        const { loadUserProfile } = await import("../../../api/userProfile");
        // 확인이 끝나기 전에는 화면이 잠겨 있으므로, 조회가 영영 끝나지 않으면 로딩에 갇힌다.
        // 시간을 정해 두고 넘기면 실패로 처리해 '다시 시도'를 내보낸다(무한 대기 방지).
        let timeoutId: number | undefined;
        const fresh = await Promise.race([
          loadUserProfile(uid),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error("권한 확인 시간 초과")), 10000);
          })
        ]).finally(() => { if (timeoutId !== undefined) window.clearTimeout(timeoutId); });
        if (cancelled) return;
        const stillAllowed = !!fresh
          && fresh.status === "active"
          && fresh.reviewedByAdmin
          && canReadSalaryBranch(
            {
              role: fresh.role,
              salaryBranches: fresh.salaryBranches ?? [],
              allowedBranches: fresh.allowedBranches,
              loginType: "personal"
            },
            branchName
          );
        setRevokedByServer(!stillAllowed);
      } catch (error) {
        // 조회 실패 — 열어 주지 않는다(위 주석). 사용자는 '다시 시도'로 회복한다.
        if (!cancelled) {
          console.warn("급여대장 권한 재확인 실패:", error);
          setCheckFailed(true);
        }
      } finally {
        if (!cancelled) setServerCheck("done");
      }
    })();
    return () => { cancelled = true; };
  }, [uid, branchName, retryToken]);

  const sessionAllowed = canReadSalaryBranch(user, branchName);
  const allowed = sessionAllowed && !revokedByServer;

  const [unlocked, setUnlocked] = useState(salaryUnlocked);
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState("");
  const [passcode, setPasscode] = useState<string>("");
  const [passStatus, setPassStatus] = useState<"loading" | "ready" | "error" | "unconfigured">("loading");

  // 비밀번호는 캐시가 아닌 '서버 값'으로 검증한다. 서버에 실제로 비밀번호가 설정돼 있어야만(ready) 해제를 허용한다.
  // - 서버에 비밀번호 미설정 → unconfigured (하드코딩 기본값으로 뚫지 않고 관리자 설정 요구)
  // - 서버 도달 실패 → error (스테일 캐시로 해제 금지, 재시도 요구)
  // 정직원·파트타이머가 같은 값(fullTimeSalaryPasscode)을 공유한다 — 바꿀 곳이 한 곳이어야 관리가 어긋나지 않는다.
  const loadPasscode = useCallback(() => {
    setPassStatus("loading");
    gasClient.getSharedDataFromServer<any>("admin_settings")
      .then((remote) => {
        const pc = remote && typeof remote === "object" ? String(remote.fullTimeSalaryPasscode ?? "").trim() : "";
        // 빈값 또는 과거 하드코딩 기본값("1234")은 '설정 안 됨'으로 간주 → 레거시 서버 값이 유효하게 남지 않도록 거부.
        if (pc !== "" && pc !== "1234") {
          setPasscode(pc);
          setPassStatus("ready");
        } else {
          setPassStatus("unconfigured");
        }
      })
      .catch(() => setPassStatus("error"));
  }, []);

  // 권한이 있을 때만 보안 설정을 조회한다 — 권한 없는 계정이 이 탭을 열어도 백엔드 요청이 나가지 않게(격리 목적).
  useEffect(() => {
    if (!allowed) return;
    loadPasscode();
  }, [allowed, loadPasscode]);

  // 보안 재잠금: (1) 급여대장 탭을 떠나면(언마운트) 다시 잠근다. (2) 화면이 1분 이상 숨겨졌다 다시 열리면
  //   (노트북을 닫았다 다른 사람이 여는 경우 등) 다시 잠근다. 잠깐 alt-tab에는 잠기지 않는다.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 60000) {
        setSalaryUnlocked(false);
        setUnlocked(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      setSalaryUnlocked(false); // 탭을 떠나면 재잠금
    };
  }, []);

  // 권한을 잃은 계정(역할 강등·지점 회수)이 앞서 풀어 둔 해제 상태를 그대로 쓰지 못하게 한다.
  useEffect(() => {
    if (allowed) return;
    setSalaryUnlocked(false);
    setUnlocked(false);
  }, [allowed]);

  const tryUnlock = () => {
    if (passStatus !== "ready") {
      setPassError(
        passStatus === "loading" ? "보안 설정을 불러오는 중입니다. 잠시만 기다려주세요."
        : passStatus === "unconfigured" ? "급여대장 열람 비밀번호가 서버에 설정돼 있지 않습니다. 관리자 설정에서 먼저 비밀번호를 설정해주세요."
        : "보안 설정을 서버에서 확인하지 못했습니다. 네트워크 확인 후 '다시 시도'를 눌러주세요."
      );
      return;
    }
    if (passInput.trim() === passcode) {
      setSalaryUnlocked(true);
      setUnlocked(true);
      setPassError("");
    } else {
      setPassError("비밀번호가 올바르지 않습니다.");
    }
  };

  // ---- (1) 역할·지점 권한 ----
  // 화면 차단은 안내일 뿐이고 실제 차단은 firestore.rules(canReadSalary)가 한다 — 둘의 판정 기준을 salaryAccess로 공유한다.
  if (!allowed) {
    return (
      <div className={SCREEN_CLASS} data-guide={guideAnchor}>
        <div className={ICON_BOX_CLASS}><Lock className="w-7 h-7" /></div>
        <h3 className={TITLE_PILL_CLASS}>열람 권한이 없습니다</h3>
        <p className={BODY_CLASS}>{salaryAccessDenialMessage(user, branchName)}</p>
      </div>
    );
  }

  // 권한을 확인하지 못했다 — 열어 주지 않는다. 여기서 세션 판정으로 통과시키면 강등된 사람이
  // 통신이 끊긴 상태에서 기기에 남은 급여 자료를 그대로 볼 수 있다.
  if (checkFailed) {
    return (
      <div className={SCREEN_CLASS} data-guide={guideAnchor}>
        <div className={ICON_BOX_CLASS}><Lock className="w-7 h-7" /></div>
        <h3 className={TITLE_PILL_CLASS}>권한을 확인하지 못했습니다</h3>
        <p className={BODY_CLASS}>
          급여대장은 권한을 확인한 뒤에만 열 수 있습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.
        </p>
        <button onClick={() => setRetryToken((token) => token + 1)} className={`${ACTION_BUTTON_CLASS} mt-4`}>
          <ShieldCheck className="w-4 h-4" /> 다시 시도
        </button>
      </div>
    );
  }

  // 세션은 권한이 있다고 하지만 서버 재확인이 아직 끝나지 않았다 — 표를 띄우지 않고 기다린다.
  // (권한이 없는 경우는 위에서 이미 걸렀으므로 여기까지 오지 않는다.)
  //
  // 'pending'이 아니라 '"done"이 아닌 모든 상태'를 막는 것이 중요하다. 첫 렌더에는 아직 effect가 돌기 전이라
  // 상태가 'idle'인데, 그때 통과시키면 자식이 먼저 마운트되어 재확인이 시작되기도 전에 급여 데이터를 조회한다
  // (React는 자식 effect를 부모보다 먼저 실행한다). 다른 탭에서 이미 잠금을 풀어 둔 경우 특히 그렇다
  // — Codex 정지게이트 지적 2026-07-28.
  if (uid && serverCheck !== "done") {
    return (
      <div className={SCREEN_CLASS} data-guide={guideAnchor}>
        <LoadingSpinner />
        <p className={BODY_CLASS}>열람 권한을 확인하는 중입니다...</p>
      </div>
    );
  }

  // ---- (2) 비밀번호 ----
  // import.meta.env.DEV는 vite build(배포본)에서 자동으로 false가 되므로, 배포하면 다시 비밀번호를 요구한다.
  // (hostname 판별을 쓰면 안 된다 — 이 프로젝트의 hostname 목록엔 운영(run.app)도 들어 있다.)
  // 주의: 이 우회는 비밀번호에만 적용된다. 위의 역할·지점 권한은 개발 모드에서도 그대로 막힌다.
  if (!unlocked && !devUnlockBypass()) {
    return (
      <div className={SCREEN_CLASS} data-guide={guideAnchor}>
        <div className={ICON_BOX_CLASS}><Lock className="w-7 h-7" /></div>
        <h3 className={TITLE_PILL_CLASS}>{title}</h3>
        <div className="flex items-center gap-2 mt-5">
          <input
            type="password"
            value={passInput}
            onChange={(e) => { setPassInput(e.target.value); setPassError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
            placeholder="비밀번호"
            /* 입력칸 표준(DESIGN.md §6-0-1 표): 11px · font-bold · rounded-lg · 회색 테두리. */
            className="h-9 px-4 border border-gray-200 rounded-lg text-[11px] font-bold text-center tracking-widest focus:outline-none focus:border-[#212121]"
            autoFocus
          />
          {passStatus === "error" ? (
            <button onClick={loadPasscode} className={ACTION_BUTTON_CLASS}>
              <ShieldCheck className="w-4 h-4" /> 다시 시도
            </button>
          ) : (
            <button onClick={tryUnlock} disabled={passStatus !== "ready"} className={ACTION_BUTTON_CLASS}>
              <ShieldCheck className="w-4 h-4" /> {passStatus === "ready" ? "열람" : passStatus === "unconfigured" ? "설정 필요" : "불러오는 중"}
            </button>
          )}
        </div>
        {passError
          ? <p className={ERROR_CLASS}>{passError}</p>
          : passStatus === "unconfigured"
          ? <p className={ERROR_CLASS}>관리자 설정에서 급여대장 열람 비밀번호를 먼저 설정해주세요.</p>
          : passStatus === "error"
          ? <p className={ERROR_CLASS}>보안 설정을 서버에서 확인하지 못했습니다. '다시 시도'를 눌러주세요.</p>
          : null}
        <p className="text-[11px] text-zinc-400 font-bold mt-4">비밀번호는 관리자 설정에서 변경할 수 있습니다.</p>
      </div>
    );
  }

  return <>{children}</>;
}
