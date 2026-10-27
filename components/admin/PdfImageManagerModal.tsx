import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Image as ImageIcon, UploadCloud, Check, ArrowRight, 
  Crop, Sparkles, Loader2, RefreshCw, AlertCircle, Eye, 
  ExternalLink, ZoomIn, ZoomOut, CheckCircle2, Copy, HardDrive, Database, ShieldCheck, Download
} from 'lucide-react';
import { Question } from '../../types';
import { 
  getImgBBKey, 
  uploadBlobToImgBB, 
  getImageStorageTarget, 
  setImageStorageTarget, 
  uploadImageByTarget,
  ImageStorageTarget
} from '../../services/storage';
import { isSupabaseConnected } from '../../services/supabaseService';
import { 
  ExtractedPdfImage, 
  extractAllImagesFromPdf, 
  renderPdfPageToCanvas 
} from '../../services/pdfImageExtractor';
import { downloadSingleImage, downloadImagesAsZip } from '../../utils/imageDownloader';

interface PdfImageManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfFile: File | null;
  questions: Question[];
  onApplyImageToQuestion: (questionId: string, imageUrl: string) => void;
  onOpenStorageConfig?: () => void;
}

export default function PdfImageManagerModal({
  isOpen,
  onClose,
  pdfFile,
  questions,
  onApplyImageToQuestion,
  onOpenStorageConfig
}: PdfImageManagerModalProps) {
  const [activeTab, setActiveTab] = useState<'extracted' | 'crop'>('extracted');
  const [activeFile, setActiveFile] = useState<File | null>(pdfFile);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [extractedImages, setExtractedImages] = useState<ExtractedPdfImage[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ current: number; total: number; count: number } | null>(null);
  
  // Storage Destination Choice: 'supabase' | 'imgbb' | 'base64'
  const [storageTarget, setStorageTargetState] = useState<ImageStorageTarget>(() => getImageStorageTarget());
  const [imgbbKey, setImgbbKey] = useState(() => getImgBBKey());
  const [supabaseReady, setSupabaseReady] = useState(() => isSupabaseConnected());

  const [uploadingMap, setUploadingMap] = useState<Record<string, boolean>>({});
  const [uploadedUrls, setUploadedUrls] = useState<Record<string, string>>({});
  const [uploadedTargetMap, setUploadedTargetMap] = useState<Record<string, ImageStorageTarget>>({});
  const [assignedMap, setAssignedMap] = useState<Record<string, string>>({}); // imageId -> questionId

  // Download All State
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [downloadProgressText, setDownloadProgressText] = useState('');

  // Crop mode state
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoomScale, setZoomScale] = useState<number>(1.4);
  const [isPageRendering, setIsPageRendering] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Selection box for crop
  const [isSelecting, setIsSelecting] = useState<boolean>(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(null);
  const [selectedQuestionForCrop, setSelectedQuestionForCrop] = useState<string>(questions[0]?.id || '');
  const [isUploadingCrop, setIsUploadingCrop] = useState<boolean>(false);

  // Change active storage target
  const handleSelectStorageTarget = (target: ImageStorageTarget) => {
    setStorageTargetState(target);
    setImageStorageTarget(target);
  };

  // Sync when storage config or external events fire
  useEffect(() => {
    const handleTargetChange = (e: any) => {
      if (e?.detail) setStorageTargetState(e.detail);
    };
    const handleKeyChange = (e: any) => {
      setImgbbKey(getImgBBKey());
    };

    window.addEventListener('eduquiz_image_storage_target_changed', handleTargetChange);
    window.addEventListener('eduquiz_imgbb_key_changed', handleKeyChange);
    return () => {
      window.removeEventListener('eduquiz_image_storage_target_changed', handleTargetChange);
      window.removeEventListener('eduquiz_imgbb_key_changed', handleKeyChange);
    };
  }, []);

  // Cập nhật khi pdfFile prop thay đổi
  useEffect(() => {
    if (pdfFile) {
      setActiveFile(pdfFile);
    }
  }, [pdfFile]);

  // Nạp buffer khi có activeFile
  useEffect(() => {
    if (!isOpen || !activeFile) return;

    setImgbbKey(getImgBBKey());
    setSupabaseReady(isSupabaseConnected());
    setStorageTargetState(getImageStorageTarget());

    const reader = new FileReader();
    reader.onload = async (e) => {
      if (e.target?.result instanceof ArrayBuffer) {
        const buffer = e.target.result;
        setPdfBuffer(buffer);
        // Tự động quét ảnh nhúng
        startExtraction(buffer);
      }
    };
    reader.readAsArrayBuffer(activeFile);
  }, [isOpen, activeFile]);

  const handleManualFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setActiveFile(file);
      e.target.value = '';
    }
  };

  // Quét ảnh nhúng từ PDF
  const startExtraction = async (buffer: ArrayBuffer) => {
    setIsExtracting(true);
    setExtractedImages([]);
    try {
      const imgs = await extractAllImagesFromPdf(buffer, (status) => {
        setExtractProgress({
          current: status.currentPage,
          total: status.totalPages,
          count: status.foundImages
        });
      });
      setExtractedImages(imgs);
      setNumPages(extractProgress?.total || 5);
    } catch (err) {
      console.error("Lỗi trích xuất ảnh PDF:", err);
    } finally {
      setIsExtracting(false);
    }
  };

  // Tải toàn bộ ảnh bóc tách về máy tính dưới dạng file ZIP
  const handleDownloadAllExtracted = async () => {
    if (extractedImages.length === 0) {
      alert("Chưa có hình ảnh nào được bóc tách từ file PDF!");
      return;
    }

    setIsDownloadingAll(true);
    setDownloadProgressText("Đang nén dữ liệu...");
    try {
      const baseName = (activeFile?.name || 'De_Thi_PDF')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9-]/g, '_');

      const items = extractedImages.map((img, idx) => ({
        urlOrDataUrl: uploadedUrls[img.id] || img.dataUrl,
        filename: `Hinh_${String(idx + 1).padStart(2, '0')}_Trang_${img.pageIndex}.png`
      }));

      await downloadImagesAsZip(items, `Bo_Anh_PDF_${baseName}.zip`, (cur, tot) => {
        setDownloadProgressText(`Đang nén ${cur}/${tot}...`);
      });
    } catch (err: any) {
      alert("Lỗi khi tải trọn bộ ảnh: " + (err?.message || err));
    } finally {
      setIsDownloadingAll(false);
      setDownloadProgressText("");
    }
  };

  // Render trang PDF khi ở chế độ Cắt ảnh
  useEffect(() => {
    if (activeTab !== 'crop' || !pdfBuffer || !canvasRef.current) return;

    let isMounted = true;
    setIsPageRendering(true);
    setCropRect(null);
    setCroppedPreviewUrl(null);

    renderPdfPageToCanvas(pdfBuffer, currentPage, canvasRef.current, zoomScale)
      .catch((err) => console.error("Lỗi render PDF:", err))
      .finally(() => {
        if (isMounted) setIsPageRendering(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, pdfBuffer, currentPage, zoomScale]);

  // Xử lý kéo chuột để chọn vùng crop
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsSelecting(true);
    setStartPos({ x, y });
    setCropRect({ x, y, width: 0, height: 0 });
    setCroppedPreviewUrl(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelecting || !startPos || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(startPos.x, currentX);
    const y = Math.min(startPos.y, currentY);
    const width = Math.abs(currentX - startPos.x);
    const height = Math.abs(currentY - startPos.y);

    setCropRect({ x, y, width, height });
  };

  const handleMouseUp = () => {
    if (!isSelecting || !cropRect || !canvasRef.current) {
      setIsSelecting(false);
      return;
    }
    setIsSelecting(false);

    // Nếu vùng chọn quá nhỏ, bỏ qua
    if (cropRect.width < 15 || cropRect.height < 15) {
      setCropRect(null);
      return;
    }

    // Cắt ảnh từ Canvas gốc
    const canvas = canvasRef.current;
    const scaleX = canvas.width / canvas.getBoundingClientRect().width;
    const scaleY = canvas.height / canvas.getBoundingClientRect().height;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropRect.width * scaleX;
    cropCanvas.height = cropRect.height * scaleY;
    const ctx = cropCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(
        canvas,
        cropRect.x * scaleX,
        cropRect.y * scaleY,
        cropRect.width * scaleX,
        cropRect.height * scaleY,
        0,
        0,
        cropCanvas.width,
        cropCanvas.height
      );
      setCroppedPreviewUrl(cropCanvas.toDataURL('image/png'));
    }
  };

  // Upload 1 ảnh theo mục tiêu đã chọn
  const handleUploadSingleImage = async (img: ExtractedPdfImage): Promise<string | null> => {
    if (storageTarget === 'imgbb' && !getImgBBKey()) {
      if (onOpenStorageConfig) onOpenStorageConfig();
      else alert("Vui lòng cấu hình ImgBB API Key trước khi tải ảnh lên ImgBB!");
      return null;
    }

    setUploadingMap(prev => ({ ...prev, [img.id]: true }));
    try {
      const url = await uploadImageByTarget(img.dataUrl, storageTarget);
      setUploadedUrls(prev => ({ ...prev, [img.id]: url }));
      setUploadedTargetMap(prev => ({ ...prev, [img.id]: storageTarget }));
      return url;
    } catch (err: any) {
      alert(`Lỗi lưu ảnh (${storageTarget}): ` + (err?.message || "Không thể upload"));
      return null;
    } finally {
      setUploadingMap(prev => ({ ...prev, [img.id]: false }));
    }
  };

  // Gán ảnh vào câu hỏi (Tự upload theo đích đến nếu chưa xử lý)
  const handleAssignToQuestion = async (img: ExtractedPdfImage, questionId: string) => {
    let finalUrl = uploadedUrls[img.id];

    if (!finalUrl) {
      if (storageTarget === 'base64') {
        finalUrl = img.dataUrl;
      } else {
        finalUrl = await handleUploadSingleImage(img) || img.dataUrl;
      }
    }

    onApplyImageToQuestion(questionId, finalUrl);
    setAssignedMap(prev => ({ ...prev, [img.id]: questionId }));
  };

  // Upload vùng crop theo mục tiêu và gán vào câu hỏi đã chọn
  const handleUploadAndAssignCrop = async () => {
    if (!croppedPreviewUrl || !selectedQuestionForCrop) return;

    if (storageTarget === 'imgbb' && !getImgBBKey()) {
      if (onOpenStorageConfig) {
        onOpenStorageConfig();
        return;
      }
      alert("Vui lòng cấu hình ImgBB API Key trước!");
      return;
    }

    setIsUploadingCrop(true);
    try {
      const finalUrl = await uploadImageByTarget(croppedPreviewUrl, storageTarget);
      onApplyImageToQuestion(selectedQuestionForCrop, finalUrl);

      const targetLabel = storageTarget === 'supabase' ? 'Supabase Store' : storageTarget === 'imgbb' ? 'ImgBB' : 'Base64';
      alert(`🎉 Đã lưu ảnh vào [${targetLabel}] và gắn thành công vào câu hỏi được chọn!`);
      setCropRect(null);
      setCroppedPreviewUrl(null);
    } catch (err: any) {
      alert("Lỗi lưu ảnh vùng cắt: " + (err?.message || "Thao tác thất bại"));
    } finally {
      setIsUploadingCrop(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[4600] flex items-center justify-center p-2 sm:p-6 animate-fade-in">
      <div className="bg-white w-full max-w-5xl h-[94vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border-4 border-white">
        {/* Header Modal */}
        <div className="px-6 py-4 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/30 text-blue-400 rounded-2xl border border-blue-500/30 shrink-0">
              <ImageIcon size={22} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black uppercase tracking-tight flex items-center gap-2">
                BỘ BÓC TÁCH & LƯU TRỮ ẢNH PDF
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-black rounded-lg">
                  ĐA NƠI LƯU
                </span>
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs text-slate-400 font-medium truncate max-w-xs sm:max-w-sm">
                  Tệp: <span className="text-white font-semibold">{activeFile?.name || 'Chưa chọn file PDF'}</span>
                </p>
                <label className="text-[10px] text-blue-400 hover:text-blue-300 font-black uppercase underline cursor-pointer shrink-0">
                  <input type="file" accept="application/pdf" className="hidden" onChange={handleManualFileChange} />
                  {activeFile ? 'Đổi PDF khác' : 'Chọn PDF'}
                </label>
              </div>
            </div>
          </div>

          {/* Quick Storage Status Indicator & Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {/* NÚT TẢI TOÀN BỘ ẢNH BÓC TÁCH VỀ MÁY (ZIP) */}
            {extractedImages.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadAllExtracted}
                disabled={isDownloadingAll}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-md active:scale-95 disabled:opacity-50"
                title="Tải toàn bộ hình ảnh bóc tách về máy tính thành 1 file ZIP"
              >
                {isDownloadingAll ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                <span>{isDownloadingAll ? (downloadProgressText || 'Đang tải...') : `Tải ${extractedImages.length} ảnh về máy (ZIP)`}</span>
              </button>
            )}

            <button
              onClick={onOpenStorageConfig}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                storageTarget === 'supabase'
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/80'
                  : storageTarget === 'imgbb'
                  ? imgbbKey 
                    ? 'bg-purple-950/60 text-purple-300 border-purple-500/40 hover:bg-purple-900/80'
                    : 'bg-amber-950/60 text-amber-300 border-amber-500/40 hover:bg-amber-900/80'
                  : 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40 hover:bg-indigo-900/80'
              }`}
              title="Nhấn để mở Cấu hình lưu trữ chi tiết"
            >
              {storageTarget === 'supabase' && <Database size={13} className="text-emerald-400" />}
              {storageTarget === 'imgbb' && <UploadCloud size={13} className="text-purple-400" />}
              {storageTarget === 'base64' && <HardDrive size={13} className="text-indigo-400" />}
              <span className="truncate max-w-[140px]">
                {storageTarget === 'supabase' ? 'Supabase Store' : storageTarget === 'imgbb' ? (imgbbKey ? 'ImgBB Đã kết nối' : 'Cần nhập Key ImgBB') : 'Nhúng Base64'}
              </span>
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Thanh chọn NƠI LƯU TRỮ ẢNH (3 LỰA CHỌN: Supabase, ImgBB, Base64) */}
        <div className="px-6 py-2.5 bg-slate-900/95 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 shrink-0">
              Nơi lưu ảnh:
            </span>
            <div className="inline-flex p-1 bg-slate-800/80 rounded-2xl border border-slate-700/60 gap-1">
              {/* Lựa chọn 1: Supabase Store */}
              <button
                type="button"
                onClick={() => handleSelectStorageTarget('supabase')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                  storageTarget === 'supabase'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
                title="Khuyên dùng cho kho đề lâu dài, an toàn tuyệt đối không bao giờ bị xóa"
              >
                <Database size={13} />
                <span>Store Supabase</span>
                <span className="text-[9px] px-1.5 py-0.2 bg-emerald-400/20 text-emerald-200 rounded font-bold hidden sm:inline">
                  Lưu kho lâu dài
                </span>
              </button>

              {/* Lựa chọn 2: ImgBB */}
              <button
                type="button"
                onClick={() => handleSelectStorageTarget('imgbb')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                  storageTarget === 'imgbb'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
                title="Tải nhanh lên đám mây ngoài, phù hợp cho đề thi cần tổ chức thi liền"
              >
                <UploadCloud size={13} />
                <span>ImgBB</span>
                <span className="text-[9px] px-1.5 py-0.2 bg-purple-400/20 text-purple-200 rounded font-bold hidden sm:inline">
                  Thi liền
                </span>
              </button>

              {/* Lựa chọn 3: Base64 */}
              <button
                type="button"
                onClick={() => handleSelectStorageTarget('base64')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                  storageTarget === 'base64'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                }`}
                title="Ghi trực tiếp vào đề thi, lưu trữ vĩnh viễn không cần host mạng ngoài"
              >
                <HardDrive size={13} />
                <span>Base64</span>
                <span className="text-[9px] px-1.5 py-0.2 bg-blue-400/20 text-blue-200 rounded font-bold hidden sm:inline">
                  Nhúng vĩnh viễn
                </span>
              </button>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 font-medium">
            {storageTarget === 'supabase' && (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck size={12} /> Bucket `quiz-images` trên Supabase (Không lo bị xóa)
              </span>
            )}
            {storageTarget === 'imgbb' && (
              <span className="text-purple-300 font-bold flex items-center gap-1">
                🚀 Upload đám mây ImgBB (Tốc độ cao cho đề thi liền)
              </span>
            )}
            {storageTarget === 'base64' && (
              <span className="text-blue-300 font-bold flex items-center gap-1">
                💾 Mã hóa trực tiếp trong đề thi (100% offline & an toàn)
              </span>
            )}
          </div>
        </div>

        {/* Tab chuyển đổi chế độ */}
        <div className="px-6 pt-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('extracted')}
              className={`flex items-center gap-2 px-4 py-2.5 font-black text-xs uppercase rounded-t-2xl transition-all border-t-2 border-x-2 ${
                activeTab === 'extracted'
                  ? 'bg-white text-blue-600 border-slate-200 shadow-sm'
                  : 'bg-transparent text-slate-500 border-transparent hover:text-slate-900'
              }`}
            >
              <Sparkles size={15} />
              Ảnh nhúng tự động ({extractedImages.length})
            </button>
            <button
              onClick={() => setActiveTab('crop')}
              className={`flex items-center gap-2 px-4 py-2.5 font-black text-xs uppercase rounded-t-2xl transition-all border-t-2 border-x-2 ${
                activeTab === 'crop'
                  ? 'bg-white text-blue-600 border-slate-200 shadow-sm'
                  : 'bg-transparent text-slate-500 border-transparent hover:text-slate-900'
              }`}
            >
              <Crop size={15} />
              Kéo chuột cắt vùng ảnh (Đồ thị/Hình vẽ)
            </button>
          </div>

          <span className="text-[11px] text-slate-500 font-bold hidden sm:inline">
            Tổng {questions.length} câu hỏi trong đề
          </span>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden bg-slate-100 flex flex-col">
          {activeTab === 'extracted' ? (
            /* TAB 1: DANH SÁCH ẢNH NHÚNG TỰ ĐỘNG */
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {isExtracting ? (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center space-y-4">
                  <Loader2 className="animate-spin text-blue-600" size={48} />
                  <div>
                    <h4 className="text-base font-black text-slate-800 uppercase">Đang quét luồng nhị phân & bóc tách ảnh...</h4>
                    <p className="text-xs text-slate-500 mt-1 font-medium">
                      Trang {extractProgress?.current || 1}/{extractProgress?.total || '...'} • Đã tìm thấy {extractProgress?.count || 0} ảnh
                    </p>
                  </div>
                </div>
              ) : extractedImages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-200 rounded-3xl flex items-center justify-center text-slate-400">
                    <ImageIcon size={32} />
                  </div>
                  <div className="max-w-md">
                    <h4 className="text-base font-black text-slate-800 uppercase">Không tìm thấy ảnh nhúng đơn lẻ</h4>
                    <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed">
                      Nhiều file PDF vẽ đồ thị hoặc sơ đồ bằng các đường nét vector (không phải dạng file ảnh nhúng). Bạn hãy bấm sang tab <b>"Kéo chuột cắt vùng ảnh"</b> để khoanh vùng và lưu bất kỳ đồ thị nào chỉ trong 2 giây!
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('crop')}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-black text-white rounded-xl text-xs font-black uppercase transition-all shadow-md flex items-center gap-2"
                  >
                    <Crop size={14} /> Chuyển sang Cắt vùng ảnh
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                    <div className="text-xs font-bold text-slate-700">
                      Đã trích xuất thành công <span className="text-blue-600 font-black">{extractedImages.length}</span> ảnh. Đang lưu theo chế độ:{' '}
                      <span className={`px-2 py-0.5 rounded-md font-black text-[11px] ${
                        storageTarget === 'supabase'
                          ? 'bg-emerald-100 text-emerald-800'
                          : storageTarget === 'imgbb'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {storageTarget === 'supabase' ? '☁️ Supabase Storage' : storageTarget === 'imgbb' ? '🚀 ImgBB Cloud' : '💾 Base64 Nhúng'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Nút tải trọn bộ ảnh ZIP */}
                      <button
                        onClick={handleDownloadAllExtracted}
                        disabled={isDownloadingAll}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-xl text-xs font-black uppercase transition-all active:scale-95 disabled:opacity-50"
                        title="Tải tất cả các hình ảnh này về máy tính (file ZIP)"
                      >
                        {isDownloadingAll ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        {isDownloadingAll ? (downloadProgressText || 'Đang tải...') : 'Tải hết về máy (ZIP)'}
                      </button>

                      <button
                        onClick={() => pdfBuffer && startExtraction(pdfBuffer)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase transition-all"
                      >
                        <RefreshCw size={12} /> Quét lại
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {extractedImages.map((img, idx) => {
                      const isUploading = uploadingMap[img.id];
                      const uploadedUrl = uploadedUrls[img.id];
                      const uploadedTarget = uploadedTargetMap[img.id];
                      const assignedQId = assignedMap[img.id];
                      const assignedQ = questions.find(q => q.id === assignedQId);

                      return (
                        <div 
                          key={img.id}
                          className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex flex-col space-y-3 group"
                        >
                          {/* Khung ảnh */}
                          <div className="relative w-full h-44 bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 flex items-center justify-center p-2">
                            <img
                              src={img.dataUrl}
                              alt={`PDF Extracted ${idx}`}
                              className="max-h-full max-w-full object-contain"
                            />
                            <div className="absolute top-2 left-2 px-2 py-0.5 bg-slate-900/80 backdrop-blur-sm text-white text-[10px] font-black rounded-lg">
                              Trang {img.pageIndex} • {img.width}x{img.height}
                            </div>

                            {/* Nút tải riêng ảnh này về máy */}
                            <button
                              type="button"
                              onClick={() => downloadSingleImage(uploadedUrl || img.dataUrl, `Hinh_${String(idx + 1).padStart(2, '0')}_Trang_${img.pageIndex}.png`)}
                              className="absolute bottom-2 right-2 p-2 bg-slate-900/80 hover:bg-black text-white rounded-xl text-xs shadow-md backdrop-blur-xs transition-all active:scale-90"
                              title="Tải riêng hình ảnh này về máy tính"
                            >
                              <Download size={13} />
                            </button>

                            {uploadedUrl && (
                              <div className={`absolute top-2 right-2 px-2 py-0.5 text-white text-[10px] font-black rounded-lg flex items-center gap-1 shadow-sm ${
                                uploadedTarget === 'supabase' 
                                  ? 'bg-emerald-600' 
                                  : uploadedTarget === 'imgbb' 
                                  ? 'bg-purple-600' 
                                  : 'bg-blue-600'
                              }`}>
                                <Check size={10} strokeWidth={3} />
                                {uploadedTarget === 'supabase' ? 'Supabase' : uploadedTarget === 'imgbb' ? 'ImgBB' : 'Base64'}
                              </div>
                            )}
                          </div>

                          {/* Thao tác Upload & Gán câu hỏi */}
                          <div className="space-y-2 pt-1 flex-1 flex flex-col justify-end">
                            {assignedQ ? (
                              <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl text-[11px] font-bold flex items-center justify-between border border-emerald-100">
                                <span>Đã gán cho câu:</span>
                                <span className="font-black px-1.5 py-0.5 bg-emerald-200 text-emerald-900 rounded-md">
                                  Câu {questions.findIndex(q => q.id === assignedQ.id) + 1}
                                </span>
                              </div>
                            ) : null}

                            <div className="flex gap-2">
                              {/* Nút upload theo chế độ đã chọn */}
                              {!uploadedUrl && storageTarget !== 'base64' && (
                                <button
                                  onClick={() => handleUploadSingleImage(img)}
                                  disabled={isUploading}
                                  className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase transition-all flex items-center gap-1 shrink-0 disabled:opacity-50 ${
                                    storageTarget === 'supabase'
                                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                                      : 'bg-purple-50 hover:bg-purple-100 text-purple-700'
                                  }`}
                                  title={`Tải ảnh lên ${storageTarget === 'supabase' ? 'Supabase Storage' : 'ImgBB'}`}
                                >
                                  {isUploading ? (
                                    <Loader2 className="animate-spin" size={13} />
                                  ) : storageTarget === 'supabase' ? (
                                    <Database size={13} />
                                  ) : (
                                    <UploadCloud size={13} />
                                  )}
                                  {isUploading ? 'Đang tải...' : storageTarget === 'supabase' ? 'Lên Supabase' : 'Lên ImgBB'}
                                </button>
                              )}

                              {/* Dropdown chọn câu hỏi để gán */}
                              <div className="flex-1 relative">
                                <select
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleAssignToQuestion(img, e.target.value);
                                    }
                                  }}
                                  className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-blue-500 cursor-pointer"
                                >
                                  <option value="" disabled>👉 Gán vào câu hỏi...</option>
                                  {questions.map((q, qIdx) => (
                                    <option key={q.id} value={q.id}>
                                      Câu {qIdx + 1}: {q.text.substring(0, 35)}...
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* TAB 2: CẮT VÙNG ẢNH ĐỒ THỊ TRỰC TIẾP TRÊN TRANG PDF */
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              {/* Cột trái: Vùng hiển thị Canvas PDF để kéo chuột */}
              <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-200 bg-slate-200/60">
                {/* Thanh điều khiển trang & phóng to */}
                <div className="p-3 bg-white border-b border-slate-200 flex items-center justify-between text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Trang:</span>
                    <button
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40"
                    >
                      Trước
                    </button>
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-black">
                      {currentPage} / {numPages || 1}
                    </span>
                    <button
                      disabled={currentPage >= numPages}
                      onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40"
                    >
                      Sau
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setZoomScale(s => Math.max(0.8, s - 0.2))}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg"
                      title="Thu nhỏ"
                    >
                      <ZoomOut size={14} />
                    </button>
                    <span className="text-[11px] text-slate-600 font-bold">{Math.round(zoomScale * 100)}%</span>
                    <button
                      onClick={() => setZoomScale(s => Math.min(2.5, s + 0.2))}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg"
                      title="Phóng to"
                    >
                      <ZoomIn size={14} />
                    </button>
                  </div>
                </div>

                {/* Khung Canvas xem trang */}
                <div className="flex-1 overflow-auto p-4 flex justify-center items-start">
                  <div 
                    className="relative shadow-2xl rounded-xl overflow-hidden bg-white cursor-crosshair select-none"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                  >
                    <canvas ref={canvasRef} className="block" />
                    
                    {/* Hộp chọn Crop trực quan */}
                    {cropRect && (
                      <div
                        className="absolute border-2 border-blue-600 bg-blue-500/20 pointer-events-none rounded-sm"
                        style={{
                          left: `${cropRect.x}px`,
                          top: `${cropRect.y}px`,
                          width: `${cropRect.width}px`,
                          height: `${cropRect.height}px`
                        }}
                      >
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-blue-600 text-white text-[9px] font-black rounded">
                          {Math.round(cropRect.width)} x {Math.round(cropRect.height)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Cột phải: Xem trước ảnh đã cắt, chọn nơi lưu & gán vào câu hỏi */}
              <div className="w-full md:w-80 bg-white p-5 flex flex-col justify-between overflow-y-auto space-y-4">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider">Hướng dẫn cắt ảnh:</h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Dùng chuột <b>kéo một ô vuông</b> bao quanh hình vẽ đồ thị trên trang PDF bên trái.
                    </p>
                  </div>

                  {/* Vùng xem trước ảnh vừa cắt */}
                  <div className="border-2 border-dashed border-slate-200 rounded-2xl p-3 bg-slate-50 min-h-[140px] flex flex-col items-center justify-center">
                    {croppedPreviewUrl ? (
                      <div className="space-y-2.5 w-full flex flex-col items-center">
                        <img 
                          src={croppedPreviewUrl} 
                          alt="Crop preview" 
                          className="max-h-36 object-contain rounded-lg border border-slate-200 shadow-sm bg-white" 
                        />
                        
                        <div className="flex items-center gap-2 w-full">
                          {/* Nút tải ảnh vừa cắt về máy tính */}
                          <button
                            type="button"
                            onClick={() => downloadSingleImage(croppedPreviewUrl, `Hinh_Cat_Trang_${currentPage}_${Date.now()}.png`)}
                            className="flex-1 py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 border border-emerald-200 transition-all active:scale-95 shadow-xs"
                            title="Lưu file ảnh này về máy tính của bạn"
                          >
                            <Download size={13} />
                            <span>Tải về máy</span>
                          </button>

                          <button
                            onClick={() => {
                              setCropRect(null);
                              setCroppedPreviewUrl(null);
                            }}
                            className="text-[10px] text-red-500 hover:underline font-bold px-2 py-1"
                          >
                            Cắt lại
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-slate-400 space-y-1">
                        <Crop size={24} className="mx-auto" />
                        <span className="text-[11px] font-medium block">Chưa khoanh vùng ảnh nào</span>
                      </div>
                    )}
                  </div>

                  {/* Lựa chọn nơi lưu ảnh cho vùng cắt này */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black uppercase text-slate-700 block">
                      Nơi lưu trữ ảnh cắt:
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
                      <button
                        type="button"
                        onClick={() => handleSelectStorageTarget('supabase')}
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-black flex flex-col items-center gap-0.5 transition-all ${
                          storageTarget === 'supabase'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-600 hover:bg-white'
                        }`}
                        title="Lưu trữ lâu dài trên Supabase bucket quiz-images"
                      >
                        <Database size={13} />
                        <span>Supabase</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectStorageTarget('imgbb')}
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-black flex flex-col items-center gap-0.5 transition-all ${
                          storageTarget === 'imgbb'
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-slate-600 hover:bg-white'
                        }`}
                        title="Upload ImgBB cho các đề thi liền"
                      >
                        <UploadCloud size={13} />
                        <span>ImgBB</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectStorageTarget('base64')}
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-black flex flex-col items-center gap-0.5 transition-all ${
                          storageTarget === 'base64'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-600 hover:bg-white'
                        }`}
                        title="Nhúng trực tiếp Base64 vào đề thi"
                      >
                        <HardDrive size={13} />
                        <span>Base64</span>
                      </button>
                    </div>
                  </div>

                  {/* Chọn câu hỏi cần gán */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black uppercase text-slate-700 block">
                      Gán ảnh này cho câu:
                    </label>
                    <select
                      value={selectedQuestionForCrop}
                      onChange={e => setSelectedQuestionForCrop(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 cursor-pointer"
                    >
                      {questions.map((q, idx) => (
                        <option key={q.id} value={q.id}>
                          Câu {idx + 1} {q.imageUrl ? '(Đã có ảnh)' : ''}: {q.text.substring(0, 30)}...
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Nút hành động Lưu & Gán vào câu hỏi */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <button
                    disabled={!croppedPreviewUrl || !selectedQuestionForCrop || isUploadingCrop}
                    onClick={handleUploadAndAssignCrop}
                    className={`w-full py-3 text-white font-black text-xs uppercase rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-40 ${
                      storageTarget === 'supabase'
                        ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                        : storageTarget === 'imgbb'
                        ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'
                        : 'bg-blue-600 hover:bg-black shadow-blue-200'
                    }`}
                  >
                    {isUploadingCrop ? (
                      <>
                        <Loader2 className="animate-spin" size={14} /> 
                        {storageTarget === 'supabase' ? 'Đang lưu vào Supabase...' : storageTarget === 'imgbb' ? 'Đang đẩy lên ImgBB...' : 'Đang xử lý Base64...'}
                      </>
                    ) : (
                      <>
                        {storageTarget === 'supabase' && <Database size={14} />}
                        {storageTarget === 'imgbb' && <UploadCloud size={14} />}
                        {storageTarget === 'base64' && <HardDrive size={14} />}
                        <span>
                          {storageTarget === 'supabase' 
                            ? 'Lưu Supabase & Gán vào đề' 
                            : storageTarget === 'imgbb' 
                            ? 'Lên ImgBB & Gán vào đề' 
                            : 'Nhúng Base64 & Gán vào đề'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
