import React, { useState } from 'react';
import { 
  Sparkles, Check, X, Loader2, ExternalLink, 
  RefreshCw, Key, CheckCircle2, XCircle, Info, Image as ImageIcon, Trash2
} from 'lucide-react';
import { 
  getImgBBKey, 
  setImgBBKey, 
  uploadBlobToImgBB 
} from '../../services/storage';

interface StorageConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStorageUpdated?: () => void;
}

export const StorageConfigModal: React.FC<StorageConfigModalProps> = ({
  isOpen,
  onClose,
  onStorageUpdated
}) => {
  const [imgbbKey, setImgbbKeyState] = useState(() => getImgBBKey());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveImgbb = () => {
    const trimmed = imgbbKey.trim();
    setImgBBKey(trimmed);
    setSaveStatus('Đã lưu API Key thành công!');
    setTimeout(() => setSaveStatus(null), 3000);
    if (onStorageUpdated) onStorageUpdated();
  };

  const handleClearKey = () => {
    setImgbbKeyState('');
    setImgBBKey('');
    setTestResult(null);
    setSaveStatus('Đã xóa API Key!');
    setTimeout(() => setSaveStatus(null), 3000);
    if (onStorageUpdated) onStorageUpdated();
  };

  const handleTestImgbb = async () => {
    const key = imgbbKey.trim();
    if (!key) {
      alert('Vui lòng nhập ImgBB API Key trước khi kiểm tra!');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      // Tạo một ảnh test 2x2 pixel JPEG
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#8b5cf6';
        ctx.fillRect(0, 0, 2, 2);
      }
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg'));
      if (!blob) throw new Error('Không thể tạo ảnh kiểm tra');

      const url = await uploadBlobToImgBB(blob, key);
      setTestResult({
        success: true,
        message: 'Kết nối ImgBB API thành công! Ảnh thử nghiệm đã được lưu trực tuyến.',
        url
      });
      // Tự động lưu key nếu test thành công
      setImgBBKey(key);
      if (onStorageUpdated) onStorageUpdated();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Kiểm tra thất bại. Vui lòng kiểm tra lại tính chính xác của API Key.'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const isConfigured = Boolean(imgbbKey.trim());

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white max-w-xl w-full rounded-3xl border-4 border-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-scale-up">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-600 text-white rounded-2xl shadow-md shadow-purple-200">
              <Sparkles size={24} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">
                Cấu hình Nơi lưu ảnh (ImgBB API)
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Dịch vụ lưu trữ hình ảnh trực tuyến vĩnh viễn & hoàn toàn miễn phí
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            title="Đóng"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-sm">
          {/* Trạng thái hiện tại */}
          <div className="p-4 rounded-2xl border bg-slate-50 border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-black uppercase text-slate-500 tracking-wider">
                Trạng thái:
              </span>
              {isConfigured ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  Đang dùng ImgBB Cloud
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-0.5"></span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                  <Info size={13} className="text-amber-600" />
                  Nén Base64 (Chưa cài ImgBB Key)
                </span>
              )}
            </div>
            {saveStatus && (
              <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200 animate-pulse">
                {saveStatus}
              </span>
            )}
          </div>

          {/* Giới thiệu giải pháp */}
          <div className="p-4 rounded-2xl bg-purple-50/70 border border-purple-100 text-xs text-purple-900 space-y-2">
            <p className="font-bold flex items-center gap-1.5 text-sm text-purple-950">
              <ImageIcon size={16} className="text-purple-600" /> Tự động tải ảnh & tạo link trực tuyến
            </p>
            <p className="text-slate-600 leading-relaxed">
              Khi bạn nhập <b>ImgBB API Key</b> vào đây, mọi hình ảnh câu hỏi (tải lên từ máy hoặc dán trực tiếp bằng <b>Ctrl+V</b>) sẽ được tự động lưu lên máy chủ ImgBB và tạo đường link ảnh online vĩnh viễn, giúp đề thi nhẹ nhàng và tải bài thi siêu tốc!
            </p>
          </div>

          {/* Nhập API Key */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase text-slate-700 tracking-wide flex items-center gap-1.5">
                <Key size={14} className="text-purple-600" /> Mã ImgBB API Key:
              </label>
              <a
                href="https://api.imgbb.com/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-purple-600 hover:text-purple-800 font-bold hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink size={12} /> Lấy API Key miễn phí tại api.imgbb.com
              </a>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Dán mã API Key ImgBB (VD: 98a76bc45e2...)"
                value={imgbbKey}
                onChange={e => setImgbbKeyState(e.target.value)}
                className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-purple-600 focus:bg-white transition-colors"
              />
              <button
                type="button"
                onClick={handleTestImgbb}
                disabled={isTesting || !imgbbKey.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-xs"
                title="Kiểm tra kết nối thử tải ảnh"
              >
                {isTesting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {isTesting ? "Đang thử..." : "Kiểm tra"}
              </button>
              <button
                type="button"
                onClick={handleSaveImgbb}
                className="px-4 py-2 bg-slate-800 hover:bg-black text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-xs"
              >
                Lưu
              </button>
            </div>

            {isConfigured && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleClearKey}
                  className="text-xs text-red-500 hover:text-red-700 hover:underline font-bold inline-flex items-center gap-1 py-1"
                >
                  <Trash2 size={12} /> Xóa API Key khỏi trình duyệt
                </button>
              </div>
            )}
          </div>

          {/* Kết quả kiểm tra */}
          {testResult && (
            <div className={`p-3.5 rounded-2xl text-xs font-medium border animate-fade-in ${
              testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                ) : (
                  <XCircle size={16} className="text-red-600 shrink-0" />
                )}
                <span className="font-bold">{testResult.message}</span>
              </div>
              {testResult.url && (
                <div className="mt-2 pt-2 border-t border-emerald-200/60 flex items-center gap-2">
                  <span className="text-slate-500 text-[11px]">Link ảnh thử:</span>
                  <a 
                    href={testResult.url} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="font-mono text-[11px] text-blue-600 underline truncate hover:text-blue-800"
                  >
                    {testResult.url}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Hướng dẫn 3 bước lấy key */}
          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
            <p className="font-black text-xs uppercase text-slate-700 tracking-wider flex items-center gap-1.5">
              <Info size={14} className="text-blue-500" /> Cách lấy ImgBB API Key (Chỉ mất 30 giây):
            </p>
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">1</span>
                <span>Bấm vào liên kết <a href="https://api.imgbb.com/" target="_blank" rel="noreferrer" className="text-purple-600 font-bold underline">api.imgbb.com</a> (mở tab mới).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">2</span>
                <span>Đăng nhập hoặc đăng ký tài khoản miễn phí (có thể chọn đăng nhập nhanh bằng Google).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">3</span>
                <span>Bấm nút xanh <b>Get API key</b>, sao chép mã và dán vào ô bên trên rồi bấm <b>Lưu</b>.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[11px] text-slate-400 font-medium">
            Nếu chưa nhập Key, ảnh vẫn được nén Base64 an toàn trong đề thi.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md active:scale-95"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default StorageConfigModal;
