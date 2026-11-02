import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import light from './assets/fonts/Poppins-Light.woff';
import regular from './assets/fonts/Poppins-Regular.woff';
import medium from './assets/fonts/Poppins-Medium.woff';
import bold from './assets/fonts/Poppins-Bold.woff';

/** Font Poppins disematkan (offline) & dimuat sebelum canvas dirender agar preview = hasil export. */
async function loadFonts() {
  const faces: [string, string][] = [
    [light, '300'],
    [regular, '400'],
    [medium, '500'],
    [bold, '700'],
  ];
  await Promise.all(
    faces.map(async ([src, weight]) => {
      const f = new FontFace('Poppins', `url(${src})`, { weight, style: 'normal' });
      await f.load();
      document.fonts.add(f);
    }),
  ).catch((e) => console.warn('Font gagal dimuat', e));
}

loadFonts().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
