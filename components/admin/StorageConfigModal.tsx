import React, { useState, useEffect } from 'react';
import { 
  Sparkles, Check, X, Loader2, ExternalLink, 
  RefreshCw, Key, CheckCircle2, XCircle, Info, Image as ImageIcon, Trash2,
  Database, UploadCloud, HardDrive, ShieldCheck, Zap
} from 'lucide-react';
import { 
  getImgBBKey, 
  setImgBBKey, 
  uploadBlobToImgBB,
  getImageStorageTarget,
  setImageStorageTarget,
  ImageStorageTarget,
  uploadImageToSupabaseStorage
} from '../../services/storage';
import { isSupabaseConnected } from '../../services/supabaseService';

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
  const [activeTarget, setActiveTarget] = useState<ImageStorageTarget>(() => getImageStorageTarget());
  const [imgbbKey, setImgbbKeyState] = useState(() => getImgBBKey());
  const [isTestingImgbb, setIsTestingImgbb] = useState(false);
  const [testResultImgbb, setTestResultImgbb] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  const [isTestingSupabase, setIsTestingSupabase] = useState(false);
  const [testResultSupabase, setTestResultSupabase] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const isSupabaseReady = isSupabaseConnected();

  useEffect(() => {
    if (isOpen) {
      setActiveTarget(getImageStorageTarget());
      setImgbbKeyState(getImgBBKey());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectTarget = (target: ImageStorageTarget) => {
    setActiveTarget(target);
    setImageStorageTarget(target);
    setSaveStatus(`Đã đổi nơi lưu ảnh mặc định sang: ${target === 'supabase' ? 'Supabase Store' : target === 'imgbb' ? 'ImgBB' : 'Base64'}`);
    setTimeout(() => setSaveStatus(null), 3000);
    if (onStorageUpdated) onStorageUpdated();
  };

  const handleSaveImgbb = () => {
    const trimmed = imgbbKey.trim();
    setImgBBKey(trimmed);
    setSaveStatus('Đã lưu ImgBB API Key thành công!');
    setTimeout(() => setSaveStatus(null), 3000);
    if (onStorageUpdated) onStorageUpdated();
  };

  const handleClearKey = () => {
    setImgbbKeyState('');
    setImgBBKey('');
    setTestResultImgbb(null);
    setSaveStatus('Đã xóa ImgBB API Key!');
    setTimeout(() => setSaveStatus(null), 3000);
    if (onStorageUpdated) onStorageUpdated();
  };

  const handleTestImgbb = async () => {
    const key = imgbbKey.trim();
    if (!key) {
      alert('Vui lòng nhập ImgBB API Key trước khi kiểm tra!');
      return;
    }
    setIsTestingImgbb(true);
    setTestResultImgbb(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#9333ea';
        ctx.fillRect(0, 0, 4, 4);
      }
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg'));
      if (!blob) throw new Error('Không thể tạo ảnh kiểm tra');

      const url = await uploadBlobToImgBB(blob, key);
      setTestResultImgbb({
        success: true,
        message: 'Kết nối ImgBB API thành công! Ảnh thử nghiệm đã được lưu trực tuyến.',
        url
      });
      setImgBBKey(key);
      if (onStorageUpdated) onStorageUpdated();
    } catch (err: any) {
      setTestResultImgbb({
        success: false,
        message: err?.message || 'Kiểm tra thất bại. Vui lòng kiểm tra lại tính chính xác của API Key.'
      });
    } finally {
      setIsTestingImgbb(false);
    }
  };

  const handleTestSupabaseStorage = async () => {
    setIsTestingSupabase(true);
    setTestResultSupabase(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#059669';
        ctx.fillRect(0, 0, 4, 4);
      }
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('Không thể tạo ảnh kiểm tra');

      const url = await uploadImageToSupabaseStorage(blob, 'png');
      if (!url) {
        throw new Error('Supabase Storage không trả về URL công khai. Vui lòng kiểm tra bucket "quiz-images".');
      }
      setTestResultSupabase({
        success: true,
        message: 'Kết nối Supabase Storage thành công! Bucket "quiz-images" hoạt động hoàn hảo.',
        url
      });
    } catch (err: any) {
      setTestResultSupabase({
        success: false,
        message: err?.message || 'Không thể tải ảnh lên Supabase Storage.'
      });
    } finally {
      setIsTestingSupabase(false);
    }
  };

  const isImgbbConfigured = Boolean(imgbbKey.trim());

  return (
    <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-white max-w-2xl w-full rounded-[2rem] border-4 border-white shadow-2xl overflow-hidden flex flex-col max-h-[94vh] animate-scale-up">
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-md shadow-blue-200">
              <Sparkles size={22} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">
                Cấu hình Lưu trữ Hình ảnh Đề thi
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Lựa chọn nơi lưu ảnh linh hoạt: Supabase Store, ImgBB hoặc Base64
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
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 text-sm">
          {saveStatus && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 animate-fade-in">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              <span>{saveStatus}</span>
            </div>
          )}

          {/* Chọn nơi lưu trữ chính (3 LỰA CHỌN) */}
          <div className="space-y-3">
            <label className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5">
              <span>Nơi lưu trữ ảnh mặc định của bạn:</span>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Card 1: Supabase Store */}
              <div
                onClick={() => handleSelectTarget('supabase')}
                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between space-y-3 relative ${
                  activeTarget === 'supabase'
                    ? 'border-emerald-600 bg-emerald-50/60 shadow-md ring-2 ring-emerald-600/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                {activeTarget === 'supabase' && (
                  <span className="absolute top-2.5 right-2.5 px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black uppercase rounded-md shadow-xs">
                    Đang chọn
                  </span>
                )}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                      <Database size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black uppercase text-slate-900">Store Supabase</h4>
                      <span className="text-[10px] text-emerald-700 font-bold block">Bucket `quiz-images`</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 font-medium leading-relaxed mt-2">
                    <b>Khuyên dùng cho kho lưu trữ lâu dài.</b> Lưu trực tiếp trên đám mây Supabase an toàn tuyệt đối, không lo tài khoản miễn phí bị tự động xóa ảnh.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-bold">Trạng thái:</span>
                  <span className={`font-black ${isSupabaseReady ? 'text-emerald-700' : 'text-amber-600'}`}>
                    {isSupabaseReady ? '● Đã kết nối' : '○ Chưa kết nối'}
                  </span>
                </div>
              </div>

              {/* Card 2: ImgBB */}
              <div
                onClick={() => handleSelectTarget('imgbb')}
                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between space-y-3 relative ${
                  activeTarget === 'imgbb'
                    ? 'border-purple-600 bg-purple-50/60 shadow-md ring-2 ring-purple-600/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                {activeTarget === 'imgbb' && (
                  <span className="absolute top-2.5 right-2.5 px-2 py-0.5 bg-purple-600 text-white text-[9px] font-black uppercase rounded-md shadow-xs">
                    Đang chọn
                  </span>
                )}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
                      <UploadCloud size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black uppercase text-slate-900">ImgBB API</h4>
                      <span className="text-[10px] text-purple-700 font-bold block">Đám mây miễn phí</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 font-medium leading-relaxed mt-2">
                    <b>Thích hợp cho đề cần thi liền.</b> Tải ảnh cực nhanh lên máy chủ ngoài ImgBB qua API Key cá nhân, giúp đề thi tải siêu tốc cho học sinh làm ngay.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-bold">API Key:</span>
                  <span className={`font-black ${isImgbbConfigured ? 'text-purple-700' : 'text-slate-400'}`}>
                    {isImgbbConfigured ? '● Đã cài đặt' : '○ Chưa nhập'}
                  </span>
                </div>
              </div>

              {/* Card 3: Base64 */}
              <div
                onClick={() => handleSelectTarget('base64')}
                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between space-y-3 relative ${
                  activeTarget === 'base64'
                    ? 'border-blue-600 bg-blue-50/60 shadow-md ring-2 ring-blue-600/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                {activeTarget === 'base64' && (
                  <span className="absolute top-2.5 right-2.5 px-2 py-0.5 bg-blue-600 text-white text-[9px] font-black uppercase rounded-md shadow-xs">
                    Đang chọn
                  </span>
                )}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                      <HardDrive size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black uppercase text-slate-900">Nhúng Base64</h4>
                      <span className="text-[10px] text-blue-700 font-bold block">Trực tiếp trong đề</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 font-medium leading-relaxed mt-2">
                    <b>Bền vững & vĩnh viễn 100%.</b> Mã hóa ảnh trực tiếp vào nội dung câu hỏi. Hoạt động offline, không bao giờ bị xóa, không phụ thuộc vào bất kỳ dịch vụ ngoài nào.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-bold">Máy chủ:</span>
                  <span className="font-black text-blue-700">● Luôn sẵn sàng</span>
                </div>
              </div>
            </div>
          </div>

          {/* Cấu hình chi tiết ImgBB API Key */}
          <div className="p-4 rounded-2xl border border-purple-200 bg-purple-50/30 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase text-purple-950 tracking-wide flex items-center gap-1.5">
                <Key size={14} className="text-purple-600" /> Cấu hình ImgBB API Key:
              </label>
              <a
                href="https://api.imgbb.com/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-purple-600 hover:text-purple-800 font-bold hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink size={12} /> Lấy key miễn phí tại api.imgbb.com
              </a>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Dán mã API Key ImgBB (VD: 98a76bc45e2...)"
                value={imgbbKey}
                onChange={e => setImgbbKeyState(e.target.value)}
                className="flex-1 bg-white border-2 border-slate-200 rounded-xl px-4 py-2 text-xs font-mono outline-none focus:border-purple-600 transition-colors"
              />
              <button
                type="button"
                onClick={handleTestImgbb}
                disabled={isTestingImgbb || !imgbbKey.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-xs shrink-0"
                title="Kiểm tra kết nối thử tải ảnh"
              >
                {isTestingImgbb ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {isTestingImgbb ? "Đang thử..." : "Kiểm tra ImgBB"}
              </button>
              <button
                type="button"
                onClick={handleSaveImgbb}
                className="px-4 py-2 bg-slate-800 hover:bg-black text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-xs shrink-0"
              >
                Lưu Key
              </button>
            </div>

            {isImgbbConfigured && (
              <div className="flex justify-between items-center pt-1 text-[11px]">
                <span className="text-slate-500 font-medium">Khuyến cáo: Tài khoản ImgBB miễn phí có thể xoá ảnh sau 1 thời gian dài. Bạn có thể chọn Store Supabase hoặc Base64 cho đề quan trọng.</span>
                <button
                  type="button"
                  onClick={handleClearKey}
                  className="text-red-500 hover:text-red-700 hover:underline font-bold inline-flex items-center gap-1 shrink-0 ml-2"
                >
                  <Trash2 size={12} /> Xóa Key
                </button>
              </div>
            )}

            {testResultImgbb && (
              <div className={`p-3 rounded-xl text-xs font-medium border animate-fade-in ${
                testResultImgbb.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                <div className="flex items-center gap-2">
                  {testResultImgbb.success ? <CheckCircle2 size={15} className="text-emerald-600" /> : <XCircle size={15} className="text-red-600" />}
                  <span className="font-bold">{testResultImgbb.message}</span>
                </div>
              </div>
            )}
          </div>

          {/* Kiểm tra Supabase Storage */}
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/30 flex items-center justify-between gap-3">
            <div>
              <h5 className="text-xs font-black uppercase text-emerald-950 flex items-center gap-1.5">
                <Database size={14} className="text-emerald-600" /> Kiểm tra Supabase Storage (quiz-images)
              </h5>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                Thử nghiệm tải và tạo URL ảnh công khai trên bucket `quiz-images` của CSDL Supabase
              </p>
            </div>
            <button
              type="button"
              onClick={handleTestSupabaseStorage}
              disabled={isTestingSupabase || !isSupabaseReady}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-xs shrink-0"
            >
              {isTestingSupabase ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              {isTestingSupabase ? "Đang thử..." : "Thử Supabase"}
            </button>
          </div>

          {testResultSupabase && (
            <div className={`p-3 rounded-xl text-xs font-medium border animate-fade-in ${
              testResultSupabase.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              <div className="flex items-center gap-2">
                {testResultSupabase.success ? <CheckCircle2 size={15} className="text-emerald-600" /> : <XCircle size={15} className="text-red-600" />}
                <span className="font-bold">{testResultSupabase.message}</span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[11px] text-slate-400 font-medium">
            Lựa chọn sẽ được áp dụng tự động cho Trình soạn thảo câu hỏi & Bộ bóc tách ảnh PDF.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md active:scale-95"
          >
            Hoàn tất & Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default StorageConfigModal;
