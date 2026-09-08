import React, { useState, useRef, useEffect } from 'react';
import { 
  Download, 
  Upload, 
  Database, 
  Server, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Copy, 
  Check, 
  ExternalLink, 
  RefreshCw, 
  FileJson, 
  Layers, 
  Users, 
  BookOpen, 
  HelpCircle, 
  Award, 
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { 
  exportFullDatabaseBackup, 
  restoreFullDatabaseBackup,
  getActiveDatabaseProvider,
  setActiveDatabaseProvider,
  DatabaseProvider
} from '../../services/storage';
import { 
  getSavedSupabaseConfig, 
  saveSupabaseConfig, 
  testSupabaseConnection, 
  migrateJsonToSupabase, 
  SUPABASE_SCHEMA_SQL,
  MigrationProgress,
  MigrationSummary,
  TableStatus
} from '../../services/supabaseMigration';

interface BackupMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowAlert?: (title: string, message: string, type: 'info' | 'warning' | 'error' | 'success') => void;
  onShowConfirm?: (title: string, message: string, onConfirm: () => void) => void;
}

export default function BackupMigrationModal({
  isOpen,
  onClose,
  onShowAlert: rawShowAlert,
  onShowConfirm
}: BackupMigrationModalProps) {
  const onShowAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' | 'success' | 'danger' = 'info') => {
    const finalType = type === 'danger' ? 'error' : type;
    rawShowAlert?.(title, message, finalType);
  };
  const [activeTab, setActiveTab] = useState<'json' | 'supabase'>('json');

  // Trạng thái sao lưu (Export JSON)
  const [isExporting, setIsExporting] = useState(false);

  // Trạng thái khôi phục (Restore JSON vào Firestore)
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [parsedBackupData, setParsedBackupData] = useState<any | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{ step: string; percent: number }>({ step: '', percent: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Trạng thái Supabase
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [isTestingSupabase, setIsTestingSupabase] = useState(false);
  const [supabaseTestStatus, setSupabaseTestStatus] = useState<{ 
    success: boolean; 
    message: string; 
    latencyMs?: number;
    tables?: TableStatus[];
  } | null>(null);
  const [isCopiedSql, setIsCopiedSql] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<DatabaseProvider>('supabase');

  // Trạng thái nạp dữ liệu sang Supabase
  const [migrationFile, setMigrationFile] = useState<File | null>(null);
  const [parsedMigrationData, setParsedMigrationData] = useState<any | null>(null);
  const [useDirectFirestore, setUseDirectFirestore] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress>({ step: '', detail: '', percent: 0 });
  const [migrationResult, setMigrationResult] = useState<MigrationSummary | null>(null);
  const migrationFileInputRef = useRef<HTMLInputElement>(null);

  // Nạp cấu hình Supabase đã lưu và kiểm tra tự động
  useEffect(() => {
    if (isOpen) {
      const saved = getSavedSupabaseConfig();
      const url = saved.url || '';
      const key = saved.anonKey || '';
      setSupabaseUrl(url);
      setSupabaseKey(key);
      setCurrentProvider(getActiveDatabaseProvider());

      if (url && key) {
        setIsTestingSupabase(true);
        testSupabaseConnection(url, key)
          .then(res => setSupabaseTestStatus(res))
          .catch(() => {})
          .finally(() => setIsTestingSupabase(false));
      }
    }
  }, [isOpen]);

  const handleToggleProvider = (newProvider: DatabaseProvider) => {
    setActiveDatabaseProvider(newProvider);
    setCurrentProvider(newProvider);
    const label = newProvider === 'dual' 
      ? 'Chế độ Song song (Supabase + Đồng bộ Firebase)' 
      : (newProvider === 'supabase' ? 'Chỉ dùng Supabase (PostgreSQL)' : 'Chỉ dùng Firebase (Cloud Firestore)');
    onShowAlert?.(
      "Đã chuyển chế độ CSDL!", 
      `Hệ thống hiện đang hoạt động với: ${label}.`,
      "success"
    );
  };

  if (!isOpen) return null;

  // 1. Xử lý Xuất file JSON
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const jsonStr = await exportFullDatabaseBackup();
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `EduQuiz_Backup_Full_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      onShowAlert?.(
        "Sao lưu thành công!", 
        "Đã tạo và tải về file bản sao lưu JSON toàn bộ CSDL (Đề thi, Ngân hàng câu hỏi, Người dùng, Lớp học, Kết quả). Bạn có thể dùng file này để nạp sang Supabase!", 
        "success"
      );
    } catch (err: any) {
      onShowAlert?.("Lỗi sao lưu", err.message || "Không thể xuất file sao lưu.", "danger");
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Xử lý Chọn file JSON để khôi phục vào Firestore
  const handleSelectRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setParsedBackupData(parsed);
      } catch (err: any) {
        onShowAlert?.("File JSON không hợp lệ", "Không thể phân tích nội dung file JSON này. Vui lòng kiểm tra lại định dạng file.", "danger");
        setRestoreFile(null);
        setParsedBackupData(null);
      }
    };
    reader.readAsText(file);
  };

  // 3. Thực hiện Khôi phục vào Firestore
  const handleStartRestore = () => {
    if (!parsedBackupData) return;

    const data = parsedBackupData.data || parsedBackupData;
    const stats = {
      quizzes: (data.quizzes || []).length,
      bank: (data.bankQuestions || data.bank_questions || []).length,
      users: (data.users || []).length,
      classes: (data.classes || []).length
    };

    const confirmMsg = `Bạn có chắc muốn khôi phục CSDL Firestore từ file JSON?\n\n` +
      `- Đề thi: ${stats.quizzes}\n` +
      `- Ngân hàng câu hỏi: ${stats.bank}\n` +
      `- Người dùng: ${stats.users}\n` +
      `- Lớp học: ${stats.classes}\n\n` +
      `Lưu ý: Dữ liệu trùng ID sẽ được cập nhật/ghi đè.`;

    const runRestore = async () => {
      setIsRestoring(true);
      setRestoreProgress({ step: 'Bắt đầu chuẩn bị khôi phục...', percent: 5 });
      try {
        const result = await restoreFullDatabaseBackup(parsedBackupData, (step, percent) => {
          setRestoreProgress({ step, percent });
        });
        onShowAlert?.("Khôi phục hoàn tất!", result.message, "success");
        setRestoreFile(null);
        setParsedBackupData(null);
      } catch (err: any) {
        onShowAlert?.("Lỗi khôi phục", err.message || "Quá trình khôi phục thất bại.", "danger");
      } finally {
        setIsRestoring(false);
      }
    };

    if (onShowConfirm) {
      onShowConfirm("Xác nhận khôi phục CSDL", confirmMsg, runRestore);
    } else if (window.confirm(confirmMsg)) {
      runRestore();
    }
  };

  // 4. Kiểm tra kết nối Supabase
  const handleTestSupabase = async () => {
    if (!supabaseUrl.trim() || !supabaseKey.trim()) {
      onShowAlert?.("Thiếu thông tin", "Vui lòng nhập đầy đủ Supabase Project URL và Public Anon Key.", "warning");
      return;
    }

    setIsTestingSupabase(true);
    setSupabaseTestStatus(null);
    try {
      const res = await testSupabaseConnection(supabaseUrl, supabaseKey);
      setSupabaseTestStatus(res);
      if (res.success) {
        saveSupabaseConfig({ url: supabaseUrl, anonKey: supabaseKey });
      }
    } catch (err: any) {
      setSupabaseTestStatus({ success: false, message: err.message || "Không thể kết nối" });
    } finally {
      setIsTestingSupabase(false);
    }
  };

  // 5. Sao chép SQL tạo bảng Supabase
  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
    setIsCopiedSql(true);
    setTimeout(() => setIsCopiedSql(false), 2500);
    onShowAlert?.("Đã sao chép!", "Toàn bộ đoạn mã SQL tạo bảng Supabase đã được lưu vào clipboard. Bạn chỉ cần dán (Ctrl+V) vào mục SQL Editor trên trang quản trị Supabase và bấm RUN.", "success");
  };

  // 6. Xử lý Chọn file JSON để nạp vào Supabase
  const handleSelectMigrationFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMigrationFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setParsedMigrationData(parsed);
      } catch (err: any) {
        onShowAlert?.("File JSON không hợp lệ", "Không thể đọc nội dung file JSON này.", "danger");
        setMigrationFile(null);
        setParsedMigrationData(null);
      }
    };
    reader.readAsText(file);
  };

  // 7. Bắt đầu Chuyển dữ liệu sang Supabase
  const handleStartMigration = async () => {
    if (!supabaseUrl.trim() || !supabaseKey.trim()) {
      onShowAlert?.("Chưa điền thông tin Supabase", "Vui lòng nhập Supabase URL và Public Anon Key ở Bước 2 trước.", "warning");
      return;
    }

    let dataToMigrate: any = null;

    if (useDirectFirestore) {
      try {
        setIsMigrating(true);
        setMigrationProgress({ step: "exporting", detail: "Đang tải dữ liệu từ Firestore...", percent: 5 });
        const jsonStr = await exportFullDatabaseBackup();
        dataToMigrate = JSON.parse(jsonStr);
      } catch (err: any) {
        setIsMigrating(false);
        onShowAlert?.("Lỗi đọc Firestore", "Không thể trích xuất dữ liệu từ Firestore (có thể do đã hết quota 50.000 lượt đọc). Vui lòng chọn cách nạp bằng File JSON sao lưu!", "danger");
        return;
      }
    } else {
      if (!parsedMigrationData) {
        onShowAlert?.("Chưa chọn file JSON", "Vui lòng tải lên file JSON bản sao lưu đã xuất trước đó để tiến hành nạp sang Supabase.", "warning");
        return;
      }
      dataToMigrate = parsedMigrationData;
    }

    // Lưu lại config Supabase
    saveSupabaseConfig({ url: supabaseUrl, anonKey: supabaseKey });

    setIsMigrating(true);
    setMigrationResult(null);
    try {
      const res = await migrateJsonToSupabase(supabaseUrl, supabaseKey, dataToMigrate, (progress) => {
        setMigrationProgress(progress);
      });

      if (res.success && res.summary) {
        setMigrationResult(res.summary);
        onShowAlert?.(
          "Chuyển đổi thành công!", 
          `Đã chuyển toàn bộ dữ liệu sang Supabase hoàn tất:\n` +
          `- ${res.summary.quizzes} Đề thi\n` +
          `- ${res.summary.bankQuestions} Câu hỏi ngân hàng\n` +
          `- ${res.summary.users} Người dùng\n` +
          `- ${res.summary.classes} Lớp học\n` +
          `- ${res.summary.results} Kết quả bài thi`,
          "success"
        );
      } else {
        onShowAlert?.("Lỗi chuyển đổi", res.message || "Quá trình nạp dữ liệu vào Supabase gặp lỗi.", "danger");
      }
    } catch (err: any) {
      onShowAlert?.("Lỗi di chuyển dữ liệu", err.message || "Thao tác thất bại.", "danger");
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-8 flex flex-col max-h-[92vh]">
        
        {/* Header Modal */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Database size={20} />
            </div>
            <div>
              <h3 className="font-black text-lg text-white">Trung tâm Sao lưu, Khôi phục & Chuyển đổi CSDL</h3>
              <p className="text-xs text-indigo-200 font-medium">Xuất / Nhập JSON an toàn & Di chuyển dữ liệu sang Supabase (Không giới hạn reads)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50/80 px-6 pt-3 gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('json')}
            className={`flex items-center gap-2 pb-3 px-4 font-black text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'json'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileJson size={16} />
            <span>Sao lưu & Khôi phục (File JSON)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('supabase')}
            className={`flex items-center gap-2 pb-3 px-4 font-black text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'supabase'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Server size={16} />
            <span className="flex items-center gap-1.5">
              <span>Chuyển sang Supabase</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-100 text-emerald-800 font-black">Khuyên dùng</span>
            </span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* TAB 1: SAO LƯU & KHÔI PHỤC JSON */}
          {activeTab === 'json' && (
            <div className="space-y-6">
              
              {/* Card Xuất JSON */}
              <div className="bg-emerald-50/60 rounded-2xl border border-emerald-200 p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px] uppercase tracking-wider">
                      <Download size={12} />
                      <span>Bước 1: Xuất bản sao lưu</span>
                    </div>
                    <h4 className="font-black text-slate-800 text-base">Tải về toàn bộ CSDL dạng file JSON</h4>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                      File JSON xuất ra bao gồm <strong>100% dữ liệu</strong>: Đề thi, Toàn bộ câu hỏi & lời giải, Ngân hàng câu hỏi tập trung, 
                      Danh mục Lớp học, Chương bài giảng, Tài khoản người dùng (Giáo viên, Học sinh) và Kết quả làm bài.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 shrink-0"
                  >
                    <Download size={16} className={isExporting ? 'animate-bounce' : ''} />
                    <span>{isExporting ? 'Đang trích xuất CSDL...' : 'Tải file JSON sao lưu'}</span>
                  </button>
                </div>
              </div>

              {/* Card Nhập / Khôi phục từ JSON */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-black text-[10px] uppercase tracking-wider">
                    <Upload size={12} />
                    <span>Bước 2: Khôi phục vào Firestore (Tùy chọn)</span>
                  </div>
                  <h4 className="font-black text-slate-800 text-base">Nạp / Phục hồi dữ liệu từ file JSON vào Cloud Firestore</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Dùng khi bạn muốn khôi phục lại dữ liệu cũ, chuyển dữ liệu sang một dự án Firebase khác, hoặc nạp lại sau khi định mức 50,000 lượt đọc được reset.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleSelectRestoreFile}
                    accept=".json,application/json"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRestoring}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-black text-xs uppercase transition-all shadow-sm"
                  >
                    <Upload size={15} className="text-blue-600" />
                    <span>{restoreFile ? 'Chọn file JSON khác' : 'Chọn file JSON từ máy tính'}</span>
                  </button>

                  {restoreFile && (
                    <span className="text-xs font-bold text-slate-700 truncate max-w-xs bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                      Đã chọn: {restoreFile.name} ({(restoreFile.size / 1024).toFixed(1)} KB)
                    </span>
                  )}
                </div>

                {/* Thông tin bản xem trước dữ liệu trong file JSON */}
                {parsedBackupData && (
                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 animate-fade-in">
                    <h5 className="font-black text-xs text-slate-700 uppercase tracking-wider flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      <span>Thông tin dữ liệu tìm thấy trong file:</span>
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-lg font-black text-blue-600">{(parsedBackupData.data?.quizzes || parsedBackupData.quizzes || []).length}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase">Đề thi</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-lg font-black text-indigo-600">{(parsedBackupData.data?.bankQuestions || parsedBackupData.bankQuestions || []).length}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase">Câu hỏi ngân hàng</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-lg font-black text-emerald-600">{(parsedBackupData.data?.users || parsedBackupData.users || []).length}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase">Người dùng</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-lg font-black text-amber-600">{(parsedBackupData.data?.classes || parsedBackupData.classes || []).length}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase">Lớp học</div>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleStartRestore}
                        disabled={isRestoring}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md transition-all active:scale-95 disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={isRestoring ? 'animate-spin' : ''} />
                        <span>{isRestoring ? 'Đang khôi phục...' : 'Bắt đầu nạp vào Firestore'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Thanh tiến trình khôi phục */}
                {isRestoring && (
                  <div className="space-y-2 p-3 bg-blue-50/80 rounded-xl border border-blue-200">
                    <div className="flex justify-between text-xs font-bold text-blue-900">
                      <span>{restoreProgress.step}</span>
                      <span>{restoreProgress.percent}%</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${restoreProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* TAB 2: CHUYỂN DỮ LIỆU SANG SUPABASE */}
          {activeTab === 'supabase' && (
            <div className="space-y-6">
              
              {/* Giới thiệu Supabase & Bộ chọn động cơ CSDL */}
              <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 text-white p-5 rounded-2xl border border-emerald-800/40 relative overflow-hidden space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5 max-w-2xl relative z-10">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-black text-[10px] uppercase tracking-wider border border-emerald-500/30">
                      <ShieldCheck size={12} />
                      <span>Giải pháp vĩnh viễn không giới hạn 50,000 Reads/ngày</span>
                    </div>
                    <h4 className="font-black text-lg text-white">Chuyển sang Supabase (PostgreSQL)</h4>
                    <p className="text-xs text-emerald-100/80 leading-relaxed">
                      Supabase lưu trữ bảng quan hệ PostgreSQL chuẩn hóa, hỗ trợ hàng triệu truy vấn mỗi tháng ở gói miễn phí, 
                      hoàn toàn loại bỏ lo lắng hết định mức reads giữa chừng khi ngân hàng đề ngày một lớn.
                    </p>
                  </div>

                  {/* Supabase Engine Status */}
                  <div className="bg-white/10 backdrop-blur-md p-3.5 rounded-2xl border border-white/20 shrink-0 space-y-2">
                    <div className="text-[10px] font-black uppercase text-emerald-200 tracking-wider flex items-center gap-1">
                      <CheckCircle2 size={13} className="text-emerald-400" />
                      <span>Động cơ CSDL chính: Supabase</span>
                    </div>
                    <div className="text-xs font-black text-white bg-emerald-700/60 px-3 py-1.5 rounded-xl border border-emerald-500/40 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Supabase (PostgreSQL) - Kích hoạt</span>
                    </div>
                    <div className="text-[10px] text-emerald-200/90 leading-tight">
                      Toàn bộ thao tác Đọc & Ghi được xử lý trực tiếp trên Supabase (0% giới hạn đọc)
                    </div>
                  </div>
                </div>
              </div>

              {/* BƯỚC 1: TẠO BẢNG SUPABASE */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">1</span>
                    <h5 className="font-black text-sm text-slate-800">Chạy Kịch bản SQL tạo bảng trên Supabase</h5>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopySql}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-black transition-all"
                    >
                      {isCopiedSql ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                      <span>{isCopiedSql ? 'Đã sao chép SQL!' : 'Sao chép mã SQL tạo bảng'}</span>
                    </button>
                    <a
                      href="https://supabase.com/dashboard"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-black transition-all"
                    >
                      <span>Mở Supabase</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Vào trang dự án Supabase của bạn &rarr; Mục <strong>SQL Editor</strong> &rarr; Nhấn <strong>New query</strong> &rarr; Dán đoạn mã đã sao chép &rarr; Bấm <strong>Run</strong>. Toàn bộ 8 bảng và chỉ mục tối ưu sẽ được khởi tạo tự động.
                </p>
              </div>

              {/* BƯỚC 2: CẤU HÌNH THÔNG TIN KẾT NỐI */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">2</span>
                  <h5 className="font-black text-sm text-slate-800">Điền thông tin kết nối Supabase của bạn</h5>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black text-slate-700 uppercase">
                      Supabase Project URL:
                    </label>
                    <input
                      type="text"
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      placeholder="https://xyzabcdefg.supabase.co"
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Lấy tại Project Settings &rarr; API &rarr; Project URL</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-black text-slate-700 uppercase">
                      Project API Key (Anon / Public Key):
                    </label>
                    <input
                      type="password"
                      value={supabaseKey}
                      onChange={(e) => setSupabaseKey(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Lấy tại Project Settings &rarr; API &rarr; anon public</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleTestSupabase}
                    disabled={isTestingSupabase || !supabaseUrl || !supabaseKey}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-black uppercase transition-all disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={isTestingSupabase ? 'animate-spin' : ''} />
                    <span>{isTestingSupabase ? 'Đang kiểm tra kết nối...' : 'Kiểm tra kết nối & Bảng CSDL'}</span>
                  </button>

                  {supabaseTestStatus && (
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
                      supabaseTestStatus.success 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {supabaseTestStatus.success ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      <span>{supabaseTestStatus.message}</span>
                    </span>
                  )}
                </div>

                {/* Bảng chi tiết trạng thái từng Table trong CSDL Supabase */}
                {supabaseTestStatus?.tables && supabaseTestStatus.tables.length > 0 && (
                  <div className="pt-2 space-y-2 border-t border-slate-100 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-600" />
                        <span>Trạng thái 8 bảng CSDL trên Supabase:</span>
                      </div>
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        {supabaseTestStatus.tables.filter(t => t.exists).length}/8 Bảng đã sẵn sàng
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {supabaseTestStatus.tables.map(tbl => (
                        <div 
                          key={tbl.name} 
                          className={`p-2.5 rounded-xl border flex flex-col justify-between transition-all ${
                            tbl.exists 
                              ? 'bg-emerald-50/50 border-emerald-200' 
                              : 'bg-rose-50/60 border-rose-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-black text-slate-800 truncate" title={tbl.name}>
                              {tbl.name}
                            </span>
                            {tbl.exists ? (
                              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-black">
                                ✓
                              </span>
                            ) : (
                              <span className="w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[10px] font-black">
                                !
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-medium truncate mt-1">
                            {tbl.label.split('(')[0].trim()}
                          </div>
                          <div className="text-[10px] font-black text-emerald-800 mt-0.5">
                            {tbl.exists ? `${tbl.rows} bản ghi` : 'Chưa tạo'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* BƯỚC 3: NẠP DỮ LIỆU SANG SUPABASE */}
              <div className="bg-emerald-50/50 rounded-2xl border border-emerald-200 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">3</span>
                  <h5 className="font-black text-sm text-slate-800">Chọn nguồn dữ liệu để nạp sang Supabase</h5>
                </div>

                <div className="space-y-3">
                  {/* Lựa chọn 1: Dùng file JSON (Khuyên dùng) */}
                  <label className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-200 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="radio"
                      name="migrationSource"
                      checked={!useDirectFirestore}
                      onChange={() => setUseDirectFirestore(false)}
                      className="mt-1 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="space-y-1">
                      <div className="font-black text-xs text-slate-800 flex items-center gap-2">
                        <span>Nạp từ File JSON sao lưu</span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">Khuyên dùng - 0 Reads</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Sử dụng file JSON bạn đã tải về ở Tab trước. Cách này <strong>hoàn toàn KHÔNG tốn 1 lượt đọc Firestore nào</strong>, 
                        cực kỳ thích hợp khi bạn đã hết hạn mức 50,000 lượt đọc của ngày hôm nay!
                      </p>
                    </div>
                  </label>

                  {/* Lựa chọn 2: Đọc trực tiếp từ Firestore */}
                  <label className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-200 cursor-pointer hover:border-emerald-300 transition-all">
                    <input
                      type="radio"
                      name="migrationSource"
                      checked={useDirectFirestore}
                      onChange={() => setUseDirectFirestore(true)}
                      className="mt-1 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="space-y-1">
                      <div className="font-black text-xs text-slate-800">Đọc trực tiếp từ Firestore hiện tại</div>
                      <p className="text-[11px] text-slate-500">
                        Hệ thống tự đọc toàn bộ dữ liệu trên Firestore và đẩy trực tiếp sang Supabase (Chỉ dùng khi hạn mức reads trong ngày còn đủ).
                      </p>
                    </div>
                  </label>
                </div>

                {/* Chọn file JSON nếu chọn cách 1 */}
                {!useDirectFirestore && (
                  <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                    <input
                      type="file"
                      ref={migrationFileInputRef}
                      onChange={handleSelectMigrationFile}
                      accept=".json,application/json"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => migrationFileInputRef.current?.click()}
                      disabled={isMigrating}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-800 rounded-xl font-black text-xs uppercase transition-all shadow-sm"
                    >
                      <Upload size={15} className="text-emerald-600" />
                      <span>{migrationFile ? 'Chọn file JSON khác' : 'Chọn file JSON sao lưu (.json)'}</span>
                    </button>

                    {migrationFile && (
                      <span className="text-xs font-bold text-emerald-800 truncate max-w-xs bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-200">
                        {migrationFile.name} ({(migrationFile.size / 1024).toFixed(1)} KB)
                      </span>
                    )}
                  </div>
                )}

                {/* Nút bấm bắt đầu chuyển đổi */}
                <div className="pt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleStartMigration}
                    disabled={isMigrating || (!useDirectFirestore && !parsedMigrationData)}
                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-lg transition-all active:scale-95 disabled:opacity-50"
                  >
                    <ArrowRight size={16} className={isMigrating ? 'animate-spin' : ''} />
                    <span>{isMigrating ? 'Đang chuyển đổi sang Supabase...' : 'Bắt đầu nạp toàn bộ dữ liệu sang Supabase'}</span>
                  </button>
                </div>

                {/* Thanh tiến trình chuyển đổi sang Supabase */}
                {isMigrating && (
                  <div className="space-y-2 p-4 bg-emerald-100/70 rounded-xl border border-emerald-300 animate-fade-in">
                    <div className="flex justify-between text-xs font-black text-emerald-950">
                      <span>{migrationProgress.detail || 'Đang xử lý...'}</span>
                      <span>{migrationProgress.percent}%</span>
                    </div>
                    <div className="w-full bg-emerald-200 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-emerald-600 h-3 rounded-full transition-all duration-300 shadow-sm"
                        style={{ width: `${migrationProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Báo cáo tổng kết sau khi nạp xong */}
                {migrationResult && (
                  <div className="bg-white rounded-xl border border-emerald-300 p-4 space-y-3 animate-fade-in">
                    <div className="flex items-center gap-2 text-emerald-700 font-black text-sm">
                      <CheckCircle2 size={18} />
                      <span>Di chuyển dữ liệu sang Supabase thành công 100%!</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center text-xs">
                      <div className="p-2 bg-emerald-50 rounded-lg">
                        <span className="font-black text-emerald-700 text-base">{migrationResult.quizzes}</span>
                        <div className="text-[10px] text-slate-500 font-bold uppercase">Đề thi</div>
                      </div>
                      <div className="p-2 bg-emerald-50 rounded-lg">
                        <span className="font-black text-emerald-700 text-base">{migrationResult.bankQuestions}</span>
                        <div className="text-[10px] text-slate-500 font-bold uppercase">Câu ngân hàng</div>
                      </div>
                      <div className="p-2 bg-emerald-50 rounded-lg">
                        <span className="font-black text-emerald-700 text-base">{migrationResult.users}</span>
                        <div className="text-[10px] text-slate-500 font-bold uppercase">Người dùng</div>
                      </div>
                      <div className="p-2 bg-emerald-50 rounded-lg">
                        <span className="font-black text-emerald-700 text-base">{migrationResult.classes}</span>
                        <div className="text-[10px] text-slate-500 font-bold uppercase">Lớp học</div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 italic">
                      Dữ liệu đã sẵn sàng trong Supabase! Tổng thời gian nạp: {(migrationResult.totalTimeMs / 1000).toFixed(1)} giây.
                    </p>
                  </div>
                )}

              </div>

            </div>
          )}

        </div>

        {/* Footer Modal */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500 font-medium">
            EduQuiz VN &bull; CSDL Bảo mật & Tối ưu hóa hiệu năng
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-black text-xs uppercase tracking-wider transition-all"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
}
