// Dịch vụ trích xuất ảnh nhị phân & render vùng ảnh từ file PDF bằng pdfjs-dist
// Hỗ trợ lưu trữ trực tiếp lên ImgBB API

import { uploadBlobToImgBB, getImgBBKey } from './storage';

export interface ExtractedPdfImage {
  id: string;
  pageIndex: number; // 1-indexed
  dataUrl: string; // Base64 preview
  width: number;
  height: number;
  uploadedUrl?: string; // Link ImgBB nếu đã upload
  isUploading?: boolean;
  error?: string;
}

let pdfjsLibInstance: any = null;

// Khởi tạo pdfjs-dist động với worker cấu hình chuẩn CDN hoặc ES module
async function getPdfjsLib() {
  if (pdfjsLibInstance) return pdfjsLibInstance;
  
  try {
    const pdfjs = await import('pdfjs-dist');
    // Cấu hình worker
    if (pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version || '4.0.379'}/pdf.worker.min.mjs`;
    }
    pdfjsLibInstance = pdfjs;
    return pdfjs;
  } catch (err) {
    console.error("Lỗi nạp pdfjs-dist:", err);
    throw new Error("Không thể khởi động trình đọc PDF. Vui lòng thử lại!");
  }
}

/**
 * Chuyển đổi dữ liệu canvas / image data thành Blob PNG
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Lỗi chuyển đổi ảnh Canvas sang Blob"));
    }, 'image/png');
  });
}

/**
 * Tự động bóc tách tất cả các hình ảnh nhúng (Embedded Images) trong file PDF
 * @param pdfBuffer ArrayBuffer hoặc Uint8Array của file PDF
 * @param onProgress Callback báo tiến độ (tiến trình trang hiện tại)
 */
export async function extractAllImagesFromPdf(
  pdfBuffer: ArrayBuffer,
  onProgress?: (status: { currentPage: number; totalPages: number; foundImages: number }) => void
): Promise<ExtractedPdfImage[]> {
  const pdfjs = await getPdfjsLib();
  const loadingTask = pdfjs.getDocument({ data: pdfBuffer });
  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;
  const results: ExtractedPdfImage[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const operatorList = await page.getOperatorList();
    
    // Tìm các toán tử vẽ ảnh (paintImageXObject)
    const validImageIds: string[] = [];
    for (let i = 0; i < operatorList.fnArray.length; i++) {
      if (operatorList.fnArray[i] === pdfjs.OPS.paintImageXObject) {
        const objId = operatorList.argsArray[i][0];
        if (objId && !validImageIds.includes(objId)) {
          validImageIds.push(objId);
        }
      }
    }

    for (const objId of validImageIds) {
      try {
        const imgObj = await new Promise<any>((resolve) => {
          page.objs.get(objId, (img: any) => resolve(img));
        });

        if (!imgObj || !imgObj.width || !imgObj.height) continue;

        // Bỏ qua các ảnh quá nhỏ (icon, biểu tượng trang trí < 40px)
        if (imgObj.width < 40 || imgObj.height < 40) continue;

        // Vẽ ảnh lên canvas tạm thời để xuất Base64
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imgObj.width;
        tempCanvas.height = imgObj.height;
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) continue;

        if (imgObj.bitmap) {
          ctx.drawImage(imgObj.bitmap, 0, 0);
        } else if (imgObj.data) {
          const clamped = new Uint8ClampedArray(imgObj.width * imgObj.height * 4);
          const raw = imgObj.data;
          const channels = raw.length / (imgObj.width * imgObj.height);

          if (channels === 3) {
            // RGB
            let p = 0;
            for (let j = 0; j < raw.length; j += 3) {
              clamped[p] = raw[j];
              clamped[p + 1] = raw[j + 1];
              clamped[p + 2] = raw[j + 2];
              clamped[p + 3] = 255;
              p += 4;
            }
          } else if (channels === 4) {
            // RGBA
            clamped.set(raw);
          } else if (channels === 1) {
            // Grayscale
            let p = 0;
            for (let j = 0; j < raw.length; j++) {
              const val = raw[j];
              clamped[p] = val;
              clamped[p + 1] = val;
              clamped[p + 2] = val;
              clamped[p + 3] = 255;
              p += 4;
            }
          }

          const imgData = new ImageData(clamped, imgObj.width, imgObj.height);
          ctx.putImageData(imgData, 0, 0);
        } else {
          continue;
        }

        const dataUrl = tempCanvas.toDataURL('image/png');
        results.push({
          id: `pdf-img-${pageNum}-${objId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          pageIndex: pageNum,
          dataUrl,
          width: imgObj.width,
          height: imgObj.height,
        });
      } catch (err) {
        console.warn(`Không thể trích xuất ảnh ${objId} trang ${pageNum}:`, err);
      }
    }

    if (onProgress) {
      onProgress({
        currentPage: pageNum,
        totalPages,
        foundImages: results.length
      });
    }
  }

  return results;
}

/**
 * Render một trang PDF ra Canvas với tỉ lệ scale tuỳ chỉnh (phục vụ xem trước và kéo crop)
 */
export async function renderPdfPageToCanvas(
  pdfBuffer: ArrayBuffer,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.5
): Promise<{ width: number; height: number }> {
  const pdfjs = await getPdfjsLib();
  const loadingTask = pdfjs.getDocument({ data: pdfBuffer });
  const pdfDoc = await loadingTask.promise;
  const page = await pdfDoc.getPage(pageNum);
  
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Không thể khởi tạo Canvas context");

  const renderContext = {
    canvasContext: ctx,
    viewport: viewport
  };

  await page.render(renderContext).promise;
  return { width: viewport.width, height: viewport.height };
}

/**
 * Tải một ảnh trích xuất lên ImgBB và trả về URL
 */
export async function uploadExtractedImageToImgBB(
  image: ExtractedPdfImage,
  apiKey?: string
): Promise<string> {
  const key = apiKey || getImgBBKey();
  if (!key) {
    throw new Error("Chưa cấu hình ImgBB API Key. Vui lòng nhập API Key để tải ảnh lên máy chủ ImgBB.");
  }

  // Chuyển DataURL sang Blob
  const res = await fetch(image.dataUrl);
  const blob = await res.blob();

  const url = await uploadBlobToImgBB(blob, key);
  return url;
}
