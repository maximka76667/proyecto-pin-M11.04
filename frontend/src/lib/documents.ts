import { MaterialCommunityIcons } from '@expo/vector-icons';

export type DocumentKind = 'file' | 'link';

export type ApartmentDocument = {
  id: string;
  apartment_id: string;
  name: string;
  kind: DocumentKind;
  mime_type: string | null;
  size_bytes: number | null;
  original_filename: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
  creator: { id: string; full_name: string } | null;
  editor: { id: string; full_name: string } | null;
};

export type DocumentAccess = {
  kind: DocumentKind;
  url: string;
  name: string;
  mime_type?: string | null;
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // igual que el servidor
export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const FILE_TOO_BIG = 'El archivo no puede superar los 10 MB';
export const FILE_NOT_ACCEPTED = 'Solo se admiten PDF, JPG, PNG o WebP';
export const LINK_NOT_ACCEPTED =
  'El enlace debe ser de Google Docs, Sheets, Slides o Drive (https://docs.google.com/…)';

export function formatSize(bytes: number | null) {
  if (bytes === null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// Mismo criterio que el servidor (que es quien decide de verdad): solo para avisar antes
export function isGoogleLink(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.hostname === 'docs.google.com') {
      return /^\/(document|spreadsheets|presentation)\//.test(url.pathname);
    }
    if (url.hostname === 'drive.google.com') return /^\/(file|drive|open)(\/|$)/.test(url.pathname);
    return false;
  } catch {
    return false;
  }
}

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export function documentIcon(doc: ApartmentDocument): IconName {
  if (doc.kind === 'link') {
    const url = doc.url ?? '';
    if (url.includes('/spreadsheets/')) return 'google-spreadsheet';
    if (url.includes('/presentation/')) return 'file-presentation-box';
    if (url.includes('/document/')) return 'file-document-outline';
    return 'google-drive';
  }
  if (doc.mime_type === 'application/pdf') return 'file-pdf-box';
  return 'file-image-outline';
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
