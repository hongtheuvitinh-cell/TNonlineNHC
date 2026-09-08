import React, { useState, useEffect } from 'react';
import { 
  Cloud, HardDrive, Check, AlertTriangle, X, Loader2, ExternalLink, 
  RefreshCw, Key, Settings, Sparkles, CheckCircle2, XCircle, Copy, Info
} from 'lucide-react';
import { 
  testStorageConnection, 
  getImgBBKey, 
  setImgBBKey, 
  uploadBlobToImgBB 
} from '../../services/storage';
import firebaseConfig from '../../firebase-applet-config.json';

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
  const [activeTab, setActiveTab] = useState<'firebase' | 'imgbb'>('firebase');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    status: 'active' | 'not_found' | 'unauthorized' | 'error';
    message: string;
    bucket: string;
    url?: string;
  } | null>(null);

  // Custom bucket state
  const defaultBucket = firebaseConfig.storageBucket || `${firebaseConfig.projectId}.firebasestorage.app`;
  const [customBucket, setCustomBucket] = useState(() => {
    return localStorage.getItem('eduquiz_custom_storage_bucket') || '';
  });

  // ImgBB state
  const [imgbbKey, setImgbbKeyState] = useState(() => getImgBBKey());
  const [isTestingImgbb, setIsTestingImgbb] = useState(false);
  const [imgbbTestResult, setImgbbTestResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  const [copiedRule, setCopiedRule] = useState(false);

  // Chạy kiểm tra kết nối ngay khi mở modal
  useEffect(() => {
    if (isOpen) {
      handleTestFirebase();
    }
  }, [isOpen]);

  const handleTestFirebase = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testStorageConnection(customBucket || undefined);
      setTestResult(res);
      if (res.success && onStorageUpdated) {
        onStorageUpdated();
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        status: 'error',
        bucket: customBucket || defaultBucket,
        message: err?.message || 'Không thể kiểm tra kết nối'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveCustomBucket = () => {
    const trimmed = customBucket.trim();
    if (trimmed) {
      localStorage.setItem('eduquiz_custom_storage_bucket', trimmed);
    } else {
      localStorage.removeItem('eduquiz_custom_storage_bucket');
    }
    handleTestFirebase();
  };

  const handleSaveImgbb = () => {
    setImgBBKey(imgbbKey);
    alert('Đã lưu cấu hình ImgBB API Key!');
    if (onStorageUpdated) onStorageUpdated();
  };

  const handleTestImgbb = async () => {
    const key = imgbbKey.trim();
    if (!key) {
      alert('Vui lòng nhập ImgBB API Key trước khi kiểm tra!');
      return;
    }
    setIsTestingImgbb(true);
    setImgbbTestResult(null);
    try {
      // Tạo một ảnh test 1x1 pixel JPEG
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(0, 0, 2, 2);
      }
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg'));
      if (!blob) throw new Error('Không thể tạo ảnh kiểm tra');

      const url = await uploadBlobToImgBB(blob, key);
      setImgbbTestResult({
        success: true,
        message: 'Kết nối ImgBB API thành công! Ảnh thử nghiệm đã được lưu trực tuyến.',
        url
      });
      setImgBBKey(key);
      if (onStorageUpdated) onStorageUpdated();
    } catch (err: any) {
      setImgbbTestResult({
        success: false,
        message: err?.message || 'Kiểm tra thất bại. Vui lòng kiểm tra lại API Key.'
      });
    } finally {
      setIsTestingImgbb(false);
    }
  };

  const storageRuleContent = `rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} {\n      allow read, write: if true;\n    }\n  }\n}`;

  const handleCopyRule = () => {
    navigator.clipboard.writeText(storageRuleContent);
    setCopiedRule(true);
    setTimeout(() => setCopiedRule(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white max-w-2xl w-full rounded-3xl border-4 border-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-scale-up">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-md shadow-blue-200">
              <Cloud size={24} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">
                Cấu hình Lưu trữ Ảnh Đề thi (Cloud Storage)
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Dự án Firebase: <code className="bg-slate-200/80 px-1.5 py-0.5 rounded text-[11px] font-mono font-bold text-slate-800">{firebaseConfig.projectId}</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('firebase')}
            className={`px-4 py-2.5 rounded-t-xl font-bold text-xs uppercase flex items-center gap-2 border-t-2 transition-all ${
              activeTab === 'firebase'
                ? 'bg-white border-blue-600 text-blue-700 shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Cloud size={14} /> Firebase Cloud Storage (Chính thức)
            {testResult?.success && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('imgbb')}
            className={`px-4 py-2.5 rounded-t-xl font-bold text-xs uppercase flex items-center gap-2 border-t-2 transition-all ${
              activeTab === 'imgbb'
                ? 'bg-white border-purple-600 text-purple-700 shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Sparkles size={14} /> ImgBB API (Dự phòng miễn phí)
            {imgbbKey && (
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {activeTab === 'firebase' && (
            <div className="space-y-5">
              {/* Box Trạng thái kiểm tra */}
              <div className="p-4 rounded-2xl border bg-slate-50 border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase text-slate-500 tracking-wider">
                      Trạng thái kết nối:
                    </span>
                    {isTesting ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                        <Loader2 size={12} className="animate-spin" /> Đang kiểm tra...
                      </span>
                    ) : testResult?.success ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                        <CheckCircle2 size={13} className="text-emerald-600" /> Sẵn sàng hoạt động (Đã kết nối)
                      </span>
                    ) : testResult?.status === 'not_found' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-lg border border-red-200">
                        <XCircle size={13} className="text-red-600" /> Chưa kích hoạt Storage (Lỗi 404)
                      </span>
                    ) : testResult?.status === 'unauthorized' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                        <AlertTriangle size={13} className="text-amber-600" /> Chặn quyền ghi (Lỗi 403)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-200/80 px-2.5 py-1 rounded-lg">
                        Chưa kiểm tra
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleTestFirebase}
                    disabled={isTesting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={isTesting ? "animate-spin" : ""} />
                    {isTesting ? "Đang thử..." : "Kiểm tra lại"}
                  </button>
                </div>

                <p className="text-xs text-slate-600">
                  Storage Bucket hiện tại: <code className="font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded border">{customBucket || defaultBucket}</code>
                </p>

                {testResult && !testResult.success && (
                  <div className={`p-3 rounded-xl text-xs font-medium border ${
                    testResult.status === 'not_found' ? 'bg-red-50/80 border-red-200 text-red-800' : 'bg-amber-50/80 border-amber-200 text-amber-800'
                  }`}>
                    {testResult.message}
                  </div>
                )}
              </div>

              {/* Hướng dẫn khi chưa kích hoạt hoặc bị lỗi */}
              {(!testResult?.success || testResult?.status === 'not_found' || testResult?.status === 'unauthorized') && (
                <div className="p-5 rounded-2xl border-2 border-blue-100 bg-blue-50/40 space-y-4">
                  <div className="flex items-center gap-2 text-blue-900 font-black text-sm uppercase">
                    <Info size={16} className="text-blue-600" />
                    Hướng dẫn bật Firebase Storage (Chỉ mất 1 phút)
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Dự án Firebase đã được tạo nhưng dịch vụ <b>Firebase Cloud Storage</b> chưa được kích hoạt nút <b>Bắt đầu</b> trong bảng điều khiển Firebase Console. Khi chưa bật, hệ thống không thể tạo link online và sẽ nén ảnh thành Base64 dự phòng.
                  </p>

                  <div className="space-y-3 text-xs">
                    {/* Bước 1 */}
                    <div className="flex items-start gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0">1</span>
                      <div className="space-y-1.5 flex-1">
                        <p className="font-bold text-slate-800">Mở trang Quản lý Storage của dự án:</p>
                        <a
                          href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/storage`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-black transition-all shadow-xs"
                        >
                          <ExternalLink size={13} /> Mở Firebase Storage Console
                        </a>
                      </div>
                    </div>

                    {/* Bước 2 */}
                    <div className="flex items-start gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0">2</span>
                      <div className="space-y-1">
                        <p className="font-bold text-slate-800">Nhấn nút "Get started" (Bắt đầu):</p>
                        <p className="text-slate-600">
                          Bấm <b>Get started</b> $\rightarrow$ Chọn vị trí máy chủ (khuyên dùng <code>asia-east1</code> hoặc <code>us-central1</code>) $\rightarrow$ Bấm <b>Done (Hoàn tất)</b>.
                        </p>
                      </div>
                    </div>

                    {/* Bước 3 */}
                    <div className="flex items-start gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0">3</span>
                      <div className="space-y-2 flex-1">
                        <p className="font-bold text-slate-800">Cập nhật Rules (Quy tắc cho phép đọc/ghi ảnh):</p>
                        <p className="text-slate-600">
                          Chuyển sang tab <b>Rules</b> trên Firebase Storage, dán đoạn mã sau và bấm <b>Publish</b>:
                        </p>
                        <div className="relative bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-[11px] overflow-x-auto">
                          <pre>{storageRuleContent}</pre>
                          <button
                            type="button"
                            onClick={handleCopyRule}
                            className="absolute top-2 right-2 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-[10px] font-bold flex items-center gap-1 transition-colors"
                          >
                            {copiedRule ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                            {copiedRule ? "Đã copy!" : "Sao chép"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={handleTestFirebase}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-200 transition-all active:scale-95"
                    >
                      Tôi đã bật xong trên Console $\rightarrow$ Kiểm tra lại ngay!
                    </button>
                  </div>
                </div>
              )}

              {/* Tùy chỉnh nâng cao (Đổi tên bucket nếu cần) */}
              <div className="pt-2 border-t border-slate-200">
                <details className="group">
                  <summary className="text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700 flex items-center gap-1 select-none">
                    <Settings size={13} /> Cấu hình nâng cao: Tùy chỉnh tên Bucket Storage
                  </summary>
                  <div className="mt-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-xs">
                    <p className="text-slate-600">
                      Một số dự án Firebase cũ sử dụng đuôi <code>.appspot.com</code> thay vì <code>.firebasestorage.app</code>. Nếu trên Firebase Console tên bucket của bạn có đuôi khác, hãy nhập vào đây:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={defaultBucket}
                        value={customBucket}
                        onChange={e => setCustomBucket(e.target.value)}
                        className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-blue-600"
                      />
                      <button
                        type="button"
                        onClick={handleSaveCustomBucket}
                        className="px-4 py-2 bg-slate-800 hover:bg-black text-white rounded-xl font-bold transition-all"
                      >
                        Lưu & Thử
                      </button>
                    </div>
                    {customBucket && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomBucket('');
                          localStorage.removeItem('eduquiz_custom_storage_bucket');
                          handleTestFirebase();
                        }}
                        className="text-[11px] text-red-600 hover:underline font-bold"
                      >
                        Khôi phục tên mặc định ({defaultBucket})
                      </button>
                    )}
                  </div>
                </details>
              </div>
            </div>
          )}

          {activeTab === 'imgbb' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 text-xs text-purple-900 space-y-2">
                <p className="font-bold flex items-center gap-1.5 text-sm">
                  <Sparkles size={16} className="text-purple-600" /> ImgBB - Giải pháp lưu ảnh siêu tốc miễn phí
                </p>
                <p className="text-slate-600 leading-relaxed">
                  Nếu bạn không muốn vào Firebase Console thiết lập Storage, bạn có thể tạo một API Key miễn phí từ <b>ImgBB</b>. Khi đã nhập key này, mọi hình ảnh bạn dán (Ctrl+V) hoặc tải lên trong đề thi sẽ tự động được đưa lên ImgBB và trả về link ảnh online vĩnh viễn!
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase text-slate-600">
                  Mã ImgBB API Key:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Dán mã API Key ImgBB (VD: 98a76bc45e...)"
                    value={imgbbKey}
                    onChange={e => setImgbbKeyState(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-purple-600 focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleTestImgbb}
                    disabled={isTestingImgbb || !imgbbKey.trim()}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {isTestingImgbb ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {isTestingImgbb ? "Đang thử..." : "Kiểm tra Key"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveImgbb}
                    className="px-4 py-2 bg-slate-800 hover:bg-black text-white rounded-xl text-xs font-bold transition-all"
                  >
                    Lưu
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <a
                    href="https://api.imgbb.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-600 font-bold hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink size={12} /> Lấy ImgBB API Key miễn phí tại api.imgbb.com
                  </a>
                  {imgbbKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setImgbbKeyState('');
                        setImgBBKey('');
                        setImgbbTestResult(null);
                        alert('Đã xóa ImgBB Key!');
                      }}
                      className="text-red-500 hover:underline font-bold"
                    >
                      Xóa Key
                    </button>
                  )}
                </div>
              </div>

              {imgbbTestResult && (
                <div className={`p-3 rounded-xl text-xs font-medium border ${
                  imgbbTestResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  <div className="flex items-center gap-2">
                    {imgbbTestResult.success ? <CheckCircle2 size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-red-600" />}
                    <span>{imgbbTestResult.message}</span>
                  </div>
                  {imgbbTestResult.url && (
                    <p className="mt-1 text-[11px] text-slate-500 font-mono break-all">
                      Link ảnh: {imgbbTestResult.url}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[11px] text-slate-400 font-medium">
            Nếu chưa có Cloud Storage hay ImgBB, ảnh vẫn được nén Base64 an toàn trong đề thi.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md active:scale-95"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default StorageConfigModal;
