import { Question, Grade, QuestionLevel } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { normalizeFullText, cleanLatexTextTags, unpackAccidentallyMathWrappedParagraph } from './vietnameseFixer';

export const cleanJsonString = (str: string): string => {
    return str.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
};

export const safeParseJsonWithLatex = (inputStr: string): any => {
    if (!inputStr || typeof inputStr !== 'string') return null;
    let cleanStr = cleanJsonString(inputStr);

    const latexKeywords = 'times|theta|tau|tan|top|text|tilde|triangle|to|beta|bar|bm|mathbf|boldsymbol|begin|bullet|bot|rho|rightarrow|Rightarrow|right|rangle|rad|nu|nabla|neq|notin|not|frac|forall|flat|alpha|gamma|delta|epsilon|omega|pi|mu|lambda|sigma|phi|psi|sqrt|cdot|approx|pm|le|ge|sim|in|infty|vec|hat|circ|angle|partial';

    const preEscapedStr = cleanStr.replace(
        new RegExp(`(^|[^\\\\])\\\\(${latexKeywords})\\b`, 'g'),
        '$1\\\\$2'
    );

    try {
        return JSON.parse(preEscapedStr);
    } catch (firstErr) {
        try {
            const fixedEscape = preEscapedStr.replace(/\\([^"\\\/bfnrtu]|u(?![\da-fA-F]{4}))/g, '\\\\$1');
            return JSON.parse(fixedEscape);
        } catch {
            try {
                const noInvalidCtrl = preEscapedStr
                    .replace(/\r\n/g, "\\n")
                    .replace(/\n/g, "\\n")
                    .replace(/\t/g, "\\t");
                return JSON.parse(noInvalidCtrl);
            } catch {
                try {
                    return JSON.parse(cleanStr);
                } catch {
                    throw new Error("Cấu trúc JSON từ AI không hợp lệ: " + (firstErr as Error).message);
                }
            }
        }
    }
};

const normalizeLevel = (val: any): QuestionLevel | undefined => {
    if (!val) return undefined;
    const str = String(val).trim().toUpperCase();
    if (str === 'B' || str === 'NB' || str.includes('NHẬN BIẾT') || str.includes('BIẾT') || str === 'EASY' || str.includes('KNOW')) return 'B';
    if (str === 'H' || str === 'TH' || str.includes('THÔNG HIỂU') || str.includes('HIỂU') || str === 'MEDIUM' || str.includes('UNDERSTAND')) return 'H';
    if (str === 'VD' || str.includes('VẬN DỤNG CAO') || str === 'VDC' || str === 'VERY HARD' || str === 'VHARD' || str.includes('ANALY') || str.includes('APPLY') || str === 'HARD') {
        if (str === 'VDC' || str.includes('CAO') || str === 'VERY HARD' || str === 'VHARD' || str.includes('ANALY')) return 'VDC';
        return 'VD';
    }
    return undefined;
};

const extractLevelFromText = (text: string): { cleanText: string; level?: QuestionLevel } => {
    if (!text) return { cleanText: "" };
    let cleanText = cleanLatexTextTags(text);
    let level: QuestionLevel | undefined = undefined;

    const levelRegex = /(?:\[|\(|\<)\s*(B|NB|H|TH|VD|VDC|Nhận biết|Thông hiểu|Vận dụng cao|Vận dụng|Biết|Hiểu)\s*(?:\]|\)|\>)/i;
    const match = cleanText.match(levelRegex);
    if (match) {
        level = normalizeLevel(match[1]);
        cleanText = cleanText.replace(match[0], "").trim();
    }
    return { cleanText, level };
};

const stripOptionLabel = (text: string): string => {
    if (!text) return "";
    let cleaned = normalizeFullText(text.trim());
    const labelRegex = /^(\*?[A-Za-z0-9][\.\)\/\-:\s]\s*)/g;

    while (labelRegex.test(cleaned)) {
        cleaned = cleaned.replace(labelRegex, "").trim();
    }
    return cleanLatexTextTags(cleaned);
};

const processAIQuestions = (rawData: any[]): Question[] => {
    return rawData.map((item: any) => {
        const type = item.type?.toLowerCase() || 'mcq';
        const strippedOptions = item.options ? item.options.map((opt: string) => stripOptionLabel(opt)) : (type === 'mcq' ? [] : undefined);
        let finalCorrectAnswer = item.correctAnswer ? cleanLatexTextTags(String(item.correctAnswer)) : item.correctAnswer;

        let extractedPassage = (
            item.groupPassage ||
            item.context ||
            item.passage ||
            item.passageText ||
            item.sharedContext ||
            item.doan_van ||
            item.bai_doc ||
            ''
        )?.toString().trim() || '';

        let extractedMain = extractLevelFromText(item.text || "");
        let cleanedText = normalizeFullText(extractedMain.cleanText);

        if (!extractedPassage) {
            const passageMatch = cleanedText.match(/^(Dữ\s+liệu|Đoạn\s+văn|Lời\s+dẫn|Thông\s+tin)\s+dùng\s+chung\s+cho\s+(câu|Câu)\s*\d+\s*[-–— đến\s]+\d+\s*:\s*([\s\S]+?)(?:\n+|\r\n+)([\s\S]+)$/i);
            if (passageMatch) {
                extractedPassage = passageMatch[3].trim();
                cleanedText = passageMatch[4].trim();
            }
        }

        let finalLevel = normalizeLevel(item.level) || extractedMain.level;
        let cleanedSolution = normalizeFullText(item.solution || "");

        if (type === 'mcq' && item.correctAnswer && item.options) {
            let ansText = item.correctAnswer.trim();
            const matchLabel = ansText.match(/(?:Đáp án|Chọn|Câu\s*\d+[:\s]*|^)\s*([A-D])(?:\.|\s|$)/i);

            if (matchLabel) {
                const label = matchLabel[1].toUpperCase();
                const index = label.charCodeAt(0) - 65;
                if (item.options[index]) {
                    finalCorrectAnswer = stripOptionLabel(item.options[index]);
                }
            } else {
                finalCorrectAnswer = stripOptionLabel(ansText);
            }
        }

        if (type === 'mcq' && strippedOptions && finalCorrectAnswer) {
            const cleanAns = stripOptionLabel(finalCorrectAnswer);
            const exactMatch = strippedOptions.find((opt: string) => stripOptionLabel(opt) === cleanAns);
            if (exactMatch) {
                finalCorrectAnswer = exactMatch;
            } else {
                const fuzzyMatch = strippedOptions.find((opt: string) => {
                    const cleanOpt = stripOptionLabel(opt);
                    return cleanOpt.includes(cleanAns) || cleanAns.includes(cleanOpt);
                });
                if (fuzzyMatch) finalCorrectAnswer = fuzzyMatch;
            }
        }

        if (type === 'short') {
            finalCorrectAnswer = item.correctAnswer?.toString().trim() || "";
        }

        return {
            ...item,
            type,
            id: uuidv4(),
            bankQuestionId: item.bankQuestionId || (item.id && typeof item.id === 'string' ? item.id : undefined),
            groupPassage: extractedPassage || undefined,
            context: extractedPassage || undefined,
            text: cleanedText,
            solution: cleanedSolution,
            level: finalLevel,
            points: item.points || (type === 'mcq' ? 0.25 : type === 'group-tf' ? 1.0 : 0.5),
            options: strippedOptions,
            correctAnswer: finalCorrectAnswer,
            subQuestions: item.subQuestions ? item.subQuestions.map((sq: any) => {
                const sqExtract = extractLevelFromText(sq.text || "");
                return {
                    ...sq,
                    id: uuidv4(),
                    text: stripOptionLabel(sqExtract.cleanText),
                    level: normalizeLevel(sq.level) || sqExtract.level,
                    correctAnswer: (sq.correctAnswer === 'True' || sq.correctAnswer === 'Đúng' || sq.correctAnswer === 'Đ' || sq.correctAnswer === 'T' || sq.correctAnswer === 'true' || sq.correctAnswer === '1') ? 'True' : 'False'
                };
            }) : undefined
        };
    });
};

const postGeminiApi = async (endpoint: string, payload: unknown): Promise<string> => {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || `Lỗi máy chủ AI (${response.status})`);
    }
    return typeof data?.text === 'string' ? data.text : JSON.stringify(data ?? []);
};

export const checkGeminiServerStatus = async (): Promise<boolean> => {
    try {
        const res = await fetch('/api/gemini/status');
        if (!res.ok) return false;
        const data = await res.json();
        return Boolean(data?.ready);
    } catch {
        return false;
    }
};

export const generateQuizFromPrompt = async (config: any): Promise<Question[]> => {
    const textOutput = await postGeminiApi('/api/gemini/generate-quiz', {
        topic: config.topic,
        grade: config.grade,
        part1Count: config.part1Count,
        part2Count: config.part2Count,
        part3Count: config.part3Count,
        matrix: config.matrix,
        pdfBase64: config.pdfBase64,
    });
    const rawData = safeParseJsonWithLatex(textOutput) || [];
    return processAIQuestions(rawData);
};

export interface MatrixRequirementItem {
    chapterId?: string;
    chapterName: string;
    type: 'mcq' | 'group-tf' | 'short';
    level: QuestionLevel;
    count: number;
}

export interface MatrixProgressUpdate {
    phase: 'fetching' | 'checking' | 'generating' | 'normalizing' | 'completed';
    title: string;
    description: string;
    currentCount: number;
    totalCount: number;
    percent: number;
    currentChapter?: string;
    currentLevel?: QuestionLevel;
    currentType?: string;
}

export interface GenerateMatrixQuizConfig {
    subject?: string;
    grade: Grade | string;
    requirements: MatrixRequirementItem[];
    topic?: string;
    promptAdditions?: string;
    pdfBase64?: string;
    onProgress?: (progress: MatrixProgressUpdate) => void;
}

export const generateQuestionsForMatrix = async (config: GenerateMatrixQuizConfig): Promise<Question[]> => {
    const validRequirements = config.requirements.filter(r => r.count > 0);
    if (validRequirements.length === 0) return [];

    const totalQuestions = validRequirements.reduce((sum, r) => sum + r.count, 0);

    const chunks: MatrixRequirementItem[][] = [];
    let currentChunk: MatrixRequirementItem[] = [];
    let currentChunkCount = 0;

    for (const req of validRequirements) {
        if (currentChunkCount + req.count > 22 && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [req];
            currentChunkCount = req.count;
        } else {
            currentChunk.push(req);
            currentChunkCount += req.count;
        }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    const allGeneratedQuestions: Question[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunkReqs = chunks[i];
        const chunkTotal = chunkReqs.reduce((sum, r) => sum + r.count, 0);

        const chapterNames = [...new Set(chunkReqs.map(r => r.chapterName))].join(', ');
        const levels = [...new Set(chunkReqs.map(r => {
            const l = r.level;
            return l === 'B' ? 'Nhận biết' : (l === 'H' ? 'Thông hiểu' : (l === 'VD' ? 'Vận dụng' : 'Vận dụng cao'));
        }))].join(', ');

        if (config.onProgress) {
            const pct = Math.round((i / chunks.length) * 85) + 5;
            config.onProgress({
                phase: 'generating',
                title: `AI đang soạn câu hỏi mới (Đợt ${i + 1}/${chunks.length})`,
                description: `Đang soạn ${chunkTotal} câu cho: "${chapterNames}" • Mức độ: [${levels}]`,
                currentCount: allGeneratedQuestions.length,
                totalCount: totalQuestions,
                percent: pct,
                currentChapter: chapterNames,
                currentLevel: chunkReqs[0]?.level,
                currentType: chunkReqs[0]?.type
            });
        }

        const textOutput = await postGeminiApi('/api/gemini/generate-matrix-chunk', {
            subject: config.subject,
            grade: config.grade,
            topic: config.topic,
            promptAdditions: config.promptAdditions,
            pdfBase64: config.pdfBase64,
            chunkReqs,
        });

        const rawData = safeParseJsonWithLatex(textOutput) || [];
        const processed = processAIQuestions(rawData);

        const chapterMap = new Map<string, string>();
        chunkReqs.forEach(r => {
            if (r.chapterId) chapterMap.set(r.chapterName.trim().toLowerCase(), r.chapterId);
        });

        processed.forEach(q => {
            const cName = (q.chapterName || (q as any).chapter || '').trim();
            const matchedId = chapterMap.get(cName.toLowerCase());
            if (matchedId) q.chapterId = matchedId;
            if (cName) {
                q.chapterName = cName;
                q.quizCategory = cName;
            }
            q.subject = config.subject;
            q.quizGrade = config.grade as Grade;
        });

        allGeneratedQuestions.push(...processed);
    }

    return allGeneratedQuestions;
};

export const parseQuestionsFromPDF = async (base64Data: string, withSolution: boolean = true): Promise<Question[]> => {
    const textOutput = await postGeminiApi('/api/gemini/parse-pdf', { base64Data, withSolution });
    const rawData = safeParseJsonWithLatex(textOutput);
    const questions = processAIQuestions(rawData);
    if (!withSolution) {
        return questions.map(q => ({ ...q, solution: '' }));
    }
    return questions;
};

export const parseQuestionsFromJSON = (input: string | any): { questions: Question[]; quizTitle?: string; grade?: Grade; category?: string; durationMinutes?: number } => {
    let parsed: any;
    if (typeof input === 'string') {
        try {
            parsed = safeParseJsonWithLatex(input);
        } catch {
            throw new Error("Cấu trúc file hoặc chuỗi JSON không hợp lệ. Vui lòng kiểm tra lại cú pháp JSON!");
        }
    } else {
        parsed = input;
    }

    let rawQuestions: any[] = [];
    let quizTitle: string | undefined;
    let grade: Grade | undefined;
    let category: string | undefined;
    let durationMinutes: number | undefined;

    if (Array.isArray(parsed)) {
        rawQuestions = parsed;
    } else if (parsed && typeof parsed === 'object') {
        const infoObj = parsed.exam_info || parsed.info || parsed.metadata || parsed;

        if (infoObj.title || infoObj.quizTitle || infoObj.name || parsed.title || parsed.quizTitle || parsed.name) {
            quizTitle = infoObj.title || infoObj.quizTitle || infoObj.name || parsed.title || parsed.quizTitle || parsed.name;
        }
        if (infoObj.grade || parsed.grade) grade = String(infoObj.grade || parsed.grade) as Grade;
        if (infoObj.category || infoObj.subject || parsed.category || parsed.subject) category = infoObj.category || infoObj.subject || parsed.category || parsed.subject;

        const rawDur = infoObj.durationMinutes || infoObj.duration || infoObj.timeLimit || parsed.durationMinutes || parsed.duration || parsed.timeLimit;
        if (rawDur) {
            if (typeof rawDur === 'number') {
                durationMinutes = rawDur;
            } else if (typeof rawDur === 'string') {
                const match = rawDur.match(/\d+/);
                if (match) durationMinutes = parseInt(match[0], 10);
            }
        }

        if (Array.isArray(parsed.parts)) {
            parsed.parts.forEach((part: any) => {
                if (Array.isArray(part.questions)) {
                    rawQuestions.push(...part.questions);
                } else if (Array.isArray(part.data)) {
                    rawQuestions.push(...part.data);
                } else if (Array.isArray(part.items)) {
                    rawQuestions.push(...part.items);
                }
            });
        }

        if (rawQuestions.length === 0) {
            if (Array.isArray(parsed.questions)) {
                rawQuestions = parsed.questions;
            } else if (Array.isArray(parsed.data)) {
                rawQuestions = parsed.data;
            } else if (Array.isArray(parsed.items)) {
                rawQuestions = parsed.items;
            } else if (parsed.quiz && Array.isArray(parsed.quiz.questions)) {
                rawQuestions = parsed.quiz.questions;
            } else {
                const possibleArray = Object.values(parsed).find(val => Array.isArray(val));
                if (possibleArray) {
                    rawQuestions = possibleArray as any[];
                }
            }
        }
    }

    if (!rawQuestions || rawQuestions.length === 0) {
        throw new Error("Không tìm thấy danh sách câu hỏi hợp lệ trong dữ liệu JSON!");
    }

    const normalizedRaw = rawQuestions.map((q: any) => {
        let typeStr = (q.type || q.qtype || q.questionType || q.question_type || '').toLowerCase().trim();
        let type = 'mcq';
        if (typeStr === 'mc' || typeStr === 'part1' || typeStr.includes('mcq') || typeStr.includes('trac_nghiem') || typeStr.includes('multiple')) {
            type = 'mcq';
        } else if (typeStr === 'tf' || typeStr === 'part2' || typeStr.includes('group') || typeStr.includes('dung_sai') || typeStr.includes('true_false')) {
            type = 'group-tf';
        } else if (typeStr === 'sa' || typeStr === 'part3' || typeStr.includes('short') || typeStr.includes('ngan') || typeStr.includes('tra_loi')) {
            type = 'short';
        } else {
            if (q.subQuestions || q.sub_questions || q.statements || q.y_con) {
                type = 'group-tf';
            } else if (q.options || q.choices || q.phuong_an) {
                type = 'mcq';
            } else {
                type = 'short';
            }
        }

        const rawOptions = q.options || q.choices || q.phuong_an || q.dap_an_lua_chon || q.answers;
        let optionsObj: Record<string, any> | null = null;
        let rawOptionsArray: any[] | null = null;

        if (Array.isArray(rawOptions)) {
            rawOptionsArray = rawOptions;
        } else if (rawOptions && typeof rawOptions === 'object') {
            optionsObj = rawOptions;
            rawOptionsArray = Object.values(rawOptions);
        }

        let subQuestions = q.subQuestions || q.sub_questions || q.statements || q.y_con;

        if (type === 'group-tf' && !subQuestions && rawOptionsArray && Array.isArray(rawOptionsArray)) {
            subQuestions = rawOptionsArray;
        }

        if (Array.isArray(subQuestions)) {
            subQuestions = subQuestions.map((sq: any) => {
                let ans = sq.correctAnswer ?? sq.answer ?? sq.dap_an ?? sq.isTrue ?? sq.isCorrect ?? sq.correct ?? sq.correct_answer;
                if (ans === true || ans === 'True' || ans === 'true' || ans === 'Đ' || ans === 'Đúng' || ans === '1') {
                    ans = 'True';
                } else {
                    ans = 'False';
                }
                const sqText = sq.text || sq.content || sq.noi_dung || sq.question || '';
                const sqLevel = normalizeLevel(sq.level || sq.muc_do || sq.do_kho);
                return {
                    text: sqText.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$'),
                    correctAnswer: ans,
                    level: sqLevel
                };
            });
        }

        let rawCorrectVal = q.correct_answer ?? q.correctAnswer ?? q.answer ?? q.correct ?? q.dap_an_dung ?? q.dap_an ?? q.correctOptionIndex ?? q.correct_option_index ?? q.correctIndex ?? q.correct_index ?? q.answerIndex;

        let options: string[] | undefined = undefined;
        let correctAnswer = '';

        if (type === 'mcq' && rawOptionsArray) {
            options = rawOptionsArray.map((opt: any) => {
                const str = typeof opt === 'string' ? opt : (opt.text || opt.content || opt.label || String(opt));
                return str.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$');
            });

            const correctObj = rawOptionsArray.find((opt: any) => typeof opt === 'object' && (opt.isCorrect === true || opt.is_correct === true || opt.correct === true));
            if (correctObj) {
                const str = typeof correctObj === 'string' ? correctObj : (correctObj.text || correctObj.content || correctObj.label || String(correctObj));
                correctAnswer = str.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$');
            } else if (rawCorrectVal !== undefined && rawCorrectVal !== null && rawCorrectVal !== '') {
                if (optionsObj && typeof rawCorrectVal === 'string' && optionsObj[rawCorrectVal.trim()] !== undefined) {
                    const matchedVal = optionsObj[rawCorrectVal.trim()];
                    const str = typeof matchedVal === 'string' ? matchedVal : (matchedVal.text || matchedVal.content || String(matchedVal));
                    correctAnswer = str.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$');
                } else if (typeof rawCorrectVal === 'number') {
                    if (rawCorrectVal >= 0 && rawCorrectVal < options.length) {
                        correctAnswer = options[rawCorrectVal];
                    } else {
                        correctAnswer = String(rawCorrectVal);
                    }
                } else if (typeof rawCorrectVal === 'string') {
                    const trimmed = rawCorrectVal.trim();
                    if (/^\d+$/.test(trimmed)) {
                        const idx = parseInt(trimmed, 10);
                        if (idx >= 0 && idx < options.length) {
                            correctAnswer = options[idx];
                        } else {
                            correctAnswer = trimmed;
                        }
                    } else if (/^[A-Da-d][\.\:\s]*$/.test(trimmed)) {
                        const letter = trimmed.charAt(0).toUpperCase();
                        const idx = letter.charCodeAt(0) - 65;
                        if (idx >= 0 && idx < options.length) {
                            correctAnswer = options[idx];
                        } else {
                            correctAnswer = trimmed;
                        }
                    } else {
                        correctAnswer = trimmed;
                    }
                }
            }
        } else {
            if (rawCorrectVal !== undefined && rawCorrectVal !== null) {
                correctAnswer = String(rawCorrectVal).trim();
            }
        }

        const contextStr = (q.groupPassage || q.context || q.passage || q.passageText || q.sharedContext || q.doan_van || q.bai_doc || q.loi_dan || '').toString().trim();
        const mainTextStr = (q.text || q.question || q.content || q.cau_hoi || q.title || '').toString().trim();
        let rawText = mainTextStr || contextStr || '';

        const rawSolution = q.solution || q.explanation || q.loi_giai || q.huong_dan_giai || q.guide || '';

        return {
            ...q,
            type,
            groupPassage: contextStr || undefined,
            context: contextStr || undefined,
            text: rawText.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$'),
            options: type === 'mcq' ? options : undefined,
            correctAnswer: typeof correctAnswer === 'string' ? correctAnswer.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$') : String(correctAnswer),
            solution: rawSolution.replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$'),
            points: q.points || q.score || q.diem || (type === 'mcq' ? 0.25 : 1.0),
            subQuestions: type === 'group-tf' ? subQuestions : undefined
        };
    });

    const questions = processAIQuestions(normalizedRaw);

    return {
        questions,
        quizTitle,
        grade,
        category,
        durationMinutes
    };
};

export const parseQuestionsFromText = async (rawText: string, withSolution: boolean = true): Promise<Question[]> => {
    const textOutput = await postGeminiApi('/api/gemini/parse-text', { rawText, withSolution });
    const rawData = safeParseJsonWithLatex(textOutput) || [];
    const questions = processAIQuestions(rawData);
    if (!withSolution) {
        return questions.map(q => ({ ...q, solution: '' }));
    }
    return questions;
};

export const solveQuestionWithAI = async (
    question: Question,
    subject: string = 'Vật lí',
    grade: string = '12'
): Promise<{ solution: string; correctAnswer?: string }> => {
    const textOutput = await postGeminiApi('/api/gemini/solve-question', { question, subject, grade });
    const raw = safeParseJsonWithLatex(textOutput || "{}") || {};
    let sol = raw.solution || "";
    sol = normalizeFullText(sol);
    sol = cleanLatexTextTags(sol);
    sol = unpackAccidentallyMathWrappedParagraph(sol);

    let ans = raw.correctAnswer ? cleanLatexTextTags(normalizeFullText(raw.correctAnswer)) : undefined;

    return {
        solution: sol,
        correctAnswer: ans
    };
};

export interface SolveProgressUpdate {
    current: number;
    total: number;
    percent: number;
    status: 'checking' | 'solving' | 'skipped' | 'done';
    message: string;
    level?: string;
    questionTextSnippet?: string;
}

export const solveMultipleQuestionsWithAI = async (
    questions: Question[],
    subject: string = 'Vật lí',
    grade: string = '12',
    onProgress?: (progress: SolveProgressUpdate) => void,
    forceSolveAll: boolean = false
): Promise<Question[]> => {
    const updated: Question[] = [];
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const hasExistingSolution = Boolean(
            q.solution &&
            q.solution.trim().length > 0 &&
            !q.solution.includes('Chưa có lời giải')
        );

        if (!forceSolveAll && hasExistingSolution) {
            updated.push(q);
            if (onProgress) {
                const pct = Math.round(((i + 1) / questions.length) * 100);
                onProgress({
                    current: i + 1,
                    total: questions.length,
                    percent: pct,
                    status: 'skipped',
                    message: `Câu ${i + 1} (${q.level ? `Mức độ ${q.level}` : 'Có sẵn'}): Đang lấy dữ liệu - Đã có sẵn lời giải, giữ nguyên.`,
                    level: q.level,
                    questionTextSnippet: q.text.substring(0, 50)
                });
            }
            continue;
        }

        if (onProgress) {
            const pct = Math.round((i / questions.length) * 100);
            onProgress({
                current: i + 1,
                total: questions.length,
                percent: pct,
                status: 'solving',
                message: `Câu ${i + 1} (${q.level ? `Mức độ ${q.level}` : 'Chưa có'}): Đang soạn lời giải mới theo chuẩn sư phạm...`,
                level: q.level,
                questionTextSnippet: q.text.substring(0, 50)
            });
        }

        try {
            const res = await solveQuestionWithAI(q, subject, grade);
            updated.push({
                ...q,
                solution: res.solution || q.solution,
                correctAnswer: (q.type !== 'group-tf' && res.correctAnswer && !q.correctAnswer) ? res.correctAnswer : q.correctAnswer
            });
        } catch (e) {
            console.error(`Lỗi giải câu ${i + 1}:`, e);
            updated.push(q);
        }

        if (onProgress) {
            const pct = Math.round(((i + 1) / questions.length) * 100);
            onProgress({
                current: i + 1,
                total: questions.length,
                percent: pct,
                status: 'done',
                message: `Câu ${i + 1}: Đã hoàn tất soạn lời giải!`,
                level: q.level,
                questionTextSnippet: q.text.substring(0, 50)
            });
        }
    }
    return updated;
};

export interface QuestionChapterAssignment {
    questionId: string;
    chapterId?: string;
    chapterName: string;
}

const detectChapterFast = (
    q: Question,
    chapters: { id: string; name: string; grade?: string; subject?: string }[],
    subject?: string,
    grade?: string
): { chapterId?: string; chapterName?: string } | null => {
    if (!chapters || chapters.length === 0) return null;

    const isGenericChapter = (name: string) => {
        const n = name.trim().toLowerCase();
        return n.includes('dethidh') || n.includes('đề thi') || n.includes('de thi') ||
               n.includes('tổng hợp') || n.includes('tong hop') || n.includes('ôn tập') ||
               n.includes('on tap') || n.includes('kiểm tra') || n.includes('kiem tra') ||
               n.includes('giữa kỳ') || n.includes('cuối kỳ') || n.includes('học kỳ') ||
               n.includes('chưa phân loại') || n.length <= 3;
    };

    const optionsText = (q.options || []).join(' ');
    const subQuestionsText = (q.subQuestions || []).map(sq => sq.text).join(' ');
    const textToCheck = `${q.text || ''} ${optionsText} ${subQuestionsText} ${q.solution || ''}`.toLowerCase();

    const tagRegex = /(?:\[|\(|\<)\s*(?:chương|chuong|chủ đề|chu de|bài)\s*([0-9ivx]+)?\s*[:\-–]?\s*([^\]\)>]+)\s*(?:\]|\)|\>)/i;
    const tagMatch = `${q.text || ''} ${q.solution || ''}`.match(tagRegex);
    if (tagMatch) {
        const tagContent = tagMatch[2] ? tagMatch[2].toLowerCase().trim() : '';
        for (const c of chapters) {
            if (isGenericChapter(c.name)) continue;
            const cNameLower = c.name.toLowerCase();
            if (cNameLower.includes(tagContent) || (tagContent && tagContent.includes(cNameLower)) || textToCheck.includes(cNameLower)) {
                return { chapterId: c.id, chapterName: c.name };
            }
        }
    }

    const sLower = (subject || q.subject || '').toLowerCase();

    if (sLower.includes('lý') || sLower.includes('vật lí') || sLower.includes('vật lý') || sLower.includes('physic')) {
        const physicsScores: { chapter: typeof chapters[0]; score: number }[] = [];

        const hasGasStrongKeywords = textToCheck.includes('khí lí tưởng') || textToCheck.includes('chất khí') ||
            textToCheck.includes('khối khí') || textToCheck.includes('đẳng áp') || textToCheck.includes('đẳng nhiệt') ||
            textToCheck.includes('đẳng tích') || textToCheck.includes('boyle') || textToCheck.includes('charles') ||
            textToCheck.includes('clapeyron') || textToCheck.includes('mendeleev') || textToCheck.includes('phương trình trạng thái') ||
            textToCheck.includes('động học phân tử chất khí') || textToCheck.includes('áp suất khí') || textToCheck.includes('piston') ||
            textToCheck.includes('xi lanh') || textToCheck.includes('bình kín chứa') || textToCheck.includes('boltzmann') ||
            textToCheck.includes('căn bậc hai của trung bình bình phương') || textToCheck.includes('tốc độ căn quân phương');

        for (const c of chapters) {
            if (isGenericChapter(c.name)) continue;
            const cName = c.name.toLowerCase();
            let score = 0;

            if (cName.includes('khí') || cName.includes('lí tưởng') || cName.includes('ly tuong') || cName.includes('chất khí')) {
                if (hasGasStrongKeywords) {
                    score += 20;
                }
                if (textToCheck.includes('áp suất') || textToCheck.includes('thể tích v') || textToCheck.includes('mol') || textToCheck.includes('p.v')) {
                    score += 5;
                }
            } else if (cName.includes('nhiệt') && !cName.includes('hạt nhân')) {
                if (!hasGasStrongKeywords) {
                    if (textToCheck.includes('nhiệt dung riêng') || textToCheck.includes('nhiệt nóng chảy') || textToCheck.includes('nhiệt hóa hơi') || textToCheck.includes('nóng chảy riêng') || textToCheck.includes('hóa hơi riêng')) {
                        score += 25;
                    } else if (textToCheck.includes('nhiệt lượng') || textToCheck.includes('nội năng') || textToCheck.includes('cân bằng nhiệt') || textToCheck.includes('nhiệt kế') || textToCheck.includes('thang nhiệt độ') || textToCheck.includes('celsius') || textToCheck.includes('fahrenheit') || textToCheck.includes('nguyên lí i') || textToCheck.includes('nguyên lý 1')) {
                        score += 15;
                    } else if (textToCheck.includes('nhiệt độ') || textToCheck.includes('độ c') || textToCheck.includes('kelvin') || textToCheck.includes('sôi') || textToCheck.includes('bay hơi') || textToCheck.includes('ngưng tụ')) {
                        score += 5;
                    }
                }
            } else if (cName.includes('từ trường') || cName.includes('cảm ứng từ') || cName.includes('từ thông')) {
                if (textToCheck.includes('từ trường') || textToCheck.includes('cảm ứng từ') || textToCheck.includes('lực từ') || textToCheck.includes('lorentz') || textToCheck.includes('từ thông') || textToCheck.includes('cảm ứng điện từ') || textToCheck.includes('lenz') || textToCheck.includes('faraday') || textToCheck.includes('suất điện động cảm ứng') || textToCheck.includes('tesla') || textToCheck.includes('weber')) {
                    score += 20;
                }
            } else if (cName.includes('hạt nhân') || cName.includes('phóng xạ') || cName.includes('nguyên tử')) {
                if (textToCheck.includes('hạt nhân') || textToCheck.includes('phóng xạ') || textToCheck.includes('chu kỳ bán rã') || textToCheck.includes('chu kì bán rã') || textToCheck.includes('độ hụt khối') || textToCheck.includes('năng lượng liên kết') || textToCheck.includes('phân hạch') || textToCheck.includes('nhiệt hạch') || textToCheck.includes('proton') || textToCheck.includes('nơtron') || textToCheck.includes('neutron') || textToCheck.includes('tia alpha') || textToCheck.includes('tia beta') || textToCheck.includes('tia gamma') || textToCheck.includes('mev') || textToCheck.includes('u =')) {
                    score += 20;
                }
            } else if (cName.includes('dao động')) {
                if (textToCheck.includes('dao động điều hòa') || textToCheck.includes('con lắc lò xo') || textToCheck.includes('con lắc đơn') || textToCheck.includes('biên độ') || textToCheck.includes('tần số góc')) score += 10;
            } else if (cName.includes('sóng')) {
                if (textToCheck.includes('bước sóng') || textToCheck.includes('giao thoa sóng') || textToCheck.includes('sóng dừng') || textToCheck.includes('sóng âm') || textToCheck.includes('mức cường độ âm')) score += 10;
            } else if (cName.includes('điện')) {
                if (textToCheck.includes('dòng điện xoay chiều') || textToCheck.includes('điện áp xoay chiều') || textToCheck.includes('mạch rlc') || textToCheck.includes('hệ số công suất')) score += 10;
            }

            if (score > 0) {
                physicsScores.push({ chapter: c, score });
            }
        }

        physicsScores.sort((a, b) => b.score - a.score);
        if (physicsScores.length > 0 && physicsScores[0].score >= 4) {
            return { chapterId: physicsScores[0].chapter.id, chapterName: physicsScores[0].chapter.name };
        }
    }

    if (sLower.includes('toán') || sLower.includes('math')) {
        const mathScores: { chapter: typeof chapters[0]; score: number }[] = [];
        for (const c of chapters) {
            if (isGenericChapter(c.name)) continue;
            const cName = c.name.toLowerCase();
            let score = 0;

            if (cName.includes('hàm số') || cName.includes('đạo hàm') || cName.includes('khảo sát')) {
                if (textToCheck.includes('đồng biến') || textToCheck.includes('nghịch biến')) score += 3;
                if (textToCheck.includes('cực trị') || textToCheck.includes('cực đại') || textToCheck.includes('cực tiểu')) score += 3;
                if (textToCheck.includes('tiệm cận đứng') || textToCheck.includes('tiệm cận ngang') || textToCheck.includes('tiệm cận')) score += 3;
                if (textToCheck.includes('bảng biến thiên') || textToCheck.includes('đồ thị của hàm số')) score += 2;
                if (textToCheck.includes('giá trị lớn nhất') || textToCheck.includes('giá trị nhỏ nhất') || textToCheck.includes('max') || textToCheck.includes('min')) score += 2;
                if (textToCheck.includes('y = f(x)') || textToCheck.includes('f\'(x)')) score += 1;
            } else if (cName.includes('nguyên hàm') || cName.includes('tích phân') || cName.includes('tich phan')) {
                if (textToCheck.includes('\\int') || textToCheck.includes('nguyên hàm') || textToCheck.includes('tích phân')) score += 4;
                if (textToCheck.includes('diện tích hình phẳng') || textToCheck.includes('thể tích khối tròn xoay')) score += 3;
            } else if (cName.includes('không gian') || cName.includes('tọa độ') || cName.includes('toạ độ') || cName.includes('oxyz') || cName.includes('vectơ')) {
                if (textToCheck.includes('oxyz') || textToCheck.includes('o, \\vec{i}') || textToCheck.includes('không gian với hệ tọa độ')) score += 4;
                if (textToCheck.includes('vectơ pháp tuyến') || textToCheck.includes('vectơ chỉ phương')) score += 3;
                if (textToCheck.includes('phương trình mặt phẳng') || textToCheck.includes('phương trình đường thẳng') || textToCheck.includes('mặt cầu')) score += 3;
                if (textToCheck.includes('toạ độ của điểm') || textToCheck.includes('tọa độ điểm') || textToCheck.includes('khoảng cách từ điểm')) score += 2;
            } else if (cName.includes('số phức') || cName.includes('so phuc')) {
                if (textToCheck.includes('số phức') || textToCheck.includes('phần thực') || textToCheck.includes('phần ảo') || textToCheck.includes('môđun') || textToCheck.includes('số phức liên hợp')) score += 4;
                if (textToCheck.includes('z = a + bi') || textToCheck.includes('\\bar{z}') || textToCheck.includes('|z|')) score += 3;
            } else if (cName.includes('xác suất') || cName.includes('thống kê') || cName.includes('số liệu') || cName.includes('phân tán')) {
                if (textToCheck.includes('xác suất') || textToCheck.includes('biến cố') || textToCheck.includes('không gian mẫu')) score += 4;
                if (textToCheck.includes('kỳ vọng') || textToCheck.includes('phương sai') || textToCheck.includes('độ lệch chuẩn') || textToCheck.includes('mẫu số liệu') || textToCheck.includes('khoảng biến thiên')) score += 4;
            }

            if (score > 0) {
                mathScores.push({ chapter: c, score });
            }
        }

        mathScores.sort((a, b) => b.score - a.score);
        if (mathScores.length > 0 && mathScores[0].score >= 3) {
            return { chapterId: mathScores[0].chapter.id, chapterName: mathScores[0].chapter.name };
        }
    }

    if (sLower.includes('hóa') || sLower.includes('chem')) {
        for (const c of chapters) {
            if (isGenericChapter(c.name)) continue;
            const cName = c.name.toLowerCase();
            if ((cName.includes('este') || cName.includes('lipit')) && (textToCheck.includes('este') || textToCheck.includes('lipit') || textToCheck.includes('chất béo') || textToCheck.includes('xà phòng hóa') || textToCheck.includes('triglyxerit') || textToCheck.includes('etyl axetat'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
            if (cName.includes('cacbo') && (textToCheck.includes('glucozơ') || textToCheck.includes('fructozơ') || textToCheck.includes('saccarozơ') || textToCheck.includes('tinh bột') || textToCheck.includes('xenlulozơ'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
            if ((cName.includes('amin') || cName.includes('nitơ') || cName.includes('protein')) && (textToCheck.includes('amin') || textToCheck.includes('amino axit') || textToCheck.includes('peptit') || textToCheck.includes('protein') || textToCheck.includes('anilin') || textToCheck.includes('glyxin') || textToCheck.includes('alanin'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
            if (cName.includes('polime') && (textToCheck.includes('polime') || textToCheck.includes('trùng hợp') || textToCheck.includes('trùng ngưng') || textToCheck.includes('cao su') || textToCheck.includes('tơ nilon'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
            if ((cName.includes('pin') || cName.includes('điện phân')) && (textToCheck.includes('pin điện') || textToCheck.includes('điện phân') || textToCheck.includes('thế điện cực') || textToCheck.includes('ăn mòn điện hóa'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
            if (cName.includes('kim loại') && (textToCheck.includes('kim loại kiềm') || textToCheck.includes('kiềm thổ') || textToCheck.includes('nhôm') || textToCheck.includes('sắt') || textToCheck.includes('dãy điện hóa') || textToCheck.includes('hợp kim'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
        }
    }

    if (sLower.includes('sinh') || sLower.includes('bio')) {
        for (const c of chapters) {
            if (isGenericChapter(c.name)) continue;
            const cName = c.name.toLowerCase();
            if (cName.includes('di truyền') && (textToCheck.includes('gen') || textToCheck.includes('alen') || textToCheck.includes('nhiễm sắc thể') || textToCheck.includes('đột biến') || textToCheck.includes('adn') || textToCheck.includes('marn') || textToCheck.includes('phép lai'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
            if (cName.includes('tiến hóa') && (textToCheck.includes('tiến hóa') || textToCheck.includes('chọn lọc tự nhiên') || textToCheck.includes('dacuyn') || textToCheck.includes('thích nghi'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
            if (cName.includes('sinh thái') && (textToCheck.includes('quần thể') || textToCheck.includes('quần xã') || textToCheck.includes('hệ sinh thái') || textToCheck.includes('chuỗi thức ăn') || textToCheck.includes('lưới thức ăn'))) {
                return { chapterId: c.id, chapterName: c.name };
            }
        }
    }

    for (const c of chapters) {
        if (isGenericChapter(c.name)) continue;
        const cleanCName = c.name.replace(/^chương\s*[0-9ivx]+[:\.\-–\s]*/i, '').trim().toLowerCase();
        if (cleanCName.length > 5 && textToCheck.includes(cleanCName)) {
            return { chapterId: c.id, chapterName: c.name };
        }
    }

    return null;
};

export const classifyQuestionsIntoChapters = async (
    questions: Question[],
    chapters: { id: string; name: string; grade?: string; subject?: string }[],
    options?: {
        subject?: string;
        grade?: string;
    }
): Promise<QuestionChapterAssignment[]> => {
    if (!questions || questions.length === 0) return [];
    if (!chapters || chapters.length === 0) return [];

    const knowledgeChapters = chapters.filter(c => {
        const n = c.name.trim().toLowerCase();
        return !n.includes('dethidh') && !n.includes('đề thi') && !n.includes('de thi') &&
               !n.includes('tổng hợp') && !n.includes('tong hop') && !n.includes('ôn tập') &&
               !n.includes('on tap') && !n.includes('kiểm tra') && !n.includes('kiem tra') &&
               !n.includes('giữa kỳ') && !n.includes('cuối kỳ') && !n.includes('học kỳ') &&
               !n.includes('chưa phân loại') && n.length > 3;
    });
    const effectiveChapters = knowledgeChapters.length > 0 ? knowledgeChapters : chapters;

    const results: QuestionChapterAssignment[] = [];
    const questionsNeedingAi: Question[] = [];

    questions.forEach(q => {
        const fastMatch = detectChapterFast(q, effectiveChapters, options?.subject, options?.grade);
        if (fastMatch && fastMatch.chapterName) {
            results.push({
                questionId: q.id,
                chapterId: fastMatch.chapterId,
                chapterName: fastMatch.chapterName
            });
        } else {
            questionsNeedingAi.push(q);
        }
    });

    if (questionsNeedingAi.length === 0) {
        return results;
    }

    const chapterMapById = new Map(chapters.map(c => [c.id, c]));
    const chapterMapByName = new Map(chapters.map(c => [c.name.trim().toLowerCase(), c]));

    const BATCH_SIZE = 25;
    const batches: { batch: Question[]; offset: number }[] = [];
    for (let i = 0; i < questionsNeedingAi.length; i += BATCH_SIZE) {
        batches.push({ batch: questionsNeedingAi.slice(i, i + BATCH_SIZE), offset: i });
    }

    const CONCURRENCY = 3;
    for (let w = 0; w < batches.length; w += CONCURRENCY) {
        const wave = batches.slice(w, w + CONCURRENCY);
        const waveResults = await Promise.all(
            wave.map(async ({ batch, offset }) => {
                const batchOut: QuestionChapterAssignment[] = [];
                try {
                    const textOutput = await postGeminiApi('/api/gemini/classify-chapters', {
                        batch,
                        chapters: effectiveChapters,
                        subject: options?.subject,
                        grade: options?.grade,
                        offset,
                    });
                    const rawAssignments = safeParseJsonWithLatex(textOutput) || [];

                    if (Array.isArray(rawAssignments)) {
                        const batchResultMap = new Map<string, QuestionChapterAssignment>();

                        rawAssignments.forEach(item => {
                            const qId = String(item.questionId || '').trim();
                            let targetChapter = chapterMapById.get(item.chapterId);
                            if (!targetChapter && item.chapterName) {
                                const cNameLower = String(item.chapterName).trim().toLowerCase();
                                targetChapter = chapterMapByName.get(cNameLower);
                                if (!targetChapter) {
                                    targetChapter = chapters.find(c => {
                                        const raw = c.name.toLowerCase();
                                        return raw.includes(cNameLower) || cNameLower.includes(raw);
                                    });
                                }
                            }

                            if (targetChapter) {
                                batchResultMap.set(qId, {
                                    questionId: qId,
                                    chapterId: targetChapter.id,
                                    chapterName: targetChapter.name
                                });
                            }
                        });

                        batch.forEach(q => {
                            const found = batchResultMap.get(q.id);
                            if (found) {
                                batchOut.push(found);
                            } else {
                                const fallbackMatch = detectChapterFast(q, chapters, options?.subject, options?.grade) || {
                                    chapterId: chapters[0].id,
                                    chapterName: chapters[0].name
                                };
                                batchOut.push({
                                    questionId: q.id,
                                    chapterId: fallbackMatch.chapterId || chapters[0].id,
                                    chapterName: fallbackMatch.chapterName || chapters[0].name
                                });
                            }
                        });
                    }
                } catch (err: any) {
                    console.error(`Lỗi khi gán chương nhóm câu ${offset + 1}-${offset + batch.length}:`, err);
                    const errStr = err?.message || String(err);
                    if (errStr.includes('Lỗi 403') || errStr.includes('Lỗi 400') || errStr.includes('GEMINI_API_KEY')) {
                        throw new Error(errStr);
                    }

                    batch.forEach(q => {
                        const fallbackMatch = detectChapterFast(q, chapters, options?.subject, options?.grade) || {
                            chapterId: chapters[0].id,
                            chapterName: chapters[0].name
                        };
                        batchOut.push({
                            questionId: q.id,
                            chapterId: fallbackMatch.chapterId || chapters[0].id,
                            chapterName: fallbackMatch.chapterName || chapters[0].name
                        });
                    });
                }
                return batchOut;
            })
        );
        waveResults.forEach(items => results.push(...items));
    }

    return results;
};

export interface QuestionLevelAssignment {
    questionId: string;
    level: QuestionLevel;
    subQuestionLevels?: {
        index: number;
        level: QuestionLevel;
    }[];
}

const detectLevelFast = (q: Question): { level?: QuestionLevel; subLevels?: { index: number; level: QuestionLevel }[] } | null => {
    if (q.type === 'group-tf' && q.subQuestions && q.subQuestions.length > 0) {
        const subLvs: { index: number; level: QuestionLevel }[] = [];
        let allSubHaveExplicitTag = true;

        q.subQuestions.forEach((sq, idx) => {
            let sLvl: QuestionLevel | undefined = undefined;
            if (sq.level) {
                sLvl = normalizeLevel(sq.level);
            }
            if (!sLvl && sq.text) {
                const match = sq.text.match(/(?:\[|\(|\<|\{)\s*(NB|B|TH|H|VD|VDC|Nhận\s*biết|Thông\s*hiểu|Vận\s*dụng\s*cao|Vận\s*dụng|Biết|Hiểu)\s*(?:\]|\)|\>|\})/i);
                if (match) {
                    sLvl = normalizeLevel(match[1]);
                }
            }

            if (sLvl) {
                subLvs.push({ index: idx, level: sLvl });
            } else {
                allSubHaveExplicitTag = false;
            }
        });

        if (allSubHaveExplicitTag && subLvs.length === q.subQuestions.length) {
            const mainLvl = q.level ? normalizeLevel(q.level) : (subLvs[1]?.level || subLvs[0]?.level || 'H');
            return {
                level: mainLvl,
                subLevels: subLvs
            };
        }

        return null;
    }

    let detectedLevel: QuestionLevel | undefined = undefined;
    if (q.level) {
        detectedLevel = normalizeLevel(q.level);
    }

    if (!detectedLevel) {
        const combinedText = `${q.text || ''} ${q.solution || ''}`;
        const matchTag = combinedText.match(/(?:\[|\(|\<|\{)\s*(NB|B|TH|H|VD|VDC|Nhận\s*biết|Thông\s*hiểu|Vận\s*dụng\s*cao|Vận\s*dụng|Biết|Hiểu)\s*(?:\]|\)|\>|\})/i);
        if (matchTag) {
            detectedLevel = normalizeLevel(matchTag[1]);
        }

        if (!detectedLevel) {
            const prefixMatch = combinedText.match(/(?:Mức\s*(?:độ)?|Cấp\s*độ)\s*:\s*(Nhận\s*biết|Thông\s*hiểu|Vận\s*dụng\s*cao|Vận\s*dụng|NB|TH|VD|VDC|B|H)/i);
            if (prefixMatch) {
                detectedLevel = normalizeLevel(prefixMatch[1]);
            }
        }
    }

    if (detectedLevel) {
        return { level: detectedLevel };
    }

    return null;
};

export const classifyQuestionsIntoLevels = async (
    questions: Question[],
    options?: {
        subject?: string;
        grade?: string;
    }
): Promise<QuestionLevelAssignment[]> => {
    if (!questions || questions.length === 0) return [];

    const results: QuestionLevelAssignment[] = [];
    const questionsNeedingAi: Question[] = [];

    questions.forEach(q => {
        const fastMatch = detectLevelFast(q);
        if (fastMatch && fastMatch.level) {
            results.push({
                questionId: q.id,
                level: fastMatch.level,
                subQuestionLevels: fastMatch.subLevels
            });
        } else {
            questionsNeedingAi.push(q);
        }
    });

    if (questionsNeedingAi.length === 0) {
        return results;
    }

    const BATCH_SIZE = 15;
    for (let i = 0; i < questionsNeedingAi.length; i += BATCH_SIZE) {
        const batch = questionsNeedingAi.slice(i, i + BATCH_SIZE);

        try {
            const textOutput = await postGeminiApi('/api/gemini/classify-levels', {
                batch,
                subject: options?.subject,
                grade: options?.grade,
                offset: i,
            });
            const rawAssignments = safeParseJsonWithLatex(textOutput) || [];

            if (Array.isArray(rawAssignments)) {
                rawAssignments.forEach(item => {
                    const qId = String(item.questionId || '').trim();
                    const normalizedLvl = normalizeLevel(item.level) || 'H';
                    const subLvls = Array.isArray(item.subQuestionLevels)
                        ? item.subQuestionLevels.map((sq: any) => ({
                            index: Number(sq.index) || 0,
                            level: normalizeLevel(sq.level) || 'H'
                        }))
                        : undefined;

                    results.push({
                        questionId: qId,
                        level: normalizedLvl,
                        subQuestionLevels: subLvls
                    });
                });
            }
        } catch (err: any) {
            console.warn("AI error during batch level classify:", err);
            batch.forEach(q => {
                results.push({
                    questionId: q.id,
                    level: q.type === 'short' ? 'VD' : 'H'
                });
            });
        }
    }

    return results;
};
