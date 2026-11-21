const MAX_LONGITUD = 2048;

// Un enlace solo se acepta si es de Google Docs, Sheets, Slides o Drive, por https y sin
// usuario, contraseña ni puerto. Devuelve el enlace limpio o null si no vale. Así no se
// pueden guardar enlaces a cualquier web (ni javascript:) que luego los compañeros abran
export function enlaceDeGoogle(valor: string): string | null {
  const texto = valor.trim();
  if (!texto || texto.length > MAX_LONGITUD) return null;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return null;
  }

  if (url.hostname === 'docs.google.com') {
    return /^\/(document|spreadsheets|presentation)\//.test(url.pathname)
      ? url.toString()
      : null;
  }
  if (url.hostname === 'drive.google.com') {
    return /^\/(file|drive|open)(\/|$)/.test(url.pathname) ? url.toString() : null;
  }
  return null;
}
