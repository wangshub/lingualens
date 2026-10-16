import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// WXT derives manifest.version from package.json. Never keep a second version here.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Let developers load the output in their own Chrome profile. No browser
  // process is launched implicitly, which also supports remote/headless hosts.
  webExt: { disabled: true },
  manifestVersion: 3,
  manifest: {
    name: 'LinguaLens',
    description: '使用你自己的 AI 服务，忠实翻译网页与选中文本，并随时还原原文。',
    minimum_chrome_version: '123',
    permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
    // Arbitrary BYOK endpoints and page text access require HTTP(S) host access.
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'LinguaLens · 网页翻译' },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
