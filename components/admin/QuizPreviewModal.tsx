import React, { useState, useEffect, useMemo } from 'react';
import { X, Download, FileType, AlignLeft, Rows, FileCode, Sparkles, Loader2, ChevronUp, ChevronDown, Printer, Shuffle, Layers, RefreshCw, CheckSquare, Square, FileStack } from 'lucide-react';
import { Quiz, Question } from '../../types';
import LatexText from '../LatexText';
import { normalizeFullText, repairVietnameseText } from '../../services/vietnameseFixer';
import { exportQuizToDocx } from '../../services/docxExporter';
import { getGroupPassageHeaderInfo, generateShuffledExamVariants, ExamVariant, autoRepairQuizQuestions } from '../../utils/groupShuffleUtils';

interface QuizPreviewModalProps {
    quiz: Quiz;
    onClose: () => void;
    isAdmin?: boolean;
}

const DEFAULT_EXAM_CODES_MAP: Record<number, string[]> = {
    1: ['101'],
    2: ['101', '102'],
    4: ['101', '102', '103', '104'],
    6: ['101', '102', '103', '104', '105', '106'],
    8: ['101', '102', '103', '104', '105', '106', '107', '108'],
};

export default function QuizPreviewModal({ quiz, onClose, isAdmin = true }: QuizPreviewModalProps) {
    const [layoutMode, setLayoutMode] = useState<'single' | 'auto'>('single');
    const [isExportingDocx, setIsExportingDocx] = useState(false);

    // Chế độ trộn nhiều mã đề thi giấy
    const [isMultiVariantMode, setIsMultiVariantMode] = useState<boolean>(false);
    const [variantCount, setVariantCount] = useState<number>(4);
    const [customCodesInput, setCustomCodesInput] = useState<string>('101, 102, 103, 104');
    const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(true);
    const [shuffleOptions, setShuffleOptions] = useState<boolean>(true);
    const [keepFirstOriginal, setKeepFirstOriginal] = useState<boolean>(false);
    const [answerKeyAtVeryEnd, setAnswerKeyAtVeryEnd] = useState<boolean>(true);
    const [variants, setVariants] = useState<ExamVariant[]>([]);
    const [activeVariantTab, setActiveVariantTab] = useState<string>('ALL'); // 'ALL' hoặc mã đề cụ thể

    const normalizedBaseQuiz = useMemo(() => ({
        ...quiz,
        questions: autoRepairQuizQuestions(Array.isArray(quiz.questions) ? quiz.questions : [])
    }), [quiz]);

    const parseExamCodes = (input: string, count: number): string[] => {
        const parts = input
            .split(/[,;\s]+/)
            .map(s => s.trim())
            .filter(Boolean);
        if (parts.length > 0) return parts;
        return DEFAULT_EXAM_CODES_MAP[count] || Array.from({ length: count }, (_, i) => String(101 + i));
    };

    const handleGenerateVariants = (
        customCount?: number,
        customCodesStr?: string,
        nextShuffleQ?: boolean,
        nextShuffleOpt?: boolean,
        nextKeepOrig?: boolean
    ) => {
        const countToUse = customCount ?? variantCount;
        const codesStrToUse = customCodesStr ?? customCodesInput;
        const examCodes = parseExamCodes(codesStrToUse, countToUse);
        const generated = generateShuffledExamVariants(normalizedBaseQuiz, {
            examCodes,
            shuffleQuestions: nextShuffleQ ?? shuffleQuestions,
            shuffleOptions: nextShuffleOpt ?? shuffleOptions,
            keepFirstVersionOriginal: nextKeepOrig ?? keepFirstOriginal
        });
        setVariants(generated);
        if (activeVariantTab !== 'ALL' && !generated.some(v => v.examCode === activeVariantTab)) {
            setActiveVariantTab('ALL');
        }
    };

    // Tự động khởi tạo 4 mã đề khi bật chế độ trộn đề lần đầu
    useEffect(() => {
        if (isMultiVariantMode && variants.length === 0) {
            handleGenerateVariants(4, '101, 102, 103, 104');
        }
    }, [isMultiVariantMode]);

    const handleChangeVariantCount = (count: number) => {
        setVariantCount(count);
        const defaultCodes = (DEFAULT_EXAM_CODES_MAP[count] || Array.from({ length: count }, (_, i) => String(101 + i))).join(', ');
        setCustomCodesInput(defaultCodes);
        handleGenerateVariants(count, defaultCodes);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target) {
                const tagName = target.tagName?.toLowerCase();
                if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable) {
                    return;
                }
            }

            const scrollEl = document.getElementById('quiz-preview-scroll');
            if (!scrollEl) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                scrollEl.scrollBy({ top: 80, behavior: 'smooth' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                scrollEl.scrollBy({ top: -80, behavior: 'smooth' });
            } else if (e.key === 'PageDown') {
                e.preventDefault();
                scrollEl.scrollBy({ top: 400, behavior: 'smooth' });
            } else if (e.key === 'PageUp') {
                e.preventDefault();
                scrollEl.scrollBy({ top: -400, behavior: 'smooth' });
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Render các phương án dạng văn bản sạch - HOÀN TOÀN KHÔNG DÙNG TABLE
    const renderOptionsNoTable = (q: Question) => {
        if (!q.options || q.options.length === 0) return null;

        const options = q.options;

        if (layoutMode === 'single') {
            // Chế độ 1: Mỗi phương án 1 dòng - Không bao giờ lệch dòng, không cần canh tab
            return (
                <div className="options-container" style={{ marginTop: '2pt', marginBottom: '4pt' }}>
                    {options.map((opt, idx) => (
                        <p 
                            key={idx} 
                            className="option-item" 
                            style={{ 
                                margin: '2pt 0 2pt 18pt', 
                                lineHeight: '1.3', 
                                textAlign: 'justify' 
                            }}
                        >
                            <b style={{ marginRight: '6px' }}>{String.fromCharCode(65 + idx)}.</b>
                            <LatexText text={opt} />
                        </p>
                    ))}
                </div>
            );
        }

        // Chế độ 2: Tự động phân dòng gọn gàng không dùng bảng
        const maxLen = Math.max(...options.map(o => (o || '').length));
        const totalLen = options.reduce((sum, o) => sum + (o || '').length, 0);

        if (options.length === 4 && maxLen <= 20 && totalLen <= 75) {
            // 4 phương án trên 1 dòng dàn đều dạng cột (tương đương canh Tab Word)
            return (
                <div className="options-container" style={{ marginTop: '2pt', marginBottom: '4pt' }}>
                    <p 
                        className="option-item" 
                        style={{ 
                            margin: '2pt 0 2pt 18pt', 
                            lineHeight: '1.35', 
                            textAlign: 'justify' 
                        }}
                    >
                        {options.map((opt, idx) => (
                            <span 
                                key={idx} 
                                style={{ 
                                    width: '24.5%', 
                                    display: 'inline-block', 
                                    verticalAlign: 'top' 
                                }}
                            >
                                <b style={{ marginRight: '4px' }}>{String.fromCharCode(65 + idx)}.</b>
                                <LatexText text={opt} />
                            </span>
                        ))}
                    </p>
                </div>
            );
        }

        if (options.length === 4 && maxLen <= 45) {
            // 2 dòng chia đều 2 cột (A - B và C - D) như canh Tab Word
            return (
                <div className="options-container" style={{ marginTop: '2pt', marginBottom: '4pt' }}>
                    <p 
                        className="option-item" 
                        style={{ 
                            margin: '2pt 0 1.5pt 18pt', 
                            lineHeight: '1.35', 
                            textAlign: 'justify' 
                        }}
                    >
                        <span style={{ width: '49%', display: 'inline-block', verticalAlign: 'top' }}>
                            <b style={{ marginRight: '4px' }}>A.</b>
                            <LatexText text={options[0]} />
                        </span>
                        <span style={{ width: '49%', display: 'inline-block', verticalAlign: 'top' }}>
                            <b style={{ marginRight: '4px' }}>B.</b>
                            <LatexText text={options[1]} />
                        </span>
                    </p>
                    <p 
                        className="option-item" 
                        style={{ 
                            margin: '1.5pt 0 2pt 18pt', 
                            lineHeight: '1.35', 
                            textAlign: 'justify' 
                        }}
                    >
                        <span style={{ width: '49%', display: 'inline-block', verticalAlign: 'top' }}>
                            <b style={{ marginRight: '4px' }}>C.</b>
                            <LatexText text={options[2]} />
                        </span>
                        <span style={{ width: '49%', display: 'inline-block', verticalAlign: 'top' }}>
                            <b style={{ marginRight: '4px' }}>D.</b>
                            <LatexText text={options[3]} />
                        </span>
                    </p>
                </div>
            );
        }

        // Mặc định: Mỗi phương án 1 dòng
        return (
            <div className="options-container" style={{ marginTop: '2pt', marginBottom: '4pt' }}>
                {options.map((opt, idx) => (
                    <p 
                        key={idx} 
                        className="option-item" 
                        style={{ 
                            margin: '2pt 0 2pt 18pt', 
                            lineHeight: '1.35', 
                            textAlign: 'justify' 
                        }}
                    >
                        <b style={{ marginRight: '6px' }}>{String.fromCharCode(65 + idx)}.</b>
                        <LatexText text={opt} />
                    </p>
                ))}
            </div>
        );
    };

    // Tạo nội dung bảng đáp án tổng hợp cho 1 đề hoặc 1 mã đề
    const renderAnswerKeyForQuiz = (targetQuiz: Quiz, examCode?: string, isCombinedMode: boolean = false) => {
        if (!isAdmin) return null;
        
        const mcqQs = targetQuiz.questions.filter(q => q.type === 'mcq');
        const groupTfQs = targetQuiz.questions.filter(q => q.type === 'group-tf');
        const shortQs = targetQuiz.questions.filter(q => q.type === 'short');

        const sectionStyle = { 
            fontWeight: 'bold', 
            textTransform: 'uppercase' as const, 
            marginTop: '12pt', 
            marginBottom: '6pt', 
            fontSize: '11pt' 
        };
        
        return (
            <div 
                id={examCode ? `answer-key-section-${examCode}` : "answer-key-section"} 
                style={{ 
                    marginTop: isCombinedMode ? '22pt' : '30pt', 
                    borderTop: isCombinedMode ? '1pt dashed #94a3b8' : '1.5pt solid #000', 
                    paddingTop: '15pt', 
                    pageBreakBefore: isCombinedMode ? 'auto' : 'always' 
                }}
            >
                <h3 style={{ 
                    textAlign: isCombinedMode ? 'left' : 'center', 
                    fontWeight: 'bold', 
                    fontSize: isCombinedMode ? '12.5pt' : '13pt', 
                    color: examCode ? '#1e3a8a' : '#000',
                    textTransform: 'uppercase', 
                    marginBottom: '12pt' 
                }}>
                    {examCode ? `BẢNG ĐÁP ÁN — MÃ ĐỀ ${examCode}` : 'BẢNG ĐÁP ÁN'}
                </h3>
                
                {mcqQs.length > 0 && (
                    <div style={{ marginBottom: '18pt' }}>
                        <p style={sectionStyle}>PHẦN I. CÂU HỎI TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN</p>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '6pt' }}>
                            <tbody>
                                {Array.from({ length: Math.ceil(mcqQs.length / 10) }).map((_, rowIndex) => {
                                    const chunk = mcqQs.slice(rowIndex * 10, (rowIndex + 1) * 10);
                                    return (
                                        <React.Fragment key={rowIndex}>
                                            <tr>
                                                {chunk.map((_, colIndex) => (
                                                    <td key={colIndex} style={{ border: '1pt solid black', padding: '4pt 2pt', textAlign: 'center', fontWeight: 'bold', backgroundColor: '#f8fafc', width: '10%', fontSize: '10pt' }}>
                                                        Câu {rowIndex * 10 + colIndex + 1}
                                                    </td>
                                                ))}
                                                {Array.from({ length: 10 - chunk.length }).map((_, i) => (
                                                    <td key={`empty-h-${i}`} style={{ border: '1pt solid black', width: '10%' }}></td>
                                                ))}
                                            </tr>
                                            <tr>
                                                {chunk.map((q, colIndex) => {
                                                    const correctIdx = q.options?.indexOf(q.correctAnswer || '') ?? -1;
                                                    const label = correctIdx !== -1 ? String.fromCharCode(65 + correctIdx) : (q.correctAnswer || '?');
                                                    return (
                                                        <td key={colIndex} style={{ border: '1pt solid black', padding: '5pt 2pt', textAlign: 'center', fontWeight: 'bold', color: '#166534', width: '10%', fontSize: '10pt' }}>
                                                            {label}
                                                        </td>
                                                    );
                                                })}
                                                {Array.from({ length: 10 - chunk.length }).map((_, i) => (
                                                    <td key={`empty-b-${i}`} style={{ border: '1pt solid black', width: '10%' }}></td>
                                                ))}
                                            </tr>
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {groupTfQs.length > 0 && (
                    <div style={{ marginBottom: '18pt' }}>
                        <p style={sectionStyle}>PHẦN II. CÂU HỎI TRẮC NGHIỆM ĐÚNG SAI</p>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '6pt' }}>
                            <thead>
                                <tr>
                                    <th style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', backgroundColor: '#f8fafc', width: '16%', fontSize: '10pt' }}>Câu</th>
                                    <th style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', backgroundColor: '#f8fafc', width: '21%', fontSize: '10pt' }}>a</th>
                                    <th style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', backgroundColor: '#f8fafc', width: '21%', fontSize: '10pt' }}>b</th>
                                    <th style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', backgroundColor: '#f8fafc', width: '21%', fontSize: '10pt' }}>c</th>
                                    <th style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', backgroundColor: '#f8fafc', width: '21%', fontSize: '10pt' }}>d</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groupTfQs.map((q, i) => {
                                    const subAns = q.subQuestions || [];
                                    return (
                                        <tr key={q.id}>
                                            <td style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', fontWeight: 'bold', fontSize: '10pt' }}>Câu {i + 1}</td>
                                            {[0, 1, 2, 3].map(subIndex => {
                                                const sq = subAns[subIndex];
                                                const val = sq ? (String(sq.correctAnswer).toLowerCase() === 'true' || String(sq.correctAnswer).toLowerCase() === 'đúng' ? 'Đ' : 'S') : '-';
                                                return (
                                                    <td key={subIndex} style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', fontWeight: 'bold', fontSize: '10pt' }}>
                                                        {val}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {shortQs.length > 0 && (
                    <div style={{ marginBottom: '18pt' }}>
                        <p style={sectionStyle}>PHẦN III. CÂU HỎI TRẮC NGHIỆM TRẢ LỜI NGẮN</p>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '6pt' }}>
                            <thead>
                                <tr>
                                    <th style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', backgroundColor: '#f8fafc', width: '25%', fontSize: '10pt' }}>Câu</th>
                                    <th style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', backgroundColor: '#f8fafc', width: '75%', fontSize: '10pt' }}>Đáp án</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shortQs.map((q, i) => (
                                    <tr key={q.id}>
                                        <td style={{ border: '1pt solid black', padding: '4pt', textAlign: 'center', fontWeight: 'bold', fontSize: '10pt' }}>Câu {i + 1}</td>
                                        <td style={{ border: '1pt solid black', padding: '4pt 8pt', textAlign: 'center', fontWeight: 'bold', color: '#1d4ed8', fontSize: '10pt' }}>{q.correctAnswer || 'N/A'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    const handleExportWord = () => {
        if (!isAdmin) return;
        const originalContent = document.getElementById('quiz-export-content');
        if (!originalContent) return alert("Không tìm thấy nội dung!");

        const clone = originalContent.cloneNode(true) as HTMLElement;
        const latexItems = clone.querySelectorAll('[data-latex]');
        latexItems.forEach(item => {
            const rawLatex = item.getAttribute('data-latex');
            if (rawLatex) {
                const textNode = document.createTextNode(`$${rawLatex}$`);
                item.parentNode?.replaceChild(textNode, item);
            }
        });

        // Chuẩn hóa toàn bộ nội dung HTML xuất ra để đảm bảo không bị lỗi font hay vỡ chữ
        const cleanedHtml = repairVietnameseText(clone.innerHTML);
        const content = cleanedHtml;
        const header = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' 
                  xmlns:w='urn:schemas-microsoft-com:office:word' 
                  xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
                <meta charset='utf-8'>
                <title>${normalizeFullText(quiz.title)}</title>
                <!--[if gte mso 9]>
                <xml>
                <w:WordDocument>
                <w:View>Print</w:View>
                <w:Zoom>100</w:Zoom>
                <w:DoNotOptimizeForBrowser/>
                </w:WordDocument>
                </xml>
                <![endif]-->
                <style>
                    @page { 
                        size: 21cm 29.7cm; 
                        margin: 1.5cm 1.8cm 1.5cm 1.8cm; 
                        mso-header-margin: 36pt; 
                        mso-footer-margin: 36pt; 
                        mso-paper-source: 0; 
                    }
                    body { 
                        font-family: 'Times New Roman', Times, serif; 
                        font-size: 12pt; 
                        line-height: 1.25; 
                        color: #000000; 
                        text-align: justify; 
                        margin: 0; 
                        padding: 0; 
                    }
                    p, div { 
                        margin-top: 2pt; 
                        margin-bottom: 2pt; 
                        line-height: 1.25; 
                    }
                    .section-title { 
                        font-family: 'Times New Roman', Times, serif;
                        font-weight: bold; 
                        margin-top: 14pt; 
                        margin-bottom: 6pt; 
                        font-size: 11pt; 
                        text-transform: uppercase; 
                        border-bottom: 1.5pt solid black; 
                        padding-bottom: 2pt; 
                        text-align: left; 
                    }
                    .question-block { 
                        margin-top: 6pt; 
                        margin-bottom: 6pt; 
                        page-break-inside: avoid; 
                    }
                    .question-title { 
                        margin-top: 4pt; 
                        margin-bottom: 2pt; 
                        text-align: justify; 
                        line-height: 1.25; 
                    }
                    .q-label { 
                        font-weight: bold; 
                        font-style: italic; 
                        text-decoration: underline; 
                        margin-right: 4pt; 
                    }
                    .option-item { 
                        margin-top: 1.5pt; 
                        margin-bottom: 1.5pt; 
                        margin-left: 18pt; 
                        text-align: justify; 
                        line-height: 1.25; 
                    }
                    .subq-item { 
                        margin-top: 1.5pt; 
                        margin-bottom: 1.5pt; 
                        margin-left: 18pt; 
                        text-align: justify; 
                        line-height: 1.25; 
                    }
                    .footer { 
                        text-align: center; 
                        margin-top: 30pt; 
                        border-top: 1pt solid black; 
                        padding-top: 10pt; 
                        font-weight: bold; 
                    }
                    table { 
                        border-collapse: collapse; 
                        width: 100%; 
                    }
                    td, th { 
                        vertical-align: top; 
                    }
                </style>
            </head>
            <body>
        `;
        const footer = "</body></html>";
        const sourceHTML = header + content + footer;
        
        const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const safeTitle = quiz.title.replace(/[/\\?%*:|"<>]/g, '_');
        const suffix = isMultiVariantMode && variants.length > 0
            ? (activeVariantTab === 'ALL' ? `_${variants.length}_Ma_De_${variants.map(v => v.examCode).join('-')}` : `_Ma_De_${activeVariantTab}`)
            : '';
        link.download = `${safeTitle}${suffix}.doc`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleExportDocx = async () => {
        if (!isAdmin) return;
        try {
            setIsExportingDocx(true);
            if (isMultiVariantMode && variants.length > 0) {
                const targetVariants = activeVariantTab === 'ALL'
                    ? variants
                    : variants.filter(v => v.examCode === activeVariantTab);
                await exportQuizToDocx(normalizedBaseQuiz, {
                    isAdmin,
                    layoutMode,
                    variants: targetVariants,
                    answerKeyAtVeryEnd
                });
            } else {
                await exportQuizToDocx(normalizedBaseQuiz, { isAdmin, layoutMode });
            }
        } catch (error) {
            console.error("Lỗi xuất Word DOCX:", error);
            alert("Có lỗi khi tạo file Word (.docx). Vui lòng thử lại hoặc sử dụng nút Xuất Word (.doc).");
        } finally {
            setIsExportingDocx(false);
        }
    };

    const handleExportJSON = () => {
        try {
            const jsonStr = JSON.stringify(quiz, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${quiz.title.replace(/[/\\?%*:|"<>]/g, '_')}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Lỗi khi xuất file JSON:", e);
            alert("Có lỗi khi xuất file JSON.");
        }
    };

    const renderExamPaperSheet = (
        targetQuiz: Quiz,
        examCode?: string,
        includeAnswerKeyHere: boolean = true,
        isFirstSheet: boolean = true
    ) => {
        return (
            <div
                key={examCode || 'original'}
                style={{
                    pageBreakBefore: isFirstSheet ? 'auto' : 'always',
                    marginTop: isFirstSheet ? '0' : '32pt',
                    paddingTop: isFirstSheet ? '0' : '24pt',
                    borderTop: isFirstSheet ? 'none' : '2pt dashed #cbd5e1'
                }}
            >
                {/* Header đề thi */}
                <div className="mb-6" style={{ textAlign: 'left' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
                        <tbody>
                            <tr>
                                <td style={{ width: '50%', textAlign: 'center', verticalAlign: 'top', padding: '2pt 4pt' }}>
                                    <p style={{ fontWeight: 'bold', margin: '1pt 0', fontSize: '11pt' }}>SỞ GDĐT TP. HỒ CHÍ MINH</p>
                                    <p style={{ fontWeight: 'bold', margin: '1pt 0', fontSize: '11pt' }}>TRƯỜNG THPT NGUYỄN HỮU CẦU</p>
                                </td>
                                <td style={{ width: '50%', textAlign: 'center', verticalAlign: 'top', padding: '2pt 4pt' }}>
                                    <p style={{ fontWeight: 'bold', fontSize: '11.5pt', margin: '1pt 0' }}>ĐỀ THI CHÍNH THỨC</p>
                                    <p style={{ fontWeight: 'bold', margin: '1pt 0', fontSize: '11pt' }}>Môn: {targetQuiz.subject || targetQuiz.category || 'Vật lý'} - Khối {targetQuiz.grade}</p>
                                    {examCode && (
                                        <p style={{ fontWeight: 'bold', margin: '3pt 0 1pt 0', fontSize: '12pt', color: '#1e3a8a' }}>
                                            MÃ ĐỀ: {examCode}
                                        </p>
                                    )}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div style={{ border: '1pt solid black', padding: '6pt 10pt', marginTop: '8pt', textAlign: 'left' }}>
                        <p style={{ fontWeight: 'bold', margin: 0, fontSize: '10.5pt' }}>
                            {examCode
                                ? `Họ và tên: ................................................................. SBD: ........................... Mã đề: ${examCode}`
                                : 'Họ và tên: .......................................................................... SBD: .....................................'}
                        </p>
                    </div>
                    <h2 style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '14pt', marginTop: '16pt', marginBottom: '8pt', textTransform: 'uppercase' }}>
                        <LatexText text={targetQuiz.title} />
                        {examCode ? ` — MÃ ĐỀ ${examCode}` : ''}
                    </h2>
                </div>

                {/* Các phần thi */}
                {['mcq', 'group-tf', 'short'].map((type) => {
                    const typeQs = targetQuiz.questions.filter(q => q.type === type);
                    if (typeQs.length === 0) return null;

                    return (
                        <div key={type} className="section-block" style={{ marginBottom: '24pt', textAlign: 'justify' }}>
                            <div
                                className="section-title"
                                style={{
                                    fontWeight: 'bold',
                                    textTransform: 'uppercase',
                                    borderBottom: '1.5pt solid black',
                                    marginBottom: '12pt',
                                    paddingBottom: '3pt',
                                    textAlign: 'left',
                                    fontSize: '11pt'
                                }}
                            >
                                {type === 'mcq' ? 'PHẦN I. CÂU HỎI TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN' :
                                 type === 'group-tf' ? 'PHẦN II. CÂU HỎI TRẮC NGHIỆM ĐÚNG SAI' :
                                 'PHẦN III. CÂU HỎI TRẮC NGHIỆM TRẢ LỜI NGẮN'}
                            </div>

                            <div className="space-y-6">
                                {typeQs.map((q, idx) => {
                                    const groupInfo = getGroupPassageHeaderInfo(typeQs, idx);
                                    return (
                                        <React.Fragment key={`${examCode || 'orig'}-${q.id}-${idx}`}>
                                            {groupInfo && groupInfo.isFirst && (
                                                <div
                                                    className="group-passage-box shadow-sm"
                                                    style={{
                                                        backgroundColor: '#fffbeb',
                                                        border: '1.5pt solid #f59e0b',
                                                        padding: '8pt 12pt',
                                                        borderRadius: '8pt',
                                                        marginBottom: '10pt',
                                                        marginTop: '8pt'
                                                    }}
                                                >
                                                    <p style={{ fontWeight: 'bold', color: '#92400e', margin: '0 0 4pt 0', fontSize: '10.5pt', textTransform: 'uppercase' }}>
                                                        {groupInfo.headerTitle}
                                                    </p>
                                                    <div style={{ fontStyle: 'normal', color: '#1e293b', fontSize: '10.5pt', lineHeight: '1.3' }}>
                                                        <LatexText text={groupInfo.passageText} />
                                                    </div>
                                                </div>
                                            )}

                                            <div
                                                className="question-block"
                                                style={{
                                                    marginBottom: '14pt',
                                                    textAlign: 'justify',
                                                    pageBreakInside: 'avoid'
                                                }}
                                            >
                                                <p
                                                    className="question-title"
                                                    style={{
                                                        margin: '3pt 0 2pt 0',
                                                        lineHeight: '1.3',
                                                        textAlign: 'justify'
                                                    }}
                                                >
                                                    <span
                                                        className="q-label"
                                                        style={{
                                                            fontWeight: 'bold',
                                                            fontStyle: 'italic',
                                                            textDecoration: 'underline',
                                                            textUnderlineOffset: '3px',
                                                            marginRight: '6px'
                                                        }}
                                                    >
                                                        Câu {idx + 1}:
                                                    </span>
                                                    <LatexText text={q.text}/>
                                                </p>

                                                {q.imageUrl && (
                                                    <div
                                                        className="q-image-container"
                                                        style={{
                                                            textAlign: 'center',
                                                            margin: '10pt auto',
                                                            display: 'block'
                                                        }}
                                                    >
                                                        <img
                                                            src={q.imageUrl}
                                                            alt={`Hình ${idx + 1}`}
                                                            style={{
                                                                maxWidth: '85%',
                                                                maxHeight: '350px',
                                                                display: 'block',
                                                                margin: '0 auto'
                                                            }}
                                                        />
                                                    </div>
                                                )}

                                                {q.type === 'mcq' && renderOptionsNoTable(q)}

                                                {q.type === 'group-tf' && q.subQuestions && (
                                                    <div className="subq-container" style={{ marginTop: '2pt', marginBottom: '4pt' }}>
                                                        {q.subQuestions.map((sq, si) => (
                                                            <p
                                                                key={si}
                                                                className="subq-item"
                                                                style={{
                                                                    margin: '2pt 0 2pt 18pt',
                                                                    lineHeight: '1.3',
                                                                    textAlign: 'justify'
                                                                }}
                                                            >
                                                                <b style={{ marginRight: '6px' }}>{String.fromCharCode(97 + si)})</b>
                                                                <LatexText text={sq.text}/>
                                                            </p>
                                                        ))}
                                                    </div>
                                                )}

                                                {q.type === 'short' && (
                                                    <p
                                                        style={{
                                                            margin: '3pt 0 4pt 18pt',
                                                            fontStyle: 'italic',
                                                            color: '#444',
                                                            lineHeight: '1.3'
                                                        }}
                                                    >
                                                        Đáp số: ........................................................................
                                                    </p>
                                                )}
                                            </div>
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                <div className="footer" style={{ textAlign: 'center', marginTop: '30pt', borderTop: '1pt solid #ccc', paddingTop: '12pt', fontWeight: 'bold' }}>
                    <p style={{ fontSize: '11pt', margin: '5pt 0' }}>--- HẾT{examCode ? ` (MÃ ĐỀ ${examCode})` : ''} ---</p>
                </div>

                {/* Bảng đáp án riêng ngay sau đề nếu chọn chế độ đặt sau từng đề */}
                {includeAnswerKeyHere && renderAnswerKeyForQuiz(targetQuiz, examCode, false)}
            </div>
        );
    };

    const displayedVariants = useMemo(() => {
        if (!isMultiVariantMode || variants.length === 0) return [];
        if (activeVariantTab === 'ALL') return variants;
        return variants.filter(v => v.examCode === activeVariantTab);
    }, [isMultiVariantMode, variants, activeVariantTab]);

    return (
        <div className="fixed inset-0 bg-slate-900/95 z-[2000] flex items-center justify-center p-0 md:p-4 backdrop-blur-xl animate-fade-in">
            <style>{`
                @media print {
                    body * {
                        visibility: hidden !important;
                    }
                    #quiz-export-content, #quiz-export-content * {
                        visibility: visible !important;
                    }
                    #quiz-export-content {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 15mm !important;
                        background: white !important;
                        color: black !important;
                        box-shadow: none !important;
                        border: none !important;
                    }
                }
            `}</style>
            <div className="bg-white rounded-[0] md:rounded-[3.5rem] w-full max-w-5xl h-full md:h-[95vh] flex flex-col overflow-hidden shadow-2xl relative">
                
                <div className="p-6 bg-slate-900 text-white flex flex-wrap justify-between items-center gap-4 shrink-0 border-b border-slate-800">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-600 rounded-2xl shadow-lg">
                            <FileType size={24}/>
                        </div>
                        <div>
                            <h3 className="text-base md:text-lg font-black uppercase tracking-tight leading-tight line-clamp-1">{quiz.title}</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                                {isAdmin ? 'CHẾ ĐỘ GIÁO VIÊN: ĐÃ HIỆN ĐÁP ÁN' : 'CHẾ ĐỘ HỌC SINH: XEM ĐỀ THI'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Bộ chuyển đổi chế độ dàn hàng phương án */}
                        <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700">
                            <button
                                onClick={() => setLayoutMode('single')}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1.5 ${
                                    layoutMode === 'single'
                                        ? 'bg-blue-600 text-white shadow-md'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                                title="Mỗi đáp án 1 dòng thẳng hàng (Không dùng Table, chuẩn in ấn Word)"
                            >
                                <Rows size={12}/> Mỗi ý 1 dòng
                            </button>
                            <button
                                onClick={() => setLayoutMode('auto')}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1.5 ${
                                    layoutMode === 'auto'
                                        ? 'bg-blue-600 text-white shadow-md'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                                title="Tự động dàn hàng ngang/dọc gọn trang (Không dùng Table)"
                            >
                                <AlignLeft size={12}/> Tự động gọn trang
                            </button>
                        </div>

                        {isAdmin && (
                            <>
                                <button
                                    onClick={() => setIsMultiVariantMode(prev => !prev)}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase transition-all shadow-xl active:scale-95 border ${
                                        isMultiVariantMode
                                            ? 'bg-violet-600 border-violet-400 text-white ring-2 ring-violet-400/50'
                                            : 'bg-slate-800 border-slate-700 text-violet-300 hover:bg-violet-600 hover:text-white'
                                    }`}
                                    title="Trộn & xuất cùng lúc nhiều mã đề khác nhau (VD: 101, 102, 103, 104) cho học sinh thi giấy"
                                >
                                    <Shuffle size={15}/> {isMultiVariantMode ? `Đang bật Trộn ${variants.length} Mã đề` : 'Trộn nhiều Mã đề (Thi giấy)'}
                                </button>
                                <button 
                                    onClick={handleExportJSON}
                                    className="flex items-center gap-2 px-3.5 py-2.5 bg-amber-600 text-white rounded-xl text-[11px] font-black uppercase hover:bg-amber-700 transition-all shadow-xl active:scale-95"
                                    title="Tải cấu trúc đề thi dưới định dạng JSON (.json)"
                                >
                                    <FileCode size={15}/> JSON
                                </button>
                                <button 
                                    onClick={handleExportWord}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-[11px] font-black uppercase hover:bg-emerald-700 transition-all shadow-xl active:scale-95"
                                    title="Xuất file Microsoft Word tương thích cao (.doc)"
                                >
                                    <Download size={15}/> {isMultiVariantMode && activeVariantTab === 'ALL' ? `Xuất ${variants.length} Mã đề (.doc)` : 'Xuất Word (.doc)'}
                                </button>
                                <button 
                                    onClick={handleExportDocx}
                                    disabled={isExportingDocx}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-black uppercase transition-all shadow-xl active:scale-95 disabled:opacity-50"
                                    title="Xuất file Microsoft Word (.docx) chứa công thức hiển thị trực tiếp bằng Equation trong Word"
                                >
                                    {isExportingDocx ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                                    {isMultiVariantMode && activeVariantTab === 'ALL' ? `Xuất ${variants.length} Mã đề (.docx)` : 'Xuất Word (.docx)'}
                                </button>
                                <button 
                                    onClick={() => window.print()}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-[11px] font-black uppercase transition-all shadow-xl active:scale-95"
                                    title="In đề thi trực tiếp qua máy in hoặc lưu PDF"
                                >
                                    <Printer size={15}/> {isMultiVariantMode && activeVariantTab === 'ALL' ? `In ${variants.length} Mã đề (PDF)` : 'In đề (PDF)'}
                                </button>
                            </>
                        )}
                        <button 
                            onClick={onClose} 
                            className="p-2.5 bg-slate-800 rounded-xl hover:bg-red-600 transition-colors"
                        >
                            <X size={20}/>
                        </button>
                    </div>
                </div>

                {/* Thanh cấu hình trộn nhiều mã đề thi giấy */}
                {isAdmin && isMultiVariantMode && (
                    <div className="bg-slate-800/95 border-b border-slate-700 px-6 py-3.5 text-white shrink-0 space-y-3 animate-fade-in">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            {/* Chọn nhanh số lượng mã đề */}
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-black uppercase text-violet-300 flex items-center gap-1.5">
                                    <Layers size={14}/> Số mã đề:
                                </span>
                                {[2, 4, 6, 8].map(num => (
                                    <button
                                        key={num}
                                        type="button"
                                        onClick={() => handleChangeVariantCount(num)}
                                        className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${
                                            variantCount === num
                                                ? 'bg-violet-600 text-white shadow-md'
                                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                        }`}
                                    >
                                        {num} đề
                                    </button>
                                ))}

                                <div className="flex items-center gap-1.5 ml-2">
                                    <span className="text-[11px] font-bold text-slate-300">Mã đề:</span>
                                    <input
                                        type="text"
                                        value={customCodesInput}
                                        onChange={(e) => setCustomCodesInput(e.target.value)}
                                        onBlur={() => handleGenerateVariants(variantCount, customCodesInput)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleGenerateVariants(variantCount, customCodesInput);
                                            }
                                        }}
                                        placeholder="VD: 101, 102, 103, 104"
                                        className="bg-slate-900 border border-slate-600 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-300 w-44 focus:outline-none focus:border-violet-400"
                                    />
                                </div>
                            </div>

                            {/* Các tùy chọn đảo câu hỏi & đáp án */}
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !shuffleQuestions;
                                        setShuffleQuestions(next);
                                        handleGenerateVariants(variantCount, customCodesInput, next, shuffleOptions, keepFirstOriginal);
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white"
                                    title="Đảo vị trí câu hỏi trong từng phần (Các câu có chung lời dẫn luôn đi kèm nhau thành cụm)"
                                >
                                    {shuffleQuestions ? <CheckSquare size={15} className="text-emerald-400" /> : <Square size={15} className="text-slate-400" />}
                                    Đảo thứ tự câu (giữ cụm lời dẫn)
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !shuffleOptions;
                                        setShuffleOptions(next);
                                        handleGenerateVariants(variantCount, customCodesInput, shuffleQuestions, next, keepFirstOriginal);
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white"
                                    title="Đảo thứ tự các phương án A, B, C, D ở Phần I và tự động cập nhật bảng đáp án theo từng mã đề"
                                >
                                    {shuffleOptions ? <CheckSquare size={15} className="text-emerald-400" /> : <Square size={15} className="text-slate-400" />}
                                    Đảo phương án A, B, C, D
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !keepFirstOriginal;
                                        setKeepFirstOriginal(next);
                                        handleGenerateVariants(variantCount, customCodesInput, shuffleQuestions, shuffleOptions, next);
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white"
                                    title="Giữ nguyên thứ tự gốc cho mã đề đầu tiên"
                                >
                                    {keepFirstOriginal ? <CheckSquare size={15} className="text-amber-400" /> : <Square size={15} className="text-slate-400" />}
                                    Mã đầu giữ nguyên gốc
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setAnswerKeyAtVeryEnd(prev => !prev)}
                                    className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white"
                                    title="Gom bảng đáp án của tất cả mã đề về trang cuối cùng để dễ cắt rời khi in cho học sinh"
                                >
                                    {answerKeyAtVeryEnd ? <CheckSquare size={15} className="text-blue-400" /> : <Square size={15} className="text-slate-400" />}
                                    Gom đáp án ở cuối file
                                </button>

                                <button
                                    type="button"
                                    onClick={() => handleGenerateVariants()}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-black uppercase shadow transition-all active:scale-95"
                                    title="Trộn lại ngẫu nhiên bộ mã đề mới"
                                >
                                    <RefreshCw size={13}/> Trộn lại ngẫu nhiên
                                </button>
                            </div>
                        </div>

                        {/* Thanh chuyển tab xem trước từng mã đề hoặc tất cả mã đề */}
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-700/80 overflow-x-auto">
                            <span className="text-[10px] font-black uppercase text-slate-400 shrink-0">Xem & Xuất:</span>
                            <button
                                type="button"
                                onClick={() => setActiveVariantTab('ALL')}
                                className={`px-3 py-1 rounded-lg text-xs font-black uppercase flex items-center gap-1.5 shrink-0 transition-all ${
                                    activeVariantTab === 'ALL'
                                        ? 'bg-amber-500 text-slate-950 shadow'
                                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                }`}
                            >
                                <FileStack size={13}/> Tất cả ({variants.length} mã đề chung 1 file)
                            </button>
                            {variants.map(v => (
                                <button
                                    key={v.examCode}
                                    type="button"
                                    onClick={() => setActiveVariantTab(v.examCode)}
                                    className={`px-3 py-1 rounded-lg text-xs font-black uppercase shrink-0 transition-all ${
                                        activeVariantTab === v.examCode
                                            ? 'bg-blue-600 text-white shadow'
                                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                    }`}
                                >
                                    Mã đề {v.examCode}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div 
                    id="quiz-preview-scroll" 
                    tabIndex={0} 
                    data-scroll-container="true" 
                    className="flex-1 overflow-y-auto p-6 md:p-12 bg-white custom-scrollbar outline-none focus:outline-none"
                >
                    <div 
                        id="quiz-export-content" 
                        className="max-w-4xl mx-auto space-y-8 pb-20 bg-white p-4 md:p-8 rounded-lg shadow-sm border border-slate-100" 
                        style={{ 
                            fontFamily: "'Times New Roman', Times, 'Liberation Serif', serif",
                            fontSize: '12pt',
                            textAlign: 'justify', 
                            color: '#000000', 
                            lineHeight: '1.35',
                            letterSpacing: 'normal',
                            wordSpacing: 'normal'
                        }}
                    >
                        {isMultiVariantMode && displayedVariants.length > 0 ? (
                            <>
                                {displayedVariants.map((v, idx) =>
                                    renderExamPaperSheet(
                                        v.quiz,
                                        v.examCode,
                                        isAdmin && !answerKeyAtVeryEnd,
                                        idx === 0
                                    )
                                )}

                                {/* Bảng đáp án tổng hợp tất cả mã đề ở trang cuối */}
                                {isAdmin && answerKeyAtVeryEnd && (
                                    <div style={{ marginTop: '36pt', borderTop: '2pt solid #000', paddingTop: '18pt', pageBreakBefore: 'always' }}>
                                        <h2 style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '14pt', textTransform: 'uppercase', marginBottom: '12pt' }}>
                                            BẢNG ĐÁP ÁN TỔNG HỢP ({displayedVariants.length} MÃ ĐỀ: {displayedVariants.map(v => v.examCode).join(', ')})
                                        </h2>
                                        {displayedVariants.map(v => (
                                            <React.Fragment key={`ans-${v.examCode}`}>
                                                {renderAnswerKeyForQuiz(v.quiz, v.examCode, true)}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            renderExamPaperSheet(normalizedBaseQuiz, undefined, isAdmin, true)
                        )}
                    </div>
                </div>

                {/* Nút cuộn nhanh cho đề thi */}
                <div className="absolute bottom-6 right-6 z-40 flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            const el = document.getElementById('quiz-preview-scroll');
                            el?.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        title="Cuộn lên đầu đề thi (Phím mũi tên lên / PageUp)"
                        className="w-11 h-11 bg-white/95 backdrop-blur-md text-slate-700 hover:text-blue-600 rounded-2xl border-2 border-slate-200 shadow-xl flex items-center justify-center hover:bg-blue-50 transition-all active:scale-95 group"
                    >
                        <ChevronUp size={20} className="group-hover:-translate-y-0.5 transition-transform" />
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const el = document.getElementById('quiz-preview-scroll');
                            el?.scrollBy({ top: 500, behavior: 'smooth' });
                        }}
                        title="Cuộn xuống đề thi (Phím mũi tên xuống / PageDown)"
                        className="w-11 h-11 bg-white/95 backdrop-blur-md text-slate-700 hover:text-blue-600 rounded-2xl border-2 border-slate-200 shadow-xl flex items-center justify-center hover:bg-blue-50 transition-all active:scale-95 group"
                    >
                        <ChevronDown size={20} className="group-hover:translate-y-0.5 transition-transform" />
                    </button>
                </div>
            </div>
        </div>
    );
}
