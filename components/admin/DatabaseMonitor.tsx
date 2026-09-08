import React, { useState, useEffect } from 'react';
import { 
  Database, Activity, HardDrive, RefreshCw, Download,
  CheckCircle2, AlertTriangle, ShieldCheck, Zap, Layers, 
  Server, Cpu, BarChart3,
  ExternalLink
} from 'lucide-react';
import BackupMigrationModal from './BackupMigrationModal';
import { 
  getDatabaseMetrics, 
  pingDatabase, 
  exportFullDatabaseBackup, 
  clearLocalCache,
  syncAllQuizzesMetadata,
  deduplicateBankQuestions,
  DatabaseMetrics,
  isDatabaseConnected
} from '../../services/storage';

interface DatabaseMonitorProps {
  isSuperAdmin: boolean;
  onShowAlert?: (title: string, message: string, type: 'info' | 'warning' | 'error' | 'success') => void;
  onShowConfirm?: (title: string, message: string, onConfirm: () => void) => void;
}

export default function DatabaseMonitor({
  isSuperAdmin,
  onShowAlert,
  onShowConfirm
}: DatabaseMonitorProps) {
  const [metrics, setMetrics] = useState<DatabaseMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPinging, setIsPinging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [lastPingTime, setLastPingTime] = useState<number | null>(null);
  const [isBackupMigrationModalOpen, setIsBackupMigrationModalOpen] = useState(false);

  const fetchMetrics = async () => {
    setIsLoading(true);
    try {
      const data = await getDatabaseMetrics();
      setMetrics(data);
      setLastPingTime(data.latencyMs);
    } catch (e: any) {
      console.error("Lỗi lấy dữ liệu giám sát CSDL:", e);
      if (onShowAlert) {
        onShowAlert("Lỗi tải thông tin", "Không thể lấy dữ liệu thống kê CSDL: " + (e.message || "Lỗi không xác định"), "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const handlePingTest = async () => {
    setIsPinging(true);
    try {
      const latency = await pingDatabase();
      setLastPingTime(latency);
      if (metrics) {
        setMetrics({
          ...metrics,
          latencyMs: latency,
          status: latency < 0 ? 'disconnected' : latency > 800 ? 'warning' : 'optimal'
        });
      }
      if (onShowAlert) {
        if (latency >= 0) {
          onShowAlert("Kiểm tra kết nối", `Thời gian phản hồi Supabase (PostgreSQL): ${latency} ms (Trạng thái: Tốt)`, "success");
        } else {
          onShowAlert("Mất kết nối", "Không thể ping tới Supabase. Vui lòng kiểm tra mạng!", "error");
        }
      }
    } finally {
      setIsPinging(false);
    }
  };

  const handleExportBackup = async () => {
    if (!isSuperAdmin) {
      if (onShowAlert) onShowAlert("Không có quyền", "Chỉ Tổng Quản Trị (SuperAdmin) mới có quyền xuất bản sao lưu CSDL.", "warning");
      return;
    }

    setIsExporting(true);
    try {
      const jsonString = await exportFullDatabaseBackup();
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `eduquiz_supabase_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (onShowAlert) {
        onShowAlert("Sao lưu thành công", "Đã tải xuống file bản sao lưu JSON toàn bộ Cơ sở dữ liệu Supabase!", "success");
      }
    } catch (e: any) {
      if (onShowAlert) {
        onShowAlert("Lỗi sao lưu", "Không thể xuất bản sao lưu: " + (e.message || "Lỗi không xác định"), "error");
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleOptimizeDatabase = async () => {
    if (!isSuperAdmin) return;
    const confirmAction = () => {
      setIsOptimizing(true);
      setTimeout(async () => {
        try {
          const syncCount = await syncAllQuizzesMetadata();
          const dedupCount = await deduplicateBankQuestions();
          await fetchMetrics();
          if (onShowAlert) {
            onShowAlert(
              "Tối ưu hoàn tất",
              `Đã tối ưu hóa CSDL:\n• Đồng bộ metadata: ${syncCount} đề thi\n• Loại bỏ câu hỏi trùng lặp trong Ngân hàng: ${dedupCount} câu\n• Giúp tăng tốc độ truy vấn tối đa!`,
              "success"
            );
          }
        } catch (e: any) {
          if (onShowAlert) {
            onShowAlert("Lỗi tối ưu", "Không thể hoàn tất tối ưu: " + (e.message || "Lỗi"), "error");
          }
        } finally {
          setIsOptimizing(false);
        }
      }, 100);
    };

    if (onShowConfirm) {
      onShowConfirm(
        "Tối ưu & Dọn dẹp CSDL",
        "Hệ thống sẽ đồng bộ lại Metadata đề thi và loại bỏ các câu hỏi trùng lặp trong Ngân hàng câu hỏi nhằm tăng tốc độ truy vấn. Tiếp tục?",
        confirmAction
      );
    } else {
      if (confirm("Hệ thống sẽ đồng bộ lại Metadata đề thi và loại bỏ các câu hỏi trùng lặp trong Ngân hàng câu hỏi. Tiếp tục?")) {
        confirmAction();
      }
    }
  };

  const handleClearCache = () => {
    const doClear = () => {
      clearLocalCache();
    };

    if (onShowConfirm) {
      onShowConfirm(
        "Xóa bộ nhớ đệm (Cache)",
        "Thao tác này sẽ xóa sạch cache tạm thời trên trình duyệt máy bạn và tải lại ứng dụng. Dữ liệu trên Supabase sẽ không bị ảnh hưởng. Bạn có muốn tiếp tục?",
        doClear
      );
    } else {
      if (confirm("Xóa cache trình duyệt và tải lại trang?")) {
        doClear();
      }
    }
  };

  const formatBytes = (bytes: number, decimals: number = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const isConnected = metrics?.connected ?? isDatabaseConnected();

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header & Quick Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl">
              <Database size={24} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                  Quản lý CSDL Supabase
                </h1>
                
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-emerald-600 text-white shadow-xs">
                  <CheckCircle2 size={13} />
                  <span>Supabase (PostgreSQL) - Không giới hạn</span>
                </span>
              </div>
              <p className="text-xs font-bold text-slate-500 mt-0.5">
                Cơ sở dữ liệu đám mây PostgreSQL tốc độ cao, hoàn toàn không bị giới hạn lượt đọc
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handlePingTest}
            disabled={isPinging || isLoading}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl font-black text-[11px] uppercase transition-all shadow-sm active:scale-95 disabled:opacity-50"
            title="Đo thời gian phản hồi thực tế tới Supabase"
          >
            <Activity size={15} className={`text-emerald-600 ${isPinging ? 'animate-spin' : ''}`} />
            <span>{isPinging ? 'Đang Ping...' : 'Kiểm tra Ping'}</span>
          </button>

          <button
            type="button"
            onClick={fetchMetrics}
            disabled={isLoading}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl font-black text-[11px] uppercase transition-all shadow-sm active:scale-95 disabled:opacity-50"
            title="Làm mới lại toàn bộ số liệu thống kê"
          >
            <RefreshCw size={15} className={`text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>

          {isSuperAdmin && (
            <>
              <button
                type="button"
                onClick={() => setIsBackupMigrationModalOpen(true)}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-black text-[11px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50"
                title="Trung tâm Sao lưu JSON, Khôi phục và Nhập xuất CSDL"
              >
                <Server size={15} className="text-emerald-200" />
                <span>Sao lưu & Di chuyển CSDL</span>
              </button>

              <button
                type="button"
                onClick={handleExportBackup}
                disabled={isExporting || isLoading || !isConnected}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white hover:bg-emerald-800 rounded-xl font-black text-[11px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50"
                title="Tải về file sao lưu JSON toàn bộ dữ liệu từ Supabase"
              >
                <Download size={15} className={isExporting ? 'animate-bounce' : ''} />
                <span>{isExporting ? 'Đang xuất...' : 'Xuất JSON (Backup)'}</span>
              </button>

              <button
                type="button"
                onClick={handleOptimizeDatabase}
                disabled={isOptimizing || isLoading || !isConnected}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded-xl font-black text-[11px] uppercase transition-all shadow-md active:scale-95 disabled:opacity-50"
                title="Đồng bộ metadata và lọc sạch câu hỏi trùng lặp"
              >
                <Zap size={15} className={isOptimizing ? 'animate-spin' : ''} />
                <span>{isOptimizing ? 'Đang tối ưu...' : 'Tối ưu CSDL'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Supabase PostgreSQL Status Banner */}
      <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 text-white p-6 rounded-3xl shadow-lg border border-emerald-800/50 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-10 -translate-y-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-[11px] font-black uppercase tracking-wider border border-emerald-400/30">
              <ShieldCheck size={13} className="text-emerald-400" />
              <span>Hệ thống vận hành 100% trên Supabase PostgreSQL</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white flex items-baseline gap-2">
              <span>Truy vấn không giới hạn (Unlimited Reads & Writes)</span>
            </h2>
            <p className="text-xs text-emerald-100/80 leading-relaxed">
              Toàn bộ dữ liệu đề thi, câu hỏi, tài khoản người dùng và kết quả nộp bài của học sinh được lưu trữ an toàn trên máy chủ quan hệ PostgreSQL. 
              Bạn có thể tổ chức thi cho hàng nghìn học sinh cùng lúc với tốc độ xử lý tức thời và độ ổn định cao.
            </p>
          </div>

          <div className="w-full lg:w-80 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/15 space-y-2.5 shrink-0">
            <div className="flex justify-between items-center text-xs">
              <span className="text-emerald-200 font-bold">Trạng thái CSDL:</span>
              <span className="font-black text-emerald-300 text-sm flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Trực tuyến (Online)</span>
              </span>
            </div>

            <div className="pt-2 border-t border-white/10 flex justify-between items-center text-[11px] text-emerald-100">
              <span>Độ trễ Ping:</span>
              <strong className="text-white font-black">{lastPingTime !== null && lastPingTime >= 0 ? `${lastPingTime} ms` : 'Tốt'}</strong>
            </div>

            <div className="pt-1 flex justify-between items-center text-[11px] text-emerald-100">
              <span>Hạ tầng CSDL:</span>
              <strong className="text-white font-black">Supabase PostgreSQL</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Hero Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Trạng thái & Latency */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Trạng thái CSDL</span>
            <div className={`p-2 rounded-xl ${
              isConnected ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
            }`}>
              {isConnected ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-black ${
                isConnected ? 'text-slate-800' : 'text-red-600'
              }`}>
                {isConnected ? 'Hoạt động tốt' : 'Mất kết nối'}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs font-bold">
              <span className="text-slate-500">Độ trễ Latency:</span>
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-black ${
                (lastPingTime || 0) < 300 
                  ? 'bg-emerald-100 text-emerald-800' 
                  : (lastPingTime || 0) < 800 
                  ? 'bg-amber-100 text-amber-800' 
                  : 'bg-red-100 text-red-800'
              }`}>
                {lastPingTime !== null && lastPingTime >= 0 ? `${lastPingTime} ms` : 'N/A'}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Supabase Database</span>
            <span className="text-emerald-600 font-bold">PostgreSQL</span>
          </div>
        </div>

        {/* Card 2: Dung lượng CSDL ước tính */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Dung lượng CSDL</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <HardDrive size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-800">
              {formatBytes(metrics?.totalEstimatedSizeBytes || 0)}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-500">
              <span>Hạn mức Free: 500 MB</span>
              <span className="text-blue-600 font-black">
                {metrics?.quotas?.estimatedStorageUsedPercent ?? 0}%
              </span>
            </div>
          </div>
          <div className="mt-3 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-emerald-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(2, metrics?.quotas?.estimatedStorageUsedPercent ?? 0)}%` }}
            />
          </div>
        </div>

        {/* Card 3: Tổng số bản ghi */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Tổng số bản ghi</span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Layers size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-800">
              {(metrics?.totalDocuments || 0).toLocaleString()} <span className="text-sm font-bold text-slate-400">records</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <span>Trải dài trên</span>
              <span className="text-indigo-600 font-black">{metrics?.collections?.length || 8} Bảng PostgreSQL</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Truy vấn</span>
            <span className="text-emerald-600 font-bold">Không giới hạn</span>
          </div>
        </div>

        {/* Card 4: Bộ nhớ Cache Trình duyệt */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Cache Trình duyệt</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Cpu size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-800">
              {formatBytes(metrics?.localCacheSizeBytes || 0)}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-500">
              <span>LocalStorage</span>
              <button 
                onClick={handleClearCache}
                className="text-amber-600 hover:text-amber-700 underline text-[11px] font-bold"
              >
                Dọn dẹp
              </button>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Client Storage</span>
            <span className="text-emerald-600 font-bold">Tối ưu</span>
          </div>
        </div>
      </div>

      {/* Main Breakdown: Database Tables */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
              <BarChart3 size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">
                Chi tiết dữ liệu các Bảng trong Supabase
              </h3>
              <p className="text-xs font-medium text-slate-500">
                Thống kê số lượng bản ghi và dung lượng ước tính của từng bảng PostgreSQL
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
            {metrics?.collections?.length || 0} bảng dữ liệu
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-black uppercase text-[10px] tracking-wider">
                <th className="pb-3 px-3">Bảng (Table)</th>
                <th className="pb-3 px-3">Mô tả dữ liệu</th>
                <th className="pb-3 px-3 text-right">Số bản ghi</th>
                <th className="pb-3 px-3 text-right">Dung lượng</th>
                <th className="pb-3 px-3 text-right">Tỷ trọng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics?.collections?.map((col) => {
                const totalBytes = metrics?.totalEstimatedSizeBytes || 1;
                const percent = Math.round((col.estimatedSizeBytes / totalBytes) * 100) || 0;
                return (
                  <tr key={col.name} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-3">
                      <div className="font-black text-slate-800">{col.label}</div>
                      <code className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-mono font-bold">
                        {col.name}
                      </code>
                    </td>
                    <td className="py-3.5 px-3 text-slate-500 max-w-[280px]">
                      <div>{col.description}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Lưu trữ trực tiếp trên PostgreSQL Table
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-right font-black text-slate-800 text-sm">
                      {(col.count ?? (col as any).documentCount ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-3 text-right font-bold text-slate-700">
                      {formatBytes(col.estimatedSizeBytes || 0)}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-emerald-600 h-full rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="font-bold text-slate-600 text-[11px] w-8 text-right">
                          {percent}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cloud Configuration & Technical Information */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
            <Server size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">
              Thông số Kỹ thuật CSDL Supabase
            </h3>
            <p className="text-xs font-medium text-slate-500">
              Chi tiết cấu hình định danh và hạ tầng đám mây đang kết nối
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Project Reference ID</span>
            <p className="text-xs font-mono font-bold text-slate-800 mt-1 break-all select-all">
              {metrics?.projectId || 'kosgiekqtutjegalbxyq'}
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Database Engine</span>
            <p className="text-xs font-mono font-bold text-slate-800 mt-1 break-all select-all">
              PostgreSQL 15+ (Supabase)
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Storage Bucket</span>
            <p className="text-xs font-mono font-bold text-slate-800 mt-1 break-all select-all">
              quiz-images (Supabase Storage)
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Đặc tính</span>
            <p className="text-xs font-bold text-emerald-700 mt-1">
              Không giới hạn Lượt Đọc/Ghi
            </p>
          </div>
        </div>
      </div>

      {/* Modal Quản lý Sao lưu & Nhập/Xuất JSON */}
      <BackupMigrationModal
        isOpen={isBackupMigrationModalOpen}
        onClose={() => setIsBackupMigrationModalOpen(false)}
        onShowAlert={onShowAlert}
        onShowConfirm={onShowConfirm}
      />
    </div>
  );
}
