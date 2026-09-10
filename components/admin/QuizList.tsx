
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Quiz, Result, Grade, Chapter, ClassRoom, User } from '../../types';
import { 
  Edit, Trash2, Eye, Users, Filter, FileText, ChevronDown, Link as LinkIcon, 
  EyeOff, ShieldCheck, GraduationCap, Share2, User as UserIcon, Lock, BookOpen,
  Check, X, CheckSquare, Square, Info, Sparkles, Send, Layers, AlertCircle, PauseCircle,
  Calendar, CalendarDays, CheckCircle2, Clock, Zap, Timer, Loader2, Printer
} from 'lucide-react';
import { isSameSubject, STANDARD_SUBJECTS, normalizeSubject, getDisplaySubject } from '../../services/subjectUtils';
import { getCurrentAcademicYear, getQuizAcademicYear, getAcademicYearOptions } from '../../services/academicUtils';
import { updateQuizAcademicYear, updateQuizShareStatus, updateQuizSchedule, formatToDatetimeLocal, normalizeDateTimeForStorage } from '../../services/storage';

interface QuizListProps {
    quizzes: Quiz[];
    results: Result[];
    chapters: Chapter[];
    classes?: ClassRoom[];
    currentUser?: User;
    teachers?: User[];
    onEdit: (quiz: Quiz) => void;
    onDelete: (id: string) => void;
    onPreview: (quiz: Quiz) => void;
    onAssignClasses?: (quiz: Quiz, selectedClassIds: string[]) => Promise<void>;
    onToggleShare?: (quizId: string, newShareStatus: boolean) => void;
    onUpdateSchedule?: (quizId: string, startTime: string | null, endTime: string | null) => Promise<void>;
    qSearch: string;
    setQSearch: (val: string) => void;
    qGradeFilter: Grade | 'all';
    setQGradeFilter: (val: Grade | 'all') => void;
    qChapterFilter: string;
    setQChapterFilter: (val: string) => void;
    qSubjectFilter?: string;
    setQSubjectFilter?: (val: string) => void;
    qAcademicYearFilter?: string;
    setQAcademicYearFilter?: (val: string) => void;
    qAuthorFilter?: string;
    setQAuthorFilter?: (val: string) => void;
    onLoadSharedQuizzes?: () => Promise<void>;
}

const PAGE_SIZE = 12;

type QuickFilterType = 'all' | 'open' | 'draft' | 'expired' | 'class' | 'grade';

export const getQuizStatus = (q: Quiz) => {
    const now = new Date();
    const startX = q.startTime ? new Date(q.startTime) : null;
    const endY = q.endTime ? new Date(q.endTime) : null;
    const isFlexibleWindow = Boolean(startX && endY && endY.getTime() > startX.getTime());

    let isStarted = true;
    let isExpired = false;

    if (q.type === 'test') {
        if (startX) {
            if (isFlexibleWindow && endY) {
                isStarted = now.getTime() >= startX.getTime();
                isExpired = now.getTime() > endY.getTime();
            } else {
                const globalEnd = new Date(startX.getTime() + (q.durationMinutes || 0) * 60000);
                isStarted = now.getTime() >= startX.getTime();
                isExpired = now.getTime() > globalEnd.getTime();
            }
        }
    } else {
        isStarted = true;
        isExpired = Boolean(endY && now.getTime() > endY.getTime());
    }

    const isDraft = !q.isPublished;
    const isOpen = q.isPublished && isStarted && !isExpired;
    const isExpiredState = q.isPublished && isExpired;
    const isClassTargeted = q.targetType === 'classes' && Boolean(q.assignedClassIds && q.assignedClassIds.length > 0);
    const isGradeTargeted = !isClassTargeted;

    return {
        isDraft,
        isOpen,
        isExpired: isExpiredState,
        isClassTargeted,
        isGradeTargeted,
        isActive: isStarted && !isExpired
    };
};

interface QuizCardItemProps {
    quiz: Quiz;
    isMine: boolean;
    isSuperAdmin?: boolean;
    canManage: boolean;
    creatorSubject?: string;
    classes?: ClassRoom[];
    resultCount: number;
    quizYearOverride?: string;
    updatingYearQuizId: string | null;
    quizShareOverride?: boolean;
    updatingShareQuizId: string | null;
    onPreview: (q: Quiz) => void;
    onEdit: (q: Quiz) => void;
    onDelete: (id: string) => void;
    openAssignModal: (q: Quiz) => void;
    openScheduleModal: (q: Quiz) => void;
    copyQuizLink: (id: string) => void;
    handleSetAcademicYear: (id: string, yr: string) => void;
    handleToggleShare: (id: string, newShare: boolean) => void;
}

const QuizCardItem = React.memo(function QuizCardItem({
    quiz: q,
    isMine,
    isSuperAdmin = false,
    canManage,
    creatorSubject,
    classes = [],
    resultCount,
    quizYearOverride,
    updatingYearQuizId,
    quizShareOverride,
    updatingShareQuizId,
    onPreview,
    onEdit,
    onDelete,
    openAssignModal,
    openScheduleModal,
    copyQuizLink,
    handleSetAcademicYear,
    handleToggleShare
}: QuizCardItemProps) {
    const now = new Date();
    const startX = q.startTime ? new Date(q.startTime) : null;
    const endY = q.endTime ? new Date(q.endTime) : null;
    const isFlexibleWindow = Boolean(startX && endY && endY.getTime() > startX.getTime());

    let isStarted = true;
    let isExpired = false;

    if (q.type === 'test') {
        if (startX) {
            if (isFlexibleWindow && endY) {
                isStarted = now.getTime() >= startX.getTime();
                isExpired = now.getTime() > endY.getTime();
            } else {
                const globalEnd = new Date(startX.getTime() + (q.durationMinutes || 0) * 60000);
                isStarted = now.getTime() >= startX.getTime();
                isExpired = now.getTime() > globalEnd.getTime();
            }
        }
    } else {
        isStarted = true;
        isExpired = Boolean(endY && now.getTime() > endY.getTime());
    }
    const isActive = isStarted && !isExpired;
    
    let cardBorder = "";
    let cardBg = "";
    if (!q.isPublished) {
        cardBg = "bg-slate-50";
        cardBorder = "border-slate-300 border-dashed border-l-slate-400";
    } else if (isExpired) {
        cardBg = "bg-amber-50/40";
        cardBorder = "border-amber-200 border-l-amber-500";
    } else if (q.isUnlisted) {
        cardBg = "bg-indigo-50/30";
        cardBorder = "border-indigo-200 border-l-indigo-600";
    } else {
        cardBg = "bg-white";
        cardBorder = "border-slate-200 border-l-blue-600";
    }

    const assignedNames = useMemo(() => {
        if (!q.assignedClassIds || q.assignedClassIds.length === 0) return '';
        const names = q.assignedClassIds.map(id => {
            const found = classes.find(c => c.id === id);
            return found ? found.name : id;
        });
        if (names.length === 1) return `Lớp ${names[0]}`;
        return `${names.length} Lớp`;
    }, [q.assignedClassIds, classes]);

    const effectiveYear = quizYearOverride || q.academicYear || getQuizAcademicYear(q);
    const effectiveIsShared = quizShareOverride !== undefined ? quizShareOverride : Boolean(q.isSharedWithTeachers);

    return (
        <div 
            className={`rounded-2xl p-4 sm:p-5 border transition-all flex flex-col md:flex-row gap-4 justify-between items-stretch group relative overflow-hidden border-l-4 sm:border-l-[6px] shadow-sm hover:shadow-md ${cardBg} ${cardBorder}`}
        >
            {/* Phía Trái & Giữa: Thông tin, Huy hiệu, Tiêu đề, Niên khóa */}
            <div className="flex-1 flex flex-col justify-between min-w-0 space-y-2.5">
                {/* Dòng Huy hiệu (Badges) */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-tight ${q.isPublished ? (isExpired ? 'bg-amber-600 text-white' : (q.isUnlisted ? 'bg-indigo-600 text-white' : 'bg-blue-600 text-white')) : 'bg-slate-300 text-slate-700'}`}>
                        K{q.grade}
                    </span>
                    
                    {q.type === 'practice' ? (
                        <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 shadow-xs" title="Chế độ Luyện tập: Nhấn vào câu hỏi xem ngay đáp án & lời giải chi tiết">
                            📖 Luyện tập
                        </span>
                    ) : (
                        <span className="px-2 py-0.5 bg-indigo-100 border border-indigo-300 text-indigo-900 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 shadow-xs" title={`Chế độ Làm bài: ${(q.maxAttempts === 1 || q.maxAttempts === undefined) ? 'Làm 1 lần duy nhất rồi đóng băng' : q.maxAttempts > 1 ? `Tối đa ${q.maxAttempts} lần làm bài` : 'Không giới hạn số lần'}`}>
                            ✍️ {(q.maxAttempts === 1 || q.maxAttempts === undefined) ? '1 Lần (Đóng băng)' : q.maxAttempts > 1 ? `${q.maxAttempts} Lần` : 'Làm bài'}
                        </span>
                    )}

                    {(q.subject || creatorSubject) && (
                        <span className="px-2 py-0.5 bg-purple-50 border border-purple-200 text-purple-800 rounded-lg text-[9px] font-black uppercase flex items-center gap-1">
                            <BookOpen size={10} className="text-purple-600"/>
                            {q.subject || creatorSubject}
                        </span>
                    )}

                    {q.targetType === 'classes' && assignedNames && (
                        <span className="px-2 py-0.5 bg-sky-50 border border-sky-200 text-sky-800 rounded-lg text-[9px] font-black uppercase flex items-center gap-1">
                            <GraduationCap size={11}/>
                            {assignedNames}
                        </span>
                    )}

                    {q.isPublished && (
                        isExpired ? (
                            <span className="px-2 py-0.5 bg-amber-50 border border-amber-300 text-amber-700 rounded-lg text-[9px] font-black uppercase flex items-center gap-1">
                                HẾT HẠN
                            </span>
                        ) : (
                            <span className={`px-2 py-0.5 bg-white border ${isActive ? 'border-emerald-300 text-emerald-700 bg-emerald-50/50' : 'border-amber-300 text-amber-700 bg-amber-50/50'} rounded-lg text-[9px] font-black uppercase flex items-center gap-1`}>
                                {isActive ? 'ĐANG MỞ' : 'CHƯA ĐẾN GIỜ'}
                            </span>
                        )
                    )}

                    {q.isPublished && q.isUnlisted && (
                        <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-[9px] font-black uppercase flex items-center gap-1">
                            <EyeOff size={10}/> RIÊNG TƯ
                        </span>
                    )}

                    {q.showResultAnswers === false && q.type === 'test' && (
                        <span className="px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-[9px] font-black uppercase flex items-center gap-1" title="Ẩn đáp án đúng và lời giải đối với học sinh">
                            <EyeOff size={10}/> ẨN ĐÁP ÁN
                        </span>
                    )}

                    {q.isMonitored && (
                        <span className="p-1 bg-red-50 text-red-600 rounded-md border border-red-100" title="Có giám sát chống gian lận">
                            <ShieldCheck size={11}/>
                        </span>
                    )}
                </div>

                {/* Tiêu đề đề thi */}
                <h3 
                    onClick={() => onPreview(q)}
                    className={`font-black text-sm leading-snug uppercase transition-colors line-clamp-2 cursor-pointer hover:text-blue-600 ${q.isPublished ? 'text-slate-900' : 'text-slate-600'}`}
                >
                    {q.title}
                </h3>

                {/* Thông tin lịch thi trực quan */}
                {(q.startTime || q.endTime) ? (
                    <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold">
                        <span className="px-2 py-0.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 flex items-center gap-1 shadow-2xs">
                            <Clock size={11} className="text-blue-600 shrink-0"/>
                            <span>{q.startTime ? `Mở: ${new Date(q.startTime).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : 'Mở tự do'}</span>
                        </span>
                        <span className="text-slate-400 font-bold">➔</span>
                        <span className={`px-2 py-0.5 rounded-lg border flex items-center gap-1 shadow-2xs ${isExpired ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-indigo-50 border-indigo-200 text-indigo-800'}`}>
                            <Timer size={11} className={isExpired ? "text-amber-700 shrink-0" : "text-indigo-600 shrink-0"}/>
                            <span>{q.endTime ? `Đóng: ${new Date(q.endTime).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : (q.startTime ? `Sau ${q.durationMinutes || 45}p` : 'Không giới hạn')}</span>
                        </span>
                        {canManage && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openScheduleModal(q); }}
                                className="text-[9px] font-black text-blue-600 hover:text-blue-800 underline ml-1 cursor-pointer"
                                title="Thay đổi giờ mở / đóng phòng thi"
                            >
                                Đổi lịch
                            </button>
                        )}
                    </div>
                ) : null}

                {/* Thông tin phụ: Tác giả, Thời lượng, Niên khóa */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-500 font-bold pt-0.5">
                    {q.createdByName ? (
                        <span className="flex items-center gap-1">
                            <UserIcon size={11} className="text-slate-400"/>
                            {isMine ? <b className="text-blue-700">Tôi (Tác giả)</b> : `GV: ${q.createdByName}`}
                        </span>
                    ) : null}

                    {canManage ? (
                        <button
                            type="button"
                            disabled={updatingShareQuizId === q.id}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleToggleShare(q.id, !effectiveIsShared);
                            }}
                            className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 transition-all border shadow-2xs active:scale-95 cursor-pointer select-none ${
                                effectiveIsShared 
                                    ? 'bg-blue-50 hover:bg-rose-50 text-blue-700 hover:text-rose-700 border-blue-200 hover:border-rose-300' 
                                    : 'bg-slate-100 hover:bg-blue-50 text-slate-500 hover:text-blue-700 border-slate-200 hover:border-blue-300'
                            }`}
                            title={
                                effectiveIsShared 
                                    ? "Đang chia sẻ cho các GV khác cùng môn xem và giao lớp. Nhấn để hủy chia sẻ (chuyển về riêng tư)." 
                                    : "Đang ở chế độ riêng tư. Nhấn để chia sẻ đề thi này cho các giáo viên khác cùng môn xem và giao lớp."
                            }
                        >
                            <Share2 size={10} className={effectiveIsShared ? "text-blue-600" : "text-slate-400"}/>
                            <span>{updatingShareQuizId === q.id ? 'Đang lưu...' : (effectiveIsShared ? 'Đã chia sẻ GV' : 'Chưa chia sẻ')}</span>
                        </button>
                    ) : (
                        effectiveIsShared && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-[9px] font-black uppercase flex items-center gap-1">
                                <Share2 size={10} className="text-blue-600"/> Đề GV chia sẻ
                            </span>
                        )
                    )}

                    {q.durationMinutes ? (
                        <span className="text-slate-600 font-black">⏱️ {q.durationMinutes}p</span>
                    ) : null}

                    {/* Sét nhanh Niên khóa */}
                    <div className="flex items-center gap-1 bg-slate-100/80 px-2 py-0.5 rounded-lg border border-slate-200/70">
                        <Calendar size={11} className="text-sky-600"/>
                        <span className="text-sky-800 font-black text-[9px]">NH {effectiveYear}</span>
                        {canManage && (
                            <select
                                className="text-[9px] font-black py-0.5 px-1 bg-white hover:bg-sky-50 border border-slate-200 rounded text-slate-700 outline-none cursor-pointer ml-1"
                                value={effectiveYear}
                                disabled={updatingYearQuizId === q.id}
                                onChange={(e) => handleSetAcademicYear(q.id, e.target.value)}
                            >
                                {getAcademicYearOptions([effectiveYear]).map(yr => (
                                    <option key={yr} value={yr}>
                                        Đổi sang NH {yr}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>
            </div>

            {/* Phía Phải: Số liệu nhanh & Các nút thao tác (Chia rõ 3 hàng để không bị che nút Xóa) */}
            <div className="w-full md:w-60 lg:w-64 shrink-0 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-200/80 md:pl-4 pt-3 md:pt-0 gap-2.5">
                {/* HÀNG 1: Dòng số liệu thống kê (Số câu, Lượt thi) & Link riêng tư hoặc Huy hiệu Đề chia sẻ */}
                <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                        <span className="px-2 py-1 bg-slate-100 rounded-lg text-[9px] font-black text-slate-700 flex items-center gap-1 border border-slate-200/60 shadow-2xs">
                            <FileText size={11} className="text-blue-600"/> {q.questionCount || 0} câu
                        </span>
                        <span className="px-2 py-1 bg-slate-100 rounded-lg text-[9px] font-black text-slate-700 flex items-center gap-1 border border-slate-200/60 shadow-2xs">
                            <Users size={11} className="text-emerald-600"/> {resultCount} lượt
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        {q.isUnlisted && (
                            <button 
                                type="button"
                                onClick={() => copyQuizLink(q.id)} 
                                className="px-2 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 rounded-lg shadow-2xs transition-all flex items-center gap-1 text-[9px] font-black cursor-pointer" 
                                title="Copy Link Riêng Tư"
                            >
                                <LinkIcon size={11}/>
                                <span>Link</span>
                            </button>
                        )}
                        {(!isMine && !isSuperAdmin) && (
                            <span className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-[9px] font-black flex items-center gap-1 shadow-2xs">
                                <Share2 size={10} className="text-blue-600"/> Đề chia sẻ
                            </span>
                        )}
                    </div>
                </div>

                {/* HÀNG 2: Các chức năng quản lý riêng biệt (Hẹn giờ, Sửa, Xóa) */}
                {/* Được tách riêng 1 hàng độc lập để nút XÓA luôn hiển thị đầy đủ, không bao giờ bị che khuất */}
                {canManage ? (
                    <div className="flex items-center gap-1.5 w-full">
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openScheduleModal(q); }} 
                            className="flex-1 py-1.5 px-2 bg-blue-50/80 border border-blue-200 text-blue-700 rounded-xl hover:bg-blue-600 hover:text-white shadow-2xs transition-all flex items-center justify-center gap-1 text-[10px] font-black cursor-pointer active:scale-95" 
                            title="Hẹn giờ mở / đóng phòng thi"
                        >
                            <Clock size={11}/>
                            <span>Hẹn giờ</span>
                        </button>
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEdit(q); }} 
                            className="flex-1 py-1.5 px-2 bg-slate-800 text-white rounded-xl hover:bg-blue-600 shadow-2xs transition-all flex items-center justify-center gap-1 text-[10px] font-black cursor-pointer active:scale-95" 
                            title="Sửa đề thi"
                        >
                            <Edit size={11}/>
                            <span>Sửa</span>
                        </button>
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDelete(q.id); }} 
                            className="py-1.5 px-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl hover:bg-rose-600 hover:text-white shadow-2xs transition-all flex items-center justify-center gap-1 text-[10px] font-black cursor-pointer active:scale-95 shrink-0" 
                            title="Xóa đề thi"
                        >
                            <Trash2 size={12}/>
                            <span>Xóa</span>
                        </button>
                    </div>
                ) : (
                    /* Đối với GV thường xem đề chia sẻ: không có quyền quản lý, thông báo phân quyền rõ ràng */
                    <div className="px-2.5 py-1.5 bg-slate-50 border border-slate-200/90 rounded-xl text-[10px] font-bold text-slate-500 flex items-center gap-1.5 shadow-2xs">
                        <Lock size={12} className="text-amber-600 shrink-0"/>
                        <span className="truncate">Giao lớp: Phân quyền SuperAdmin</span>
                    </div>
                )}

                {/* HÀNG 3: Các nút chức năng chính */}
                {/* Đề của tôi / SuperAdmin: Xem & In + Giao Lớp */}
                {/* Đề chia sẻ đối với GV thường: Chỉ cho nút Xem đề và In đề, TẮT LUÔN chức năng giao đề cho lớp */}
                {canManage ? (
                    <div className="grid grid-cols-2 gap-2 w-full">
                        <button 
                            type="button"
                            onClick={() => onPreview(q)} 
                            className="py-2 px-2 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-95 shadow-xs cursor-pointer"
                            title="Xem chi tiết đề & In / Xuất file Word (.docx / .doc) / JSON (.json)"
                        >
                            <Eye size={13}/> Xem & In
                        </button>
                        <button 
                            type="button"
                            onClick={() => openAssignModal(q)} 
                            className="py-2 px-2 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all shadow-xs active:scale-95 text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
                            title="Giao đề cho các lớp học"
                        >
                            <GraduationCap size={14}/> Giao Lớp
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2 w-full">
                        <button 
                            type="button"
                            onClick={() => onPreview(q)} 
                            className="py-2.5 px-2.5 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-200 active:scale-95 shadow-xs cursor-pointer"
                            title="Xem chi tiết nội dung đề thi & đáp án"
                        >
                            <Eye size={13}/> Xem đề
                        </button>
                        <button 
                            type="button"
                            onClick={() => onPreview(q)} 
                            className="py-2.5 px-2.5 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white border border-emerald-200 active:scale-95 shadow-xs cursor-pointer"
                            title="In đề thi hoặc xuất file Microsoft Word (.docx / .doc) để in ấn"
                        >
                            <Printer size={13}/> In đề
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});

export default function QuizList({ 
    quizzes, results, chapters, classes = [], currentUser, teachers = [],
    onEdit, onDelete, onPreview, onAssignClasses, onToggleShare, onUpdateSchedule,
    qSearch, setQSearch, qGradeFilter, setQGradeFilter,
    qChapterFilter, setQChapterFilter,
    qSubjectFilter: propSubjectFilter,
    setQSubjectFilter: propSetSubjectFilter,
    qAcademicYearFilter: propAcademicYearFilter,
    setQAcademicYearFilter: propSetAcademicYearFilter,
    qAuthorFilter: propAuthorFilter,
    setQAuthorFilter: propSetAuthorFilter,
    onLoadSharedQuizzes
}: QuizListProps) {
    const isSuperAdmin = currentUser?.role === 'superadmin' || 
      currentUser?.username?.toLowerCase() === 'admin' || 
      currentUser?.username?.toLowerCase() === 'superadmin';

    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [localAuthorFilter, setLocalAuthorFilter] = useState<string>(() => isSuperAdmin ? 'all' : 'mine');
    const authorFilter = propAuthorFilter !== undefined ? propAuthorFilter : localAuthorFilter;
    const setAuthorFilter = propSetAuthorFilter !== undefined ? propSetAuthorFilter : setLocalAuthorFilter;
    const [isLoadingShared, setIsLoadingShared] = useState(false);

    const handleOpenSharedQuizzes = async () => {
        setAuthorFilter('shared');
        if (onLoadSharedQuizzes) {
            setIsLoadingShared(true);
            try {
                await onLoadSharedQuizzes();
            } catch (err) {
                console.error("Lỗi khi tải đề thi chia sẻ:", err);
            } finally {
                setIsLoadingShared(false);
            }
        }
    };

    const [quickFilter, setQuickFilter] = useState<QuickFilterType>('all');
    const [localSubjectFilter, setLocalSubjectFilter] = useState<string>('all');
    const [localAcademicYearFilter, setLocalAcademicYearFilter] = useState<string>(getCurrentAcademicYear());

    // Academic Year state & overrides
    const qAcademicYearFilter = propAcademicYearFilter !== undefined ? propAcademicYearFilter : localAcademicYearFilter;
    const setQAcademicYearFilter = propSetAcademicYearFilter !== undefined ? propSetAcademicYearFilter : setLocalAcademicYearFilter;

    const [quizYearOverrides, setQuizYearOverrides] = useState<Record<string, string>>({});
    const [updatingYearQuizId, setUpdatingYearQuizId] = useState<string | null>(null);
    const [yearNotification, setYearNotification] = useState<{ id: string; year: string } | null>(null);

    // Quiz Share state & overrides
    const [quizShareOverrides, setQuizShareOverrides] = useState<Record<string, boolean>>({});
    const [updatingShareQuizId, setUpdatingShareQuizId] = useState<string | null>(null);
    const [shareNotification, setShareNotification] = useState<{ id: string; isShared: boolean } | null>(null);

    const handleToggleShare = async (quizId: string, newShareStatus: boolean) => {
        setUpdatingShareQuizId(quizId);
        try {
            await updateQuizShareStatus(quizId, newShareStatus);
            setQuizShareOverrides(prev => ({ ...prev, [quizId]: newShareStatus }));
            if (onToggleShare) {
                onToggleShare(quizId, newShareStatus);
            }
            setShareNotification({ id: quizId, isShared: newShareStatus });
            setTimeout(() => setShareNotification(null), 3500);
        } catch (e: any) {
            console.error("Lỗi cập nhật chia sẻ đề thi:", e);
            alert("Lỗi khi cập nhật trạng thái chia sẻ: " + (e.message || 'Không xác định'));
        } finally {
            setUpdatingShareQuizId(null);
        }
    };

    const handleSetAcademicYear = async (quizId: string, newYear: string) => {
        setUpdatingYearQuizId(quizId);
        try {
            await updateQuizAcademicYear(quizId, newYear);
            setQuizYearOverrides(prev => ({ ...prev, [quizId]: newYear }));
            setYearNotification({ id: quizId, year: newYear });
            setTimeout(() => setYearNotification(null), 3500);
        } catch (e: any) {
            console.error("Lỗi cập nhật niên học đề thi:", e);
            alert("Lỗi khi lưu niên học: " + (e.message || 'Không xác định'));
        } finally {
            setUpdatingYearQuizId(null);
        }
    };

    // Subject filter state (sync between prop and local state)
    const qSubjectFilter = propSubjectFilter !== undefined ? propSubjectFilter : localSubjectFilter;
    const setQSubjectFilter = propSetSubjectFilter !== undefined ? propSetSubjectFilter : setLocalSubjectFilter;

    // Danh sách tất cả môn học có sẵn trong hệ thống (đã chuẩn hóa và khử trùng lặp)
    const availableSubjects = useMemo(() => {
        const subsMap = new Map<string, string>();
        STANDARD_SUBJECTS.forEach(s => {
            subsMap.set(normalizeSubject(s), s);
        });
        quizzes.forEach(q => {
            if (q.subject && q.subject.trim()) {
                const norm = normalizeSubject(q.subject);
                if (!subsMap.has(norm)) {
                    subsMap.set(norm, getDisplaySubject(q.subject));
                }
            }
        });
        chapters.forEach(c => {
            if (c.subject && c.subject.trim()) {
                const norm = normalizeSubject(c.subject);
                if (!subsMap.has(norm)) {
                    subsMap.set(norm, getDisplaySubject(c.subject));
                }
            }
        });
        teachers.forEach(t => {
            if (t.subject && t.subject.trim()) {
                const norm = normalizeSubject(t.subject);
                if (!subsMap.has(norm)) {
                    subsMap.set(norm, getDisplaySubject(t.subject));
                }
            }
        });
        return Array.from(subsMap.values());
    }, [quizzes, chapters, teachers]);

    // Lọc giáo viên thông minh theo môn học được chọn (cho SuperAdmin)
    const filteredTeachers = useMemo(() => {
        if (!isSuperAdmin) return teachers;
        if (qSubjectFilter === 'all') return teachers;
        return teachers.filter(t => t.subject && isSameSubject(t.subject, qSubjectFilter));
    }, [teachers, isSuperAdmin, qSubjectFilter]);

    // Lọc chương thông minh: phù hợp với CẢ Khối và Môn học được chọn
    const relevantChapters = useMemo(() => {
        return chapters.filter(c => {
            // Lọc theo Khối
            if (qGradeFilter !== 'all' && String(c.grade) !== String(qGradeFilter)) return false;
            
            // Lọc theo Môn học
            if (isSuperAdmin) {
                if (qSubjectFilter !== 'all') {
                    if (c.subject && c.subject.trim()) {
                        if (!isSameSubject(c.subject, qSubjectFilter)) return false;
                    } else {
                        // Chương chưa gán môn: kiểm tra đề thi thuộc chương hoặc fallback môn Vật lí
                        const hasQuizWithSubj = quizzes.some(q => 
                            q.category === c.name && (
                                (q.subject && isSameSubject(q.subject, qSubjectFilter)) ||
                                (!q.subject && (isSameSubject('Vật lí', qSubjectFilter) || isSameSubject('Vật lý', qSubjectFilter)))
                            )
                        );
                        const isPhysics = isSameSubject('Vật lí', qSubjectFilter) || isSameSubject('Vật lý', qSubjectFilter);
                        if (!hasQuizWithSubj && !isPhysics) return false;
                    }
                }
            } else if (currentUser?.subject) {
                if (c.subject && c.subject.trim()) {
                    if (!isSameSubject(c.subject, currentUser.subject)) return false;
                }
            }
            return true;
        });
    }, [chapters, qGradeFilter, qSubjectFilter, isSuperAdmin, currentUser?.subject, quizzes]);

    // Tự động reset bộ lọc Chương khi chương đang chọn không còn nằm trong danh sách chương phù hợp
    useEffect(() => {
        if (qChapterFilter !== 'all') {
            const isStillValid = relevantChapters.some(c => c.name === qChapterFilter);
            if (!isStillValid) {
                setQChapterFilter('all');
            }
        }
    }, [relevantChapters, qChapterFilter, setQChapterFilter]);

    // Tự động reset bộ lọc Giáo viên khi giáo viên đang chọn không còn thuộc môn học mới
    useEffect(() => {
        if (isSuperAdmin && authorFilter !== 'all') {
            const isStillValid = filteredTeachers.some(t => t.id === authorFilter);
            if (!isStillValid) {
                setAuthorFilter('all');
            }
        }
    }, [filteredTeachers, authorFilter, isSuperAdmin]);

    const baseFiltered = useMemo(() => {
        return quizzes.filter(q => {
            const creator = teachers.find(t => t.id === q.createdBy);
            const effectiveSubject = q.subject || creator?.subject;
            const effectiveYear = quizYearOverrides[q.id] || q.academicYear || getQuizAcademicYear(q);

            // 0. Lọc theo Niên học
            if (qAcademicYearFilter !== 'all' && effectiveYear !== qAcademicYearFilter) {
                return false;
            }

            // 1. Lọc theo Môn học
            if (isSuperAdmin) {
                if (qSubjectFilter !== 'all') {
                    if (!effectiveSubject || !isSameSubject(effectiveSubject, qSubjectFilter)) {
                        return false;
                    }
                }
            } else {
                // Giáo viên thường: Bắt buộc chỉ hiển thị đề thuộc môn giảng dạy của mình
                const mySubject = currentUser?.subject;
                if (mySubject) {
                    if (!effectiveSubject || !isSameSubject(effectiveSubject, mySubject)) {
                        return false;
                    }
                }
            }

            // 2. Lọc theo Khối
            if (qGradeFilter !== 'all' && q.grade !== qGradeFilter) return false;
            
            // 3. Lọc theo Chương
            if (qChapterFilter !== 'all' && q.category !== qChapterFilter) return false;
            
            // 4. Tìm kiếm từ khóa
            if (qSearch.trim() && !q.title.toLowerCase().includes(qSearch.toLowerCase())) return false;

            // 5. Role & Author Filter
            const isShared = quizShareOverrides[q.id] !== undefined
                ? quizShareOverrides[q.id]
                : (q.isSharedWithTeachers !== undefined ? Boolean(q.isSharedWithTeachers) : !q.createdBy);

            if (isSuperAdmin) {
                if (authorFilter === 'shared') {
                    if (!isShared) return false;
                } else if (authorFilter === 'private') {
                    if (isShared) return false;
                } else if (authorFilter !== 'all' && q.createdBy !== authorFilter) {
                    return false;
                }
            } else {
                // Teacher (Admin)
                const isMine = Boolean(currentUser?.id && q.createdBy === currentUser.id);

                // Mặc định: 'mine' -> Chỉ hiển thị đề do chính giáo viên tạo ra
                if (authorFilter === 'mine') {
                    if (!isMine) return false;
                } else if (authorFilter === 'shared') {
                    // Khi mở xem đề chia sẻ: chỉ hiển thị đề do GV khác cùng bộ môn chia sẻ
                    if (isMine || !isShared) return false;
                } else {
                    // 'all': Chỉ hiển thị đề của mình hoặc đề chia sẻ
                    if (!isMine && !isShared) return false;
                }
            }

            return true;
        });
    }, [quizzes, quizYearOverrides, quizShareOverrides, qAcademicYearFilter, qSubjectFilter, qGradeFilter, qChapterFilter, qSearch, isSuperAdmin, authorFilter, currentUser, teachers]);

    const myQuizCount = useMemo(() => {
        if (!currentUser) return 0;
        return quizzes.filter(q => {
            if (q.createdBy !== currentUser.id) return false;
            const effectiveYear = quizYearOverrides[q.id] || q.academicYear || getQuizAcademicYear(q);
            if (qAcademicYearFilter !== 'all' && effectiveYear !== qAcademicYearFilter) return false;
            if (qGradeFilter !== 'all' && q.grade !== qGradeFilter) return false;
            const creator = teachers.find(t => t.id === q.createdBy);
            const effectiveSubject = q.subject || creator?.subject;
            if (currentUser.subject && effectiveSubject && !isSameSubject(effectiveSubject, currentUser.subject)) return false;
            return true;
        }).length;
    }, [quizzes, currentUser, qAcademicYearFilter, qGradeFilter, quizYearOverrides, teachers]);

    const sharedQuizCount = useMemo(() => {
        if (!currentUser) return 0;
        return quizzes.filter(q => {
            if (q.createdBy === currentUser.id) return false;
            const isShared = quizShareOverrides[q.id] !== undefined
                ? quizShareOverrides[q.id]
                : (q.isSharedWithTeachers !== undefined ? Boolean(q.isSharedWithTeachers) : !q.createdBy);
            if (!isShared) return false;
            const effectiveYear = quizYearOverrides[q.id] || q.academicYear || getQuizAcademicYear(q);
            if (qAcademicYearFilter !== 'all' && effectiveYear !== qAcademicYearFilter) return false;
            if (qGradeFilter !== 'all' && q.grade !== qGradeFilter) return false;
            const creator = teachers.find(t => t.id === q.createdBy);
            const effectiveSubject = q.subject || creator?.subject;
            if (currentUser.subject && effectiveSubject && !isSameSubject(effectiveSubject, currentUser.subject)) return false;
            return true;
        }).length;
    }, [quizzes, currentUser, qAcademicYearFilter, qGradeFilter, quizYearOverrides, quizShareOverrides, teachers]);

    const counts = useMemo(() => {
        let all = 0;
        let open = 0;
        let draft = 0;
        let expired = 0;
        let byClass = 0;
        let byGrade = 0;

        baseFiltered.forEach(q => {
            all++;
            const status = getQuizStatus(q);
            if (status.isOpen) open++;
            if (status.isDraft) draft++;
            if (status.isExpired) expired++;
            if (status.isClassTargeted) byClass++;
            if (status.isGradeTargeted) byGrade++;
        });

        return { all, open, draft, expired, byClass, byGrade };
    }, [baseFiltered]);

    const filtered = useMemo(() => {
        return baseFiltered.filter(q => {
            if (quickFilter === 'all') return true;
            const status = getQuizStatus(q);
            if (quickFilter === 'open') return status.isOpen;
            if (quickFilter === 'draft') return status.isDraft;
            if (quickFilter === 'expired') return status.isExpired;
            if (quickFilter === 'class') return status.isClassTargeted;
            if (quickFilter === 'grade') return status.isGradeTargeted;
            return true;
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [baseFiltered, quickFilter]);

    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [qSearch, qSubjectFilter, qGradeFilter, qChapterFilter, authorFilter, quickFilter]);

    const visibleQuizzes = filtered.slice(0, visibleCount);

    const resultCountsMap = useMemo(() => {
        const map: Record<string, number> = {};
        results.forEach(r => {
            if (r.quizId) {
                map[r.quizId] = (map[r.quizId] || 0) + 1;
            }
        });
        return map;
    }, [results]);

    const teachersMap = useMemo(() => {
        const map: Record<string, User> = {};
        teachers.forEach(t => {
            if (t.id) map[t.id] = t;
        });
        return map;
    }, [teachers]);

    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [assigningQuiz, setAssigningQuiz] = useState<Quiz | null>(null);
    const [selectedClassIdsForAssign, setSelectedClassIdsForAssign] = useState<string[]>([]);
    const [isSavingAssign, setIsSavingAssign] = useState<boolean>(false);
    const [assignGradeFilter, setAssignGradeFilter] = useState<'matching' | 'all'>('matching');
    const [assignSearchClass, setAssignSearchClass] = useState<string>('');

    const openAssignModal = useCallback((q: Quiz) => {
        const isMine = Boolean(currentUser?.id && q.createdBy === currentUser.id);
        if (!isSuperAdmin && !isMine) {
            alert("Chức năng giao đề chia sẻ cho lớp chỉ dành riêng cho Quản trị viên (SuperAdmin). Bạn có thể xem và in đề.");
            return;
        }
        setAssigningQuiz(q);
        setSelectedClassIdsForAssign(q.assignedClassIds || []);
        setAssignGradeFilter('matching');
        setAssignSearchClass('');
    }, [currentUser?.id, isSuperAdmin]);

    const [schedulingQuiz, setSchedulingQuiz] = useState<Quiz | null>(null);
    const [scheduleStartTime, setScheduleStartTime] = useState<string>('');
    const [scheduleEndTime, setScheduleEndTime] = useState<string>('');
    const [isSavingSchedule, setIsSavingSchedule] = useState<boolean>(false);
    const [scheduleSuccessMsg, setScheduleSuccessMsg] = useState<string | null>(null);

    const openScheduleModal = useCallback((q: Quiz) => {
        setSchedulingQuiz(q);
        setScheduleStartTime(formatToDatetimeLocal(q.startTime));
        setScheduleEndTime(formatToDatetimeLocal(q.endTime));
        setScheduleSuccessMsg(null);
    }, []);

    const handleSaveSchedule = async () => {
        if (!schedulingQuiz) return;
        setIsSavingSchedule(true);
        try {
            const cleanStart = normalizeDateTimeForStorage(scheduleStartTime);
            const cleanEnd = normalizeDateTimeForStorage(scheduleEndTime);
            if (onUpdateSchedule) {
                await onUpdateSchedule(schedulingQuiz.id, cleanStart, cleanEnd);
            } else {
                await updateQuizSchedule(schedulingQuiz.id, cleanStart, cleanEnd);
            }
            // Update quiz reference in place so card badge updates immediately
            schedulingQuiz.startTime = cleanStart || '';
            schedulingQuiz.endTime = cleanEnd || '';
            setScheduleSuccessMsg("Đã lưu khung thời gian mở đề thi thành công!");
            setTimeout(() => {
                setSchedulingQuiz(null);
                setScheduleSuccessMsg(null);
            }, 800);
        } catch (err: any) {
            console.error("Lỗi khi lưu thời gian mở đề:", err);
            alert("Lỗi khi lưu thời gian mở đề: " + (err.message || "Không thể cập nhật"));
        } finally {
            setIsSavingSchedule(false);
        }
    };

    const handleSaveAssignment = async () => {
        if (!assigningQuiz) return;
        setIsSavingAssign(true);
        try {
            if (onAssignClasses) {
                await onAssignClasses(assigningQuiz, selectedClassIdsForAssign);
            }
            setAssigningQuiz(null);
        } catch (err) {
            console.error("Lỗi giao đề:", err);
        } finally {
            setIsSavingAssign(false);
        }
    };

    // Lọc danh sách lớp có thể phân công
    const classesForAssignment = useMemo(() => {
        if (!assigningQuiz) return [];
        let list = classes || [];
        // Nếu là GV thường: ưu tiên lớp do GV tạo hoặc lớp được chia sẻ
        if (!isSuperAdmin) {
            list = list.filter(c => (c.createdBy && c.createdBy === currentUser?.id) || c.isSharedWithTeachers);
        }
        // Lọc theo khối tương ứng nếu đang chọn 'matching'
        if (assignGradeFilter === 'matching' && assigningQuiz.grade !== 'all') {
            list = list.filter(c => String(c.grade) === String(assigningQuiz.grade) || c.grade === 'all');
        }
        // Tìm kiếm lớp
        if (assignSearchClass.trim()) {
            const query = assignSearchClass.trim().toLowerCase();
            list = list.filter(c => c.name.toLowerCase().includes(query) || (c.academicYear && c.academicYear.toLowerCase().includes(query)));
        }
        return list;
    }, [classes, assigningQuiz, isSuperAdmin, currentUser?.id, assignGradeFilter, assignSearchClass]);

    const copyQuizLink = useCallback((quizId: string) => {
        const url = `${window.location.origin}/?quiz=${quizId}`;
        navigator.clipboard.writeText(url).then(() => {
            setCopiedId(quizId);
            setTimeout(() => setCopiedId(null), 3000);
        });
    }, []);

    return (
        <div className="space-y-8 animate-fade-in relative">
            {copiedId && (
                <div className="fixed bottom-6 right-6 z-[6000] bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/20 animate-bounce text-xs font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"/>
                    Đã sao chép link đề thi ẩn vào bộ nhớ tạm!
                </div>
            )}
            {/* Filter Bar */}
            <div className="flex flex-col gap-4 bg-white p-5 lg:p-6 rounded-[2rem] border shadow-sm">
                <div className="flex flex-col lg:flex-row gap-4 items-center">
                    <div className="flex-1 w-full relative">
                        <input 
                            className="w-full p-4 bg-slate-50 border rounded-2xl outline-none text-xs font-bold pl-10 text-slate-800" 
                            placeholder="Tìm tên đề thi..." 
                            value={qSearch} 
                            onChange={e => setQSearch(e.target.value)} 
                        />
                        <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={14}/>
                    </div>
                    <div className="flex flex-wrap gap-3 w-full lg:w-auto">
                        {/* Dropdown Môn học (Dành riêng cho SuperAdmin hoặc hiển thị cho toàn trường) */}
                        {isSuperAdmin ? (
                            <div className="flex items-center gap-1.5 bg-purple-50 px-3 py-1 rounded-xl border border-purple-200 shadow-sm">
                                <BookOpen size={14} className="text-purple-600 shrink-0" />
                                <select 
                                    className="bg-transparent py-2 text-[10px] font-black text-purple-900 uppercase outline-none cursor-pointer" 
                                    value={qSubjectFilter} 
                                    onChange={e => setQSubjectFilter(e.target.value)}
                                >
                                    <option value="all">TẤT CẢ MÔN (SUPERADMIN)</option>
                                    {availableSubjects.map(s => (
                                        <option key={s} value={s}>MÔN {s.toUpperCase()}</option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            currentUser?.subject && (
                                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                                    <BookOpen size={13} className="text-indigo-500 shrink-0" />
                                    <span className="text-[10px] font-black uppercase text-slate-700">
                                        MÔN {currentUser.subject.toUpperCase()}
                                    </span>
                                </div>
                            )
                        )}

                        {/* Dropdown Niên học */}
                        <div className="flex items-center gap-1.5 bg-sky-50 px-3 py-1 rounded-xl border border-sky-200 shadow-sm">
                            <CalendarDays size={14} className="text-sky-600 shrink-0" />
                            <select 
                                className="bg-transparent py-2 text-[10px] font-black text-sky-900 uppercase outline-none cursor-pointer" 
                                value={qAcademicYearFilter} 
                                onChange={e => setQAcademicYearFilter(e.target.value)}
                            >
                                <option value="all">📅 TẤT CẢ NIÊN HỌC</option>
                                {getAcademicYearOptions(quizzes.map(q => q.academicYear)).map(yr => (
                                    <option key={yr} value={yr}>
                                        📅 NH {yr} {yr === getCurrentAcademicYear() ? '(HIỆN HÀNH)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Dropdown Khối */}
                        <select 
                            className="flex-1 lg:w-36 px-4 py-3 bg-white border rounded-xl text-[10px] font-black uppercase outline-none cursor-pointer" 
                            value={qGradeFilter} 
                            onChange={e => { setQGradeFilter(e.target.value as any); }}
                        >
                            <option value="all">TẤT CẢ KHỐI</option>
                            <option value="12">KHỐI 12</option>
                            <option value="11">KHỐI 11</option>
                            <option value="10">KHỐI 10</option>
                        </select>

                        {/* Dropdown Chương (Tự động lọc theo Khối & Môn học) */}
                        <select 
                            className="flex-1 lg:w-48 px-4 py-3 bg-white border rounded-xl text-[10px] font-black uppercase outline-none cursor-pointer" 
                            value={qChapterFilter} 
                            onChange={e => setQChapterFilter(e.target.value)}
                        >
                            <option value="all">TẤT CẢ CHƯƠNG ({relevantChapters.length})</option>
                            {relevantChapters.map(c => (
                                <option key={c.id} value={c.name}>{c.name || (c as any).title || "Chương chưa đặt tên"}</option>
                            ))}
                        </select>

                        {/* Dropdown Giáo viên (Tự động lọc theo Môn học) */}
                        {isSuperAdmin ? (
                            <select 
                                className="flex-1 lg:w-48 px-4 py-3 bg-amber-50/50 border border-amber-200 text-amber-900 rounded-xl text-[10px] font-black uppercase outline-none cursor-pointer"
                                value={authorFilter}
                                onChange={e => setAuthorFilter(e.target.value)}
                            >
                                <option value="all">👤 TẤT CẢ TÁC GIẢ</option>
                                <option value="shared">🤝 TẤT CẢ ĐỀ ĐÃ CHIA SẺ GV</option>
                                <option value="private">🔒 ĐỀ RIÊNG TƯ (CHƯA CHIA SẺ)</option>
                                <optgroup label={`LỌC THEO GIÁO VIÊN (${filteredTeachers.length})`}>
                                    {filteredTeachers.map(t => (
                                        <option key={t.id} value={t.id}>
                                            GV: {t.fullName} {t.subject ? `(${t.subject})` : ''}
                                        </option>
                                    ))}
                                </optgroup>
                            </select>
                        ) : (
                            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200 shadow-xs">
                                <button
                                    type="button"
                                    onClick={() => setAuthorFilter('mine')}
                                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-1.5 ${
                                        authorFilter === 'mine'
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                                    }`}
                                    title="Mặc định: Chỉ hiển thị các đề thi do bạn tạo"
                                >
                                    <FileText size={13} />
                                    <span>Đề của tôi</span>
                                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                                        authorFilter === 'mine' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-700'
                                    }`}>
                                        {myQuizCount}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleOpenSharedQuizzes}
                                    disabled={isLoadingShared}
                                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-1.5 ${
                                        authorFilter === 'shared'
                                            ? 'bg-indigo-600 text-white shadow-sm'
                                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                                    }`}
                                    title="Đọc tiếp và hiển thị đề các giáo viên khác trong tổ bộ môn chia sẻ"
                                >
                                    {isLoadingShared ? <Loader2 size={13} className="animate-spin text-indigo-600" /> : <Share2 size={13} />}
                                    <span>Đề GV khác chia sẻ</span>
                                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                                        authorFilter === 'shared' ? 'bg-indigo-700 text-white' : 'bg-slate-200 text-slate-700'
                                    }`}>
                                        {sharedQuizCount}
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Filter Pill Sub-bar */}
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0 select-none mr-1">
                        LỌC NHANH:
                    </span>
                    
                    <button
                        onClick={() => setQuickFilter('all')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black uppercase transition-all shadow-sm ${
                            quickFilter === 'all'
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                        TẤT CẢ ({counts.all})
                    </button>

                    <button
                        onClick={() => setQuickFilter('open')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black uppercase transition-all shadow-sm ${
                            quickFilter === 'open'
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-emerald-300'
                        }`}
                    >
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 inline-block"/>
                        ĐANG MỞ ({counts.open})
                    </button>

                    <button
                        onClick={() => setQuickFilter('draft')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black uppercase transition-all shadow-sm ${
                            quickFilter === 'draft'
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                    >
                        <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-400 bg-white shrink-0 inline-block"/>
                        BẢN NHÁP ({counts.draft})
                    </button>

                    <button
                        onClick={() => setQuickFilter('expired')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black uppercase transition-all shadow-sm ${
                            quickFilter === 'expired'
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-amber-300'
                        }`}
                    >
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 inline-block"/>
                        HẾT HẠN ({counts.expired})
                    </button>

                    <button
                        onClick={() => setQuickFilter('class')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black uppercase transition-all shadow-sm ${
                            quickFilter === 'class'
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-indigo-300'
                        }`}
                    >
                        <span className="text-sm leading-none">🏫</span>
                        THEO LỚP ({counts.byClass})
                    </button>

                    <button
                        onClick={() => setQuickFilter('grade')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black uppercase transition-all shadow-sm ${
                            quickFilter === 'grade'
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-sky-300'
                        }`}
                    >
                        <span className="text-sm leading-none">🌐</span>
                        TOÀN KHỐI ({counts.byGrade})
                    </button>
                </div>
            </div>

            {/* Banner thông báo khi GV đang xem đề được chia sẻ */}
            {!isSuperAdmin && authorFilter === 'shared' && (
                <div className="p-3.5 bg-indigo-50/90 border border-indigo-200 rounded-2xl flex items-center justify-between gap-3 text-xs text-indigo-900 shadow-xs">
                    <div className="flex items-center gap-2.5">
                        <Share2 size={16} className="text-indigo-600 shrink-0" />
                        <div>
                            <span className="font-bold">Đề thi chia sẻ từ đồng nghiệp:</span> Đang hiển thị các đề do giáo viên khác trong tổ bộ môn <b>{currentUser?.subject || ''}</b> chia sẻ.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setAuthorFilter('mine')}
                        className="px-3.5 py-1.5 bg-white hover:bg-indigo-600 hover:text-white text-indigo-700 border border-indigo-300 rounded-xl text-[10px] font-black uppercase transition-all shadow-xs shrink-0"
                    >
                        Quay lại đề của tôi
                    </button>
                </div>
            )}

            {/* Quizzes Grid - Giao diện Card Đề Ngang (Horizontal Landscape) */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {visibleQuizzes.map(q => {
                    const isMine = Boolean(currentUser?.id && q.createdBy === currentUser.id);
                    const canManage = isSuperAdmin || isMine;
                    const creator = teachersMap[q.createdBy || ''];
                    const creatorSubj = creator?.subject;
                    const resCount = resultCountsMap[q.id] || 0;

                    return (
                        <QuizCardItem
                            key={q.id}
                            quiz={q}
                            isMine={isMine}
                            isSuperAdmin={isSuperAdmin}
                            canManage={canManage}
                            creatorSubject={creatorSubj}
                            classes={classes}
                            resultCount={resCount}
                            quizYearOverride={quizYearOverrides[q.id]}
                            updatingYearQuizId={updatingYearQuizId}
                            quizShareOverride={quizShareOverrides[q.id]}
                            updatingShareQuizId={updatingShareQuizId}
                            onPreview={onPreview}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            openAssignModal={openAssignModal}
                            openScheduleModal={openScheduleModal}
                            copyQuizLink={copyQuizLink}
                            handleSetAcademicYear={handleSetAcademicYear}
                            handleToggleShare={handleToggleShare}
                        />
                    );
                })}
            </div>

            {visibleCount < filtered.length && (
                <div className="py-10 text-center">
                    <button 
                        onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                        className="inline-flex items-center gap-2 px-10 py-4 bg-white border-2 border-slate-200 rounded-full text-[10px] font-black uppercase text-slate-500 hover:bg-slate-900 hover:text-white transition-all shadow-xl"
                    >
                        <ChevronDown size={16}/> Tải thêm đề thi (Còn {filtered.length - visibleCount})
                    </button>
                </div>
            )}
            
            {filtered.length === 0 && (
                <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
                    <p className="text-slate-400 font-black uppercase text-xs tracking-wider">
                        {authorFilter === 'mine' 
                            ? `Bạn chưa có đề thi nào cho ${qGradeFilter === 'all' ? 'tất cả khối' : `Khối ${qGradeFilter}`} (Niên học ${qAcademicYearFilter === 'all' ? 'tất cả' : qAcademicYearFilter}).`
                            : authorFilter === 'shared'
                            ? `Chưa có giáo viên nào trong bộ môn ${currentUser?.subject || ''} chia sẻ đề thi cho ${qGradeFilter === 'all' ? 'tất cả khối' : `Khối ${qGradeFilter}`}.`
                            : 'Không tìm thấy đề thi phù hợp với bộ lọc.'
                        }
                    </p>
                    {authorFilter === 'shared' ? (
                        <button
                            type="button"
                            onClick={() => setAuthorFilter('mine')}
                            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase shadow-sm hover:bg-slate-900 transition-all"
                        >
                            Quay lại Đề của tôi
                        </button>
                    ) : (
                        sharedQuizCount > 0 && (
                            <button
                                type="button"
                                onClick={handleOpenSharedQuizzes}
                                className="mt-4 px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-[10px] font-black uppercase shadow-sm hover:bg-indigo-600 hover:text-white transition-all inline-flex items-center gap-1.5"
                            >
                                <Share2 size={13} />
                                Xem {sharedQuizCount} đề do GV khác chia sẻ
                            </button>
                        )
                    )}
                </div>
            )}

            {/* Modal Giao đề cho Lớp học */}
            {assigningQuiz && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[5000] flex items-center justify-center p-3 md:p-6 animate-fade-in">
                    <div className="bg-white rounded-[2.5rem] max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border-4 border-white animate-scale-up">
                        
                        {/* Header Modal */}
                        <div className="p-6 bg-slate-900 text-white flex justify-between items-center gap-4 shrink-0 border-b border-slate-800">
                            <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-2xl ${
                                    (!assigningQuiz.createdBy || assigningQuiz.createdBy === currentUser?.id)
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-emerald-600 text-white'
                                } shadow-lg`}>
                                    <GraduationCap size={24}/>
                                </div>
                                <div>
                                    <h3 className="text-base font-black uppercase tracking-tight leading-tight">
                                        GIAO ĐỀ CHO LỚP HỌC
                                    </h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                        Khối {assigningQuiz.grade} {assigningQuiz.subject ? `• Môn ${assigningQuiz.subject}` : ''}
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setAssigningQuiz(null)}
                                className="p-2.5 bg-slate-800 hover:bg-red-600 rounded-xl text-slate-400 hover:text-white transition-colors"
                            >
                                <X size={20}/>
                            </button>
                        </div>

                        {/* Body Modal */}
                        <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar">
                            
                            {/* Quiz info banner */}
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-xs font-black uppercase text-slate-800 line-clamp-1">
                                        {assigningQuiz.title}
                                    </span>
                                    <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[9px] font-black uppercase text-slate-600 shadow-sm">
                                        {assigningQuiz.questionCount || (assigningQuiz.questions ? assigningQuiz.questions.length : 0)} CÂU
                                    </span>
                                </div>

                                {assigningQuiz.createdByName && (
                                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold">
                                        <UserIcon size={12} className="text-slate-400"/>
                                        <span>Tác giả: <strong className="text-slate-700">{assigningQuiz.createdByName}</strong></span>
                                        {assigningQuiz.isSharedWithTeachers && (
                                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-[8px] font-black uppercase">
                                                Chia sẻ cùng môn
                                            </span>
                                        )}
                                    </div>
                                )}

                                {(!isSuperAdmin && assigningQuiz.createdBy && assigningQuiz.createdBy !== currentUser?.id) && (
                                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-[11px] text-emerald-800 font-bold mt-2">
                                        <Info size={16} className="text-emerald-600 shrink-0 mt-0.5"/>
                                        <p className="leading-relaxed">
                                            Đây là đề thi được chia sẻ bởi đồng nghiệp. Thầy/cô có thể chọn các lớp mình phụ trách bên dưới để giao bài cho học sinh. Thầy/cô không có quyền sửa hoặc xoá nội dung đề gốc.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Filters & Tools */}
                            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setAssignGradeFilter('matching')}
                                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                                            assignGradeFilter === 'matching'
                                                ? 'bg-slate-900 text-white shadow-sm'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                    >
                                        Lớp Khối {assigningQuiz.grade}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAssignGradeFilter('all')}
                                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                                            assignGradeFilter === 'all'
                                                ? 'bg-slate-900 text-white shadow-sm'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                    >
                                        Tất cả lớp
                                    </button>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const allIds = classesForAssignment.map(c => c.id);
                                            const combined = Array.from(new Set([...selectedClassIdsForAssign, ...allIds]));
                                            setSelectedClassIdsForAssign(combined);
                                        }}
                                        className="text-[10px] font-black uppercase text-blue-600 hover:text-blue-800 px-2 py-1 hover:bg-blue-50 rounded-lg transition-colors"
                                    >
                                        Chọn tất cả
                                    </button>
                                    <span className="text-slate-300">|</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const currentIds = classesForAssignment.map(c => c.id);
                                            setSelectedClassIdsForAssign(selectedClassIdsForAssign.filter(id => !currentIds.includes(id)));
                                        }}
                                        className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-700 px-2 py-1 hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                        Bỏ chọn
                                    </button>
                                    <span className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl text-[10px] font-black uppercase">
                                        Đã chọn: {selectedClassIdsForAssign.length}
                                    </span>
                                </div>
                            </div>

                            {/* Search box for classes */}
                            <input
                                type="text"
                                placeholder="Tìm kiếm tên lớp học, niên khóa..."
                                value={assignSearchClass}
                                onChange={(e) => setAssignSearchClass(e.target.value)}
                                className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold outline-none focus:border-blue-500 focus:bg-white transition-all text-slate-800"
                            />

                            {/* Classes Grid */}
                            {classesForAssignment.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {classesForAssignment.map(c => {
                                        const isSelected = selectedClassIdsForAssign.includes(c.id);
                                        const isMyClass = c.createdBy === currentUser?.id;
                                        return (
                                            <div
                                                key={c.id}
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setSelectedClassIdsForAssign(selectedClassIdsForAssign.filter(id => id !== c.id));
                                                    } else {
                                                        setSelectedClassIdsForAssign([...selectedClassIdsForAssign, c.id]);
                                                    }
                                                }}
                                                className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                                    isSelected
                                                        ? 'bg-blue-50/70 border-blue-500 shadow-sm'
                                                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className={`p-2 rounded-xl shrink-0 ${
                                                        isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'
                                                    }`}>
                                                        {isSelected ? <Check size={16}/> : <Square size={16}/>}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className="font-black text-sm text-slate-800 uppercase tracking-tight">
                                                                {c.name}
                                                            </span>
                                                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[8px] font-black uppercase">
                                                                Khối {c.grade}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-slate-400 truncate mt-0.5">
                                                            NK: {c.academicYear || 'Chung'} {c.teacherName ? `• GV: ${c.teacherName}` : (isMyClass ? '• Lớp của bạn' : '')}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="py-12 text-center text-slate-400 font-bold text-xs space-y-2">
                                    <p>Không tìm thấy lớp học nào phù hợp.</p>
                                    <p className="text-[10px] text-slate-400">Thầy/cô có thể tạo thêm lớp trong mục "Quản lý Lớp học".</p>
                                </div>
                            )}
                        </div>

                        {/* Footer Modal */}
                        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end items-center gap-3 shrink-0">
                            <button
                                type="button"
                                onClick={() => setAssigningQuiz(null)}
                                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-black uppercase transition-all"
                            >
                                Hủy bỏ
                            </button>
                            <button
                                type="button"
                                disabled={isSavingAssign}
                                onClick={handleSaveAssignment}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSavingAssign ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                                        <span>Đang lưu...</span>
                                    </>
                                ) : (
                                    <>
                                        <Check size={16}/>
                                        <span>Lưu Phân Công Giao Đề</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Hẹn giờ Mở / Đóng Đề Thi */}
            {schedulingQuiz && (
                <div className="fixed inset-0 z-[5500] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header Modal */}
                        <div className="p-5 bg-slate-900 text-white flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-2xl bg-blue-600 text-white shadow-lg">
                                    <Clock size={24}/>
                                </div>
                                <div>
                                    <h3 className="text-base font-black uppercase tracking-tight leading-tight">
                                        HẸN GIỜ MỞ / ĐÓNG ĐỀ THI
                                    </h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                        {schedulingQuiz.type === 'test' ? 'Chế độ Làm bài tính điểm' : 'Chế độ Luyện tập'} • {schedulingQuiz.durationMinutes || 45} phút
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setSchedulingQuiz(null)}
                                className="p-2.5 bg-slate-800 hover:bg-rose-600 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
                            >
                                <X size={20}/>
                            </button>
                        </div>

                        {/* Body Modal */}
                        <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar">
                            {/* Quiz info banner */}
                            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                                <span className="text-xs font-black uppercase text-slate-800 line-clamp-1">
                                    {schedulingQuiz.title}
                                </span>
                                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold mt-1">
                                    <span>Khối {schedulingQuiz.grade}</span>
                                    {schedulingQuiz.subject && <span>• Môn {schedulingQuiz.subject}</span>}
                                    <span>• {schedulingQuiz.questionCount || 0} câu</span>
                                </div>
                            </div>

                            {/* Nút bấm nhanh (Presets) */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                    ⚡ Thiết lập nhanh khung giờ
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const now = new Date();
                                            const formatted = formatToDatetimeLocal(now);
                                            setScheduleStartTime(formatted);
                                            setScheduleEndTime(formatted);
                                        }}
                                        className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-1 cursor-pointer"
                                    >
                                        <Zap size={12}/> Bắt đầu ngay
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!scheduleStartTime}
                                        onClick={() => setScheduleEndTime(scheduleStartTime)}
                                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all cursor-pointer ${
                                            scheduleEndTime && scheduleEndTime === scheduleStartTime
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40'
                                        }`}
                                    >
                                        🎯 Đặt X = Y (Thi đồng loạt)
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!scheduleStartTime}
                                        onClick={() => {
                                            const d = new Date(scheduleStartTime || Date.now());
                                            d.setMinutes(d.getMinutes() + 30);
                                            setScheduleEndTime(formatToDatetimeLocal(d));
                                        }}
                                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-[10px] font-black uppercase transition-all disabled:opacity-40 cursor-pointer"
                                    >
                                        +30 phút
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!scheduleStartTime}
                                        onClick={() => {
                                            const d = new Date(scheduleStartTime || Date.now());
                                            d.setHours(d.getHours() + 1);
                                            setScheduleEndTime(formatToDatetimeLocal(d));
                                        }}
                                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-[10px] font-black uppercase transition-all disabled:opacity-40 cursor-pointer"
                                    >
                                        +1 giờ
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!scheduleStartTime}
                                        onClick={() => {
                                            const d = new Date(scheduleStartTime || Date.now());
                                            d.setHours(d.getHours() + 2);
                                            setScheduleEndTime(formatToDatetimeLocal(d));
                                        }}
                                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-[10px] font-black uppercase transition-all disabled:opacity-40 cursor-pointer"
                                    >
                                        +2 giờ
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!scheduleStartTime}
                                        onClick={() => {
                                            const d = new Date(scheduleStartTime || Date.now());
                                            d.setHours(23, 59, 0, 0);
                                            setScheduleEndTime(formatToDatetimeLocal(d));
                                        }}
                                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-[10px] font-black uppercase transition-all disabled:opacity-40 cursor-pointer"
                                    >
                                        Hết ngày (23:59)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setScheduleStartTime('');
                                            setScheduleEndTime('');
                                        }}
                                        className="px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 rounded-xl text-[10px] font-black uppercase transition-all cursor-pointer"
                                    >
                                        ✕ Mở tự do (Xóa giờ)
                                    </button>
                                </div>
                            </div>

                            {/* Inputs datetime */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-blue-600 uppercase flex items-center gap-1.5">
                                        <Clock size={12}/> Giờ mở phòng thi (Mốc X)
                                    </label>
                                    <input 
                                        type="datetime-local" 
                                        className="w-full border-2 border-blue-200 rounded-2xl p-3 text-xs font-black bg-white focus:border-blue-500 outline-none shadow-xs" 
                                        value={formatToDatetimeLocal(scheduleStartTime)} 
                                        onChange={e => {
                                            setScheduleStartTime(e.target.value);
                                            if (!scheduleEndTime) setScheduleEndTime(e.target.value);
                                        }} 
                                    />
                                    <p className="text-[9px] text-slate-400 font-bold">Học sinh bắt đầu được vào làm bài từ giờ này.</p>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-indigo-600 uppercase flex items-center gap-1.5">
                                        <Timer size={12}/> Giờ đóng phòng thi (Mốc Y)
                                    </label>
                                    <input 
                                        type="datetime-local" 
                                        className="w-full border-2 border-indigo-200 rounded-2xl p-3 text-xs font-black bg-white focus:border-indigo-500 outline-none shadow-xs" 
                                        value={formatToDatetimeLocal(scheduleEndTime)} 
                                        onChange={e => setScheduleEndTime(e.target.value)} 
                                    />
                                    <p className="text-[9px] text-slate-400 font-bold">Sau giờ này học sinh không thể vào làm bài mới.</p>
                                </div>
                            </div>

                            {/* Giải thích trạng thái thời gian */}
                            {scheduleStartTime ? (
                                scheduleEndTime && scheduleStartTime !== scheduleEndTime && new Date(scheduleEndTime) > new Date(scheduleStartTime) ? (
                                    <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl text-xs text-emerald-900 leading-relaxed font-medium">
                                        <p className="font-black uppercase text-[11px] text-emerald-800 mb-0.5">
                                            ✅ Khung giờ mở linh hoạt
                                        </p>
                                        Học sinh có thể vào thi bất kỳ lúc nào từ <b>{new Date(scheduleStartTime).toLocaleString('vi-VN')}</b> đến <b>{new Date(scheduleEndTime).toLocaleString('vi-VN')}</b> và đều có trọn vẹn <b>{schedulingQuiz.durationMinutes || 45} phút</b> làm bài.
                                    </div>
                                ) : (
                                    <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl text-xs text-amber-900 leading-relaxed font-medium">
                                        <p className="font-black uppercase text-[11px] text-amber-800 mb-0.5">
                                            🎯 Thi đồng loạt (X = Y)
                                        </p>
                                        Phòng thi mở lúc <b>{new Date(scheduleStartTime).toLocaleString('vi-VN')}</b>. Tất cả học sinh nộp bài trước hạn chót sau <b>{schedulingQuiz.durationMinutes || 45} phút</b>. Vào trễ sẽ bị trừ thời gian làm bài.
                                    </div>
                                )
                            ) : (
                                <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-2xl text-xs text-slate-600 font-medium">
                                    💡 <b>Mở tự do:</b> Đề thi sẽ mở liên tục cho học sinh sau khi công khai, không bị giới hạn giờ mở hay đóng.
                                </div>
                            )}

                            {scheduleSuccessMsg && (
                                <div className="p-3 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
                                    <CheckCircle2 size={16} className="text-emerald-600"/>
                                    <span>{scheduleSuccessMsg}</span>
                                </div>
                            )}
                        </div>

                        {/* Footer Modal */}
                        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end items-center gap-3 shrink-0">
                            <button
                                type="button"
                                onClick={() => setSchedulingQuiz(null)}
                                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-black uppercase transition-all cursor-pointer"
                            >
                                Hủy bỏ
                            </button>
                            <button
                                type="button"
                                disabled={isSavingSchedule}
                                onClick={handleSaveSchedule}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                            >
                                {isSavingSchedule ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                                        <span>Đang lưu...</span>
                                    </>
                                ) : (
                                    <>
                                        <Check size={16}/>
                                        <span>Lưu Thời Gian Mở Đề</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Thông báo Chia sẻ */}
            {shareNotification && (
                <div className="fixed bottom-6 right-6 z-[6000] bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3.5 animate-in fade-in slide-in-from-bottom-4 duration-200">
                    <div className={`p-2.5 rounded-xl shrink-0 ${shareNotification.isShared ? 'bg-blue-600' : 'bg-slate-700'}`}>
                        <Share2 size={18} className="text-white"/>
                    </div>
                    <div>
                        <div className="text-xs font-black uppercase tracking-tight">
                            {shareNotification.isShared ? 'Đã bật chia sẻ đề thi' : 'Đã chuyển về đề riêng tư'}
                        </div>
                        <div className="text-[11px] text-slate-300 mt-0.5">
                            {shareNotification.isShared 
                                ? 'Các giáo viên khác cùng bộ môn đã có thể xem và giao đề cho các lớp.' 
                                : 'Đề thi hiện chỉ hiển thị cho bạn và Ban giám hiệu (Super Admin).'}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}