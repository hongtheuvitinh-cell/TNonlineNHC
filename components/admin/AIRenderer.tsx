import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Grade, Question, Chapter, QuestionType, QuestionLevel } from '../../types';
import { generateQuestionsForMatrix, MatrixRequirementItem, MatrixProgressUpdate } from '../../services/gemini';
import { isCurriculumChapter } from '../../services/chapterUtils';
import { isSameSubject } from '../../services/subjectUtils';
import AIProgressTimelineModal, { TimelineStepItem } from './AIProgressTimelineModal';
import { 
    Sparkles, Database, LayoutTemplate, Loader2, AlertTriangle, PlusCircle, 
    FileUp, Key, Eye, EyeOff, Check, RotateCcw, ChevronDown, ChevronRight, 
    BookOpen, Layers, Info, FileText, CheckCircle2, X
} from 'lucide-react';

interface AIRendererProps {
    grade: Grade;
    setGrade: (val: Grade) => void;
    subject?: string;
    setSubject?: (val: string) => void;
    chapters: Chapter[];
    bankQuestions?: Question[];
    onOpenEditor?: () => void;
    onOpenBank?: () => void;
    onMatrixGenerateComplete?: (result: {
        title: string;
        durationMinutes: number;
        questions: Question[];
        target: 'editor' | 'bank';
        category?: string;
    }) => Promise<void>;
    onGenerate?: (config: {
        topic: string;
        p1: number;
        p2: number;
        p3: number;
        target: 'editor' | 'bank';
        matrix?: { easy: number; medium: number; hard: number; vhard: number };
        pdfBase64?: string;
    }) => Promise<void>;
    isLoading?: boolean;
    hasQuestionsInEditor?: boolean;
    customApiKey?: string;
    onApiKeyChange?: (key: string) => void;
    isSuperAdmin?: boolean;
    onAddChapter?: (name: string, grade: Grade, subject?: string) => Promise<void>;
}

type MatrixModeTab = 'bank' | 'prompt' | 'pdf';
type QuestionTypeFilter = 'all' | 'mcq' | 'group-tf' | 'short';

// Cấu trúc lưu trữ số câu hỏi trong từng ô ma trận:
// matrixData[chapterId][type][level] = count
type ChapterMatrixData = {
    mcq: Record<QuestionLevel, number>;
    'group-tf': Record<QuestionLevel, number>;
    short: Record<QuestionLevel, number>;
};

export default function AIRenderer({
    grade,
    setGrade,
    subject = 'Vật lí',
    setSubject,
    chapters = [],
    bankQuestions = [],
    onOpenEditor,
    onOpenBank,
    onMatrixGenerateComplete,
    onGenerate,
    isLoading = false,
    hasQuestionsInEditor = false,
    customApiKey = '',
    onApiKeyChange,
    isSuperAdmin = false,
    onAddChapter
}: AIRendererProps) {
    // 3 Tabs chính:
    // Tab 1: Soạn đề dựa trên thư viện có sẵn (bank)
    // Tab 2: Soạn dựa trên prompt với AI (prompt)
    // Tab 3: Soạn dựa trên tài liệu sẵn có PDF (pdf)
    const [activeTab, setActiveTab] = useState<MatrixModeTab>('bank');

    // Cấu hình đề
    const [targetDestination, setTargetDestination] = useState<'editor' | 'bank'>('editor');

    // Cấu hình prompt bổ sung cho Tab 2
    const [promptAdditions, setPromptAdditions] = useState('');

    // Cấu hình tệp PDF cho Tab 3
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [pdfBase64, setPdfBase64] = useState<string | null>(null);

    // Bộ lọc loại câu hiển thị trong ma trận
    const [typeFilter, setTypeFilter] = useState<QuestionTypeFilter>('all');

    // Môn học được chọn trong màn hình AI Soạn Đề
    const [selectedSubject, setSelectedSubject] = useState<string>(() => {
        if (subject && subject.trim()) return subject.trim();
        const firstChWithSubj = chapters.find(c => c.subject && c.subject.trim());
        return firstChWithSubj?.subject?.trim() || 'Vật lí';
    });

    useEffect(() => {
        if (subject && subject.trim()) {
            setSelectedSubject(subject.trim());
        }
    }, [subject]);

    const currentSubject = selectedSubject || subject || 'Vật lí';

    const handleSelectSubject = (newSubj: string) => {
        setSelectedSubject(newSubj);
        if (setSubject) {
            setSubject(newSubj);
        }
    };

    // Danh sách môn học hiển thị cho giáo viên chọn
    const availableSubjects = useMemo(() => {
        const list = new Set<string>();
        // Các môn phổ biến
        ['Vật lí'].forEach(s => list.add(s));
        // Thêm các môn từ danh sách chương nếu có
        chapters.forEach(c => {
            if (c.subject && c.subject.trim()) {
                list.add(c.subject.trim());
            }
        });
        return Array.from(list);
    }, [chapters]);

    // Trạng thái gập/mở từng chương trong bảng ma trận
    const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});

    // Trạng thái thông báo / lỗi / cấu hình API key
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [isInternalProcessing, setIsInternalProcessing] = useState(false);
    const [showKeyInput, setShowKeyInput] = useState(false);

    // Tiến trình Timeline thời gian thực hiển thị trạng thái lấy dữ liệu hay soạn câu mới, mức độ nào
    const [timelineProgress, setTimelineProgress] = useState<{
        isOpen: boolean;
        title: string;
        subtitle?: string;
        percent: number;
        currentAction: 'fetching_bank' | 'checking_matrix' | 'generating_ai' | 'solving_ai' | 'normalizing' | 'completed' | 'error';
        currentLevel?: string;
        currentChapter?: string;
        detailsMessage: string;
        steps: TimelineStepItem[];
        logs: string[];
    }>({
        isOpen: false,
        title: 'TỔNG HỢP & SOẠN ĐỀ THEO MA TRẬN',
        subtitle: 'Hệ thống tự động điều phối ngân hàng câu hỏi và AI Gemini',
        percent: 0,
        currentAction: 'fetching_bank',
        detailsMessage: '',
        steps: [],
        logs: []
    });

    // Lọc danh sách chương phù hợp với khối và môn - LẤY TRỰC TIẾP TỪ MỤC CHƯƠNG (loại bỏ hoàn toàn KTTX, KTGK, KTCK)
    const activeChapters = useMemo(() => {
        return chapters.filter(c => {
            const cName = c.name || (c as any).title || '';
            // Loại bỏ hoàn toàn các mục loại đề thi (KTTX, KTGK, KTCK, LTĐH...), chỉ giữ lại chương bài học
            if (!isCurriculumChapter(cName)) return false;
            // Lọc theo khối nếu có cấu hình
            if (c.grade && c.grade !== 'all' && String(c.grade) !== String(grade)) return false;
            // Lọc theo môn học đang chọn
            if (c.subject && currentSubject && !isSameSubject(c.subject, currentSubject)) return false;
            return true;
        }).sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [chapters, grade, currentSubject]);

    // Dữ liệu ma trận số lượng câu hỏi do giáo viên cấu hình
    const [matrixData, setMatrixData] = useState<Record<string, ChapterMatrixData>>({});

    // Đảm bảo dữ liệu ma trận luôn có đủ các chương
    useEffect(() => {
        setMatrixData(prev => {
            const next: Record<string, ChapterMatrixData> = { ...prev };
            activeChapters.forEach(ch => {
                if (!next[ch.id]) {
                    next[ch.id] = {
                        mcq: { B: 0, H: 0, VD: 0, VDC: 0 },
                        'group-tf': { B: 0, H: 0, VD: 0, VDC: 0 },
                        short: { B: 0, H: 0, VD: 0, VDC: 0 }
                    };
                }
            });
            return next;
        });
    }, [activeChapters]);

    // Hàm cập nhật 1 ô trong ma trận
    const handleCellChange = (chapterId: string, type: QuestionType, level: QuestionLevel, val: number) => {
        const cleanVal = Math.max(0, Math.min(50, isNaN(val) ? 0 : val));
        setMatrixData(prev => {
            const chapterCurrent = prev[chapterId] || {
                mcq: { B: 0, H: 0, VD: 0, VDC: 0 },
                'group-tf': { B: 0, H: 0, VD: 0, VDC: 0 },
                short: { B: 0, H: 0, VD: 0, VDC: 0 }
            };

            return {
                ...prev,
                [chapterId]: {
                    ...chapterCurrent,
                    [type]: {
                        ...chapterCurrent[type],
                        [level]: cleanVal
                    }
                }
            };
        });
    };

    // Áp dụng mẫu ma trận nhanh chuẩn GDPT 2018 (Phân bổ tự động đều theo các chương bài học)
    const handleApplyPreset = (presetType: 'gdpt28' | 'test45' | 'test15') => {
        if (activeChapters.length === 0) return;
        const next: Record<string, ChapterMatrixData> = {};
        activeChapters.forEach(c => {
            next[c.id] = {
                mcq: { B: 0, H: 0, VD: 0, VDC: 0 },
                'group-tf': { B: 0, H: 0, VD: 0, VDC: 0 },
                short: { B: 0, H: 0, VD: 0, VDC: 0 }
            };
        });

        const chCount = activeChapters.length;

        if (presetType === 'gdpt28') {
            // Đề chuẩn 50 phút GDPT 2018 (28 câu):
            // Phần I: 18 câu Trắc nghiệm (8 Biết, 6 Hiểu, 4 Vận dụng)
            const mcqs: { lvl: QuestionLevel; count: number }[] = [
                { lvl: 'B', count: 8 },
                { lvl: 'H', count: 6 },
                { lvl: 'VD', count: 4 }
            ];
            mcqs.forEach(({ lvl, count }) => {
                for (let i = 0; i < count; i++) {
                    const ch = activeChapters[i % chCount];
                    next[ch.id].mcq[lvl]++;
                }
            });

            // Phần II: 4 câu Đúng/Sai (1 Biết, 2 Hiểu, 1 Vận dụng)
            const tfs: { lvl: QuestionLevel; count: number }[] = [
                { lvl: 'B', count: 1 },
                { lvl: 'H', count: 2 },
                { lvl: 'VD', count: 1 }
            ];
            tfs.forEach(({ lvl, count }) => {
                for (let i = 0; i < count; i++) {
                    const ch = activeChapters[i % chCount];
                    next[ch.id]['group-tf'][lvl]++;
                }
            });

            // Phần III: 6 câu Trả lời ngắn (2 Hiểu, 2 Vận dụng, 2 VDC)
            const shorts: { lvl: QuestionLevel; count: number }[] = [
                { lvl: 'H', count: 2 },
                { lvl: 'VD', count: 2 },
                { lvl: 'VDC', count: 2 }
            ];
            shorts.forEach(({ lvl, count }) => {
                for (let i = 0; i < count; i++) {
                    const ch = activeChapters[i % chCount];
                    next[ch.id].short[lvl]++;
                }
            });
        } else if (presetType === 'test45') {
            // Kiểm tra 45 phút (20 câu): 12 MCQ (6B, 4H, 2VD) + 4 Đúng/Sai (1B, 2H, 1VD) + 4 Trả lời ngắn (1H, 2VD, 1VDC)
            const mcqs: { lvl: QuestionLevel; count: number }[] = [
                { lvl: 'B', count: 6 },
                { lvl: 'H', count: 4 },
                { lvl: 'VD', count: 2 }
            ];
            mcqs.forEach(({ lvl, count }) => {
                for (let i = 0; i < count; i++) next[activeChapters[i % chCount].id].mcq[lvl]++;
            });
            const tfs: { lvl: QuestionLevel; count: number }[] = [
                { lvl: 'B', count: 1 },
                { lvl: 'H', count: 2 },
                { lvl: 'VD', count: 1 }
            ];
            tfs.forEach(({ lvl, count }) => {
                for (let i = 0; i < count; i++) next[activeChapters[i % chCount].id]['group-tf'][lvl]++;
            });
            const shorts: { lvl: QuestionLevel; count: number }[] = [
                { lvl: 'H', count: 1 },
                { lvl: 'VD', count: 2 },
                { lvl: 'VDC', count: 1 }
            ];
            shorts.forEach(({ lvl, count }) => {
                for (let i = 0; i < count; i++) next[activeChapters[i % chCount].id].short[lvl]++;
            });
        } else if (presetType === 'test15') {
            // Kiểm tra 15 phút (10 câu trắc nghiệm): 4B, 4H, 2VD
            const mcqs: { lvl: QuestionLevel; count: number }[] = [
                { lvl: 'B', count: 4 },
                { lvl: 'H', count: 4 },
                { lvl: 'VD', count: 2 }
            ];
            mcqs.forEach(({ lvl, count }) => {
                for (let i = 0; i < count; i++) next[activeChapters[i % chCount].id].mcq[lvl]++;
            });
        }

        setMatrixData(next);
    };

    // Xóa trắng ma trận
    const handleClearMatrix = () => {
        const next: Record<string, ChapterMatrixData> = {};
        activeChapters.forEach(c => {
            next[c.id] = {
                mcq: { B: 0, H: 0, VD: 0, VDC: 0 },
                'group-tf': { B: 0, H: 0, VD: 0, VDC: 0 },
                short: { B: 0, H: 0, VD: 0, VDC: 0 }
            };
        });
        setMatrixData(next);
    };

    // Tính toán tổng số lượng câu hỏi trong ma trận và thống kê (hoàn toàn dùng AI soạn)
    const matrixStats = useMemo(() => {
        let totalCount = 0;
        let p1Count = 0;
        let p2Count = 0;
        let p3Count = 0;

        let bCount = 0;
        let hCount = 0;
        let vdCount = 0;
        let vdcCount = 0;

        activeChapters.forEach(ch => {
            const data = matrixData[ch.id];
            if (!data) return;

            const types: QuestionType[] = ['mcq', 'group-tf', 'short'];
            const levels: QuestionLevel[] = ['B', 'H', 'VD', 'VDC'];

            types.forEach(t => {
                levels.forEach(l => {
                    const req = data[t]?.[l] || 0;
                    if (req <= 0) return;

                    totalCount += req;
                    if (t === 'mcq') p1Count += req;
                    else if (t === 'group-tf') p2Count += req;
                    else if (t === 'short') p3Count += req;

                    if (l === 'B') bCount += req;
                    else if (l === 'H') hCount += req;
                    else if (l === 'VD') vdCount += req;
                    else if (l === 'VDC') vdcCount += req;
                });
            });
        });

        return {
            totalCount,
            p1Count,
            p2Count,
            p3Count,
            bCount,
            hCount,
            vdCount,
            vdcCount
        };
    }, [matrixData, activeChapters]);

    // Xử lý tệp PDF
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.type !== 'application/pdf') {
                setErrorMsg("Chỉ hỗ trợ tệp định dạng PDF.");
                return;
            }
            setPdfFile(file);
            setErrorMsg(null);
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = (reader.result as string).split(',')[1];
                setPdfBase64(base64);
            };
            reader.readAsDataURL(file);
        }
    };

    // Xử lý nút chính: TẠO ĐỀ THEO MA TRẬN
    const handleGenerateMatrix = async () => {
        setErrorMsg(null);
        if (matrixStats.totalCount === 0) {
            setErrorMsg("Ma trận đề thi hiện tại chưa có câu hỏi nào (tổng = 0). Vui lòng điền số lượng câu hỏi vào các ô hoặc chọn 'Mẫu ma trận nhanh' ở trên!");
            return;
        }

        if (activeTab === 'pdf' && !pdfBase64) {
            setErrorMsg("Vui lòng tải lên tệp PDF đề thi hoặc tài liệu ôn tập trước khi bóc tách & tạo đề!");
            return;
        }

        setIsInternalProcessing(true);
        const startTime = Date.now();
        const initialSteps: TimelineStepItem[] = [
            { id: 'step_check', label: '1. Phân tích ma trận & chuẩn GDPT 2018', description: `Tổng hợp ${matrixStats.totalCount} câu hỏi theo từng chương & mức độ nhận thức`, status: 'active' },
            { id: 'step_ai', label: '2. AI Gemini soạn câu hỏi theo ma trận', description: 'Tự động tạo câu hỏi bám sát từng mức độ [Biết, Hiểu, Vận dụng, VDC]', status: 'pending' },
            { id: 'step_normalize', label: '3. Chuẩn hóa công thức Toán & LaTeX', description: 'Làm sạch và kiểm tra cú pháp KaTeX/LaTeX', status: 'pending' },
            { id: 'step_done', label: '4. Hoàn tất ma trận đề thi', description: 'Tổng hợp bộ đề và nạp vào Editor/Ngân hàng', status: 'pending' }
        ];

        setTimelineProgress({
            isOpen: true,
            title: activeTab === 'bank' ? 'AI SOẠN ĐỀ THEO MA TRẬN GDPT 2018' : (activeTab === 'pdf' ? 'BÓC TÁCH & SOẠN ĐỀ THEO MA TRẬN TỪ PDF' : 'AI SOẠN ĐỀ THEO MA TRẬN TỪ PROMPT'),
            subtitle: `Môn: ${currentSubject} • Khối: ${grade} • Tổng số ma trận: ${matrixStats.totalCount} câu`,
            percent: 15,
            currentAction: 'checking_matrix',
            detailsMessage: `Đang phân tích cấu trúc ma trận kiến thức (${matrixStats.totalCount} câu)...`,
            steps: initialSteps,
            logs: [`Bắt đầu khởi tạo ma trận đề thi: tổng cộng ${matrixStats.totalCount} câu hỏi (soạn hoàn toàn bằng AI).`]
        });

        try {
            const finalQuestions: Question[] = [];
            const aiMissingRequirements: MatrixRequirementItem[] = [];

            // Duyệt qua toàn bộ các ô trong ma trận - Dùng trực tiếp AI soạn theo ma trận
            activeChapters.forEach(ch => {
                const data = matrixData[ch.id];
                if (!data) return;

                const types: QuestionType[] = ['mcq', 'group-tf', 'short'];
                const levels: QuestionLevel[] = ['B', 'H', 'VD', 'VDC'];

                types.forEach(t => {
                    levels.forEach(l => {
                        const count = data[t]?.[l] || 0;
                        if (count <= 0) return;

                        // AI sinh toàn bộ theo ma trận đã cấu hình (bỏ qua duyệt bảng câu hỏi để tiết kiệm tối đa băng thông)
                        aiMissingRequirements.push({
                            chapterId: ch.id,
                            chapterName: ch.name,
                            type: t,
                            level: l,
                            count: count
                        });
                    });
                });
            });

            const totalNeedAi = aiMissingRequirements.reduce((sum, r) => sum + r.count, 0);

            // Cập nhật bước 1 trong Timeline
            setTimelineProgress(prev => ({
                ...prev,
                percent: 25,
                currentAction: 'checking_matrix',
                detailsMessage: `Đã thiết lập ma trận yêu cầu ${totalNeedAi} câu hỏi cho AI Gemini.`,
                steps: prev.steps.map(s => {
                    if (s.id === 'step_check') return { ...s, status: 'completed' };
                    if (s.id === 'step_ai') return { ...s, status: 'active' };
                    return s;
                }),
                logs: [
                    ...prev.logs, 
                    `Đã thiết lập ma trận: Yêu cầu AI soạn mới toàn bộ ${totalNeedAi} câu bám sát chuẩn GDPT 2018.`
                ]
            }));

            // Nếu có câu hỏi cần AI tự soạn theo mức độ
            if (aiMissingRequirements.length > 0) {
                setTimelineProgress(prev => ({
                    ...prev,
                    percent: 35,
                    currentAction: 'generating_ai',
                    detailsMessage: `AI Gemini đang soạn ${totalNeedAi} câu hỏi mới theo các mức độ còn thiếu...`,
                    steps: prev.steps.map(s => {
                        if (s.id === 'step_check') return { ...s, status: 'completed' };
                        if (s.id === 'step_ai') return { ...s, status: 'active' };
                        return s;
                    }),
                    logs: [
                        ...prev.logs,
                        `Bắt đầu sinh câu hỏi bằng AI: ${totalNeedAi} câu (chia theo từng nhóm mức độ nhận thức).`
                    ]
                }));

                const generatedByAi = await generateQuestionsForMatrix({
                    subject: currentSubject,
                    grade,
                    requirements: aiMissingRequirements,
                    topic: `${currentSubject} ${grade}`,
                    promptAdditions: activeTab === 'prompt' ? promptAdditions : undefined,
                    pdfBase64: activeTab === 'pdf' ? (pdfBase64 || undefined) : undefined,
                    customApiKey,
                    onProgress: (prog) => {
                        const levelNames: Record<string, string> = {
                            'B': 'Nhận biết',
                            'H': 'Thông hiểu',
                            'VD': 'Vận dụng',
                            'VDC': 'Vận dụng cao'
                        };
                        const lvlLabel = prog.currentLevel ? levelNames[prog.currentLevel] || prog.currentLevel : '';
                        setTimelineProgress(prev => ({
                            ...prev,
                            percent: prog.percent,
                            currentAction: prog.phase === 'generating' ? 'generating_ai' : 'normalizing',
                            currentLevel: prog.currentLevel,
                            currentChapter: prog.currentChapter,
                            detailsMessage: prog.description || prog.title,
                            logs: [
                                ...prev.logs,
                                `[${new Date().toLocaleTimeString('vi-VN')}] ${prog.title} • ${lvlLabel ? `[${lvlLabel}]` : ''}`
                            ]
                        }));
                    }
                });

                finalQuestions.push(...generatedByAi);
            }

            // BƯỚC 4: CHUẨN HÓA LATEX & SẮP XẾP BỘ GD&ĐT
            setTimelineProgress(prev => ({
                ...prev,
                percent: 92,
                currentAction: 'normalizing',
                detailsMessage: 'Đang chuẩn hóa công thức toán LaTeX & sắp xếp các phần thi I, II, III theo GDPT 2018...',
                steps: prev.steps.map(s => {
                    if (s.id === 'step_ai') return { ...s, status: 'completed' };
                    if (s.id === 'step_normalize') return { ...s, status: 'active' };
                    return s;
                }),
                logs: [...prev.logs, 'Đang chuẩn hóa LaTeX và định dạng các phương án...']
            }));

            // Sắp xếp thứ tự các câu hỏi chuẩn cấu trúc Bộ GD&ĐT:
            // Phần I: Trắc nghiệm -> Phần II: Đúng/Sai -> Phần III: Trả lời ngắn
            const typeWeight: Record<QuestionType, number> = {
                'mcq': 1,
                'group-tf': 2,
                'short': 3
            };
            const levelWeight: Record<QuestionLevel, number> = {
                'B': 1,
                'H': 2,
                'VD': 3,
                'VDC': 4
            };

            finalQuestions.sort((a, b) => {
                const typeDiff = (typeWeight[a.type] || 1) - (typeWeight[b.type] || 1);
                if (typeDiff !== 0) return typeDiff;
                const aLevel = (a.level as QuestionLevel) || 'B';
                const bLevel = (b.level as QuestionLevel) || 'B';
                return (levelWeight[aLevel] || 1) - (levelWeight[bLevel] || 1);
            });

            // BƯỚC 5: HOÀN TẤT
            setTimelineProgress(prev => ({
                ...prev,
                percent: 100,
                currentAction: 'completed',
                detailsMessage: `Hoàn tất! Đã tạo thành công bộ ${finalQuestions.length} câu hỏi theo đúng ma trận.`,
                steps: prev.steps.map(s => ({ ...s, status: 'completed' })),
                logs: [...prev.logs, `Đã hoàn tất toàn bộ ma trận ${finalQuestions.length} câu hỏi!`]
            }));

            // Đợi 600ms để người dùng nhìn thấy trạng thái 100% hoàn tất
            await new Promise(r => setTimeout(r, 600));

            if (onMatrixGenerateComplete) {
                await onMatrixGenerateComplete({
                    title: '',
                    durationMinutes: 50,
                    questions: finalQuestions,
                    target: targetDestination
                });
            } else if (onGenerate) {
                // Fallback nếu dùng handler cũ
                await onGenerate({
                    topic: '',
                    p1: matrixStats.p1Count,
                    p2: matrixStats.p2Count,
                    p3: matrixStats.p3Count,
                    target: targetDestination
                });
            }

            setTimelineProgress(prev => ({ ...prev, isOpen: false }));
        } catch (err: any) {
            console.error("Lỗi tạo đề theo ma trận:", err);
            setErrorMsg(err?.message || "Đã xảy ra lỗi trong quá trình tạo đề thi.");
            setTimelineProgress(prev => ({
                ...prev,
                currentAction: 'error',
                detailsMessage: `Lỗi: ${err?.message || 'Không thể tạo đề theo ma trận.'}`,
                logs: [...prev.logs, `Lỗi: ${err?.message || 'Thất bại'}`]
            }));
        } finally {
            setIsInternalProcessing(false);
            setStatusMsg(null);
        }
    };

    const isBusy = isLoading || isInternalProcessing;

    return (
        <div className="w-full max-w-6xl mx-auto space-y-6 animate-fade-in pb-20">
            {/* THANH ĐIỀU HƯỚNG 3 TAB CHÍNH */}
            <div className="bg-slate-100/90 p-1.5 rounded-2xl flex items-center gap-2 border border-slate-200 shadow-sm max-w-2xl mx-auto">
                <button
                    type="button"
                    onClick={() => setActiveTab('bank')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase transition-all duration-200 ${
                        activeTab === 'bank'
                            ? 'bg-white text-indigo-700 shadow-md border border-indigo-100 scale-[1.02]'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                >
                    <Layers size={16} className={activeTab === 'bank' ? 'text-indigo-600' : 'text-slate-400'} />
                    <span>AI Soạn theo ma trận</span>
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('prompt')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase transition-all duration-200 ${
                        activeTab === 'prompt'
                            ? 'bg-white text-purple-700 shadow-md border border-purple-100 scale-[1.02]'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                >
                    <Sparkles size={16} className={activeTab === 'prompt' ? 'text-purple-600' : 'text-slate-400'} />
                    <span>Prompt với AI</span>
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('pdf')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-black uppercase transition-all duration-200 ${
                        activeTab === 'pdf'
                            ? 'bg-white text-emerald-700 shadow-md border border-emerald-100 scale-[1.02]'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                >
                    <FileUp size={16} className={activeTab === 'pdf' ? 'text-emerald-600' : 'text-slate-400'} />
                    <span>Tài liệu sẵn có (PDF)</span>
                </button>
            </div>

            {/* KHUNG NỘI DUNG CHÍNH */}
            <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                {/* THÔNG BÁO LỖI (NẾU CÓ) */}
                {errorMsg && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start justify-between gap-3 text-red-800 text-xs shadow-sm animate-fade-in">
                        <div className="flex items-start gap-2.5">
                            <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="font-bold whitespace-pre-line leading-relaxed">{errorMsg}</p>
                                <p className="text-[11px] text-red-600 font-medium">
                                    💡 Gợi ý: Nếu hệ thống báo tải cao (503/429), bạn có thể đợi 5-10 giây rồi bấm tạo lại, hoặc bấm <b>"Gemini Key"</b> ở góc trên để cấu hình API Key riêng cho mình.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setErrorMsg(null)}
                            className="text-red-400 hover:text-red-700 p-1 rounded-lg hover:bg-red-100 transition"
                            title="Đóng thông báo"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                {/* HEADER TỪNG TAB */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
                    <div className="space-y-2">
                        {activeTab === 'bank' && (
                            <>
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-indigo-700 text-[10px] font-black uppercase tracking-wider">
                                    <Sparkles size={13} />
                                    <span>AI SOẠN ĐỀ THEO MA TRẬN GDPT 2018</span>
                                    <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-full text-[9px]">TIẾT KIỆM BĂNG THÔNG</span>
                                </div>
                                <h2 className="text-2xl font-black uppercase text-slate-800 tracking-tight">
                                    Soạn đề theo ma trận kiến thức (Dùng AI)
                                </h2>
                                <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
                                    Ma trận tích hợp đầy đủ 3 loại câu hỏi (Phần I: Trắc nghiệm, Phần II: Đúng/Sai, Phần III: Trả lời ngắn) và 4 mức độ nhận thức (B, H, VD, VDC). Hệ thống dùng AI Gemini tạo mới 100% câu hỏi theo đúng ma trận mà không cần duyệt bảng câu hỏi, giúp tải cực nhanh và tiết kiệm tối đa băng thông.
                                </p>
                            </>
                        )}

                        {activeTab === 'prompt' && (
                            <>
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-50 border border-purple-200 rounded-full text-purple-700 text-[10px] font-black uppercase tracking-wider">
                                    <Sparkles size={13} />
                                    <span>SOẠN ĐỀ MỚI BẰNG PROMPT AI</span>
                                    <span className="bg-purple-600 text-white px-2 py-0.5 rounded-full text-[9px]">GDPT 2018</span>
                                </div>
                                <h2 className="text-2xl font-black uppercase text-slate-800 tracking-tight">
                                    Soạn đề mới bằng Prompt với AI
                                </h2>
                                <p className="text-xs text-slate-500 max-w-2xl">
                                    Nhập chủ đề và yêu cầu riêng biệt, AI Gemini sẽ tự động sinh mới 100% câu hỏi chất lượng cao đúng chuẩn khung ma trận Bộ GD&ĐT.
                                </p>
                            </>
                        )}

                        {activeTab === 'pdf' && (
                            <>
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-700 text-[10px] font-black uppercase tracking-wider">
                                    <FileUp size={13} />
                                    <span>BÓC TÁCH & TẠO ĐỀ TỪ TỆP PDF</span>
                                    <span className="bg-emerald-600 text-white px-2 py-0.5 rounded-full text-[9px]">AI BÓC TÁCH</span>
                                </div>
                                <h2 className="text-2xl font-black uppercase text-slate-800 tracking-tight">
                                    Soạn đề dựa trên tài liệu sẵn có (PDF)
                                </h2>
                                <p className="text-xs text-slate-500 max-w-2xl">
                                    Tải lên tài liệu PDF (đề thi, tài liệu ôn tập), AI sẽ tự động trích xuất các câu hỏi và phân loại vào các mức độ nhận thức theo đúng ma trận.
                                </p>
                            </>
                        )}
                    </div>

                    {/* VÙNG NHẬP PROMPT CHO TAB 2 HOẶC TẢI PDF CHO TAB 3 */}
                    {activeTab === 'prompt' && (
                        <div className="w-full lg:w-96 bg-purple-50/60 p-4 rounded-2xl border-2 border-purple-200 space-y-1.5 shadow-sm">
                            <label className="text-[10px] font-black uppercase text-purple-900 tracking-wider flex items-center gap-1.5">
                                <Sparkles size={13} className="text-purple-600" />
                                <span>yêu cầu thêm:</span>
                            </label>
                            <textarea
                                rows={3}
                                value={promptAdditions}
                                onChange={e => setPromptAdditions(e.target.value)}
                                placeholder="Ví dụ: Tập trung vào đồ thị biến thiên, các bài toán thực tế, không ra phần thang Kelvin..."
                                className="w-full bg-white border border-purple-200 rounded-xl p-3 text-xs font-bold text-slate-700 outline-none focus:border-purple-500 resize-none"
                            />
                        </div>
                    )}

                    {activeTab === 'pdf' && (
                        <div className="w-full lg:w-96">
                            <div className={`relative border-2 border-dashed rounded-2xl p-4 transition-all text-center ${
                                pdfFile ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-300 hover:border-emerald-400 bg-slate-50'
                            }`}>
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                    onChange={handleFileChange}
                                />
                                <div className="flex flex-col items-center gap-1.5">
                                    <FileUp className={pdfFile ? 'text-emerald-600' : 'text-slate-400'} size={24} />
                                    <p className="text-[11px] font-black uppercase text-slate-700 truncate max-w-[280px]">
                                        {pdfFile ? pdfFile.name : 'Nhấn hoặc kéo PDF vào đây'}
                                    </p>
                                    <p className="text-[9px] text-slate-400">
                                        {pdfFile ? `${(pdfFile.size / 1024).toFixed(1)} KB` : 'AI sẽ bóc tách các câu hỏi theo đúng ma trận'}
                                    </p>
                                    {pdfFile && (
                                        <button
                                            type="button"
                                            onClick={e => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setPdfFile(null);
                                                setPdfBase64(null);
                                            }}
                                            className="text-[9px] font-black text-red-500 uppercase mt-1 z-20 hover:underline"
                                        >
                                            Xóa tệp này
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* THÔNG BÁO TRẠNG THÁI / LỖI */}
                {errorMsg && (
                    <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-center gap-3 text-red-700 text-xs font-bold animate-shake">
                        <AlertTriangle className="shrink-0" size={18} />
                        <p>{errorMsg}</p>
                    </div>
                )}

                {statusMsg && (
                    <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-2xl flex items-center gap-3 text-indigo-800 text-xs font-bold animate-pulse">
                        <Loader2 className="shrink-0 animate-spin text-indigo-600" size={18} />
                        <p>{statusMsg}</p>
                    </div>
                )}

                {/* KHỐI LỚP & MÔN HỌC & ĐÍCH ĐẾN & NÚT TRUY CẬP NHANH */}
                <div className="flex flex-col gap-3.5 bg-slate-50/80 p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        {/* Chọn khối lớp & Môn học */}
                        <div className="flex flex-wrap items-center gap-3">
                            {/* Khối lớp */}
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Khối:</span>
                                {(['12', '11', '10'] as Grade[]).map(g => (
                                    <button
                                        key={g}
                                        type="button"
                                        onClick={() => setGrade(g)}
                                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black uppercase transition-all shadow-sm active:scale-95 ${
                                            grade === g
                                                ? 'bg-purple-600 text-white shadow-purple-200'
                                                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                                        }`}
                                    >
                                        KHỐI {g}
                                    </button>
                                ))}
                            </div>

                            {/* Vạch phân cách */}
                            <div className="hidden sm:block h-5 w-[1px] bg-slate-200" />

                            {/* Chọn Môn học */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Môn:</span>
                                {availableSubjects.map(s => {
                                    const isSelected = isSameSubject(currentSubject, s);
                                    return (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => handleSelectSubject(s)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 ${
                                                isSelected
                                                    ? 'bg-blue-600 text-white shadow-blue-200'
                                                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                                            }`}
                                        >
                                            {s}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Lối tắt vào Editor và Bank & Key */}
                        <div className="flex items-center gap-2 shrink-0">
                            {onOpenEditor && (
                                <button
                                    type="button"
                                    onClick={onOpenEditor}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase text-slate-700 hover:bg-slate-100 transition-all shadow-sm active:scale-95"
                                >
                                    <LayoutTemplate size={13} className="text-blue-600" />
                                    <span>VÀO EDITOR</span>
                                </button>
                            )}
                            {onOpenBank && (
                                <button
                                    type="button"
                                    onClick={onOpenBank}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase text-slate-700 hover:bg-slate-100 transition-all shadow-sm active:scale-95"
                                >
                                    <Database size={13} className="text-purple-600" />
                                    <span>VÀO BANK</span>
                                </button>
                            )}
                            {onApiKeyChange && (
                                <button
                                    type="button"
                                    onClick={() => setShowKeyInput(!showKeyInput)}
                                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase border transition-all shadow-sm active:scale-95 ${
                                        customApiKey 
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                                    }`}
                                    title="Cấu hình Gemini API Key riêng"
                                >
                                    <Key size={13} className={customApiKey ? "text-emerald-600" : "text-slate-500"}/>
                                    <span>{customApiKey ? "Key riêng: Bật" : "Gemini Key"}</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* HỘP NHẬP API KEY NẾU BẬT */}
                {showKeyInput && onApiKeyChange && (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black uppercase text-slate-600 tracking-wider">
                                Gemini API Key (dùng riêng cho tài khoản của bạn)
                            </label>
                            <span className="text-[9px] text-slate-400">Không ghi đè cấu hình của giáo viên khác</span>
                        </div>
                        <input
                            type="password"
                            value={customApiKey}
                            onChange={e => onApiKeyChange(e.target.value)}
                            placeholder="Nhập API Key từ Google AI Studio (AIzaSy...)"
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-medium outline-none focus:border-indigo-500"
                        />
                    </div>
                )}

                {/* THANH MẪU MA TRẬN NHANH & BỘ LỌC HIỂN THỊ */}
                <div className="flex flex-col gap-3 pt-2 border-t border-slate-100">
                    {/* HÀNG CÁC MẪU MA TRẬN NHANH */}
                    <div className="flex flex-wrap items-center gap-2 bg-indigo-50/70 p-2.5 rounded-2xl border border-indigo-100">
                        <span className="text-[10px] font-black uppercase text-indigo-900 tracking-wider flex items-center gap-1.5 mr-1">
                            <Sparkles size={13} className="text-indigo-600" />
                            <span>MẪU MA TRẬN NHANH:</span>
                        </span>
                        <button
                            type="button"
                            onClick={() => handleApplyPreset('gdpt28')}
                            className="px-3 py-1.5 bg-white hover:bg-indigo-600 hover:text-white text-indigo-700 border border-indigo-200 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm active:scale-95"
                            title="Tự động phân bổ đề chuẩn 50 phút GDPT: 18 MCQ + 4 Đúng/Sai + 6 Điền ngắn"
                        >
                            🎯 Chuẩn Bộ GD&ĐT (28 câu)
                        </button>
                        <button
                            type="button"
                            onClick={() => handleApplyPreset('test45')}
                            className="px-3 py-1.5 bg-white hover:bg-indigo-600 hover:text-white text-indigo-700 border border-indigo-200 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm active:scale-95"
                            title="Kiểm tra 45 phút: 12 MCQ + 4 Đúng/Sai + 4 Điền ngắn"
                        >
                            ⏱️ Kiểm tra 45 phút (20 câu)
                        </button>
                        <button
                            type="button"
                            onClick={() => handleApplyPreset('test15')}
                            className="px-3 py-1.5 bg-white hover:bg-indigo-600 hover:text-white text-indigo-700 border border-indigo-200 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm active:scale-95"
                            title="Kiểm tra 15 phút: 10 câu trắc nghiệm"
                        >
                            ⚡ Kiểm tra 15 phút (10 câu)
                        </button>

                        <button
                            type="button"
                            onClick={handleClearMatrix}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-xl text-[10px] font-black uppercase hover:bg-red-50 shadow-sm active:scale-95 transition-all ml-auto"
                            title="Xóa trắng tất cả số lượng câu hỏi trong ma trận"
                        >
                            <RotateCcw size={12} />
                            <span>Xóa trắng</span>
                        </button>
                    </div>

                    {/* BỘ LỌC HIỂN THỊ LOẠI CÂU */}
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest mr-2">
                            HIỂN THỊ LOẠI CÂU:
                        </span>
                        <button
                            type="button"
                            onClick={() => setTypeFilter('all')}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                                typeFilter === 'all'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            Tất cả 3 loại câu (Phần I, II, III)
                        </button>
                        <button
                            type="button"
                            onClick={() => setTypeFilter('mcq')}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                                typeFilter === 'mcq'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            Phần I: Trắc nghiệm
                        </button>
                        <button
                            type="button"
                            onClick={() => setTypeFilter('group-tf')}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                                typeFilter === 'group-tf'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            Phần II: Đúng / Sai
                        </button>
                        <button
                            type="button"
                            onClick={() => setTypeFilter('short')}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                                typeFilter === 'short'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            Phần III: Trả lời ngắn
                        </button>
                    </div>
                </div>

                {/* BẢNG MA TRẬN CHI TIẾT THEO CHƯƠNG & LOẠI CÂU */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
                    <table className="w-full text-left border-collapse">
                        {/* TIÊU ĐỀ BẢNG MA TRẬN */}
                        <thead>
                            <tr className="text-white text-[11px] font-black uppercase tracking-wider text-center">
                                <th className="bg-slate-900 px-4 py-3 text-left w-1/4">CHƯƠNG KIẾN THỨC</th>
                                <th className="bg-slate-900 px-4 py-3 text-left w-1/4">HÀNG LOẠI CÂU HỎI</th>
                                <th className="bg-emerald-600 px-3 py-3 w-28">BIẾT (B)</th>
                                <th className="bg-blue-600 px-3 py-3 w-28">HIỂU (H)</th>
                                <th className="bg-amber-600 px-3 py-3 w-28">V.DỤNG (VD)</th>
                                <th className="bg-red-700 px-3 py-3 w-28">VDC</th>
                                <th className="bg-slate-900 px-3 py-3 w-24">TỔNG</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-200 text-xs font-bold text-slate-700">
                            {activeChapters.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="py-12 px-6 text-center bg-slate-50/70">
                                        <div className="max-w-md mx-auto space-y-3">
                                            <BookOpen size={40} className="mx-auto text-slate-300" />
                                            <div className="space-y-1">
                                                <p className="text-sm font-black uppercase text-slate-700 tracking-wider">
                                                    Chưa có chương bài học nào trong Mục Chương cho Khối {grade} (Môn {currentSubject})
                                                </p>
                                                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                                                    Hệ thống chỉ lấy danh sách chương bài học được tạo trong <b>Mục Chương</b> (tự động loại bỏ các mục KTTX, KTGK, KTCK).
                                                </p>
                                            </div>
                                            {onAddChapter && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newChName = prompt(`Nhập tên chương bài học mới cho Khối ${grade} (Môn ${currentSubject}):`);
                                                        if (newChName && newChName.trim()) {
                                                            onAddChapter(newChName.trim(), grade, currentSubject);
                                                        }
                                                    }}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition"
                                                >
                                                    <PlusCircle size={14} /> Thêm chương mới cho Khối {grade} (Môn {currentSubject})
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )}

                            {activeChapters.map(ch => {
                                const chData = matrixData[ch.id] || {
                                    mcq: { B: 0, H: 0, VD: 0, VDC: 0 },
                                    'group-tf': { B: 0, H: 0, VD: 0, VDC: 0 },
                                    short: { B: 0, H: 0, VD: 0, VDC: 0 }
                                };

                                // Tổng câu chọn trong ma trận cho chương này
                                const chSelectedTotal = 
                                    Object.values(chData.mcq).reduce((a, b) => a + b, 0) +
                                    Object.values(chData['group-tf']).reduce((a, b) => a + b, 0) +
                                    Object.values(chData.short).reduce((a, b) => a + b, 0);

                                const isCollapsed = Boolean(collapsedChapters[ch.id]);

                                return (
                                    <React.Fragment key={ch.id}>
                                        {/* HÀNG TIÊU ĐỀ CHƯƠNG */}
                                        <tr className="bg-slate-100/90 border-t-2 border-slate-200">
                                            <td colSpan={6} className="px-4 py-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => setCollapsedChapters(prev => ({ ...prev, [ch.id]: !prev[ch.id] }))}
                                                    className="flex items-center gap-2 text-left font-black text-slate-800 hover:text-indigo-600 transition-colors"
                                                >
                                                    {isCollapsed ? <ChevronRight size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                                                    <BookOpen size={14} className="text-indigo-600" />
                                                    <span className="text-xs uppercase tracking-wide">{ch.name}</span>
                                                </button>
                                            </td>
                                            <td className="px-3 py-2.5 text-center font-black text-slate-900 bg-slate-200/60">
                                                {chSelectedTotal}
                                            </td>
                                        </tr>

                                        {!isCollapsed && (
                                            <>
                                                {/* HÀNG PHẦN I: TRẮC NGHIỆM */}
                                                {(typeFilter === 'all' || typeFilter === 'mcq') && (
                                                    <tr className="hover:bg-slate-50/80 transition-colors">
                                                        <td className="px-4 py-2 text-slate-400 text-[11px] truncate max-w-[200px]">
                                                            • {ch.name}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-[10px] font-black shrink-0">
                                                                    I
                                                                </span>
                                                                <div className="font-bold text-slate-800 text-[11px]">PHẦN I: Trắc nghiệm (4 phương án)</div>
                                                            </div>
                                                        </td>
                                                        {(['B', 'H', 'VD', 'VDC'] as QuestionLevel[]).map(lvl => (
                                                            <td key={lvl} className="p-2 text-center">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={50}
                                                                    value={chData.mcq[lvl] || 0}
                                                                    onChange={e => handleCellChange(ch.id, 'mcq', lvl, parseInt(e.target.value))}
                                                                    className={`w-16 mx-auto text-center font-black text-xs py-1.5 px-1 rounded-xl border outline-none transition-all ${
                                                                        chData.mcq[lvl] > 0
                                                                            ? 'bg-emerald-50 border-emerald-400 text-emerald-800 shadow-sm'
                                                                            : 'bg-slate-50 border-slate-200 text-slate-600 focus:bg-white focus:border-indigo-400'
                                                                    }`}
                                                                />
                                                            </td>
                                                        ))}
                                                        <td className="px-3 py-2 text-center font-black text-slate-800 bg-slate-50/50">
                                                            {Object.values(chData.mcq).reduce((a, b) => a + b, 0)}
                                                        </td>
                                                    </tr>
                                                )}

                                                {/* HÀNG PHẦN II: ĐÚNG / SAI */}
                                                {(typeFilter === 'all' || typeFilter === 'group-tf') && (
                                                    <tr className="hover:bg-slate-50/80 transition-colors">
                                                        <td className="px-4 py-2 text-slate-400 text-[11px] truncate max-w-[200px]">
                                                            • {ch.name}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-5 h-5 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center text-[10px] font-black shrink-0">
                                                                    II
                                                                </span>
                                                                <div className="font-bold text-slate-800 text-[11px]">PHẦN II: Đúng / Sai (4 ý a,b,c,d)</div>
                                                            </div>
                                                        </td>
                                                        {(['B', 'H', 'VD', 'VDC'] as QuestionLevel[]).map(lvl => (
                                                            <td key={lvl} className="p-2 text-center">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={50}
                                                                    value={chData['group-tf'][lvl] || 0}
                                                                    onChange={e => handleCellChange(ch.id, 'group-tf', lvl, parseInt(e.target.value))}
                                                                    className={`w-16 mx-auto text-center font-black text-xs py-1.5 px-1 rounded-xl border outline-none transition-all ${
                                                                        chData['group-tf'][lvl] > 0
                                                                            ? 'bg-purple-50 border-purple-400 text-purple-800 shadow-sm'
                                                                            : 'bg-slate-50 border-slate-200 text-slate-600 focus:bg-white focus:border-indigo-400'
                                                                    }`}
                                                                />
                                                            </td>
                                                        ))}
                                                        <td className="px-3 py-2 text-center font-black text-slate-800 bg-slate-50/50">
                                                            {Object.values(chData['group-tf']).reduce((a, b) => a + b, 0)}
                                                        </td>
                                                    </tr>
                                                )}

                                                {/* HÀNG PHẦN III: TRẢ LỜI NGẮN */}
                                                {(typeFilter === 'all' || typeFilter === 'short') && (
                                                    <tr className="hover:bg-slate-50/80 transition-colors">
                                                        <td className="px-4 py-2 text-slate-400 text-[11px] truncate max-w-[200px]">
                                                            • {ch.name}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-5 h-5 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-[10px] font-black shrink-0">
                                                                    III
                                                                </span>
                                                                <div className="font-bold text-slate-800 text-[11px]">PHẦN III: Trả lời ngắn (Điền số)</div>
                                                            </div>
                                                        </td>
                                                        {(['B', 'H', 'VD', 'VDC'] as QuestionLevel[]).map(lvl => (
                                                            <td key={lvl} className="p-2 text-center">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={50}
                                                                    value={chData.short[lvl] || 0}
                                                                    onChange={e => handleCellChange(ch.id, 'short', lvl, parseInt(e.target.value))}
                                                                    className={`w-16 mx-auto text-center font-black text-xs py-1.5 px-1 rounded-xl border outline-none transition-all ${
                                                                        chData.short[lvl] > 0
                                                                            ? 'bg-amber-50 border-amber-400 text-amber-800 shadow-sm'
                                                                            : 'bg-slate-50 border-slate-200 text-slate-600 focus:bg-white focus:border-indigo-400'
                                                                    }`}
                                                                />
                                                            </td>
                                                        ))}
                                                        <td className="px-3 py-2 text-center font-black text-slate-800 bg-slate-50/50">
                                                            {Object.values(chData.short).reduce((a, b) => a + b, 0)}
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>

                        {/* HÀNG TỔNG CỘNG CUỐI BẢNG */}
                        <tfoot>
                            <tr className="bg-slate-900 text-white font-black text-xs text-center">
                                <td colSpan={2} className="px-4 py-3 text-left uppercase tracking-wider">
                                    TỔNG CỘNG CÁC MỨC ĐỘ TRONG ĐỀ
                                </td>
                                <td className="px-3 py-3 bg-emerald-700">{matrixStats.bCount} câu</td>
                                <td className="px-3 py-3 bg-blue-700">{matrixStats.hCount} câu</td>
                                <td className="px-3 py-3 bg-amber-700">{matrixStats.vdCount} câu</td>
                                <td className="px-3 py-3 bg-red-800">{matrixStats.vdcCount} câu</td>
                                <td className="px-3 py-3 bg-indigo-900 text-base">{matrixStats.totalCount}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* THẺ TỔNG KẾT & CƠ CHẾ TỰ ĐỘNG SOẠN BỔ SUNG */}
                <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-200 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="text-xs font-black uppercase text-slate-700 flex items-center gap-2">
                                <Layers size={15} className="text-indigo-600" />
                                <span>CẤU TRÚC ĐỀ THEO MA TRẬN:</span>
                                <span className="text-indigo-600 font-extrabold text-sm">{matrixStats.totalCount} CÂU HỎI</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-bold">
                                <span>P.I (Trắc nghiệm): <b className="text-slate-800">{matrixStats.p1Count}</b></span>
                                <span>•</span>
                                <span>P.II (Đúng/Sai): <b className="text-slate-800">{matrixStats.p2Count}</b></span>
                                <span>•</span>
                                <span>P.III (Trả lời ngắn): <b className="text-slate-800">{matrixStats.p3Count}</b></span>
                            </div>
                        </div>

                        {/* ĐÍCH ĐẾN CỦA ĐỀ THI */}
                        <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border border-slate-200">
                            <button
                                type="button"
                                onClick={() => setTargetDestination('editor')}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
                                    targetDestination === 'editor'
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-900'
                                }`}
                            >
                                <LayoutTemplate size={13} />
                                <span>Đưa vào Editor</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setTargetDestination('bank')}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
                                    targetDestination === 'bank'
                                        ? 'bg-purple-600 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-900'
                                }`}
                            >
                                <Database size={13} />
                                <span>Lưu vào Ngân hàng</span>
                            </button>
                        </div>
                    </div>

                    {/* NGUỒN CÂU HỎI (CHO TAB 1) */}
                    {activeTab === 'bank' && (
                        <div className="p-4 bg-indigo-50/70 rounded-2xl border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 text-indigo-950 font-bold">
                                <Sparkles size={16} className="text-indigo-600 shrink-0" />
                                <span>
                                    Cơ chế tạo đề:
                                    <span className="text-indigo-700 font-black ml-1.5 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 shadow-sm">
                                        AI Gemini soạn mới 100% ({matrixStats.totalCount} câu) theo ma trận
                                    </span>
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">
                                ⚡ Tiết kiệm băng thông: Tạo đề tức thì mà không cần quét bảng câu hỏi.
                            </p>
                        </div>
                    )}
                </div>

                {/* NÚT HÀNH ĐỘNG TẠO ĐỀ CHÍNH */}
                <button
                    type="button"
                    onClick={handleGenerateMatrix}
                    disabled={isBusy || matrixStats.totalCount === 0}
                    className={`w-full py-5 rounded-[2rem] font-black shadow-xl flex items-center justify-center gap-3 text-white text-sm uppercase tracking-wider transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed ${
                        activeTab === 'bank'
                            ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 hover:opacity-95 shadow-indigo-200'
                            : (activeTab === 'prompt'
                                ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 hover:opacity-95 shadow-purple-200'
                                : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:opacity-95 shadow-emerald-200')
                    }`}
                >
                    {isBusy ? (
                        <>
                            <Loader2 className="animate-spin" size={24} />
                            <span>{statusMsg || 'Đang xử lý ma trận và tạo câu hỏi...'}</span>
                        </>
                    ) : (
                        <>
                            {activeTab === 'bank' ? <Sparkles size={22} /> : (activeTab === 'prompt' ? <Sparkles size={22} /> : <FileUp size={22} />)}
                            <span>
                                {activeTab === 'bank' && `AI SOẠN ĐỀ THEO MA TRẬN (${matrixStats.totalCount} CÂU)`}
                                {activeTab === 'prompt' && `AI TẠO ĐỀ THEO MA TRẬN TỪ PROMPT (${matrixStats.totalCount} CÂU)`}
                                {activeTab === 'pdf' && `BÓC TÁCH & TẠO ĐỀ TỪ TỆP PDF (${matrixStats.totalCount} CÂU)`}
                            </span>
                        </>
                    )}
                </button>
            </div>

            {/* MODAL TIẾN TRÌNH TIMELINE THỜI GIAN THỰC CHO AI */}
            <AIProgressTimelineModal
                isOpen={timelineProgress.isOpen}
                title={timelineProgress.title}
                subtitle={timelineProgress.subtitle}
                percent={timelineProgress.percent}
                currentAction={timelineProgress.currentAction}
                currentLevel={timelineProgress.currentLevel}
                currentChapter={timelineProgress.currentChapter}
                detailsMessage={timelineProgress.detailsMessage}
                steps={timelineProgress.steps}
                logs={timelineProgress.logs}
                canClose={timelineProgress.currentAction === 'error'}
                onClose={() => setTimelineProgress(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
}
