import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  const appVersion = process.env.GITHUB_SHA || (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return `local-${Date.now()}`;
    }
  })();

  // 시연용 빌드(`vite build --mode demo`)에서만 true.
  // __IS_DEMO__가 리터럴로 치환되어야 운영 빌드에서 데모 분기가 죽은코드 제거로 사라진다
  // (scripts/demo/check_prod_bundle.mjs가 양쪽 번들을 기계 검사한다).
  const isDemo = mode === 'demo';

  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __IS_DEMO__: JSON.stringify(isDemo),
    },
    plugins: [
      // 데모 빌드에서는 Firebase 설정 JSON을 데모 프로젝트 것으로 통째로 바꿔치기한다.
      // 소스 4곳이 같은 상대경로로 import하므로 여기(resolve 단계) 한 곳만 바꾸면 전부 적용된다.
      // endsWith 비교라 데모 설정 파일 자신(...demo.json)은 다시 매칭되지 않는다.
      isDemo && {
        name: 'ugd-demo-config-swap',
        enforce: 'pre' as const,
        resolveId(source: string) {
          if (source.endsWith('firebase-applet-config.json')) {
            return path.resolve(__dirname, 'firebase-applet-config.demo.json');
          }
          return null;
        },
      },
      // 브라우저 탭 제목은 index.html 에 정적으로 박혀 있어 IS_DEMO 분기가 닿지 않는다.
      // 시연용 빌드에서만 여기서 갈아 끼운다 — 탭 제목에도 실제 회사명이 남으면 안 된다(2026-08-24).
      isDemo && {
        name: 'ugd-demo-title',
        transformIndexHtml(html: string) {
          return html.replace(
            /<title>[^<]*<\/title>/,
            '<title>ERP_DAON 일일마감정산 포털</title>'
          );
        },
      },
      {
        name: 'ugd-app-version',
        buildStart() {
          const publicDir = path.resolve(__dirname, 'public');
          fs.mkdirSync(publicDir, { recursive: true });
          fs.writeFileSync(
            path.join(publicDir, 'app-version.json'),
            JSON.stringify({ version: appVersion, builtAt: new Date().toISOString() }, null, 2),
            'utf8'
          );
        },
      },
      react(),
      tailwindcss()
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
