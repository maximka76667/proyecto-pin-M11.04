import { enlaceDeGoogle } from './google-link';

describe('enlaceDeGoogle', () => {
  it.each([
    'https://docs.google.com/document/d/abc123/edit',
    'https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing',
    'https://docs.google.com/presentation/d/abc123/edit',
    'https://drive.google.com/file/d/abc123/view',
    'https://drive.google.com/drive/folders/abc123',
    'https://drive.google.com/open?id=abc123',
  ])('acepta %s', (enlace) => {
    expect(enlaceDeGoogle(enlace)).toBe(enlace);
  });

  it.each([
    '',
    '   ',
    'no es un enlace',
    'http://docs.google.com/document/d/abc/edit',
    'javascript:alert(1)',
    'https://evil.com/document/d/abc',
    'https://docs.google.com.evil.com/document/d/abc',
    'https://evil.com/?https://docs.google.com/document/d/abc',
    'https://user:pass@docs.google.com/document/d/abc',
    'https://docs.google.com:8443/document/d/abc',
    'https://docs.google.com/forms/d/abc',
    'https://docs.google.com/',
    'https://drive.google.com/',
    `https://docs.google.com/document/d/${'a'.repeat(2100)}`,
  ])('rechaza %j', (enlace) => {
    expect(enlaceDeGoogle(enlace)).toBeNull();
  });
});
