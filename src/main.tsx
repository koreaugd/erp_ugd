import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {isAllowedHost} from './utils/allowedHost.ts';
import WrongHostNotice from './components/WrongHostNotice.tsx';

// 허용되지 않은 주소면 앱을 아예 띄우지 않는다 — 로그인·Firebase 초기화까지 가지 않게
// 여기서(가장 바깥에서) 막는다. 이유는 utils/allowedHost.ts 주석 참고.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAllowedHost() ? <App /> : <WrongHostNotice />}
  </StrictMode>,
);
