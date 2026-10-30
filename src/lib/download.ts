export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'download.bin';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadText(
  text: string,
  filename: string,
  mime = 'text/plain;charset=utf-8',
): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename, 'application/json;charset=utf-8');
}

export function ensureExtension(filename: string, extension: string): string {
  return filename.toLowerCase().endsWith(extension)
    ? filename
    : `${filename}${extension}`;
}

export function sanitizeDownloadName(filename: string): string {
  const cleaned = filename
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 200);
  return cleaned || 'download.bin';
}
