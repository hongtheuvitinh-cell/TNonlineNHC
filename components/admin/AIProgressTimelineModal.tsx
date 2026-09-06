import React, { useEffect, useRef } from 'react';
import { 
  Sparkles, Database, CheckCircle2, Loader2, BookOpen, 
  Layers, Clock, ArrowRight, ShieldCheck, AlertCircle, X
} from 'lucide-react';

export interface TimelineStepItem {
  id: string;
  label: string;
  description?: string;
  status: 'pending' | 'active' | 'completed';
}

export interface AIProgressTimelineModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  percent: number;
  currentAction: 'fetching_bank' | 'checking_matrix' | 'generating_ai' | 'solving_ai' | 'normalizing' | 'completed' | 'error';
  currentLevel?: string;
  currentChapter?: string;
  detailsMessage: string;
  steps: TimelineStepItem[];
  logs?: string[];
  onClose?: () => void;
  canClose?: boolean;
}

export default function AIProgressTimelineModal({
  isOpen,
  title,
  subtitle,
  percent,
  currentAction,
  currentLevel,
  currentChapter,
  detailsMessage,
  steps,
  logs = [],
  onClose,
  canClose = false
}: AIProgressTimelineModalProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Tự động cuộn xuống cuối dòng log khi có thông báo mới
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

  const getActionBadge = () => {
    switch (currentAction) {
      case 'fetching_bank':
        return {
          icon: <Database size={13} className="animate-bounce" />,
          label: 'ĐANG LẤY DỮ LIỆU CÂU HỎI CÓ SẴN',
          className: 'bg-emerald-50 text-emerald-700 border-emerald-200'
        };
      case 'checking_matrix':
        return {
          icon: <Layers size={13} className="animate-pulse" />,
          label: 'ĐANG ĐỐI CHIẾU MA TRẬN & LỜI GIẢI',
          className: 'bg-blue-50 text-blue-700 border-blue-200'
        };
      case 'generating_ai':
        return {
          icon: <Sparkles size={13} className="animate-spin text-purple-600" />,
          label: 'AI GEMINI ĐANG SOẠN CÂU MỚI',
          className: 'bg-purple-50 text-purple-700 border-purple-200'
        };
      case 'solving_ai':
        return {
          icon: <Sparkles size={13} className="animate-spin text-indigo-600" />,
          label: 'AI ĐANG SOẠN LỜI GIẢI MỚI (CHƯA CÓ LỜI GIẢI)',
          className: 'bg-indigo-50 text-indigo-700 border-indigo-200'
        };
      case 'normalizing':
        return {
          icon: <Loader2 size={13} className="animate-spin text-amber-600" />,
          label: 'ĐANG CHUẨN HÓA LATEX & CÔNG THỨC TOÁN',
          className: 'bg-amber-50 text-amber-700 border-amber-200'
        };
      case 'completed':
        return {
          icon: <CheckCircle2 size={13} className="text-emerald-600" />,
          label: 'HOÀN TẤT XỬ LÝ',
          className: 'bg-emerald-50 text-emerald-700 border-emerald-200'
        };
      default:
        return {
          icon: <Loader2 size={13} className="animate-spin text-slate-600" />,
          label: 'ĐANG XỬ LÝ...',
          className: 'bg-slate-50 text-slate-700 border-slate-200'
        };
    }
  };

  const badge = getActionBadge();

  // Định dạng mức độ nhận thức thành nhãn đẹp
  const formatLevel = (lvl?: string) => {
    if (!lvl) return null;
    const map: Record<string, { name: string; color: string }> = {
      'B': { name: 'Nhận biết (B)', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
      'H': { name: 'Thông hiểu (H)', color: 'bg-blue-100 text-blue-800 border-blue-300' },
      'VD': { name: 'Vận dụng (VD)', color: 'bg-amber-100 text-amber-800 border-amber-300' },
      'VDC': { name: 'Vận dụng cao (VDC)', color: 'bg-red-100 text-red-800 border-red-300' }
    };
    return map[lvl] || { name: `Mức độ: ${lvl}`, color: 'bg-slate-100 text-slate-700 border-slate-300' };
  };

  const levelInfo = formatLevel(currentLevel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fade-in">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* MODAL HEADER */}
        <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-white/10 text-indigo-300">
                <Sparkles size={16} className="animate-pulse" />
              </span>
              <h3 className="font-black text-base uppercase tracking-wider">{title}</h3>
            </div>
            {subtitle && (
              <p className="text-xs text-indigo-200/80 font-medium pl-8">{subtitle}</p>
            )}
          </div>
          {canClose && onClose && (
            <button
              onClick={onClose}
              type="button"
              className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* PROGRESS OVERVIEW & TIMELINE */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* THANH TIẾN TRÌNH & PHẦN TRĂM */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-black">
              <span className="text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={14} className="text-indigo-600" />
                Tiến độ thực hiện:
              </span>
              <span className="text-indigo-600 text-base font-extrabold">{percent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 rounded-full transition-all duration-300 ease-out shadow-sm"
                style={{ width: `${Math.min(100, Math.max(5, percent))}%` }}
              />
            </div>
          </div>

          {/* DÒNG CẢNH BÁO / TRẠNG THÁI HIỆN TẠI (ĐANG LẤY DỮ LIỆU HAY ĐANG SOẠN CÂU MỚI, MỨC ĐỘ NÀO) */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border shadow-xs ${badge.className}`}>
                {badge.icon}
                <span>{badge.label}</span>
              </span>

              {levelInfo && (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase border shadow-xs ${levelInfo.color}`}>
                  {levelInfo.name}
                </span>
              )}

              {currentChapter && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 truncate max-w-[260px]">
                  <BookOpen size={11} /> {currentChapter}
                </span>
              )}
            </div>

            <p className="text-xs font-bold text-slate-800 leading-relaxed">
              {detailsMessage}
            </p>
          </div>

          {/* CÁC BƯỚC TIMELINE */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
              CÁC GIAI ĐOẠN XỬ LÝ (TIMELINE):
            </h4>
            <div className="grid grid-cols-1 gap-2.5">
              {steps.map((step, idx) => {
                const isActive = step.status === 'active';
                const isCompleted = step.status === 'completed';
                return (
                  <div
                    key={step.id}
                    className={`flex items-start gap-3 p-3 rounded-2xl border transition-all ${
                      isActive
                        ? 'bg-indigo-50/70 border-indigo-300 shadow-sm'
                        : isCompleted
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : 'bg-white border-slate-100 opacity-60'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isCompleted ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs shadow-xs">
                          <CheckCircle2 size={14} />
                        </div>
                      ) : isActive ? (
                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs shadow-xs">
                          <Loader2 size={13} className="animate-spin" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-bold">
                          {idx + 1}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs font-black uppercase ${
                          isActive ? 'text-indigo-900' : isCompleted ? 'text-emerald-900' : 'text-slate-500'
                        }`}>
                          {step.label}
                        </p>
                        {isActive && (
                          <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-indigo-600 text-white shrink-0">
                            Đang xử lý
                          </span>
                        )}
                        {isCompleted && (
                          <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 shrink-0">
                            Đã xong
                          </span>
                        )}
                      </div>
                      {step.description && (
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* NHẬT KÝ CHI TIẾT (LOGS) */}
          {logs.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                NHẬT KÝ THỰC HIỆN THỜI GIAN THỰC:
              </span>
              <div 
                ref={logContainerRef}
                className="w-full h-28 bg-slate-900 text-slate-300 font-mono text-[11px] p-3 rounded-2xl overflow-y-auto border border-slate-800 space-y-1 shadow-inner"
              >
                {logs.map((log, index) => (
                  <div key={index} className="leading-snug">
                    <span className="text-emerald-400 font-bold mr-1.5">›</span>
                    <span>{log}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-600" />
            Đúng chuẩn ma trận GDPT 2018 & công thức Toán LaTeX
          </span>
          {canClose && onClose && (
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase hover:bg-black transition-all shadow-sm"
            >
              Đóng
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
