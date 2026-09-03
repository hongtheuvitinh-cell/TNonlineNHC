
import React, { useState, useMemo, useEffect } from 'react';
import { Question, QuestionType, Grade, Chapter, QuestionLevel, User } from '../../types';
import { 
    Database, Search, CheckCircle2, CheckSquare, Square, X, BookOpen, Trash2, 
    AlertTriangle, Loader2, Sparkles, MousePointer, Eye, Layers, ChevronDown, 
    ChevronUp, ChevronsUpDown, Check
} from 'lucide-react';
import LatexText from '../LatexText';
import { v4 as uuidv4 } from 'uuid';
import { isSameSubject, STANDARD_SUBJECTS, normalizeSubject, getDisplaySubject } from '../../services/subjectUtils';
import { getQuestionFingerprint } from '../../services/storage';

interface QuestionBankProps {
    questions: Question[];
    chapters: Chapter[];
    bGradeFilter: Grade | 'all';
    setBGradeFilter: (val: Grade | 'all') => void;
    bChapterFilter: string;
    setBChapterFilter: (val: string) => void;
    bTypeFilter: QuestionType | 'all';
    setBTypeFilter: (val: QuestionType | 'all') => void;
    bSearch: string;
    setBSearch: (val: string) => void;
    onAddMultiple: (qs: Question[]) => void;
    currentUser?: User;
    isSuperAdmin?: boolean;
    bSubjectFilter?: string;
    setBSubjectFilter?: (val: string) => void;
    onDeleteQuestion?: (id: string) => Promise<void> | void;
    onDeleteBatchQuestions?: (ids: string[]) => Promise<void> | void;
    onDeduplicate?: () => Promise<void> | void;
    isDeduplicating?: boolean;
}

const PAGE_SIZE = 40;

// Helper xóa tiền tố A., B., C., D. để so sánh đáp án chính xác
const stripOptionPrefix = (text: string): string => {
    if (!text) return "";
    let cleaned = text.trim();
    const labelRegex = /^(\*?[A-Za-z0-9][\.\)\/\-:\s]\s*)/g;
    while (labelRegex.test(cleaned)) {
        cleaned = cleaned.replace(labelRegex, "").trim();
    }
    return cleaned;
};

// Kiểm tra xem một phương án MCQ có phải là đáp án đúng không
const isCorrectMCQOption = (q: Question, opt: string, index: number): boolean => {
    if (!q.correctAnswer || !opt) return false;
    const cleanAns = q.correctAnswer.trim();
    const cleanOpt = opt.trim();
    
    // 1. Khớp chuỗi trực tiếp
    if (cleanAns === cleanOpt) return true;
    
    // 2. Khớp sau khi bỏ tiền tố A., B., C., D.
    const stripAns = stripOptionPrefix(cleanAns);
    const stripOpt = stripOptionPrefix(cleanOpt);
    if (stripAns && stripOpt && stripAns === stripOpt) return true;
    
    // 3. Khớp chữ cái A, B, C, D (hoặc A., A))
    const letters = ['A', 'B', 'C', 'D'];
    const letter = letters[index];
    if (cleanAns.toUpperCase() === letter) return true;
    if (cleanAns.toUpperCase().startsWith(`${letter}.`) || cleanAns.toUpperCase().startsWith(`${letter})`)) return true;
    
    // 4. Khớp số chỉ mục index dạng chuỗi '0', '1', '2', '3'
    if (cleanAns === String(index)) return true;
    
    return false;
};

export default function QuestionBank({ 
    questions, chapters, bGradeFilter, setBGradeFilter, bChapterFilter, setBChapterFilter, bTypeFilter, setBTypeFilter, bSearch, setBSearch, onAddMultiple,
    currentUser, isSuperAdmin, bSubjectFilter = 'all', setBSubjectFilter,
    onDeleteQuestion, onDeleteBatchQuestions, onDeduplicate, isDeduplicating
}: QuestionBankProps) {
    // Lưu trữ toàn bộ câu hỏi đã chọn vào Map (ID -> Question) để bảo toàn khi chuyển qua các Level/Chương/Trang khác
    const [selectedQuestionsMap, setSelectedQuestionsMap] = useState<Map<string, Question>>(new Map());
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [bLevelFilter, setBLevelFilter] = useState<QuestionLevel | 'all'>('all');
    
    // Chế độ hiển thị đáp án: 'hover' (rê chuột vào mới hiện) | 'always' (luôn hiển thị tất cả câu)
    const [answersDisplayMode, setAnswersDisplayMode] = useState<'hover' | 'always'>('always');
    
    // Quản lý trạng thái mở rộng/thu gọn thủ công cho từng câu hỏi riêng biệt
    const [expandedQuestionIds, setExpandedQuestionIds] = useState<Set<string>>(new Set());
    const [collapsedQuestionIds, setCollapsedQuestionIds] = useState<Set<string>>(new Set());

    // Chế độ xem chỉ những câu đã chọn
    const [showOnlySelected, setShowOnlySelected] = useState<boolean>(false);

    const [deleteModal, setDeleteModal] = useState<{
        isOpen: boolean;
        ids: string[];
        isBatch: boolean;
        questionPreview?: string;
    } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Extract available subjects from standard list + questions + chapters
    const availableSubjects = useMemo(() => {
        const subsMap = new Map<string, string>();

        STANDARD_SUBJECTS.forEach(s => {
            subsMap.set(normalizeSubject(s), s);
        });

        questions.forEach(q => {
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

        return Array.from(subsMap.values());
    }, [questions, chapters]);

    // Lọc chương thông minh: chỉ hiển thị các chương thuộc Môn học và Khối lớp tương ứng
    const relevantChapters = useMemo(() => {
        return chapters.filter(c => {
            if (bGradeFilter !== 'all' && String(c.grade) !== String(bGradeFilter)) {
                return false;
            }

            if (isSuperAdmin) {
                if (bSubjectFilter && bSubjectFilter !== 'all') {
                    if (c.subject && c.subject.trim()) {
                        if (!isSameSubject(c.subject, bSubjectFilter)) return false;
                    } else {
                        const hasQuestionInSubject = questions.some(q => 
                            q.quizCategory === c.name && q.subject && isSameSubject(q.subject, bSubjectFilter)
                        );
                        const isPhysics = isSameSubject('Vật lí', bSubjectFilter) || isSameSubject('Vật lý', bSubjectFilter);
                        if (!hasQuestionInSubject && !isPhysics) return false;
                    }
                }
            } else if (currentUser?.subject) {
                if (c.subject && c.subject.trim()) {
                    if (!isSameSubject(c.subject, currentUser.subject)) return false;
                }
            }

            return true;
        });
    }, [chapters, bGradeFilter, bSubjectFilter, isSuperAdmin, currentUser?.subject, questions]);

    // Tự động reset bộ lọc Chương khi chuyển Môn hoặc Khối mà chương hiện tại không còn hợp lệ
    useEffect(() => {
        if (bChapterFilter !== 'all') {
            const isStillValid = relevantChapters.some(c => c.name.toLowerCase() === bChapterFilter.toLowerCase());
            if (!isStillValid) {
                setBChapterFilter('all');
            }
        }
    }, [relevantChapters, bChapterFilter, setBChapterFilter]);

    const canDeleteQuestion = (q: Question) => {
        if (isSuperAdmin) return true;
        if (currentUser?.id && q.createdBy === currentUser.id) return true;
        return false;
    };

    // Danh sách câu hỏi sau khi áp dụng các bộ lọc tìm kiếm
    const filteredQuestions = useMemo(() => {
        if (showOnlySelected) {
            // Khi đang bật chế độ "Đã chọn": hiển thị toàn bộ câu hỏi đang nằm trong giỏ chọn
            const selectedList = Array.from(selectedQuestionsMap.values());
            if (!bSearch.trim()) return selectedList;
            const query = bSearch.toLowerCase().trim();
            return selectedList.filter(q => 
                q.text.toLowerCase().includes(query) ||
                (q.quizTitle && q.quizTitle.toLowerCase().includes(query)) ||
                (q.subject && q.subject.toLowerCase().includes(query))
            );
        }

        return questions.filter(q => {
            // Lọc môn học (dành cho SuperAdmin hoặc bộ lọc ngoài)
            if (bSubjectFilter && bSubjectFilter !== 'all') {
                if (!isSameSubject(q.subject, bSubjectFilter)) return false;
            }

            // Lọc khối - Bình thường hóa chuỗi
            const qGradeRaw = (q.quizGrade || 'all').toString().trim();
            const matchGrade = bGradeFilter === 'all' || qGradeRaw === bGradeFilter;

            // Lọc chương
            const qChapter = (q.quizCategory || '').toString().trim().toLowerCase();
            const filterVal = bChapterFilter.trim().toLowerCase();
            const matchChapter = bChapterFilter === 'all' || qChapter === filterVal;
            
            // Lọc dạng
            let qTypeRaw = (q.type || 'mcq').toString().trim().toLowerCase().replace('_', '-');
            const targetType = bTypeFilter.toString().trim().toLowerCase().replace('_', '-');
            const matchType = bTypeFilter === 'all' || qTypeRaw === targetType;
            
            // Lọc mức độ nhận thức (B, H, VD, VDC)
            let matchLevel = true;
            if (bLevelFilter !== 'all') {
                if (q.level) {
                    matchLevel = q.level === bLevelFilter;
                } else if (q.subQuestions && q.subQuestions.length > 0) {
                    matchLevel = q.subQuestions.some(sq => sq.level === bLevelFilter);
                } else {
                    matchLevel = false;
                }
            }

            // Tìm kiếm
            const matchSearch = !bSearch || 
                              q.text.toLowerCase().includes(bSearch.toLowerCase()) ||
                              (q.quizTitle && q.quizTitle.toLowerCase().includes(bSearch.toLowerCase())) ||
                              (q.subject && q.subject.toLowerCase().includes(bSearch.toLowerCase()));
            
            return matchGrade && matchChapter && matchType && matchLevel && matchSearch;
        });
    }, [questions, selectedQuestionsMap, showOnlySelected, bGradeFilter, bChapterFilter, bTypeFilter, bLevelFilter, bSearch, bSubjectFilter]);

    useEffect(() => { 
        setVisibleCount(PAGE_SIZE); 
    }, [bGradeFilter, bChapterFilter, bTypeFilter, bLevelFilter, bSearch, bSubjectFilter, showOnlySelected]);

    // Thống kê chi tiết các câu đã chọn theo mức độ nhận thức (B, H, VD, VDC)
    const selectedStats = useMemo(() => {
        let b = 0, h = 0, vd = 0, vdc = 0;
        selectedQuestionsMap.forEach(q => {
            if (q.level === 'B') b++;
            else if (q.level === 'H') h++;
            else if (q.level === 'VD') vd++;
            else if (q.level === 'VDC') vdc++;
            else if (q.subQuestions && q.subQuestions.length > 0) {
                const subLevels = q.subQuestions.map(sq => sq.level).filter(Boolean);
                if (subLevels.includes('B')) b++;
                else if (subLevels.includes('H')) h++;
                else if (subLevels.includes('VD')) vd++;
                else if (subLevels.includes('VDC')) vdc++;
            }
        });
        return {
            total: selectedQuestionsMap.size,
            b,
            h,
            vd,
            vdc
        };
    }, [selectedQuestionsMap]);

    // Toggle chọn/bỏ chọn một câu hỏi
    const toggleSelect = (q: Question) => {
        setSelectedQuestionsMap(prev => {
            const next = new Map(prev);
            if (next.has(q.id)) {
                next.delete(q.id);
            } else {
                next.set(q.id, q);
            }
            return next;
        });
    };

    // Kiểm tra xem tất cả các câu trong danh sách lọc hiện tại đã được chọn chưa
    const isAllFilteredSelected = useMemo(() => {
        if (filteredQuestions.length === 0) return false;
        return filteredQuestions.every(q => selectedQuestionsMap.has(q.id));
    }, [filteredQuestions, selectedQuestionsMap]);

    // Chọn/Bỏ chọn tất cả câu hỏi trong danh sách lọc hiện tại
    const handleToggleSelectFiltered = () => {
        setSelectedQuestionsMap(prev => {
            const next = new Map(prev);
            if (isAllFilteredSelected) {
                // Bỏ chọn tất cả các câu trong danh sách lọc hiện tại, giữ nguyên câu ở các bộ lọc khác
                filteredQuestions.forEach(q => next.delete(q.id));
            } else {
                // Thêm tất cả câu trong danh sách lọc hiện tại vào danh sách chọn
                filteredQuestions.forEach(q => next.set(q.id, q));
            }
            return next;
        });
    };

    // Bỏ chọn tất cả câu hỏi đã chọn
    const handleClearAllSelected = () => {
        setSelectedQuestionsMap(new Map());
    };

    const duplicateCount = useMemo(() => {
        const counts = new Map<string, number>();
        questions.forEach(q => {
            const fp = getQuestionFingerprint(q);
            if (fp) counts.set(fp, (counts.get(fp) || 0) + 1);
        });
        let dupes = 0;
        counts.forEach(c => {
            if (c > 1) dupes += (c - 1);
        });
        return dupes;
    }, [questions]);

    // Thêm toàn bộ các câu đã chọn (từ TẤT CẢ các level, các phần, các chương) vào đề thi
    const handleAddSelected = () => {
        const selectedList = Array.from(selectedQuestionsMap.values());
        if (selectedList.length === 0) {
            alert("Vui lòng chọn ít nhất một câu hỏi!");
            return;
        }

        const questionsToAdd = selectedList.map(q => ({ 
            ...q, 
            id: uuidv4(),
            bankQuestionId: q.id // Lưu vết ID gốc từ Ngân hàng để chống trùng lặp khi đồng bộ
        }));

        onAddMultiple(questionsToAdd);
        setSelectedQuestionsMap(new Map());
        setShowOnlySelected(false);
    };

    const handleConfirmDelete = async () => {
        if (!deleteModal || deleteModal.ids.length === 0) return;
        setIsDeleting(true);
        try {
            if (deleteModal.isBatch && onDeleteBatchQuestions) {
                await onDeleteBatchQuestions(deleteModal.ids);
            } else if (!deleteModal.isBatch && onDeleteQuestion) {
                await onDeleteQuestion(deleteModal.ids[0]);
            }
            setSelectedQuestionsMap(prev => {
                const next = new Map(prev);
                deleteModal.ids.forEach(id => next.delete(id));
                return next;
            });
            setDeleteModal(null);
        } catch (err) {
            console.error("Lỗi khi xóa câu hỏi khỏi ngân hàng:", err);
        } finally {
            setIsDeleting(false);
        }
    };

    const visibleQuestions = useMemo(() => filteredQuestions.slice(0, visibleCount), [filteredQuestions, visibleCount]);

    const selectedDeletableCount = useMemo(() => {
        let count = 0;
        selectedQuestionsMap.forEach(q => {
            if (canDeleteQuestion(q)) count++;
        });
        return count;
    }, [selectedQuestionsMap, isSuperAdmin, currentUser?.id]);

    // Xử lý mở/thu gọn thủ công câu hỏi
    const toggleManualExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedQuestionIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        setCollapsedQuestionIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const toggleManualCollapse = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setCollapsedQuestionIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        setExpandedQuestionIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    return (
        <div className="space-y-4 animate-fade-in w-full max-w-full pb-10">
            {/* Status pill for teacher subject */}
            {currentUser?.subject && !isSuperAdmin && (
                <div className="bg-blue-50/80 border border-blue-200 px-4 py-2 rounded-xl flex items-center justify-between text-xs text-blue-900">
                    <span className="font-bold flex items-center gap-1.5">
                        <BookOpen size={14} className="text-blue-600"/> 
                        Ngân hàng câu hỏi bộ môn: <b className="text-blue-700 uppercase font-black">{currentUser.subject}</b>
                    </span>
                    <span className="text-[10px] text-blue-600 font-medium">
                        Dùng chung & tự động đồng bộ giữa các giáo viên dạy cùng môn {currentUser.subject}
                    </span>
                </div>
            )}

            {/* Duplicate detection alert & quick action (chỉ dành cho SuperAdmin) */}
            {isSuperAdmin && duplicateCount > 0 && onDeduplicate && (
                <div className="bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-amber-900 shadow-sm">
                    <div className="flex items-center gap-2">
                        <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                        <span className="font-bold">
                            Phát hiện <b className="text-amber-700 underline">{duplicateCount}</b> câu hỏi có nội dung trùng lặp trong Ngân hàng {bSubjectFilter !== 'all' ? `(Môn ${bSubjectFilter})` : ''}.
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onDeduplicate}
                        disabled={isDeduplicating}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[9px] font-black uppercase shadow transition-all disabled:opacity-50"
                    >
                        {isDeduplicating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        Quét & Gộp {bSubjectFilter !== 'all' ? `Môn ${bSubjectFilter}` : 'Trùng lặp'}
                    </button>
                </div>
            )}

            {/* Thanh điều khiển chính (Header + Filter Controls) */}
            <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm sticky top-0 z-30 space-y-3">
                
                {/* Hàng 1: Nút chuyển chế độ hiển thị đáp án (Rê chuột | Luôn hiện) + Các bộ lọc */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                    {/* Toggle hiển thị đáp án: Rê chuột xem đáp án | Luôn hiện 4 đáp án */}
                    <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80 shadow-xs shrink-0">
                        <button
                            type="button"
                            onClick={() => setAnswersDisplayMode('hover')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                                answersDisplayMode === 'hover'
                                    ? 'bg-white text-blue-700 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Chỉ hiển thị 4 đáp án khi di chuyển chuột vào câu hỏi đó"
                        >
                            <MousePointer size={13} className={answersDisplayMode === 'hover' ? 'text-blue-600' : 'text-slate-400'} />
                            <span>RÊ CHUỘT XEM ĐÁP ÁN</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setAnswersDisplayMode('always')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                                answersDisplayMode === 'always'
                                    ? 'bg-white text-blue-700 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Luôn hiển thị đầy đủ 4 đáp án cho tất cả câu hỏi"
                        >
                            <Eye size={13} className={answersDisplayMode === 'always' ? 'text-blue-600' : 'text-slate-400'} />
                            <span>LUÔN HIỆN 4 ĐÁP ÁN</span>
                        </button>
                    </div>

                    {/* Các dropdown bộ lọc */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Subject Filter (Chỉ hiển thị cho SuperAdmin) */}
                        {isSuperAdmin && setBSubjectFilter && (
                            <select 
                                className="bg-amber-50 border border-amber-300 text-amber-900 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase outline-none cursor-pointer shadow-sm"
                                value={bSubjectFilter}
                                onChange={e => {
                                    setBSubjectFilter(e.target.value);
                                    setBChapterFilter('all');
                                }}
                            >
                                <option value="all">Môn: Tất cả</option>
                                {availableSubjects.map(s => (
                                    <option key={s} value={s}>Môn {s}</option>
                                ))}
                            </select>
                        )}

                        <select 
                            className="bg-slate-50 border px-3 py-1.5 rounded-lg text-[9px] font-black uppercase outline-none" 
                            value={bGradeFilter} 
                            onChange={e => { 
                                setBGradeFilter(e.target.value as any); 
                                setBChapterFilter('all'); 
                            }}
                        >
                            <option value="all">Khối: Tất cả</option>
                            <option value="12">Khối 12</option>
                            <option value="11">Khối 11</option>
                            <option value="10">Khối 10</option>
                        </select>
                        <select 
                            className="bg-slate-50 border px-3 py-1.5 rounded-lg text-[9px] font-black uppercase outline-none max-w-[170px]" 
                            value={bChapterFilter} 
                            onChange={e => setBChapterFilter(e.target.value)}
                        >
                            <option value="all">Chương: Tất cả ({relevantChapters.length})</option>
                            {relevantChapters.map(c => (
                                <option key={c.id} value={c.name}>{(c.name || (c as any).title || "Chương chưa đặt tên").toUpperCase()}</option>
                            ))}
                        </select>
                        <select className="bg-slate-50 border px-3 py-1.5 rounded-lg text-[9px] font-black uppercase outline-none" value={bTypeFilter} onChange={e => setBTypeFilter(e.target.value as any)}>
                            <option value="all">Dạng: Tất cả</option>
                            <option value="mcq">P.I (MCQ)</option>
                            <option value="group-tf">P.II (D/S)</option>
                            <option value="short">P.III (Ngắn)</option>
                        </select>
                        <select className="bg-slate-50 border px-3 py-1.5 rounded-lg text-[9px] font-black uppercase outline-none" value={bLevelFilter} onChange={e => setBLevelFilter(e.target.value as any)}>
                            <option value="all">Mức độ: Tất cả</option>
                            <option value="B">🟢 [B] Biết</option>
                            <option value="H">🔵 [H] Hiểu</option>
                            <option value="VD">🟠 [VD] Vận dụng</option>
                            <option value="VDC">🔴 [VDC] Vận dụng cao</option>
                        </select>
                        <button 
                            onClick={() => { 
                                setBGradeFilter('all'); 
                                setBChapterFilter('all'); 
                                setBTypeFilter('all'); 
                                setBLevelFilter('all'); 
                                setBSearch('');
                                setShowOnlySelected(false);
                                if (setBSubjectFilter) setBSubjectFilter('all');
                            }}
                            className="bg-red-50 text-red-500 border border-red-100 px-2 py-1.5 rounded-lg text-[8px] font-black uppercase hover:bg-red-100 transition-colors"
                        >
                            Xóa lọc
                        </button>
                    </div>
                </div>

                {/* Hàng 2: Tìm kiếm + Các nút Thao tác (ĐÃ CHỌN | CHỌN TẤT CẢ | THÊM CÂU VÀO ĐỀ) */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                    {/* Ô tìm kiếm */}
                    <div className="flex-1 flex items-center bg-slate-50 border rounded-xl px-3 py-1">
                        <Search size={15} className="text-slate-400 mr-2 shrink-0"/>
                        <input 
                            className="bg-transparent py-1.5 text-xs font-medium outline-none w-full text-slate-800 placeholder:text-slate-400" 
                            placeholder="Tìm kiếm nội dung câu hỏi hoặc tên đề thi..." 
                            value={bSearch} 
                            onChange={e => setBSearch(e.target.value)} 
                        />
                        {bSearch && (
                            <button onClick={() => setBSearch('')} className="p-1 text-slate-400 hover:text-slate-600">
                                <X size={14}/>
                            </button>
                        )}
                    </div>

                    {/* Cụm nút thao tác */}
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {/* Nút xem các câu ĐÃ CHỌN */}
                        <button
                            type="button"
                            onClick={() => setShowOnlySelected(prev => !prev)}
                            className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border ${
                                showOnlySelected 
                                    ? 'bg-amber-500 text-white border-amber-600 shadow-md' 
                                    : selectedStats.total > 0
                                        ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 shadow-xs'
                                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                            }`}
                            title="Bấm để xem danh sách các câu hỏi đã chọn qua nhiều mức độ/chương"
                        >
                            <Layers size={14} className={showOnlySelected ? 'text-white' : 'text-amber-600'}/>
                            <span>ĐÃ CHỌN ({selectedStats.total})</span>
                        </button>

                        {/* Nút CHỌN TẤT CẢ trong trang hiện tại */}
                        <button 
                            type="button"
                            onClick={handleToggleSelectFiltered} 
                            className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[10px] font-black uppercase border transition-all ${
                                isAllFilteredSelected && filteredQuestions.length > 0
                                    ? 'bg-blue-50 text-blue-700 border-blue-300 font-black'
                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            {isAllFilteredSelected && filteredQuestions.length > 0 ? (
                                <CheckSquare size={14} className="text-blue-600"/>
                            ) : (
                                <Square size={14} className="text-slate-400"/>
                            )}
                            <span>CHỌN TẤT CẢ ({filteredQuestions.length})</span>
                        </button>
                        
                        {/* Nút XÓA HÀNG LOẠT khỏi Ngân hàng */}
                        {(onDeleteBatchQuestions || onDeleteQuestion) && selectedDeletableCount > 0 && (
                            <button 
                                type="button"
                                onClick={() => {
                                    const deletableIds: string[] = [];
                                    selectedQuestionsMap.forEach(q => {
                                        if (canDeleteQuestion(q)) deletableIds.push(q.id);
                                    });
                                    if (deletableIds.length === 0) return;
                                    setDeleteModal({
                                        isOpen: true,
                                        ids: deletableIds,
                                        isBatch: true
                                    });
                                }}
                                className="px-3 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white flex items-center gap-1.5 shadow-xs"
                                title="Xóa các câu hỏi đã chọn khỏi Ngân hàng"
                            >
                                <Trash2 size={14}/>
                                <span>Xóa ({selectedDeletableCount})</span>
                            </button>
                        )}

                        {/* Nút THÊM VÀO ĐỀ THI */}
                        <button 
                            type="button"
                            onClick={handleAddSelected} 
                            disabled={selectedStats.total === 0} 
                            className={`flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all shadow-md active:scale-95 ${
                                selectedStats.total > 0 
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer' 
                                    : 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed shadow-none'
                            }`}
                        >
                            <span>+ THÊM {selectedStats.total > 0 ? `${selectedStats.total} CÂU` : ''} VÀO ĐỀ</span>
                        </button>
                    </div>
                </div>

                {/* Hàng 3: Banner Thống kê chi tiết theo Level (B, H, VD, VDC) khi đã chọn câu hỏi */}
                {selectedStats.total > 0 && (
                    <div className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-2.5 px-4 flex items-center justify-between flex-wrap gap-2 animate-fade-in text-xs font-bold shadow-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="flex items-center gap-1.5 text-blue-900 font-black">
                                <CheckCircle2 size={16} className="text-blue-600"/>
                                <span>Đã chọn tổng cộng: <b className="text-blue-700 underline">{selectedStats.total} câu</b></span>
                            </span>
                            <span className="text-slate-300 hidden sm:inline">|</span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2.5 py-0.5 bg-emerald-100/90 text-emerald-800 border border-emerald-300/80 rounded-lg text-[10px] font-black uppercase shadow-2xs">
                                    [B] Biết: {selectedStats.b}
                                </span>
                                <span className="px-2.5 py-0.5 bg-blue-100/90 text-blue-800 border border-blue-300/80 rounded-lg text-[10px] font-black uppercase shadow-2xs">
                                    [H] Hiểu: {selectedStats.h}
                                </span>
                                <span className="px-2.5 py-0.5 bg-amber-100/90 text-amber-800 border border-amber-300/80 rounded-lg text-[10px] font-black uppercase shadow-2xs">
                                    [VD] Vận dụng: {selectedStats.vd}
                                </span>
                                {selectedStats.vdc > 0 && (
                                    <span className="px-2.5 py-0.5 bg-red-100/90 text-red-800 border border-red-300/80 rounded-lg text-[10px] font-black uppercase shadow-2xs">
                                        [VDC] Vận dụng cao: {selectedStats.vdc}
                                    </span>
                                )}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleClearAllSelected}
                            className="text-[10px] font-black uppercase text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors ml-auto"
                            title="Bỏ chọn tất cả các câu đã chọn"
                        >
                            BỎ CHỌN TẤT CẢ ({selectedStats.total})
                        </button>
                    </div>
                )}
            </div>

            {/* Danh sách các câu hỏi */}
            <div className="grid grid-cols-1 gap-3">
                {visibleQuestions.map((bq, idx) => {
                    const isSelected = selectedQuestionsMap.has(bq.id);
                    const isDeletable = canDeleteQuestion(bq) && (onDeleteQuestion || onDeleteBatchQuestions);

                    // Trạng thái hiển thị đáp án cho từng câu
                    const isManuallyExpanded = expandedQuestionIds.has(bq.id);
                    const isManuallyCollapsed = collapsedQuestionIds.has(bq.id);
                    
                    let showAnswersClass = "";
                    if (answersDisplayMode === 'always') {
                        showAnswersClass = isManuallyCollapsed ? "hidden" : "block";
                    } else {
                        // Chế độ 'hover': Mặc định ẩn, hover chuột vào thì hiện, hoặc nếu người dùng click mũi tên mở rộng thì luôn hiện
                        showAnswersClass = isManuallyExpanded ? "block" : "hidden group-hover:block transition-all duration-150";
                    }

                    const isCurrentlyShown = answersDisplayMode === 'always' 
                        ? !isManuallyCollapsed 
                        : isManuallyExpanded;

                    return (
                        <div 
                            key={bq.id || idx} 
                            onClick={() => toggleSelect(bq)} 
                            className={`bg-white p-4 sm:p-5 rounded-2xl border-2 flex items-start gap-3.5 cursor-pointer transition-all relative group ${
                                isSelected 
                                    ? 'border-blue-500 bg-blue-50/20 shadow-sm' 
                                    : 'border-slate-100 hover:border-blue-200 hover:shadow-xs'
                            }`}
                        >
                            {/* Checkbox tròn bên trái */}
                            <div className={`mt-0.5 shrink-0 transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-200 group-hover:text-slate-300'}`}>
                                <CheckCircle2 size={24}/>
                            </div>

                            {/* Khối nội dung câu hỏi */}
                            <div className="flex-1 min-w-0 pr-6">
                                {/* Hàng badges phân loại */}
                                <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                                    <span className={`text-[9px] font-black px-2.5 py-0.5 rounded-lg text-white uppercase tracking-tight shadow-xs ${
                                        bq.type === 'mcq' ? 'bg-blue-600' : bq.type.includes('tf') ? 'bg-purple-600' : 'bg-orange-600'
                                    }`}>
                                        {bq.type === 'mcq' ? 'P.I (MCQ)' : bq.type.includes('tf') ? 'P.II (D/S)' : 'P.III (Ngắn)'}
                                    </span>

                                    {bq.quizGrade && (
                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 uppercase">
                                            Khối {bq.quizGrade}
                                        </span>
                                    )}

                                    {bq.subject && (
                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
                                            Môn: {bq.subject}
                                        </span>
                                    )}

                                    {bq.level && (
                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg text-white shadow-xs ${
                                            bq.level === 'B' ? 'bg-emerald-600' : bq.level === 'H' ? 'bg-blue-600' : bq.level === 'VD' ? 'bg-amber-600' : 'bg-red-600'
                                        }`}>
                                            [{bq.level}] {bq.level === 'B' ? 'Biết' : bq.level === 'H' ? 'Hiểu' : bq.level === 'VD' ? 'Vận dụng' : 'Vận dụng cao'}
                                        </span>
                                    )}

                                    {bq.quizCategory && (
                                        <span className="text-[9px] text-purple-700 font-bold uppercase bg-purple-50 px-2.5 py-0.5 rounded-lg border border-purple-200">
                                            {bq.quizCategory}
                                        </span>
                                    )}

                                    {bq.quizTitle && (
                                        <span className="flex items-center gap-1 text-[9px] text-sky-700 font-black uppercase bg-sky-50 px-2.5 py-0.5 rounded-lg border border-sky-200">
                                            <BookOpen size={11}/> {bq.quizTitle}
                                        </span>
                                    )}
                                </div>

                                {/* Thân nội dung câu hỏi */}
                                <div className="text-slate-900 text-sm font-bold leading-relaxed overflow-x-auto">
                                    <LatexText text={bq.text}/>
                                </div>

                                {/* Hình ảnh đính kèm nếu có */}
                                {bq.imageUrl && (
                                    <div className="mt-3" onClick={e => e.stopPropagation()}>
                                        <img 
                                            src={bq.imageUrl} 
                                            alt="Hình minh họa" 
                                            className="max-h-48 rounded-xl border border-slate-200 shadow-xs object-contain bg-white" 
                                        />
                                    </div>
                                )}

                                {/* VÙNG HIỂN THỊ ĐÁP ÁN (Dạng MCQ: 4 lựa chọn; Dạng D/S: 4 ý; Dạng Ngắn: đáp án đúng) */}
                                {bq.type === 'mcq' && bq.options && bq.options.length > 0 && (
                                    <div className={`mt-3 pt-3 border-t border-slate-100 ${showAnswersClass}`}>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            {bq.options.map((opt, optIdx) => {
                                                const isCorrect = isCorrectMCQOption(bq, opt, optIdx);
                                                const letter = String.fromCharCode(65 + optIdx);
                                                return (
                                                    <div 
                                                        key={optIdx}
                                                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition-all ${
                                                            isCorrect 
                                                                ? 'border-2 border-emerald-500 bg-emerald-50/50 text-emerald-950 font-bold shadow-xs' 
                                                                : 'border-slate-200 bg-slate-50/70 text-slate-700 font-medium'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                                                                isCorrect ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-200 text-slate-700'
                                                            }`}>
                                                                {letter}
                                                            </span>
                                                            <div className="flex-1 overflow-x-auto leading-relaxed">
                                                                <LatexText text={opt} />
                                                            </div>
                                                        </div>
                                                        {isCorrect ? (
                                                            <span className="bg-emerald-100 border border-emerald-300 text-emerald-800 text-[9px] font-black uppercase px-2 py-0.5 rounded shrink-0">
                                                                ĐÁP ÁN ĐÚNG
                                                            </span>
                                                        ) : (
                                                            <ChevronsUpDown size={14} className="text-slate-300 shrink-0" />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* VÙNG HIỂN THỊ ĐÁP ÁN ĐÚNG/SAI (P.II Group-TF) */}
                                {bq.type.includes('tf') && bq.subQuestions && bq.subQuestions.length > 0 && (
                                    <div className={`mt-3 pt-3 border-t border-slate-100 ${showAnswersClass}`}>
                                        <div className="space-y-2">
                                            {bq.subQuestions.map((sq, sqi) => {
                                                const isTrue = sq.correctAnswer === 'True';
                                                return (
                                                    <div 
                                                        key={sqi}
                                                        className="p-2.5 bg-slate-50/70 border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-xs"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                            <span className="font-black text-slate-700 shrink-0">{String.fromCharCode(97 + sqi)})</span>
                                                            <div className="flex-1 overflow-x-auto font-medium text-slate-800">
                                                                <LatexText text={sq.text} />
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {sq.level && (
                                                                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded text-white ${
                                                                    sq.level === 'B' ? 'bg-emerald-600' : sq.level === 'H' ? 'bg-blue-600' : sq.level === 'VD' ? 'bg-amber-600' : 'bg-red-600'
                                                                }`}>
                                                                    {sq.level}
                                                                </span>
                                                            )}
                                                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${
                                                                isTrue 
                                                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                                                                    : 'bg-rose-100 text-rose-800 border-rose-300'
                                                            }`}>
                                                                {isTrue ? 'ĐÚNG' : 'SAI'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* VÙNG HIỂN THỊ ĐÁP ÁN NGẮN (P.III Short Answer) */}
                                {bq.type === 'short' && (
                                    <div className={`mt-3 pt-3 border-t border-slate-100 ${showAnswersClass}`}>
                                        <div className="p-3 bg-emerald-50/50 border-2 border-emerald-400 rounded-xl flex items-center justify-between gap-3 text-xs">
                                            <span className="font-bold text-emerald-900">Đáp án chính xác:</span>
                                            <span className="font-black text-emerald-800 text-sm bg-white px-3 py-1 rounded-lg border border-emerald-300 shadow-2xs">
                                                {bq.correctAnswer || 'Chưa nhập đáp án'}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Lời giải chi tiết nếu có */}
                                {bq.solution && (
                                    <div className={`mt-2 p-3 bg-amber-50/60 border border-amber-200 rounded-xl text-xs text-amber-900 ${showAnswersClass}`}>
                                        <div className="font-black uppercase text-[10px] text-amber-800 mb-1 flex items-center gap-1">
                                            <span>💡 Lời giải chi tiết:</span>
                                        </div>
                                        <LatexText text={bq.solution} />
                                    </div>
                                )}
                            </div>

                            {/* Cột bên phải: Nút Mũi tên Thu gọn/Mở rộng + Nút Xóa */}
                            <div className="flex flex-col items-center gap-1.5 shrink-0 ml-auto">
                                {/* Cặp nút ▲ ▼ (ChevronUp / ChevronDown) như ảnh mẫu */}
                                <div className="flex flex-col items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                                    <button
                                        type="button"
                                        onClick={(e) => toggleManualCollapse(bq.id, e)}
                                        className={`p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-200 transition-colors ${
                                            !isCurrentlyShown ? 'text-blue-600 bg-blue-50' : ''
                                        }`}
                                        title="Thu gọn đáp án câu hỏi này"
                                    >
                                        <ChevronUp size={14}/>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => toggleManualExpand(bq.id, e)}
                                        className={`p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-200 transition-colors ${
                                            isCurrentlyShown ? 'text-blue-600 bg-blue-50' : ''
                                        }`}
                                        title="Mở rộng xem 4 đáp án câu hỏi này"
                                    >
                                        <ChevronDown size={14}/>
                                    </button>
                                </div>

                                {/* Nút xóa câu hỏi đơn */}
                                {isDeletable && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setDeleteModal({
                                                isOpen: true,
                                                ids: [bq.id],
                                                isBatch: false,
                                                questionPreview: bq.text
                                            });
                                        }}
                                        className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                        title="Xóa câu hỏi này khỏi Ngân hàng"
                                    >
                                        <Trash2 size={15}/>
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}

                {visibleQuestions.length === 0 && (
                    <div className="py-20 text-center space-y-4">
                        <X className="mx-auto text-slate-200" size={48}/>
                        <p className="text-xs font-black uppercase text-slate-400 tracking-widest italic">
                            {showOnlySelected ? "Chưa có câu hỏi nào được chọn" : "Không tìm thấy câu hỏi nào"}
                        </p>
                    </div>
                )}

                {visibleCount < filteredQuestions.length && (
                    <div className="py-6 text-center">
                        <button 
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                setVisibleCount(prev => prev + PAGE_SIZE); 
                            }} 
                            className="px-10 py-3 bg-white border-2 border-slate-200 rounded-full text-[10px] font-black uppercase text-slate-600 shadow-sm hover:bg-slate-900 hover:text-white transition-all"
                        >
                            Tải thêm câu hỏi (Còn {filteredQuestions.length - visibleCount})
                        </button>
                    </div>
                )}
            </div>

            {/* In-component Delete Confirmation Modal */}
            {deleteModal && deleteModal.isOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[6000] flex items-center justify-center p-4">
                    <div className="bg-white max-w-md w-full rounded-3xl border shadow-2xl p-6 overflow-hidden animate-scale-up space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-red-50 text-red-600 rounded-2xl shrink-0">
                                <AlertTriangle size={24}/>
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-base font-black text-slate-900 uppercase">
                                    {deleteModal.isBatch ? "Xác nhận xóa hàng loạt" : "Xác nhận xóa câu hỏi"}
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    {deleteModal.isBatch 
                                        ? `Bạn có chắc chắn muốn xóa vĩnh viễn ${deleteModal.ids.length} câu hỏi đã chọn khỏi Ngân hàng câu hỏi không?`
                                        : "Bạn có chắc chắn muốn xóa vĩnh viễn câu hỏi này khỏi Ngân hàng câu hỏi không?"}
                                </p>
                                {!deleteModal.isBatch && deleteModal.questionPreview && (
                                    <div className="mt-2 p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-700 font-medium max-h-24 overflow-y-auto line-clamp-3">
                                        <LatexText text={deleteModal.questionPreview} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setDeleteModal(null)}
                                disabled={isDeleting}
                                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase transition-all disabled:opacity-50"
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDelete}
                                disabled={isDeleting}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase transition-all flex items-center gap-2 shadow-lg shadow-red-200 disabled:opacity-50"
                            >
                                {isDeleting ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16}/>}
                                <span>{isDeleting ? "Đang xóa..." : "Xác nhận xóa"}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
