import JSZip from 'jszip';

/**
 * Tải một file ảnh đơn lẻ về máy tính người dùng
 */
export async function downloadSingleImage(imageUrlOrDataUrl: string, filename: string = 'hinh-anh.png'): Promise<void> {
  try {
    let downloadHref = imageUrlOrDataUrl;
    let revokeNeeded = false;

    if (!imageUrlOrDataUrl.startsWith('data:')) {
      // Nếu là URL online (ImgBB, Supabase, Cloud), fetch để tránh CORS chặn download attribute
      try {
        const response = await fetch(imageUrlOrDataUrl);
        const blob = await response.blob();
        downloadHref = URL.createObjectURL(blob);
        revokeNeeded = true;
      } catch (corsErr) {
        // Fallback mở link trực tiếp nếu CORS chặn fetch
        console.warn("Không thể fetch trực tiếp URL ảnh, fallback sang href:", corsErr);
      }
    }

    const a = document.createElement('a');
    a.href = downloadHref;
    a.download = filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? filename : `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (revokeNeeded) {
      setTimeout(() => URL.revokeObjectURL(downloadHref), 5000);
    }
  } catch (err) {
    console.error("Lỗi khi tải ảnh về máy:", err);
    throw err;
  }
}

/**
 * Nén toàn bộ danh sách hình ảnh vào 1 file ZIP và tự động tải về máy
 */
export async function downloadImagesAsZip(
  items: Array<{ urlOrDataUrl: string; filename: string }>,
  zipFilename: string = 'danh-sach-hinh-anh.zip',
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  if (!items || items.length === 0) {
    throw new Error("Không có hình ảnh nào để tải về.");
  }

  const zip = new JSZip();
  const folder = zip.folder("images") || zip;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (item.urlOrDataUrl.startsWith('data:')) {
        // Tách header base64 lấy dữ liệu thô
        const base64Data = item.urlOrDataUrl.split(',')[1];
        if (base64Data) {
          folder.file(item.filename, base64Data, { base64: true });
        }
      } else {
        // Tải từ URL
        const response = await fetch(item.urlOrDataUrl);
        const blob = await response.blob();
        folder.file(item.filename, blob);
      }
    } catch (e) {
      console.warn(`Không thể nạp ảnh ${item.filename} vào zip:`, e);
    }
    if (onProgress) {
      onProgress(i + 1, items.length);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = URL.createObjectURL(zipBlob);

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
}
