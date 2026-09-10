import React, { useState, useEffect } from 'react';
import { X, UserCog, BookOpen, Trophy, Clock, Eye, Loader2, Award, Calendar, GraduationCap, Key, User, CheckCircle2 } from 'lucide-react';
import { User as UserType, Result, Quiz } from '../../types';
import { format } from 'date-fns';
import { getResultsForStudent, getQuizzesMetadata } from '../../services/storage';

interface StudentDetailModalProps {
    student: UserType | null;
    results?: Result[];
    quizzes?: Quiz[];
    onClose: () => void;
    onViewResult: (res: Result) => void;
}

export default function StudentDetailModal({ student, results: initialResults = [], quizzes: initialQuizzes = [], onClose, onViewResult }: StudentDetailModalProps) {
    if (!student) return null;

    const [loading, setLoading] = useState(true);
    const [studentResults, setStudentResults] = useState<Result[]>([]);
    const [quizzesList, setQuizzesList] = useState<Quiz[]>(initialQuizzes);

    useEffect(() => {
        let isMounted = true;

        const loadStudentData = async () => {
            setLoading(true);
            try {
                // 1. Tải kết quả thi riêng của học sinh này từ Database (on-demand / lazy-loading)
                const [fetchedResults, fetchedQuizzes] = await Promise.all([
                    getResultsForStudent(student.id, student.studentCode),
                    quizzesList.length > 0 ? Promise.resolve(quizzesList) : getQuizzesMetadata()
                ]);

                if (isMounted) {
                    setStudentResults(fetchedResults);
                    if (fetchedQuizzes && fetchedQuizzes.length > 0) {
                        setQuizzesList(fetchedQuizzes);
                    }
                }
            } catch (err) {
                console.error("Lỗi khi tải chi tiết bài làm học sinh:", err);
                if (isMounted && initialResults.length > 0) {
                    // Fallback to initialResults if available
                    const filtered = initialResults.filter(r => 
                        r.studentId === student.id || 
                        (student.studentCode && r.studentCode && r.studentCode.trim().toUpperCase() === student.studentCode.trim().toUpperCase())
                    );
                    setStudentResults(filtered);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        loadStudentData();

        return () => {
            isMounted = false;
        };
    }, [student.id, student.studentCode]);

    const totalQuizzes = studentResults.length;
    const avgScore = totalQuizzes > 0 ? (studentResults.reduce((acc, r) => acc + (Number(r.score) || 0), 0) / totalQuizzes) : 0;
    const maxScore = totalQuizzes > 0 ? Math.max(...studentResults.map(r => Number(r.score) || 0)) : 0;
    const totalSeconds = studentResults.reduce((acc, r) => acc + (Number(r.durationSeconds) || 0), 0);
    
    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    };

    const formatSubmittedDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return format(d, 'HH:mm - dd/MM/yyyy');
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/80 z-[1000] flex items-center justify-center p-4 backdrop-blur-md animate-fade-in">
            <div className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border-4 border-white shadow-2xl">
                {/* Header Modal */}
                <div className="p-6 md:p-8 bg-slate-900 text-white flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg text-white">
                            <UserCog size={28}/>
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-lg md:text-xl font-black uppercase tracking-tight">{student.fullName}</h3>
                                <span className="bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-lg">
                                    MAHS: {student.studentCode || 'N/A'}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap font-bold">
                                <span>Khối: <strong className="text-white">{student.grade || '-'}</strong></span>
                                <span>•</span>
                                <span>Lớp: <strong className="text-indigo-300">{student.className || 'Chưa phân lớp'}</strong></span>
                                {student.academicYear && (
                                    <>
                                        <span>•</span>
                                        <span>Niên khóa: <strong className="text-white">{student.academicYear}</strong></span>
                                    </>
                                )}
                                {student.username && (
                                    <>
                                        <span>•</span>
                                        <span>Tài khoản: <strong className="text-yellow-400 font-mono">{student.username}</strong></span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="p-3 bg-slate-800 rounded-xl hover:bg-red-600 transition-colors text-slate-300 hover:text-white"
                        title="Đóng"
                    >
                        <X size={20}/>
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50 space-y-6">
                    {/* Thống kê 4 khối số liệu tổng quan */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                <BookOpen size={20}/>
                            </div>
                            <div>
                                <p className="text-slate-400 text-[9px] font-black uppercase tracking-wider">Số bài đã thi</p>
                                <h4 className="text-lg font-black text-slate-800">{totalQuizzes}</h4>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                                <Trophy size={20}/>
                            </div>
                            <div>
                                <p className="text-slate-400 text-[9px] font-black uppercase tracking-wider">Điểm trung bình</p>
                                <h4 className="text-lg font-black text-emerald-600">{avgScore.toFixed(2)}</h4>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-3">
                            <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
                                <Award size={20}/>
                            </div>
                            <div>
                                <p className="text-slate-400 text-[9px] font-black uppercase tracking-wider">Điểm cao nhất</p>
                                <h4 className="text-lg font-black text-amber-600">{maxScore.toFixed(2)}</h4>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-3">
                            <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center shrink-0">
                                <Clock size={20}/>
                            </div>
                            <div>
                                <p className="text-slate-400 text-[9px] font-black uppercase tracking-wider">Tổng thời gian</p>
                                <h4 className="text-sm font-black text-purple-700 truncate">{formatTime(totalSeconds)}</h4>
                            </div>
                        </div>
                    </div>

                    {/* Danh sách lịch sử làm bài chi tiết */}
                    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider flex items-center gap-2">
                                <GraduationCap size={16} className="text-blue-600"/>
                                Lịch sử làm bài thi & kiểm tra ({studentResults.length})
                            </h4>
                            {loading && (
                                <span className="flex items-center gap-1.5 text-xs font-bold text-blue-600">
                                    <Loader2 size={14} className="animate-spin"/> Đang nạp dữ liệu...
                                </span>
                            )}
                        </div>

                        {loading ? (
                            <div className="py-16 text-center text-slate-400 space-y-2">
                                <Loader2 className="animate-spin mx-auto text-blue-500" size={32}/>
                                <p className="text-xs font-bold uppercase">Đang tải lịch sử điểm số của học sinh...</p>
                            </div>
                        ) : studentResults.length === 0 ? (
                            <div className="py-16 text-center text-slate-400 space-y-2">
                                <BookOpen className="mx-auto text-slate-300" size={36}/>
                                <p className="text-xs font-black uppercase text-slate-500">Học sinh chưa có bài làm nào trong hệ thống</p>
                                <p className="text-[11px] text-slate-400 font-medium">Khi học sinh hoàn thành các đề thi, kết quả và lịch sử nộp bài sẽ hiển thị tại đây.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-slate-50 border-b text-[9px] font-black uppercase text-slate-400 tracking-wider">
                                            <th className="p-4 pl-6">STT</th>
                                            <th className="p-4">Tên đề thi</th>
                                            <th className="p-4 text-center">Điểm số</th>
                                            <th className="p-4 text-center">Số câu đúng</th>
                                            <th className="p-4 text-center">Thời gian làm</th>
                                            <th className="p-4 text-center">Thời điểm nộp</th>
                                            <th className="p-4 pr-6 text-center">Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-medium">
                                        {studentResults.map((r, idx) => {
                                            const matchedQuiz = quizzesList.find(q => q.id === r.quizId);
                                            const quizTitle = matchedQuiz?.title || (r as any).quizTitle || 'Đề thi';
                                            const quizSubject = matchedQuiz?.subject || (r as any).subject || '';
                                            const isPass = (Number(r.score) || 0) >= 5;

                                            return (
                                                <tr key={r.id || idx} className="hover:bg-slate-50/80 transition-colors">
                                                    <td className="p-4 pl-6 font-mono text-slate-400 font-bold">{idx + 1}</td>
                                                    <td className="p-4">
                                                        <p className="font-black text-slate-800 uppercase text-xs line-clamp-1">{quizTitle}</p>
                                                        {quizSubject && (
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase">Môn: {quizSubject}</span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <span className={`inline-block font-black text-sm px-2.5 py-0.5 rounded-lg ${
                                                            isPass ? 'text-emerald-700 bg-emerald-50 border border-emerald-100' : 'text-red-600 bg-red-50 border border-red-100'
                                                        }`}>
                                                            {Number(r.score).toFixed(2)}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-center text-slate-600 font-bold">
                                                        {(r as any).correctCount !== undefined && r.totalQuestions !== undefined ? (
                                                            <span>{(r as any).correctCount} / {r.totalQuestions}</span>
                                                        ) : r.detailScores && r.totalQuestions ? (
                                                            <span>{r.detailScores.filter(s => Number(s) > 0).length} / {r.totalQuestions}</span>
                                                        ) : (
                                                            <span>-</span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-center text-slate-600 font-mono text-[11px]">
                                                        {r.durationSeconds ? formatTime(r.durationSeconds) : '-'}
                                                    </td>
                                                    <td className="p-4 text-center text-slate-500 font-mono text-[11px]">
                                                        {formatSubmittedDate(r.submittedAt)}
                                                    </td>
                                                    <td className="p-4 pr-6 text-center">
                                                        <button 
                                                            onClick={() => onViewResult(r)} 
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-xl text-[10px] font-black uppercase transition-all shadow-xs"
                                                            title="Xem chi tiết bài làm"
                                                        >
                                                            <Eye size={13}/> Chi tiết
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Modal */}
                <div className="p-4 px-8 bg-slate-100 border-t border-slate-200 flex justify-end shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase hover:bg-slate-800 transition-all shadow-sm"
                    >
                        Đóng
                    </button>
                </div>
            </div>
        </div>
    );
}
