// src/components/MyAccountModal.tsx
// 내 정보 — 개인 계정 사용자가 자기 이름·연락처·비밀번호를 직접 고친다(2026-07-29 사용자 요청).
// - 이름·연락처: users/{uid} 자가 수정(updateOwnProfile). firestore.rules 가 name/phone 두 키만 허용한다.
// - 비밀번호: 이메일 계정만 — 현재 비밀번호로 재인증(reauthenticateWithCredential) 후 updatePassword.
//   PIN 계정 경로(firebaseAuth.ts)의 "재로그인" 방식과 달리 본인 세션을 유지한 채 바꾼다.
//   구글 로그인 계정은 비밀번호가 구글 소관이라 안내만 한다.
// 지점(BranchConfirmPage)·관리자(AdminPage) 사이드바가 공용으로 연다.
import { useEffect, useState } from "react";
import { useAuthContext } from "../contexts/AuthContext";
import { loadUserProfile, updateOwnProfile } from "../api/userProfile";
import { warmPersonalAuth } from "../hooks/useAuth";
import LoadingSpinner from "./LoadingSpinner";

type Message = { ok: boolean; text: string } | null;

export default function MyAccountModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { user } = useAuthContext();
  const uid = user?.loginType === "personal" ? user.uid : undefined;

  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMessage, setInfoMessage] = useState<Message>(null);

  const [hasPasswordProvider, setHasPasswordProvider] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMessage, setPwMessage] = useState<Message>(null);

  useEffect(() => {
    if (!isOpen || !uid) return;
    let alive = true;
    setLoading(true);
    setLoadFailed(false);
    setInfoMessage(null);
    setPwMessage(null);
    setCurrentPw(""); setNewPw(""); setNewPwConfirm("");
    (async () => {
      try {
        // 연락처는 세션(UserSession)에 없다 — 문서를 직접 읽는다. 로그인 방식(이메일/구글)은
        // Auth providerData 로 판정한다(useAuth.ts 의 기존 패턴과 동일).
        await warmPersonalAuth();
        const [profile, { getAuth }] = await Promise.all([loadUserProfile(uid), import("firebase/auth")]);
        if (!alive) return;
        setName(String(profile?.name || user?.name || ""));
        setPhone(String(profile?.phone || ""));
        setHasPasswordProvider(!!getAuth().currentUser?.providerData.some((p) => p.providerId === "password"));
      } catch (e) {
        console.error("내 정보 로드 실패:", e);
        if (alive) setLoadFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // user?.name 은 세션 로그인 시점 고정값이라 의존성에서 제외해도 무방하다(초기 표시 폴백용).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, uid]);

  if (!isOpen) return null;

  const saveInfo = async () => {
    if (!uid || savingInfo) return;
    const nextName = name.trim();
    const nextPhone = phone.trim();
    if (!nextName) { setInfoMessage({ ok: false, text: "이름을 입력해 주세요." }); return; }
    if (!nextPhone) { setInfoMessage({ ok: false, text: "연락처를 입력해 주세요." }); return; }
    setSavingInfo(true);
    setInfoMessage(null);
    try {
      await updateOwnProfile(uid, { name: nextName, phone: nextPhone });
      // Auth displayName 도 본인 권한으로 맞춰 둔다 — 실패해도 화면 표시는 Firestore 기준이라 무시.
      try {
        const { getAuth, updateProfile } = await import("firebase/auth");
        const current = getAuth().currentUser;
        if (current) await updateProfile(current, { displayName: nextName });
      } catch { /* 무시 */ }
      setInfoMessage({ ok: true, text: "저장했습니다. 화면 곳곳의 이름은 다음 로그인부터 새 이름으로 보입니다." });
    } catch (e) {
      console.error("내 정보 저장 실패:", e);
      setInfoMessage({ ok: false, text: "저장하지 못했습니다. 네트워크 확인 후 다시 시도해 주세요." });
    } finally {
      setSavingInfo(false);
    }
  };

  const changePassword = async () => {
    if (savingPw) return;
    setPwMessage(null);
    if (!currentPw) { setPwMessage({ ok: false, text: "현재 비밀번호를 입력해 주세요." }); return; }
    if (newPw.length < 6) { setPwMessage({ ok: false, text: "새 비밀번호는 6자 이상이어야 합니다." }); return; }
    if (newPw !== newPwConfirm) { setPwMessage({ ok: false, text: "새 비밀번호 두 칸이 서로 다릅니다." }); return; }
    setSavingPw(true);
    try {
      await warmPersonalAuth();   // 기본 앱 초기화 + 한국어 오류 메일 규약(useAuth 기존 규약)
      const { getAuth, EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import("firebase/auth");
      const current = getAuth().currentUser;
      if (!current?.email) throw new Error("로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.");
      // 본인 확인 — 현재 비밀번호로 재인증해야 Firebase 가 변경을 허용한다(최근 로그인 요구 대응).
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPw));
      await updatePassword(current, newPw);
      setCurrentPw(""); setNewPw(""); setNewPwConfirm("");
      setPwMessage({ ok: true, text: "비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 사용하세요." });
    } catch (e: any) {
      const code = String(e?.code || "");
      console.error("비밀번호 변경 실패:", e);
      setPwMessage({
        ok: false,
        text: code === "auth/wrong-password" || code === "auth/invalid-credential"
          ? "현재 비밀번호가 올바르지 않습니다."
          : code === "auth/weak-password"
            ? "새 비밀번호가 너무 약합니다. 6자 이상으로 정해 주세요."
            : code === "auth/too-many-requests"
              ? "시도가 너무 많아 잠시 막혔습니다. 몇 분 뒤 다시 시도해 주세요."
              : "비밀번호를 바꾸지 못했습니다. 네트워크 확인 후 다시 시도해 주세요.",
      });
    } finally {
      setSavingPw(false);
    }
  };

  const inputClass = "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-bold";
  const messageView = (message: Message) => message && (
    <p className={`text-[11px] font-black ${message.ok ? "text-emerald-700" : "text-[#B91C1C]"}`}>{message.text}</p>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4" id="my-account-overlay">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 space-y-5 max-h-[90vh] overflow-y-auto" id="my-account-modal">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-[#212121]">내 정보</h3>
          <button onClick={onClose} className="text-xs font-black text-zinc-400 cursor-pointer" id="btn-my-account-close">닫기</button>
        </div>

        {!uid ? (
          <p className="text-xs font-bold text-zinc-500">개인 계정으로 로그인했을 때만 사용할 수 있습니다.</p>
        ) : loading ? (
          <div className="py-10 text-center"><LoadingSpinner size="sm" /></div>
        ) : loadFailed ? (
          <p className="text-xs font-bold text-[#B91C1C]">내 정보를 불러오지 못했습니다. 닫았다가 다시 열어 주세요.</p>
        ) : (
          <>
            <p className="text-[11px] font-bold text-zinc-500">계정 이메일: {user?.email || "-"}</p>

            <div className="space-y-2.5">
              <label className="block space-y-1">
                <span className="text-[11px] font-black text-gray-700">이름</span>
                <input value={name} onChange={(e) => setName(e.target.value)} disabled={savingInfo} className={inputClass} />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-black text-gray-700">연락처</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={savingInfo} inputMode="tel" className={inputClass} />
              </label>
              {messageView(infoMessage)}
              <button onClick={() => void saveInfo()} disabled={savingInfo}
                className="w-full rounded-xl bg-[#212121] py-2.5 text-xs font-black text-white cursor-pointer disabled:opacity-50" id="btn-my-account-save-info">
                {savingInfo ? "저장 중..." : "이름·연락처 저장"}
              </button>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-2.5">
              <p className="text-[11px] font-black text-gray-700">비밀번호 변경</p>
              {hasPasswordProvider ? (
                <>
                  <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} disabled={savingPw}
                    placeholder="현재 비밀번호" autoComplete="current-password" className={inputClass} />
                  <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} disabled={savingPw}
                    placeholder="새 비밀번호 (6자 이상)" autoComplete="new-password" className={inputClass} />
                  <div className="space-y-1">
                    <input type="password" value={newPwConfirm} onChange={(e) => setNewPwConfirm(e.target.value)} disabled={savingPw}
                      placeholder="새 비밀번호 확인" autoComplete="new-password"
                      className={`w-full rounded-xl border px-3 py-2.5 text-xs font-bold ${newPwConfirm && newPw !== newPwConfirm ? "border-[#C93A3A]" : "border-gray-200"}`} />
                    {newPwConfirm && (
                      newPw === newPwConfirm
                        ? <p className="text-[11px] font-bold text-emerald-600">비밀번호가 일치합니다</p>
                        : <p className="text-[11px] font-bold text-[#B91C1C]">비밀번호가 일치하지 않습니다</p>
                    )}
                  </div>
                  {messageView(pwMessage)}
                  <button onClick={() => void changePassword()} disabled={savingPw || !currentPw || !newPw || newPw !== newPwConfirm}
                    className="w-full rounded-xl border border-[#212121] py-2.5 text-xs font-black text-[#212121] cursor-pointer disabled:opacity-40" id="btn-my-account-change-pw">
                    {savingPw ? "변경 중..." : "비밀번호 변경"}
                  </button>
                </>
              ) : (
                <p className="text-[11px] font-bold text-zinc-500">
                  구글 계정으로 로그인 중입니다. 비밀번호는 구글 계정 설정에서 관리됩니다.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
