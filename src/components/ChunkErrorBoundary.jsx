// src/components/ChunkErrorBoundary.jsx
// 화면을 여는 데 실패했을 때 흰 화면 대신 뭐라도 보여준다.
//
// 왜 .jsx 인가
//   이 프로젝트에는 @types/react 가 설치돼 있지 않다. 그래서 .tsx 로 클래스 컴포넌트를 쓰면
//   this.state / this.props 타입이 잡히지 않아 타입 검사가 실패한다.
//   지금 타입을 새로 깔면 코드베이스 전체에 오류가 쏟아질 수 있어, 이 파일만 JS로 둔다.
//   (tsconfig 의 allowJs 가 켜져 있다)
//
// 왜 필요한가
//   화면 파일을 못 받는 이유는 두 가지다 — "내가 옛 버전"이거나 "인터넷이 끊겼거나".
//   오류 메시지는 똑같아서 구분이 안 된다.
//     · 옛 버전이면  → 새로고침하면 최신을 받아 해결된다.
//     · 인터넷이면   → 새로고침해봐야 브라우저 오류 화면으로 떨어지고 보던 화면마저 잃는다.
//   그래서 새로고침을 안 하기로 결정하는 경우가 생기는데, 그때 아무것도 안 그리면 흰 화면이 된다.
//   매장은 "먹통"으로 인식하고 뭘 해야 할지 모른다. 이 경계가 그 자리를 메운다.
import React from "react";
import { isMissingChunkError, reloadForMissingChunk } from "../utils/chunkReload";

const shellClass = "min-h-screen bg-[#F6F5FA] flex items-center justify-center px-6";

export class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, reloading: false, isChunk: false };
  }

  static getDerivedStateFromError(error) {
    // 오류 종류를 여기서 갈라둔다. 안 가르면 화면 안의 평범한 버그(데이터·렌더 오류)까지
    // "인터넷 연결을 확인하세요"로 안내하게 된다 — 매장은 와이파이만 탓하고 진짜 버그는 묻힌다.
    // 다시 throw하지는 않는다. 그러면 흰 화면으로 돌아가 이 경계를 둔 이유가 사라진다.
    return { failed: true, reloading: false, isChunk: isMissingChunkError(error) };
  }

  componentDidCatch(error, info) {
    console.error("화면을 여는 중 오류가 났습니다.", error, info?.componentStack);
    // 파일을 못 받은 게 아니면 새로고침해봐야 소용없다. render가 앱 오류 안내를 그린다.
    if (!isMissingChunkError(error)) return;

    // 옛 버전이라 없는 파일을 요청한 것이라면 최신을 받아온다.
    // 서버에 닿는지 실제로 물어보므로 판단에 시간이 걸린다 — 그동안은 "받아오는 중"을 보여준다.
    // 인터넷 문제이거나 방금 새로고침했다면 false가 오고, 그때 안내 화면으로 바꾼다.
    this.setState({ reloading: true });
    reloadForMissingChunk("lazy import failed").then((started) => {
      if (!started) this.setState({ reloading: false });
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;

    if (this.state.reloading) {
      return (
        <div className={shellClass}>
          <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-sm font-black text-zinc-800 shadow-sm">
            최신 버전을 받아오는 중입니다.
          </div>
        </div>
      );
    }

    // 여기까지 왔다는 것은 파일을 못 받았고(청크 오류) 새로고침도 하지 않기로 했다는 뜻이다 —
    // 서버에 닿지 않았거나(인터넷 문제) 방금 새로고침하고도 또 실패했다. 그때만 인터넷을 의심시킨다.
    if (this.state.isChunk) {
      return (
        <div className={shellClass}>
          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-zinc-200 bg-white px-5 py-5 text-center shadow-sm">
            <p className="text-sm font-black text-zinc-900">화면을 여는 데 실패했습니다.</p>
            <p className="text-xs font-bold leading-relaxed text-zinc-500">
              인터넷 연결을 확인한 뒤 새로고침해 주세요.
              <br />
              작성 중이던 마감 내용은 저장되어 있습니다.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-black text-white"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }

    // 파일은 잘 받았는데 화면을 그리다 터졌다 — 앱 오류다. 인터넷 탓으로 돌리면 안 된다.
    // 새로고침으로 풀릴 수도 있지만 안 풀리면 고쳐야 할 버그이니, 알려달라고 분명히 적는다.
    return (
      <div className={shellClass}>
        <div className="w-full max-w-sm space-y-3 rounded-2xl border border-zinc-200 bg-white px-5 py-5 text-center shadow-sm">
          <p className="text-sm font-black text-zinc-900">화면에 문제가 생겼습니다.</p>
          <p className="text-xs font-bold leading-relaxed text-zinc-500">
            인터넷 문제가 아니라 <b className="font-black text-zinc-700">ERP 오류</b>입니다.
            <br />
            새로고침해도 같은 화면이 뜨면 본사에 알려주세요.
            <br />
            작성 중이던 마감 내용은 저장되어 있습니다.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-black text-white"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }
}
