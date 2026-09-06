import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Grade, Question, Chapter, QuestionType, QuestionLevel } from '../../types';
import { generateQuestionsForMatrix, MatrixRequirementItem, MatrixProgressUpdate } from '../../services/gemini';
import { isCurriculumChapter } from '../../services/chapterUtils';
import AIProgressTimelineModal, { TimelineStepItem } from './AIProgressTimelineModal';
import { 
    Sparkles, Database, LayoutTemplate, Loader2, AlertTriangle, PlusCircle, 
    FileUp, Key, Eye, EyeOff, Check, RotateCcw, ChevronDown, ChevronRight, 
    BookOpen, Layers, Info, FileText, CheckCircle2
} from 'lucide-react';

interface AIRendererProps {
    grade: Grade;
    setGrade: (val: Grade) => void;
    subject?: string;
    chapters: Chapter[];
    bankQuestions: Question[];
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

// Danh mục chương chuẩn GDPT 2018 dự phòng khi môn/khối chưa được tạo chương trong DB
const getStandardChaptersForSubjectAndGrade = (subject: string, grade: Grade): { id: string; name: string }[] => {
    const s = subject.toLowerCase().trim();
    if (s.includes('lý') || s.includes('vật lí') || s.includes('vật lý') || s.includes('physics')) {
        if (grade === '12') {
            return [
                { id: 'std_vl12_c1', name: 'Chương 1: Vật lý nhiệt' },
                { id: 'std_vl12_c2', name: 'Chương 2: Khí lí tưởng' },
                { id: 'std_vl12_c3', name: 'Chương 3: Từ trường' },
                { id: 'std_vl12_c4', name: 'Chương 4: Vật lí hạt nhân' }
            ];
        }
        if (grade === '11') {
            return [
                { id: 'std_vl11_c1', name: 'Chương 1: Dao động' },
                { id: 'std_vl11_c2', name: 'Chương 2: Sóng' },
                { id: 'std_vl11_c3', name: 'Chương 3: Điện trường' },
                { id: 'std_vl11_c4', name: 'Chương 4: Dòng điện không đổi & Mạch điện' }
            ];
        }
        return [
            { id: 'std_vl10_c1', name: 'Chương 1: Mở đầu & Động học' },
            { id: 'std_vl10_c2', name: 'Chương 2: Động lực học' },
            { id: 'std_vl10_c3', name: 'Chương 3: Năng lượng, công, công suất' },
            { id: 'std_vl10_c4', name: 'Chương 4: Động lượng' }
        ];
    }

    if (s.includes('toán') || s.includes('math')) {
        if (grade === '12') {
            return [
                { id: 'std_m12_c1', name: 'Chương 1: Ứng dụng đạo hàm để khảo sát và vẽ đồ thị hàm số' },
                { id: 'std_m12_c2', name: 'Chương 2: Vectơ và hệ tọa độ trong không gian' },
                { id: 'std_m12_c3', name: 'Chương 3: Các số đặc trưng đo mức độ phân tán của mẫu số liệu' },
                { id: 'std_m12_c4', name: 'Chương 4: Nguyên hàm và Tích phân' },
                { id: 'std_m12_c5', name: 'Chương 5: Phương pháp tọa độ trong không gian' },
                { id: 'std_m12_c6', name: 'Chương 6: Xác suất có điều kiện' }
            ];
        }
        if (grade === '11') {
            return [
                { id: 'std_m11_c1', name: 'Chương 1: Hàm số lượng giác và phương trình lượng giác' },
                { id: 'std_m11_c2', name: 'Chương 2: Dãy số. Cấp số cộng và cấp số nhân' },
                { id: 'std_m11_c3', name: 'Chương 3: Giới hạn. Hàm số liên tục' },
                { id: 'std_m11_c4', name: 'Chương 4: Quan hệ song song trong không gian' },
                { id: 'std_m11_c5', name: 'Chương 5: Đạo hàm' }
            ];
        }
        return [
            { id: 'std_m10_c1', name: 'Chương 1: Mệnh đề và tập hợp' },
            { id: 'std_m10_c2', name: 'Chương 2: Bất phương trình bậc nhất hai ẩn' },
            { id: 'std_m10_c3', name: 'Chương 3: Hàm số bậc hai và đồ thị' },
            { id: 'std_m10_c4', name: 'Chương 4: Hệ thức lượng trong tam giác' },
            { id: 'std_m10_c5', name: 'Chương 5: Vectơ' }
        ];
    }

    if (s.includes('hóa') || s.includes('chem')) {
        if (grade === '12') {
            return [
                { id: 'std_h12_c1', name: 'Chương 1: Este - Lipit' },
                { id: 'std_h12_c2', name: 'Chương 2: Cacbohiđrat' },
                { id: 'std_h12_c3', name: 'Chương 3: Hợp chất chứa nitơ (Amin, Amino axit, Peptit, Protein)' },
                { id: 'std_h12_c4', name: 'Chương 4: Polime và vật liệu polime' },
                { id: 'std_h12_c5', name: 'Chương 5: Pin điện và điện phân' },
                { id: 'std_h12_c6', name: 'Chương 6: Đại cương kim loại' }
            ];
        }
        return [
            { id: 'std_h10_c1', name: 'Chương 1: Cấu tạo nguyên tử' },
            { id: 'std_h10_c2', name: 'Chương 2: Bảng tuần hoàn các nguyên tố hoá học' },
            { id: 'std_h10_c3', name: 'Chương 3: Liên kết hoá học' },
            { id: 'std_h10_c4', name: 'Chương 4: Phản ứng oxi hoá - khử' }
        ];
    }

    if (s.includes('sinh') || s.includes('bio')) {
        return [
            { id: 'std_bio_c1', name: 'Chương 1: Di truyền phân tử và di truyền nhiễm sắc thể' },
            { id: 'std_bio_c2', name: 'Chương 2: Tính quy luật của hiện tượng di truyền' },
            { id: 'std_bio_c3', name: 'Chương 3: Thuyết tiến hóa' },
            { id: 'std_bio_c4', name: 'Chương 4: Sinh thái học và môi trường' }
        ];
    }

    return [
        { id: 'std_gen_c1', name: 'Chương 1: Kiến thức trọng tâm phần 1' },
        { id: 'std_gen_c2', name: 'Chương 2: Kiến thức trọng tâm phần 2' },
        { id: 'std_gen_c3', name: 'Chương 3: Kiến thức trọng tâm phần 3' },
        { id: 'std_gen_c4', name: 'Chương 4: Kiến thức trọng tâm phần 4' }
    ];
};

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
    subject = 'Toán',
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

    // Lọc danh sách chương phù hợp với khối và môn - CHỈ GIỮ LẠI TÊN CHƯƠNG TRONG SGK
    const activeChapters = useMemo(() => {
        const filtered = chapters.filter(c => {
            const cName = c.name || (c as any).title || '';
            // Loại bỏ hoàn toàn các mục loại đề thi (KTTX, KTGK, KTCK, LTĐH...), chỉ giữ lại chương bài học SGK
            if (!isCurriculumChapter(cName)) return false;
            if (c.grade && c.grade !== 'all' && c.grade !== grade) return false;
            if (c.subject && subject && c.subject.trim().toLowerCase() !== subject.trim().toLowerCase()) return false;
            return true;
        }).sort((a, b) => (a.order || 0) - (b.order || 0));

        if (filtered.length > 0) return filtered;

        // Nếu DB chưa có chương nào cho khối & môn này, dùng danh mục chương chuẩn
        return getStandardChaptersForSubjectAndGrade(subject, grade);
    }, [chapters, grade, subject]);

    // Thống kê số lượng câu hỏi hiện có trong Ngân hàng cho từng ô:
    // bankCounts[chapterId / chapterName][type][level] = count
    const bankCounts = useMemo(() => {
        const counts: Record<string, Record<QuestionType, Record<QuestionLevel, number>>> = {};

        // Khởi tạo khung cho tất cả các chương
        activeChapters.forEach(ch => {
            counts[ch.id] = {
                mcq: { B: 0, H: 0, VD: 0, VDC: 0 },
                'group-tf': { B: 0, H: 0, VD: 0, VDC: 0 },
                short: { B: 0, H: 0, VD: 0, VDC: 0 }
            };
        });

        // Duyệt qua ngân hàng câu hỏi
        bankQuestions.forEach(q => {
            // Lọc theo khối nếu có
            if (q.quizGrade && q.quizGrade !== 'all' && q.quizGrade !== grade) return;
            // Lọc theo môn nếu có
            if (q.subject && subject && q.subject.trim().toLowerCase() !== subject.trim().toLowerCase()) return;

            const qType: QuestionType = (q.type as QuestionType) || 'mcq';
            const qLevel: QuestionLevel = (q.level as QuestionLevel) || 'B';

            // Tìm chương tương ứng
            const qCName = (q.chapterName || q.quizCategory || '').trim().toLowerCase();
            const matchedChapter = activeChapters.find(c => {
                if (q.chapterId && q.chapterId === c.id) return true;
                const cName = c.name.trim().toLowerCase();
                return qCName && (qCName === cName || qCName.includes(cName) || cName.includes(qCName));
            });

            if (matchedChapter && counts[matchedChapter.id]?.[qType]?.[qLevel] !== undefined) {
                counts[matchedChapter.id][qType][qLevel]++;
            }
        });

        return counts;
    }, [bankQuestions, activeChapters, grade, subject]);

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

    // Tính toán tổng số lượng câu hỏi trong ma trận và thống kê
    const matrixStats = useMemo(() => {
        let totalCount = 0;
        let p1Count = 0;
        let p2Count = 0;
        let p3Count = 0;

        let bCount = 0;
        let hCount = 0;
        let vdCount = 0;
        let vdcCount = 0;

        let availableFromBankCount = 0;
        let neededFromAiCount = 0;

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

                    // Đối với Tab 1 (Ngân hàng):
                    const inBank = bankCounts[ch.id]?.[t]?.[l] || 0;
                    const takeFromBank = Math.min(req, inBank);
                    const takeFromAi = Math.max(0, req - inBank);

                    availableFromBankCount += takeFromBank;
                    neededFromAiCount += takeFromAi;
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
            vdcCount,
            availableFromBankCount,
            neededFromAiCount
        };
    }, [matrixData, activeChapters, bankCounts]);

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
            { id: 'step_fetch', label: '1. Lấy dữ liệu từ Ngân hàng câu hỏi', description: 'Trích xuất các câu hỏi có sẵn theo chương & khối', status: activeTab === 'bank' ? 'active' : 'completed' },
            { id: 'step_check', label: '2. Đối chiếu ma trận & mức độ nhận thức', description: 'Kiểm tra các mức độ [Biết (B), Hiểu (H), Vận dụng (VD), VDC]', status: 'pending' },
            { id: 'step_ai', label: '3. AI Soạn câu hỏi mới', description: 'Gemini tự động soạn câu hỏi mới theo đúng mức độ còn thiếu', status: 'pending' },
            { id: 'step_normalize', label: '4. Chuẩn hóa công thức Toán & LaTeX', description: 'Làm sạch và kiểm tra cú pháp KaTeX/LaTeX', status: 'pending' },
            { id: 'step_done', label: '5. Hoàn tất ma trận đề thi', description: 'Tổng hợp bộ đề và nạp vào hệ thống', status: 'pending' }
        ];

        setTimelineProgress({
            isOpen: true,
            title: activeTab === 'bank' ? 'SOẠN ĐỀ TỪ NGÂN HÀNG & AI THEO MA TRẬN' : (activeTab === 'pdf' ? 'BÓC TÁCH & SOẠN ĐỀ THEO MA TRẬN TỪ PDF' : 'AI SOẠN ĐỀ THEO MA TRẬN TỪ PROMPT'),
            subtitle: `Môn: ${subject} • Khối: ${grade} • Tổng số ma trận: ${matrixStats.totalCount} câu`,
            percent: 10,
            currentAction: activeTab === 'bank' ? 'fetching_bank' : 'checking_matrix',
            detailsMessage: activeTab === 'bank' ? 'Đang lấy dữ liệu từ ngân hàng: Quét câu hỏi có sẵn theo từng chương...' : 'Đang phân tích cấu trúc ma trận kiến thức...',
            steps: initialSteps,
            logs: [`Bắt đầu khởi tạo ma trận đề thi: tổng cộng ${matrixStats.totalCount} câu hỏi.`]
        });

        try {
            const finalQuestions: Question[] = [];
            const aiMissingRequirements: MatrixRequirementItem[] = [];

            // Duyệt qua toàn bộ các ô trong ma trận
            activeChapters.forEach(ch => {
                const data = matrixData[ch.id];
                if (!data) return;

                const types: QuestionType[] = ['mcq', 'group-tf', 'short'];
                const levels: QuestionLevel[] = ['B', 'H', 'VD', 'VDC'];

                types.forEach(t => {
                    levels.forEach(l => {
                        const count = data[t]?.[l] || 0;
                        if (count <= 0) return;

                        if (activeTab === 'bank') {
                            // TAB 1: Ưu tiên bốc từ ngân hàng có sẵn
                            // Lọc các câu hỏi khớp trong ngân hàng
                            const matchingInBank = bankQuestions.filter(q => {
                                if (q.type !== t) return false;
                                if (q.quizGrade && q.quizGrade !== 'all' && q.quizGrade !== grade) return false;
                                if (q.subject && subject && q.subject.trim().toLowerCase() !== subject.trim().toLowerCase()) return false;
                                const qLevel = q.level || 'B';
                                if (qLevel !== l) return false;

                                const qCName = (q.chapterName || q.quizCategory || '').trim().toLowerCase();
                                const cName = ch.name.trim().toLowerCase();
                                return (q.chapterId && q.chapterId === ch.id) || 
                                       (qCName && (qCName === cName || qCName.includes(cName) || cName.includes(qCName)));
                            });

                            // Xáo trộn ngẫu nhiên để đề phong phú
                            const shuffled = [...matchingInBank].sort(() => 0.5 - Math.random());
                            const picked = shuffled.slice(0, count);

                            picked.forEach(q => {
                                finalQuestions.push({
                                    ...q,
                                    chapterId: ch.id,
                                    chapterName: ch.name,
                                    quizCategory: ch.name,
                                    subject: subject,
                                    quizGrade: grade
                                });
                            });

                            const missing = count - picked.length;
                            if (missing > 0) {
                                // "nếu không tìm thấy các câu có sẵn, thì AI tự soạn câu tương ứng theo mức độ"
                                aiMissingRequirements.push({
                                    chapterId: ch.id,
                                    chapterName: ch.name,
                                    type: t,
                                    level: l,
                                    count: missing
                                });
                            }
                        } else {
                            // TAB 2 (Prompt) hoặc TAB 3 (PDF): AI sinh toàn bộ theo ma trận
                            aiMissingRequirements.push({
                                chapterId: ch.id,
                                chapterName: ch.name,
                                type: t,
                                level: l,
                                count: count
                            });
                        }
                    });
                });
            });

            const totalNeedAi = aiMissingRequirements.reduce((sum, r) => sum + r.count, 0);

            // Cập nhật bước 1 và bước 2 trong Timeline
            setTimelineProgress(prev => ({
                ...prev,
                percent: 25,
                currentAction: 'checking_matrix',
                detailsMessage: activeTab === 'bank' 
                    ? `Đã lấy ${finalQuestions.length} câu có sẵn trong ngân hàng. Cần soạn mới ${totalNeedAi} câu.` 
                    : `Đã thiết lập ma trận yêu cầu ${totalNeedAi} câu hỏi cho AI.`,
                steps: prev.steps.map(s => {
                    if (s.id === 'step_fetch') return { ...s, status: 'completed' };
                    if (s.id === 'step_check') return { ...s, status: 'active' };
                    return s;
                }),
                logs: [
                    ...prev.logs, 
                    activeTab === 'bank' 
                        ? `Đã lấy dữ liệu từ ngân hàng: ${finalQuestions.length} câu hỏi có sẵn.`
                        : `Đã nạp ma trận yêu cầu ${totalNeedAi} câu.`
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
                    subject,
                    grade,
                    requirements: aiMissingRequirements,
                    topic: `${subject} ${grade}`,
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
                    <Database size={16} className={activeTab === 'bank' ? 'text-indigo-600' : 'text-slate-400'} />
                    <span>Thư viện có sẵn</span>
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
                {/* HEADER TỪNG TAB */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
                    <div className="space-y-2">
                        {activeTab === 'bank' && (
                            <>
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-indigo-700 text-[10px] font-black uppercase tracking-wider">
                                    <Database size={13} />
                                    <span>TẠO ĐỀ THEO MA TRẬN TỪ NGÂN HÀNG</span>
                                    <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-full text-[9px]">GDPT 2018</span>
                                </div>
                                <h2 className="text-2xl font-black uppercase text-slate-800 tracking-tight">
                                    Soạn đề từ thư viện câu hỏi có sẵn
                                </h2>
                                <p className="text-xs text-slate-500 max-w-2xl">
                                    Ma trận tích hợp đầy đủ 3 Loại câu hỏi (Phần I: Trắc nghiệm, Phần II: Đúng/Sai, Phần III: Trả lời ngắn) và 4 Mức độ nhận thức. Nếu câu hỏi trong kho chưa đủ, AI sẽ tự động soạn bổ sung đúng theo mức độ yêu cầu.
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

                {/* KHỐI LỚP & ĐÍCH ĐẾN & NÚT TRUY CẬP NHANH */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Chọn khối lớp */}
                    <div className="flex items-center gap-2">
                        {(['12', '11', '10'] as Grade[]).map(g => (
                            <button
                                key={g}
                                type="button"
                                onClick={() => setGrade(g)}
                                className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all shadow-sm active:scale-95 ${
                                    grade === g
                                        ? 'bg-purple-600 text-white shadow-purple-200'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                KHỐI {g}
                            </button>
                        ))}
                    </div>

                    {/* Lối tắt vào Editor và Bank */}
                    <div className="flex items-center gap-2">
                        {onOpenEditor && (
                            <button
                                type="button"
                                onClick={onOpenEditor}
                                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-black uppercase text-slate-700 hover:bg-slate-200 transition-all shadow-sm active:scale-95"
                            >
                                <LayoutTemplate size={13} className="text-blue-600" />
                                <span>VÀO EDITOR</span>
                            </button>
                        )}
                        {onOpenBank && (
                            <button
                                type="button"
                                onClick={onOpenBank}
                                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-black uppercase text-slate-700 hover:bg-slate-200 transition-all shadow-sm active:scale-95"
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
                                        : 'bg-slate-100 border-slate-200 text-slate-600'
                                }`}
                                title="Cấu hình Gemini API Key riêng"
                            >
                                <Key size={13} className={customApiKey ? "text-emerald-600" : "text-slate-500"}/>
                                <span>{customApiKey ? "Key riêng: Bật" : "Gemini Key"}</span>
                            </button>
                        )}
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

                {/* BỘ LỌC HIỂN THỊ LOẠI CÂU TRONG MA TRẬN & NÚT XÓA TRẮNG */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest mr-2">
                        HIỂN THỊ LOẠI CÂU TRONG MA TRẬN:
                    </span>
                    <button
                        type="button"
                        onClick={() => setTypeFilter('all')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
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
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
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
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
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
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                            typeFilter === 'short'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                        Phần III: Trả lời ngắn
                    </button>

                    <button
                        type="button"
                        onClick={handleClearMatrix}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg text-[10px] font-black uppercase hover:bg-red-50 shadow-sm active:scale-95 transition-all ml-auto"
                        title="Xóa trắng tất cả số lượng câu hỏi trong ma trận"
                    >
                        <RotateCcw size={12} />
                        <span>Xóa trắng</span>
                    </button>
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
                            {activeChapters.map(ch => {
                                const chData = matrixData[ch.id] || {
                                    mcq: { B: 0, H: 0, VD: 0, VDC: 0 },
                                    'group-tf': { B: 0, H: 0, VD: 0, VDC: 0 },
                                    short: { B: 0, H: 0, VD: 0, VDC: 0 }
                                };

                                // Tổng số câu trong kho cho chương này
                                const chBankTotal = (bankCounts[ch.id]?.mcq ? 
                                    Object.values(bankCounts[ch.id].mcq).reduce((a, b) => a + b, 0) +
                                    Object.values(bankCounts[ch.id]['group-tf']).reduce((a, b) => a + b, 0) +
                                    Object.values(bankCounts[ch.id].short).reduce((a, b) => a + b, 0) : 0);

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
                                                    <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full ml-2">
                                                        Kho: <b className="text-indigo-600">{chBankTotal} câu</b>
                                                    </span>
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
                                                                <div>
                                                                    <div className="font-bold text-slate-800 text-[11px]">PHẦN I Trắc nghiệm</div>
                                                                    <div className="text-[9px] text-slate-400">
                                                                        Kho: {Object.values(bankCounts[ch.id]?.mcq || {}).reduce((a, b) => a + b, 0)} câu
                                                                    </div>
                                                                </div>
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
                                                                <div className="text-[8px] text-slate-400 mt-1">
                                                                    Kho: {bankCounts[ch.id]?.mcq?.[lvl] || 0}
                                                                </div>
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
                                                                <div>
                                                                    <div className="font-bold text-slate-800 text-[11px]">PHẦN II Đúng / Sai</div>
                                                                    <div className="text-[9px] text-slate-400">
                                                                        Kho: {Object.values(bankCounts[ch.id]?.['group-tf'] || {}).reduce((a, b) => a + b, 0)} câu
                                                                    </div>
                                                                </div>
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
                                                                <div className="text-[8px] text-slate-400 mt-1">
                                                                    Kho: {bankCounts[ch.id]?.['group-tf']?.[lvl] || 0}
                                                                </div>
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
                                                                <div>
                                                                    <div className="font-bold text-slate-800 text-[11px]">PHẦN III Trả lời ngắn</div>
                                                                    <div className="text-[9px] text-slate-400">
                                                                        Kho: {Object.values(bankCounts[ch.id]?.short || {}).reduce((a, b) => a + b, 0)} câu
                                                                    </div>
                                                                </div>
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
                                                                <div className="text-[8px] text-slate-400 mt-1">
                                                                    Kho: {bankCounts[ch.id]?.short?.[lvl] || 0}
                                                                </div>
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
                        <div className="p-4 bg-white rounded-2xl border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 text-indigo-900 font-bold">
                                <Info size={16} className="text-indigo-600 shrink-0" />
                                <span>
                                    Phân bổ nguồn câu hỏi:
                                    <span className="text-emerald-700 font-black ml-1.5 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                                        Có sẵn trong kho: {matrixStats.availableFromBankCount} câu
                                    </span>
                                    {matrixStats.neededFromAiCount > 0 && (
                                        <span className="text-purple-700 font-black ml-1.5 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-200">
                                            AI tự soạn bù mức độ: {matrixStats.neededFromAiCount} câu
                                        </span>
                                    )}
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 italic">
                                *Nếu ô nào trong kho chưa đủ số lượng, AI Gemini sẽ tự động soạn câu tương ứng theo đúng mức độ nhận thức.
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
                            {activeTab === 'bank' ? <Database size={22} /> : (activeTab === 'prompt' ? <Sparkles size={22} /> : <FileUp size={22} />)}
                            <span>
                                {activeTab === 'bank' && `TẠO ĐỀ THEO MA TRẬN TỪ NGÂN HÀNG & AI (${matrixStats.totalCount} CÂU)`}
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
