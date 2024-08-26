export function downloadFileFromBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  download(href, filename);
  URL.revokeObjectURL(href);
}

export async function downloadFileFromUrl(
  path: string,
  filename: string,
  ext?: string,
) {
  const fileData = await (await fetch(path)).blob();
  if (ext === undefined) {
    ext = new URL(path).pathname.split(".").at(-1);
  }
  downloadFileFromBlob(fileData, `${filename}.${ext}`);
}

/** Download with plan url resource */
export function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  a.remove();
}

export function getFilename({
  prefix = "sound",
  title,
  suffix,
}: {
  prefix?: string;
  title: string;
  suffix?: string;
}) {
  return suffix ? `${prefix}-${title}-${suffix}` : `${prefix}-${title}`;
}
